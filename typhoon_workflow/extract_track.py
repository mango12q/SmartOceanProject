#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""台风中心路径提取（独立工作流）。

数据来源接口（typhoons.json -> typhoons.<name>.track.source）：
  A. source = "file" : 直接使用已有 track 文件（保证已整理数据稳定复现，
                       桦加沙使用 data/huajiasha.track.json）；
  B. source = "auto" : 从 WRF d02 输出自动提取：
        - 主段：逐时取海洋区域（HGT <= ocean_hgt_max）最低 PSFC 点作为台风中心；
        - 登陆自动识别：中心格点 HGT > land_hgt_max 的首次时次即为登陆时次；
        - 尾段：登陆后（自动识别，或用 tail_from_t 手动指定）在 tail_box 内取相对涡度最大值点；
        - 缺测时次线性插值，> max_jump_deg 的跳变剔除，按 track_from_t/to_t 截断。

输出：JSON 数组 [{t, lat, lon, psfc, wind}]，与页面 typhoonTrack 格式完全一致。
"""
import argparse
import json
import os

import numpy as np
import xarray as xr


def nearest_index(la_grid, lo_grid, lat, lon):
    d = (la_grid - lat) ** 2 + (lo_grid - lon) ** 2
    idx = int(d.argmin())
    return np.unravel_index(idx, d.shape)


def nearest_value(arr, la_grid, lo_grid, lat, lon):
    i, j = nearest_index(la_grid, lo_grid, lat, lon)
    return float(arr[i, j])


def ocean_min_psfc_center(ps, hgt, la, lo, ocean_hgt_max):
    mask = hgt <= ocean_hgt_max
    if not mask.any():
        return None
    ps_masked = np.where(mask, ps, np.inf)
    pos = int(ps_masked.argmin())
    i, j = np.unravel_index(pos, ps.shape)
    return float(la[i, j]), float(lo[i, j]), float(ps[i, j])


def local_min_psfc_center(ps, la, lo, lat, lon, window_deg=3.0):
    """在上一步中心附近（允许陆地）搜索最低 PSFC，用于跳变时回溯真实中心。"""
    mask = (np.abs(la - lat) <= window_deg) & (np.abs(lo - lon) <= window_deg)
    if not mask.any():
        return None
    ps_masked = np.where(mask, ps, np.inf)
    pos = int(ps_masked.argmin())
    i, j = np.unravel_index(pos, ps.shape)
    return float(la[i, j]), float(lo[i, j]), float(ps[i, j])


def vorticity_tail_center(u, v, la, lo, box=None):
    dudy, dudx = np.gradient(u, axis=(0, 1))
    dvdy, dvdx = np.gradient(v, axis=(0, 1))
    vort = dvdx - dudy
    if box:
        mask = (
            (la >= box["lat_min"]) & (la <= box["lat_max"]) &
            (lo >= box["lon_min"]) & (lo <= box["lon_max"])
        )
    else:
        mask = np.ones_like(la, dtype=bool)
    vz = np.where(mask, vort, -1e9)
    pos = int(vz.reshape(-1).argmax())
    i = pos // vz.shape[1]
    j = pos % vz.shape[1]
    return float(la[i, j]), float(lo[i, j])


def center_wind(u, v, la, lo, lat, lon):
    i, j = nearest_index(la, lo, lat, lon)
    return float(np.hypot(u[i, j], v[i, j]))


def clean_points(points, track_from_t=None, track_to_t=None,
                 interpolate=True, max_jump_deg=2.0):
    pts = sorted(points, key=lambda p: p["t"])
    if track_from_t is not None:
        pts = [p for p in pts if p["t"] >= track_from_t]
    if track_to_t is not None:
        pts = [p for p in pts if p["t"] <= track_to_t]
    if not pts:
        return []

    # 剔除相邻时次位移超过阈值的跳变点
    if max_jump_deg and max_jump_deg > 0:
        keep = [pts[0]]
        for p in pts[1:]:
            prev = keep[-1]
            d = ((p["lat"] - prev["lat"]) ** 2 + (p["lon"] - prev["lon"]) ** 2) ** 0.5
            if d > max_jump_deg:
                continue
            keep.append(p)
        pts = keep

    # 缺测时次线性插值补全
    if interpolate:
        by_t = {p["t"]: p for p in pts}
        out = []
        for t in range(pts[0]["t"], pts[-1]["t"] + 1):
            if t in by_t:
                out.append(by_t[t])
                continue
            prevs = [p for p in pts if p["t"] < t]
            nexts = [p for p in pts if p["t"] > t]
            if not prevs or not nexts:
                continue
            p0 = max(prevs, key=lambda p: p["t"])
            p1 = min(nexts, key=lambda p: p["t"])
            frac = (t - p0["t"]) / (p1["t"] - p0["t"])
            out.append({
                "t": t,
                "lat": round(p0["lat"] + (p1["lat"] - p0["lat"]) * frac, 2),
                "lon": round(p0["lon"] + (p1["lon"] - p0["lon"]) * frac, 2),
                "psfc": int(round(p0["psfc"] + (p1["psfc"] - p0["psfc"]) * frac)),
                "wind": round(p0["wind"] + (p1["wind"] - p0["wind"]) * frac, 1)
            })
        pts = out
    return pts


def extract_auto(cfg, wrf_file, t_start=None, t_end=None):
    track_cfg = cfg.get("track", {})
    ocean_max = track_cfg.get("ocean_hgt_max", 0.0)
    tail_from = track_cfg.get("tail_from_t")
    box = track_cfg.get("tail_box")
    land_threshold = track_cfg.get("land_hgt_max", 0.0)
    jump_deg = track_cfg.get("max_jump_deg", 2.0)

    ds = xr.open_dataset(wrf_file)
    u = ds["U10"].values
    v = ds["V10"].values
    ps = ds["PSFC"].values
    hgt = ds["HGT"].values
    la = ds["XLAT"].values
    lo = ds["XLONG"].values
    ntimes = u.shape[0]

    points = []
    landfall_t = None
    use_tail = False
    prev = None
    k0 = t_start if t_start is not None else 0
    k1 = t_end if t_end is not None else ntimes - 1
    for k in range(k0, k1 + 1):
        if not use_tail:
            center = ocean_min_psfc_center(ps[k], hgt[k], la[k], lo[k], ocean_max)
            if center is None:
                prev = None
                continue
            lat, lon, psfc = center
            if prev is not None:
                dist = ((lat - prev[0]) ** 2 + (lon - prev[1]) ** 2) ** 0.5
                if dist > jump_deg:
                    # 全局海洋最低压突然远跳：真实中心很可能已登陆，
                    # 用上一中心附近的局部最低压回溯判断。
                    local = local_min_psfc_center(ps[k], la[k], lo[k],
                                                  prev[0], prev[1], window_deg=3.0)
                    if local is not None:
                        llat, llon, lpsfc = local
                        if nearest_value(hgt[k], la[k], lo[k], llat, llon) > land_threshold:
                            landfall_t = k
                            use_tail = True
                        else:
                            # 仍是海上跳变：用局部中心继续，避免漂到远处另一个低压
                            lat, lon, psfc = llat, llon, lpsfc
            if tail_from is not None and k >= tail_from:
                if landfall_t is None:
                    landfall_t = k
                use_tail = True
            prev = (lat, lon)
        if use_tail:
            lat, lon = vorticity_tail_center(u[k], v[k], la[k], lo[k], box)
            psfc = nearest_value(ps[k], la[k], lo[k], lat, lon)
        wind = center_wind(u[k], v[k], la[k], lo[k], lat, lon)
        points.append({
            "t": k,
            "lat": round(lat, 2),
            "lon": round(lon, 2),
            "psfc": int(round(psfc)),
            "wind": round(wind, 1)
        })
        print("t=%d -> (%.2f, %.2f) psfc=%d wind=%.1f" % (k, lat, lon, int(round(psfc)), wind), flush=True)
    ds.close()

    cleaned = clean_points(
        points,
        track_from_t=track_cfg.get("track_from_t"),
        track_to_t=track_cfg.get("track_to_t"),
        interpolate=track_cfg.get("interpolate_gaps", True),
        max_jump_deg=track_cfg.get("max_jump_deg", 2.0)
    )
    peak = max(cleaned, key=lambda p: p["wind"]) if cleaned else None
    meta = {
        "first_t": cleaned[0]["t"] if cleaned else None,
        "last_t": cleaned[-1]["t"] if cleaned else None,
        "peak_t": peak["t"] if peak else None,
        "landfall_t": landfall_t
    }
    return cleaned, meta


def load_track_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser(description="台风中心路径提取")
    ap.add_argument("--config", default="typhoons.json")
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", default="out")
    ap.add_argument("--track-json", help="覆盖 manifest 的 track 文件（可选）")
    ap.add_argument("--auto", action="store_true",
                    help="强制使用 WRF 自动提取（忽略 manifest 的 source=file）")
    args = ap.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        conf = json.load(f)
    cfg = conf["typhoons"][args.name]
    track_cfg = cfg.get("track", {})

    if args.auto:
        track_cfg = dict(track_cfg, source="auto")
    elif args.track_json:
        track_cfg = dict(track_cfg, source="file", file=args.track_json)

    meta = None
    if track_cfg.get("source") == "file":
        points = load_track_file(track_cfg["file"])
        points = clean_points(
            points,
            track_from_t=track_cfg.get("track_from_t"),
            track_to_t=track_cfg.get("track_to_t"),
            interpolate=track_cfg.get("interpolate_gaps", True),
            max_jump_deg=track_cfg.get("max_jump_deg", 2.0)
        )
        peak = max(points, key=lambda p: p["wind"]) if points else None
        landfall_t = None
        for tk in (cfg.get("ticks") or []):
            if tk.get("label") == "登陆":
                landfall_t = tk["t"]
        meta = {
            "first_t": points[0]["t"] if points else None,
            "last_t": points[-1]["t"] if points else None,
            "peak_t": peak["t"] if peak else None,
            "landfall_t": landfall_t
        }
    else:
        points, meta = extract_auto(cfg, cfg["wrf_file"])

    out_dir = os.path.join(args.out, args.name)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "track.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(points, f, ensure_ascii=False)
    meta_path = os.path.join(out_dir, "track_meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print("Wrote %s (%d points, t=%s~%s)" % (
        out_path, len(points), points[0]["t"], points[-1]["t"]))
    print("Meta: %s" % json.dumps(meta, ensure_ascii=False))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""校验流水线产物：track.json 完整性 + wind_field bin 可解码且格式正确。

用法：
  python verify_assets.py --track out/桦加沙/track.json
  python verify_assets.py --wind out/桦加沙/wind_field --range 0 263
  python verify_assets.py --wind out/桦加沙/wind_field --reference /home/haike/test_web/wind_field
"""
import argparse
import glob
import json
import math
import os

import msgpack


def verify_track(path):
    with open(path, "r", encoding="utf-8") as f:
        pts = json.load(f)
    assert isinstance(pts, list) and pts, "track 必须是非空数组"
    ts = [p["t"] for p in pts]
    assert ts == sorted(ts), "t 必须单调递增"
    assert len(set(ts)) == len(ts), "t 不能重复"
    for p in pts:
        assert set(p) == {"t", "lat", "lon", "psfc", "wind"}, "字段必须为 t/lat/lon/psfc/wind"
        assert math.isfinite(p["lat"]) and -90 <= p["lat"] <= 90
        assert math.isfinite(p["lon"]) and -180 <= p["lon"] <= 180
        assert 80000 <= p["psfc"] <= 105000, "psfc 超出合理范围"
        assert p["wind"] >= 0
    print("track OK: %d points, t=%s~%s" % (len(pts), ts[0], ts[-1]))
    return True


def verify_wind(dir_path, t_range=None, reference=None):
    files = sorted(glob.glob(os.path.join(dir_path, "wind_field_*.bin")))
    assert files, "目录中没有 wind_field_*.bin"
    ref_map = {}
    if reference:
        for rf in glob.glob(os.path.join(reference, "wind_field_*.bin")):
            ref_map[os.path.basename(rf)] = rf
    checked = 0
    max_dir = -1.0
    dir360 = 0
    for fp in files:
        base = os.path.basename(fp)
        if t_range is not None:
            t = int(base.replace("wind_field_", "").replace(".bin", ""))
            if not (t_range[0] <= t <= t_range[1]):
                continue
        with open(fp, "rb") as fh:
            data = msgpack.unpackb(fh.read(), raw=False)
        assert isinstance(data, list), base + " 必须解码为 list"
        for row in data:
            assert len(row) == 4, base + " 每条记录必须为 [lon,lat,spd,dir]"
            lon, lat, spd, dire = row
            assert math.isfinite(lon) and math.isfinite(lat)
            assert spd >= 0 and 0 <= dire <= 360, base + " 方向越界: %r" % (dire,)
            max_dir = max(max_dir, float(dire))
            if float(dire) == 360.0:
                dir360 += 1
        if reference and base in ref_map:
            assert bins_match(fp, ref_map[base]), base + " 与参考文件不一致"
        checked += 1
    print("wind OK: %d bins checked in %s%s，最大风向 %.1f°（360°取整边界 %d 条）" % (
        checked, dir_path, "（与参考目录一致）" if reference else "", max_dir, dir360))
    return True


def bins_match(a_path, b_path):
    """先逐字节对比；若因 360°/0° 取整边界不同，再按方向模 360 逐条对比。"""
    with open(a_path, "rb") as fa, open(b_path, "rb") as fb:
        if fa.read() == fb.read():
            return True
    with open(a_path, "rb") as fa, open(b_path, "rb") as fb:
        a = msgpack.unpackb(fa.read(), raw=False)
        b = msgpack.unpackb(fb.read(), raw=False)
    if len(a) != len(b):
        return False
    for ra, rb in zip(a, b):
        if ra[0] != rb[0] or ra[1] != rb[1] or ra[2] != rb[2]:
            return False
        if round(float(ra[3]) % 360, 1) != round(float(rb[3]) % 360, 1):
            return False
    return True


def main():
    ap = argparse.ArgumentParser(description="校验台风流水线产物")
    ap.add_argument("--track")
    ap.add_argument("--wind")
    ap.add_argument("--range", nargs=2, type=int)
    ap.add_argument("--reference")
    args = ap.parse_args()
    ok = True
    if args.track:
        ok &= verify_track(args.track)
    if args.wind:
        ok &= verify_wind(args.wind, args.range, args.reference)
    if not ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

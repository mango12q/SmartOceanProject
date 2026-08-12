#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""台风数据计算流水线：路径提取 -> 风场处理 -> 网页注册表更新。

用法：
  python run_pipeline.py --name 桦加沙 --steps track,wind,registry
  python run_pipeline.py --name 新台风 --out out --patch-index ../index.html
  python run_pipeline.py --name 新台风 --steps track,wind --only 200

新增台风步骤：
  1. 在 typhoons.json 的 typhoons 中新增一项（wrf_file / start / 时间范围 / track 配置）；
  2. 运行本流水线（自动提取路径 + 处理风场 + 生成注册表）；
  3. 把 out/<name>/wind_field 上传到服务器 wind_field/<name>/，
     把注册表 patch 到 index.html 并上传，刷新页面即可切换查看。
"""
import argparse
import json
import os

import build_registry
import extract_track
import process_wind


def main():
    ap = argparse.ArgumentParser(description="台风路径+风场计算流水线")
    ap.add_argument("--config", default="typhoons.json")
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", default="out")
    ap.add_argument("--steps", default="track,wind,registry",
                    help="逗号分隔：track,wind,registry")
    ap.add_argument("--only", type=int, help="只处理指定风场时次")
    ap.add_argument("--ocean-only", action="store_true", help="风场仅保留海上格点")
    ap.add_argument("--patch-index", help="registry 步骤同时更新 index.html 注册表")
    args = ap.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        conf = json.load(f)
    steps = [s.strip() for s in args.steps.split(",") if s.strip()]
    names = list(conf["typhoons"].keys()) if args.name == "all" else [args.name]
    for name in names:
        run_one(conf, name, steps, args)


def run_one(conf, name, steps, args):
    cfg = conf["typhoons"][name]
    out_dir = os.path.join(args.out, name)

    if "track" in steps:
        track_cfg = cfg.get("track", {})
        if track_cfg.get("source") == "file":
            points = extract_track.load_track_file(track_cfg["file"])
            points = extract_track.clean_points(
                points,
                track_from_t=track_cfg.get("track_from_t"),
                track_to_t=track_cfg.get("track_to_t"),
                interpolate=track_cfg.get("interpolate_gaps", True),
                max_jump_deg=track_cfg.get("max_jump_deg", 2.0)
            )
        else:
            points, meta = extract_track.extract_auto(cfg, cfg["wrf_file"])
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, "track.json"), "w", encoding="utf-8") as f:
            json.dump(points, f, ensure_ascii=False)
        if track_cfg.get("source") == "file":
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
        with open(os.path.join(out_dir, "track_meta.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=1)
        print("track done: %d points (t=%s~%s)" % (
            len(points), points[0]["t"], points[-1]["t"]))

    if "wind" in steps:
        process_wind.process(
            cfg, cfg["wrf_file"],
            os.path.join(out_dir, "wind_field"),
            only_t=args.only,
            ocean_only=args.ocean_only
        )

    if "registry" in steps:
        block = build_registry.build_block(conf, args.out)
        if args.patch_index:
            path = build_registry.patch_index(args.patch_index, block)
            print("registry patched: %s" % path)
        else:
            print("registry block generated (use --patch-index to apply):")
            print(block)

    print("pipeline done for %s" % args.name)


if __name__ == "__main__":
    main()

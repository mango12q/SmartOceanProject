#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""自检脚本：验证流水线各接口与线上数据一致性（无需传中文参数）。

  python3 selftest.py [--auto]

--auto 额外运行 WRF 自动路径提取（建议先只跑少量时次验证接口）。
"""
import argparse
import json
import os
import shutil
import tempfile

import build_registry
import extract_track
import process_wind
import verify_assets


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--auto", action="store_true")
    ap.add_argument("--auto-full", action="store_true",
                    help="自动提取完整 t=125~249 并对比已知路径（含登陆后涡度尾段）")
    args = ap.parse_args()

    with open("typhoons.json", "r", encoding="utf-8") as f:
        conf = json.load(f)
    names = list(conf["typhoons"].keys())
    tmp = tempfile.mkdtemp(prefix="typhoon_selftest_")
    try:
        # 1. 文件模式路径提取 + 校验（对每个台风）
        for name in names:
            cfg = conf["typhoons"][name]
            tc = cfg.get("track", {})
            pts = extract_track.load_track_file(tc["file"])
            pts = extract_track.clean_points(
                pts,
                track_from_t=tc.get("track_from_t"),
                track_to_t=tc.get("track_to_t"),
                interpolate=tc.get("interpolate_gaps", True),
                max_jump_deg=tc.get("max_jump_deg", 2.0)
            )
            out = os.path.join(tmp, name, "track.json")
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, "w", encoding="utf-8") as f:
                json.dump(pts, f, ensure_ascii=False)
            verify_assets.verify_track(out)
            print("[selftest] %s 文件模式路径 OK：%d 点" % (name, len(pts)))

        # 2. 风场单时次处理 + 与服务器现有 bin 逐字节对比
        name0 = names[0]
        cfg0 = conf["typhoons"][name0]
        wind_tmp = os.path.join(tmp, name0, "wind_field")
        process_wind.process(cfg0, cfg0["wrf_file"], wind_tmp, only_t=200)
        verify_assets.verify_wind(wind_tmp, [200, 200],
                                  reference="/home/haike/test_web/wind_field")
        print("[selftest] 风场单时次处理与线上 bin 逐字节一致 OK")

        # 3. 校验线上全部 264 个 bin 可解码且格式正确
        verify_assets.verify_wind("/home/haike/test_web/wind_field", [0, 263])
        print("[selftest] 线上 wind_field 264 个 bin 全部通过")

        # 4. 注册表生成
        block = build_registry.build_block(conf, tmp)
        assert "AUTO:TYPHOON_DATA:START" in block
        assert "var TYPHOON_DATA" in block
        print("[selftest] 注册表生成 OK（%d 字符）" % len(block))
        # 4b. 自动刻度：无 ticks 配置时应自动生成 生成/巅峰/登陆/消散
        track0 = extract_track.load_track_file(conf["typhoons"][name0]["track"]["file"])
        ticks = build_registry.derive_ticks(track0, {"landfall_t": 225})
        labels = [t["label"] for t in ticks]
        assert labels == ["生成", "巅峰", "登陆", "消散"], labels
        print("[selftest] 自动刻度（含登陆）OK：%s" % labels)

        # 5.（可选）WRF 自动路径提取接口
        if args.auto:
            t_end = 249 if args.auto_full else 140
            auto_cfg = {
                "track": {
                    "source": "auto",
                    "ocean_hgt_max": 0.0,
                    "land_hgt_max": 0.0,
                    "tail_box": {"lat_min": 20, "lat_max": 23,
                                 "lon_min": 107, "lon_max": 111},
                    "track_from_t": 125,
                    "track_to_t": 249,
                    "interpolate_gaps": True,
                    "max_jump_deg": 2.0
                }
            }
            auto, auto_meta = extract_track.extract_auto(
                auto_cfg, cfg0["wrf_file"], t_start=125, t_end=t_end)
            known = extract_track.load_track_file(cfg0["track"]["file"])
            print("[selftest] 自动识别登陆时次：t=%s（已知刻度 t=225）" % auto_meta["landfall_t"])
            kmap = {p["t"]: p for p in known}
            same = sum(
                1 for p in auto
                if p["t"] in kmap and
                abs(p["lat"] - kmap[p["t"]]["lat"]) < 0.01 and
                abs(p["lon"] - kmap[p["t"]]["lon"]) < 0.01
            )
            print("[selftest] 自动路径提取 OK：%d 点（t=125~%d），与已知路径坐标一致 %d/%d" % (
                len(auto), t_end, same, len(auto)))
            print("[selftest] 样例：%s" % json.dumps(auto[:3], ensure_ascii=False))
            if args.auto_full:
                with open("out_auto_huajiasha.json", "w", encoding="utf-8") as f:
                    json.dump(auto, f, ensure_ascii=False, indent=1)
                print("[selftest] 自动路径已写入 out_auto_huajiasha.json")

        print("[selftest] ALL PASS")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()

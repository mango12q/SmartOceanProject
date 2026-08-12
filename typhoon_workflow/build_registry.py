#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""根据 typhoons.json + 各台风 track.json 生成网页 TYPHOON_DATA 注册表 JS。

用法：
  python build_registry.py --config typhoons.json --out out            # 打印注册表
  python build_registry.py --config typhoons.json --out out --patch-index ../index.html

--patch-index 会替换 index.html 中以下两个标记之间的内容：
  // === AUTO:TYPHOON_DATA:START ===
  // === AUTO:TYPHOON_DATA:END ===
"""
import argparse
import json
import os
import re

START_MARKER = "// === AUTO:TYPHOON_DATA:START ==="
END_MARKER = "// === AUTO:TYPHOON_DATA:END ==="


def derive_ticks(track, meta=None):
    """自动生成 生成/巅峰/登陆（如可识别）/消散 四个刻度，按 t 排序。"""
    t_peak = min(track, key=lambda p: p["psfc"])  # 最低气压时刻 = 巅峰
    ticks = [
        {"t": track[0]["t"], "label": "生成", "major": True},
        {"t": t_peak["t"], "label": "巅峰", "major": True}
    ]
    if meta and meta.get("landfall_t") is not None:
        lt = meta["landfall_t"]
        if track[0]["t"] < lt < track[-1]["t"]:
            ticks.append({"t": lt, "label": "登陆", "major": True})
    ticks.append({"t": track[-1]["t"], "label": "消散", "major": True})
    return sorted(ticks, key=lambda x: x["t"])


def load_meta(out_dir, cfg):
    meta_path = os.path.join(out_dir, cfg["name"], "track_meta.json")
    if os.path.exists(meta_path):
        with open(meta_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def resolve_track_path(conf, cfg, out_dir):
    """优先取流水线输出 out/<name>/track.json，否则取 manifest 指定的 track 文件。"""
    out_track = os.path.join(out_dir, cfg["name"], "track.json")
    if os.path.exists(out_track):
        return out_track
    track_cfg = cfg.get("track", {})
    if track_cfg.get("source") == "file" and os.path.exists(track_cfg["file"]):
        return track_cfg["file"]
    return out_track


def build_block(conf, out_dir):
    lines = []
    lines.append("        " + START_MARKER)
    lines.append("        var TYPHOON_DATA = {")
    names = list(conf["typhoons"].keys())
    for idx, name in enumerate(names):
        cfg = conf["typhoons"][name]
        with open(resolve_track_path(conf, cfg, out_dir), "r", encoding="utf-8") as f:
            track = json.load(f)
        meta = load_meta(out_dir, cfg)
        ticks = cfg.get("ticks") or derive_ticks(track, meta)
        start = cfg["start"]
        min_t = cfg.get("slider_min_t", track[0]["t"])
        max_t = cfg.get("slider_max_t", track[-1]["t"])
        default_t = cfg.get("default_t", track[0]["t"])
        wind_dir = cfg.get("wind_dir", "")
        lines.append("            '%s': {" % name)
        lines.append("                start: new Date('%s')," % start)
        lines.append("                minT: %s, maxT: %s, defaultT: %s," % (min_t, max_t, default_t))
        lines.append("                ticks: [")
        for t in ticks:
            major = "true" if t.get("major") else "false"
            lines.append("                    { t: %s, label: '%s', major: %s }," % (t["t"], t["label"], major))
        lines.append("                ],")
        lines.append("                windDir: '%s'," % wind_dir)
        track_js = json.dumps(track, ensure_ascii=False, separators=(",", ":"))
        lines.append("                track: %s" % track_js)
        lines.append("            }" + ("," if idx < len(names) - 1 else ""))
    lines.append("        };")
    lines.append("        " + END_MARKER)
    return "\n".join(lines)


def patch_index(path, block):
    with open(path, "r", encoding="utf-8") as f:
        html = f.read()
    if START_MARKER not in html or END_MARKER not in html:
        raise RuntimeError("index.html 中缺少自动更新标记（%s / %s）" % (START_MARKER, END_MARKER))
    pattern = re.escape(START_MARKER) + ".*?" + re.escape(END_MARKER)
    html = re.sub(pattern, block, html, flags=re.S)
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    return path


def main():
    ap = argparse.ArgumentParser(description="生成 TYPHOON_DATA 注册表 JS")
    ap.add_argument("--config", default="typhoons.json")
    ap.add_argument("--out", default="out")
    ap.add_argument("--patch-index", help="index.html 路径（自动替换注册表）")
    args = ap.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        conf = json.load(f)
    block = build_block(conf, args.out)
    if args.patch_index:
        path = patch_index(args.patch_index, block)
        print("Patched %s" % path)
    else:
        print(block)


if __name__ == "__main__":
    main()

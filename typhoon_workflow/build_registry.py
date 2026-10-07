#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""根据 typhoons.json + 各台风 track.json 生成网页 TYPHOON_DATA 注册表 JS。

用法：
  python build_registry.py --config typhoons.json --out out            # 打印注册表
  python build_registry.py --config typhoons.json --out out --patch-index ../index.html

路径解析：`--out` 与 typhoons.json 里的 `track.file`（如 data/山竹.track.json）都相对
**`--config` 文件所在目录**解析（绝对路径原样使用）。因此从仓库根目录运行
  python typhoon_workflow/build_registry.py --config typhoon_workflow/typhoons.json
与在 typhoon_workflow/ 目录内直接运行结果一致；找不到文件时给出可排查的报错。

--patch-index 会替换 index.html 中以下两个标记之间的内容。读写均用 newline=""
（不做通用换行转换），因此不会改动 index.html 原有行尾 —— 若把整份文件的
CRLF/LF 统一，会破坏 `python mobile/build.py --check`（它要求内联块是 LF）：
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


def resolve_under_config(path, config_dir):
    """把（相对）路径按 --config 文件所在目录解析；绝对路径原样返回。"""
    if not path or not config_dir or os.path.isabs(path):
        return path
    return os.path.normpath(os.path.join(config_dir, path))


def resolve_track_path(conf, cfg, out_dir, config_dir=None):
    """优先取流水线输出 <out>/<name>/track.json，否则取 manifest 指定的 track 文件。

    out_dir 与 track.file 都相对 --config 文件所在目录解析（见 resolve_under_config）：
    仓库里 typhoons.json 与 data/*.track.json 是同级关系，按 config 目录解析后，
    从任何工作目录调用结果都一致（原先按 cwd 解析，从仓库根目录跑就会找不到）。

    两种情况都找不到时抛出带排查提示的 FileNotFoundError，
    而不是一个只有路径、看不出所以然的报错。
    """
    name = cfg.get("name") or "?"
    out_track = os.path.join(out_dir, cfg["name"], "track.json")
    if os.path.exists(out_track):
        return out_track
    track_cfg = cfg.get("track", {})
    if track_cfg.get("source") == "file":
        raw = track_cfg.get("file")
        if raw:
            path = resolve_under_config(raw, config_dir)
            if os.path.exists(path):
                return path
            raise FileNotFoundError(
                "台风「%s」的 track 文件不存在：%s\n"
                "  typhoons.json 里 track.file = %r，按 --config 所在目录解析为上面这个路径。\n"
                "  请检查：1) 该文件是否已在本地；2) track.file 是否写错；"
                "3) --config 是否指向正确的 typhoons.json。" % (name, path, raw))
        raise FileNotFoundError(
            "台风「%s」的 track.source = \"file\"，但 typhoons.json 里没有给出 track.file。" % name)
    raise FileNotFoundError(
        "台风「%s」找不到轨迹数据：\n"
        "  - 期望的流水线产物：%s（不存在）\n"
        "  - typhoons.json 里 track.source = %r（不是 \"file\"）\n"
        "  请先运行 run_pipeline.py 生成该产物，或把 track.source 设为 \"file\" "
        "并在 track.file 里给出源轨迹文件。" % (name, out_track, track_cfg.get("source")))


def build_block(conf, out_dir, config_dir=None):
    lines = []
    lines.append("        " + START_MARKER)
    lines.append("        var TYPHOON_DATA = {")
    names = list(conf["typhoons"].keys())
    for idx, name in enumerate(names):
        cfg = conf["typhoons"][name]
        with open(resolve_track_path(conf, cfg, out_dir, config_dir), "r", encoding="utf-8") as f:
            track = json.load(f)
        meta = load_meta(out_dir, cfg)
        ticks = cfg.get("ticks") or derive_ticks(track, meta)
        start = cfg["start"]
        min_t = cfg.get("slider_min_t", track[0]["t"])
        max_t = cfg.get("slider_max_t", track[-1]["t"])
        default_t = cfg.get("default_t", track[0]["t"])
        wind_dir = cfg.get("wind_dir", "")
        wind_dir_corrected = cfg.get("wind_dir_corrected", "")
        lines.append("            '%s': {" % name)
        lines.append("                start: new Date('%s')," % start)
        lines.append("                minT: %s, maxT: %s, defaultT: %s," % (min_t, max_t, default_t))
        lines.append("                ticks: [")
        for t in ticks:
            major = "true" if t.get("major") else "false"
            lines.append("                    { t: %s, label: '%s', major: %s }," % (t["t"], t["label"], major))
        lines.append("                ],")
        lines.append("                windDir: '%s'," % wind_dir)
        lines.append("                windDirCorrected: '%s'," % wind_dir_corrected)
        track_js = json.dumps(track, ensure_ascii=False, separators=(",", ":"))
        lines.append("                track: %s" % track_js)
        lines.append("            }" + ("," if idx < len(names) - 1 else ""))
    lines.append("        };")
    lines.append("        " + END_MARKER)
    return "\n".join(lines)


def detect_newline(html):
    """探测 html 的行尾风格：优先取 START 标记所在行的行尾，其次看全文哪种更多。

    build_block() 用 "\n" 拼数据块；把它直接塞进一份 CRLF 文件，就会得到
    「一半 CRLF、一半 LF」的混合行尾。这里按目标文件已有风格统一。
    （仓库里的 index.html 实测是纯 LF：0 个 CRLF / 10437 个 LF。）
    """
    pos = html.find(START_MARKER)
    if pos != -1:
        eol = html.find("\n", pos)
        if eol > 0:
            return "\r\n" if html[eol - 1] == "\r" else "\n"
    crlf = html.count("\r\n")
    return "\r\n" if crlf * 2 > html.count("\n") else "\n"


def patch_index(path, block):
    # newline="" 读写，不做通用换行转换。用默认的 newline=None 时：
    # 读进来 CRLF 被统一成 "\n"，写回去又在 Windows 上按 os.linesep 全部展开成 CRLF，
    # 于是整份 index.html（约 615KB）的行尾被统一成 CRLF，
    # 直接破坏 `python mobile/build.py --check`（该检查要求内联块是 LF）。
    with open(path, "r", encoding="utf-8", newline="") as f:
        html = f.read()
    if START_MARKER not in html or END_MARKER not in html:
        raise RuntimeError("index.html 中缺少自动更新标记（%s / %s）" % (START_MARKER, END_MARKER))
    pattern = re.escape(START_MARKER) + ".*?" + re.escape(END_MARKER)
    # 注入块的行尾跟随目标文件，保证整份文件行尾风格统一（不产生混合行尾）
    eol = detect_newline(html)
    block = block.replace("\r\n", "\n").replace("\n", eol)
    # 必须用 lambda 返回替换内容：re.sub 会把字符串形式的替换串当模板，
    # 解析其中的反斜杠转义 —— 数据块里一旦出现 "\1"、"\g<name>" 或裸反斜杠，
    # 就会报 invalid group reference 或悄悄替换成别的内容。
    html = re.sub(pattern, lambda m: block, html, flags=re.S)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(html)
    return path


def main():
    ap = argparse.ArgumentParser(description="生成 TYPHOON_DATA 注册表 JS")
    ap.add_argument("--config", default="typhoons.json")
    ap.add_argument("--out", default="out")
    ap.add_argument("--patch-index", help="index.html 路径（自动替换注册表）")
    args = ap.parse_args()

    if not os.path.exists(args.config):
        raise FileNotFoundError(
            "--config 指定的文件不存在：%s\n"
            "  提示：typhoons.json 在 typhoon_workflow/ 下，"
            "从仓库根目录运行请写 --config typhoon_workflow/typhoons.json。" % args.config)
    config_dir = os.path.dirname(os.path.abspath(args.config))
    # --out 与 manifest 里的 track.file 都相对 config 目录解析，
    # 这样「从仓库根目录跑」与「在 typhoon_workflow/ 里跑」结果一致（绝对路径不受影响）。
    out_dir = resolve_under_config(args.out, config_dir)
    with open(args.config, "r", encoding="utf-8") as f:
        conf = json.load(f)
    block = build_block(conf, out_dir, config_dir)
    if args.patch_index:
        path = patch_index(args.patch_index, block)
        print("Patched %s" % path)
    else:
        print(block)


if __name__ == "__main__":
    main()

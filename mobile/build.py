#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build.py — 把 mobile/ 下的模块化源码内联进 index.html（离线单文件交付）

为什么需要它：
  index.html 是 4500+ 行的离线单文件（线上直接托管，不允许外部依赖）。
  移动端升级的 CSS/JS 若直接手工粘贴进主文件，后续无法维护、也无法单独测试。
  因此源码维护在 mobile/ 下，由本脚本内联到固定标记之间。

幂等：重复运行结果完全一致（通过标记块定位删除后重建）。

用法：
  python mobile/build.py            # 内联
  python mobile/build.py --check    # 只检查 index.html 是否与 mobile/ 源码一致（不写文件）

内联产物顺序（都在主 module script 之前）：
  1) i18n-dict.js + i18n.js -> window.__I18N_DICT / window.I18N（中英双语层）
  2) qr-encoder.js  -> window.QRCode
  3) qr-popup.js    -> 使用 QRCode 渲染模态框
  4) mobile-ui.js   -> 手机端交互层（等 __mainReady 后搬节点）
"""

import argparse
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "index.html")
MOBILE = os.path.join(ROOT, "mobile")

I18N_MARK = "/* === I18N:JS:BEGIN === */"
I18N_END = "/* === I18N:JS:END === */"
QR_MARK = "/* === QR:JS:BEGIN === */"
QR_END = "/* === QR:JS:END === */"
MUI_MARK = "/* === MOBILE:JS:BEGIN === */"
MUI_END = "/* === MOBILE:JS:END === */"
CSS_MARK = "/* === MOBILE:CSS:BEGIN === */"
CSS_END = "/* === MOBILE:CSS:END === */"

HTML_I18N_MARK = "<!-- === I18N:JS:BEGIN === -->"
HTML_QR_MARK = "<!-- === QR:JS:BEGIN === -->"
HTML_QR_END = "<!-- === QR:JS:END === -->"
HTML_MUI_MARK = "<!-- === MOBILE:JS:BEGIN === -->"
HTML_MUI_END = "<!-- === MOBILE:JS:END === -->"
HTML_CSS_MARK = "<!-- === MOBILE:CSS === -->"

# 需要内联的源码（顺序即内联顺序）；--check 也会逐个报告字节数
SOURCES = ("i18n-dict.js", "i18n.js", "qr-encoder.js", "qr-popup.js", "mobile-ui.js", "mobile.css")

# 缩进：与 index.html 现有 <script> 标签保持一致（8 空格）
IND = " " * 8


def slurp(name):
    path = os.path.join(MOBILE, name)
    with io.open(path, "r", encoding="utf-8") as f:
        return f.read().rstrip("\n")


def block_body(inner):
    """内联脚本正文：转义 </script，避免提前闭合标签。"""
    return inner.replace("</script", "<\\/script")


def normalize_block(html, js_begin, js_end):
    """把某个内联块区域的「外壳」归一化，消除历史缩进漂移。

    区域定义：从 js_begin 之前连续的 <script> 行中的**第一行**，
              到 js_end 之后第一个 </script> 行。
    归一化后：恰好 4 行外壳（<script> / begin / end / </script>），内容清空待填。
    这样无论历史上被叠加过多少层缩进或孤立标签，跑一次就回到规范形态。
    """
    i = html.find(js_begin)
    if i < 0:
        raise SystemExit("标记缺失: %s" % js_begin)
    s = html.rfind("\n", 0, i) + 1                       # 标记所在行首
    # 向上吞掉连续的 <script> 行（可能多行、缩进各异）
    while True:
        p = html.rfind("\n", 0, s - 1) + 1
        line = html[p:s].strip()
        if line == "<script>":
            s = p
        else:
            break
    j = html.find(js_end, i)
    if j < 0:
        raise SystemExit("结束标记缺失: %s" % js_end)
    j = html.find("</script>", j)
    if j < 0:
        raise SystemExit("结束标记后找不到 </script>: %s" % js_end)
    j += len("</script>")
    nl = "\r\n" if html.startswith("\r\n", j - 2) or "\r\n" in html[:400] else "\n"
    shell = nl.join([IND + "<script>", IND + js_begin, IND + js_end, IND + "</script>"])
    return html[:s] + shell + html[j:]


def fill_block(html, js_begin, js_end, payload):
    """在已归一化的外壳里填入内容（把 begin..end 两行之间替换为内容行）。"""
    i = html.find(js_begin)
    j = html.find(js_end, i)
    if i < 0 or j < 0:
        raise SystemExit("块未归一化: %s" % js_begin)
    nl = "\r\n" if "\r\n" in html[:400] else "\n"
    body = payload.replace("\n", nl)
    return html[:i + len(js_begin)] + nl + body + nl + html[j:]


def build(html):
    # 保留原文件的 UTF-8 BOM（index.html 本来就有；丢掉会造成无谓的整文件 diff）
    bom = "\ufeff" if html.startswith("\ufeff") else ""
    if bom:
        html = html[1:]

    qr = slurp("qr-encoder.js")
    popup = slurp("qr-popup.js")
    mui = slurp("mobile-ui.js")
    css = slurp("mobile.css")
    i18n_dict = slurp("i18n-dict.js")
    i18n = slurp("i18n.js")

    # 0) 双语层（词表在前，引擎在后；两者都在主 module 之前 → 主逻辑能直接调 I18N.t）
    html = normalize_block(html, I18N_MARK, I18N_END)
    html = fill_block(html, I18N_MARK, I18N_END, block_body(i18n_dict + "\n\n" + i18n))

    # 1) QR 组件块（编码器 + 弹窗）：先归一化外壳，再填内容
    html = normalize_block(html, QR_MARK, QR_END)
    html = fill_block(html, QR_MARK, QR_END, block_body(qr + "\n\n" + popup))

    # 2) 移动端交互层
    html = normalize_block(html, MUI_MARK, MUI_END)
    html = fill_block(html, MUI_MARK, MUI_END, block_body(mui))

    # 3) 移动端样式：独立 <style> 块，插在锚点注释与 </head> 之间。
    #    ★ 必须留在 <head> 内：实测放在 <body> 里的 <style> 在 Chrome 中不生效
    #      （症状：dock 的 .md-clock 完全没有样式、内联 SVG 撑满整屏）。
    #    ★ index.html 用 CRLF 行尾，所有搜索必须与换行符无关。
    anchor = "    " + HTML_CSS_MARK
    a = html.find(anchor)
    if a < 0:
        raise SystemExit("标记缺失: %s" % anchor)
    head_end = html.find("</head>", a)
    if head_end < 0:
        raise SystemExit("锚点之后找不到 </head>")
    nl = "\r\n" if "\r\n" in html[:400] else "\n"
    css_block = nl.join([
        anchor,
        "    <style>",
        CSS_MARK,
        css,
        CSS_END,
        "    </style>",
        "",
    ])
    html = html[:a] + css_block + html[head_end:]

    return bom + html


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验是否已同步")
    args = ap.parse_args()

    with io.open(INDEX, "r", encoding="utf-8", newline="") as f:
        original = f.read()
    built = build(original)

    # 统计
    sizes = {n: len(slurp(n)) for n in SOURCES}

    if args.check:
        if built == original:
            print("[ok] index.html 已与 mobile/ 源码同步")
            for k, v in sizes.items():
                print("     %-18s %6d 字节" % (k, v))
            return 0
        print("[!!] index.html 与 mobile/ 源码不一致，请运行: python mobile/build.py")
        return 1

    with io.open(INDEX, "w", encoding="utf-8", newline="") as f:
        f.write(built)
    print("[ok] 已内联 -> index.html")
    for k, v in sizes.items():
        print("     %-18s %6d 字节" % (k, v))
    print("     index.html         %6d 行" % built.count("\n"))
    return 0


if __name__ == "__main__":
    sys.exit(main())

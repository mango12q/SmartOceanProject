#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
unbuild.py — build.py 的逆操作：把 index.html 里的内联块拆回 mobile/ 源码

什么时候需要它：
  线上（或任何地方）直接改了 index.html 这个「构建产物」之后，mobile/ 源码就落后了。
  此时若直接跑 build.py，会拿旧源码整段覆盖回去，把线上改动全部抹掉。
  先用本脚本把产物拆回源码，再跑 build.py，两边才重新一致。

覆盖的块（与 build.py 的标记一一对应）：
  I18N:JS   -> i18n-dict.js + i18n.js   （按 build.py 的 "\n\n" 分隔符拆开）
  QR:JS     -> qr-encoder.js + qr-popup.js
  MOBILE:JS -> mobile-ui.js
  MOBILE:CSS-> mobile.css

特别处理 MOBILE:CSS：
  build.py 把「<!-- === MOBILE:CSS === --> 到 </head>」之间的内容整段替换，
  因此历史上有过「额外 CSS 被追加在 MOBILE:CSS:END 标记之后」的情况 —— 那段不在
  任何标记块内，一跑 build.py 就会丢。本脚本会把它折回 mobile.css（放在 END 标记
  之内），CSS 顺序不变，等效。

用法：
  python mobile/unbuild.py           # 拆回 mobile/ 源码
  python mobile/unbuild.py --check   # 只报告差异，不写文件
"""

import argparse
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "index.html")
MOBILE = os.path.join(ROOT, "mobile")

B = "/* === %s === */"
I18N_MARK, I18N_END = B % "I18N:JS:BEGIN", B % "I18N:JS:END"
QR_MARK, QR_END = B % "QR:JS:BEGIN", B % "QR:JS:END"
MUI_MARK, MUI_END = B % "MOBILE:JS:BEGIN", B % "MOBILE:JS:END"
CSS_MARK, CSS_END = B % "MOBILE:CSS:BEGIN", B % "MOBILE:CSS:END"

# (块名, 开始标记, 结束标记, [(输出文件, 定位锚点)])
# 锚点 = 该块内拼接第二个文件时使用 "\n\n" 之后紧跟的特征串；None 表示整块即该文件。
GROUPS = [
    ("I18N:JS", I18N_MARK, I18N_END, [
        ("i18n-dict.js", None),
        ("i18n.js", "i18n.js"),
    ]),
    ("QR:JS", QR_MARK, QR_END, [
        ("qr-encoder.js", None),
        ("qr-popup.js", "qr-popup.js"),
    ]),
    ("MOBILE:JS", MUI_MARK, MUI_END, [
        ("mobile-ui.js", None),
    ]),
]

problems = []


def extract(html, begin, end, what):
    i = html.find(begin)
    if i < 0:
        problems.append("标记缺失: %s" % begin)
        return None
    j = html.find(end, i)
    if j < 0:
        problems.append("结束标记缺失: %s (%s)" % (end, what))
        return None
    body = html[i + len(begin):j]
    # 反做 build.py 的两步：行尾归一 + </script 转义
    return body.replace("\r\n", "\n").strip("\n").replace("<\\/script", "</script")


def split_head(block, needle, name):
    """在 block 里找 build.py 用的 "\\n\\n" 分隔符，其后应紧跟第二个文件的文件头。"""
    cands = []
    k = -1
    while True:
        k = block.find("\n\n", k + 1)
        if k < 0:
            break
        tail = block[k + 2:k + 2 + 300]
        if tail.lstrip().startswith("/*") and needle in tail:
            cands.append(k)
    if not cands:
        problems.append("%s: 找不到分界锚点（%s），无法安全拆分" % (name, needle))
        return None, None
    if len(cands) > 1:
        problems.append("%s: 分界锚点不唯一（%d 处），无法安全拆分" % (name, len(cands)))
        return None, None
    k = cands[0]
    first, second = block[:k], block[k + 2:]
    if first + "\n\n" + second != block:
        problems.append("%s: 拆分后重组不一致" % name)
        return None, None
    return first, second


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只报告差异，不写文件")
    args = ap.parse_args()

    with io.open(INDEX, "r", encoding="utf-8", newline="") as f:
        html = f.read()

    planned = []      # (文件名, 新内容)
    report = []

    for gname, b, e, files in GROUPS:
        block = extract(html, b, e, gname)
        if block is None:
            continue
        if len(files) == 1:
            parts = [(files[0][0], block)]
        else:
            first, second = split_head(block, files[1][1], gname)
            if first is None:
                continue
            parts = [(files[0][0], first), (files[1][0], second)]
        report.append("  [%-9s] 块 %6d 字节 -> %s" % (
            gname, len(block.encode("utf-8")),
            ", ".join("%s(%d)" % (n, len(c.encode("utf-8"))) for n, c in parts)))
        planned.extend(parts)

    # ---- MOBILE:CSS：块内容 + END 标记之后被追加的 CSS ----
    css = extract(html, CSS_MARK, CSS_END, "MOBILE:CSS")
    if css is not None:
        i = html.find(CSS_END)
        sc = html.find("</style>", i)
        extra = html[i + len(CSS_END):sc] if sc > 0 else ""
        # 归一为 LF：mobile/ 下所有源码都是 LF，index.html 是 CRLF。
        # 不归一的话折进来的这段会带 CRLF，磁盘文件与 index.html 内联块不一致，
        # 本脚本的 --check 就不再幂等（build.py 因为用 universal newlines 读文件，
        # 反而看不出来）。
        extra_body = extra.replace("\r\n", "\n").lstrip("\n").rstrip()
        if extra_body:
            report.append("  [MOBILE:CSS] 块 %6d 字节 + END 标记后追加 %d 字节 = %d" % (
                len(css.encode("utf-8")), len(extra_body.encode("utf-8")),
                len((css.rstrip("\n") + "\n\n" + extra_body).encode("utf-8"))))
            report.append("               ^ 这 %d 行在标记块之外，build.py 会整段删除，已折回 mobile.css"
                          % extra_body.count("\n"))
            css = css.rstrip("\n") + "\n\n" + extra_body
        else:
            report.append("  [MOBILE:CSS] 块 %6d 字节（标记外无追加内容）" % len(css.encode("utf-8")))
        planned.append(("mobile.css", css))

    print("从 %s 反向拆分：" % os.path.relpath(INDEX, ROOT).replace("\\", "/"))
    for line in report:
        print(line)

    if problems:
        print("\n[!!] 无法完成拆分：")
        for p in problems:
            print("     " + p)
        return 2

    changed = []
    for name, new in planned:
        path = os.path.join(MOBILE, name)
        old = ""
        if os.path.exists(path):
            with io.open(path, "r", encoding="utf-8", newline="") as f:
                old = f.read()
        if old == new:
            print("     %-16s 已一致（%d 字节）" % (name, len(new.encode("utf-8"))))
        else:
            changed.append(name)
            print("     %-16s %d -> %d 字节  %s" % (
                name, len(old.encode("utf-8")), len(new.encode("utf-8")),
                "（跳过写入）" if args.check else "已更新"))
            if not args.check:
                with io.open(path, "w", encoding="utf-8", newline="") as f:
                    f.write(new)

    if args.check:
        if changed:
            print("\n[!!] mobile/ 有 %d 个文件与 index.html 不一致，请运行: python mobile/unbuild.py"
                  % len(changed))
            return 1
        print("\n[ok] mobile/ 源码与 index.html 已一致")
        return 0

    if changed:
        print("\n[ok] 已拆回 %d 个文件。接着请运行: python mobile/build.py  然后 python mobile/build.py --check"
              % len(changed))
    else:
        print("\n[ok] 无需改动")
    return 0


if __name__ == "__main__":
    sys.exit(main())

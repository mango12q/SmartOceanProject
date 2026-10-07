#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tile_proxy.py 静态黑名单回归测试（双向断言，exit 0/1）。

背景：2026-10-07 实测线上 /data/convert_simplify%2epy 返回 200 + Python 源码全文 ——
do_GET 用 urlparse().path 的 basename 匹配 DENY_RE（不解码），而 translate_path 会解码，
于是 %2e 绕过黑名单。同时 /data/ /tiles/ /vendor/ /wind_field/ 都在 200 列目录。

本测试既断言「绕过路径必须 404」，也断言「正常资产必须 200」，防止修过头。
用法: python .dev/check-tileproxy-deny.py        # 读完 0
"""
import importlib.util
import os
import shutil
import sys
import tempfile
import threading
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 18897
FAKE_PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 256

spec = importlib.util.spec_from_file_location("tp", os.path.join(ROOT, "tile_proxy.py"))
tp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tp)                    # __name__ != "__main__"，不会启动 main()
tp.Handler._fetch = lambda self, layer, z, x, y, retina: FAKE_PNG   # 不出网

WEB = tempfile.mkdtemp(prefix="denytest_")
tp.WEB_ROOT = WEB
tp.CACHE_DIR = os.path.join(WEB, "tiles")
tp.TDT_KEY = ""


def put(rel, text):
    p = os.path.join(WEB, rel.replace("/", os.sep))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)


put("index.html", "<!DOCTYPE html><title>ok</title>")
put("ok.txt", "plain asset\n")
put("sub/ok2.txt", "nested asset\n")                 # 目录内有文件但**没有** index.html
put("data/countries-50m.json", '{"type":"Topology"}')
put("data/convert_simplify.py", "TDT_KEY = 'LEAKED'\n")   # 诱饵：绝不能被下载
put("index.html.bak-20260930", "backup\n")                # 诱饵：绝不能被下载
put("wind_field/wind_field_0000.bin", "BIN")

srv = tp.ThreadingHTTPServer(("127.0.0.1", PORT), tp.Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

# (path, 期望状态码, 说明)
CASES = [
    # ---- 正常资产：必须仍然 200（防止修过头）----
    ("/", 200, "根路径 → index.html"),
    ("/ok.txt", 200, "普通静态文件"),
    ("/sub/ok2.txt", 200, "子目录静态文件"),
    ("/data/countries-50m.json", 200, "页面依赖的陆地掩膜"),
    ("/wind_field/wind_field_0000.bin", 200, "风场 bin"),
    ("/tiles/satellite/7/105/52.png", 200, "瓦片分支未被误伤"),
    # ---- 目录列表：必须关闭 ----
    ("/data/", 404, "目录列表（曾 200 列出 convert_simplify.py）"),
    ("/tiles/", 404, "目录列表"),
    ("/sub/", 404, "目录列表（无 index.html 的目录）"),
    # ---- 黑名单：明文路径 ----
    ("/tile_proxy.py", 404, "源码明文"),
    ("/data/convert_simplify.py", 404, "站点内源码明文"),
    ("/index.html.bak-20260930", 404, "备份明文"),
    # ---- 黑名单：percent-encoding 绕过（本次修复的核心）----
    ("/tile_proxy%2epy", 404, "小写 %2e 绕过"),
    ("/tile_proxy%2Epy", 404, "大写 %2E 绕过"),
    ("/data/convert_simplify%2epy", 404, "线上实测泄漏路径"),
    ("/data/convert_simplify%2Epy", 404, "大写变体"),
    ("/index.html%2ebak-20260930", 404, "备份 %2e 绕过"),
    ("/ok%2etxt", 200, "合法 .txt 用 %2e 编码后仍应可下载（未被过度拦截）"),
    # ---- 路径穿越 ----
    ("/%2e%2e/%2e%2e/etc/passwd", 404, "编码路径穿越"),
    ("/../tile_proxy.py", 404, "明文路径穿越"),
]


def probe(path):
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d%s" % (PORT, path), timeout=8) as r:
            return r.status, r.read(64)
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception:
        return 0, b""


fails = []
print("%-42s %-5s %-5s %s" % ("请求路径", "期望", "实际", "说明"))
print("-" * 92)
for path, want, desc in CASES:
    got, body = probe(path)
    ok = got == want
    if not ok:
        fails.append((path, want, got, desc))
    extra = ""
    if got == 200 and b"LEAKED" in body:
        extra = "  <<< 源码泄漏!"
        if path not in [f[0] for f in fails]:
            fails.append((path, want, got, desc + " 源码泄漏"))
    print("%-42s %-5s %-5s %s%s" % (path, want, got, desc, extra))

srv.shutdown()
shutil.rmtree(WEB, ignore_errors=True)

print("-" * 92)
if fails:
    print("失败 %d 项：" % len(fails))
    for p, want, got, desc in fails:
        print("  %-42s 期望 %s 实际 %s  (%s)" % (p, want, got, desc))
    sys.exit(1)
print("ALL GREEN：%d 项断言全部通过（绕过已封死，正常资产未误伤）" % len(CASES))

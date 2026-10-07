#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""线上验收（只读 GET，带断言，exit 0/1）。

覆盖 2026-10-07 两批改动：
  A. P0 加固：静态黑名单先 percent-decode 再匹配 + 关闭目录列表
  B. 性能/协议：gzip、HTTP/1.1 keep-alive、304、资产未误伤
既验「绕过硬封死 / 性能生效」，也验「线上资产没被误伤」
（含一张天地图瓦片 —— 只有 TDT_KEY 还在才拿得到）。

用法: python .dev/verify-live-hardening.py
"""
import gzip
import http.client
import os
import sys

HOST, PORT = "43.154.210.202", 8899
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPECT_INDEX = os.path.getsize(os.path.join(ROOT, "index.html"))

# (路径, 期望状态, 说明)
CASES = [
    # ---- A. 绕过硬封死 ----
    ("/tile_proxy.py", 404, "源码明文"),
    ("/tile_proxy%2epy", 404, "源码 %2e 绕过"),
    ("/tile_proxy%2Epy", 404, "源码 %2E 绕过"),
    ("/data/convert_simplify.py", 404, "线上曾泄漏的源码（明文）"),
    ("/data/convert_simplify%2epy", 404, "线上曾泄漏的源码（%2e，修复前 200）"),
    ("/data/convert_simplify%2Epy", 404, "同上大写变体"),
    ("/index.html.bak", 404, "备份明文"),
    ("/index.html%2ebak", 404, "备份 %2e 绕过"),
    # ---- A. 目录列表关闭 ----
    ("/data/", 404, "目录列表（曾 200 列出 convert_simplify.py）"),
    ("/tiles/", 404, "目录列表"),
    ("/vendor/", 404, "目录列表"),
    ("/wind_field/", 404, "目录列表（曾列 269 项）"),
    # ---- B. 资产必须仍然 200 ----
    ("/", 200, "首页 index.html"),
    ("/data/countries-50m.json", 200, "陆地掩膜"),
    ("/wind_field/wind_field_0135.bin", 200, "风场 bin"),
    ("/wind_field/%E5%B1%B1%E7%AB%B9/wind_field_0200.bin", 200, "山竹风场 bin（子目录）"),
    ("/vendor/leaflet.js", 200, "Leaflet"),
    ("/vendor/leaflet.css", 200, "Leaflet CSS"),
    ("/vendor/topojson-client.min.js", 200, "topojson"),
    ("/vendor/html2canvas.min.js", 200, "html2canvas（现在点击才按需下载）"),
    ("/vendor/msgpack.mjs", 200, "msgpack（importmap 目标）"),
    ("/tiles/satellite/7/104/55.png", 200, "Esri 卫星瓦片（回源上游）"),
    ("/tiles/tdt/7/104/55.png", 200, "天地图瓦片（只有 Key 还在才拿得到）"),
]

fails = []
print("%-46s %-5s %-5s %s" % ("路径", "期望", "实际", "说明"))
print("-" * 100)
for path, want, desc in CASES:
    try:
        c = http.client.HTTPConnection(HOST, PORT, timeout=30)
        c.request("GET", path)
        r = c.getresponse()
        body = r.read()
        got, ctype, n = r.status, r.getheader("Content-Type"), len(body)
        c.close()
    except Exception as e:
        got, ctype, n = 0, repr(e), 0
    if got != want:
        fails.append((path, want, got, desc))
    print("%-46s %-5s %-5s %s %s" % (path, want, got, desc, "  " if got == want else "<<<"))
    if path.startswith("/tiles/") and got == 200:
        print("%-46s        %s %d 字节" % ("", ctype, n))

# ---------------------------------------------------------------- B. 协议/性能
print("-" * 100)
print("性能/协议断言：")


def perf(name, ok, detail=""):
    if not ok:
        fails.append((name, "PASS", "FAIL", detail))
    print("  %-42s %-5s %s" % (name, "PASS" if ok else "FAIL", detail))


def get(path, headers=None, conn=None):
    own = conn is None
    if own:
        conn = http.client.HTTPConnection(HOST, PORT, timeout=30)
    conn.request("GET", path, headers=headers or {})
    r = conn.getresponse()
    body = r.read()
    out = (r.status, dict(r.getheaders()), body, r.version)
    if own:
        conn.close()
    return out


# gzip：首页（615 KB 那一份，走 `/` 目录分支）
st, hd, body, ver = get("/", {"Accept-Encoding": "gzip, deflate"})
ok_gz = (st == 200 and hd.get("Content-Encoding") == "gzip" and len(body) < EXPECT_INDEX
         and len(gzip.decompress(body)) == EXPECT_INDEX)
perf("gzip: `/` 首页压缩且内容无损", ok_gz,
     "原始 %d → gzip %d 字节（省 %.0f%%）" % (EXPECT_INDEX, len(body),
                                             100 * (1 - len(body) / EXPECT_INDEX)))
perf("304: 回访不重传（保留 Last-Modified）",
     get("/", {"Accept-Encoding": "gzip", "If-Modified-Since": hd.get("Last-Modified")})[0] == 304)

st2, hd2, body2, _ = get("/vendor/leaflet.js", {"Accept-Encoding": "gzip"})
perf("gzip: vendor/leaflet.js", st2 == 200 and hd2.get("Content-Encoding") == "gzip"
     and len(gzip.decompress(body2)) == 147552,
     "%d → %d 字节" % (147552, len(body2)))

st3, hd3, body3, _ = get("/", {"Accept-Encoding": "identity"})
perf("无 gzip 客户端: 原样下发", st3 == 200 and "Content-Encoding" not in hd3
     and len(body3) == EXPECT_INDEX, "%d 字节" % len(body3))

conn = http.client.HTTPConnection(HOST, PORT, timeout=30)
a = get("/", {"Accept-Encoding": "identity"}, conn=conn)
b = get("/data/countries-50m.json", conn=conn)
conn.close()
perf("HTTP/1.1 + keep-alive（同连接两次请求）", a[3] == 11 and a[0] == 200 and b[0] == 200,
     "version=1.%d 1st=%s 2nd=%s" % (a[3] - 10, a[0], b[0]))

print("-" * 100)
if fails:
    print("失败 %d 项：" % len(fails))
    for row in fails:
        print("  %s" % (row,))
    sys.exit(1)
print("ALL GREEN：%d 项资产断言 + 5 项性能/协议断言全部通过" % len(CASES))

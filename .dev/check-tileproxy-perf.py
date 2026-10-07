#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tile_proxy.py 性能/协议改动回归（gzip / keep-alive / 304 / single-flight / 唯一 tmp）。

对应 2026-10-07 的四项改动：
  · protocol_version = HTTP/1.1（keep-alive，原先 HTTP/1.0 每瓦片一条 TCP）
  · send_head 走 gzip（保留 Last-Modified + 304）
  · 瓦片 single-flight（实测加之前 8 并发 → 6 次上游）
  · 临时文件唯一名（原先共享 path + ".tmp"）

用法: python .dev/check-tileproxy-perf.py      # 全绿 exit 0
"""
import gzip
import http.client
import importlib.util
import os
import shutil
import sys
import tempfile
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 18896
FAKE_PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 512

spec = importlib.util.spec_from_file_location("tp", os.path.join(ROOT, "tile_proxy.py"))
tp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tp)

CALLS = []
CALL_LOCK = threading.Lock()


def fake_fetch(self, layer, z, x, y, is_retina):
    with CALL_LOCK:
        CALLS.append((layer, z, x, y))
    time.sleep(0.35)                      # 模拟上游耗时，逼出并发窗口
    return FAKE_PNG


tp.Handler._fetch = fake_fetch
tp.FETCH_DELAY = 0.0
tp.WEB_ROOT = tempfile.mkdtemp(prefix="perftest_")
tp.CACHE_DIR = os.path.join(tp.WEB_ROOT, "tiles")
tp.TDT_KEY = ""

RAW_HTML = ("<!DOCTYPE html><title>t</title>\n" + "<!--  filler  -->\n" * 300).encode("utf-8")
with open(os.path.join(tp.WEB_ROOT, "index.html"), "wb") as f:
    f.write(RAW_HTML)
with open(os.path.join(tp.WEB_ROOT, "pic.png"), "wb") as f:
    f.write(FAKE_PNG)
os.makedirs(os.path.join(tp.WEB_ROOT, "data"), exist_ok=True)
with open(os.path.join(tp.WEB_ROOT, "data", "countries-50m.json"), "wb") as f:
    f.write(b'{"a":1}')

srv = tp.ThreadingHTTPServer(("127.0.0.1", PORT), tp.Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print("%-46s %s  %s" % (name, "PASS" if ok else "FAIL", detail))


def get(path, headers=None, conn=None):
    own = conn is None
    if own:
        conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=20)
    conn.request("GET", path, headers=headers or {})
    r = conn.getresponse()
    body = r.read()
    out = (r.status, dict(r.getheaders()), body, r.version)
    if own:
        conn.close()
    return out


# ---- 1. gzip 生效且可正确解压 ----
st, hdrs, body, ver = get("/index.html", {"Accept-Encoding": "gzip, deflate"})
ok = (st == 200 and hdrs.get("Content-Encoding") == "gzip"
      and gzip.decompress(body) == RAW_HTML and len(body) < len(RAW_HTML))
check("gzip: 压缩生效且内容无损", ok,
      "raw=%d gz=%d 省 %.0f%%" % (len(RAW_HTML), len(body), 100 * (1 - len(body) / len(RAW_HTML))))
check("gzip: Vary 头（避免缓存串味）", hdrs.get("Vary") == "Accept-Encoding", repr(hdrs.get("Vary")))
check("html 带 Cache-Control: no-cache", hdrs.get("Cache-Control") == "no-cache", repr(hdrs.get("Cache-Control")))

# ---- 2. 客户端不支持 gzip 时不压 ----
st2, hdrs2, body2, _ = get("/index.html", {"Accept-Encoding": "identity"})
check("无 gzip 客户端: 原样下发", st2 == 200 and "Content-Encoding" not in hdrs2 and body2 == RAW_HTML,
      "len=%d ce=%s" % (len(body2), hdrs2.get("Content-Encoding")))

# ---- 2b. `/`（目录 → index.html）也必须压缩（否则首页这份最大的漏掉）----
stR, hdrsR, bodyR, _ = get("/", {"Accept-Encoding": "gzip"})
check("`/` 目录首页也走 gzip", stR == 200 and hdrsR.get("Content-Encoding") == "gzip"
      and gzip.decompress(bodyR) == RAW_HTML,
      "status=%s ce=%s raw=%d gz=%d" % (stR, hdrsR.get("Content-Encoding"), len(RAW_HTML), len(bodyR)))

# ---- 3. 304：带 If-Modified-Since 回访不重传 ----
lm = hdrs.get("Last-Modified")
st3, hdrs3, body3, _ = get("/index.html", {"Accept-Encoding": "gzip", "If-Modified-Since": lm})
check("gzip 分支保留 304", st3 == 304 and body3 == b"", "status=%s body=%d" % (st3, len(body3)))

# ---- 4. 非文本资源不压 ----
st4, hdrs4, body4, _ = get("/pic.png", {"Accept-Encoding": "gzip"})
check("png 不被压缩", st4 == 200 and "Content-Encoding" not in hdrs4 and body4 == FAKE_PNG,
      "ce=%s" % hdrs4.get("Content-Encoding"))

# ---- 5. HTTP/1.1 + keep-alive（同一连接连续两个请求）----
conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=20)
a = get("/index.html", {"Accept-Encoding": "identity"}, conn=conn)
b = get("/pic.png", conn=conn)
conn.close()
check("HTTP/1.1 协议版本", a[3] == 11, "version=%s" % a[3])
check("keep-alive: 同连接两次请求都成功", a[0] == 200 and b[0] == 200,
      "1st=%s 2nd=%s" % (a[0], b[0]))

# ---- 6. HEAD ----
conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=20)
conn.request("HEAD", "/index.html", headers={"Accept-Encoding": "gzip"})
rh = conn.getresponse()
hb = rh.read()
conn.close()
check("HEAD: 有 Content-Length 且无 body",
      rh.status == 200 and rh.getheader("Content-Length") and hb == b"",
      "len=%s body=%d" % (rh.getheader("Content-Length"), len(hb)))

# ---- 7. single-flight：8 个并发只回源一次 ----
URL = "/tiles/satellite/7/105/52.png"
errs = []


def burst():
    try:
        c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=30)
        c.request("GET", URL)
        r = c.getresponse()
        r.read()
        c.close()
    except Exception as e:
        errs.append(repr(e))


ts = [threading.Thread(target=burst) for _ in range(8)]
for t in ts:
    t.start()
for t in ts:
    t.join()
check("single-flight: 8 并发只回源 1 次", len(CALLS) == 1, "上游调用=%d 次" % len(CALLS))

# ---- 8. 唯一临时名：不留孤儿 .tmp ----
tile_dir = os.path.join(tp.CACHE_DIR, "satellite", "7", "105")
leftover = [f for f in os.listdir(tile_dir) if ".tmp" in f] if os.path.isdir(tile_dir) else []
check("落盘后无 .tmp 残留", not leftover, "残留=%s" % leftover)
check("缓存文件内容正确",
      open(os.path.join(tile_dir, "52.png"), "rb").read() == FAKE_PNG)

# ---- 9. 失败短缓存：上游 404 不再每次重试 ----
CALLS.clear()


def fail_fetch(self, layer, z, x, y, is_retina):
    with CALL_LOCK:
        CALLS.append(1)
    return None


tp.Handler._fetch = fail_fetch
for _ in range(5):
    st9, _, _, _ = get("/tiles/satellite/8/200/100.png")
check("失败: 5 次请求只打 1 次上游（短缓存）", st9 == 404 and len(CALLS) == 1,
      "status=%s 上游=%d 次" % (st9, len(CALLS)))

srv.shutdown()
shutil.rmtree(tp.WEB_ROOT, ignore_errors=True)

failed = [r for r in results if not r[1]]
print("-" * 78)
if failed:
    print("失败 %d/%d 项" % (len(failed), len(results)))
    sys.exit(1)
print("ALL GREEN：%d/%d 项通过" % (len(results), len(results)))

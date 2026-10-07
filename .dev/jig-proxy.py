#!/usr/bin/env python3
"""jig-proxy.py — 本地验证用薄代理：静态文件优先本地，其余回源到真实站点。

用途：浏览器把对 43.154.210.202:8899 的请求全部改写到本机 8899，
于是页面里所有**同源相对路径**（data/、vendor/、tiles/）都打到本机：
  · 本地站点目录里存在的文件（改过的 index.html、data/、vendor/）→ 读盘
  · 其余（卫星瓦片、wind_field 等）→ 回源线上
  · /tiles/tdt/ → 转发给本地 tile_proxy 实例（127.0.0.1:8898，带真 Key）
这样浏览器始终只看到同源请求，不会触发 Chrome 的私有网络访问策略
（那会把「公网源 → 回环地址」的图片请求拦掉，表现为瓦片全部 ERR_ABORTED）。

用法: jig-proxy.py <port> <local-site-dir-or-'-'>
"""
import mimetypes
import os
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = "http://43.154.210.202:8899"
TDT_LOCAL = "http://127.0.0.1:8898"
SITE = None
# ⚠ content-length 必须列入：本代理转发时会按实际字节数重写 Content-Length，
#   若同时从上游复制一份，就会出现两个同名头，浏览器报
#   "Duplicate Content-Length" 解析失败（瓦片全部 ERR_ABORTED，极易误判成后端挂了）。
HOP = {"connection", "keep-alive", "transfer-encoding", "te", "trailers",
       "upgrade", "proxy-authenticate", "proxy-authorization", "content-length"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, data, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _local(self):
        if not SITE:
            return False
        rel = self.path.split("?", 1)[0].lstrip("/") or "index.html"
        if rel.endswith("/"):
            rel += "index.html"
        cand = os.path.normpath(os.path.join(SITE, rel))
        if not (cand == SITE or cand.startswith(SITE + os.sep)):
            return False
        if not os.path.isfile(cand):
            return False
        with open(cand, "rb") as f:
            data = f.read()
        ctype = mimetypes.guess_type(cand)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith(("javascript", "json")):
            ctype += "; charset=utf-8"
        self._send(200, data, ctype)
        return True

    def _proxy(self):
        if self.command in ("GET", "HEAD") and self._local():
            return
        base = TDT_LOCAL if self.path.startswith("/tiles/tdt/") else UPSTREAM
        url = base + self.path
        body = None
        n = self.headers.get("Content-Length")
        if n:
            body = self.rfile.read(int(n))
        req = urllib.request.Request(url, data=body, method=self.command)
        for k, v in self.headers.items():
            if k.lower() not in HOP and k.lower() != "host":
                req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
                self.send_response(r.status)
                for k, v in r.headers.items():
                    if k.lower() not in HOP:
                        self.send_header(k, v)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(data)
        except urllib.error.HTTPError as e:
            self._send(e.code, e.read(), "text/plain")
        except Exception as e:  # noqa: BLE001
            self.send_error(502, str(e))

    do_GET = do_POST = do_HEAD = _proxy

    def log_message(self, fmt, *args):
        sys.stderr.write("[jig] %s\n" % (fmt % args))


def main():
    global SITE
    port = int(sys.argv[1])
    if len(sys.argv) > 2 and sys.argv[2] != "-":
        SITE = os.path.abspath(sys.argv[2])
    print("jig-proxy on :%d  site=%s" % (port, SITE))
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()

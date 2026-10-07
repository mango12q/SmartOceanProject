#!/usr/bin/env python3
"""Tile proxy server: serve cached tiles, fetch upstream on miss.
Serves static files for all other paths (index.html, wind_field, etc).

2026-09-30 合规整改说明
----------------------
底图来源改为「天地图（国家地理信息公共服务平台）」+「Esri 卫星影像」。
已下线且**切勿恢复**的上游：
  osm     —— 瓦片上直接把藏南标为 "Arunachal Pradesh"、国界沿麦克马洪线、
             台湾按独立国家要素表示、无十段线，违反《公开地图内容表示规范》
             （自然资规〔2023〕2 号）五（三）/ 七（一）/ 八（一）/ 十。
  terrain —— OpenTopoMap 同源 OSM 数据，问题相同。
两者下线后，即使有人手工构造 /tiles/osm/... 请求，本代理也只会 404，
不会再去上游取一份错误表示回来。

天地图瓦片是两层：vec_w（矢量底图，含国界/省界）+ cva_w（矢量注记，地名文字）。
浏览器直连时由 index.html 用 L.layerGroup 叠两层；走本代理时（离线演示、
TDT_USE_LOCAL_TILES=true）在服务端把两层合成一张 PNG 再落盘，
前端只需请求 tiles/tdt/{z}/{x}/{y}.png 一个地址。

缓存目录里带 API Key 的短哈希：换 Key 后旧缓存自然失效，不会串号。
"""
import gzip
import hashlib
import io
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from email.utils import parsedate_to_datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn

CACHE_DIR = "/home/haike/test_web/tiles"
# 天地图 Key（tk）。这里填的 Key 只在服务端使用，**不会**随页面下发给浏览器，
# 因此代理模式下前端 index.html 里的 TDT_KEY 只需填一个占位非空值即可。
TDT_KEY = ""
TDT_SUBDOMAINS = ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7"]
TDT_WMTS = ("https://{s}.tianditu.gov.cn/{layer}_w/wmts"
            "?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0"
            "&LAYER={layer}&STYLE=default&TILEMATRIXSET=w"
            "&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={tk}")

UPSTREAM = {
    "satellite": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
}
# 已下线（2026-09-30 合规整改，切勿恢复）：
#   gaode   —— 数据合规，但**直连其瓦片违反《高德地图开放平台服务协议》3.5**
#              （不得以技术手段抓取服务数据），且官网不公开固定审图号、
#              无法按《地图审核管理规定》第 27 条在页面上依法标注。
#   osm     —— 瓦片上把藏南标为 "Arunachal Pradesh"、国界沿麦克马洪线、
#              台湾按独立国家要素表示、无十段线。
#   terrain —— OpenTopoMap 同源 OSM 数据，问题相同。
# 三者下线后，即使有人手工构造 /tiles/<name>/... 请求，本代理也只会 404，
# 不会再去上游取回一份不合规的表示。
TILE_RE = re.compile(r"^/tiles/(satellite|tdt)/(\d+)/(\d+)/(\d+)(@2x)?\.png$")
USER_AGENT = "typhoon-track-map/1.0 (typhoon visualization; contact: mango12q@163.com)"
# 浏览器 UA 常量：天地图对「非浏览器 UA」做 WAF 拦截，必须用它回源
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
# ⚠ 天地图 WAF 实测（2026-09-30，逐个 UA 试出来的）：
#   仅自定义 UA            -> 403 Forbidden
#   无 UA（urllib 默认）   -> 403 Forbidden
#   自定义 UA + Referer    -> 403 Forbidden
#   浏览器 UA（± Referer） -> 200 image/png
# 所以回源天地图**必须**用浏览器 UA；用 USER_AGENT 那个自定义串会被直接 403，
# 表现为 /tiles/tdt/... 全部 404（Tile not found），底图整片空白。
TDT_UA = BROWSER_UA
REFERER = "http://43.154.210.202:8899/"
UPSTREAM_SEM = threading.Semaphore(3)  # max concurrent upstream fetches
FETCH_DELAY = 0.15  # seconds between upstream fetches


def tdt_cache_ns():
    """Key 的短哈希，作为天地图缓存子目录名（换 Key 即换缓存）。"""
    return hashlib.sha256(TDT_KEY.encode("utf-8")).hexdigest()[:8] if TDT_KEY else "nokey"


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


WEB_ROOT = "/home/haike/test_web"      # 静态根（显式钉死，不再依赖启动时的 cwd）
# 静态托管黑名单：源码、备份、日志、临时文件一律 404。
# 2026-09-30：原先静态根就是 cwd，导致 tile_proxy.py
# （含天地图 Key 明文）与 index.html.bak-* 全都能被匿名下载。
DENY_RE = re.compile(r"\.(py|pyc|pyo|sh|log|swp|tmp|bak|conf|ini|env)($|[-.])", re.I)

# ---------------------------------------------------------------------------
# 2026-10-07 三项加固/性能改动
# ---------------------------------------------------------------------------
# ① gzip：index.html 未压缩 615 KB，而首屏还要拉 vendor/ 下近 400 KB 的 js/css。
#    静态文本资源压缩后能省掉大约 3/4 的传输量。只压文本类、且只压 ≥1KB 的，
#    并保留 Last-Modified + 304（否则每次回访都要重传，反而更差）。
COMPRESSIBLE_EXT = (".html", ".htm", ".css", ".js", ".mjs", ".json", ".svg", ".txt",
                    ".geojson", ".xml")
GZIP_MIN_SIZE = 1024
GZIP_CACHE = {}                 # path -> (mtime, size, gz_bytes)
GZIP_LOCK = threading.Lock()

# ② 单次回源（single-flight）：同一瓦片被并发请求时只让一个线程真去上游。
#    实测（.dev/_audit_fanout_probe.py）加之前 8 个并发请求打了 **6 次**上游。
INFLIGHT = {}                   # 缓存路径 -> threading.Event
INFLIGHT_LOCK = threading.Lock()

# ③ 失败短缓存：上游 404/超时不再每次平移都重打一遍（原先每次请求都会重试）。
TILE_FAIL = {}                  # 缓存路径 -> 到期时间戳
TILE_FAIL_TTL = 120             # 秒；短一点，避免上游抖动让瓦片长时间空白


def inflight_claim(path):
    """认领某个瓦片的回源权：返回 (event, is_owner)。"""
    with INFLIGHT_LOCK:
        ev = INFLIGHT.get(path)
        if ev is None:
            ev = threading.Event()
            INFLIGHT[path] = ev
            return ev, True
        return ev, False


def inflight_release(path, ev):
    with INFLIGHT_LOCK:
        INFLIGHT.pop(path, None)
    ev.set()


class Handler(SimpleHTTPRequestHandler):
    # HTTP/1.0（父类默认）意味着**每个瓦片一条新 TCP 连接**：一屏卫星底图几十个请求，
    # 每次都要握手。改成 1.1 开 keep-alive —— 代价是每个响应都必须带正确的
    # Content-Length，本文件所有分支（_serve_bytes / _send_gzip / send_error /
    # 父类静态分支）都已满足。timeout 防住闲置连接长期占线程。
    protocol_version = "HTTP/1.1"
    timeout = 30

    def __init__(self, *args, **kwargs):
        kwargs["directory"] = WEB_ROOT      # Python 3.7+ ；不传就退回 cwd
        super().__init__(*args, **kwargs)

    def do_GET(self):
        m = TILE_RE.match(self.path)
        if not m:
            # ⚠ 必须**先 percent-decode 再匹配**黑名单。
            #   urlparse() 不做解码，而匹配失败后 SimpleHTTPRequestHandler 的
            #   translate_path() **会** unquote —— 于是 /data/x%2epy（甚至 %2E）
            #   绕过 DENY_RE 落到静态处理器，又被解码成 x.py 原样下发。
            #   2026-10-07 实测：线上 /data/convert_simplify%2epy 曾 200 返回源码全文，
            #   与本文件顶部"源码/备份一律 404"的加固意图正好相反。
            raw = urllib.parse.unquote(urllib.parse.urlparse(self.path).path,
                                       errors="replace")
            base = os.path.basename(raw)
            if DENY_RE.search(base) or base.startswith("."):
                return self.send_error(404, "Not found")
            return super().do_GET()
        layer, z, x, y, retina = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
        is_retina = retina == "@2x"
        suffix = "@2x" if is_retina else ""
        base = os.path.join(CACHE_DIR, layer)
        if layer == "tdt":
            base = os.path.join(base, tdt_cache_ns())
        path = os.path.join(base, z, x, y + suffix + ".png")
        if os.path.exists(path) and os.path.getsize(path) > 0:
            return self._serve_file(path, "image/png")
        now = time.time()
        if TILE_FAIL.get(path, 0) > now:
            return self.send_error(404, "Tile not found")

        ev, is_owner = inflight_claim(path)
        try:
            if not is_owner:
                # 别的线程正在回源同一张瓦片：等它落盘，然后直接读缓存
                ev.wait(20)
                if os.path.exists(path) and os.path.getsize(path) > 0:
                    return self._serve_file(path, "image/png")
                # 它失败了/超时了：自己也去取一次，别让这个请求空手而归
            if layer == "tdt":
                data = self._fetch_tdt(z, x, y)
            else:
                data = self._fetch(layer, z, x, y, is_retina)
                if data is None and is_retina:
                    # Fallback: serve normal-res tile so the map never shows a blank tile
                    data = self._fetch(layer, z, x, y, False)
            if data is None:
                # 失败短缓存：否则每次平移都会把同一个 404 再打向上游一遍
                TILE_FAIL[path] = time.time() + TILE_FAIL_TTL
                if len(TILE_FAIL) > 4096:       # 顺手清过期项，避免无界增长
                    for k in [k for k, v in TILE_FAIL.items() if v <= now]:
                        TILE_FAIL.pop(k, None)
                self.send_error(404, "Tile not found")
                return
            try:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                # 唯一临时名。原先固定用 path + ".tmp"：两个线程同时写同一个临时文件，
                # Linux 上 os.replace 之后先写者仍持着「已发布」inode 的 fd（发布后被改写，
                # 读取方可能读到半截 PNG），Windows 上 rename 被占用会抛 PermissionError
                # 并被下面那个 except 静默吞掉、留下孤儿 .tmp。
                tmp = "%s.tmp.%d.%d" % (path, os.getpid(), threading.get_ident())
                with open(tmp, "wb") as f:
                    f.write(data)
                os.replace(tmp, path)
            except Exception:
                pass
            self._serve_bytes(data, "image/png")
        finally:
            if is_owner:
                inflight_release(path, ev)

    def send_head(self):
        """静态文本资源走 gzip（保留 Last-Modified + 304），其余交给父类。

        ⚠ 必须自己解析「目录 → index.html」这一步：`/` 经 translate_path 得到的是
        **目录**，若只判 os.path.isfile 就会落到父类分支，于是首页（615 KB，全站
        最大的一份）反而不压缩 —— 实测踩到，.dev/check-tileproxy-perf.py 里有 `/`
        的回归用例。
        """
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            for index in ("index.html", "index.htm"):
                cand = os.path.join(path, index)
                if os.path.isfile(cand):
                    path = cand
                    break
        if os.path.isfile(path) and path.lower().endswith(COMPRESSIBLE_EXT):
            if "gzip" in (self.headers.get("Accept-Encoding") or "").lower():
                try:
                    st = os.stat(path)
                except OSError:
                    return super().send_head()
                if st.st_size >= GZIP_MIN_SIZE:
                    return self._send_gzip(path, st)
        return super().send_head()

    def _send_gzip(self, path, st):
        last_mod = self.date_time_string(st.st_mtime)
        # 304 必须保留：少了它，浏览器每次回访都要重传整份，比不压缩还糟
        ims = self.headers.get("If-Modified-Since")
        if ims:
            try:
                if int(st.st_mtime) <= int(parsedate_to_datetime(ims).timestamp()):
                    self.send_response(304)
                    self.send_header("Last-Modified", last_mod)
                    self.end_headers()
                    return None
            except Exception:
                pass
        with GZIP_LOCK:
            hit = GZIP_CACHE.get(path)
        if hit and hit[0] == st.st_mtime and hit[1] == st.st_size:
            body = hit[2]
        else:
            try:
                with open(path, "rb") as f:
                    raw = f.read()
            except OSError:
                return super().send_head()
            body = gzip.compress(raw, 6)
            with GZIP_LOCK:
                GZIP_CACHE[path] = (st.st_mtime, st.st_size, body)
        ctype = self.guess_type(path)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        if ctype.startswith("text/html"):
            # 页面改了就要立刻看到，不让浏览器用启发式缓存
            self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Last-Modified", last_mod)
        self.end_headers()
        return io.BytesIO(body)

    def _http_get(self, url, ua, referer=None):
        headers = {"User-Agent": ua}
        if referer:
            headers["Referer"] = referer
        req = urllib.request.Request(url, headers=headers)
        with UPSTREAM_SEM:
            try:
                time.sleep(FETCH_DELAY)
                with urllib.request.urlopen(req, timeout=15) as r:
                    return r.read()
            except Exception:
                return None

    def _tdt_url(self, layer, z, x, y):
        s = TDT_SUBDOMAINS[(int(x) + int(y)) % len(TDT_SUBDOMAINS)]
        return TDT_WMTS.format(s=s, layer=layer, z=z, x=x, y=y,
                               tk=urllib.parse.quote(TDT_KEY, safe=""))

    def _fetch_tdt(self, z, x, y):
        """拉取 vec + cva 两层并合成一张 PNG。

        天地图要求 Key 与来源；未配置 Key 时直接返回 None（→404），
        绝不退回任何不合规底图。
        ⚠ UA 必须用 TDT_UA（浏览器 UA）：用自定义 UA 会被天地图 WAF 403。
        """
        if not TDT_KEY:
            return None
        vec = self._http_get(self._tdt_url("vec", z, x, y), TDT_UA, REFERER)
        if vec is None:
            return None
        cva = self._http_get(self._tdt_url("cva", z, x, y), TDT_UA, REFERER)
        if cva is None:
            return vec                      # 注记层失败就只给底图，别整块空白
        try:
            from PIL import Image
        except ImportError:
            return vec                      # 没装 Pillow 时退化为只有底图
        try:
            base = Image.open(io.BytesIO(vec)).convert("RGBA")
            over = Image.open(io.BytesIO(cva)).convert("RGBA")
            if over.size != base.size:
                over = over.resize(base.size)
            base.alpha_composite(over)
            out = io.BytesIO()
            base.convert("RGB").save(out, "PNG", optimize=True)
            return out.getvalue()
        except Exception:
            return vec

    def _fetch(self, layer, z, x, y, is_retina):
        """回源非天地图的底图（目前只剩 satellite = Esri World Imagery）。"""
        tpl = UPSTREAM[layer]
        # ArcGIS 不支持 @2x，一律按普通分辨率取，避免 @2x 请求 404
        url = tpl.format(z=z, x=x, y=y)
        return self._http_get(url, USER_AGENT, REFERER)

    def list_directory(self, path):
        """关掉目录列表（/data/ /tiles/ /vendor/ /wind_field/ 都曾 200 列目录）。

        2026-10-07：目录列表会把「站点里到底有哪些 .py/.bak/.log」直接列给匿名访问者，
        等于给上面那条黑名单绕过一个现成的目标清单。目录请求一律 404；
        实体文件仍按显式路径正常下发（页面只用显式路径，不依赖列表）。
        """
        self.send_error(404, "Not found")
        return None

    def _serve_file(self, path, ctype):
        try:
            with open(path, "rb") as f:
                data = f.read()
        except Exception:
            self.send_error(404)
            return
        self._serve_bytes(data, ctype)

    def _serve_bytes(self, data, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "max-age=86400")
        self.end_headers()
        try:
            self.wfile.write(data)
        except Exception:
            pass


def main():
    """启动入口。端口/缓存目录/Key 可用命令行覆盖，便于本地复现线上配置做验证：

        python3 tile_proxy.py [port] [cache_dir] [tdt_key]

    ⚠ 必须用 global 声明：否则下面三句会把 CACHE_DIR / TDT_KEY 变成 main 的
       局部变量，Handler 与 tdt_cache_ns() 读到的是模块级旧值（UnboundLocalError
       或静默用错配置）。"""
    global CACHE_DIR, TDT_KEY
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    if len(sys.argv) > 2 and sys.argv[2]:
        CACHE_DIR = sys.argv[2]
    if len(sys.argv) > 3 and sys.argv[3]:
        TDT_KEY = sys.argv[3]
    if not TDT_KEY:
        print("[warn] TDT_KEY 未配置：/tiles/tdt/... 将返回 404。"
              "请在 tile_proxy.py 顶部填入天地图 Key。")
    print("Tile proxy listening on :%d (cache=%s, tdt_key=%s)"
          % (port, CACHE_DIR, "set" if TDT_KEY else "unset"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()

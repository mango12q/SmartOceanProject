#!/usr/bin/env python3
"""Tile proxy server: serve cached tiles, fetch upstream on miss.
Serves static files for all other paths (index.html, wind_field, etc)."""
import os
import re
import threading
import time
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn

CACHE_DIR = "/home/haike/test_web/tiles"
UPSTREAM = {
    "osm": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}{r}.png",
    "satellite": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    "terrain": "https://{s}.tile.opentopomap.org/{z}/{x}/{y}{r}.png",
    "gaode": "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scl={scl}&style=8&x={x}&y={y}&z={z}",
}
SUB = ["a", "b", "c"]
GAODE_SUB = ["1", "2", "3", "4"]
TILE_RE = re.compile(r"^/tiles/(osm|satellite|terrain|gaode)/(\d+)/(\d+)/(\d+)(@2x)?\.png$")
# Compliant UA per OSM tile usage policy
USER_AGENT = "typhoon-track-map/1.0 (typhoon visualization; contact: mango12q@163.com)"
# Gaode expects a browser-like UA
GAODE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
REFERER = "http://43.154.210.202:8899/"
UPSTREAM_SEM = threading.Semaphore(3)  # max concurrent upstream fetches
FETCH_DELAY = 0.15  # seconds between upstream fetches


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        m = TILE_RE.match(self.path)
        if not m:
            return super().do_GET()
        layer, z, x, y, retina = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
        is_retina = retina == "@2x"
        suffix = "@2x" if is_retina else ""
        path = os.path.join(CACHE_DIR, layer, z, x, y + suffix + ".png")
        if os.path.exists(path) and os.path.getsize(path) > 0:
            return self._serve_file(path, "image/png")
        data = self._fetch(layer, z, x, y, is_retina)
        if data is None and is_retina:
            # Fallback: serve normal-res tile so the map never shows a blank tile
            data = self._fetch(layer, z, x, y, False)
        if data is None:
            self.send_error(404, "Tile not found")
            return
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
        except Exception:
            pass
        self._serve_bytes(data, "image/png")

    def _fetch(self, layer, z, x, y, is_retina):
        tpl = UPSTREAM[layer]
        retina_suffix = "@2x" if is_retina else ""
        if layer == "satellite":
            # ArcGIS doesn't support @2x, always fetch regular
            url = tpl.format(z=z, x=x, y=y)
            ua = USER_AGENT
        elif layer == "gaode":
            # Gaode retina via scl=2
            scl = "2" if is_retina else "1"
            url = tpl.format(s=GAODE_SUB[(int(x) + int(y) + int(z)) % 4], z=z, x=x, y=y, scl=scl)
            ua = GAODE_UA
        else:
            # OSM and OpenTopoMap support @2x via {r} placeholder
            url = tpl.format(s=SUB[(int(x) + int(y) + int(z)) % 3], z=z, x=x, y=y, r=retina_suffix)
            ua = USER_AGENT
        headers = {"User-Agent": ua, "Referer": REFERER}
        req = urllib.request.Request(url, headers=headers)
        with UPSTREAM_SEM:
            try:
                time.sleep(FETCH_DELAY)
                with urllib.request.urlopen(req, timeout=15) as r:
                    return r.read()
            except Exception:
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


if __name__ == "__main__":
    print("Tile proxy listening on :8899 (cache=%s)" % CACHE_DIR)
    ThreadingHTTPServer(("0.0.0.0", 8899), Handler).serve_forever()

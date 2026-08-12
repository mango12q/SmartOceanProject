#!/usr/bin/env python3
"""Pre-warm Gaode tile cache: download tiles for the typhoon region directly
from Gaode into the proxy cache directory, so the map loads instantly."""
import math
import os
import queue
import threading
import urllib.request

CACHE = "/home/haike/test_web/tiles/gaode"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
SUB = ["1", "2", "3", "4"]

# (zoom, lat_min, lat_max, lon_min, lon_max)
REGIONS = [
    (5, 15, 25, 105, 131),   # whole typhoon track area
    (6, 15, 25, 105, 131),
    (7, 15, 25, 105, 131),
    (8, 15, 25, 105, 131),
    (9, 21, 24, 112, 116.5),  # Guangdong / Pearl River Delta
    (10, 21, 24, 112, 116.5),
    (11, 21.8, 23.2, 113, 115.5),  # Shenzhen detail
]


def deg2num(lat, lon, z):
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    lat_r = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n)
    return x, y


jobs = queue.Queue()
for z, la1, la2, lo1, lo2 in REGIONS:
    x1, y1 = deg2num(la2, lo1, z)  # top-left
    x2, y2 = deg2num(la1, lo2, z)  # bottom-right
    for x in range(min(x1, x2), max(x1, x2) + 1):
        for y in range(min(y1, y2), max(y1, y2) + 1):
            for retina in (False, True):
                suffix = "@2x" if retina else ""
                path = os.path.join(CACHE, str(z), str(x), str(y) + suffix + ".png")
                if os.path.exists(path) and os.path.getsize(path) > 0:
                    continue
                jobs.put((z, x, y, retina, path))

total = jobs.qsize()
print("to fetch:", total, flush=True)
lock = threading.Lock()
done = [0]


def worker():
    while True:
        try:
            z, x, y, retina, path = jobs.get_nowait()
        except queue.Empty:
            return
        scl = "2" if retina else "1"
        s = SUB[(x + y + z) % 4]
        url = ("https://webrd0%s.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scl=%s&style=8&x=%d&y=%d&z=%d"
               % (s, scl, x, y, z))
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=15) as r:
                data = r.read()
            if len(data) > 500:  # skip error placeholders
                os.makedirs(os.path.dirname(path), exist_ok=True)
                tmp = path + ".tmp"
                with open(tmp, "wb") as f:
                    f.write(data)
                os.replace(tmp, path)
        except Exception:
            pass
        with lock:
            done[0] += 1
            if done[0] % 200 == 0:
                print("progress %d/%d" % (done[0], total), flush=True)
        jobs.task_done()


threads = [threading.Thread(target=worker) for _ in range(5)]
for t in threads:
    t.start()
for t in threads:
    t.join()
print("DONE", done[0], "tiles processed", flush=True)

#!/usr/bin/env python3
"""Download typhoon-region tiles for 3 basemap layers (osm/satellite/terrain).
Stores to ./tiles/{layer}/{z}/{x}/{y}.png
Supports resume (skips existing), concurrency, retry, and progress."""
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

# Bounding box around typhoon track (with padding)
LAT_MIN, LAT_MAX = 13.3, 23.7
LON_MIN, LON_MAX = 105.5, 131.7
Z_MIN, Z_MAX = 4, 10

OUT_DIR = "tiles"
THREADS = 16
TIMEOUT = 20
RETRIES = 3

LAYERS = {
    "osm": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    "satellite": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    "terrain": "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
}
SUB = ["a", "b", "c"]


def lat_lon_to_tile(lat, lon, z):
    xt = (lon + 180.0) / 360.0 * (1 << z)
    lat_r = math.radians(lat)
    yt = (1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * (1 << z)
    return int(math.floor(xt)), int(math.floor(yt))


def url_for(layer, z, x, y):
    tpl = LAYERS[layer]
    if layer == "satellite":
        return tpl.format(z=z, x=x, y=y)
    return tpl.format(s=SUB[(x + y + z) % 3], z=z, x=x, y=y)


def download_one(job):
    layer, z, x, y = job
    path = os.path.join(OUT_DIR, layer, str(z), str(x), f"{y}.png")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return None
    os.makedirs(os.path.dirname(path), exist_ok=True)
    url = url_for(layer, z, x, y)
    for attempt in range(RETRIES):
        try:
            r = requests.get(url, timeout=TIMEOUT, headers={"User-Agent": "Mozilla/5.0"})
            if r.status_code == 200 and len(r.content) > 0:
                tmp = path + ".tmp"
                with open(tmp, "wb") as f:
                    f.write(r.content)
                os.replace(tmp, path)
                return (layer, z, x, y, len(r.content))
            elif r.status_code == 404:
                return ("missing", layer, z, x, y)
        except Exception:
            pass
        time.sleep(0.5 * (attempt + 1))
    return ("error", layer, z, x, y)


def main():
    jobs = []
    total_tiles = 0
    for layer in LAYERS:
        for z in range(Z_MIN, Z_MAX + 1):
            x0, y_top = lat_lon_to_tile(LAT_MAX, LON_MIN, z)
            x1, y_bot = lat_lon_to_tile(LAT_MIN, LON_MAX, z)
            for x in range(x0, x1 + 1):
                for y in range(y_top, y_bot + 1):
                    jobs.append((layer, z, x, y))
                    total_tiles += 1

    print(f"Total jobs: {total_tiles} (3 layers x z4~z10)")

    done = 0
    skipped = 0
    bytes_total = 0
    errors = []
    t0 = time.time()

    with ThreadPoolExecutor(max_workers=THREADS) as ex:
        futs = {ex.submit(download_one, j): j for j in jobs}
        for fut in as_completed(futs):
            res = fut.result()
            done += 1
            if res is None:
                skipped += 1
            elif res[0] == "missing":
                errors.append(("missing", res[1], res[2], res[3]))
            elif res[0] == "error":
                errors.append(("error", res[1], res[2], res[3]))
            else:
                bytes_total += res[4]
            if done % 500 == 0 or done == total_tiles:
                el = time.time() - t0
                print(f"[{done}/{total_tiles}] elapsed={el:.0f}s")

    print(f"\nDone in {time.time()-t0:.0f}s")
    print(f"Downloaded bytes: {bytes_total/1024/1024:.1f} MB")
    print(f"Skipped (already exist): {skipped}")
    print(f"Errors: {len(errors)}")
    for e in errors[:20]:
        print(" ", e)


if __name__ == "__main__":
    main()

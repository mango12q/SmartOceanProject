#!/usr/bin/env python3
"""WRF wind field -> per-timestep MessagePack binary (5-grid subsample, min wind 5 m/s)."""
import math
import os

import msgpack
import numpy as np
import xarray as xr

WRF_FILE = "/home/haike/test_web/wind_wrfout_d02_2025-09-15_000000"
OUT_DIR = "/home/haike/test_web/wind_field"
SUBSAMPLE = 5
MIN_WIND = 5.0


def ensure_dir(path):
    os.makedirs(path, exist_ok=True)


def wind_speed_dir(u, v):
    speed = float(np.sqrt(u ** 2 + v ** 2))
    direction = float(np.degrees(np.arctan2(u, v)))
    direction = (direction + 180) % 360
    return speed, direction


def process():
    print(f"Opening {WRF_FILE} ...")
    ds = xr.open_dataset(WRF_FILE)

    u10 = ds["U10"].values
    v10 = ds["V10"].values
    lat3d = ds["XLAT"].values
    lon3d = ds["XLONG"].values

    ntimes = u10.shape[0]
    print(f"Times: {ntimes}, Grid: {lat3d.shape[1]}x{lat3d.shape[2]}")

    ensure_dir(OUT_DIR)

    for ti in range(ntimes):
        lat2d = lat3d[ti]
        lon2d = lon3d[ti]
        u = u10[ti]
        v = v10[ti]

        points = []
        rows, cols = u.shape
        for i in range(0, rows, SUBSAMPLE):
            for j in range(0, cols, SUBSAMPLE):
                spd, dire = wind_speed_dir(u[i, j], v[i, j])
                if spd < MIN_WIND:
                    continue
                la = float(lat2d[i, j])
                lo = float(lon2d[i, j])
                if math.isnan(la) or math.isnan(lo) or math.isnan(spd):
                    continue
                points.append([lo, la, round(spd, 1), round(dire, 1)])

        out_path = os.path.join(OUT_DIR, f"wind_field_{ti:04d}.bin")
        with open(out_path, "wb") as f:
            f.write(msgpack.packb(points, use_bin_type=True))
        print(f"Written {out_path} ({len(points)} points, {os.path.getsize(out_path)} bytes)")

    ds.close()
    print("Done.")


if __name__ == "__main__":
    process()

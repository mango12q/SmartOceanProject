#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""WRF 10m 风场 -> 逐时 msgpack 风羽数据（与现有 wind_field/wind_field_XXXX.bin 格式一致）。

接口：--config typhoons.json --name 名称 [--only T] [--out DIR] [--ocean-only]
输出：<out>/<name>/wind_field/wind_field_XXXX.bin
每条记录：[lon, lat, 风速(1位小数), 风向(1位小数)]
风向 = (degrees(arctan2(u, v)) + 180) % 360（气象风向，与服务器原脚本一致）。
"""
import argparse
import json
import math
import os

import msgpack
import numpy as np
import xarray as xr


def ensure_dir(path):
    os.makedirs(path, exist_ok=True)


def wind_speed_dir(u, v):
    speed = float(np.sqrt(u ** 2 + v ** 2))
    direction = float(np.degrees(np.arctan2(u, v)))
    direction = (direction + 180) % 360
    return speed, direction


def process(cfg, wrf_file, out_dir, only_t=None, ocean_only=False):
    wind_cfg = cfg.get("wind", {})
    subsample = int(wind_cfg.get("subsample", 5))
    min_wind = float(wind_cfg.get("min_wind", 5.0))

    print("Opening %s ..." % wrf_file, flush=True)
    ds = xr.open_dataset(wrf_file)
    u10 = ds["U10"].values
    v10 = ds["V10"].values
    lat3d = ds["XLAT"].values
    lon3d = ds["XLONG"].values
    hgt3d = ds["HGT"].values if ocean_only else None

    ntimes = u10.shape[0]
    print("Times: %d, Grid: %dx%d" % (ntimes, lat3d.shape[1], lat3d.shape[2]), flush=True)
    ensure_dir(out_dir)

    times = [only_t] if only_t is not None else range(ntimes)
    for ti in times:
        lat2d = lat3d[ti]
        lon2d = lon3d[ti]
        u = u10[ti]
        v = v10[ti]
        land_mask = (hgt3d[ti] > 0) if ocean_only else None

        points = []
        rows, cols = u.shape
        for i in range(0, rows, subsample):
            for j in range(0, cols, subsample):
                if land_mask is not None and land_mask[i, j]:
                    continue
                spd, dire = wind_speed_dir(u[i, j], v[i, j])
                if spd < min_wind:
                    continue
                la = float(lat2d[i, j])
                lo = float(lon2d[i, j])
                if math.isnan(la) or math.isnan(lo) or math.isnan(spd):
                    continue
                points.append([lo, la, round(spd, 1), round(dire, 1)])

        out_path = os.path.join(out_dir, "wind_field_%04d.bin" % ti)
        with open(out_path, "wb") as f:
            f.write(msgpack.packb(points, use_bin_type=True))
        print("Written %s (%d points, %d bytes)" % (
            out_path, len(points), os.path.getsize(out_path)), flush=True)
    ds.close()
    print("Done.", flush=True)


def main():
    ap = argparse.ArgumentParser(description="WRF 风场 -> msgpack 风羽数据")
    ap.add_argument("--config", default="typhoons.json")
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", default="out")
    ap.add_argument("--only", type=int, help="只处理指定时次（如 200）")
    ap.add_argument("--ocean-only", action="store_true", help="仅保留海上格点（HGT<=0）")
    args = ap.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        conf = json.load(f)
    cfg = conf["typhoons"][args.name]
    out_dir = os.path.join(args.out, args.name, "wind_field")
    process(cfg, cfg["wrf_file"], out_dir, only_t=args.only, ocean_only=args.ocean_only)


if __name__ == "__main__":
    main()

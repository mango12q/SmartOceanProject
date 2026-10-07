#!/usr/bin/env python3
import xarray as xr
import numpy as np

WRF_FILE = "/home/haike/test_web/wind_wrfout_d02_2025-09-15_000000"
ds = xr.open_dataset(WRF_FILE)
print("Dataset:", ds)
print("\nCoords:", list(ds.coords))
print("Dims:", dict(ds.dims))
print("\nData vars:", list(ds.data_vars))

for v in ds.data_vars:
    arr = ds[v]
    print(f"{v}: shape={arr.shape}, dtype={arr.dtype}")

# Check lat/lon
lat = ds["XLAT"].values
lon = ds["XLONG"].values
print(f"\nXLAT shape: {lat.shape}, sample: {lat[0,0]}, {lat[0,1]}")
print(f"XLONG shape: {lon.shape}, sample: {lon[0,0]}, {lon[0,1]}")

# Check time
if "Time" in ds.coords:
    print("\nTime:", ds["Time"].values[:5])
elif "time" in ds.coords:
    print("\nTime:", ds["time"].values[:5])
else:
    print("\nNo time coord found")

ds.close()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把流水线产物部署到服务器（可选步骤，需用户显式执行）。

用法：
  python deploy.py --name 桦加沙 --target haike@43.154.210.202:/home/haike/test_web
                   [--key ~/.ssh/haike_deploy_ws2] [--index ../index.html]

行为：
  - wind_dir 为空：风场 bin 直接上传到 <target>/wind_field/
  - wind_dir 为 "台风名/"：上传到 <target>/wind_field/<台风名>/
  - track.json 同步到 <target>/data/<台风名>.track.json 作为参考
  - 若提供 --index，同时上传更新后的 index.html
"""
import argparse
import json
import os
import subprocess
import sys


def scp(key, src, dst):
    cmd = ["scp", "-r"]
    if key:
        cmd += ["-i", os.path.expanduser(key)]
    cmd += [src, dst]
    print("run:", " ".join(cmd))
    subprocess.run(cmd, check=True)


def main():
    ap = argparse.ArgumentParser(description="部署台风流水线产物到服务器")
    ap.add_argument("--config", default="typhoons.json")
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", default="out")
    ap.add_argument("--target", required=True,
                    help="形如 haike@43.154.210.202:/home/haike/test_web")
    ap.add_argument("--key")
    ap.add_argument("--index", help="可选的 index.html 本地路径")
    args = ap.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        conf = json.load(f)
    cfg = conf["typhoons"][args.name]
    base = os.path.join(args.out, args.name)
    host, _, remote_root = args.target.partition(":")
    target_root = remote_root or "/home/haike/test_web"
    remote_prefix = host + ":" + target_root

    wind_local = os.path.join(base, "wind_field")
    if os.path.isdir(wind_local):
        wind_dir = cfg.get("wind_dir", "")
        remote_wind = os.path.join(target_root, "wind_field", wind_dir.rstrip("/"))
        scp(args.key, wind_local, host + ":" + remote_wind)

    track_local = os.path.join(base, "track.json")
    if os.path.exists(track_local):
        scp(args.key, track_local,
            host + ":" + os.path.join(target_root, "data", cfg["name"] + ".track.json"))

    if args.index:
        scp(args.key, args.index, remote_prefix + "/index.html")

    print("deploy done. 服务器路径：%s/wind_field/%s" % (
        remote_prefix, cfg.get("wind_dir", "").rstrip("/")))


if __name__ == "__main__":
    main()

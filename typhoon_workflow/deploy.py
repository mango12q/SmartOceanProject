#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把流水线产物部署到服务器（可选步骤，需用户显式执行）。

用法：
  python deploy.py --name 桦加沙 --target haike@43.154.210.202:/home/haike/test_web
                   [--key ~/.ssh/haike_deploy_ws2] [--index ../index.html]

行为：
  - wind_dir 为 ""：风场 bin 直接上传到 <target>/wind_field/
  - wind_dir 为 "台风名/"：上传到 <target>/wind_field/<台风名>/
  - track.json 同步到 <target>/data/<台风名>.track.json 作为参考
  - 若提供 --index，同时上传更新后的 index.html
  - 所有参数与产物先一次性校验（preflight），任何一项不合格都在**上传任何文件之前**退出

上传语义（重要，别改回 scp 裸目录）：
  `scp -r 本地目录 host:已存在的目标目录` 会把整个目录**放进**目标目录里，
  于是线上出现 wind_field/wind_field_orig/wind_field_XXXX.bin —— 多套一层。
  而线上 wind_field/、wind_field/<台风名>/ 里直接就是 wind_field_XXXX.bin，
  且不存在 wind_field_orig/ 这一层（2026-10 线上实测）。
  因此目录源一律写成 `<src>/.`，复制的是目录「内容」而不是目录本身，
  等价于 rsync 的 `src/ dst` 合并语义。

远端路径用 posixpath 拼接：
  远端是 Linux。若用 os.path.join，在 Windows 上会拼出
  `/home/haike/test_web\\wind_field\\桦加沙_corr` 这种混用分隔符的路径，
  scp 会照着建出字面量名字。本地路径才用 os.path。

注意：本脚本会真的写线上文件。只在用户明确要求时执行。
"""
import argparse
import glob
import json
import os
import posixpath
import subprocess

DEFAULT_TARGET_ROOT = "/home/haike/test_web"


def scp(key, src, dst):
    cmd = ["scp", "-r"]
    if key:
        cmd += ["-i", os.path.expanduser(key)]
    cmd += [src, dst]
    print("run:", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def scp_dir_contents(key, src_dir, dst):
    """把 src_dir 里的「内容」复制进 dst，不套 src_dir 这一层。

    用 `<dir>/.` 而不是 `<dir>`：前者是「合并进目标目录」，
    后者会生成 dst/<dir 的 basename>/…（线上多一层 wind_field_orig/ 的成因）。
    """
    src = src_dir.rstrip("/\\") + "/."
    scp(key, src, dst)


def wind_remote_dir(target_root, cfg, cfg_key, typhoon):
    """取 wind_dir / wind_dir_corrected 对应的远端目录；字段缺失时给出清晰报错。"""
    if cfg_key not in cfg:
        raise SystemExit(
            "typhoons.json 里台风「%s」缺少 %s 字段，无法确定风场上传到 wind_field/ 下的哪个目录。\n"
            "  - 传到 wind_field/ 根目录：显式写 \"%s\": \"\"\n"
            "  - 传到子目录：            \"%s\": \"<台风名>/\"\n"
            "  这里不默认成根目录 —— 线上 wind_field/ 根目录是桦加沙的 bin，"
            "默认成根目录会把别的台风的 bin 混进去（甚至互相覆盖）。"
            % (typhoon, cfg_key, cfg_key, cfg_key))
    return posixpath.join(target_root, "wind_field", cfg[cfg_key].rstrip("/"))


def build_plan(cfg, typhoon, args, host, target_root, remote_prefix, base):
    """先算出全部上传项并校验；任何一项不合格都在上传前退出。

    返回 [(本地源, 远端目标, 是否目录, 说明)]。
    """
    plan = []
    for local_name, cfg_key, label in (
            ("wind_field_orig", "wind_dir", "%s wind_field_orig" % typhoon),
            ("wind_field_corr", "wind_dir_corrected", "%s wind_field_corr" % typhoon)):
        local_dir = os.path.join(base, local_name)
        if not os.path.isdir(local_dir):
            print("[skip] %s：本地目录不存在 %s" % (label, local_dir))
            continue
        bins = glob.glob(os.path.join(local_dir, "*.bin"))
        if not bins:
            raise SystemExit(
                "%s 里没有任何 *.bin：%s\n"
                "  --out 是否指错了目录？风场产物由 run_pipeline.py 的 wind 步骤生成。"
                % (label, local_dir))
        plan.append((local_dir,
                     host + ":" + wind_remote_dir(target_root, cfg, cfg_key, typhoon),
                     True, "%s（%d 个 bin）" % (label, len(bins))))

    track_local = os.path.join(base, "track.json")
    if os.path.exists(track_local):
        plan.append((track_local,
                     host + ":" + posixpath.join(target_root, "data",
                                                 (cfg.get("name") or typhoon) + ".track.json"),
                     False, "track.json"))
    else:
        print("[skip] track.json：不存在 %s" % track_local)

    if args.index:
        if not os.path.exists(args.index):
            raise SystemExit("--index 指定的文件不存在：%s" % args.index)
        plan.append((args.index, remote_prefix + "/index.html", False, "index.html"))

    if not plan:
        raise SystemExit(
            "没有任何可部署的产物：%s 下既没有 wind_field_orig/、wind_field_corr/，"
            "也没有 track.json，且未提供 --index。请检查 --out 与 --name。" % base)
    return plan


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

    if ":" not in args.target:
        raise SystemExit(
            "--target 格式不对：%r\n"
            "  需要「主机:远端目录」，形如 haike@43.154.210.202:%s" % (args.target, DEFAULT_TARGET_ROOT))
    host, _, remote_root = args.target.partition(":")
    target_root = remote_root or DEFAULT_TARGET_ROOT
    if not host:
        raise SystemExit("--target 里没有主机名：%r" % args.target)
    remote_prefix = host + ":" + target_root

    if not os.path.exists(args.config):
        raise SystemExit(
            "--config 指定的文件不存在：%s\n"
            "  typhoons.json 在 typhoon_workflow/ 下，"
            "从仓库根目录运行请写 --config typhoon_workflow/typhoons.json。" % args.config)
    with open(args.config, "r", encoding="utf-8") as f:
        conf = json.load(f)
    typhoons = conf.get("typhoons", {})
    if args.name not in typhoons:
        raise SystemExit("typhoons.json 里没有台风「%s」。现有：%s" % (
            args.name, "、".join(typhoons) if typhoons else "（无）"))
    cfg = typhoons[args.name]

    base = os.path.join(args.out, args.name)
    if not os.path.isdir(base):
        raise SystemExit(
            "找不到该台风的产物目录：%s\n"
            "  --out 应为 run_pipeline.py 的输出根目录（其下是 <台风名>/track.json、"
            "wind_field_orig/、wind_field_corr/）。\n"
            "  请先运行：python run_pipeline.py --name %s --steps track,wind" % (base, args.name))

    plan = build_plan(cfg, args.name, args, host, target_root, remote_prefix, base)

    for src, dst, is_dir, label in plan:
        if is_dir:
            print("[scp ] %s -> %s（复制内容，不套一层）" % (label, dst))
            scp_dir_contents(args.key, src, dst)
        else:
            print("[scp ] %s -> %s" % (label, dst))
            scp(args.key, src, dst)

    print("deploy done：%d 项" % len(plan))
    for _, dst, _, label in plan:
        print("  %s -> %s" % (label, dst))


if __name__ == "__main__":
    main()

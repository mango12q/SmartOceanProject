#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只重算 track[].wind 一列（不动中心、不动 psfc）。

背景
----
README §2 的接口契约写的是：`wind` = 中心 10m **最大**风速。
但实现（extract_track.py:74 `center_wind`）取的是「**离中心最近那一个格点**」的
`sqrt(U10²+V10²)` —— 也就是台风眼内的静风值。实测桦加沙 88% 的时次低于
热带低压下限 10.8 m/s，前端据此把超强台风显示成热带低压。

本脚本把这一列换成：
    wind[t] = max( sqrt(U10² + V10²) )  over  { 格点 g : dist(g, center[t]) <= R }

中心（lat/lon）与 psfc 原样保留 —— 它们是对的（psfc 与风场的相关系数 −0.9，
说明中心定位准确）。

用法（在服务器 ~/typhoon_workflow 下执行）
------------------------------------------
    # 1) 先看不同 R 的效果，不写文件
    python3 fix_track_wind.py --name 桦加沙 --radius-km 50,75,100,150 --dry-run

    # 2) 定好 R 之后正式生成（写到新文件，不覆盖原文件）
    python3 fix_track_wind.py --name 桦加沙 --radius-km 100 \
        --out out/桦加沙/track.windfix.json

注意
----
* 默认读取 typhoons.json 里该台风的 `wrf_file`（原场）；加 `--field corrected`
  改用 `wrf_file_corrected`（订正场）。**口径要和页面主画布一致** —— 页面默认显示原场。
* `t` 就是 WRF 的时间下标，与 extract_track.py 一致。
"""
import argparse
import json
import math
import os
import sys

import numpy as np
import xarray as xr

MIN_TD = 10.8          # 热带低压下限（国标）
KM_PER_DEG = 111.0


def nearest_index(la_grid, lo_grid, lat, lon):
    d = (la_grid - lat) ** 2 + (lo_grid - lon) ** 2
    idx = int(d.argmin())
    return np.unravel_index(idx, d.shape)


def dist_grid_km(la_grid, lo_grid, lat, lon):
    """格点到中心的大圆距离（等距圆柱近似；格点尺度 ~10 km，足够）。"""
    dy = (la_grid - lat) * KM_PER_DEG
    dx = (lo_grid - lon) * KM_PER_DEG * np.cos(np.deg2rad((la_grid + lat) / 2.0))
    return np.hypot(dx, dy)


def center_wind_old(u, v, la, lo, lat, lon):
    """复刻现有实现，用于对照。"""
    i, j = nearest_index(la, lo, lat, lon)
    return float(np.hypot(u[i, j], v[i, j]))


def max_wind_within(u, v, la, lo, lat, lon, radius_km):
    """中心 radius_km 内的最大 10m 风速。"""
    spd = np.hypot(u, v)
    d = dist_grid_km(la, lo, lat, lon)
    m = d <= radius_km
    if not m.any():                       # 兜底：半径内没有格点（不该发生）
        return center_wind_old(u, v, la, lo, lat, lon)
    return float(np.nanmax(np.where(m, spd, np.nan)))


def corr(a, b):
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    if a.size < 2 or a.std() == 0 or b.std() == 0:
        return float('nan')
    return float(np.corrcoef(a, b)[0, 1])


def grid2d(a, k):
    """XLAT/XLONG 可能是 (Time, y, x) 或 (y, x)。"""
    return a[k] if a.ndim == 3 else a


def main():
    ap = argparse.ArgumentParser(description='只重算 track[].wind（中心最近格点 -> 半径内最大）')
    ap.add_argument('--name', required=True)
    ap.add_argument('--config', default='typhoons.json')
    ap.add_argument('--track', help='输入 track JSON（默认取 config 里的 track.file）')
    ap.add_argument('--out', help='输出 track JSON（不填则按 --dry-run 处理）')
    ap.add_argument('--radius-km', default='100',
                    help='半径（km）。给逗号分隔的多个值则进入扫描模式，只打印不写文件')
    ap.add_argument('--field', choices=['orig', 'corrected'], default='orig',
                    help='用原场还是订正场的 WRF（默认 orig，与页面主画布一致）')
    ap.add_argument('--dry-run', action='store_true', help='只打印，不写文件')
    args = ap.parse_args()

    radii = [float(x) for x in str(args.radius_km).split(',') if x.strip()]
    sweep = len(radii) > 1

    with open(args.config, encoding='utf-8') as f:
        conf = json.load(f)
    cfg = conf['typhoons'][args.name]
    track_cfg = cfg.get('track', {})

    track_path = args.track or track_cfg.get('file')
    if not track_path:
        sys.exit('找不到输入 track 文件（--track 或 config 的 track.file）')
    with open(track_path, encoding='utf-8') as f:
        track = json.load(f)

    key = 'wrf_file_corrected' if args.field == 'corrected' else 'wrf_file'
    wrf = cfg.get(key) or cfg['wrf_file']
    print('台风      : %s' % args.name)
    print('输入轨迹  : %s   （%d 点，t=%d~%d）' % (track_path, len(track), track[0]['t'], track[-1]['t']))
    print('WRF 文件  : %s   （%s）' % (wrf, args.field))
    if not os.path.exists(wrf):
        sys.exit('WRF 文件不存在：%s' % wrf)

    ds = xr.open_dataset(wrf)
    u_all = ds['U10'].values
    v_all = ds['V10'].values
    la_all = ds['XLAT'].values
    lo_all = ds['XLONG'].values
    ntimes = u_all.shape[0]
    print('时间步数  : %d   网格: %s' % (ntimes, grid2d(la_all, 0).shape))
    print()

    psfc = [p['psfc'] / 100.0 for p in track]
    old = []
    new = {r: [] for r in radii}
    for p in track:
        t = int(p['t'])
        if t >= ntimes:
            sys.exit('轨迹 t=%d 超出 WRF 时间范围（%d 步）' % (t, ntimes))
        u = u_all[t]
        v = v_all[t]
        la = grid2d(la_all, t)
        lo = grid2d(lo_all, t)
        old.append(center_wind_old(u, v, la, lo, p['lat'], p['lon']))
        for r in radii:
            new[r].append(max_wind_within(u, v, la, lo, p['lat'], p['lon'], r))

    def stats(w):
        w = np.asarray(w)
        return 'r=%+.3f  值域 %.1f~%.1f  <10.8 占 %2.0f%%  峰值 t=%d' % (
            corr(psfc, w), w.min(), w.max(), 100.0 * (w < MIN_TD).mean(),
            track[int(w.argmax())]['t'])

    print('对照（r 是与中心气压的相关系数；真台风应 <= -0.8）')
    print('  现在（中心最近格点）  : %s' % stats(old))
    for r in radii:
        print('  改为 中心 %-5g km 内最大: %s' % (r, stats(new[r])))
    print()

    if sweep:
        print('扫描模式：未写文件。挑一个与官方最佳路径最大风速最接近的 R，再正式生成。')
        ds.close()
        return

    R = radii[0]
    w_new = new[R]
    # 不变量检查：新值必然 >= 旧值（旧值取自半径内的一个格点）
    bad = [(i, old[i], w_new[i]) for i in range(len(old)) if w_new[i] < old[i] - 1e-6]
    if bad:
        print('⚠ 有 %d 个点新值小于旧值（不该发生）:' % len(bad))
        for i, a, b in bad[:5]:
            print('    t=%d  old=%.1f  new=%.1f' % (track[i]['t'], a, b))

    print('抽样对照（前 8 个 + 峰值附近）')
    print('     t     中心气压   旧 wind   新 wind')
    idx = list(range(min(8, len(track))))
    pk = int(np.argmax(w_new))
    idx += [max(0, pk - 2), pk - 1, pk, pk + 1, min(len(track) - 1, pk + 2)]
    for i in sorted(set(idx)):
        print('  %5d   %8.1f   %7.1f   %7.1f' % (track[i]['t'], psfc[i], old[i], w_new[i]))
    print()

    if args.dry_run or not args.out:
        print('（--dry-run 或未给 --out：没有写文件）')
        ds.close()
        return

    out_track = []
    for i, p in enumerate(track):
        out_track.append({
            't': p['t'], 'lat': p['lat'], 'lon': p['lon'],
            'psfc': p['psfc'], 'wind': round(w_new[i], 1),
        })
    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(out_track, f, ensure_ascii=False, separators=(',', ':'))
    print('已写出: %s   （%d 点，仅 wind 一列改变）' % (args.out, len(out_track)))
    print('峰值时次: 旧 t=%d -> 新 t=%d' % (
        track[int(np.argmax(old))]['t'], track[int(np.argmax(w_new))]['t']))
    ds.close()


if __name__ == '__main__':
    main()

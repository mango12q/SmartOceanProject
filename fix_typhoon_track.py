#!/usr/bin/env python3
"""
fix_typhoon_track.py
修复台风路径数据中的突变跳变问题。

方法：
1. 用 Haversine 公式计算相邻点球面距离
2. 距离 > 2°（约 222km）处断开，分成多个段
3. 保留 PSFC < 100500 Pa 的段（实际低压系统）
4. 丢弃孤立噪点段（长度 <= 2 且 PSFC 不连续）
5. 合并有效段，输出 cleaned_track.json
"""

import json
import math
import sys

DEG_TO_KM = 111.0  # 1度纬度约111km

def haversine_deg(lat1, lon1, lat2, lon2):
    """返回两点间球面距离（单位：度）"""
    R = 6371.0  # km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat/2)**2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon/2)**2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return (R * c) / DEG_TO_KM

def split_by_distance(points, max_gap_deg=2.0):
    """按距离阈值将路径分成多个连续段"""
    if len(points) < 2:
        return [points] if points else []

    segments = []
    current = [points[0]]
    for i in range(1, len(points)):
        d = haversine_deg(points[i-1]['lat'], points[i-1]['lon'],
                          points[i]['lat'], points[i]['lon'])
        if d >= max_gap_deg:
            if len(current) >= 2:
                segments.append(current)
            current = [points[i]]
        else:
            current.append(points[i])
    if len(current) >= 2:
        segments.append(current)
    return segments

def segment_stats(seg):
    """计算段的统计特征"""
    psfc_min = min(p['psfc'] for p in seg)
    psfc_max = max(p['psfc'] for p in seg)
    wind_max = max(p['wind'] for p in seg)
    t_span = seg[-1]['t'] - seg[0]['t']
    return {
        'psfc_min': psfc_min,
        'psfc_max': psfc_max,
        'wind_max': wind_max,
        't_span': t_span,
        'length': len(seg)
    }

def is_valid_segment(seg, min_psfc=100500):
    """判断是否为有效台风段"""
    stats = segment_stats(seg)
    # 段内最低气压 < min_psfc（说明有真实低压系统）
    # 且段长度 >= 3（至少3个点，排除孤立噪点）
    # 且时间跨度 >= 2（至少跨越2个时步）
    return (stats['psfc_min'] < min_psfc and
            stats['length'] >= 3 and
            stats['t_span'] >= 2)

def clean_track(input_file, output_file, max_gap_deg=2.0, min_psfc=100500):
    with open(input_file, 'r', encoding='utf-8') as f:
        track = json.load(f)

    print(f"原始数据: {len(track)} 个点, t={track[0]['t']}~{track[-1]['t']}")

    # 按距离断开
    segments = split_by_distance(track, max_gap_deg)
    print(f"距离断开后: {len(segments)} 个段")

    # 分析每个段
    valid_segs = []
    for i, seg in enumerate(segments):
        stats = segment_stats(seg)
        valid = is_valid_segment(seg, min_psfc)
        print(f"  段{i+1}: t={seg[0]['t']}~{seg[-1]['t']}, "
              f"{len(seg)}点, "
              f"lat={seg[0]['lat']:.2f}~{seg[-1]['lat']:.2f}, "
              f"lon={seg[0]['lon']:.2f}~{seg[-1]['lon']:.2f}, "
              f"PSFCmin={stats['psfc_min']:.0f}Pa, "
              f"WINDmax={stats['wind_max']:.1f}m/s, "
              f"{'✓ 保留' if valid else '✗ 丢弃'}")
        if valid:
            valid_segs.append(seg)

    if not valid_segs:
        print("错误：没有保留任何有效段！")
        sys.exit(1)

    # 合并有效段
    cleaned = []
    for seg in valid_segs:
        cleaned.extend(seg)

    print(f"\n清理后: {len(cleaned)} 个点 (原始 {len(track)} 个, "
          f"移除 {len(track) - len(cleaned)} 个)")

    # 保存
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(cleaned, f, ensure_ascii=False, indent=2)

    print(f"已保存到: {output_file}")

    # 验证：检查是否还有大跳变
    print("\n=== 验证：检查剩余大跳变 (>2°) ===")
    jumps = []
    for i in range(1, len(cleaned)):
        d = haversine_deg(cleaned[i-1]['lat'], cleaned[i-1]['lon'],
                          cleaned[i]['lat'], cleaned[i]['lon'])
        if d >= max_gap_deg:
            jumps.append((cleaned[i-1]['t'], cleaned[i]['t'], d,
                          cleaned[i-1]['lat'], cleaned[i-1]['lon'],
                          cleaned[i]['lat'], cleaned[i]['lon']))
    if jumps:
        print(f"警告：仍有 {len(jumps)} 处跳变 >= {max_gap_deg}°:")
        for j in jumps:
            print(f"  t={j[0]}->{j[1]}: d={j[2]:.2f}°, "
                  f"({j[3]:.2f},{j[4]:.2f}) -> ({j[5]:.2f},{j[6]:.2f})")
    else:
        print(f"✓ 无跳变 >= {max_gap_deg}°，路径连续")

    return cleaned

if __name__ == '__main__':
    input_file = 'typhoon_track.json'
    output_file = 'typhoon_track_cleaned.json'
    max_gap = float(sys.argv[1]) if len(sys.argv) > 1 else 2.0
    min_p = float(sys.argv[2]) if len(sys.argv) > 2 else 100500.0
    clean_track(input_file, output_file, max_gap, min_p)

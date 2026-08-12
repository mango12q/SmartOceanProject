# 台风路径与风场计算工作流（独立模块）

本项目把“WRF 台风数据 → 台风路径 → 风场风羽 → 网页可视化”的完整工作流独立出来，
与线上网页（`/home/haike/test_web`）只通过一组稳定的接口对接。新台风数据到位后，
改一处配置、跑一条命令即可完成计算并接入可视化。

## 1. 目录结构

```text
typhoon_workflow/
├── typhoons.json        # 台风注册表（唯一的输入配置入口）
├── extract_track.py     # 台风中心路径提取（文件模式 / WRF 自动模式）
├── process_wind.py      # WRF 10m 风场 -> 逐时 msgpack 风羽 bin
├── build_registry.py    # 生成/自动更新网页 TYPHOON_DATA 注册表 JS
├── run_pipeline.py      # 一键流水线：track -> wind -> registry
├── deploy.py            # 显式部署产物到服务器
├── verify_assets.py     # 产物校验（track 完整性、bin 可解码/与参考一致）
├── requirements.txt
└── data/
    └── huajiasha.track.json   # 桦加沙已整理路径（125~249 时次，125 点）
```

## 2. 数据接口契约（与网页完全一致）

### 台风路径 `track.json`

```json
[{"t":125,"lat":16.68,"lon":128.88,"psfc":98432,"wind":6.8}, ...]
```

- `t`：相对 WRF 起报时刻的小时数（页面滑块刻度，`start + t 小时` 即北京时间显示基准）
- `lat/lon`：台风中心（度）
- `psfc`：中心海平面气压（Pa）
- `wind`：中心 10m 最大风速（m/s）

### 风场 `wind_field_XXXX.bin`

每个时次一个 MessagePack 文件，内容为数组，每条 `[lon, lat, 风速, 风向]`：

```text
[ [120.3, 19.6, 11.5, 214.3], ... ]
```

- 格点按 `subsample`（默认 5）抽样；`风速 < min_wind`（默认 5 m/s）剔除
- 风向 = `(degrees(arctan2(u, v)) + 180) % 360`（气象风向，与服务器原 `process_wind.py` 一致）
- 服务器路径：`<target>/wind_field/<name>/wind_field_XXXX.bin`（桦加沙保持历史平铺结构 `wind_field/wind_field_XXXX.bin`）

### 网页注册表 `TYPHOON_DATA`

```js
var TYPHOON_DATA = {
    '桦加沙': {
        start: new Date('2025-09-15T00:00:00Z'),
        minT: 61, maxT: 263, defaultT: 125,
        ticks: [ { t:125, label:'生成', major:true }, ... ],
        windDir: '',              // 新台风填 '台风名/'，对应 wind_field/<台风名>/
        track: [ {"t":125,"lat":16.68,...} ]
    }
};
```

`index.html` 中已有自动更新标记，`build_registry.py --patch-index` 可直接替换该块。

## 3. 工作流说明（与仓库/服务器代码的对应关系）

### 3.1 台风中心路径提取（`extract_track.py`）

对应仓库 `gen_tail.py` 与提交历史中“海洋最低 PSFC 追踪 + 登陆后涡度追踪”的方法：

- 主段（洋面阶段）：逐时取海洋区域（`HGT <= ocean_hgt_max`，默认 0）最低 `PSFC` 格点作为台风中心；
  中心风速取该格点 `U10/V10` 合成风速。
- **登陆时次自动识别**：海洋最低压跟踪中心相对上一时次位移超过 `max_jump_deg`（默认 2°）时，
  在上一中心附近 ±3° 内做局部最低压回溯（允许陆地）；若回溯中心 `HGT > land_hgt_max`（默认 0），
  判定该时次为登陆并自动切换到涡度尾段；若回溯中心仍在海上，则用局部中心继续跟踪，
  避免漂到远处另一个低压（这正是仓库历史上“南海/菲律宾误追踪”的成因）。
  不同台风的登陆时点不同也无需手工配置；也可用 `tail_from_t` 手动指定切换时次。
- 尾段（登陆后）：在 `tail_box` 内取相对涡度最大值格点（`dv/dx - du/dy`）；未配置时在全域搜索。
- 清洗：按 `track_from_t / track_to_t` 截断、剔除相邻位移 > `max_jump_deg`（默认 2°）的跳变、
  缺测时次线性插值补全。
- 文件模式：`source = "file"` 直接使用已整理路径（桦加沙即此模式），保证线上数据稳定复现。
- 每次提取同时输出 `track_meta.json`：`first_t / last_t / peak_t / landfall_t`。

### 3.2 风场处理（`process_wind.py`）

完全等价于服务器 `/home/haike/test_web/process_wind.py`：读取 WRF d02 的 `U10/V10/XLAT/XLONG`
（可选 `HGT` 做海上掩膜），抽样后写 msgpack。`verify_assets.py --reference` 可逐字节对比新旧产物。

### 3.3 可视化接入（`build_registry.py`）

生成网页 `TYPHOON_DATA` 注册表 JS；网页侧已支持按 `windDir` 加载不同台风的风场目录，
并支持顶部点击台风名切换。注册表中的刻度默认从 `track_meta.json` 自动推导
（生成 / 巅峰 / 登陆 / 消散），`ticks` 留空即可；不同登陆时次的台风会自动带上各自的登陆刻度。

## 4. 新增一个台风的完整流程

1. **放数据**：把新的 WRF d02 输出（含 `U10/V10/PSFC/HGT/XLAT/XLONG`，逐小时）放到服务器，
   例如 `/home/haike/test_web/wind_wrfout_d02_<台风>_<起报时间>`。

2. **注册**：编辑 `typhoons.json`，新增一项：

   ```json
   "杜苏芮": {
     "name": "杜苏芮",
     "wrf_file": "/home/haike/test_web/wind_wrfout_d02_杜苏芮_...",
     "start": "2025-07-24T00:00:00Z",
     "slider_min_t": 0, "slider_max_t": 263, "default_t": 120,
     "wind_dir": "杜苏芮/",
     "track": {
       "source": "auto",
       "ocean_hgt_max": 0.0,
       "tail_from_t": 234,
       "tail_box": {"lat_min": 20, "lat_max": 23, "lon_min": 107, "lon_max": 111},
       "interpolate_gaps": true,
       "max_jump_deg": 2.0
     },
     "ticks": []
   }
   ```

   `track.ticks` 留空时自动生成“生成/巅峰/消散”三点。

3. **计算**（在服务器上执行）：

   ```bash
   python3 run_pipeline.py --name 杜苏芮 --steps track,wind --out /home/haike/typhoon_workflow/out
   python3 verify_assets.py --track out/杜苏芮/track.json \
                            --wind out/杜苏芮/wind_field --range 0 263
   ```

4. **接入页面**：

   ```bash
   # 本地（或服务器）更新 index.html 注册表
   python3 build_registry.py --config typhoons.json --out out \
                             --patch-index /home/haike/test_web/index.html
   # 部署
   python3 deploy.py --name 杜苏芮 --target haike@43.154.210.202:/home/haike/test_web \
                     --key ~/.ssh/haike_deploy_ws2 --index /home/haike/test_web/index.html
   ```

5. **刷新页面**：点击顶部台风名 → 选择“杜苏芮”，路径、风场、警戒线、峰图自动切换。

## 5. 与 GitHub 仓库 / 服务器的对比结论

- 仓库 `SmartOceanProject` 保存了从零到初版的完整提交历史：路径提取（海洋最低 PSFC）、
  风场叠加（msgpack+Canvas 风羽）、方向公式修正、瓦片代理、清理误追踪段等。
- 服务器 `/home/haike/test_web` 是线上演进版：`index.html` 已扩展出风场开关、峰图、
  港口风险、测距/绘制关注区、台风切换注册表等；`process_wind.py / inspect_wrf.py /
  tile_proxy.py` 与仓库基本一致（服务器额外有高德瓦片预热与代理）。
- 本模块把上面两处的计算方法收敛为可重复执行的流水线，接口与线上页面保持一致，
  新增台风无需再手工改页面 JS。

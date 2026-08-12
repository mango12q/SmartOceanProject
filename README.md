# SmartOceanProject

基于 WRF 模式输出的交互式台风路径可视化项目。

## 项目简介

本项目用于可视化台风 "桦加沙" 的路径演化过程。通过解析 WRF 模式 d02 嵌套域的输出数据，提取海洋区域最低气压作为台风中心位置，并使用 Leaflet.js 生成交互式地图页面。

线上服务部署于 `43.154.210.202:8899`，由 `tile_proxy.py` 常驻进程提供静态文件与瓦片代理。

## 功能特性

- **交互式地图**：基于 Leaflet.js + OpenStreetMap，支持缩放与拖拽
- **台风路径**：红色虚线显示完整生命周期路径
- **时间滑块**：拖动查看任意时刻的台风位置与强度
- **气流漩涡**：台风中心三层同心圆环，直观展示气流结构
- **边界图层**：国界/海岸线（实线）+ 中国省界（虚线）
- **强度可视化**：台风中心点颜色/大小随气压变化（气压越低越强）
- **风场叠加**：逐时风羽（msgpack + Canvas），可开关
- **峰图图表**：气压/风速历史曲线
- **港口风险**：港口危险等级可视化
- **测距/关注区**：距离测量与自定义关注区域
- **多台风切换**：顶部台风名切换，路径/风场/警戒线/峰图联动
- **瓦片多源**：osm / 高德 / 卫星 / 地形底图切换

## 线上服务（服务器部署说明）

服务器目录 `~/test_web/` 结构：

```
/home/haike/test_web/
├── index.html              # 交互式地图页面（前端核心，唯一入口）
├── tile_proxy.py           # 常驻 HTTP 服务：静态文件 + 瓦片代理缓存（:8899）
├── wind_field/             # 逐时风场 msgpack 风羽数据（264 个时次，wind_field_XXXX.bin）
├── tiles/                  # 瓦片磁盘缓存（osm/gaode/satellite/terrain，按需回源）
├── data/                   # 底图边界数据（Natural Earth 国界/省界等）
├── inspect_wrf.py          # WRF 文件结构检查工具
├── process_wind.py         # WRF 10m 风场 -> 逐时 msgpack 风羽 bin
├── prewarm_gaode.py        # 高德瓦片预热脚本
└── wind_wrfout_d02_*.nc    # WRF 原始输出（约 241 MB）
```

服务管理：

```bash
# 启动（前台）
python3 tile_proxy.py

# 后台常驻
nohup python3 tile_proxy.py > /tmp/tile_proxy.log 2>&1 &
```

- 监听端口 `8899`，同时服务静态文件与 `/tiles/<layer>/<z>/<x>/<y>.png` 瓦片
- 瓦片命中缓存直接返回，未命中按层回源（osm/gaode/satellite/terrain）并写盘缓存
- 高德源使用浏览器 UA，遵循 OSM 瓦片使用政策（带联系 UA + Referer）

## ⚠️ 新台风接入流程

> **新增台风请先阅读 `~/typhoon_workflow/README.md`**
> 该文档包含完整的接口契约（track.json / wind_field bin / TYPHOON_DATA 注册表）、
> 路径提取与风场处理参数说明，以及一键流水线的全部用法。

接入新台风简要流程（详见 `typhoon_workflow/README.md`）：

1. **放数据**：把该台风时段的 WRF d02 输出文件上传到服务器
2. **注册**：编辑 `~/typhoon_workflow/typhoons.json`，新增该台风配置项
3. **计算**：`python3 run_pipeline.py --name <台风名> --steps track,wind --out out`
4. **接入页面**：`python3 build_registry.py --config typhoons.json --patch-index ...` + `deploy.py` 部署
5. **刷新页面**：顶部点击台风名切换查看

## 台风数据处理工作流（`~/typhoon_workflow/`）

独立模块，把「WRF 台风数据 → 台风路径 → 风场风羽 → 网页可视化」收敛为可重复执行的流水线：

| 文件 | 作用 |
|------|------|
| `typhoons.json` | 台风注册表（唯一的输入配置入口） |
| `extract_track.py` | 台风中心路径提取（文件模式 / WRF 自动模式） |
| `process_wind.py` | WRF 10m 风场 → 逐时 msgpack 风羽 bin |
| `build_registry.py` | 生成/自动更新网页 TYPHOON_DATA 注册表 JS |
| `run_pipeline.py` | 一键流水线：track → wind → registry |
| `deploy.py` | 显式部署产物到服务器 |
| `verify_assets.py` | 产物校验 |
| `selftest.py` | 自测 |
| `README.md` | **工作流完整文档（必读）** |

## 运维注意

- **磁盘**：当前 `/` 使用 71%（约 28G 可用）；`tiles/` 瓦片缓存约 133MB 且随浏览持续增长，需定期关注
- **备份**：`index.html` 每次改版会保留 `index.html.bak-codex-*` 备份，勿随意删除近期备份
- **服务**：`tile_proxy.py` 为单进程常驻，崩溃后需手动重启（可用 nohup 常驻 + 检查端口 8899）
- **防火墙**：需放行 TCP 8899

## 数据来源

- **模式输出**：`wind_wrfout_d02_2025-09-15_00:00:00`（WRF V4.6.1）
- **提取方法**：海洋区域（`HGT <= 0`）最低 PSFC
- **时间范围**：2025-09-15 00:00 UTC 至 2025-09-26 11:00 UTC
- **台风生命周期**：2025-09-18 20:00 至 2025-09-25 20:00（北京时），共 7 天

## 台风强度等级

根据中心气压（PSFC）划分：

| 气压范围 | 强度 |
|---------|------|
| ≤ 950 hPa | 超强台风 |
| 950-970 hPa | 强台风 |
| 970-985 hPa | 台风 |
| 985-1000 hPa | 热带风暴 |
| > 1000 hPa | 低压 |

## 技术栈

- **前端**：HTML5 + CSS3 + JavaScript (ES6+)
- **地图库**：[Leaflet.js](https://leafletjs.com/) v1.9.4
- **底图**：[OpenStreetMap](https://www.openstreetmap.org/) / 高德 / ArcGIS 卫星 / OpenTopoMap
- **边界数据**：[Natural Earth](https://www.naturalearthdata.com/) 110m 精度
- **数据提取**：Python + netCDF4 + NumPy + msgpack

## 使用方法

1. 克隆仓库：
   ```bash
   git clone https://github.com/mango12q/SmartOceanProject.git
   ```

2. 直接用浏览器打开 `index.html` 即可查看台风路径可视化。

3. 拖动底部时间滑块，查看不同时刻的台风位置与强度。

## 注意事项

- `wind_wrfout_d02_*` 为原始 WRF 输出文件（约 241 MB），已加入 `.gitignore`，需自行准备。
- 地图边界数据通过 CDN 动态加载，需联网访问。
- 时间显示为北京时间（UTC+8）。
- 线上访问使用瓦片代理（`:8899`）可避免境外瓦片源加载失败。

## License

MIT

## 作者

mango12q

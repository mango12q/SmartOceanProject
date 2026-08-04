# SmartOceanProject

基于 WRF 模式输出的交互式台风路径可视化项目。

## 项目简介

本项目用于可视化台风 "桦加沙" 的路径演化过程。通过解析 WRF 模式 d02 嵌套域的输出数据，提取海洋区域最低气压作为台风中心位置，并使用 Leaflet.js 生成交互式地图页面。

## 功能特性

- **交互式地图**：基于 Leaflet.js + OpenStreetMap，支持缩放与拖拽
- **台风路径**：红色虚线显示完整生命周期路径
- **时间滑块**：拖动查看任意时刻的台风位置与强度
- **气流漩涡**：台风中心三层同心圆环，直观展示气流结构
- **边界图层**：国界/海岸线（实线）+ 中国省界（虚线）
- **强度可视化**：台风中心点颜色/大小随气压变化（气压越低越强）

## 数据来源

- **模式输出**：`wind_wrfout_d02_2025-09-15_00:00:00`（WRF V4.6.1）
- **提取方法**：海洋区域（`HGT <= 0`）最低 PSFC
- **时间范围**：2025-09-15 00:00 UTC 至 2025-09-26 11:00 UTC
- **台风生命周期**：2025-09-18 20:00 至 2025-09-25 20:00（北京时），共 7 天

## 项目结构

```
.
├── index.html              # 交互式地图页面（可直接浏览器打开）
├── typhoon_track.json      # 台风路径数据（264 个时次）
├── AGENTS.md               # OpenCode 会话说明
└── wind_wrfout_d02_*.nc    # WRF 原始输出（已加入 .gitignore）
```

## 使用方法

1. 克隆仓库：
   ```bash
   git clone https://github.com/mango12q/SmartOceanProject.git
   ```

2. 直接用浏览器打开 `index.html` 即可查看台风路径可视化。

3. 拖动底部时间滑块，查看不同时刻的台风位置与强度。

## 技术栈

- **前端**：HTML5 + CSS3 + JavaScript (ES6+)
- **地图库**：[Leaflet.js](https://leafletjs.com/) v1.9.4
- **底图**：[OpenStreetMap](https://www.openstreetmap.org/)
- **边界数据**：[Natural Earth](https://www.naturalearthdata.com/) 110m 精度
- **数据提取**：Python + netCDF4 + NumPy

## 台风强度等级

根据中心气压（PSFC）划分：

| 气压范围 | 强度 |
|---------|------|
| ≤ 950 hPa | 超强台风 |
| 950-970 hPa | 强台风 |
| 970-985 hPa | 台风 |
| 985-1000 hPa | 热带风暴 |
| > 1000 hPa | 低压 |

## 注意事项

- `wind_wrfout_d02_*` 为原始 WRF 输出文件（约 241 MB），已加入 `.gitignore`，需自行准备。
- 地图边界数据通过 CDN 动态加载，需联网访问。
- 时间显示为北京时间（UTC+8）。

## License

MIT

## 作者

mango12q

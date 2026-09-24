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
- **手机扫码进入**：桌面端右上角「📱 手机扫码」弹出二维码，自动编码当前访问地址（可手动改址 / 复制链接），手机相机扫码即可打开同一站点（离线可用，二维码为自研内联编码器，无外部依赖）
- **手机端专用布局**：≤768px 自动切换为底部 Dock（时间轴 + 播放 + 5 个标签）+ 抽屉式面板（图层 / 工具 / 设置 / 数据 / 图例），桌面端布局与交互完全不受影响

## 移动端升级（`mobile/`）

手机端能力以「模块化源码 + 构建内联」的方式维护，避免把 4000+ 行的单文件页面越改越乱：

| 文件 | 作用 |
|------|------|
| `mobile/mobile.css` | ≤768px 专用布局（底部 Dock / Sheet / 弹层 / 安全区 / 触控目标 / 文字自适应缩放） |
| `mobile/mobile-ui.js` | 手机端交互层（构建 Dock、搬移节点、Sheet 开合、手势让位、Dock 高度同步、全屏/视口重算） |
| `mobile/i18n.js` | 中英双语引擎（`window.I18N`：精确查表 + 长串优先短语替换 + DOM 遍历 + 原文还原） |
| `mobile/i18n-dict.js` | 中→英词表（364 条，生成物；重新生成见 `.dev/gen-i18n-dict.mjs`） |
| `mobile/qr-encoder.js` | 零依赖二维码编码器（ISO/IEC 18004，byte mode UTF-8，经典脚本，`window.QRCode`） |
| `mobile/qr-popup.js` | 「手机扫码」弹窗（地址编辑 / 复制链接 / 局域网提示，仅桌面端初始化） |
| `mobile/build.py` | **把上面这些文件内联进 `index.html`**（幂等，可 `--check` 校验是否同步） |
| `mobile/mobile-ui.js` 内 `injectMobileOverrides()` | 组合层微调（手机端隐藏扫码入口、播放键宽度等实测补丁） |
| `mobile/SPEC.md` | 接口契约与验收标准（DOM 契约、断点门控、各产物职责） |
| `mobile/test-qr.mjs` | 二维码位级自检（860 断言：往返 / 全版本容量 / 8 掩码） |
| `mobile/selftest-css.mjs` | CSS 自检（30 项：括号配平、无外链、门控、选择器矩阵、Dock 高度预算 + 需求回归守卫） |
| `mobile/test-i18n.mjs` | 双语层自检（27 项：词表完整性、漏译、标签配平 + 引擎/集成回归守卫） |

> **改手机端请改 `mobile/` 下的源码，然后运行 `python mobile/build.py` 重新内联**；
> 直接改 `index.html` 的内联块会在下次构建时被覆盖。`python mobile/build.py --check` 可检测是否已同步。

验证命令：

```bash
node mobile/test-qr.mjs          # 二维码编码器自检（ALL GREEN 才可发布）
node mobile/selftest-css.mjs     # 移动端 CSS 自检（含「白框」等需求回归守卫）
node mobile/test-i18n.mjs        # 中英双语层自检（词表 + 引擎 + index.html 集成契约）
python mobile/build.py --check   # index.html 是否与 mobile/ 源码一致
```

### 移动端适配修复（2026-09，5 项）

| # | 现象 | 根因 | 处理 |
|---|------|------|------|
| 1 | **全屏后操作有 bug** | ① 进全屏不关 Sheet，设置面板继续盖住大半地图；② Dock 被 `display:none` 但 `--dock-h` 仍停在 161px，图例/测距条/关注区小窗全部悬在半空；③ 视口变化后 Leaflet 未 `invalidateSize`，瓦片画在旧范围、点击坐标整体偏移 | 进全屏自动收 Sheet；`fullscreenchange` / `visualViewport.resize` 重算 `--dock-h`（含 `:has(body.clean-mode)` 零时差兜底）并派发 `resize`；退出键避安全区、44px+ |
| 2 | **拖动地图时底部闪白框** | `.md-interacting` 给 Dock 整体加 `opacity:.55` + `translateY(12px)`：白色 Dock 半透明 → 底图与地图注记透出来；同时收起态的 `#left-panel` 只靠 `translateY(105%)` 挡不住，顶边留在视口内透出表头 | Dock 背景改纯 `#fff` 且不位移，只淡化**子元素**；`#left-panel` 收起加 `visibility:hidden`（延迟切换，不吃动画） |
| 3 | **文字不随屏幕缩放** | 根字号恒为 16px | `html.mobile-ui { font-size: clamp(15px, calc(13.9px + .53vw), 18px) }` → 320px/15.6、390px/16.0、430px/16.2、768px/18.0；桌面端双门控（媒体查询 + `.mobile-ui` 类）不生效 |
| 4 | **缺英文版与语言切换** | 无 i18n 层 | 新增 `mobile/i18n.js` + 364 条词表；`#btn-lang` 在 `#top-controls`（桌面端脱离文档流，**不推挤既有工具栏**）；覆盖静态 DOM、`title/data-tip/aria-label` 属性、动态拼接句、CSS 生成内容（`#legend::before`）；选择持久化 + `html[lang]` 同步；切回中文逐节点还原 |
| 5 | **手机界面拥挤** | Dock 19.1% 屏高、顶部快讯条与湾区标签重叠、快讯滚动字幕大半时间在屏外、Dock 时钟永远显示 `--` | Dock 161→151px；播放键 40→43px 宽、标签字号 10.6→11.5px；快讯条 46→34px 且改静态省略、与标签错开；Dock 时钟接上真实读数；里程碑标签按真实宽度排版（英文用短标签），不再糊成一团 |

> 桌面端（≥769px）保持像素级不变：`node .dev/verify-desktop.mjs` 对比升级前后的截图，
> 差异**仅限**新增的 `#btn-lang` 按钮矩形（三档分辨率 22/22 全绿）。
> 手机端验收：`node .dev/verify-mobile.mjs`（42 项）。

### 触摸/鼠标行为的两处必要修复（已内联进 `index.html` 主逻辑）

这两处不是样式问题，而是**功能在触摸设备上完全不可用**，必须在主逻辑里修：

1. **关注区矩形绘制**：原实现只监听 `map.on('mousedown'/'mousemove'/'mouseup')`。
   Leaflet 1.9 的 map 事件层**不转发 `pointer*` 事件**（容器上收得到，但内部只订阅
   `mousedown/mousemove/mouseup` 与 `touchstart/touchmove/touchend`），触摸设备也不会产生
   `mousedown` —— 结果手机端「按住拖拽画矩形」毫无反应。
   现改为在容器上直接绑定原生事件：`window.PointerEvent` 可用时走 `pointerdown/move/up/cancel`，
   否则退化为「鼠标 + 触摸」双通道；坐标由 `focusRectLatLng()` 从原生事件换算。
2. **关注区多边形绘制**：桌面靠 `dblclick` 闭合，而触摸端双击会被识别为缩放手势
   （且绘制期间 `doubleClickZoom` 已禁用），永远不会触发 `dblclick` —— 多边形无法闭合。
   现新增移动端专用浮动按钮 `#focus-done-btn`（「✓ 完成 / ✕ 取消」，触控高 44px），
   仅在 `html.mobile-ui` 下显示；桌面端仍用双击，行为不变。

回归方式（本地）：`node .dev/touch-test.mjs`（真触摸手势 21 项）与 `node .dev/mouse-test.mjs`
（桌面鼠标 8 项）——两者都必须全绿。

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

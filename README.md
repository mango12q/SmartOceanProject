# SmartOceanProject

基于 WRF 模式输出的交互式台风路径可视化项目。

> **地图合规**：本项目底图使用 **天地图**（国家地理信息公共服务平台，自带审图号
> `GS（2026）4921号`），并按《地图审核管理规定》第六条落入**不需送审**豁免。
> 页面**不自行绘制国界/省界**等政治边界，也不使用任何已知表示有误的底图源。
> 详见 [合规整改记录.md](合规整改记录.md) 与 [天地图操作方法.md](天地图操作方法.md)。

## 项目简介

本项目用于可视化台风 "桦加沙" 的路径演化过程。通过解析 WRF 模式 d02 嵌套域的输出数据，提取海洋区域最低气压作为台风中心位置，并使用 Leaflet.js 生成交互式地图页面。

线上服务部署于 `43.154.210.202:8899`，由 `tile_proxy.py` 常驻进程提供静态文件与瓦片代理。

页面为**历史个例回放**（非实时预报）：所展示的是 2025 年 9 月的历史过程回放，
不是实时气象预报或灾害性天气警报，避免触及《气象法》第二十二条的
「公众气象预报统一发布制度」。

## 功能特性

- **交互式地图**：基于 Leaflet.js + 天地图，支持缩放与拖拽
- **台风路径**：红色虚线显示完整生命周期路径
- **时间滑块**：拖动查看任意时刻的台风位置与强度
- **气流漩涡**：台风中心三层同心圆环，直观展示气流结构
- **强度可视化**：台风中心点颜色/大小随气压变化（气压越低越强）
- **风场叠加**：逐时风羽（msgpack + Canvas），可开关
- **峰图图表**：气压/风速历史曲线
- **港口风险**：港口危险等级可视化
- **测距/关注区**：距离测量与自定义关注区域
- **多台风切换**：顶部台风名切换，路径/风场/警戒线/峰图联动
- **底图双源**：天地图（行政地图，自带审图号）+ Esri 卫星影像
- **手机扫码进入**：桌面端右上角「📱 手机扫码」弹出二维码，自动编码当前访问地址（可手动改址 / 复制链接），手机相机扫码即可打开同一站点（离线可用，二维码为自研内联编码器，无外部依赖）
- **手机端专用布局**：≤768px 自动切换为底部 Dock（时间轴 + 播放 + 5 个标签）+ 抽屉式面板（图层 / 工具 / 设置 / 数据 / 图例），桌面端布局与交互完全不受影响

> 已移除：**国界/省界自绘图层**（原 Natural Earth 国界沿麦克马洪线、台湾按独立国家
> 要素描边、无十段线，违反《公开地图内容表示规范》）、**OSM 行政底图**与
> **OpenTopoMap 地形底图**（同源问题）、**高德备选底图**（直连瓦片违反其服务协议 3.5
> 且无法依法标注审图号）。详见 合规整改记录.md。

## 移动端升级（`mobile/`）

手机端能力以「模块化源码 + 构建内联」的方式维护，避免把 4000+ 行的单文件页面越改越乱：

| 文件 | 作用 |
|------|------|
| `mobile/mobile.css` | ≤768px 专用布局（底部 Dock / Sheet / 弹层 / 安全区 / 触控目标 / 文字自适应缩放） |
| `mobile/mobile-ui.js` | 手机端交互层（构建 Dock、搬移节点、Sheet 开合、手势让位、Dock 高度同步、全屏/视口重算） |
| `mobile/i18n.js` | 中英双语引擎（`window.I18N`：精确查表 + 长串优先短语替换 + DOM 遍历 + 原文还原） |
| `mobile/i18n-dict.js` | 中→英词表（**唯一权威词表**，383 条；由 `.dev/gen-i18n-dict.mjs` 生成 + 该脚本内 `ATTR_EXTRA` 的手工条目） |
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
>
> ⚠️ **`mobile/build.py` 是整块替换、不做合并**，所以只改 `index.html` 的内嵌 i18n 块是无效的：
> `mobile/i18n-dict.js` 才是权威词表。若它落后于页面文案，一次构建就会**悄悄回退**已有改动
> ——本项目真踩过：合规整改后的「【历史回放 · 非实时预报】」曾被词表里的旧「【台风快讯】」覆盖回退。
> 改完词表后跑 `python mobile/build.py`，再跑 `node .dev/check-dict.mjs` 核对两边键集一致。
>
> 词表条目的三个来源（改之前先看清该改哪里）：
> 1. `.dev/i18n-en.json` —— 扫描器主词表（大部分条目）
> 2. `.dev/gen-i18n-dict.mjs` 里的 `ATTR_EXTRA` —— **手工条目都加这里**（否则重跑生成器会丢）
> 3. `mobile/i18n-dict.js` —— 生成物，**不要手改**

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

### ⚠️ 地图合规约束（改底图前必读）

`index.html` 的「底图配置」代码块（搜 `TDT_KEY`）是底图的唯一配置入口。改动前请注意：

| 约束 | 说明 |
|---|---|
| **只允许两种底图** | 天地图（行政）与 Esri 卫星影像（纯影像） |
| **不要恢复 OSM / OpenTopoMap** | 其瓦片把藏南标为 `Arunachal Pradesh`、国界沿麦克马洪线、台湾按独立国家要素表示、无十段线，违反《公开地图内容表示规范》五（三）/七（一）/八（一）/十 |
| **不要恢复高德直连瓦片** | 违反《高德地图开放平台服务协议》3.5（禁止技术手段抓取），且官网不公开固定审图号、无法按《地图审核管理规定》第 27 条标注 |
| **不要恢复自绘国界/省界层** | 豁免前提是「未对国界、行政区域界线或范围进行编辑调整」（《地图审核管理规定》第十条），一旦叠加即豁免失效、须重新送审 |
| **`buildLandMask()` 必须保留** | 风场渲染与航线避让依赖它算陆地掩膜；它只产出内部栅格、不往地图上画线 |
| **审图号必须标注** | 已固定在地图**左下角**角标（第 27 条要求左下角）与 Leaflet 署名中；审图号变更时更新 `TDT_APPROVAL` |

坐标系：页面数据一律 **WGS-84**，仅在交给 Leaflet 绘制时经 `patchDisplayCRS()`
转换为 **GCJ-02**（天地图瓦片坐标系）。**不要修改数据本身的坐标系**，
也不要给 `L.latLng` 加转换（会二次偏移并破坏风场画布变换）。详见 合规整改记录.md 第八节。

服务器目录 `~/test_web/` 结构：

```
/home/haike/test_web/
├── index.html              # 交互式地图页面（前端核心，唯一入口）
├── tile_proxy.py           # 常驻 HTTP 服务：静态文件 + 瓦片代理缓存（:8899）
├── wind_field/             # 逐时风场 msgpack 风羽数据（264 个时次，wind_field_XXXX.bin）
├── tiles/                  # 瓦片磁盘缓存
│   ├── tdt/<Key哈希>/...   #   天地图：服务端把 vec_w 底图 + cva_w 注记合成一张 PNG
│   └── satellite/...       #   Esri 卫星影像
├── data/                   # 陆地掩膜数据（Natural Earth countries-50m.json）
├── inspect_wrf.py          # WRF 文件结构检查工具
├── process_wind.py         # WRF 10m 风场 -> 逐时 msgpack 风羽 bin
└── wind_wrfout_d02_*       # WRF 原始输出（约 241 MB）
```

服务管理：

```bash
# 启动（前台）
python3 tile_proxy.py

# 后台常驻
nohup python3 tile_proxy.py > /tmp/tile_proxy.log 2>&1 &

# 可选：本地验证时覆盖端口/缓存目录/Key
python3 tile_proxy.py 8898 /tmp/cache <你的天地图Key>
```

- 监听端口 `8899`，同时服务静态文件与 `/tiles/<layer>/<z>/<x>/<y>.png` 瓦片
- 瓦片命中缓存直接返回，未命中回源并写盘缓存；**只有 `satellite` 与 `tdt` 两层**，
  其余路径（如 `/tiles/osm/...`）一律 404，不会再取回不合规的表示
- **天地图 Key 只放在服务端** `tile_proxy.py` 的 `TDT_KEY`，不下发到浏览器
- 天地图回源**必须用浏览器 UA**（实测自定义 UA / 无 UA 会被其 WAF 403，
  表现为瓦片全部 404、底图空白）；`tiles/tdt/` 缓存目录名带 Key 哈希，换 Key 自动换缓存

> ⚠️ **`tile_proxy.py` 目前没有开机自启**（无 systemd 单元、无 crontab）。
> 服务器重启后地图会挂，需手动重启。systemd 单元模板见
> [天地图操作方法.md](天地图操作方法.md) 四点五节。

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

- **磁盘**：`tiles/` 瓦片缓存随浏览持续增长（天地图瓦片为 vec+cva 合成，
  单张约 20~50 KB，比原 OSM 瓦片大），需定期关注
- **备份**：`index.html` / `tile_proxy.py` 每次改版会保留
  `*.bak-<时间戳>-<说明>` 备份，勿随意删除近期备份
- **服务**：`tile_proxy.py` 为单进程常驻，**崩溃或服务器重启后需手动重启**
  （无开机自启，见上文）；重启后检查端口 8899
- **防火墙**：需放行 TCP 8899
- **换天地图 Key**：改 `tile_proxy.py` 的 `TDT_KEY` 后重启即可；
  旧 Key 的 `tiles/tdt/<旧哈希>/` 缓存可删（换 Key 会自动换目录，不会串号）

## 数据来源

| 数据 | 来源 | 许可 / 说明 |
|---|---|---|
| 模式输出 | `wind_wrfout_d02_2025-09-15_00:00:00`（WRF V4.6.1） | 自有成果 |
| 台风路径提取 | 海洋区域（`HGT <= 0`）最低 PSFC | 自研方法 |
| 行政底图 | [天地图](https://www.tianditu.gov.cn/)（国家地理信息公共服务平台） | 审图号 `GS（2026）4921号`（甲测资字 11110974）；命中《地图审核管理规定》第六条**不需送审**豁免 |
| 卫星影像 | Esri World Imagery | `Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community`（非商业用途许可，需署名） |
| 陆地掩膜 | [Natural Earth](https://www.naturalearthdata.com/) 1:50m | 公有领域 |

- **时间范围**：2025-09-15 00:00 UTC 至 2025-09-26 11:00 UTC
- **台风生命周期**：2025-09-18 20:00 至 2025-09-25 20:00（北京时），共 7 天
- 本页**不自行绘制国界、省界**等政治边界，边界表示以天地图经审核批准的内容为准

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
- **地图库**：[Leaflet.js](https://leafletjs.com/) v1.9.4（BSD-2-Clause）
- **底图**：天地图（行政，自带审图号）/ Esri 卫星影像
- **坐标**：数据层 WGS-84；展示层经 `patchDisplayCRS()` 转 GCJ-02（匹配天地图瓦片）
- **陆地掩膜**：[Natural Earth](https://www.naturalearthdata.com/) 1:50m（公有领域）
- **数据提取**：Python + netCDF4 + NumPy + msgpack
- **图例内已列全部开源许可**：Leaflet(BSD-2) / topojson-client(ISC) /
  html2canvas(MIT) / @msgpack/msgpack(ISC) / 自研 QR 编码器(MIT)

## 使用方法

1. 克隆仓库：
   ```bash
   git clone https://github.com/mango12q/SmartOceanProject.git
   ```

2. 直接用浏览器打开 `index.html` 即可查看台风路径可视化。

3. 拖动底部时间滑块，查看不同时刻的台风位置与强度。

## 注意事项

- `wind_wrfout_d02_*` 为原始 WRF 输出文件（约 241 MB），已加入 `.gitignore`，需自行准备。
- **天地图 Key 不在版本库里**：`index.html` 的 `TDT_KEY` 保持为空，
  线上由服务端 `tile_proxy.py` 持有并使用（瓦片经同源 `/tiles/tdt/` 下发，Key 不下发浏览器）。
  临时验证可加 URL 参数 `?tk=你的Key` 走直连模式。
- **页面的"历史回放 · 非实时预报"声明位于滚动快讯条内**，关掉快讯后页面上不再显示。
  若将来接入**实时数据**，性质即变为公众气象预报发布，须另行取得发布主体授权。
- 陆地掩膜数据 `data/countries-50m.json` 经同源加载，需随站点一起部署。
- 时间显示为北京时间（UTC+8）。
- 线上访问必须走瓦片代理（`:8899`）：天地图瓦片由服务端合成并缓存，
  既避免 Key 外泄，也让比赛/会展现场**断网时已缓存区域仍可显示**。

## 本地验证工具（`.dev/`，已 gitignore）

| 脚本 | 作用 |
|---|---|
| `.dev/check-syntax.mjs` | 校验 `index.html` 全部内联 `<script>` 语法（带引号状态机切标签，能正确处理跨行 importmap） |
| `.dev/check-dict.mjs` | 校验内嵌 `__I18N_DICT` 是否为合法 JS 并能取到词条（防「对象里混注释」导致 i18n 静默失效） |
| `.dev/check-gcj.mjs` | 校验 WGS-84→GCJ-02 转换，基准取自 eviltransform 官方测试夹具 |
| `.dev/jig-proxy.py` | 本地测试台：静态文件优先本地、其余回源线上，浏览器只发同源请求 |
| `.dev/verify-page.mjs` | 页面端到端验证（底图、审图号、Key 不泄露、改名生效等） |

推荐一次性跑完（全部 exit 0 才算通过）：

```bash
node .dev/check-syntax.mjs index.html
node .dev/check-dict.mjs
node .dev/check-gcj.mjs index.html
node mobile/test-qr.mjs && node mobile/selftest-css.mjs && node mobile/test-i18n.mjs
python mobile/build.py --check
```

> `.dev/` 下另有大量历史界面回归脚本（`verify-mobile.mjs` / `touch-test.mjs` /
> `page-check.mjs` 等）。这些都需要 `playwright-core` 与本机 Chrome，
> 先准备一个带该依赖的目录再运行（Node 的 ESM 解析看**脚本所在目录**）。

## License

MIT

## 作者

mango12q

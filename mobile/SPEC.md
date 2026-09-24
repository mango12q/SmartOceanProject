# 移动端升级 · 实现规范（v1，Lead 冻结）

> 本文件是唯一契约。所有实现方必须严格遵守；如需偏离，先回报 Lead 再改。
> 目标文件产出后由 Lead 统一内联进 `index.html`（offline 单文件交付）。

---

## 0. 铁律（违反即作废）

1. **不得修改 `index.html`**（由 Lead 独自集成）。
2. **不得引入任何外部依赖 / CDN / 网络请求**（离线站）。
3. **不得改动桌面端行为**（≥769px 必须与升级前像素级一致）。
4. 不得新建 `vendor/` 内的文件（该目录被 .gitignore 忽略，不在仓库里）。
5. 不使用 ES module 作为产物形态：`qr-encoder.js`、`mobile-ui.js` 都是**经典脚本**（`<script src>` 直插可用，内联后亦可用），只能挂一个全局名，不得污染其它全局。
6. 代码风格与 `index.html` 一致：ES5 语法为主（`var`/`function`），不依赖构建工具，不需要 polyfill。

---

## 1. 现场事实（已核实，勿再假设）

- `index.html` = 4462 行，单文件；CSS 在 `<style>`（第 9–777 行）；DOM 第 779–1011 行；
  经典脚本 1013–1015（leaflet / topojson / html2canvas）；importmap 1016–1022；
  主逻辑 `<script type="module">` 1023–4460。
- 主逻辑只监听 `DOMContentLoaded`；**DOM ready 之后才初始化**。
- 现有的响应式断点仅有 `@media (max-width: 768px)`（678–687 行）与 `(max-width: 480px)`（689–702 行），
  只改了少量位置，**没有**移动端布局体系。
- **没有** JS 移动端判定；**没有**触摸事件处理。
- 风场是**静态风羽 Canvas**（`drawWindFieldOnCanvas`，3288 行起，风羽间距 `spacing=35px` 网格去重），
  **不存在粒子动画 / requestAnimationFrame 粒子系统** —— 任何“粒子密度减半”的说法都是错的。
- `devicePixelRatio` 已被 8 处 canvas 直接使用（1593/1741/2157/2334/3185/3848 等）。
- 关注区小窗（`#focus-window`）已有 `pointerdown` 拖拽 + 缩放：
  仅 `#focus-window-header` 与 `#focus-window-resize` 响应，`setPointerCapture` 已限定，**不要改这段 JS**。
- 本地站点无法直接跑：`vendor/*`、`data/*`、`wind_field/*` 都不在仓库（.gitignore / 体积原因）。
  Lead 已从线上 `http://43.154.210.202:8899/` 拉取到 `.dev/site/` 作为本地测试站。

### 必须保留的稳定 id / class（JS 强依赖，共 89 个 getElementById）

| 区域 | id |
|---|---|
| 顶栏 | `title`（含 `.title-name`、`#typhoon-menu`、`#history-list`）、`top-controls`、`layer-switcher`（按钮 `[data-layer=osm/satellite/terrain]`） |
| 工具 | `tool-controls`、`btn-measure`、`btn-focus`、`focus-menu`、`btn-focus-rect`、`btn-focus-poly`、`btn-clean`、`btn-clean-exit`、`btn-lock`、`btn-watch`、`btn-fit`、`btn-chart`、`btn-hazard`、`btn-shot`、`btn-compare`、`btn-multi`、`vs-menu`、`btn-zoom-in`、`btn-zoom-out` |
| 时间 | `time-panel`、`time-display`、`time-slider`、`time-ticks`、`playback-row`、`playback-controls`、`btn-start/prev/play/next/end/loop`、`speed-select`、`wind-row`、`wind-toggle`、`wind-opacity`、`wind-opacity-value`、`diff-legend` |
| 面板 | `left-panel`、`left-panel-toggle`、`left-panel-close`、`left-panel-content`、`left-panel-tbody`、`time-search-row`、`time-date-btn`、`time-date-panel`、`time-date-calendar` |
| 浮层 | `legend`、`legend-modal`、`legend-close`、`news-ticker`、`ticker-text`、`news-ticker-close`、`eye-coord`、`gba-label`、`compare-legend`、`compare-select`、`compare-menu`、`hazard-radar`（+`-header/-close/-pos/-body/-canvas/-values/-compare-row/-legend/-note`）、`history-chart`（+`-title/-legend/-canvas/-current/-toggle`）、`measure-info`、`measure-text`、`measure-clear`、`measure-done`、`focus-window`（+`-header/-close/-map/-resize`） |

> **重排 DOM 是允许的**（JS 只按 id 取节点），但**不得删除**任何 id，也不得改 id/class 名。

---

## 2. 产物 A：`mobile/mobile.css`（负责人：teammate `mobile-css`）

### 2.1 形态与门控

- 纯 CSS 文件，**所有规则**必须包在：
  ```css
  @media (max-width: 768px) {
    html.mobile-ui { ... }
  }
  ```
  外层断点保证桌面端零影响；`html.mobile-ui` 由 JS 加上（双保险，也用于真机/模拟器一致）。
- 文件首行注释 `/* mobile.css — inlined into index.html by Lead; do not reference externally */`。
- **禁止** `@import`、外部字体、`url(http...)`。
- 允许覆盖既有 768/480 规则（本文件在 `<style>` 末尾内联，靠后即生效）。

### 2.2 必须实现的布局（Lead 已冻结的信息架构）

1. **底部 Dock**（`#mobile-dock`，由 JS 创建，见 §3）：固定 `bottom:0`，全宽，
   内边距含 `env(safe-area-inset-bottom)`；分两行：
   - 行1 `.md-time`：`#eye-coord`（小字，可省略在窄屏）+ `#playback-controls` + `#speed-select`
   - 行2 `.md-slider`：`#time-slider`（触控高 ≥32px，拇指加大）+ `#time-ticks`
   - 行3 `.md-tabs`：`.md-tab` ×5（`data-tab` = `layers|tools|settings|data|legend`），
     每个 `.md-tab` 触控高度 **≥48px**，含图标（emoji 或 SVG inline）+ 文字标签（≥10px）
   - Dock 总高（不含 safe-area）**≤ 168px**；提供变量 `--dock-h` 供其它规则使用。
2. **时间面板去重**：手机端 `#time-panel` 内的 `#time-slider/#time-ticks/#playback-row/#time-display`
   已被 JS 搬进 Dock，残留容器必须不占位：
   `#time-panel { position: static; ... }` 且其中的 `#wind-row`/`#diff-legend` 隐藏
   （风场开关/透明度改由「设置」面板提供，见 §3.4）。
3. **面板改为底部 Sheet**（`.md-sheet`，JS 加 class）：
   - `#left-panel`：`position:fixed; left:0; right:0; bottom:var(--dock-h); height:60vh;`
     `transform: translateY(105%)` 收起 → `translateY(0)` 打开（`.open`），
     顶部居中拖拽条 `.md-grabber`（20px 高，视觉 4px 圆角条），
     内部 `#left-panel-content` 可滚动、表格可横向滚动（`overflow-x:auto`），
     `#left-panel-header` 保留关闭按钮且触控 ≥44px。
   - `#left-panel-toggle`：手机端隐藏（入口在 Dock `data-tab="data"`）。
4. **顶部**：`#title` 移到 `top:8px` 居中、字号 0.95rem、最大宽度 `calc(100vw - 96px)` 且文字省略；
   `#top-controls` 右上角只保留必要项，`#layer-switcher` 隐藏（入口在图层 Sheet）。
5. **弹出菜单改为底部弹层**（这些元素现在是 `position:absolute` 展开到右侧，手机上会溢出屏幕，
   必须全部改为居中/底部固定）：`#focus-menu`、`#vs-menu`、`#compare-menu`、`#typhoon-menu`、`#compare-legend`。
   统一：`position:fixed; left:8px; right:8px; bottom:calc(var(--dock-h) + 8px); top:auto; transform:none;`
   条目触控高 ≥44px，字体 ≥0.85rem。
6. **`#hazard-radar`**：全宽底部 Sheet（`left/right:8px`），`#hazard-radar-body` 改纵向（`flex-direction:column`），
   `#hazard-radar-canvas` 改为 `width:100%; max-width:340px; height:auto`（**不要**只改 flex 值，
   canvas 有 `width/height` 属性，需允许 CSS 缩放），`max-height: calc(100vh - var(--dock-h) - 70px)`，内部滚动。
7. **`#history-chart`**：`left:8px; right:8px; top:64px; width:auto;`，canvas 宽度自适应（`width:100%; height:88px`）。
8. **`#legend`**：保持圆形缩略按钮（沿用现有 480px 方案的精神），位置 `right:8px; bottom:calc(var(--dock-h) + 8px)`；
   点击走 `#legend-modal`（已有），modal 内容 `max-height:72vh`、字号放大到可读。
9. **`#news-ticker`**：`left:8px; right:8px; transform:none; max-width:none; min-width:0;`
   位置在 `#title` 下方（`top:52px`）；字号 0.72rem。
10. **`#gba-label`**：`top:52px; left:8px;`，字号 0.72rem，不能与 `#title` 重叠。
11. **`#measure-info`**：`position:fixed; left:8px; right:8px; bottom:calc(var(--dock-h) + 8px);` 横排不换行，
    按钮触控 ≥40px。
12. **`#focus-window`**：`left:8px; right:8px; width:auto; height:38vh; bottom:calc(var(--dock-h) + 8px);`
    仅首次打开生效（JS 已记录用户拖拽后的 left/top，避免二次覆盖）；把手尺寸加到 ≥20px。
13. **`#eye-coord`**：手机端字号 0.78rem，白底描边保持可读（Dock 行1 内）。
14. **触控目标**：所有 `button`、`.md-tab`、`.vs-item`、`.compare-item`、`.history-item`、`.cal-cell`
    最小 `min-height:44px`（Dock 标签 ≥48px）；`touch-action: manipulation`；
    禁用 `:hover` 依赖（`:hover` 样式在 `@media (hover:hover)` 内，或在移动端改为 `.active`）。
15. **不遮挡地图手势**：Dock/Sheet 是 `#map` 的兄弟节点，`#map` 永远 `touch-action:none`（Leaflet 需要），
    上述浮层默认 `pointer-events` 正常，但**不得**出现覆盖全屏且透明的容器（会吞掉地图手势）。
16. **安全区**：Dock 底部 `padding-bottom: calc(10px + env(safe-area-inset-bottom))`；
    所有 `bottom: calc(var(--dock-h) + Npx)` 的定位取 `--dock-h` 值时需包含安全区
    （JS 会写入真实像素值，CSS 提供 fallback `--dock-h: 150px`）。
17. **横屏/矮屏**（`max-height: 480px`）：Dock 压缩为单行标签栏（隐藏 `.md-slider` 行，时间滑块移入「设置」？——
   不，横屏时把 `#time-slider` 放回 Dock 行1，`#playback-controls` 收紧到 32px），保证地图可用高度 ≥55vh。
18. **性能**：不使用 `backdrop-filter` 于大面积元素（手机上掉帧），Dock/Sheet 用不透明或 0.98 透明度纯色；
    不使用 `box-shadow` 大模糊（≤12px）。

### 2.3 交付与自检

- 交付：`mobile/mobile.css`。
- 自检：写 `mobile/selftest-css.mjs`（node，零依赖）：
  1. 括号/大括号配平；2. 无 `@import`/`http`/`url(` 外链；3. 断点数量与 `html.mobile-ui` 前缀覆盖检查；
  4. 打印规则条目数。运行 `node mobile/selftest-css.mjs` 必须全绿。
- 报告：文件路径、规则条数、自检输出、你对不确定点的 3 条以内说明。

---

## 3. 产物 B：`mobile/mobile-ui.js`（负责人：Lead）

经典脚本，唯一全局 `window.MobileUI`。职责：

1. `matchMedia('(max-width: 768px)')` 判定 → `html.mobile-ui` 类（随媒体查询变化实时同步，桌面分辨率下不激活任何东西）。
2. 构建 `#mobile-dock`，并把下列节点**移动**进 Dock（保留原 id、保留原事件监听）：
   `#eye-coord`、`#playback-controls`、`#speed-select`、`#time-slider`、`#time-ticks`。
3. 5 个 Sheet：`layers`（搬 `#layer-switcher` 的按钮克隆或整块）、`tools`（搬 `#tool-controls` 内按钮）、
   `settings`（风场开关 `#wind-toggle`、透明度 `#wind-opacity`、截图、洁净模式、锁定风眼、复位、强弱演变图、灾害雷达）、
   `data`（开关 `#left-panel`）、`legend`（开关 `#legend-modal`）。
   —— **注意**：搬移按钮节点会连带其事件监听一起走（DOM 移动不丢监听），因此**搬原节点，不要克隆**；
   唯一例外：`#layer-switcher` 里的按钮监听是 `data-layer` 委托在父级，需整体搬移或搬父节点。
4. `--dock-h` 实际像素写入 `document.documentElement.style`；窗口尺寸/方向变化时重算（resize/orientationchange）。
5. 地图手势优先：`map` 不能拿到实例（主逻辑在 module 闭包里），因此用 DOM 事件：
   `#map` 上 `touchstart` → `html.md-interacting`（Dock 半透明/下沉 12px），`touchend` 1.2s 后恢复。
6. Sheet 开关：点击 `.md-tab` 切换对应 Sheet；再次点击关闭；`Escape` 关闭；点蒙层（JS 建的 `.md-scrim`）关闭；
   打开 Sheet 时 `html` 加 `.md-sheet-open`。
7. 保证与主逻辑零冲突：不读写主逻辑变量，不 dispatch 伪造 click 之外的行为；**需要触发按钮功能时直接 `.click()` 原按钮**。
8. 幂等：脚本可能被重复执行（内联 + 静态双份），用 `window.__mobileUiReady` 守卫。

## 4. 产物 C：`mobile/qr-encoder.js`（负责人：teammate `qr`）

### 4.1 接口（冻结）

```js
// 经典脚本；UMD 风格：Node 下 module.exports，浏览器下 window.QRCode
// 返回：{ size: number, modules: Uint8Array /* size*size, 1=黑 */, version: number, ecLevel: 'L'|'M'|'Q'|'H', mask: number }
QRCode.encode(text, opts)   // opts: { ecLevel: 'M' 默认, minVersion: 1, maxVersion: 40 }
QRCode.render(canvasOrCtx, text, opts) // opts 额外: { margin: 4, dark:'#000', light:'#fff', scale: 'auto' }
```

- 只支持 **byte mode（UTF-8）**，覆盖 URL/中文路径即可。
- 自动选最小可容纳版本；超容量时 `throw new Error('QR: data too long')`。
- 必须实现：模式指示符/字符计数（版本 1–9：8bit 长度 8 位；10–26：16 位；27–40：16 位）、
  终止符、补位（`0xEC/0x11`）、RS 纠错分块与交织、矩阵功能图形（定位/校正/时序/暗模块/格式信息/版本信息）、
  8 种掩码 + 罚分选优、格式信息 BCH(15,5) + 固定掩码 `0x5412`。
- `render` 用 canvas 2d，整数像素对齐（`scale = Math.max(2, Math.floor(size/(modules+2*margin)))`），
  输出必须**锐利**（`imageSmoothingEnabled=false`，逐模块 `fillRect`），
  并设置 `canvas.style.width/height` 使其在 HiDPI 下由 CSS 尺寸决定显示大小。
- 文件头必须写明算法来源与许可（MIT / 自研，注明基于 ISO/IEC 18004 实现）。

### 4.2 必测（验收门槛）

1. `node mobile/test-qr.mjs` —— 位级往返自检：编码 → 按标准顺序读回模块 → 反交织 → 去填充 → 还原 UTF-8 文本，
   必须与输入完全一致；覆盖 **ecLevel L/M/Q/H × 短 URL / 150 字符长 URL / 中文 URL**（≥12 组）。
2. `node mobile/test-qr.mjs --emit` → 输出 `.dev/qr-cases.json`（每例：text、version、ec、size、modules 位串）。
3. 独立解码交叉验证（Lead 复核）：Python + `opencv-python-headless`（QRCodeDetector）对渲染图解码，
   必须与输入文本一致；若 cv2 不可用则退化为 §4.2.1 的确定性校验 + PIL 渲染人工比对。
4. 边界：空串（抛错或编码空串，明确行为）、超长（抛错）、`https://` 与含中文/`&`/`#` 的 URL 正确。

## 5. 集成（Lead）

- 把 A/B/C 内联进 `index.html`：CSS 追加到 `<style>` 末尾（标记 `/* === MOBILE:CSS:BEGIN/END === */`）；
  JS 以 `<script>` 插在**主 module 之前**（标记 `/* === MOBILE:JS:BEGIN/END === */`、`/* === QR:JS:BEGIN/END === */`）。
- `index.html` 内的显式改动仅限：viewport meta、`#top-controls` 增加扫码按钮 `#btn-qr`、
  新增扫码弹窗容器 `#qr-modal`、以及上述三处内联标记。
- 生成脚本 `mobile/build.py`（零依赖 python）：从 `mobile/*` 重新生成 `index.html` 的内联块，
  **幂等**（重复运行结果一致），供后续维护。

## 6. 验收（全部通过才算完成）

| # | 项 | 方法 | 门槛 |
|---|---|---|---|
| 1 | QR 位级正确 | `node mobile/test-qr.mjs` | 全绿 |
| 2 | QR 真解码 | python cv2 解码渲染图 | 12/12 一致 |
| 3 | 桌面零回归 | 1440×900 / 1024×768 截图对比升级前 | 无差异（除新增扫码按钮） |
| 4 | 移动布局 | 390×844 / 360×800 / 768×1024 截图 | 无重叠、无溢出、Dock ≤168px |
| 5 | 功能对应 | 手机视口下逐个触发：图层3、测距、关注区2、对比、警戒线、雷达、双台风、截图、锁定、复位、图表、播放5键、速度、透明度 | 与桌面行为一致 |
| 6 | 触控目标 | 计算 `getBoundingClientRect()` | ≥44px（Dock ≥48px） |
| 7 | 离线合规 | 浏览器 Network 面板 / 资源清单 | 零外部域名请求 |
| 8 | 无报错 | console | 无 error |
| 9 | 扫码实测 | 手机相机扫描桌面端二维码 | 能打开站点且 URL 与输入一致 |

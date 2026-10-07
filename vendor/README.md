# vendor/ —— 第三方前端库（本地与线上共用）

页面通过 `<script src="vendor/…">`、`<link href="vendor/leaflet.css">` 与 `importmap`
引用这些库。**2026-10-07 之前它们不在版本库里**，只存在于服务器
`/home/haike/test_web/vendor/`，后果是 `git clone` 之后本地根本跑不起来
（打开 `index.html` 会因为缺少 Leaflet 而整页空白），「单文件离线交付」也就无法本地复现。
现在入库，`index.html` 可以直接离线打开。

| 文件 | 用途 | 大小 | 引入方式 |
|---|---|---|---|
| `leaflet.js` / `leaflet.css` | 地图内核 | 144 KB / 14 KB | `<head>` **同步**外链（不能加 defer：后面的内联经典脚本会立刻用到 `L`） |
| `topojson-client.min.js` | 把 `countries-50m.json` 的 TopoJSON 转成 GeoJSON，供 `buildLandMask()` 算陆地掩膜 | 7 KB | `<head>` 同步外链 |
| `msgpack.mjs` | 解 `wind_field/*.bin` 风场 | 25 KB | `importmap` 的 `@msgpack/msgpack`，主 module 静态 import |
| `html2canvas.min.js` | 截图导出 | 194 KB | **按需注入**：点击「截图」才下载（主 module 的 `loadHtml2canvas()`），首屏不再等它 |

## 来源与更新建议

这些文件是 2026-10-07 从线上站点原样取回的，**没有版本号、没有哈希记录、也没有配套的
上游 LICENSE 文件**。足以在本机跑通，但不适合长期依赖。建议后续：

1. 从各上游官方发布页取对应版本（Leaflet 1.9.x、topojson-client 3.x、
   `@msgpack/msgpack` 2.x、html2canvas 1.4.x）；
2. 在 `vendor/` 下同时放入各自的 LICENSE；
3. 把实际版本号补进上表；
4. 换完跑一遍 `node .dev/page-check.mjs --url …`（真实 Chrome 无头加载），确认页面
   `errors=0`。

## 边界

`vendor/` 只放通用前端库。**不要**把底图瓦片、地名数据或任何带审图号的内容放进来 ——
底图只允许天地图（自带审图号）与 Esri 卫星影像，且瓦片一律走 `tile_proxy.py` 代理，
不进版本库。

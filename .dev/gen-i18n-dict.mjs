/**
 * gen-i18n-dict.mjs — 生成 mobile/i18n-dict.js（可内联的 window.__I18N_DICT）
 *
 * 输入: .dev/i18n-en.json      （子代理翻译的 263 条主词表）
 *       .dev/i18n-inventory.json（扫描结果，用于补齐属性值）
 * 输出: mobile/i18n-dict.js
 *
 * 为什么需要补充：扫描器的 htmlAttr 键是 "title=关闭" 这种复合形式，
 * 而运行时查到的是**属性值本身**（'关闭'）。不补齐的话 42 条 title/data-tip 全部漏译。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const inv = JSON.parse(readFileSync('.dev/i18n-inventory.json', 'utf8'));
const base = JSON.parse(readFileSync('.dev/i18n-en.json', 'utf8'));
const CN = /[\u4e00-\u9fa5]/;

/* 属性值补充词条（人工翻译，与主词表同风格） */
const ATTR_EXTRA = {
  '全屏': 'Fullscreen',
  '原场/订正场': 'Original/Corrected',
  '双台风对比': 'Compare typhoons',
  '复位视图': 'Reset view',
  '强度演变': 'Intensity trend',
  '循环播放': 'Loop playback',
  '截图导出': 'Export PNG',
  '放大': 'Zoom in',
  '测距': 'Measure',
  '灾害预警': 'Hazard alert',
  '绘制关注区': 'Draw focus area',
  '缩小': 'Zoom out',
  '警戒线': 'Warning lines',
  '锁定风眼': 'Lock eye',
  '关闭': 'Close',
  '关闭快讯': 'Close bulletin',
  '前进一帧': 'Next frame',
  '原场/订正场风场对比': 'Original / corrected wind field',
  '台风强度演变图': 'Typhoon intensity trend chart',
  '后退一帧': 'Previous frame',
  '回到起点': 'Go to start',
  '复位到台风全路径视野': 'Reset to full track view',
  '循环播放开关': 'Toggle loop playback',
  '截图导出当前画面为PNG': 'Export the current view as PNG',
  '手机扫码进入离线网站': 'Open this offline site on a phone (scan QR)',
  '折叠/展开': 'Collapse / expand',
  '拖拽绘制矩形关注区域': 'Drag to draw a rectangular focus area',
  '播放/暂停': 'Play / pause',
  '播放速度': 'Playback speed',
  '显示/隐藏24、48小时警戒线': 'Show / hide the 24 h and 48 h warning lines',
  '点击地图测距，双击结束': 'Click the map to measure distance; double-click to finish',
  '绘制关注区域': 'Draw a focus area',
  '绘制多边形关注重点区域，双击闭合': 'Draw a polygon focus area; double-click to close',
  '跳到终点': 'Go to end',
  '选择要对比的台风': 'Select a typhoon to compare',
  '锁定台风风眼，视图跟随台风': 'Lock the typhoon eye and follow it',
  '风场透明度': 'Wind field opacity',

  /* ---- 手工补充条目（不来自扫描器，必须留在这里，否则重跑本脚本会丢）----
     1) 「收起全部浮层」等整串精确条目：按钮的 title / aria-label 是整串
        「收起全部浮层」，而词表只有「收起」，t() 落到短语替换只命中前半截 →
        英文下露出 "Hide全部浮层"。补整串精确条目，exact 表优先命中。
     2) 合规整改（2026-09-30）新增：底图来源与开源许可区块、审图号角标、相关按钮 / 词条。
     3) 合规整改改写的文案：「【历史个例回放】」「【历史回放 · 非实时预报】」
        （旧的「【台风快讯】」条目已从 i18n-en.json 中删除，勿再加回）。
     4) 已删除图层（国界/海岸线、省界、地形图）的死条目已从 i18n-en.json 删除。 */
  '收起全部浮层': 'Hide all overlays',
  '分析图表': 'Charts',
  '收起': 'Hide',
  '【历史个例回放】加载中...': '[Historical replay] Loading...',
  '【历史个例回放】台风"': '[Historical replay] Typhoon "',
  '【历史回放 · 非实时预报】台风"': '[Historical replay · not a live forecast] Typhoon "',
  '台山核电科普基地（对外开放）': 'Taishan Nuclear Power Science Education Base (open to the public)',
  '大亚湾核电科普基地（对外开放）': 'Daya Bay Nuclear Power Science Education Base (open to the public)',
  '大鹏LNG能源科普参观基地（对外开放）': 'Dapeng LNG Energy Science Education & Visitor Base (open to the public)',
  '数据来源': 'Data sources',
  '开源许可': 'Open-source licences',
  '行政底图：国家地理信息公共服务平台「天地图」，审图号 GS（2026）4921号（甲测资字 11110974）。':
    'Administrative basemap: Tianditu, the National Platform for Common Geospatial Information Services. Map approval number GS(2026)4921 (surveying and mapping qualification no. 11110974).',
  '卫星影像：Esri World Imagery（Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community）。':
    'Satellite imagery: Esri World Imagery (Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community).',
  '陆地掩膜：Natural Earth 1:50m（公有领域）。风场与台风数据：WRF 模式输出，经本项目自研订正算法处理。':
    "Land mask: Natural Earth 1:50m (public domain). Wind field and typhoon data: WRF model output, processed by this project's own correction algorithm.",
  '本页不自行绘制国界、省界等政治边界，边界表示以底图服务商经审核批准的内容为准。':
    'This page does not draw national or provincial boundaries itself; boundary representation follows the reviewed and approved content of the basemap service provider.',
  'Leaflet 1.9.4 — BSD-2-Clause，(c) 2010-2023 Vladimir Agafonkin，(c) 2010-2011 CloudMade':
    'Leaflet 1.9.4 — BSD-2-Clause, (c) 2010-2023 Vladimir Agafonkin, (c) 2010-2011 CloudMade',
  'topojson-client — ISC License，(c) 2012-2016 Mike Bostock': 'topojson-client — ISC License, (c) 2012-2016 Mike Bostock',
  'html2canvas — MIT License，(c) 2012 Niklas von Hertzen': 'html2canvas — MIT License, (c) 2012 Niklas von Hertzen',
  '@msgpack/msgpack — ISC License，(c) 2016 Yusuke Kawasaki': '@msgpack/msgpack — ISC License, (c) 2016 Yusuke Kawasaki',
  'QR 编码器为本项目自研实现（MIT 许可，依据 ISO/IEC 18004）。':
    "The QR encoder is this project's own implementation (MIT licence, based on ISO/IEC 18004).",
  '审图号 GS（2026）4921号（甲测资字 11110974）': 'Map approval no. GS(2026)4921',
  '未配置天地图 Key': 'Tianditu key not configured',
  '⚠ 行政底图未配置': '⚠ Administrative basemap not configured',
  '需先在 index.html 的 TDT_KEY 处填入天地图 Key': 'Fill in the Tianditu key at TDT_KEY in index.html first',
  '手机扫码进入': 'Scan the QR code to open on your phone',
  '点击查看详情': 'Click for details',
  /* 合规整改改名后，旧名已成为新名的子串。生成器的「从 HTML 片段派生纯文本词条」
     会把它们当独立条目带回来，故在此显式覆盖为同一句，保证语义一致
     （属词表内部冗余，页面不引用；.dev/check-dict.mjs 会识别为「非孤儿」）。 */
  '台山核电站': 'Taishan Nuclear Power Science Education Base (open to the public)',
  '大亚湾核电基地': 'Daya Bay Nuclear Power Science Education Base (open to the public)',
  '大鹏LNG接收站': 'Dapeng LNG Energy Science Education & Visitor Base (open to the public)',
};

/* 扫描器在裸 '>' 处拆坏的整串文本节点（必须整串收录，才能精确命中） */
const BROKEN_FIX = {
  '台风路径（按强度分段着色，两点间距>3°断开）':
    'Typhoon track (coloured by intensity; broken where points are more than 3° apart)',
};

/* 台风历史菜单的「首字徽标」（.history-ico 取 name.charAt(0)）—— 单字只在精确匹配生效 */
const INITIAL_FIX = { '桦': 'R', '山': 'M', '杜': 'D' };

/* ---------------------------------------------------------------- 实体 */
const ENT = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': '\u00a0' };
const decode = (s) => s.replace(/&(lt|gt|amp|quot|#39|nbsp);/g, (m) => ENT[m]);

/* ------------------------------------------------------------------------
 * 关键补丁：词表里有很多**整段 HTML 片段**的键
 *   "<div class=\"legend-route-title\">航线影响等级</div>" → "...Route impact level..."
 * 但运行时 t() 收到的是**纯文本节点** '航线影响等级'，永远匹配不到那个片段键
 * → 图例里的「航线影响等级 / 重点目标危险等级 / 风速比例尺（m/s）/ I 低 / 蓝<17.1」
 *   在英文模式下原样残留（实测 18 条）。
 * 这里自动把每个 HTML 片段键拆出内部文本节点，按位置与译文片段一一配对，
 * 生成「纯文本 → 纯文本」的补充词条。
 * ---------------------------------------------------------------------- */
const TEXT_NODE_RE = /[^<>]+/g;
function innerTexts(html) {
  const out = [];
  for (const m of html.matchAll(TEXT_NODE_RE)) out.push(decode(m[0]));
  return out;
}
const derived = {};
let derivedOk = 0, derivedSkip = 0;
for (const [zh, en] of Object.entries(base)) {
  if (!/[<>]/.test(zh)) continue;
  const zhNodes = innerTexts(zh);
  const enNodes = innerTexts(en);
  if (zhNodes.length !== enNodes.length) { derivedSkip++; continue; }
  for (let i = 0; i < zhNodes.length; i++) {
    const z = zhNodes[i], e = enNodes[i];
    if (!CN.test(z)) continue;
    if (z in base) continue;              // 主词表已有，别覆盖
    if (z in derived) continue;
    derived[z] = e;
    derivedOk++;
  }
}

/* ------------------------------------------------------------------------
 * 实体别名：扫描器是从 HTML 源码里取的键，实体还是 `&lt;` 原样
 *   "蓝&lt;17.1" → 而 DOM 文本节点已经是解码后的 "蓝<17.1"
 * 不做别名的话这些条目在运行时永远命不中（实测：预警阈值 4 条残留中文）。
 * ---------------------------------------------------------------------- */
const alias = {};
let aliasOk = 0;
for (const [zh, en] of Object.entries(base)) {
  const dz = decode(zh), de = decode(en);
  if (dz === zh && de === en) continue;
  if (dz in base || dz in alias) continue;
  alias[dz] = de;
  aliasOk++;
}
console.log('[i] 实体别名（&lt; 等）: ' + aliasOk + ' 条');

const dict = {};
for (const k of Object.keys(base)) dict[k] = base[k];
for (const k of Object.keys(ATTR_EXTRA)) dict[k] = ATTR_EXTRA[k];
for (const k of Object.keys(BROKEN_FIX)) dict[k] = BROKEN_FIX[k];
for (const k of Object.keys(INITIAL_FIX)) dict[k] = INITIAL_FIX[k];
for (const k of Object.keys(derived)) dict[k] = derived[k];
for (const k of Object.keys(alias)) dict[k] = alias[k];

console.log('[i] 从 HTML 片段派生纯文本词条: ' + derivedOk + ' 条（' + derivedSkip + ' 个片段节点数不匹配，跳过）');

/* ---------- 自检：属性值必须全部可查 ---------- */
const missing = [];
for (const kv of inv.htmlAttr) {
  const v = kv.slice(kv.indexOf('=') + 1);
  if (CN.test(v) && !(v in dict)) missing.push(v);
}
if (missing.length) {
  console.error('[!!] 属性值仍缺词条: ' + JSON.stringify(missing));
  process.exit(1);
}

/* ---------- 输出 ---------- */
const lines = [
  '/* mobile/i18n-dict.js — 中→英词表（window.__I18N_DICT）',
  ' * ---------------------------------------------------------------------------',
  ' * 由 .dev/gen-i18n-dict.mjs 生成，请勿手改：',
  ' *   基础词表 .dev/i18n-en.json（263 条，覆盖 HTML 文本节点 + JS 字符串字面量）',
  ' *   + 属性值补充 ' + Object.keys(ATTR_EXTRA).length + ' 条（title / data-tip / aria-label… 的**值**）',
  ' *   + 扫描器拆分修复 ' + Object.keys(BROKEN_FIX).length + ' 条',
  ' *   + 台风首字徽标 ' + Object.keys(INITIAL_FIX).length + ' 条',
  ' *   + 从 HTML 片段派生的纯文本词条 ' + derivedOk + ' 条（运行时拿到的是文本节点，不是片段）',
  ' *   + 实体别名 ' + aliasOk + ' 条（源码 &lt; ↔ 运行时 <）',
  ' * 共 ' + Object.keys(dict).length + ' 条。',
  ' * 重新生成：node .dev/gen-i18n-dict.mjs',
  ' */',
  'window.__I18N_DICT = ' + JSON.stringify(dict, null, 2) + ';',
  '',
];
writeFileSync('mobile/i18n-dict.js', lines.join('\n'), 'utf8');
console.log('[ok] mobile/i18n-dict.js 词条 ' + Object.keys(dict).length + ' 条，' +
  (readFileSync('mobile/i18n-dict.js').length) + ' 字节');

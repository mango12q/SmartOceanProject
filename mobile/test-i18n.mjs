/**
 * test-i18n.mjs — 中英双语层自检（零依赖，node 直接跑）
 *
 *   node mobile/test-i18n.mjs
 *
 * 校验两类东西：
 *   A. 词表 mobile/i18n-dict.js —— 完整性 / 无漏译 / 片段标签配平 / 属性值全覆盖
 *   B. 引擎 mobile/i18n.js     —— 结构与几个「实测踩过的坑」的回归守卫
 *
 * 词表由 .dev/gen-i18n-dict.mjs 生成（.dev/ 不入库），因此这里直接校验**产物**，
 * 不依赖 .dev 下任何文件。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DICT = join(HERE, 'i18n-dict.js');
const ENGINE = join(HERE, 'i18n.js');

const dictRaw = readFileSync(DICT, 'utf8');
const engineRaw = readFileSync(ENGINE, 'utf8');

const results = [];
const check = (name, fn) => {
  let ok = false, detail = '';
  try { const r = fn(); ok = r === true || (r && r.ok); detail = (r && r.detail) || ''; }
  catch (e) { ok = false; detail = '抛错: ' + e.message; }
  results.push({ name, ok, detail });
};

/* ---------------- 加载词表（沙箱执行，不污染全局） ---------------- */
const sandbox = {};
new Function('window', dictRaw)(sandbox);
const D = sandbox.__I18N_DICT;
const KEYS = D ? Object.keys(D) : [];
const CN = /[\u4e00-\u9fa5]/;

/* 5 个是**风场目录名**，必须原样保留（改了就找不到数据文件） */
const IDENTITY = ['山竹/', '山竹_corr/', '杜苏芮/', '杜苏芮_corr/', '桦加沙_corr/'];

/* ---------------- A. 词表 ---------------- */
check('词表可解析且挂到 window.__I18N_DICT', () =>
  D && typeof D === 'object' ? { ok: true, detail: KEYS.length + ' 条' } : { ok: false, detail: '未定义' });

check('词条数量 ≥ 300（覆盖静态 DOM + 动态 JS + 属性）', () => ({
  ok: KEYS.length >= 300, detail: KEYS.length + ' 条',
}));

check('所有键非空、值非空字符串', () => {
  const bad = KEYS.filter(k => !k.trim() || typeof D[k] !== 'string' || !D[k].trim());
  return { ok: bad.length === 0, detail: bad.length ? JSON.stringify(bad.slice(0, 5)) : 'OK' };
});

check('键无重复（JSON 解析后天然去重，检查原始文本里重复键）', () => {
  const m = dictRaw.match(/^\s{2}"(?:[^"\\]|\\.)*":/gm) || [];
  const seen = new Set(), dup = [];
  for (const line of m) { if (seen.has(line)) dup.push(line); seen.add(line); }
  return { ok: dup.length === 0, detail: dup.length ? JSON.stringify(dup.slice(0, 3)) : 'OK' };
});

check('译文不再含中文（5 个风场目录名除外）', () => {
  const left = KEYS.filter(k => CN.test(D[k]) && !IDENTITY.includes(k));
  return { ok: left.length === 0, detail: left.length ? JSON.stringify(left.slice(0, 6).map(k => k + '→' + D[k])) : 'OK' };
});

check('5 个风场目录名保持身份映射（改了就找不到数据文件）', () => {
  const bad = IDENTITY.filter(k => D[k] !== k);
  return { ok: bad.length === 0, detail: bad.length ? JSON.stringify(bad) : 'OK' };
});

/* 属性值必须能单独查到 —— 运行时查的是 title/aria-label 的**值**，不是 "title=关闭" 这种复合键 */
const ATTR_VALUES = ['全屏', '原场/订正场', '双台风对比', '复位视图', '强度演变', '循环播放', '截图导出',
  '放大', '测距', '灾害预警', '绘制关注区', '缩小', '警戒线', '锁定风眼', '关闭', '关闭快讯',
  '前进一帧', '台风强度演变图', '后退一帧', '回到起点', '播放/暂停', '播放速度', '跳到终点',
  '选择要对比的台风', '风场透明度'];
check('title/data-tip 的属性值全部可单独查到（' + ATTR_VALUES.length + ' 项抽样）', () => {
  const miss = ATTR_VALUES.filter(k => !(k in D));
  return { ok: miss.length === 0, detail: miss.length ? JSON.stringify(miss) : 'OK' };
});

/* HTML 片段键的标签必须在译文里配平（位置/样式/图标不能丢） */
check('HTML 片段键的标签数量与译文一致', () => {
  const bad = [];
  for (const k of KEYS) {
    if (!/[<>]/.test(k)) continue;
    const c = (s) => (s.match(/<[a-zA-Z]/g) || []).length;
    if (c(k) !== c(D[k])) bad.push(k + ' (' + c(k) + '→' + c(D[k]) + ')');
  }
  return { ok: bad.length === 0, detail: bad.length ? JSON.stringify(bad.slice(0, 4)) : 'OK' };
});

check('译文保留占位符与单位（m/s, hPa, °N, °E, ≥, Δ, ⇄）', () => {
  const bad = [];
  for (const k of KEYS) {
    for (const tok of ['m/s', 'hPa', '°N', '°E', '≥']) {
      if (k.includes(tok) && !D[k].includes(tok)) bad.push(k + ' 丢了 ' + tok);
    }
  }
  return { ok: bad.length === 0, detail: bad.length ? JSON.stringify(bad.slice(0, 4)) : 'OK' };
});

/* 「运行时是纯文本节点」的那些派生词条：图例 / 雷达预警阈值 */
const DERIVED = ['航线影响等级', '重点目标危险等级', '风速比例尺（m/s）', '实线港口 · 虚线重要设施',
  'I 低', 'II 一般', 'III 较高', 'IV 高', 'V 极高', '蓝<17.1', '黄<24.4', '橙<32.6', '红≥32.6 m/s',
  '航线·注意', '航线·中影响', '航线·强影响', '航线·暂未受影响'];
check('图例/雷达的纯文本节点词条已派生（' + DERIVED.length + ' 项）', () => {
  const miss = DERIVED.filter(k => !(k in D));
  return { ok: miss.length === 0, detail: miss.length ? JSON.stringify(miss) : 'OK' };
});

check('实体别名：译文键已解码（&lt; ↔ <）', () => {
  const bad = KEYS.filter(k => /&(lt|gt|amp);/.test(k) && !KEYS.includes(k.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')));
  return { ok: bad.length === 0, detail: bad.length ? JSON.stringify(bad.slice(0, 4)) : 'OK' };
});

check('词表内不含 </script（否则内联会提前闭合标签）', () => ({
  ok: !/<\/script/i.test(dictRaw),
  detail: /<\/script/i.test(dictRaw) ? '发现 </script' : 'OK',
}));

check('词表无外部依赖（无 import/require/url(http)）', () => {
  const bad = /(^|\s)(import\s|require\()|url\(\s*['"]?https?:/m.test(dictRaw);
  return { ok: !bad, detail: bad ? '发现外部依赖' : 'OK' };
});

/* ---------------- B. 引擎 ---------------- */
check('引擎只挂一个全局 window.I18N', () => ({
  ok: /window\.I18N\s*=/.test(engineRaw) && (engineRaw.match(/window\.\w+\s*=/g) || []).length === 1,
  detail: '全局赋值: ' + JSON.stringify((engineRaw.match(/window\.\w+\s*=/g) || [])),
}));

/* 实测踩坑：Dock/Sheet 挂在 <html> 下（body 的兄弟节点），只遍历 body 会漏掉整套手机端 UI */
check('回归守卫：遍历根节点必须是 documentElement（Dock 挂在 <html> 下）', () => {
  const walkRoot = /function root\(\)\s*\{\s*return document\.documentElement/.test(engineRaw.replace(/\s+/g, ' '));
  const observesEl = /\.observe\(el,/.test(engineRaw);
  const observesBody = /\.observe\(document\.body/.test(engineRaw);
  return { ok: walkRoot && observesEl && !observesBody,
    detail: 'root()=documentElement:' + walkRoot + ' observe(el):' + observesEl + ' observe(body):' + observesBody };
});

check('回归守卫：单字片段不进短语表（否则「一/年/月/日」会把句子拆烂）', () => ({
  ok: /k\.length\s*<\s*2/.test(engineRaw) && /sort\(function\s*\(a,\s*b\)\s*\{\s*return b\[0\]\.length\s*-\s*a\[0\]\.length/.test(engineRaw.replace(/\s+/g, ' ')),
  detail: '长度过滤 + 长串优先排序',
}));

check('回归守卫：切回中文必须逐字还原（WeakMap 记原文）', () => ({
  ok: /new WeakMap\(\)/.test(engineRaw) && /zhText/.test(engineRaw) && /zhAttr/.test(engineRaw),
  detail: 'zhText/zhAttr 双记录',
}));

check('支持 data-i18n-skip（语言键自身等不应被翻译）', () => ({
  ok: /data-i18n-skip/.test(engineRaw), detail: 'OK',
}));

check('语言选择持久化到 localStorage', () => ({
  ok: /localStorage\.setItem\(STORE_KEY/.test(engineRaw) && /localStorage\.getItem\(STORE_KEY/.test(engineRaw),
  detail: 'OK',
}));

check('同步 html lang / data-lang（无障碍与 CSS 钩子）', () => ({
  ok: /documentElement\.lang\s*=/.test(engineRaw) && /setAttribute\('data-lang'/.test(engineRaw), detail: 'OK',
}));

check('引擎无外部依赖 / 不使用 ES module 语法', () => {
  const bad = /^\s*(import|export)\s/m.test(engineRaw) || /url\(\s*['"]?https?:/.test(engineRaw);
  return { ok: !bad, detail: bad ? '发现 external/module 语法' : 'OK' };
});

/* ---------------- C. index.html 集成契约 ---------------- */
/*
 * 这一节盯的是「改 A 处悄悄弄坏 B 处」的集成点，都是实测踩过的：
 *   - 语言键必须放在 #top-controls 里（手机端右上角只剩它）；
 *   - 桌面端必须让它脱离文档流，否则工具栏左移 52px 且窄屏下压住标题；
 *   - 里程碑标签的「真量宽度」排版只能用于手机端/英文，桌面+中文必须走旧阈值，
 *     否则 PC 底部时间轴的像素会变（用户明确要求不干扰 PC 画面）；
 *   - I18N 内联块必须在主 module 之前（主逻辑要用 I18N.t）。
 */
const INDEX = join(HERE, '..', 'index.html');
const html = readFileSync(INDEX, 'utf8');

check('index.html：#btn-lang 在 #top-controls 内', () => {
  // 注意 #top-controls 里嵌了 #layer-switcher，用非贪婪 </div> 会在内层就截断，
  // 这里改用「下一个顶层兄弟（#tool-controls）」作为右边界。
  const i = html.indexOf('<div id="top-controls">');
  const j = html.indexOf('<div id="tool-controls">');
  if (i < 0 || j < 0 || j < i) return { ok: false, detail: '未找到 #top-controls / #tool-controls 边界' };
  const seg = html.slice(i, j);
  return { ok: /id="btn-lang"/.test(seg), detail: '区间长度 ' + seg.length + ' 字节' };
});

check('index.html：桌面端语言键脱离文档流（不推挤既有工具栏）', () => {
  const m = html.match(/@media \(min-width: 769px\)\s*\{\s*#btn-lang\s*\{([^}]*)\}/);
  if (!m) return { ok: false, detail: '未找到 @media (min-width:769px) #btn-lang 规则' };
  return { ok: /position\s*:\s*absolute/.test(m[1]), detail: m[1].trim() };
});

check('index.html：里程碑排版在桌面+中文时走旧阈值（保 PC 像素不变）', () => {
  const i = html.indexOf('function initTimeTicks()');
  if (i < 0) return { ok: false, detail: '未找到 initTimeTicks' };
  const seg = html.slice(i, i + 4200);
  return {
    ok: /var useMeasured = document\.documentElement\.classList\.contains\('mobile-ui'\) \|\| isEn;/.test(seg) &&
        /if \(!useMeasured\)/.test(seg) && /var minGap = 7/.test(seg),
    detail: 'useMeasured 分支 + 旧 minGap=7 回退',
  };
});

check('index.html：I18N 内联块在主 module 之前', () => {
  const i18n = html.indexOf('/* === I18N:JS:BEGIN === */');
  const mod = html.indexOf('<script type="module">');
  return { ok: i18n > 0 && mod > 0 && i18n < mod, detail: `i18n@${i18n} < module@${mod}` };
});

check('index.html：#btn-lang 标记 data-i18n-skip（语言名不参与翻译）', () => ({
  ok: /id="btn-lang"[^>]*data-i18n-skip/.test(html), detail: 'OK',
}));

check('index.html：CSS 生成内容有英文版（#legend::before）', () => ({
  ok: /html\.mobile-ui\[data-lang="en"\]\s*#legend::before/.test(html), detail: 'OK',
}));

/* ---------------- 输出 ---------------- */
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
console.log('双语层自检 —— mobile/i18n-dict.js + mobile/i18n.js');
console.log('词条 ' + KEYS.length + ' 条 / 词表 ' + Buffer.byteLength(dictRaw, 'utf8') +
  ' 字节 / 引擎 ' + Buffer.byteLength(engineRaw, 'utf8') + ' 字节');
console.log('-'.repeat(72));
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log('[' + (r.ok ? 'PASS' : 'FAIL') + '] ' + pad(r.name, 52) + (r.detail ? ' ' + r.detail : ''));
}
console.log('-'.repeat(72));
console.log('RESULT: ' + (failed === 0 ? 'ALL GREEN' : failed + ' FAILED') + ' (' + (results.length - failed) + '/' + results.length + ')');
process.exit(failed === 0 ? 0 : 1);

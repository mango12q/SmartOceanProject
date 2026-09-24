#!/usr/bin/env node
/**
 * selftest-css.mjs — mobile/mobile.css 零依赖自检（SPEC §2.3）
 *
 * 检查项：
 *   1. 首行内联来源注释
 *   2. 括号配平：{} / () / []
 *   3. 无外链：@import / http(s) / url(...) / @font-face / src:
 *   4. 门控：顶层只允许 @media (max-width:768px)；所有规则以 html.mobile-ui 前缀
 *   5. --dock-h fallback、env(safe-area-inset-bottom)、.md-scrim 默认不可见
 *   6. SPEC §2.2 十八条的必需选择器覆盖
 *   7. Dock 高度预算 ≤168px（按文件中的数值静态估算）
 *   8. 打印规则条目数 / 声明数 / 断点清单
 *
 * 用法：node mobile/selftest-css.mjs      （全绿退出码 0，任一失败退出码 1）
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = join(HERE, 'mobile.css');

/* ---------------------------------------------------------------- 解析器 */

/** 去掉注释与字符串内容之外的一切不变，返回块树 */
function parse(css) {
  const root = { prelude: '', body: '', nodes: [], kind: 'root' };
  const stack = [root];
  let buf = '';
  let i = 0;
  let negativeDepth = false;

  const top = () => stack[stack.length - 1];

  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < css.length && css[j] !== quote) {
        if (css[j] === '\\') j++;
        j++;
      }
      buf += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '{') {
      const node = { prelude: buf.trim(), body: '', nodes: [], kind: 'block' };
      top().nodes.push(node);
      stack.push(node);
      buf = '';
      i++;
      continue;
    }
    if (c === '}') {
      if (stack.length === 1) negativeDepth = true;
      else {
        const node = stack.pop();
        node.body = buf;
        node.kind = node.prelude.startsWith('@') ? 'at-rule' : 'rule';
      }
      buf = '';
      i++;
      continue;
    }
    if (c === ';' && stack.length === 1) {
      buf = '';
      i++;
      continue;
    }
    buf += c;
    i++;
  }

  return {
    root,
    unclosed: stack.length - 1,
    negativeDepth,
    trailing: buf.trim(),
  };
}

/** 递归收集 rule/at-rule 节点（带祖先链） */
function walk(node, out = [], chain = []) {
  for (const child of node.nodes) {
    out.push({ node: child, chain });
    walk(child, out, chain.concat(child.prelude));
  }
  return out;
}

/** 拆顶层逗号选择器（忽略括号内的逗号） */
function splitSelectors(prelude) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of prelude) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function countDeclarations(body) {
  if (!body || !body.trim()) return 0;
  return body
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && s.includes(':')).length;
}

/* ------------------------------------------------------------ 断言框架 */

const results = [];
function check(name, fn) {
  let ok = false;
  let detail = '';
  try {
    const r = fn();
    if (r === true || r === undefined) ok = true;
    else if (r === false) ok = false;
    else if (r && typeof r === 'object') {
      ok = !!r.ok;
      detail = r.detail || '';
    }
  } catch (err) {
    ok = false;
    detail = '异常: ' + (err && err.message ? err.message : String(err));
  }
  results.push({ name, ok, detail });
  return ok;
}

/* ------------------------------------------------------------------ 主流程 */

const raw = readFileSync(CSS_PATH, 'utf8');
const noComments = raw.replace(/\/\*[\s\S]*?\*\//g, ' ');
const parsed = parse(raw);
const all = walk(parsed.root);

const topLevel = parsed.root.nodes;
const rules = all.filter((x) => x.node.kind === 'rule');
const atRules = all.filter((x) => x.node.kind === 'at-rule');

/* 1. 首行注释 ------------------------------------------------------------- */
check('§2.1 首行内联来源注释', () => {
  const first = raw.split('\n')[0].trim();
  const want = '/* mobile.css — inlined into index.html by Lead; do not reference externally */';
  return { ok: first === want, detail: first === want ? '' : '实际: ' + first };
});

/* 2. 括号配平 ------------------------------------------------------------- */
check('§2.3.1 {} 大括号配平', () => ({
  ok: parsed.unclosed === 0 && !parsed.negativeDepth && parsed.trailing === '',
  detail:
    'unclosed=' + parsed.unclosed + ' negative=' + parsed.negativeDepth +
    (parsed.trailing ? ' trailing=' + JSON.stringify(parsed.trailing.slice(0, 40)) : ''),
}));

check('§2.3.1 () [] 配平', () => {
  let paren = 0;
  let bracket = 0;
  let minParen = 0;
  let minBracket = 0;
  const src = noComments;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (c === '[') bracket++;
    else if (c === ']') bracket--;
    if (paren < minParen) minParen = paren;
    if (bracket < minBracket) minBracket = bracket;
  }
  return {
    ok: paren === 0 && bracket === 0 && minParen >= 0 && minBracket >= 0,
    detail: '圆括号=' + paren + ' 方括号=' + bracket,
  };
});

/* 3. 无外链 --------------------------------------------------------------- */
check('§2.3.2 无 @import / @font-face', () => {
  const bad = [];
  if (/@import\b/i.test(noComments)) bad.push('@import');
  if (/@font-face\b/i.test(noComments)) bad.push('@font-face');
  if (/\bsrc\s*:/i.test(noComments)) bad.push('src:');
  return { ok: bad.length === 0, detail: bad.join(',') };
});

check('§2.3.2 无 http(s):// 外链', () => {
  const hits = noComments.match(/https?:\/\//gi) || [];
  return { ok: hits.length === 0, detail: '命中 ' + hits.length + ' 处' };
});

check('§2.3.2 url() 仅允许 data:', () => {
  const urls = noComments.match(/url\(\s*([^)]*)\)/gi) || [];
  const bad = urls.filter((u) => !/^url\(\s*['"]?data:/i.test(u));
  return { ok: bad.length === 0, detail: bad.join(' | ') };
});

/* 4. 门控 ---------------------------------------------------------------- */
check('§2.1 顶层只有 @media (max-width:768px)', () => {
  const bad = topLevel.filter(
    (n) => n.kind !== 'at-rule' || !/^@media\s*\(\s*max-width\s*:\s*768px\s*\)$/i.test(n.prelude.replace(/\s+/g, ' '))
  );
  return {
    ok: topLevel.length > 0 && bad.length === 0,
    detail: '顶层块 ' + topLevel.length + ' 个，违规: ' + bad.map((n) => n.prelude.slice(0, 30)).join(' | '),
  };
});

check('§2.1 每条规则以 html.mobile-ui 前缀', () => {
  const bad = [];
  for (const { node, chain } of rules) {
    if (chain.some((p) => /^@keyframes/i.test(p))) continue; // 关键帧内部选择器豁免
    const sels = splitSelectors(node.prelude);
    if (!sels.length) bad.push('(空选择器)');
    for (const s of sels) {
      if (!/^html\.mobile-ui(\b|[.:#\s>+~\[])/.test(s) && s !== 'html.mobile-ui') bad.push(s);
    }
  }
  return { ok: bad.length === 0, detail: bad.slice(0, 6).join(' | ') };
});

check('§2.1 所有规则都嵌在 768px 断点内', () => {
  // 顶层块已由上一项校验；这里要求每条样式规则、每个嵌套断点的祖先链里都有 768px 媒体查询
  const inGate = (chain) =>
    chain.some((p) => /^@media\s*\(\s*max-width\s*:\s*768px\s*\)$/i.test(p.replace(/\s+/g, ' ')));
  const bad = all
    .filter((x) => (x.node.kind === 'rule' || x.chain.length > 0) && !inGate(x.chain))
    .map((x) => x.node.prelude.slice(0, 40));
  return { ok: bad.length === 0, detail: bad.slice(0, 4).join(' | ') };
});

/* 5. 变量 / 安全区 / 蒙层 ------------------------------------------------- */
check('§2.2.16 --dock-h fallback', () => /--dock-h\s*:\s*\d+px/.test(noComments));

check('§2.2.16 env(safe-area-inset-bottom) 用于 Dock 下内边距', () =>
  /#mobile-dock\s*\{[^}]*env\(\s*safe-area-inset-bottom/.test(noComments.replace(/\s+/g, ' ')) ||
  /padding\s*:[^;]*env\(\s*safe-area-inset-bottom/.test(noComments)
);

check('§2.2.15 .md-scrim 默认 display:none', () =>
  /\.md-scrim\s*\{[^}]*display\s*:\s*none/.test(noComments.replace(/\s+/g, ' '))
);

check('§2.2.6 #hazard-radar-canvas 允许 CSS 缩放(!important)', () => {
  const m = noComments.replace(/\s+/g, ' ').match(/#hazard-radar-canvas\s*\{([^}]*)\}/);
  if (!m) return { ok: false, detail: '未找到规则' };
  const body = m[1];
  return {
    ok: /width\s*:\s*100%\s*!important/.test(body) && /height\s*:\s*auto\s*!important/.test(body),
    detail: body.trim().slice(0, 120),
  };
});

check('§2.2.12 #focus-window 定位不用 !important（交由 hookFocusWindow 清 inline）', () => {
  const blocks = [...noComments.replace(/\s+/g, ' ').matchAll(/#focus-window\s*\{([^}]*)\}/g)].map((m) => m[1]);
  if (!blocks.length) return { ok: false, detail: '未找到规则' };
  const joined = blocks.join(' ; ');
  const important = [...joined.matchAll(/([a-z-]+)\s*:[^;]*!important/g)].map((m) => m[1]);
  const need = {
    left: /(?:^|;)\s*left\s*:\s*8px/,
    right: /(?:^|;)\s*right\s*:\s*8px/,
    width: /(?:^|;)\s*width\s*:\s*auto/,
    height: /(?:^|;)\s*height\s*:\s*36vh/,
    bottom: /(?:^|;)\s*bottom\s*:\s*calc\(var\(--dock-h\) \+ 8px\)/,
    'min-width': /(?:^|;)\s*min-width\s*:\s*0/,
  };
  const missing = Object.entries(need).filter(([, re]) => !re.test(joined)).map(([k]) => k);
  return {
    ok: important.length === 0 && missing.length === 0,
    detail: (important.length ? '仍带 !important: ' + important.join(',') : '') +
      (missing.length ? ' 缺失: ' + missing.join(',') : ''),
  };
});

check('§3.3 .md-sheet 由 CSS 定位显隐（Lead 冻结）', () => {
  const flat = noComments.replace(/\s+/g, ' ');
  const m = flat.match(/\.md-sheet\s*\{([^}]*)\}/);
  if (!m) return { ok: false, detail: '未找到 .md-sheet 规则' };
  const body = m[1];
  const need = {
    'position:fixed': /position\s*:\s*fixed/,
    'left:0': /(?:^|;)\s*left\s*:\s*0/,
    'right:0': /(?:^|;)\s*right\s*:\s*0/,
    'bottom:0': /(?:^|;)\s*bottom\s*:\s*0/,
    'max-height:min(72vh,560px)': /max-height\s*:\s*min\(72vh,\s*560px\)/,
    'transform:translateY(105%)': /transform\s*:\s*translateY\(105%\)/,
    'visibility:hidden': /visibility\s*:\s*hidden/,
    'safe-area padding': /padding-bottom\s*:[^;]*env\(\s*safe-area-inset-bottom/,
  };
  const missing = Object.entries(need).filter(([, re]) => !re.test(body)).map(([k]) => k);
  const openOk = /\.md-sheet\.open\s*\{[^}]*transform\s*:\s*translateY\(0\)[^}]*visibility\s*:\s*visible/.test(flat);
  const bodyOk = /\.md-sheet-body\s*\{[^}]*overflow-y\s*:\s*auto/.test(flat);
  const hitOk = !/\.md-grabber[^{]*\{[^}]*pointer-events\s*:\s*none/.test(flat) &&
    !/\.md-sheet-head[^{]*\{[^}]*pointer-events\s*:\s*none/.test(flat);
  return {
    ok: missing.length === 0 && openOk && bodyOk && hitOk,
    detail: (missing.length ? '缺失: ' + missing.join(',') + ' ' : '') +
      (openOk ? '' : '.open 展开态缺失 ') + (bodyOk ? '' : '.md-sheet-body 滚动缺失 ') +
      (hitOk ? '' : '拖拽区被 pointer-events:none 关闭'),
  };
});

check('§3.6 #md-scrim 默认 display:none 且由 html.md-sheet-open 显示', () => {
  const flat = noComments.replace(/\s+/g, ' ');
  return {
    ok: /#md-scrim[^{]*\{[^}]*display\s*:\s*none/.test(flat) &&
      /\.md-sheet-open\s+#md-scrim[^{]*\{[^}]*display\s*:\s*block/.test(flat),
    detail: '',
  };
});

/* 6. 覆盖矩阵 ------------------------------------------------------------ */
const COVERAGE = [
  ['§2.2.1 Dock 容器', '#mobile-dock'],
  ['§2.2.1 Dock 行1', '.md-time'],
  ['§2.2.1 Dock 行2', '.md-slider'],
  ['§2.2.1 Dock 行3', '.md-tabs'],
  ['§2.2.1 Dock 标签', '.md-tab'],
  ['§2.2.2 #time-panel 不占位', '#time-panel'],
  ['§2.2.2 隐藏 #wind-row', '#wind-row'],
  ['§2.2.2 隐藏 #diff-legend', '#diff-legend'],
  ['§2.2.3 底部 Sheet', '#left-panel'],
  ['§2.2.3 拖拽条', '.md-grabber'],
  ['§2.2.3 表格横向滚动', '#left-panel-content'],
  ['§2.2.3 隐藏面板开关', '#left-panel-toggle'],
  ['§2.2.4 标题', '#title'],
  ['§2.2.4 右上控件', '#top-controls'],
  ['§2.2.4 隐藏图层切换', '#layer-switcher'],
  ['§2.2.5 关注区菜单', '#focus-menu'],
  ['§2.2.5 双台风菜单', '#vs-menu'],
  ['§2.2.5 对比菜单', '#compare-menu'],
  ['§2.2.5 台风选择菜单', '#typhoon-menu'],
  ['§2.2.5 对比图例', '#compare-legend'],
  ['§2.2.6 灾害雷达', '#hazard-radar'],
  ['§2.2.6 雷达纵向', '#hazard-radar-body'],
  ['§2.2.6 雷达画布', '#hazard-radar-canvas'],
  ['§2.2.7 强度演变图', '#history-chart'],
  ['§2.2.7 演变图画布', '#history-chart-canvas'],
  ['§2.2.8 图例圆按钮', '#legend'],
  ['§2.2.8 图例弹窗', '#legend-modal'],
  ['§2.2.8 弹窗内容', '#legend-modal-content'],
  ['§2.2.9 快讯条', '#news-ticker'],
  ['§2.2.10 大湾区标签', '#gba-label'],
  ['§2.2.11 测距条', '#measure-info'],
  ['§2.2.12 关注区小窗', '#focus-window'],
  ['§2.2.12 把手', '#focus-window-resize'],
  ['§2.2.13 风眼坐标', '#eye-coord'],
  ['§2.2.14 触控 44px', 'min-height: 44px'],
  ['§2.2.14 Dock 标签 48px', 'min-height: 48px'],
  ['§2.2.14 touch-action', 'touch-action'],
  ['§2.2.14 日历格', '.cal-cell'],
  ['§2.2.17 矮屏断点', '@media (max-height: 480px)'],
  ['§3.5 地图交互态', '.md-interacting'],
  ['§3.6 Sheet 蒙层', '.md-scrim'],
  ['§3.6 蒙层 ID', '#md-scrim'],
  ['§3.3 底部 Sheet', '.md-sheet'],
  ['§3.3 Sheet 头部', '.md-sheet-head'],
  ['§3.3 Sheet 标题', '.md-sheet-title'],
  ['§3.3 Sheet 关闭键', '.md-close'],
  ['§3.3 Sheet 滚动体', '.md-sheet-body'],
  ['§3.3 设置面板宽按钮', '.md-wide'],
  ['§3.3 JS 隐藏标记', '.md-hidden'],
  ['§3.5 Dock 时钟徽标', '.md-clock'],
  ['§3.5 设置面板网格', '.md-grid'],
  ['§3.5 风场行', '#wind-row'],
  ['§3.5 图标按钮中文标签', 'attr(data-tip)'],
  ['§3.5 分组标题不被网格吞掉', 'div:not(.tool-group-label)'],
  ['§2.2.18 去掉 backdrop-filter', 'backdrop-filter: none'],
];

check('§3.5 .md-clock 被约束为小徽标（否则 SVG 会撑到 374px）', () => {
  const flat = noComments.replace(/\s+/g, ' ');
  const m = flat.match(/\.md-clock\s*\{([^}]*)\}/);
  if (!m) return { ok: false, detail: '未找到 .md-clock 规则' };
  const body = m[1];
  return {
    ok: /position\s*:\s*absolute/.test(body) && /max-width\s*:\s*\d+px/.test(body) && /height\s*:\s*44px/.test(body),
    detail: body.trim().slice(0, 120),
  };
});

check('§3.5 Sheet 内 #tool-controls 复位为静态流（原本 absolute）', () => {
  const flat = noComments.replace(/\s+/g, ' ');
  const m = flat.match(/#tool-controls\s*\{([^}]*)\}/g) || [];
  return {
    ok: m.some((b) => /position\s*:\s*static/.test(b)),
    detail: m.length ? '' : '未找到 #tool-controls 规则',
  };
});

check('§2.2 十八条的必需选择器覆盖', () => {
  const missing = COVERAGE.filter(([, needle]) => {
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(esc).test(noComments);
  });
  return {
    ok: missing.length === 0,
    detail: missing.length ? '缺失: ' + missing.map(([n]) => n).join(' / ') : COVERAGE.length + ' 项全命中',
  };
});

/* 7. Dock 高度预算 ------------------------------------------------------- */
check('§2.2.1 Dock 总高 ≤168px（静态估算）', () => {
  const flat = noComments.replace(/\s+/g, ' ');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockOf = (sel) => {
    const m = flat.match(new RegExp(esc(sel) + '\\s*\\{([^}]*)\\}'));
    return m ? m[1] : null;
  };
  const px = (sel, prop) => {
    const body = blockOf(sel);
    if (body === null) return null;
    const m = body.match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px'));
    return m ? parseFloat(m[1]) : null;
  };

  const dockBody = blockOf('#mobile-dock') || '';
  const padM = dockBody.match(/padding:\s*(\d+(?:\.\d+)?)px (\d+(?:\.\d+)?)px calc\((\d+(?:\.\d+)?)px/);
  const row1 = px('#mobile-dock .md-time', 'min-height');
  const sliderH = px('#mobile-dock #time-slider', 'height');
  const ticksH = px('#mobile-dock #time-ticks', 'height');
  const tabH = px('#mobile-dock .md-tab', 'min-height');
  const gap = px('#mobile-dock', 'gap');

  const missing = [];
  if (row1 === null) missing.push('row1');
  if (sliderH === null) missing.push('slider');
  if (ticksH === null) missing.push('ticks');
  if (tabH === null) missing.push('tab');
  if (gap === null) missing.push('gap');
  if (!padM) missing.push('padding');
  if (missing.length) return { ok: false, detail: '数值提取失败: ' + missing.join(',') };

  const padV = parseFloat(padM[1]) + parseFloat(padM[3]);
  const row2 = sliderH + ticksH;
  const total = row1 + row2 + tabH + gap * 2 + padV + 1; // 3 行 → 2 个行距；+1 = border-top
  return {
    ok: total <= 168,
    detail:
      '行1=' + row1 + ' 行2=' + row2 + '(' + sliderH + '+' + ticksH + ') 行3=' + tabH +
      ' 行距=' + gap * 2 + ' 内边距=' + padV + ' 边框=1 → 合计 ' + total + 'px / 上限 168px',
  };
});

/* 8. 统计 ---------------------------------------------------------------- */
const decls = rules.reduce((sum, x) => sum + countDeclarations(x.node.body), 0);
const breakpoints = new Map();
for (const x of atRules) {
  const key = x.node.prelude.replace(/\s+/g, ' ').trim();
  breakpoints.set(key, (breakpoints.get(key) || 0) + 1);
}

/* --------------------------------------------------------------- 输出 */

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
console.log('mobile.css 自检 —— ' + CSS_PATH);
console.log('文件 ' + Buffer.byteLength(raw, 'utf8') + ' 字节 / ' + raw.split('\n').length + ' 行');
console.log('-'.repeat(72));
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log('[' + (r.ok ? 'PASS' : 'FAIL') + '] ' + pad(r.name, 44) + (r.detail ? ' ' + r.detail : ''));
}
console.log('-'.repeat(72));
console.log('规则条目数: ' + rules.length + '（其中 @media 内嵌套规则 ' + rules.length + '）');
console.log('声明条目数: ' + decls);
console.log('@ 断点: ' + [...breakpoints.entries()].map(([k, v]) => k + ' ×' + v).join(' / '));
console.log('触控目标声明 (min-height: 44px|48px): ' + (noComments.match(/min-height:\s*(44|48)px/g) || []).length + ' 处');
console.log('-'.repeat(72));
console.log(failed === 0 ? 'RESULT: ALL GREEN (' + results.length + '/' + results.length + ')' : 'RESULT: ' + failed + ' FAILED');
process.exit(failed === 0 ? 0 : 1);

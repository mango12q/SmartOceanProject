/**
 * i18n-scan.mjs — 从 index.html 抽取「用户可见的中文串」清单（用于英文版翻译）
 *
 * 判定来源：
 *   A. HTML 文本节点（<body> 内，排除 <script>/<style>/注释）
 *   B. HTML 属性：title / placeholder / aria-label / data-tip / alt
 *   C. JS 源码中的中文字符串字面量（单/双引号/模板串），排除注释行
 *
 * 用法: node .dev/i18n-scan.mjs [outfile]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'index.html';
const OUT = process.argv[2] || '.dev/i18n-inventory.json';
let html = readFileSync(SRC, 'utf8');
if (html.charCodeAt(0) === 0xfeff) html = html.slice(1);

const CN = /[\u4e00-\u9fa5]/;
const bodyStart = html.indexOf('<body>');
const head = html.slice(0, bodyStart);
const body = html.slice(bodyStart);

/* ---------- 找出内联块（build.py 生成的）范围，单独归类 ---------- */
const marks = [
  ['QR:JS', '/* === QR:JS:BEGIN === */', '/* === QR:JS:END === */'],
  ['MOBILE:JS', '/* === MOBILE:JS:BEGIN === */', '/* === MOBILE:JS:END === */'],
  ['MOBILE:CSS', '/* === MOBILE:CSS:BEGIN === */', '/* === MOBILE:CSS:END === */'],
];
const inlineRanges = marks.map(([n, b, e]) => {
  const i = html.indexOf(b), j = html.indexOf(e);
  return { name: n, start: i, end: j < 0 ? -1 : j + e.length };
});
const inInline = (idx) => inlineRanges.find(r => r.start >= 0 && idx >= r.start && idx <= r.end);

/* ---------- 掩掉 <script>/<style>/注释，便于取 HTML 文本 ---------- */
function maskRanges(s, ranges) {
  const a = s.split('');
  for (const [i, j] of ranges) for (let k = i; k < j; k++) a[k] = ' ';
  return a.join('');
}
function rangesOf(re, s, group = 0) {
  const out = []; let m;
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = r.exec(s))) out.push([m.index, m.index + m[0].length, m[group]]);
  return out;
}
const bodyRanges = [];
for (const [i, j] of rangesOf(/<script[\s\S]*?<\/script>/gi, body)) bodyRanges.push([i, j]);
for (const [i, j] of rangesOf(/<style[\s\S]*?<\/style>/gi, body)) bodyRanges.push([i, j]);
for (const [i, j] of rangesOf(/<!--[\s\S]*?-->/g, body)) bodyRanges.push([i, j]);
const maskedBody = maskRanges(body, bodyRanges);

/* ---------- A. HTML 文本节点 ---------- */
const htmlTexts = new Map();
for (const m of maskedBody.matchAll(/>([^<>]+)</g)) {
  const raw = m[1].trim();
  if (!raw || !CN.test(raw)) continue;
  htmlTexts.set(raw, (htmlTexts.get(raw) || 0) + 1);
}

/* ---------- B. HTML 属性 ---------- */
const htmlAttrs = new Map();
for (const m of maskedBody.matchAll(/\b(title|placeholder|aria-label|data-tip|alt)\s*=\s*"([^"]*)"/g)) {
  if (!CN.test(m[2])) continue;
  const key = m[1] + '=' + m[2];
  htmlAttrs.set(key, (htmlAttrs.get(key) || 0) + 1);
}

/* ---------- C. JS 字符串字面量 ---------- */
// 先去注释（行注释 + 块注释），再抓引号串
function stripJsComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
          .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}
const jsTexts = new Map();
const jsSites = [];
function scanJsChunk(chunk, where, offset) {
  const clean = stripJsComments(chunk);
  const re = /(['"`])((?:\\.|(?!\1)[^\\\r\n])*?)\1/g;
  let m;
  while ((m = re.exec(clean))) {
    if (!CN.test(m[2])) continue;
    jsTexts.set(m[2], (jsTexts.get(m[2]) || 0) + 1);
    jsSites.push({ where, value: m[2] });
  }
}
// 主 module
const mm = html.indexOf('<script type="module">');
if (mm >= 0) {
  const mj = html.indexOf('</script>', mm);
  scanJsChunk(html.slice(mm, mj), 'main-module', mm);
}
// 内联块
for (const r of inlineRanges) {
  if (r.start < 0) continue;
  if (r.name === 'MOBILE:CSS') continue;
  scanJsChunk(html.slice(r.start, r.end), r.name.toLowerCase(), r.start);
}
// head 内联 CSS 之外的脚本（如有）
for (const [i, j] of rangesOf(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, head, 1)) {
  const inner = html.slice(i, j);
  const s = inner.indexOf('>') + 1, e = inner.lastIndexOf('</script>');
  scanJsChunk(inner.slice(s, e), 'head-inline', i + s);
}

/* ---------- 汇总 ---------- */
const all = new Map();
for (const [k, v] of htmlTexts) all.set(k, (all.get(k) || 0) + v);
for (const [k, v] of jsTexts) all.set(k, (all.get(k) || 0) + v);

const dump = {
  counts: { htmlText: htmlTexts.size, htmlAttr: htmlAttrs.size, jsLiteral: jsTexts.size, total: all.size },
  htmlAttr: [...htmlAttrs.keys()].sort(),
  htmlText: [...htmlTexts.keys()].sort(),
  jsLiteral: [...jsTexts.keys()].sort(),
  all: [...all.keys()].sort(),
};
writeFileSync(OUT, JSON.stringify(dump, null, 2), 'utf8');
console.log(JSON.stringify(dump.counts, null, 2));
console.log('--- HTML 文本 (' + htmlTexts.size + ') ---');
console.log(dump.htmlText.join('  |  '));
console.log('--- HTML 属性 (' + htmlAttrs.size + ') ---');
console.log(dump.htmlAttr.join('  |  '));
console.log('--- JS 字面量 (' + jsTexts.size + ') ---');
console.log(dump.jsLiteral.join('  |  '));

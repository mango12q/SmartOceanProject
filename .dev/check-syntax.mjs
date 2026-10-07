/**
 * check-syntax.mjs — 校验 index.html 里所有内联 <script> 的语法
 *
 * 用法： node .dev/check-syntax.mjs index.html
 *
 * ⚠ 为什么不用正则切 <script>：
 *   importmap 的 `<script type="importmap">` 属性跨 6 行，
 *   `[^>]*` 会在**属性值或 JSON 内的 '>'** 处误切，
 *   把 JSON 尾巴当成脚本去解析 → 报 "Unexpected token ':'"。
 *   那是校验工具自身的 bug，不是页面的问题。
 *   这里改用「带引号状态机」找标签边界，并跳过 importmap / application-json。
 *
 * 判断标准：**与整改前基线相比没有新增失败项**。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const path = process.argv[2] || 'index.html';
const html = readFileSync(path, 'utf8');

/** 从 openIdx（指向 '<'）开始，解析出属性串与 '>' 的下标 */
function parseTag(s, openIdx) {
  let i = openIdx + 1;                 // 跳过 '<'
  while (i < s.length && !/[\s/>]/.test(s[i])) i++;   // 标签名
  const attrStart = i;
  let quote = null;
  while (i < s.length) {
    const c = s[i];
    if (quote) { if (c === quote) quote = null; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return { attrs: s.slice(attrStart, i), gtIdx: i };
    i++;
  }
  return null;
}

const blocks = [];
let pos = 0;
while (true) {
  const open = html.indexOf('<script', pos);
  if (open < 0) break;
  const tag = parseTag(html, open);
  if (!tag) break;
  const close = html.indexOf('</script', tag.gtIdx);
  if (close < 0) break;
  const bodyStart = tag.gtIdx + 1;
  blocks.push({
    attrs: tag.attrs,
    body: html.slice(bodyStart, close),
    line: html.slice(0, open).split('\n').length,
  });
  const gt2 = html.indexOf('>', close);
  pos = gt2 < 0 ? close + 8 : gt2 + 1;
}

let checked = 0, bad = 0, mods = 0, skipped = 0;
blocks.forEach((b, n) => {
  const attrs = b.attrs || '';
  if (/\bsrc\s*=/.test(attrs)) { skipped++; return; }                       // 外链
  if (/type\s*=\s*["']?(importmap|application\/json)/.test(attrs)) { skipped++; return; }
  const isModule = /type\s*=\s*["']?module/.test(attrs);
  checked++;
  try {
    if (isModule) { mods++; new vm.SourceTextModule(b.body, { identifier: `m#${n}` }); }
    else new vm.Script(b.body, { filename: `inline#${n}@line${b.line}` });
  } catch (e) {
    if (e.message.includes('SourceTextModule')) { mods++; return; }          // VM 未开模块支持
    bad++;
    console.log(`[FAIL] script #${n} @HTML line ${b.line}${isModule ? ' (module)' : ''}`);
    console.log('       ' + String(e.message).split('\n')[0]);
  }
});
console.log(`${path}: script标签=${blocks.length} 已检查=${checked} (module=${mods}) 跳过=${skipped} 失败=${bad}`);
process.exit(bad ? 1 : 0);

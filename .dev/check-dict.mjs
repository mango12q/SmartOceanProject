/**
 * check-dict.mjs — 校验内嵌 i18n 词表
 *
 * 做三件事：
 *   1. index.html 的 window.__I18N_DICT 必须是**可执行的合法 JS**，且真的能取到词条
 *      （防「对象里混注释 / 被截断」这类会静默让中英切换失效的问题）
 *   2. 词表里不应有**死条目**：页面正文已不再出现的旧文案
 *      （例：已删除的「国界/海岸线」「省界」「地形图」、已改写的「【台风快讯】」）
 *   3. mobile/i18n-dict.js 与 index.html 内嵌词表**键集一致**
 *      —— 否则下次 `python mobile/build.py` 会用过期词表覆盖内嵌块，
 *      把合规改动悄悄回退（本项目真踩过这个坑）
 *
 * 用法： node .dev/check-dict.mjs [index.html]
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const htmlPath = process.argv[2] || 'index.html';
const html = readFileSync(htmlPath, 'utf8');

/* ---------- 1. 提取并执行内嵌词表 ---------- */
const marker = 'window.__I18N_DICT = {';
const i = html.lastIndexOf(marker);          // 注释里也可能出现该串，必须取最后一次
if (i < 0) { console.error('FAIL 未找到 window.__I18N_DICT'); process.exit(1); }
const j = html.indexOf('\n};', i);
if (j < 0) { console.error('FAIL 未找到词表结尾'); process.exit(1); }
const stmt = html.slice(i, j + 3);

const ctx = { window: {} };
vm.createContext(ctx);
let fail = 0;
try {
  new vm.Script(stmt).runInContext(ctx);
} catch (e) {
  console.error('FAIL 内嵌词表不是合法 JS：' + e.message);
  process.exit(1);
}
const dict = ctx.window.__I18N_DICT;
if (!dict || typeof dict !== 'object') { console.error('FAIL 执行后未得到词表'); process.exit(1); }
const keys = Object.keys(dict);
console.log(`PASS 内嵌词表可执行，词条 ${keys.length} 条`);
if (keys.length < 300) { console.error('FAIL 词条数异常偏少'); fail++; }

/* ---------- 2. 死条目检查 ---------- */
const body = html.slice(0, i) + html.slice(j);      // 页面正文 = 去掉词表之后的部分
const DEAD_KEYS = ['【台风快讯】加载中...', '【台风快讯】台风\\"', '国界/海岸线', '省界', '地形图',
                   '<span class="line-sample" style="background:#555;"></span>国界/海岸线',
                   '<span class="dashed-sample"></span>省界'];
/* 孤儿判据：页面正文里找不到该键文本，且它**不是**另一条更长键的子串。
   ⚠ 不能只用 !body.includes(k)：多段 HTML 片段键（如
   "<span …>航线·注意</b> (<900km)"）在页面里是 JS 运行时拼出来的，源码无整串，
   会被误判成死条目 —— 那正是本项目曾误报 14 条的原因。
   词表内部关系（改名后「台山核电站」是「台山核电科普基地（对外开放）」的子串）
   属于词表冗余，与页面文案无关，也不算孤儿。 */
const allKeys2 = Object.keys(dict);
const orphan = allKeys2.filter((k) => {
  if (!/[\u4e00-\u9fa5]/.test(k)) return false;
  if (body.includes(k)) return false;
  return !allKeys2.some((o) => o !== k && o.includes(k));
});
console.log(`\n孤儿条目（页面无此文本、且非其它键的子串）：${orphan.length} 条`);
orphan.forEach((k) => console.log('   - ' + JSON.stringify(k) + ' → ' + JSON.stringify(dict[k])));

/* 注意：必须按**整键**匹配，不能用子串 —— 否则「省界」会误命中
   合法词条「本页不自行绘制国界、省界等政治边界…」。 */
for (const t of DEAD_KEYS) {
  if (t in dict) {
    console.error(`FAIL 词表仍含已废弃条目 ${JSON.stringify(t)}`);
    fail++;
  }
}
if (!fail) console.log('PASS 未包含已知废弃条目（快讯 / 国界 / 省界 / 地形图）');

/* ---------- 3. mobile 词表键集一致性 ---------- */
let mobile = {};
try {
  const src = readFileSync('mobile/i18n-dict.js', 'utf8');
  const a = src.indexOf('window.__I18N_DICT = {');
  const b = src.indexOf('\n};', a);
  const mctx = { window: {} };
  vm.createContext(mctx);
  new vm.Script(src.slice(a, b + 3)).runInContext(mctx);
  mobile = mctx.window.__I18N_DICT || {};
} catch (e) {
  console.error('FAIL 无法解析 mobile/i18n-dict.js：' + e.message);
  process.exit(1);
}
const mk = Object.keys(mobile);
const onlyEmbedded = keys.filter((k) => !(k in mobile));
const onlyMobile = mk.filter((k) => !(k in dict));
console.log(`\nmobile 词表 ${mk.length} 条 ／ 内嵌 ${keys.length} 条`);
if (onlyEmbedded.length) {
  console.error(`FAIL 仅在内嵌块（跑 build.py 会丢）${onlyEmbedded.length} 条：`);
  onlyEmbedded.forEach((k) => console.error('   + ' + JSON.stringify(k)));
  fail++;
}
if (onlyMobile.length) {
  console.error(`FAIL 仅在 mobile 源码（页面用不到）${onlyMobile.length} 条：`);
  onlyMobile.forEach((k) => console.error('   - ' + JSON.stringify(k)));
  fail++;
}
if (!onlyEmbedded.length && !onlyMobile.length) console.log('PASS mobile 与内嵌词表键集一致');

console.log(`\n失败项：${fail}`);
process.exit(fail ? 1 : 0);

/**
 * check-gcj.mjs — 校验 index.html 里 WGS-84 → GCJ-02 转换的正确性
 *
 * 用法： node .dev/check-gcj.mjs index.html
 *
 * ⚠ 为什么基准值不在本文件里自己算：
 *   一开始我在测试里手写了一份"参考实现"，结果**它和被实现的公式同错**，
 *   测试完全自我印证（偏移量算出 575 m，实际实现只有 298 m 也没报错）。
 *   坐标转换这类算法不能自证，必须用**外部权威基准**。
 *
 *   因此基准值取自 eviltransform 的官方测试夹具（MIT，googollee/eviltransform，
 *   haskell/test/QC.hs 中的 fixture），上海/深圳/北京三组 WGS-84↔GCJ-02 精确对。
 *   同时另附本项目实际用到的珠三角点位（只做量级与方向断言，不做位比对）。
 *
 * 参考来源：
 *   https://github.com/googollee/eviltransform （fixture）
 *   https://github.com/kzccat/coordtransform_java （系数形态佐证）
 */
import { readFileSync } from 'node:fs';

const path = process.argv[2] || 'index.html';
const html = readFileSync(path, 'utf8');

/** 从 index.html 抽取一段具名函数/变量声明（按大括号配平） */
function grab(startMarker) {
  const i = html.indexOf(startMarker);
  if (i < 0) throw new Error('未找到: ' + startMarker);
  let depth = 0, started = false, end = i;
  for (let k = i; k < html.length; k++) {
    const c = html[k];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) { end = k + 1; break; } }
  }
  return html.slice(i, end);
}

const src = [
  'var GCJ_A = 6378245.0;',
  'var GCJ_EE = 0.00669342162296594323;',
  grab('function gcjOutOfChina'),
  grab('function gcjTransformLat'),
  grab('function gcjTransformLon'),
  grab('function wgs84ToGcj02'),
].join('\n');

// eslint-disable-next-line no-new-func
const { wgs84ToGcj02 } = new Function(src + '\nreturn { wgs84ToGcj02 };')();

/* ---------- 权威基准：eviltransform 官方 fixture ---------- */
const FIXTURE = [
  { name: 'Shanghai',  wgs: [31.1774276, 121.5272106], gcj: [31.17530398364597, 121.531541859215] },
  { name: 'Shenzhen',  wgs: [22.543847,  113.912316],  gcj: [22.540796131694766, 113.9171764808363] },
  { name: 'Beijing',   wgs: [39.911954,  116.377817],  gcj: [39.91334545536069, 116.38404722455657] },
];
/* fixture 是 double 位级断言（原测试用 ==）。这里放宽到 1e-9 度（约 0.1 mm），
   足以捕获任何真实的公式/系数错误。 */
const TOL = 1e-9;

let fail = 0;
console.log('=== 与 eviltransform 官方 fixture 比对（权威基准）===');
let worst = 0;
for (const f of FIXTURE) {
  const got = wgs84ToGcj02(f.wgs[0], f.wgs[1]);
  const dLat = Math.abs(got.lat - f.gcj[0]);
  const dLon = Math.abs(got.lon - f.gcj[1]);
  worst = Math.max(worst, dLat, dLon);
  const pass = dLat < TOL && dLon < TOL;
  if (!pass) fail++;
  console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${f.name.padEnd(10)} ` +
    `Δlat=${dLat.toExponential(2)}  Δlon=${dLon.toExponential(2)}`);
}
console.log(`  最大偏差 ${worst.toExponential(2)} 度（阈值 ${TOL}）`);

/* ---------- 偏移量量级与方向（本项目实际点位）---------- */
const M_PER_DEG_LAT = 111320;
function shift(lat, lon) {
  const g = wgs84ToGcj02(lat, lon);
  const dN = (g.lat - lat) * M_PER_DEG_LAT;
  const dE = (g.lon - lon) * M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180);
  return { dN, dE, m: Math.hypot(dN, dE) };
}
const LOCAL = [
  ['大亚湾核电基地', 22.60, 114.54],
  ['深圳宝安机场',   22.64, 113.81],
  ['台山核电基地',   21.92, 112.98],
  ['广州白云机场',   23.39, 113.30],
  ['香港中环',       22.28, 114.16],
];
console.log('=== 珠三角点位：偏移量级与方向 ===');
for (const [name, lat, lon] of LOCAL) {
  const s = shift(lat, lon);
  /* 已知事实：GCJ-02 相对 WGS-84 在华南一带是「向西北约 500~600 m」 */
  const okMag = s.m > 400 && s.m < 800;
  const okDir = s.dN < 0 && s.dE > 0;
  if (!okMag || !okDir) fail++;
  console.log(`  ${okMag && okDir ? 'OK  ' : 'FAIL'} ${name.padEnd(14)} ` +
    `位移 ${s.m.toFixed(0).padStart(3)} m  (ΔN ${s.dN.toFixed(0)}, ΔE ${s.dE.toFixed(0)})`);
}

/* ---------- 境外：不偏移 ---------- */
console.log('=== 判定框外：应原样返回 ===');
const ABROAD = [['东京', 35.6762, 139.6503], ['关岛', 13.4443, 144.7937], ['悉尼', -33.87, 151.21]];
for (const [name, lat, lon] of ABROAD) {
  const g = wgs84ToGcj02(lat, lon);
  const same = g.lat === lat && g.lon === lon;
  if (!same) fail++;
  console.log(`  ${same ? 'OK  ' : 'FAIL'} ${name.padEnd(14)} → ${g.lat}, ${g.lon}`);
}

/* ---------- 已知固有限制：如实记录，不作为失败 ---------- */
console.log('=== 已知固有限制（仅记录，不判失败）===');
for (const [name, lat, lon] of [['马尼拉', 14.5995, 120.9842]]) {
  const s = shift(lat, lon);
  console.log(`  NOTE ${name} 落在判定框内，被偏移 ${s.m.toFixed(0)} m ` +
    `—— 这是 [73.66,135.05]×[3.86,53.55] 判定法的固有误差，本图可接受`);
}

console.log(`\n失败项：${fail}`);
process.exit(fail ? 1 : 0);

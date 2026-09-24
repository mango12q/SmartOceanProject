/**
 * mobile/test-qr.mjs —— qr-encoder.js 的零依赖位级自检
 *
 * 用法：
 *   node mobile/test-qr.mjs           仅跑自检
 *   node mobile/test-qr.mjs --emit    自检 + 输出 .dev/qr-cases.json
 *
 * 自检内容（全部独立于编码器内部实现，只依赖 encode() 的冻结返回值）：
 *   1. 结构自洽：size = 4*version+17；modules 长度 = size*size；掩码号 0..7
 *   2. 功能图形：定位图形 3 个 + 分隔符、时序图形、暗模块、校正图形（含坐标表覆盖）
 *   3. 格式信息：两份副本一致、BCH(15,5) 余式为 0、等于 (ecBits<<3|mask)^0x5412
 *   4. 版本信息：version ≥ 7 时两份副本一致、BCH(18,6) 余式为 0、等于 version 编码
 *   5. 位级往返：按标准顺序读回模块 → 去掩码 → 反交织 → 去填充 → 还原 UTF-8 文本
 *   6. RS 校验：每个纠错块的码字多项式在 α^0..α^(deg-1) 上全部求值为 0（独立验证 RS）
 *   7. 容量：与 ISO/IEC 18004 表定 byte mode 容量对比（版本 1–10）
 *   8. 边界：空串 / 超长抛错 / 非法 ecLevel / 非法版本区间 / 确定性
 *   9. render：用假 canvas 校验整数对齐、锐利（imageSmoothingEnabled=false）、暗模块数一致
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QRCode = require('./qr-encoder.js');

/* --force-mask-matrix 模式下 stdout 必须只含 JSON 行（供 Python 侧管道消费），
   人读报告改走 stderr。 */
const EMIT_MATRIX = process.argv.includes('--force-mask-matrix');
if (EMIT_MATRIX) {
  console.log = function () {
    process.stderr.write(Array.prototype.join.call(arguments, ' ') + '\n');
  };
}

/* ========================================================================
 * 测试用常量表（独立抄录自 ISO/IEC 18004，用于交叉核对编码器内部的表）
 * ====================================================================== */

/* 每版本符号总码字数（ISO/IEC 18004 Table 1） */
const TOTAL_CODEWORDS = [
  0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346,
  404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
  1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185,
  2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706,
];

/* Table 9：纠错块参数，按【版本】分行独立抄录：[每块纠错码字数, 纠错块数] × (L,M,Q,H)
 * 布局与编码器内部的「按纠错等级分行」表不同，用于降低相关性抄录错误的风险。 */
const BLOCK_TABLE = [
  null,
  [[7, 1], [10, 1], [13, 1], [17, 1]],
  [[10, 1], [16, 1], [22, 1], [28, 1]],
  [[15, 1], [26, 1], [18, 2], [22, 2]],
  [[20, 1], [18, 2], [26, 2], [16, 4]],
  [[26, 1], [24, 2], [18, 4], [22, 4]],
  [[18, 2], [16, 4], [24, 4], [28, 4]],
  [[20, 2], [18, 4], [18, 6], [26, 5]],
  [[24, 2], [22, 4], [22, 6], [26, 6]],
  [[30, 2], [22, 5], [20, 8], [24, 8]],
  [[18, 4], [26, 5], [24, 8], [28, 8]],
  [[20, 4], [30, 5], [28, 8], [24, 11]],
  [[24, 4], [22, 8], [26, 10], [28, 11]],
  [[26, 4], [22, 9], [24, 12], [22, 16]],
  [[30, 4], [24, 9], [20, 16], [24, 16]],
  [[22, 6], [24, 10], [30, 12], [24, 18]],
  [[24, 6], [28, 10], [24, 17], [30, 16]],
  [[28, 6], [28, 11], [28, 16], [28, 19]],
  [[30, 6], [26, 13], [28, 18], [28, 21]],
  [[28, 7], [26, 14], [26, 21], [26, 25]],
  [[28, 8], [26, 16], [30, 20], [28, 25]],
  [[28, 8], [26, 17], [28, 23], [30, 25]],
  [[28, 9], [28, 17], [30, 23], [24, 34]],
  [[30, 9], [28, 18], [30, 25], [30, 30]],
  [[30, 10], [28, 20], [30, 27], [30, 32]],
  [[26, 12], [28, 21], [30, 29], [30, 35]],
  [[28, 12], [28, 23], [28, 34], [30, 37]],
  [[30, 12], [28, 25], [30, 34], [30, 40]],
  [[30, 13], [28, 26], [30, 35], [30, 42]],
  [[30, 14], [28, 28], [30, 38], [30, 45]],
  [[30, 15], [28, 29], [30, 40], [30, 48]],
  [[30, 16], [28, 31], [30, 43], [30, 51]],
  [[30, 17], [28, 33], [30, 45], [30, 54]],
  [[30, 18], [28, 35], [30, 48], [30, 57]],
  [[30, 19], [28, 37], [30, 51], [30, 60]],
  [[30, 19], [28, 38], [30, 53], [30, 63]],
  [[30, 20], [28, 40], [30, 56], [30, 66]],
  [[30, 21], [28, 43], [30, 59], [30, 70]],
  [[30, 22], [28, 45], [30, 62], [30, 74]],
  [[30, 24], [28, 47], [30, 65], [30, 77]],
  [[30, 25], [28, 49], [30, 68], [30, 81]],
];
const eccPerBlock = (version, ecIndex) => BLOCK_TABLE[version][ecIndex][0];
const numBlocksOf = (version, ecIndex) => BLOCK_TABLE[version][ecIndex][1];
/* ISO/IEC 18004 表定 byte mode 容量（版本 1–10），用于验证选版本逻辑 */
const BYTE_CAPACITY = [
  null,
  [17, 14, 11, 7], [32, 26, 20, 14], [53, 42, 32, 24], [78, 62, 46, 34],
  [106, 84, 60, 44], [134, 106, 74, 58], [154, 122, 86, 64], [192, 152, 108, 84],
  [230, 180, 130, 98], [271, 213, 151, 119],
];

const EC_NAMES = ['L', 'M', 'Q', 'H'];
const EC_FORMAT_BITS = [1, 0, 3, 2];   /* 依 ecIndex(L,M,Q,H) → 格式信息 2 bit：01,00,11,10 */

/* ========================================================================
 * 1. 独立的 GF(2^8) 实现（用于 RS 校验）
 * ====================================================================== */
const GF_EXP = new Uint8Array(256);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
}
function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255];
}
function gfPow(a, e) {
  if (a === 0) return 0;
  return GF_EXP[(GF_LOG[a] * (e % 255)) % 255];
}

/* ========================================================================
 * 2. 独立重建功能图形分布图（只按规范文字描述，不看编码器实现）
 * ====================================================================== */
function alignmentPositions(version) {
  if (version === 1) return [];
  const size = version * 4 + 17;
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const res = [6];
  for (let pos = size - 7; res.length < numAlign; pos -= step) res.splice(1, 0, pos);
  return res;
}

function buildFunctionMap(version) {
  const size = version * 4 + 17;
  const map = new Uint8Array(size * size);
  const mark = (x, y) => { if (x >= 0 && x < size && y >= 0 && y < size) map[y * size + x] = 1; };

  // 定位图形 + 分隔符（左上行/列、右上、左下）
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) mark(cx + dx, cy + dy);
  }
  // 时序图形
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  // 校正图形
  const pos = alignmentPositions(version);
  const n = pos.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) mark(pos[i] + dx, pos[j] + dy);
    }
  }
  // 格式信息区
  for (let i = 0; i <= 5; i++) mark(8, i);
  mark(8, 7); mark(8, 8); mark(7, 8);
  for (let i = 9; i < 15; i++) mark(14 - i, 8);
  for (let i = 0; i < 8; i++) mark(size - 1 - i, 8);
  for (let i = 8; i < 15; i++) mark(8, size - 15 + i);
  mark(8, size - 8); // 暗模块
  // 版本信息区
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      mark(a, b);
      mark(b, a);
    }
  }
  return map;
}

/* ========================================================================
 * 3. 独立解码器：模块矩阵 → 文本
 * ====================================================================== */
const FORMAT_COORDS = [
  [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
  [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
];

function maskFn(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return (x * y) % 2 + (x * y) % 3 === 0;
    case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
  }
}

function readFormatInfo(mods, size) {
  let copy1 = 0;
  for (let i = 0; i < 15; i++) {
    const [x, y] = FORMAT_COORDS[i];
    if (mods[y * size + x]) copy1 |= 1 << i;
  }
  let copy2 = 0;
  for (let i = 0; i < 8; i++) if (mods[8 * size + (size - 1 - i)]) copy2 |= 1 << i;
  for (let i = 8; i < 15; i++) if (mods[(size - 15 + i) * size + 8]) copy2 |= 1 << i;
  return { copy1, copy2 };
}

/* 通用 GF(2) 多项式取余：value 为码字（MSB 对齐），genPoly 次数为 genDeg */
function polyMod(value, genPoly, genDeg) {
  let v = value >>> 0;
  for (let bit = 31; bit >= genDeg; bit--) {
    if ((v >>> bit) & 1) v ^= genPoly << (bit - genDeg);
  }
  return v;   /* 余式位于低 genDeg 位 */
}
/* 校验 15 位格式信息：整体对 BCH(15,5) 生成多项式 0x537（次数 10）取余应为 0 */
function formatBchCheck(bits15) {
  return polyMod(bits15, 0x537, 10) === 0;
}
/* 校验 18 位版本信息：整体对 BCH(18,6) 生成多项式 0x1F25（次数 12）取余应为 0 */
function versionBchCheck(bits18) {
  return polyMod(bits18, 0x1f25, 12) === 0;
}

function readVersionInfo(mods, size) {
  let copy1 = 0, copy2 = 0;
  for (let i = 0; i < 18; i++) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    if (mods[b * size + a]) copy1 |= 1 << i;   // 右上 3x6
    if (mods[a * size + b]) copy2 |= 1 << i;   // 左下 6x3
  }
  return { copy1, copy2 };
}

function dataCodewordCount(version, ecIndex) {
  return TOTAL_CODEWORDS[version] -
    eccPerBlock(version, ecIndex) * numBlocksOf(version, ecIndex);
}

/* 独立重建「32 个合法已掩码格式信息串」查找表（zxing FORMAT_INFO_DECODE_LOOKUP 同构）。
 * 注意：0x5412 本身不是 BCH(15,5) 码字（0x5412 mod 0x537 = 0x255），
 * 因此 BCH 校验必须在异或还原之后做，或直接用本表做成员判定。 */
const FORMAT_INFO_TABLE = (() => {
  const t = new Map();
  for (let ec = 0; ec < 4; ec++) {
    for (let m = 0; m < 8; m++) {
      const data = (EC_FORMAT_BITS[ec] << 3) | m;
      const cw = ((data << 10) | polyMod(data << 10, 0x537, 10)) ^ 0x5412;
      t.set(cw, (ec << 3) | m);
    }
  }
  return t;
})();
/** 校验一处格式信息副本：返回 {ok, bchOk, ecBits, mask, tableHit} */
function auditFormatCopy(v) {
  const un = v ^ 0x5412;
  return {
    bchOk: formatBchCheck(un),
    ecBits: (un >>> 10) & 0x1f,
    tableHit: FORMAT_INFO_TABLE.has(v) ? FORMAT_INFO_TABLE.get(v) : null,
  };
}

/* ========================================================================
 * 3b. 独立的罚分实现 + 换掩码工具（用于验证掩码选优）
 * ====================================================================== */
function penaltyOf(mods, size) {
  let score = 0;
  const white = (get, from, to) => {
    for (let i = from; i < to; i++) { if (i < 0) continue; if (get(i)) return false; }
    return true;
  };
  // N1（行/列连续同色 ≥5）
  for (let y = 0; y < size; y++) {
    let run = 0, prev = -1;
    for (let x = 0; x < size; x++) {
      const c = mods[y * size + x];
      if (c === prev) run++; else { if (run >= 5) score += 3 + (run - 5); run = 1; prev = c; }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  for (let x = 0; x < size; x++) {
    let run = 0, prev = -1;
    for (let y = 0; y < size; y++) {
      const c = mods[y * size + x];
      if (c === prev) run++; else { if (run >= 5) score += 3 + (run - 5); run = 1; prev = c; }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  // N2（2x2 同色）
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const c = mods[y * size + x];
      if (c === mods[y * size + x + 1] && c === mods[(y + 1) * size + x] &&
          c === mods[(y + 1) * size + x + 1]) score += 3;
    }
  // N3（1:1:3:1:1 类定位图形，两侧 ≥4 浅色，越界视为浅色）
  const scan = (get, limit) => {
    for (let p = 0; p + 6 < limit; p++) {
      if (get(p) && !get(p + 1) && get(p + 2) && get(p + 3) && get(p + 4) && !get(p + 5) && get(p + 6) &&
          (white(get, p - 4, p) || white(get, p + 7, p + 11))) score += 40;
    }
  };
  for (let y = 0; y < size; y++) scan((i) => mods[y * size + i] === 1, size);
  for (let x = 0; x < size; x++) scan((i) => mods[i * size + x] === 1, size);
  // N4（黑白平衡）
  let dark = 0;
  for (let i = 0; i < mods.length; i++) dark += mods[i];
  score += Math.floor(Math.abs(dark * 2 - size * size) * 10 / (size * size)) * 10;
  return score;
}

/* 把已编码矩阵从「报告掩码」改写成候选掩码（含格式信息重写），用于独立复算罚分 */
function reMasked(qr, targetMask) {
  const { size, modules, version, ecLevel, mask } = qr;
  const isFunc = buildFunctionMap(version);
  const ecIndex = EC_NAMES.indexOf(ecLevel);
  const m = new Uint8Array(modules);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!isFunc[i] && maskFn(mask, x, y) !== maskFn(targetMask, x, y)) m[i] ^= 1;
    }
  const data = (EC_FORMAT_BITS[ecIndex] << 3) | targetMask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
  for (let i = 0; i < 15; i++) { const [x, y] = FORMAT_COORDS[i]; m[y * size + x] = (bits >>> i) & 1; }
  for (let i = 0; i < 8; i++) m[8 * size + (size - 1 - i)] = (bits >>> i) & 1;
  for (let i = 8; i < 15; i++) m[(size - 15 + i) * size + 8] = (bits >>> i) & 1;
  m[(size - 8) * size + 8] = 1;
  return m;
}

/**
 * 位级往返解码。
 * @returns {{text, stream, blocks, eccs, mode, count}}
 */
function decode(qr) {
  const { size, modules, version, ecLevel, mask } = qr;
  if (size !== version * 4 + 17) throw new Error(`size 与 version 不符: ${size} vs ${version}`);
  if (modules.length !== size * size) throw new Error('modules 长度不符');

  const ecIndex = EC_NAMES.indexOf(ecLevel);
  const isFunc = buildFunctionMap(version);

  // 去掩码（只作用于非功能模块）
  const un = new Uint8Array(modules);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!isFunc[i] && maskFn(mask, x, y)) un[i] ^= 1;
    }
  }

  // 按标准顺序读回位：列对自右向左、跳过第 6 列、上下蛇形
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        const i = y * size + x;
        if (!isFunc[i]) bits.push(un[i]);
      }
    }
  }
  eq(`${qr.version} 可用数据模块数 = 规范值`, bits.length,
    size * size - isFunc.reduce((a, b) => a + b, 0));

  const rawCw = TOTAL_CODEWORDS[version];
  if (bits.length < rawCw * 8) throw new Error(`可用位不足: ${bits.length} < ${rawCw * 8}`);
  if (Math.floor(bits.length / 8) !== rawCw) {
    throw new Error(`功能图形模块数不符: 可用位 ${bits.length} → ${Math.floor(bits.length / 8)} 码字, 规范值 ${rawCw}`);
  }
  const stream = new Uint8Array(rawCw);
  for (let i = 0; i < rawCw * 8; i++) {
    if (bits[i]) stream[i >> 3] |= 0x80 >>> (i & 7);
  }

  // 反交织（规范 §8.6：先按轮次交织数据码字，再按轮次交织纠错码字）
  const numBlocks = numBlocksOf(version, ecIndex);
  const eccLen = eccPerBlock(version, ecIndex);
  const numShort = numBlocks - (rawCw % numBlocks);
  const shortTotal = Math.floor(rawCw / numBlocks);
  const dataLens = [];
  for (let j = 0; j < numBlocks; j++) {
    dataLens.push(shortTotal - eccLen + (j < numShort ? 0 : 1));
  }
  const maxData = Math.max(...dataLens);
  const blocks = dataLens.map((n) => new Uint8Array(n));
  const eccs = Array.from({ length: numBlocks }, () => new Uint8Array(eccLen));
  let p = 0;
  for (let i = 0; i < maxData; i++)
    for (let j = 0; j < numBlocks; j++)
      if (i < dataLens[j]) blocks[j][i] = stream[p++];
  for (let i = 0; i < eccLen; i++)
    for (let j = 0; j < numBlocks; j++) eccs[j][i] = stream[p++];
  if (p !== rawCw) throw new Error(`反交织字节数不符: ${p} != ${rawCw}`);

  // 拼接数据码字
  const data = [];
  for (const b of blocks) data.push(...b);

  // 解析：模式 + 计数 + 数据
  let bp = 0;
  const readBits = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = data[bp >> 3];
      v = (v << 1) | ((byte >>> (7 - (bp & 7))) & 1);
      bp++;
    }
    return v;
  };
  const mode = readBits(4);
  if (mode !== 0x4) throw new Error(`模式指示符不是 byte mode(0100)：${mode.toString(2)}`);
  const ccBits = version <= 9 ? 8 : 16;
  const count = readBits(ccBits);
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = readBits(8);

  // 终止符 + 补位校验
  const capacityBits = data.length * 8;
  const remain = capacityBits - bp;
  if (remain > 0) {
    const termLen = Math.min(4, remain);
    if (readBits(termLen) !== 0) throw new Error('终止符非 0');
    while (bp % 8 !== 0) if (readBits(1) !== 0) throw new Error('字节对齐位非 0');
    let expect = 0xec;
    while (bp < capacityBits) {
      if (readBits(8) !== expect) throw new Error('补位码字不是 0xEC/0x11');
      expect = expect === 0xec ? 0x11 : 0xec;
    }
  }

  return { text: utf8Decode(out), stream, blocks, eccs, mode, count, bytes: out };
}

/* WTF-8 解码（与编码器的手写 UTF-8 互逆，保证孤立代理项也能往返） */
function utf8Decode(bytes) {
  let s = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++];
    if (b0 < 0x80) { s += String.fromCharCode(b0); continue; }
    let n, cp;
    if ((b0 & 0xe0) === 0xc0) { n = 1; cp = b0 & 0x1f; }
    else if ((b0 & 0xf0) === 0xe0) { n = 2; cp = b0 & 0x0f; }
    else if ((b0 & 0xf8) === 0xf0) { n = 3; cp = b0 & 0x07; }
    else throw new Error(`非法 UTF-8 首字节 0x${b0.toString(16)}`);
    for (let k = 0; k < n; k++) {
      const bx = bytes[i++];
      if ((bx & 0xc0) !== 0x80) throw new Error('非法 UTF-8 续字节');
      cp = (cp << 6) | (bx & 0x3f);
    }
    if (cp > 0x10ffff) throw new Error('码点越界');
    if (cp <= 0xffff) {
      s += String.fromCharCode(cp);
    } else {
      cp -= 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return s;
}

/* ========================================================================
 * 4. 断言框架
 * ====================================================================== */
let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; return true; }
  failures.push(`${name}${detail ? ' — ' + detail : ''}`);
  return false;
}
function eq(name, actual, expected) {
  return check(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

/* ========================================================================
 * 5. 测试用例集
 * ====================================================================== */
const SHORT_URL = 'https://43.154.210.202:8899/';
const LONG_URL = 'https://43.154.210.202:8899/index.html?typhoon=%E6%A1%A6%E5%8A%A0%E6%B2%99&t=2025-09-15T00:00:00Z&layer=satellite&focus=rect&lon=118.5&lat=21.3&zoom=7&panel=data&play=1';
const CN_URL = 'https://43.154.210.202:8899/台风可视化/桦加沙.html?时间=2025-09-15 00:00&路径=西北偏西';
const SPECIAL_URL = 'https://example.com/a b?x=1&y=2#frag&中文=值';

function buildCases() {
  const cases = [];
  // ① ≥12 组：ecLevel L/M/Q/H × 短 URL / 长 URL / 中文 URL
  for (const ec of ['L', 'M', 'Q', 'H']) cases.push({ name: `短URL·${ec}`, text: SHORT_URL, ecLevel: ec });
  for (const ec of ['L', 'M', 'Q', 'H']) cases.push({ name: `150+字符长URL·${ec}`, text: LONG_URL, ecLevel: ec });
  for (const ec of ['L', 'M', 'Q', 'H']) cases.push({ name: `中文URL·${ec}`, text: CN_URL, ecLevel: ec });
  // ② 边界与特殊
  cases.push({ name: '含&/#/空格/中文的URL·M', text: SPECIAL_URL, ecLevel: 'M' });
  cases.push({ name: '空串·M', text: '', ecLevel: 'M' });
  cases.push({ name: '单字符·H', text: 'a', ecLevel: 'H' });
  cases.push({ name: 'emoji(4字节UTF-8)·Q', text: 'https://x.test/🌀桦加沙🌪', ecLevel: 'Q' });
  cases.push({ name: '强制 minVersion=7（版本信息）·M', text: SHORT_URL, ecLevel: 'M', minVersion: 7 });
  cases.push({ name: '强制 minVersion=10（16bit计数）·L', text: SHORT_URL, ecLevel: 'L', minVersion: 10 });
  cases.push({ name: '强制 minVersion=27·Q', text: SHORT_URL, ecLevel: 'Q', minVersion: 27 });
  cases.push({ name: '大载荷(1000字符)·L', text: 'https://43.154.210.202:8899/' + 'A'.repeat(970), ecLevel: 'L' });
  cases.push({ name: '大载荷(300字符中文)·H', text: '台风路径' + '桦加沙'.repeat(100), ecLevel: 'H' });
  return cases;
}

const CASES = buildCases();
const results = [];

console.log('=== qr-encoder 位级自检 ===');
console.log(`模块: ${path.join(__dirname, 'qr-encoder.js')}`);
console.log(`用例数: ${CASES.length}\n`);

/* ---- 全局表核对（独立抄录的 ISO 表 vs 由 encode 行为推出的容量） ---- */
console.log('--- A. 表与容量交叉核对 ---');
for (let v = 1; v <= 10; v++) {
  for (let e = 0; e < 4; e++) {
    const cap = BYTE_CAPACITY[v][e];
    let ok = true, msg = '';
    try {
      QRCode.encode('a'.repeat(cap), { ecLevel: EC_NAMES[e], minVersion: v, maxVersion: v });
    } catch (err) { ok = false; msg = `容量内却抛错: ${err.message}`; }
    check(`v${v}-${EC_NAMES[e]} 容量 ${cap} 可编码`, ok, msg);
    if (cap + 1 <= 65535) {
      let threw = false, thrownMsg = '';
      try {
        QRCode.encode('a'.repeat(cap + 1), { ecLevel: EC_NAMES[e], minVersion: v, maxVersion: v });
      } catch (err) { threw = true; thrownMsg = err.message; }
      check(`v${v}-${EC_NAMES[e]} 容量 ${cap + 1} 必须抛 data too long`,
        threw && thrownMsg === 'QR: data too long', `threw=${threw} msg=${thrownMsg}`);
    }
  }
}
console.log(`  版本 1–10 × L/M/Q/H 容量边界：完成 (${passed} 项断言通过)`);

/* ---- 逐用例 ---- */
console.log('\n--- B. 位级往返与结构校验 ---');
for (const c of CASES) {
  const opts = { ecLevel: c.ecLevel };
  if (c.minVersion) opts.minVersion = c.minVersion;
  const qr = QRCode.encode(c.text, opts);
  const size = qr.size;
  const tag = `[${c.name}] v${qr.version}-${qr.ecLevel} mask${qr.mask} ${size}x${size}`;

  eq(`${tag} size = 4*version+17`, qr.size, qr.version * 4 + 17);
  eq(`${tag} modules 长度`, qr.modules.length, size * size);
  check(`${tag} modules 取值仅 0/1`, qr.modules.every((m) => m === 0 || m === 1));
  check(`${tag} mask ∈ [0,7]`, qr.mask >= 0 && qr.mask <= 7);
  eq(`${tag} ecLevel 回显`, qr.ecLevel, c.ecLevel);
  if (c.minVersion) check(`${tag} version ≥ minVersion`, qr.version >= c.minVersion);

  // --- 定位图形 + 分隔符 ---
  const at = (x, y) => qr.modules[y * size + x];
  const finderOk = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const want = (dist !== 2 && dist !== 4) ? 1 : 0;
        if (at(x, y) !== want) return false;
      }
    }
    return true;
  };
  check(`${tag} 左上定位图形+分隔符`, finderOk(3, 3));
  check(`${tag} 右上定位图形+分隔符`, finderOk(size - 4, 3));
  check(`${tag} 左下定位图形+分隔符`, finderOk(3, size - 4));

  // --- 时序图形 ---
  let timingOk = true;
  for (let i = 8; i < size - 8; i++) {
    if (at(i, 6) !== (i % 2 === 0 ? 1 : 0)) timingOk = false;
    if (at(6, i) !== (i % 2 === 0 ? 1 : 0)) timingOk = false;
  }
  check(`${tag} 时序图形交替`, timingOk);

  // --- 暗模块 ---
  eq(`${tag} 暗模块 (8,size-8)`, at(8, size - 8), 1);

  // --- 校正图形 ---
  const apos = alignmentPositions(qr.version);
  const na = apos.length;
  let alignOk = true;
  const expectAlign = new Set();
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      expectAlign.add(`${apos[i]},${apos[j]}`);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const want = Math.max(Math.abs(dx), Math.abs(dy)) !== 1 ? 1 : 0;
          if (at(apos[i] + dx, apos[j] + dy) !== want) alignOk = false;
        }
      }
    }
  }
  check(`${tag} 校正图形 5x5 形状 (共 ${expectAlign.size} 个, 坐标 ${apos.join(',')})`, alignOk);

  // --- 格式信息：两处副本分别校验（BCH 余式 + 解出的 ec/mask + 32 项合法串表命中）
  const fmt = readFormatInfo(qr.modules, size);
  const expectFmt = (EC_FORMAT_BITS[EC_NAMES.indexOf(qr.ecLevel)] << 3) | qr.mask;
  check(`${tag} 格式信息两份副本一致`, fmt.copy1 === fmt.copy2,
    `copy1=${fmt.copy1.toString(2)} copy2=${fmt.copy2.toString(2)}`);
  for (const [lbl, v] of [['副本1(左上)', fmt.copy1], ['副本2(右上+左下)', fmt.copy2]]) {
    const a = auditFormatCopy(v);
    check(`${tag} 格式信息${lbl} 去掩码后 BCH(15,5)/0x537 余式为 0`, a.bchOk,
      `v=0b${v.toString(2).padStart(15, '0')}`);
    eq(`${tag} 格式信息${lbl} 解出 (ecBits<<3)|mask`, a.ecBits, expectFmt);
    eq(`${tag} 格式信息${lbl} 命中 32 项合法格式串表`, a.tableHit,
      (EC_NAMES.indexOf(qr.ecLevel) << 3) | qr.mask);
  }

  // --- 版本信息 ---
  if (qr.version >= 7) {
    const vi = readVersionInfo(qr.modules, size);
    check(`${tag} 版本信息两份副本一致`, vi.copy1 === vi.copy2);
    check(`${tag} 版本信息 BCH 余式为 0`, versionBchCheck(vi.copy1));
    eq(`${tag} 版本信息 = version`, vi.copy1 >>> 12, qr.version);
  }

  // --- 位级往返 ---
  let dec = null;
  try { dec = decode(qr); } catch (err) {
    failures.push(`${tag} 解码异常: ${err.message}`);
    console.log(`      解码异常: ${err.message}`);
  }
  if (dec) {
    eq(`${tag} 往返文本一致`, dec.text, c.text);
    // --- RS 校验：每块的码字多项式在 α^0..α^(deg-1) 上全为 0 ---
    let rsOk = true, rsDetail = '';
    for (let b = 0; b < dec.blocks.length; b++) {
      const cw = [...dec.blocks[b], ...dec.eccs[b]];
      const n = cw.length;
      for (let s = 0; s < dec.eccs[b].length; s++) {
        let acc = 0;
        for (let j = 0; j < n; j++) acc ^= gfMul(cw[j], gfPow(2, s * (n - 1 - j)));
        if (acc !== 0) { rsOk = false; rsDetail = `block${b} syndrome${s}=${acc}`; break; }
      }
      if (!rsOk) break;
    }
    check(`${tag} RS 校验（${dec.blocks.length} 块 × ${dec.eccs[0].length} 校验字，syndrome 全 0）`, rsOk, rsDetail);
    check(`${tag} 数据码字数与表一致`,
      dec.blocks.reduce((a, b) => a + b.length, 0),
      dataCodewordCount(qr.version, EC_NAMES.indexOf(qr.ecLevel)));
  }

  results.push({
    name: c.name, text: c.text, version: qr.version,
    size, mask: qr.mask, ok: dec ? dec.text === c.text : false,
  });
  console.log(`  ${dec && dec.text === c.text ? 'PASS' : 'FAIL'}  ${tag}` +
    (dec && dec.text === c.text ? '' : `  文本不符! 得到=${JSON.stringify(dec && dec.text)}`));
}

/* ---- 自动选最小版本 + 掩码选优 ---- */
console.log('\n--- C. 自动选版本与掩码选优 ---');
{
  eq('17 字节 L 应选 v1', QRCode.encode('x'.repeat(17), { ecLevel: 'L' }).version, 1);
  eq('18 字节 L 应选 v2（17 放不下）', QRCode.encode('x'.repeat(18), { ecLevel: 'L' }).version, 2);
  eq('7 字节 H 应选 v1', QRCode.encode('x'.repeat(7), { ecLevel: 'H' }).version, 1);
  eq('8 字节 H 应选 v2', QRCode.encode('x'.repeat(8), { ecLevel: 'H' }).version, 2);
  eq('minVersion=40 强制最高版本', QRCode.encode('hi', { minVersion: 40 }).version, 40);

  // 掩码选优：用测试自带的独立罚分实现复算 8 个候选掩码，encode 报告者必须是最小值（同分取小）
  const probes = [
    ['短URL·M', SHORT_URL, { ecLevel: 'M' }],
    ['长URL·Q', LONG_URL, { ecLevel: 'Q' }],
    ['大载荷·L', 'https://43.154.210.202:8899/' + 'A'.repeat(970), { ecLevel: 'L' }],
  ];
  for (const [name, text, opts] of probes) {
    const qr = QRCode.encode(text, opts);
    const scores = [];
    for (let m = 0; m < 8; m++) scores.push(penaltyOf(reMasked(qr, m), qr.size));
    const best = Math.min(...scores);
    const argmin = scores.indexOf(best);
    eq(`[${name}] v${qr.version} 掩码选优（罚分 ${scores.join('/')}）`, qr.mask, argmin);
  }

  // 确定性
  const a = QRCode.encode(CN_URL, { ecLevel: 'Q' });
  const b = QRCode.encode(CN_URL, { ecLevel: 'Q' });
  check('确定性：同输入两次编码完全一致',
    a.version === b.version && a.mask === b.mask && a.modules.every((v, i) => v === b.modules[i]));
}

/* ---- 全部 40 个版本 × 4 等级的边界容量与往返 ---- */
console.log('\n--- C2. 全版本（v1–v40 × L/M/Q/H = 160 组）容量边界往返 ---');
{
  let ok = 0, bad = [];
  for (let v = 1; v <= 40; v++) {
    for (let e = 0; e < 4; e++) {
      // 该版本/等级的容量 = 表定数据码字数推出的 byte mode 容量
      const D = dataCodewordCount(v, e);
      const cc = v <= 9 ? 8 : 16;
      const cap = Math.floor((D * 8 - 4 - cc) / 8);
      const qr = QRCode.encode('z'.repeat(cap), { ecLevel: EC_NAMES[e], minVersion: v, maxVersion: v });
      const rt = decode(qr).text === 'z'.repeat(cap);
      let overflowThrows = false;
      try {
        QRCode.encode('z'.repeat(cap + 1), { ecLevel: EC_NAMES[e], minVersion: v, maxVersion: v });
      } catch (err) { overflowThrows = err.message === 'QR: data too long'; }
      if (qr.version === v && rt && overflowThrows) ok++;
      else bad.push(`v${v}-${EC_NAMES[e]}(cap=${cap},ver=${qr.version},rt=${rt},ovf=${overflowThrows})`);
    }
  }
  check(`160 组全版本容量边界 + 往返 + 溢出抛错`, bad.length === 0, bad.slice(0, 6).join(' '));
  console.log(`  通过 ${ok}/160`);
}

/* ---- 边界与错误 ---- */
console.log('\n--- D. 边界与错误处理 ---');
{
  let threw = false, msg = '';
  try { QRCode.encode('x'.repeat(3000), { ecLevel: 'L' }); } catch (e) { threw = true; msg = e.message; }
  check('超长（3000 字节 L，上限 2953）抛 data too long', threw && msg === 'QR: data too long', msg);

  threw = false;
  try { QRCode.encode('x', { ecLevel: 'Z' }); } catch (e) { threw = true; msg = e.message; }
  check('非法 ecLevel 抛错', threw, msg);

  threw = false;
  try { QRCode.encode('x', { minVersion: 10, maxVersion: 5 }); } catch (e) { threw = true; msg = e.message; }
  check('非法版本区间抛错', threw, msg);

  threw = false;
  try { QRCode.encode('x', { maxVersion: 41 }); } catch (e) { threw = true; msg = e.message; }
  check('maxVersion>40 抛错', threw, msg);

  // 空串行为：正常编码
  const empty = QRCode.encode('', { ecLevel: 'M' });
  eq('空串可编码且版本为 1', empty.version, 1);
  eq('空串往返为空', decode(empty).text, '');

  // 最大容量边界
  const maxL = QRCode.encode('x'.repeat(2953), { ecLevel: 'L' });
  eq('v40-L 上限 2953 字节 → version 40', maxL.version, 40);
  eq('v40-L 往返一致', decode(maxL).text, 'x'.repeat(2953));
  const maxH = QRCode.encode('x'.repeat(1273), { ecLevel: 'H' });
  eq('v40-H 上限 1273 字节 → version 40', maxH.version, 40);

  // 表定总码字数（独立抄录）必须能由功能图形模块数反推出来 —— 覆盖全部 40 个版本
  for (let v = 1; v <= 40; v++) {
    const size = v * 4 + 17;
    const funcMods = buildFunctionMap(v).reduce((a, b) => a + b, 0);
    eq(`v${v} 功能图形模块数 → 总码字数 ${TOTAL_CODEWORDS[v]}`,
      Math.floor((size * size - funcMods) / 8), TOTAL_CODEWORDS[v]);
  }
}

/* ---- render（假 canvas） ---- */
console.log('\n--- E. render() 渲染校验（假 canvas，零依赖） ---');
{
  const rects = [];
  const ctx = {
    canvas: null,
    imageSmoothingEnabled: true,
    fillStyle: '',
    fillRect(x, y, w, h) { rects.push({ x, y, w, h, style: this.fillStyle }); },
  };
  const canvas = {
    width: 300, height: 150, style: {},
    getContext() { return ctx; },
  };
  ctx.canvas = canvas;

  rects.length = 0;
  const out = QRCode.render(canvas, SHORT_URL, { ecLevel: 'M', margin: 4, dark: '#000', light: '#fff' });
  const count = out.size + 8;
  const scale = Math.max(2, Math.floor(300 / count));
  eq('render scale 公式', out.scale, scale);
  eq('canvas.width = count*scale', canvas.width, count * scale);
  eq('canvas.height = count*scale', canvas.height, count * scale);
  eq('canvas.style.width 同步', canvas.style.width, count * scale + 'px');
  eq('canvas.style.height 同步', canvas.style.height, count * scale + 'px');
  check('imageSmoothingEnabled = false（锐利）', ctx.imageSmoothingEnabled === false);
  const darkRects = rects.filter((r) => r.style === '#000');
  eq('暗色 fillRect 数 = 暗模块数',
    darkRects.length, out.modules.reduce((a, b) => a + (b ? 1 : 0), 0));
  check('所有 fillRect 整数像素对齐', rects.every((r) =>
    Number.isInteger(r.x) && Number.isInteger(r.y) && Number.isInteger(r.w) && Number.isInteger(r.h)));
  check('所有暗模块尺寸 = scale', darkRects.every((r) => r.w === scale && r.h === scale));
  check('存在浅色底填充', rects.some((r) => r.style === '#fff' && r.w === count * scale));
  const inRange = darkRects.every((r) =>
    r.x >= 4 * scale && r.y >= 4 * scale &&
    r.x + r.w <= (out.size + 4) * scale && r.y + r.h <= (out.size + 4) * scale);
  check('所有暗模块位于 margin 之内（静区完整）', inRange);

  // 支持直接传 ctx 且指定 scale
  const rects2 = [];
  const ctx2 = { fillRect(x, y, w, h) { rects2.push({ x, y, w, h, style: this.fillStyle }); }, fillStyle: '', imageSmoothingEnabled: true };
  const out2 = QRCode.render(ctx2, 'A', { scale: 7, margin: 2 });
  eq('显式 scale=7 生效', out2.scale, 7);
  eq('ctx 直传时 px = (size+2*margin)*scale', out2.px, (out2.size + 4) * 7);

  let threw = false;
  try { QRCode.render({}, 'A', {}); } catch (e) { threw = true; }
  check('非法 render target 抛错', threw);
}

/* ---- 形态合规（SPEC §0.5/§0.6：经典脚本、唯一全局、ES5 语法） ---- */
console.log('\n--- F. 形态合规（经典脚本 / 唯一全局 / ES5） ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'qr-encoder.js'), 'utf8');

  // 浏览器环境：在干净 vm 上下文里执行，检查只新增一个全局
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'qr-encoder.js' });
  const added = Object.keys(sandbox).filter((k) => !k.startsWith('__'));
  check('浏览器下只挂一个全局 window.QRCode',
    added.length === 1 && added[0] === 'QRCode', `实际新增: ${JSON.stringify(added)}`);
  check('window.QRCode 暴露 encode/render',
    typeof sandbox.QRCode?.encode === 'function' && typeof sandbox.QRCode?.render === 'function');

  // ES5 语法扫描（去掉字符串与注释后不应出现 ES6+ 构造）
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const es6 = [
    [/\blet\s+[A-Za-z_$]/, 'let'],
    [/\bconst\s+[A-Za-z_$]/, 'const'],
    [/=>/, '箭头函数'],
    [/`/, '模板字符串'],
    [/\bclass\s+[A-Za-z_$]/, 'class'],
    [/\bawait\b/, 'await'],
  ].filter(([re]) => re.test(stripped)).map(([, n]) => n);
  check('无 ES6+ 语法（var/function 为主）', es6.length === 0, `发现: ${es6.join(',')}`);
  check('经典脚本形态（含 module.exports 分支与 IIFE）',
    /module\.exports/.test(src) && !/^\s*(import|export)\s/m.test(src));
  check('零外部依赖 / 零网络请求',
    !/\brequire\s*\(/.test(src) && !/\bfetch\s*\(/.test(src) &&
    !/XMLHttpRequest|importScripts|\bimport\s*\(/.test(src) && !/https?:\/\//.test(src.replace(/^\s*\*.*$/gm, '')));
  check('文件头声明算法来源与许可', /ISO\/IEC 18004/.test(src) && /MIT/.test(src));
}

/* ---- 8 种掩码强制覆盖（forceMask） ---- */
console.log('\n--- G. 8 种掩码强制覆盖（forceMask 0–7 × L/M/Q/H = 32 组） ---');
{
  const bad = [];
  for (const ec of EC_NAMES) {
    const ecIndex = EC_NAMES.indexOf(ec);
    for (let m = 0; m < 8; m++) {
      const tag = `[forceMask ${ec}-m${m}]`;
      const qr = QRCode.encode(SHORT_URL, { ecLevel: ec, forceMask: m });
      if (qr.mask !== m) { bad.push(`${tag} mask 回显 ${qr.mask}`); continue; }
      let dec = null;
      try { dec = decode(qr); } catch (err) { bad.push(`${tag} 解码异常 ${err.message}`); continue; }
      if (dec.text !== SHORT_URL) { bad.push(`${tag} 往返文本不符`); continue; }
      const f = readFormatInfo(qr.modules, qr.size);
      if (f.copy1 !== f.copy2) { bad.push(`${tag} 两处格式副本不一致`); continue; }
      const a1 = auditFormatCopy(f.copy1), a2 = auditFormatCopy(f.copy2);
      if (!a1.bchOk || !a2.bchOk) { bad.push(`${tag} BCH 余式非 0`); continue; }
      if (a1.ecBits !== ((EC_FORMAT_BITS[ecIndex] << 3) | m)) { bad.push(`${tag} 格式信息值不符`); continue; }
      if (a1.tableHit !== ((ecIndex << 3) | m)) { bad.push(`${tag} 未命中合法格式串表`); continue; }
    }
  }
  check('32 组 forceMask 全部：往返 + 两处格式信息 BCH/取值正确', bad.length === 0, bad.slice(0, 5).join('; '));

  // 8 种掩码必须产生两两不同的矩阵（若某个公式写重/写错，会出现完全相同的矩阵）
  const sigList = [];
  for (let m = 0; m < 8; m++) {
    sigList.push(QRCode.encode(SHORT_URL, { ecLevel: 'M', forceMask: m }).modules.join(''));
  }
  check('8 种掩码产生两两不同的矩阵', new Set(sigList).size === 8);
  const flipCounts = sigList.map((s) => {
    let n = 0;
    for (let i = 0; i < s.length; i++) if (s[i] !== sigList[0][i]) n++;
    return n;
  });
  check('掩码两两差异非零（掩码 5 与掩码 0 确有区别）',
    flipCounts.every((n, i) => i === 0 || n > 0), `相对 m0 的差异位数: ${flipCounts.join('/')}`);

  // forceMask 不得影响默认路径：指定为「自动选中的掩码」时必须与默认结果逐位一致
  const auto = QRCode.encode(LONG_URL, { ecLevel: 'M' });
  const forcedSame = QRCode.encode(LONG_URL, { ecLevel: 'M', forceMask: auto.mask });
  check('forceMask=自动选中掩码 时与默认路径逐位一致',
    auto.mask === forcedSame.mask && auto.version === forcedSame.version &&
    auto.modules.every((v, i) => v === forcedSame.modules[i]));
  // 默认路径仍等于罚分 argmin（用独立罚分实现复算）
  const scores = [];
  for (let m = 0; m < 8; m++) scores.push(penaltyOf(reMasked(auto, m), auto.size));
  eq(`默认路径仍为罚分 argmin（罚分 ${scores.join('/')}）`, auto.mask, scores.indexOf(Math.min(...scores)));

  for (const badv of [-1, 8, 1.5, 'x']) {
    let threw = false;
    try { QRCode.encode('a', { forceMask: badv }); } catch (e) { threw = true; }
    check(`非法 forceMask=${JSON.stringify(badv)} 抛错`, threw, '未抛错');
  }
}

console.log('\n=== 结果 ===');
console.log(`断言通过: ${passed}`);
console.log(`断言失败: ${failures.length}`);
for (const f of failures) console.log('  FAIL ' + f);
console.log(`用例: ${results.filter((r) => r.ok).length}/${results.length} 往返成功`);
console.log(`用例数（SPEC 要求 ≥12）: ${results.length}`);
const maxVersionSeen = Math.max(...results.map((r) => r.version));
console.log(`覆盖版本范围: v${Math.min(...results.map((r) => r.version))} – v${maxVersionSeen}`);

/* ---- --emit ---- */
if (process.argv.includes('--emit')) {
  const outDir = path.resolve(__dirname, '..', '.dev');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'qr-cases.json');
  const payload = CASES.map((c, i) => {
    const opts = { ecLevel: c.ecLevel };
    if (c.minVersion) opts.minVersion = c.minVersion;
    const qr = QRCode.encode(c.text, opts);
    let bits = '';
    for (let k = 0; k < qr.modules.length; k++) bits += qr.modules[k] ? '1' : '0';
    return {
      name: c.name,
      text: c.text,
      version: qr.version,
      ec: qr.ecLevel,
      size: qr.size,
      mask: qr.mask,
      modules: bits,
      _note: 'modules 为 size*size 行优先位串，1=黑模块；外部解码请加 4 模块静区并放大为整数倍像素',
    };
  });
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 1), 'utf8');
  console.log(`\n已输出: ${outFile}  (${payload.length} 例)`);
}

/* ---- --force-mask-matrix：输出 (ec × mask) 全部 32 组合的矩阵到 stdout
 *      字段与 .dev/mask-force.mjs 一致：label/text/ecLevel/mask/version/size/rows
 *      人读报告已改走 stderr，stdout 只含 JSON 行，可直接管道给 Python 解码器。 ---- */
if (EMIT_MATRIX) {
  const TEXT = 'http://43.154.210.202:8899/';
  let combos = 0;
  for (const ec of EC_NAMES) {
    for (let mask = 0; mask < 8; mask++) {
      const r = QRCode.encode(TEXT, { ecLevel: ec, forceMask: mask });
      if (r.mask !== mask) {
        process.stderr.write(`# forceMask ${mask} 未生效（得到 ${r.mask}）\n`);
        continue;
      }
      const rows = [];
      for (let y = 0; y < r.size; y++) {
        let s = '';
        for (let x = 0; x < r.size; x++) s += r.modules[y * r.size + x] ? '1' : '0';
        rows.push(s);
      }
      process.stdout.write(JSON.stringify({
        label: `${ec}-m${mask}`, text: TEXT, ecLevel: ec, mask,
        version: r.version, size: r.size, rows,
      }) + '\n');
      combos++;
    }
  }
  process.stderr.write(`# forceMask supported combos: ${combos}\n`);
}

console.log(failures.length === 0 ? '\nALL GREEN ✅' : '\nFAILED ❌');
process.exit(failures.length === 0 ? 0 : 1);

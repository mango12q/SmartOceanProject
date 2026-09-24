/*!
 * mobile/qr-encoder.js
 * ---------------------------------------------------------------------------
 * 零依赖 QR Code 编码器（byte mode / UTF-8），面向离线单文件站点。
 *
 * 算法来源与许可
 *   - 实现依据：ISO/IEC 18004:2015《Information technology — Automatic
 *     identification and data capture techniques — QR Code bar code
 *     symbology specification》。第 7 章（符号结构）、第 8 章（数据编码、
 *     纠错、掩码、格式/版本信息）、Annex E（校正图形坐标）、Table 9（纠错分块）。
 *   - Reed–Solomon：GF(2^8)，本原多项式 0x11D，生成元 α = 2（§8.5）。
 *   - 格式信息：BCH(15,5)，生成多项式 0x537，固定掩码 0x5412（§8.9）。
 *   - 版本信息（version ≥ 7）：BCH(18,6)，生成多项式 0x1F25（§8.10）。
 *   - 掩码与罚分：8 种掩码公式 + N1=3 / N2=3 / N3=40 / N4=10 四条罚分规则（§8.8）。
 *   - 本文件为自研实现（MIT 许可），未复制任何第三方库代码。
 *
 * 形态
 *   - 经典脚本（非 ES module），可 <script src> 直插，也可整段内联进 index.html。
 *   - Node / CommonJS 下设置 module.exports；浏览器下只挂唯一全局 window.QRCode。
 *   - ES5 语法（var / function），不依赖构建工具与 polyfill。
 *
 * 冻结接口
 *   QRCode.encode(text, opts) -> { size, modules: Uint8Array, version, ecLevel, mask }
 *     opts: { ecLevel: 'L'|'M'|'Q'|'H' = 'M', minVersion: 1, maxVersion: 40 }
 *   QRCode.render(canvasOrCtx, text, opts) -> 同 encode 的返回值 + { canvas, scale, margin, px }
 *     opts 额外: { margin: 4, dark: '#000', light: '#fff', scale: 'auto', size: <目标像素宽> }
 *
 * 说明（行为约定）
 *   - 仅支持 byte mode（UTF-8），覆盖 URL / 中文路径。
 *   - 自动选最小可容纳版本；超出容量 throw new Error('QR: data too long')。
 *   - 空串会被正常编码（mode + 计数 0 + 终止符 + 补位），不抛错。
 *   - 孤立代理项（lone surrogate）按 WTF-8 三字节形式编码；正常 URL/文本不受影响。
 * ---------------------------------------------------------------------------
 */
;(function (global, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module !== null && module.exports) {
    module.exports = api;            /* Node / CommonJS */
  } else {
    global.QRCode = api;             /* 浏览器：唯一全局名 */
  }
})(typeof globalThis !== 'undefined' ? globalThis
  : typeof window !== 'undefined' ? window
  : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* =======================================================================
   * 1. ISO/IEC 18004 常量表
   * ===================================================================== */

  /* 纠错等级：表索引顺序 [L, M, Q, H]；格式信息里的 2 bit 指示符 L=01 M=00 Q=11 H=10 */
  var EC_INDEX = { L: 0, M: 1, Q: 2, H: 3 };
  var EC_NAMES = ['L', 'M', 'Q', 'H'];
  var EC_FORMAT_BITS = [1, 0, 3, 2];

  /* Table 9：每块纠错码字数 ECC_CODEWORDS_PER_BLOCK[ecIndex][version]（下标 0 占位） */
  var ECC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
      28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
      26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30,
      28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28,
      30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  ];

  /* Table 9：纠错块数量 NUM_BLOCKS[ecIndex][version]（下标 0 占位） */
  var NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8,
      8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
      17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20,
      23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25,
      25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  ];

  /* 罚分权重（§8.8.2 Table 11） */
  var PENALTY_N1 = 3;
  var PENALTY_N2 = 3;
  var PENALTY_N3 = 40;
  var PENALTY_N4 = 10;

  var MIN_VERSION = 1;
  var MAX_VERSION = 40;

  /* =======================================================================
   * 2. 版本容量计算
   * ===================================================================== */

  /* 该版本除功能图形外可用于数据的模块数（含 0–7 个剩余位） */
  function numRawDataModules(version) {
    var result = (16 * version + 128) * version + 64;
    if (version >= 2) {
      var numAlign = Math.floor(version / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (version >= 7) result -= 36;   /* 两块版本信息 6x3 */
    }
    return result;
  }

  /* 符号总码字数 */
  function numRawCodewords(version) {
    return Math.floor(numRawDataModules(version) / 8);
  }

  /* 数据码字数 */
  function numDataCodewords(version, ecIndex) {
    return numRawCodewords(version) -
      ECC_PER_BLOCK[ecIndex][version] * NUM_BLOCKS[ecIndex][version];
  }

  /* byte mode 字符计数指示符位宽：版本 1–9 → 8 位；10–26 → 16 位；27–40 → 16 位 */
  function charCountBits(version) {
    return version <= 9 ? 8 : 16;
  }

  /* 校正图形中心坐标（ISO/IEC 18004 Annex E；version 1 无校正图形） */
  function alignmentPatternPositions(version) {
    if (version === 1) return [];
    var size = version * 4 + 17;
    var numAlign = Math.floor(version / 7) + 2;
    /* version 32 的步长是规范中的特例（表值 6,34,60,86,112,138，步长 26） */
    var step = (version === 32) ? 26 :
      Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var pos = size - 7; result.length < numAlign; pos -= step) {
      result.splice(1, 0, pos);
    }
    return result;
  }

  /* =======================================================================
   * 3. GF(2^8) 与 Reed–Solomon
   * ===================================================================== */

  var GF_EXP = new Uint8Array(512);
  var GF_LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;      /* 本原多项式 x^8+x^4+x^3+x^2+1 */
    }
    for (var j = 255; j < 512; j++) GF_EXP[j] = GF_EXP[j - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  /* RS 生成多项式 g(x) = Π (x - α^i), i = 0..degree-1；系数从最高次到最低次 */
  function rsGeneratorPoly(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1);
      for (var k = 0; k < next.length; k++) next[k] = 0;
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];                       /* × x */
        next[j + 1] ^= gfMul(poly[j], GF_EXP[i]); /* × α^i */
      }
      poly = next;
    }
    return poly;
  }

  /* 系统码 RS 余式（即纠错码字）：返回长度 degree 的 Uint8Array */
  function rsRemainder(data, degree) {
    var gen = rsGeneratorPoly(degree);
    var rem = new Uint8Array(degree);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ rem[0];
      for (var j = 0; j < degree - 1; j++) rem[j] = rem[j + 1];
      rem[degree - 1] = 0;
      if (factor !== 0) {
        for (var k = 0; k < degree; k++) rem[k] ^= gfMul(gen[k + 1], factor);
      }
    }
    return rem;
  }

  /* =======================================================================
   * 4. 数据编码（byte mode / UTF-8）
   * ===================================================================== */

  /* 手写 UTF-8 编码，行为在 Node 与浏览器完全一致（不依赖 TextEncoder） */
  function toUtf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        var lo = str.charCodeAt(i + 1);
        if (lo >= 0xDC00 && lo <= 0xDFFF) {
          var cp = 0x10000 + ((c - 0xD800) << 10) + (lo - 0xDC00);
          out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F),
                   0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
          i++;
        } else {
          /* 孤立高位代理项：按 WTF-8 三字节形式输出，保证可逆 */
          out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
        }
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    return new Uint8Array(out);
  }

  /* 位缓冲：MSB first */
  function BitBuffer() {
    this.bytes = [];
    this.length = 0;
  }
  BitBuffer.prototype.pushBit = function (bit) {
    var idx = this.length >>> 3;
    if (idx === this.bytes.length) this.bytes.push(0);
    if (bit) this.bytes[idx] |= 0x80 >>> (this.length & 7);
    this.length++;
  };
  BitBuffer.prototype.push = function (value, bits) {
    for (var i = bits - 1; i >= 0; i--) this.pushBit((value >>> i) & 1);
  };

  /* 构造数据码字序列：模式指示符 + 计数 + 数据 + 终止符 + 字节对齐 + 0xEC/0x11 补位 */
  function buildDataCodewords(bytes, version, ecIndex) {
    var capacity = numDataCodewords(version, ecIndex) * 8;
    var bb = new BitBuffer();
    bb.push(0x4, 4);                                  /* byte mode = 0100 */
    bb.push(bytes.length, charCountBits(version));
    for (var i = 0; i < bytes.length; i++) bb.push(bytes[i], 8);

    /* 终止符：最多 4 个 0，容量不足时取剩余位数 */
    var term = Math.min(4, capacity - bb.length);
    if (term > 0) bb.push(0, term);
    /* 补齐到字节边界 */
    while (bb.length % 8 !== 0) bb.pushBit(0);
    /* 交替补位码字 0xEC / 0x11 */
    for (var p = 0; bb.length < capacity; p++) bb.push(p % 2 === 0 ? 0xEC : 0x11, 8);

    var out = new Uint8Array(bb.bytes.length);
    for (var k = 0; k < bb.bytes.length; k++) out[k] = bb.bytes[k];
    return out;
  }

  /* 分块 + RS 纠错 + 交织，返回长度 = 符号总码字数的序列 */
  function addEccAndInterleave(data, version, ecIndex) {
    var numBlocks = NUM_BLOCKS[ecIndex][version];
    var blockEccLen = ECC_PER_BLOCK[ecIndex][version];
    var rawCodewords = numRawCodewords(version);
    var numShortBlocks = numBlocks - rawCodewords % numBlocks;
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);
    var firstEccIdx = shortBlockLen - blockEccLen;

    var blocks = [];
    var k = 0;
    for (var i = 0; i < numBlocks; i++) {
      var datLen = firstEccIdx + (i < numShortBlocks ? 0 : 1);
      var dat = new Uint8Array(datLen);
      for (var t = 0; t < datLen; t++) dat[t] = data[k++];
      var ecc = rsRemainder(dat, blockEccLen);
      /* 统一长度 shortBlockLen+1：短块在 firstEccIdx 处留一个占位字节，
         因此长块的纠错码字起始偏移 = datLen，短块 = datLen + 1 */
      var blk = new Uint8Array(shortBlockLen + 1);
      for (var a = 0; a < datLen; a++) blk[a] = dat[a];
      var eccOff = datLen + (i < numShortBlocks ? 1 : 0);
      for (var b = 0; b < blockEccLen; b++) blk[eccOff + b] = ecc[b];
      blocks.push(blk);
    }

    var result = new Uint8Array(rawCodewords);
    var pos = 0;
    for (var idx = 0; idx < shortBlockLen + 1; idx++) {
      for (var j = 0; j < numBlocks; j++) {
        if (idx !== firstEccIdx || j >= numShortBlocks) result[pos++] = blocks[j][idx];
      }
    }
    return result;
  }

  /* =======================================================================
   * 5. 矩阵构造
   * ===================================================================== */

  function Matrix(version) {
    this.version = version;
    this.size = version * 4 + 17;
    var n = this.size * this.size;
    this.modules = new Uint8Array(n);
    this.isFunction = new Uint8Array(n);
  }
  Matrix.prototype.setFunction = function (x, y, dark) {
    var i = y * this.size + x;
    this.modules[i] = dark ? 1 : 0;
    this.isFunction[i] = 1;
  };

  /* 定位图形（含 1 模块宽分隔符，dist==4 即为分隔符） */
  Matrix.prototype.drawFinder = function (cx, cy) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        var x = cx + dx, y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
          this.setFunction(x, y, dist !== 2 && dist !== 4);
        }
      }
    }
  };

  /* 校正图形 5x5：中心 + 外环为黑 */
  Matrix.prototype.drawAlignment = function (cx, cy) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        this.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };

  /* 格式信息 BCH(15,5) + 固定掩码 0x5412，写入两个副本；同时写暗模块 */
  Matrix.prototype.drawFormatBits = function (ecIndex, mask) {
    var data = (EC_FORMAT_BITS[ecIndex] << 3) | mask;   /* 5 bit */
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | (rem & 0x3FF)) ^ 0x5412; /* 15 bit */
    var size = this.size;

    /* 副本 1：左上行/列（bit0 = LSB） */
    for (i = 0; i <= 5; i++) this.setFunction(8, i, getBit(bits, i));
    this.setFunction(8, 7, getBit(bits, 6));
    this.setFunction(8, 8, getBit(bits, 7));
    this.setFunction(7, 8, getBit(bits, 8));
    for (i = 9; i < 15; i++) this.setFunction(14 - i, 8, getBit(bits, i));

    /* 副本 2：右上横排 + 左下竖排 */
    for (i = 0; i < 8; i++) this.setFunction(size - 1 - i, 8, getBit(bits, i));
    for (i = 8; i < 15; i++) this.setFunction(8, size - 15 + i, getBit(bits, i));

    /* 固定暗模块 */
    this.setFunction(8, size - 8, true);
  };

  /* 版本信息 BCH(18,6)，仅 version ≥ 7 */
  Matrix.prototype.drawVersionBits = function () {
    if (this.version < 7) return;
    var rem = this.version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = (this.version << 12) | (rem & 0xFFF);    /* 18 bit */
    for (i = 0; i < 18; i++) {
      var color = getBit(bits, i) ? 1 : 0;
      var a = this.size - 11 + (i % 3);
      var b = Math.floor(i / 3);
      this.setFunction(a, b, color);   /* 右上 3x6 */
      this.setFunction(b, a, color);   /* 左下 6x3 */
    }
  };

  /* 全部功能图形 + 预留格式/版本信息区 */
  Matrix.prototype.drawFunctionPatterns = function (ecIndex) {
    var size = this.size, i;

    /* 时序图形 */
    for (i = 0; i < size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    /* 三个定位图形（含分隔符） */
    this.drawFinder(3, 3);
    this.drawFinder(size - 4, 3);
    this.drawFinder(3, size - 4);

    /* 校正图形：跳过与三个定位图形重叠的位置 */
    var pos = alignmentPatternPositions(this.version);
    var n = pos.length;
    for (i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        this.drawAlignment(pos[i], pos[j]);
      }
    }

    /* 先用 mask=0 占位，保证数据放置阶段这些位置被标记为功能模块 */
    this.drawFormatBits(ecIndex, 0);
    this.drawVersionBits();
  };

  /* 按标准顺序放置数据位：列对自右向左，跳过第 6 列，上下蛇形 */
  Matrix.prototype.drawCodewords = function (codewords) {
    var size = this.size;
    var totalBits = codewords.length * 8;
    var i = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      /* 注意：必须就地改写循环变量，否则会漏掉第 0 列并重复第 4 列 */
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          var idx = y * size + x;
          if (!this.isFunction[idx] && i < totalBits) {
            this.modules[idx] = getBit(codewords[i >>> 3], 7 - (i & 7));
            i++;
          }
          /* 剩余位（0–7 个）保持为 0，随后与数据位一同参与掩码 */
        }
      }
    }
  };

  Matrix.prototype.clone = function () {
    var m = Object.create(Matrix.prototype);
    m.version = this.version;
    m.size = this.size;
    m.modules = new Uint8Array(this.modules);
    m.isFunction = new Uint8Array(this.isFunction);
    return m;
  };

  /* 应用（或撤销，XOR 自逆）掩码，只作用于非功能模块
   * 公式依 ISO/IEC 18004:2015 Table 10（i = 行 y，j = 列 x）。
   * 注意：掩码 5/6/7 的判据是「(…)%2 + (…)%3 == 0」——加法不是乘法。
   * JS 优先级：% > + > ===，故 `a % 2 + b % 3 === 0` 等价于 `((a%2) + (b%3)) === 0`；
   * 这里显式加括号只为消除歧义，语义与不写括号完全相同。 */
  Matrix.prototype.applyMask = function (mask) {
    var size = this.size;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var idx = y * size + x;
        if (this.isFunction[idx]) continue;
        var invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (invert) this.modules[idx] ^= 1;
      }
    }
  };

  /* ---- 罚分（§8.8.2 Table 11） ---- */

  /* [from, to) 全为浅色则返回 true；越界部分视为浅色（静区） */
  function isWhiteRun(get, from, to) {
    for (var i = from; i < to; i++) {
      if (i < 0) continue;
      if (get(i)) return false;
    }
    return true;
  }

  Matrix.prototype.penaltyScore = function () {
    var size = this.size;
    var mods = this.modules;
    var result = 0;
    var x, y, runLen, prev, color;

    /* N1：行/列中同色连续模块 ≥5 */
    for (y = 0; y < size; y++) {
      runLen = 0; prev = -1;
      for (x = 0; x < size; x++) {
        color = mods[y * size + x];
        if (color === prev) {
          runLen++;
        } else {
          if (runLen >= 5) result += PENALTY_N1 + (runLen - 5);
          runLen = 1; prev = color;
        }
      }
      if (runLen >= 5) result += PENALTY_N1 + (runLen - 5);
    }
    for (x = 0; x < size; x++) {
      runLen = 0; prev = -1;
      for (y = 0; y < size; y++) {
        color = mods[y * size + x];
        if (color === prev) {
          runLen++;
        } else {
          if (runLen >= 5) result += PENALTY_N1 + (runLen - 5);
          runLen = 1; prev = color;
        }
      }
      if (runLen >= 5) result += PENALTY_N1 + (runLen - 5);
    }

    /* N2：2x2 同色块 */
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        color = mods[y * size + x];
        if (color === mods[y * size + x + 1] &&
            color === mods[(y + 1) * size + x] &&
            color === mods[(y + 1) * size + x + 1]) {
          result += PENALTY_N2;
        }
      }
    }

    /* N3：类定位图形 1:1:3:1:1（两侧需有 ≥4 个浅色模块，越界视为浅色） */
    var rowGet = function (yy) { return function (i) { return mods[yy * size + i] === 1; }; };
    var colGet = function (xx) { return function (i) { return mods[i * size + xx] === 1; }; };
    function matchesFinder(get, p) {
      return get(p) && !get(p + 1) && get(p + 2) && get(p + 3) &&
             get(p + 4) && !get(p + 5) && get(p + 6);
    }
    for (y = 0; y < size; y++) {
      var gr = rowGet(y);
      for (x = 0; x + 6 < size; x++) {
        if (matchesFinder(gr, x) &&
            (isWhiteRun(gr, x - 4, x) || isWhiteRun(gr, x + 7, x + 11))) {
          result += PENALTY_N3;
        }
      }
    }
    for (x = 0; x < size; x++) {
      var gc = colGet(x);
      for (y = 0; y + 6 < size; y++) {
        if (matchesFinder(gc, y) &&
            (isWhiteRun(gc, y - 4, y) || isWhiteRun(gc, y + 7, y + 11))) {
          result += PENALTY_N3;
        }
      }
    }

    /* N4：黑白比例偏离 50% 的 5% 档数 */
    var dark = 0;
    for (var i = 0; i < mods.length; i++) dark += mods[i];
    var total = size * size;
    result += Math.floor(Math.abs(dark * 2 - total) * 10 / total) * PENALTY_N4;

    return result;
  };

  function getBit(value, i) {
    return ((value >>> i) & 1) !== 0;
  }

  /* =======================================================================
   * 6. 对外接口
   * ===================================================================== */

  function encode(text, opts) {
    opts = opts || {};
    var ecName = opts.ecLevel === undefined || opts.ecLevel === null
      ? 'M' : String(opts.ecLevel).toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(EC_INDEX, ecName)) {
      throw new Error('QR: invalid ecLevel: ' + opts.ecLevel);
    }
    var ecIndex = EC_INDEX[ecName];

    var minVersion = opts.minVersion === undefined || opts.minVersion === null
      ? MIN_VERSION : opts.minVersion | 0;
    var maxVersion = opts.maxVersion === undefined || opts.maxVersion === null
      ? MAX_VERSION : opts.maxVersion | 0;
    if (minVersion < MIN_VERSION || maxVersion > MAX_VERSION || minVersion > maxVersion) {
      throw new Error('QR: invalid version range ' + minVersion + '..' + maxVersion);
    }

    var bytes = toUtf8Bytes(text === undefined || text === null ? '' : String(text));

    /* 自动选最小可容纳版本 */
    var version = -1;
    for (var v = minVersion; v <= maxVersion; v++) {
      var need = 4 + charCountBits(v) + bytes.length * 8;
      if (need <= numDataCodewords(v, ecIndex) * 8) { version = v; break; }
    }
    if (version < 0) throw new Error('QR: data too long');

    var data = buildDataCodewords(bytes, version, ecIndex);
    var codewords = addEccAndInterleave(data, version, ecIndex);

    var matrix = new Matrix(version);
    matrix.drawFunctionPatterns(ecIndex);
    matrix.drawCodewords(codewords);

    /* 掩码选择：默认 8 种掩码逐一评估罚分取最小（同分取较小掩码号）；
       opts.forceMask（0–7，测试专用）指定时完全跳过罚分选优，直接用该掩码，
       返回的 mask 字段即实际使用的掩码。两条路径互不影响：不传 forceMask 时
       执行的就是原来的选优循环，行为与字节级完全一致。 */
    var mask;
    var forced = opts.forceMask;
    if (forced !== undefined && forced !== null) {
      if (typeof forced !== 'number' || forced % 1 !== 0 || forced < 0 || forced > 7) {
        throw new Error('QR: invalid forceMask (expected 0-7): ' + forced);
      }
      mask = forced;
    } else {
      mask = 0;
      var bestPenalty = Infinity;
      for (var m = 0; m < 8; m++) {
        var probe = matrix.clone();
        probe.applyMask(m);
        probe.drawFormatBits(ecIndex, m);
        var penalty = probe.penaltyScore();
        if (penalty < bestPenalty) { bestPenalty = penalty; mask = m; }
      }
    }
    matrix.applyMask(mask);
    matrix.drawFormatBits(ecIndex, mask);

    return {
      size: matrix.size,
      modules: matrix.modules,
      version: version,
      ecLevel: EC_NAMES[ecIndex],
      mask: mask
    };
  }

  function render(canvasOrCtx, text, opts) {
    opts = opts || {};
    var qr = encode(text, opts);

    var margin = opts.margin === undefined || opts.margin === null ? 4 : opts.margin | 0;
    if (margin < 0) throw new Error('QR: invalid margin');
    var dark = opts.dark || '#000';
    var light = opts.light || '#fff';

    var canvas = null, ctx = null;
    if (canvasOrCtx && typeof canvasOrCtx.getContext === 'function') {
      canvas = canvasOrCtx;
      ctx = canvas.getContext('2d');
    } else if (canvasOrCtx && typeof canvasOrCtx.fillRect === 'function') {
      ctx = canvasOrCtx;
      canvas = ctx.canvas || null;
    } else {
      throw new Error('QR: render target must be a canvas or a 2D context');
    }
    if (!ctx) throw new Error('QR: 2D context unavailable');

    var count = qr.size + margin * 2;

    /* 整数缩放：scale = max(2, floor(targetSize / count)) */
    var scale = opts.scale;
    if (scale === undefined || scale === null || scale === 'auto') {
      var targetSize = opts.size;
      if (!targetSize && canvas) targetSize = canvas.width || canvas.clientWidth || 0;
      if (!targetSize) targetSize = 300;
      scale = Math.max(2, Math.floor(targetSize / count));
    } else {
      scale = Math.max(1, Math.floor(scale));
    }

    var px = count * scale;
    if (canvas) {
      canvas.width = px;              /* 赋值会重置 2D 上下文状态 */
      canvas.height = px;
      if (canvas.style) {
        canvas.style.width = px + 'px';   /* CSS 尺寸决定 HiDPI 下的显示大小 */
        canvas.style.height = px + 'px';
      }
    }
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = light;
    ctx.fillRect(0, 0, px, px);

    ctx.fillStyle = dark;
    var size = qr.size, mods = qr.modules;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (mods[y * size + x]) {
          ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
        }
      }
    }

    return {
      size: size,
      modules: mods,
      version: qr.version,
      ecLevel: qr.ecLevel,
      mask: qr.mask,
      canvas: canvas,
      scale: scale,
      margin: margin,
      px: px
    };
  }

  return { encode: encode, render: render };
});

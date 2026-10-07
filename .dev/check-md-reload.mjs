/**
 * check-md-reload.mjs —— 验证「跨出移动端断点就整页重载」这件事**真的按预期工作**。
 *
 * 为什么需要它：这个行为以前只靠"线上跑一圈没有报错"来间接判断，而它恰恰有个反直觉的
 * 失败模式 —— 加载期的瞬时翻转会误触发重载（实测碰到过一次 dock=none）。所以这里用
 * CDP 的 Emulation.setDeviceMetricsOverride **在页面还活着的时候改视口**，直接观测：
 *
 *   A. 加载期抖动（2s 内 390 → 1440 → 390）**不得**触发重载；
 *   B. 加载完成后的真实旋转（390 → 1440）**必须**触发一次重载，且重载后布局切到桌面。
 *
 * 重载检测：页面里打一个 `window.__docMark`，重载会把它清掉 → typeof 变 undefined。
 *
 * 零依赖（Node 22+ 内置 WebSocket）。用法: node .dev/check-md-reload.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_ = process.argv.find(a => a.startsWith('http')) || 'http://43.154.210.202:8899/';
const PORT = 9344;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'cdp-mdreload-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] });

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { /* 未就绪 */ }
    await sleep(250);
  }
  throw new Error('Chrome CDP 未就绪');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
    const c = new CDP(ws);
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pending.has(m.id)) {
        const { res, rej } = c.pending.get(m.id);
        c.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) c.events.push(m);
    };
    return c;
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); }
      }, 30000);
    });
  }
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};

const cdp = await CDP.connect(await getWsUrl());
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
await cdp.send('Page.enable', {}, sessionId);
await cdp.send('Runtime.enable', {}, sessionId);

async function metrics(w, h) {
  const mobile = w <= 768;
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: 1, mobile, screenOrientation: { angle: 0, type: 'portraitPrimary' } },
    sessionId);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 }, sessionId);
}

async function evalJs(expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId);
  return r.result?.value;
}

async function state() {
  return await evalJs(`JSON.stringify({
    mark: typeof window.__docMark,
    dock: !!document.getElementById('mobile-dock'),
    mobileUi: document.documentElement.classList.contains('mobile-ui')
  })`);
}

/* 等主逻辑 init 完成（`__mainReady`）再动视口。
 * 不这么做的话，公网慢加载（实测线上约 5.3s 才就绪）会让"翻转"发生在监听器注册之前，
 * 于是 A 组会因为"页面还没建好 Dock"而误判 —— 那是等待窗口的问题，不是重载行为的问题。 */
async function waitMainReady() {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      if (await evalJs('window.__mainReady === true')) return true;
    } catch { /* 上下文失效，下一轮 */ }
    await sleep(250);
  }
  console.log('   [warn] 25000ms 内未见 __mainReady');
  return false;
}

// ---------------------------------------------------------------- A. 加载期抖动
await metrics(390, 844);
await cdp.send('Page.navigate', { url: URL_ }, sessionId);
await waitMainReady();
await sleep(800);
const a0 = JSON.parse(await state());
await evalJs('window.__docMark = 1');                       // 打标记
await metrics(1440, 900);                                   // 抖动①：切到桌面
await sleep(300);
await metrics(390, 844);                                    // 抖动②：马上切回来
await sleep(1800);
const a1 = JSON.parse(await state());
check('A. 加载期抖动不触发重载（标记仍在）', a1.mark === 'number',
  `mark=${a1.mark} dock=${a1.dock} mobile-ui=${a1.mobileUi}`);
check('A. 抖动后移动端 UI 仍完好（Dock 在位）', a1.dock === true, `dock=${a1.dock}`);
check('A. 基线：初始加载时 Dock 本就建出来了', a0.dock === true, `dock=${a0.dock}`);

// ---------------------------------------------------------------- B. 真实旋转
await metrics(390, 844);
await cdp.send('Page.navigate', { url: URL_ }, sessionId);
await waitMainReady();
await sleep(2500);                                          // 远晚于 2s 保护窗
const b0 = JSON.parse(await state());
await evalJs('window.__docMark = 2');
await metrics(1440, 900);                                   // 真实「旋转/拖宽」
await sleep(3000);                                          // 400ms 去抖 + 重载 + 初始化
const b1 = JSON.parse(await state());
check('B. 旋转前 Dock 在位', b0.dock === true, `dock=${b0.dock}`);
check('B. 真实旋转触发了一次重载（标记被清掉）', b1.mark === 'undefined', `mark=${b1.mark}`);
check('B. 重载后切到桌面布局（无 Dock、无 mobile-ui）',
  b1.dock === false && b1.mobileUi === false, `dock=${b1.dock} mobile-ui=${b1.mobileUi}`);

const errs = cdp.events.filter(e => e.method === 'Runtime.exceptionThrown').length;
check('C. 全程无 JS 异常', errs === 0, `exceptionThrown=${errs}`);

try { chrome.kill(); } catch { /* */ }
try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ }

const failed = results.filter(r => !r[1]);
console.log('-'.repeat(72));
if (failed.length) {
  console.log(`失败 ${failed.length}/${results.length}`);
  process.exit(1);
}
console.log(`ALL GREEN：${results.length}/${results.length} 项通过`);

/**
 * mouse-test.mjs — 桌面端鼠标回归（重点：我改过的关注区矩形绘制，鼠标路径必须照旧可用）
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_ = process.argv[2] || 'http://127.0.0.1:8124/preview.html';
const OUT = process.argv[3] || '.dev/shots';
const PORT = Number(process.env.CDP_PORT || 9511);
mkdirSync(OUT, { recursive: true });
const profile = join(tmpdir(), 'cdp-mouse-' + Date.now());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch {}
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}

const results = [];
const check = (n, p, d) => results.push({ n, p: !!p, d: String(d ?? '') });

async function run() {
  const ws = new WebSocket(await wsUrl());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, 40000);
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Log.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Page.navigate', { url: URL_ }, sessionId);
  await sleep(4200);

  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sessionId)).result.value;
  const mouse = async (type, x, y, button = 'left', clickCount = 1) =>
    send('Input.dispatchMouseEvent', { type, x, y, button, buttons: type === 'mouseMoved' && button === 'left' ? 1 : (type === 'mousePressed' || type === 'mouseMoved' ? 1 : 0), clickCount }, sessionId);
  const click = async (x, y, wait = 350) => {
    await mouse('mouseMoved', x, y, 'none', 0);
    await mouse('mousePressed', x, y, 'left', 1);
    await mouse('mouseReleased', x, y, 'left', 1);
    await sleep(wait);
  };
  const center = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
      const r = e.getBoundingClientRect(); if (!r.width) return null;
      return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);

  check('桌面端未激活移动布局', await ev(`!document.documentElement.classList.contains('mobile-ui')`), '');
  check('Dock 不存在', await ev(`!document.getElementById('mobile-dock')`), '');

  // —— 关注区矩形（鼠标拖拽）——
  const fb = await center('#btn-focus');
  await click(fb.x, fb.y, 450);
  const rb = await center('#btn-focus-rect');
  if (rb) await click(rb.x, rb.y, 450);
  await mouse('mouseMoved', 500, 300, 'none', 0);
  await mouse('mousePressed', 500, 300, 'left', 1);
  for (let i = 1; i <= 12; i++) { await mouse('mouseMoved', 500 + 20 * i, 300 + 12 * i, 'left', 1); await sleep(18); }
  await mouse('mouseReleased', 740, 444, 'left', 1);
  await sleep(900);
  const fw = await ev(`(() => { const w = document.getElementById('focus-window'); const r = w.getBoundingClientRect();
      return { disp: getComputedStyle(w).display, w: Math.round(r.width), h: Math.round(r.height) }; })()`);
  check('桌面鼠标拖拽绘制关注区 → 小窗出现', fw.disp === 'flex' && fw.w > 0, JSON.stringify(fw));
  await ev(`document.getElementById('focus-window-close').click()`); await sleep(300);

  // —— 测距（鼠标点击）——
  const mb = await center('#btn-measure');
  await click(mb.x, mb.y, 400);
  await click(500, 350, 250); await click(700, 420, 250);
  const mtext = await ev(`document.getElementById('measure-text').textContent`);
  check('桌面测距可用', /\d/.test(mtext || ''), JSON.stringify(mtext));
  await ev(`document.getElementById('measure-done').click()`); await sleep(200);
  await ev(`document.getElementById('measure-clear').click()`); await sleep(200);

  // —— 扫码弹窗（桌面专属入口）——
  const qb = await center('#btn-qr');
  await click(qb.x, qb.y, 600);
  const qr = await ev(`(() => ({ open: document.getElementById('qr-modal').classList.contains('open'),
      meta: (document.getElementById('qr-meta').textContent || '').split('\\n')[0] }))()`);
  check('桌面扫码弹窗可开', qr.open === true, JSON.stringify(qr));
  await ev(`document.querySelector('#qr-modal .qr-close').click()`); await sleep(300);

  // —— 播放 / 图层 / 面板开关 ——
  const play = await center('#btn-play');
  const t0 = await ev(`document.getElementById('time-slider').value`);
  await click(play.x, play.y, 1400);
  const t1 = await ev(`document.getElementById('time-slider').value`);
  await click(play.x, play.y, 300);
  check('桌面播放推进', t0 !== t1, `${t0} -> ${t1}`);
  const lp = await center('#left-panel-toggle');
  await click(lp.x, lp.y, 600);
  check('桌面左侧数据面板可开', await ev(`document.getElementById('left-panel').classList.contains('open')`) === true, '');
  await ev(`document.getElementById('left-panel-close').click()`); await sleep(300);

  // —— 桌面 tooltip 仍在（hover 气泡）——
  const tipOk = await ev(`(() => { const b = document.getElementById('btn-measure'); const cs = getComputedStyle(b, '::after');
      return { content: cs.content, opacity: cs.opacity, position: cs.position }; })()`);
  check('桌面 tooltip 样式未被移动端规则破坏', tipOk.position === 'absolute', JSON.stringify(tipOk));

  const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(join(OUT, 'desktop-mouse-1440x900.png'), Buffer.from(shot.data, 'base64'));
  const errs = [];
  let pass = 0;
  console.log('\n===== 桌面端鼠标回归（1440×900）=====');
  for (const r of results) { if (r.p) pass++; console.log(`  [${r.p ? 'PASS' : 'FAIL'}] ${r.n}  — ${r.d}`); }
  console.log(`\n合计: ${pass}/${results.length} 通过`);
  console.log('截图: ' + join(OUT, 'desktop-mouse-1440x900.png'));
  await send('Browser.close').catch(() => {});
}
run().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1; })
  .finally(() => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} });

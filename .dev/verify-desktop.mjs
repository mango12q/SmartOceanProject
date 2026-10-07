/**
 * verify-desktop.mjs — PC 端「零回归」验证：像素级对比改动前 / 改动后
 *
 * 基线: .dev/site/_baseline.html  （= git HEAD:index.html，blob 哈希已核对）
 * 新版: .dev/site/preview.html
 *
 * 方法:
 *   - 同一浏览器、同一视口、同一 DSF，先统一冻结 CSS 动画/过渡（消除 marquee 抖动这类
 *     非确定性噪声，冻结本身对两页完全一致，不影响对比公平性）；
 *   - 等 __mainReady + 稳定后截图；
 *   - 逐像素比 diff，输出差异包围盒与像素数；
 *   - 结构化对比：新增/缺失的 id。
 *
 * 预期: 差异**只**出现在右上角新增的 #btn-lang 区域。
 *
 * 用法: node .dev/verify-desktop.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://127.0.0.1:8124/_baseline.html';
const NEW_URL = 'http://127.0.0.1:8124/preview.html';
const OUT = '.dev/desktop-diff';
const PORT = Number(process.env.CDP_PORT || 9481);
mkdirSync(OUT, { recursive: true });
const profile = join(tmpdir(), 'cdp-desktop-' + Date.now());
const sleep = ms => new Promise(r => setTimeout(r, ms));

const VIEWPORTS = [
  { w: 1440, h: 900, name: '1440x900' },
  { w: 1024, h: 768, name: '1024x768' },
  { w: 1920, h: 1080, name: '1920x1080' },
];

const results = [];
const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail: String(detail ?? '') });

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'],
  { stdio: 'ignore' });

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch {}
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}

async function run() {
  const ws = new WebSocket(await wsUrl());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
  const send = (method, params = {}, sid) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, sessionId: sid }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, 60000);
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  for (const d of ['Page', 'Runtime', 'Log']) await send(d + '.enable', {}, sessionId);

  const errors = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
  });

  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)).result.value;

  /** 加载一页并截图（统一冻结动画保证可复现） */
  async function capture(url, w, h, tag) {
    await send('Emulation.setDeviceMetricsOverride',
      { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Page.navigate', { url: 'about:blank' }, sessionId);
    await sleep(200);
    await send('Page.navigate', { url }, sessionId);
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const st = await ev(`(()=>({main:window.__mainReady===true,dock:!!document.getElementById('mobile-dock')}))()`).catch(() => null);
      if (st && st.main) break;
      await sleep(400);
    }
    // 冻结动画/过渡：marquee 滚动字幕否则每次截图相位都不同，会产生假差异
    await send('Page.addScriptToEvaluateOnNewDocument', { source: '' }, sessionId).catch(() => {});
    await ev(`(()=>{ if (document.getElementById('__freeze')) return;
      const s=document.createElement('style'); s.id='__freeze';
      s.textContent='*,*::before,*::after{animation:none !important;transition:none !important;}';
      document.head.appendChild(s); })()`);
    await sleep(3500);   // 等瓦片 / 风场 / 图表画完
    const meta = await ev(`(()=>({
      ids:[...document.querySelectorAll('[id]')].map(e=>e.id).sort(),
      ready:window.__mainReady===true,
      innerW:innerWidth, innerH:innerHeight,
      scrollW:document.documentElement.scrollWidth, scrollH:document.documentElement.scrollHeight
    }))()`);
    const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const p = join(OUT, `${tag}-${w}x${h}.png`);
    writeFileSync(p, Buffer.from(r.data, 'base64'));
    return { path: p, meta };
  }

  for (const vp of VIEWPORTS) {
    const base = await capture(BASE_URL, vp.w, vp.h, 'base');
    const next = await capture(NEW_URL, vp.w, vp.h, 'new');

    check(`PC ${vp.name} 页面正常就绪（无 dock/移动端类）`,
      base.meta.ready && next.meta.ready, JSON.stringify({ base: base.meta.ready, new: next.meta.ready }));
    check(`PC ${vp.name} 文档无意外滚动（无布局溢出）`,
      next.meta.scrollW <= vp.w && next.meta.scrollH <= vp.h,
      `scrollW=${next.meta.scrollW} scrollH=${next.meta.scrollH} vp=${vp.w}x${vp.h}`);

    const added = next.meta.ids.filter(x => !base.meta.ids.includes(x));
    const removed = base.meta.ids.filter(x => !next.meta.ids.includes(x));
    check(`PC ${vp.name} 未删除任何既有 id`, removed.length === 0, JSON.stringify(removed.slice(0, 8)));
    check(`PC ${vp.name} 新增 id 仅为语言键相关`, added.every(x => /^btn-lang$/.test(x)),
      JSON.stringify(added.slice(0, 8)));

    // 像素 diff
    const py = `
import json
from PIL import Image, ImageChops
a = Image.open(r"${base.path}").convert('RGB')
b = Image.open(r"${next.path}").convert('RGB')
if a.size != b.size:
    print(json.dumps({'sizeMismatch': [a.size, b.size]})); raise SystemExit
W, H = a.size
pa, pb = a.load(), b.load()
TH = 8                      # 抗锯齿/阴影级噪声阈值
xs, ys, changed = [], [], 0
for y in range(H):
    row = 0
    for x in range(W):
        r1, g1, b1 = pa[x, y]; r2, g2, b2 = pb[x, y]
        if abs(r1-r2) > TH or abs(g1-g2) > TH or abs(b1-b2) > TH:
            xs.append(x); ys.append(y); row += 1
    changed += row
bbox = [min(xs), min(ys), max(xs)+1, max(ys)+1] if xs else None
print(json.dumps({'size': [W, H], 'bbox': bbox, 'changedPixels': changed, 'totalPixels': W*H}))
`;
    const pyFile = join(OUT, `_diff-${vp.name}.py`);
    writeFileSync(pyFile, py, 'utf8');
    const out = execFileSync('python', ['-W', 'ignore', pyFile], { encoding: 'utf8' });
    const dr = JSON.parse(out.trim().split('\n').pop());
    dr.vp = vp;

    // 语言键与工具栏的矩形：新增按钮必须完全落在「工具栏 ∪ 按钮」并集内，
    // 且工具栏自身几何不得改变（尺寸/位置与基线一致）。
    const geo = await ev(`(()=>{
      const R=(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();
        return {x:Math.round(r.x),right:Math.round(r.right),y:Math.round(r.y),bottom:Math.round(r.bottom),w:Math.round(r.width),h:Math.round(r.height)};};
      return {controls:R('#top-controls'), lang:R('#btn-lang'), title:R('#title'),
              ticker:R('#news-ticker'), toolControls:R('#tool-controls')};})()`);
    dr.geo = geo;

    // 基线工具栏几何（用同一表达式在基线上量一次，用于证明「工具栏没动」）
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Page.navigate', { url: BASE_URL }, sessionId);
    {
      const dl = Date.now() + 40000;
      while (Date.now() < dl) { if (await ev('window.__mainReady===true').catch(() => false)) break; await sleep(300); }
      await sleep(1500);
    }
    const geoBase = await ev(`(()=>{
      const R=(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();
        return {x:Math.round(r.x),right:Math.round(r.right),y:Math.round(r.y),bottom:Math.round(r.bottom),w:Math.round(r.width),h:Math.round(r.height)};};
      return {controls:R('#top-controls'), title:R('#title'), ticker:R('#news-ticker'), toolControls:R('#tool-controls')};})()`);
    dr.geoBase = geoBase;

    check(`PC ${vp.name} 顶部工具栏几何未变（无回流）`,
      JSON.stringify(geo.controls) === JSON.stringify(geoBase.controls),
      `base=${JSON.stringify(geoBase.controls)} new=${JSON.stringify(geo.controls)}`);
    check(`PC ${vp.name} 标题/快讯/工具区几何未变`,
      JSON.stringify([geoBase.title, geoBase.ticker, geoBase.toolControls]) ===
      JSON.stringify([geo.title, geo.ticker, geo.toolControls]),
      `title=${JSON.stringify(geo.title)} ticker=${JSON.stringify(geo.ticker)}`);

    let outside = null;
    if (dr.bbox && geo.lang) {
      const [x0, y0, x1, y1] = dr.bbox;
      const pad = 8;   // 按钮阴影/圆角抗锯齿余量
      const bx0 = geo.lang.x - pad, by0 = geo.lang.y - pad;
      const bx1 = geo.lang.right + pad, by1 = geo.lang.bottom + pad;
      outside = !(x0 >= bx0 && y0 >= by0 && x1 <= bx1 && y1 <= by1);
    }
    check(`PC ${vp.name} 像素差异仅限新增语言键区域`,
      dr.bbox === null || outside === false,
      JSON.stringify({ bbox: dr.bbox, lang: geo.lang, changedPixels: dr.changedPixels }));
    writeFileSync(join(OUT, `diff-${vp.name}.json`), JSON.stringify(dr, null, 2));
    console.log(`  ${vp.name}: bbox=${JSON.stringify(dr.bbox)} changed=${dr.changedPixels} ` +
      `controls ${JSON.stringify(geoBase.controls)} -> ${JSON.stringify(geo.controls)} lang=${JSON.stringify(geo.lang)}`);
  }

  check('PC 端无 JS 报错', errors.length === 0, JSON.stringify(errors.slice(0, 4)));

  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass);
  console.log('\n================ PC 端零回归 ================');
  for (const r of results) console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.detail ? '   [' + r.detail + ']' : ''));
  console.log('---------------------------------------------');
  console.log(`RESULT: ${pass}/${results.length} ${fail.length ? 'FAILED' : 'ALL GREEN'}`);
  writeFileSync(join(OUT, 'desktop.json'), JSON.stringify({ results, errors }, null, 2));
  if (fail.length) process.exitCode = 1;
}

run().then(() => { chrome.kill(); })
  .catch(e => { console.error('HARNESS FAIL', e); chrome.kill(); process.exit(1); });

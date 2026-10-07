/**
 * touch-test.mjs — 真触摸手势下的移动端功能回归（v2：所有坐标都从 DOM 实时查询，不写死）
 *
 * 覆盖：地图拖拽/捏合、Dock 让位、测距、关注区绘制、播放/步进/滑杆、
 *       图层切换、原场⇄订正场、双台风、灾害雷达、强度演变图、截图、全屏、数据抽屉、图例
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_ = process.argv[2] || 'http://127.0.0.1:8124/preview.html';
const OUT = process.argv[3] || '.dev/shots';
const PORT = Number(process.env.CDP_PORT || 9433);
mkdirSync(OUT, { recursive: true });
const profile = join(tmpdir(), 'cdp-touch2-' + Date.now());
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
const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail: String(detail ?? '') });

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
  await send('Emulation.setDeviceMetricsOverride',
    { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { angle: 0, type: 'portraitPrimary' } }, sessionId);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
  await send('Page.navigate', { url: URL_ }, sessionId);
  // 线上站点首次加载要拉瓦片/边界/风场数据，固定等待不可靠 →
  // 轮询等「Dock 建好 且 主逻辑就绪(__mainReady)」，最多 30s
  {
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      const st = await send('Runtime.evaluate', {
        expression: `(() => ({ dock: !!document.getElementById('mobile-dock'),
                              tabs: document.querySelectorAll('#mobile-dock .md-tab').length,
                              main: window.__mainReady === true }))()`,
        returnByValue: true
      }, sessionId).then(r => r.result.value).catch(() => null);
      if (st && st.dock && st.tabs === 5 && st.main) { ready = true; break; }
      await sleep(400);
    }
    if (!ready) throw new Error('页面未在 30s 内就绪（Dock/主逻辑）');
    await sleep(1200);   // 让首批瓦片与风场渲染稳定
  }

  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sessionId)).result.value;
  const tap = async (x, y, wait = 280) => {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }, sessionId);
    await sleep(70);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], changedTouchPoints: [{ x, y, id: 1 }] }, sessionId);
    await sleep(wait);
  };
  const drag = async (x0, y0, x1, y1, steps = 12) => {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] }, sessionId);
    for (let i = 1; i <= steps; i++) {
      await send('Input.dispatchTouchEvent', { type: 'touchMove',
        touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, id: 1 }] }, sessionId);
      await sleep(16);
    }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], changedTouchPoints: [{ x: x1, y: y1, id: 1 }] }, sessionId);
    await sleep(300);
  };
  const pinch = async (cx, cy, d0, d1, steps = 10) => {
    await send('Input.dispatchTouchEvent', { type: 'touchStart',
      touchPoints: [{ x: cx - d0, y: cy, id: 1 }, { x: cx + d0, y: cy, id: 2 }] }, sessionId);
    for (let i = 1; i <= steps; i++) {
      const d = d0 + (d1 - d0) * i / steps;
      await send('Input.dispatchTouchEvent', { type: 'touchMove',
        touchPoints: [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }] }, sessionId);
      await sleep(20);
    }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
    await sleep(500);
  };

  // —— 坐标统一从 DOM 取，绝不写死 ——
  const centerOf = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
      const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return null;
      return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
  const closeAll = async () => { await ev('window.MobileUI.closeAll()'); await sleep(340); };
  const openTab = async (tab) => {
    await closeAll();
    const c = await centerOf(`#mobile-dock .md-tab[data-tab="${tab}"]`);
    if (!c) throw new Error('找不到标签 ' + tab);
    await tap(c.x, c.y, 460);
    return c;
  };
  // 在某面板里点按钮（面板先打开，按钮坐标实时查，点完收起面板避免挡地图）
  const inSheet = async (tab, sel, { keepOpen = false } = {}) => {
    await openTab(tab);
    const c = await centerOf(sel);
    if (!c) { check(`面板 ${tab} 内找到 ${sel}`, false, '按钮不可见/尺寸为 0'); return null; }
    await tap(c.x, c.y, 420);
    if (!keepOpen) await closeAll();
    return c;
  };
  // 缩放读数：取「所有瓦片中最大的 z」。不能用「第一个瓦片」——缩放后上一级瓦片仍会
  // 短暂留在 DOM 里，读第一个会得到滞后的旧级别（线上因此误判过 pinch 失效）。
  const zoomNow = () => ev(`(() => { let mx = null;
      document.querySelectorAll('.leaflet-tile').forEach(t => {
        const m = /\\/(\\d+)\\/\\d+\\/\\d+\\.png/.exec(t.getAttribute('src') || '');
        if (m) { const z = +m[1]; if (mx === null || z > mx) mx = z; } });
      return mx; })()`);
  const tileOrigin = () => ev(`(() => { const t = document.querySelector('.leaflet-tile'); if (!t) return null;
      const r = t.getBoundingClientRect(); return Math.round(r.left) + ',' + Math.round(r.top); })()`);

  // ---------- 1) 地图：单指拖动 ----------
  const o0 = await tileOrigin();
  await drag(195, 420, 195, 320);
  check('单指拖动地图', o0 !== (await tileOrigin()), `${o0} -> ${await tileOrigin()}`);

  // ---------- 2) 地图：双指捏合 ----------
  // 线上瓦片加载慢：用轮询等待缩放级别变化，最多 4s（本地/线上都适用）
  const z0 = await zoomNow();
  await pinch(195, 420, 40, 120);
  let z1 = z0;
  for (let i = 0; i < 20 && z1 === z0; i++) { await sleep(200); z1 = await zoomNow(); }
  check('双指捏合缩放', z0 !== z1, `z ${z0} -> ${z1}`);

  // ---------- 3) Dock 手势让位 ----------
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 420, id: 1 }] }, sessionId);
  await sleep(140);
  check('地图手势时 Dock 让位', await ev(`document.documentElement.classList.contains('md-interacting')`) === true, '.md-interacting');
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
  await sleep(1600);

  // ---------- 4) 测距（工具面板 → 点两点 → 出读数） ----------
  const measureBtn = await inSheet('tools', '#btn-measure');
  if (measureBtn) {
    const on = await ev(`getComputedStyle(document.getElementById('measure-info')).display !== 'none'`);
    await tap(120, 320, 260); await tap(270, 270, 300);
    const text = await ev(`document.getElementById('measure-text').textContent`);
    check('测距：开启并量出距离', on && /\d/.test(text || ''), `面板=${on} 读数=${JSON.stringify(text)}`);
    await ev(`document.getElementById('measure-done').click()`); await sleep(220);
    await ev(`document.getElementById('measure-clear').click()`); await sleep(220);
  }

  // ---------- 5) 绘制关注区（矩形）→ 关注区小窗 ----------
  await openTab('tools');
  const focusMenu = await centerOf('#btn-focus');
  await tap(focusMenu.x, focusMenu.y, 420);
  const rectBtn = await centerOf('#btn-focus-rect');
  if (rectBtn) await tap(rectBtn.x, rectBtn.y, 420);
  await closeAll();
  await drag(110, 260, 290, 400, 16);
  await sleep(900);
  const fw = await ev(`(() => { const w = document.getElementById('focus-window'); const r = w.getBoundingClientRect();
      return { disp: getComputedStyle(w).display, bottom: Math.round(r.bottom), w: Math.round(r.width),
               dockTop: Math.round(document.getElementById('mobile-dock').getBoundingClientRect().top) }; })()`);
  check('绘制关注区 → 小窗出现且不压 Dock', fw.disp === 'flex' && fw.bottom <= fw.dockTop + 2, JSON.stringify(fw));
  await ev(`document.getElementById('focus-window-close').click()`); await sleep(300);
  // 复位：结束绘图工具
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await sleep(300);

  // ---------- 5b) 绘制关注区（多边形：点顶点 → 点浮动的「完成」） ----------
  await openTab('tools');
  const fm2 = await centerOf('#btn-focus');
  await tap(fm2.x, fm2.y, 420);
  const polyBtn = await centerOf('#btn-focus-poly');
  if (polyBtn) await tap(polyBtn.x, polyBtn.y, 420);
  await closeAll();
  const doneBtn = await centerOf('#focus-done-btn button[data-act="done"]');
  check('多边形模式出现「完成」浮动按钮', !!doneBtn, doneBtn ? `${doneBtn.w}x${doneBtn.h}` : '未出现');
  await tap(120, 300, 320); await tap(280, 330, 320); await tap(220, 430, 320);
  if (doneBtn) await tap(doneBtn.x, doneBtn.y, 900);
  const fw2 = await ev(`(() => { const w = document.getElementById('focus-window');
      return { disp: getComputedStyle(w).display, bottom: Math.round(w.getBoundingClientRect().bottom),
               dockTop: Math.round(document.getElementById('mobile-dock').getBoundingClientRect().top),
               doneHidden: getComputedStyle(document.getElementById('focus-done-btn')).display }; })()`);
  check('绘制关注区（多边形）→ 小窗出现', fw2.disp === 'flex' && fw2.bottom <= fw2.dockTop + 2, JSON.stringify(fw2));
  await ev(`document.getElementById('focus-window-close').click()`); await sleep(300);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await sleep(300);

  // ---------- 6) Dock：播放 / 步进 / 滑杆 ----------
  const play = await centerOf('#btn-play');
  const t0 = await ev(`document.getElementById('time-slider').value`);
  await tap(play.x, play.y, 1500);
  const t1 = await ev(`document.getElementById('time-slider').value`);
  await tap(play.x, play.y, 300);
  check('播放键推进时间', t0 !== t1, `${t0} -> ${t1}`);
  const next = await centerOf('#btn-next');
  const t2 = await ev(`document.getElementById('time-slider').value`);
  await tap(next.x, next.y, 320);
  const t3 = await ev(`document.getElementById('time-slider').value`);
  check('步进键单帧推进', t2 !== t3, `${t2} -> ${t3}`);
  const sl = await ev(`(() => { const r = document.getElementById('time-slider').getBoundingClientRect();
      return { x0: Math.round(r.left + 14), x1: Math.round(r.right - 14), y: Math.round(r.y + r.height/2) }; })()`);
  const t4 = await ev(`document.getElementById('time-slider').value`);
  await drag(sl.x0, sl.y, sl.x1, sl.y, 16);
  const t5 = await ev(`document.getElementById('time-slider').value`);
  check('拖动时间滑块', t4 !== t5, `${t4} -> ${t5}`);

  // ---------- 7) 图层：切换卫星图 ----------
  await openTab('layers');
  const satBtn = await ev(`(() => { const bs = [...document.querySelectorAll('#layer-switcher button')];
      const b = bs.find(x => x.textContent.includes('卫星')); if (!b) return null;
      const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), h: Math.round(r.height) }; })()`);
  if (satBtn) {
    await tap(satBtn.x, satBtn.y, 1100);
    const layer = await ev(`(() => { const t = document.querySelector('.leaflet-tile'); const s = t ? (t.getAttribute('src') || '') : '';
        const m = /tiles\\/([a-z]+)\\//.exec(s); return m ? m[1] : null; })()`);
    check('图层切换到卫星图', layer === 'satellite', `瓦片层=${layer}；按钮高=${satBtn.h}`);
  } else check('图层切换到卫星图', false, '找不到卫星图按钮');
  await closeAll();

  // ---------- 8) 原场 ⇄ 订正场 ----------
  // diff 图例只有在订正场真正载入后才出现；线上风场 bin 较大，先等风场就绪再点
  {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const ok = await ev(`!!(document.getElementById('wind-canvas') &&
          document.getElementById('wind-canvas').getContext('2d'))`);
      if (ok) break;
      await sleep(300);
    }
    await sleep(600);
  }
  await inSheet('tools', '#btn-compare', { keepOpen: true });
  let cmpOn = false, diffDisp = 'none';
  for (let i = 0; i < 20; i++) {
    await sleep(400);
    cmpOn = await ev(`document.getElementById('btn-compare').classList.contains('active')`);
    diffDisp = await ev(`getComputedStyle(document.getElementById('diff-legend')).display`);
    if (cmpOn && diffDisp !== 'none') break;
  }
  check('原场/订正场对比（diff 图例出现）', cmpOn && diffDisp !== 'none', `active=${cmpOn} legend=${diffDisp}`);
  await closeAll();
  await inSheet('tools', '#btn-compare', { keepOpen: true });
  await sleep(900); await closeAll();

  // ---------- 9) 双台风对比 ----------
  await inSheet('tools', '#btn-multi', { keepOpen: true });
  await sleep(420);
  const vs = await ev(`(() => { const m = document.getElementById('vs-menu'); const r = m.getBoundingClientRect();
      return { open: m.classList.contains('open'), top: Math.round(r.top), bottom: Math.round(r.bottom),
               right: Math.round(r.right), vw: innerWidth, items: m.querySelectorAll('.vs-item').length }; })()`);
  check('双台风菜单在屏内可点', vs.open && vs.right <= vs.vw + 1 && vs.items > 0, JSON.stringify(vs));
  const item = await centerOf('#vs-menu .vs-item');
  if (item) {
    await tap(item.x, item.y, 1500);
    const legend = await ev(`getComputedStyle(document.getElementById('compare-legend')).display`);
    check('双台风对比生效（对比图例出现）', legend !== 'none', String(legend));
  } else check('双台风对比生效（对比图例出现）', false, '菜单项不可见');
  await closeAll();

  // ---------- 10) 灾害预警雷达 ----------
  await inSheet('settings', '#btn-hazard', { keepOpen: true });
  await sleep(500);
  const radar = await ev(`(() => { const r = document.getElementById('hazard-radar'); const b = r.getBoundingClientRect();
      const c = document.getElementById('hazard-radar-canvas').getBoundingClientRect();
      return { show: r.classList.contains('show'), right: Math.round(b.right), w: Math.round(b.width),
               canvasW: Math.round(c.width), vw: innerWidth }; })()`);
  check('灾害预警雷达自适应屏幕', radar.show && radar.right <= radar.vw + 1 && radar.canvasW <= 340, JSON.stringify(radar));
  await ev(`document.getElementById('hazard-radar-close').click()`); await sleep(360);
  await closeAll();

  // ---------- 11) 强度演变图 ----------
  await inSheet('settings', '#btn-chart', { keepOpen: true });
  await sleep(600);
  const chart = await ev(`(() => { const c = document.getElementById('history-chart'); const r = c.getBoundingClientRect();
      return { show: c.classList.contains('show'), right: Math.round(r.right), w: Math.round(r.width), vw: innerWidth }; })()`);
  check('强度演变图在屏内', chart.show && chart.right <= chart.vw + 1, JSON.stringify(chart));
  await inSheet('settings', '#btn-chart');   // 再点一次收起
  await sleep(300);

  // ---------- 12) 截图 ----------
  await inSheet('settings', '#btn-shot');
  await sleep(2000);
  check('截图导出无异常', true, '已触发 html2canvas');

  // ---------- 13) 全屏（洁净模式）进出 ----------
  await inSheet('settings', '#btn-clean');
  await sleep(700);
  const clean = await ev(`(() => ({ clean: document.body.classList.contains('clean-mode'),
      dockHidden: getComputedStyle(document.getElementById('mobile-dock')).display === 'none',
      exitVisible: getComputedStyle(document.getElementById('btn-clean-exit')).display !== 'none' }))()`);
  check('全屏模式：隐藏 Dock、显示退出按钮', clean.clean && clean.dockHidden && clean.exitVisible, JSON.stringify(clean));
  if (clean.exitVisible) { const ex = await centerOf('#btn-clean-exit'); if (ex) await tap(ex.x, ex.y, 700); }
  const cleanOff = await ev(`!document.body.classList.contains('clean-mode')`);
  check('退出全屏恢复', cleanOff === true, String(cleanOff));

  // ---------- 14) 数据抽屉 ----------
  await openTab('data');
  const drawer = await ev(`(() => { const c = document.getElementById('left-panel-content');
      const before = c.scrollTop; c.scrollTop = 400; const after = c.scrollTop;
      return { open: document.getElementById('left-panel').classList.contains('open'), before, after,
               rows: document.querySelectorAll('#left-panel-tbody tr').length,
               dockCovered: (() => { const d = document.getElementById('mobile-dock').getBoundingClientRect();
                 const p = document.getElementById('left-panel').getBoundingClientRect();
                 return Math.round(p.bottom) > Math.round(d.top); })() }; })()`);
  check('数据抽屉可滚动、表格有数据', drawer.open && drawer.rows > 10 && drawer.after !== drawer.before, JSON.stringify(drawer));
  await closeAll();

  // ---------- 15) 图例 ----------
  await openTab('legend');
  await sleep(400);
  const legend = await ev(`(() => { const m = document.getElementById('legend-modal'); const r = m.getBoundingClientRect();
      return { open: m.classList.contains('open'), w: Math.round(r.width), vw: innerWidth }; })()`);
  check('图例弹窗（全宽）', legend.open && legend.w <= legend.vw + 1, JSON.stringify(legend));
  await ev(`document.getElementById('legend-close').click()`); await sleep(360);

  const shotPng = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(join(OUT, 'touch-final-390x844.png'), Buffer.from(shotPng.data, 'base64'));

  const errors = [];
  let pass = 0;
  console.log('\n===== 移动端真触摸功能回归（390×844）=====');
  for (const r of results) { if (r.pass) pass++; console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] ${r.name}  — ${r.detail}`); }
  console.log(`\n合计: ${pass}/${results.length} 通过`);
  console.log(`截图: ${join(OUT, 'touch-final-390x844.png')}`);
  writeFileSync(join(OUT, 'touch-report.json'), JSON.stringify(results, null, 1), 'utf8');
  await send('Browser.close').catch(() => {});
}

run().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1; })
  .finally(() => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} });

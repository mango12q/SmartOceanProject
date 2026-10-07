/**
 * page-check.mjs — 用本机 Chrome + CDP 做「真·移动视口」页面验收
 *
 * 零依赖：Node 22+ 内置 WebSocket；Chrome 用 --remote-debugging-port 暴露 CDP。
 * 相比 `chrome --headless --screenshot --window-size=390,844`，本脚本用
 * Emulation.setDeviceMetricsOverride 做真设备模拟（含 mobile:true / DPR / 触摸），
 * 并能在页面里注入探针（触控目标尺寸、元素重叠、console 报错）。
 *
 * 用法：
 *   node .dev/page-check.mjs --url http://127.0.0.1:8123/preview.html --out .dev/shots
 *   node .dev/page-check.mjs --url ... --devices 390x844,360x800,768x1024,1440x900
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}

const URL_ = arg('url', 'http://127.0.0.1:8123/preview.html');
const OUT = arg('out', '.dev/shots');
const DEVICES = arg('devices', '390x844,360x800,768x1024,1440x900')
  .split(',').map(s => s.trim()).filter(Boolean);
const WAIT = Number(arg('wait', '3500'));
const PORT = Number(arg('port', '9333'));
const KEEP = process.argv.includes('--keep-open');

mkdirSync(OUT, { recursive: true });
const profile = join(tmpdir(), 'cdp-profile-' + Date.now());

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('Chrome CDP 未就绪');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = e => rej(new Error('ws error')); });
    const c = new CDP(ws);
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        c.events.push(msg);
      }
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
      }, 45000);
    });
  }
}

const PROBE = `(() => {
  const px = n => Math.round(n * 10) / 10;
  const rect = el => { const r = el.getBoundingClientRect(); return {x:px(r.x),y:px(r.y),w:px(r.width),h:px(r.height)}; };
  const vis = el => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.01; };
  const out = { viewport: {w: innerWidth, h: innerHeight, dpr: devicePixelRatio},
                mobileClass: document.documentElement.classList.contains('mobile-ui'),
                dock: null, tabs: [], smallTargets: [], overflow: [], invisible: {}, errors: [] };
  const dock = document.getElementById('mobile-dock');
  if (dock) {
    out.dock = rect(dock);
    out.dockCssVar = getComputedStyle(document.documentElement).getPropertyValue('--dock-h').trim();
    for (const t of dock.querySelectorAll('.md-tab')) {
      out.tabs.push({tab: t.dataset.tab, ...rect(t)});
    }
  }
  // 触控目标检查：可见且可点的控件
  const sel = '#mobile-dock button, #mobile-dock .md-tab, #tool-controls button, .md-sheet button, ' +
              '#time-panel button, #playback-controls button, #left-panel button, .cal-cell, .vs-item, .compare-item';
  for (const el of document.querySelectorAll(sel)) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < 44 || r.width < 44) {
      out.smallTargets.push({id: el.id || el.className, label: (el.textContent||'').trim().slice(0,10),
                             w: px(r.width), h: px(r.height)});
    }
  }
  // 横向溢出
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > innerWidth + 1.5 || r.left < -1.5)) {
      out.overflow.push({id: el.id || el.className.toString().slice(0,24), left: px(r.left), right: px(r.right)});
    }
    if (out.overflow.length > 14) break;
  }
  // 关键节点可见性
  for (const id of ['title','top-controls','layer-switcher','tool-controls','time-panel','left-panel',
                    'legend','news-ticker','eye-coord','measure-info','btn-qr','nws']) {
    const el = document.getElementById(id);
    if (el) out.invisible[id] = !vis(el);
  }
  // 地图是否被完全遮挡
  const map = document.getElementById('map');
  if (map) {
    const r = map.getBoundingClientRect();
    const pts = [[r.width/2, r.height/2], [r.width/2, r.height*0.3]];
    out.mapCoveredBy = pts.map(([x,y]) => {
      const el = document.elementFromPoint(x, y);
      return el ? (el.id || el.className.toString().slice(0,24)) : null;
    });
  }
  return out;
})()`;

async function run() {
  const wsUrl = await getWsUrl();
  const cdp = await CDP.connect(wsUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);

  const report = { url: URL_, devices: [] };

  for (const d of DEVICES) {
    const [w, h] = d.split('x').map(Number);
    const mobile = w <= 768;
    cdp.events.length = 0;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 1, mobile,
      screenOrientation: { angle: 0, type: 'portraitPrimary' }
    }, sessionId);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 }, sessionId);
    await cdp.send('Page.navigate', { url: URL_ }, sessionId);
    await sleep(WAIT);

    const errors = cdp.events
      .filter(e => e.method === 'Runtime.exceptionThrown' ||
                   (e.method === 'Log.entryAdded' && ['error'].includes(e.params?.entry?.level)))
      .map(e => e.method === 'Runtime.exceptionThrown'
        ? (e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text || 'exception')
        : (e.params.entry.text + ' @' + (e.params.entry.url || '')))
      .filter(t => !/tiles\//.test(t));

    // 4xx/5xx 资源：确认新代码没有引用服务器上不存在的文件
    const badResources = cdp.events
      .filter(e => e.method === 'Network.responseReceived' && e.params?.response?.status >= 400)
      .map(e => e.params.response.status + ' ' + e.params.response.url)
      .slice(0, 8);

    const probe = await cdp.send('Runtime.evaluate', {
      expression: PROBE, returnByValue: true, awaitPromise: false
    }, sessionId);

    // 移动端的额外交互测试：打开每个 Sheet / 抽屉，检查可用性
    let interactions = null;
    if (mobile) {
      interactions = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const res = {};
          const tab = id => document.querySelector('#mobile-dock .md-tab[data-tab="'+id+'"]');
          const isOpen = id => { const s = document.getElementById('md-sheet-'+id); return !!(s && s.classList.contains('open')); };
          for (const id of ['layers','tools','settings']) {
            const t = tab(id); if (!t) { res[id] = 'no-tab'; continue; }
            t.click(); await sleep(180);
            const s = document.getElementById('md-sheet-'+id);
            res[id] = { open: isOpen(id), h: s ? Math.round(s.getBoundingClientRect().height) : 0,
                        bottom: s ? Math.round(s.getBoundingClientRect().bottom) : 0,
                        vh: innerHeight };
            t.click(); await sleep(120);
          }
          const t = tab('data'); if (t) { t.click(); await sleep(180);
            const lp = document.getElementById('left-panel');
            res.data = { open: lp.classList.contains('open'), h: Math.round(lp.getBoundingClientRect().height) }; t.click(); await sleep(120); }
          const t2 = tab('legend'); if (t2) { t2.click(); await sleep(180);
            const lm = document.getElementById('legend-modal');
            res.legend = { open: lm.classList.contains('open') }; t2.click(); await sleep(120); }
          // 测距按钮是否可达（在工具 Sheet 里）
          const meas = document.getElementById('btn-measure');
          res.measure = meas ? { visible: getComputedStyle(meas).display !== 'none',
                                 w: Math.round(meas.getBoundingClientRect().width),
                                 h: Math.round(meas.getBoundingClientRect().height) } : null;
          // 时间滑块 / 播放键在 Dock 内
          const sl = document.getElementById('time-slider');
          res.slider = sl ? { w: Math.round(sl.getBoundingClientRect().width),
                              h: Math.round(sl.getBoundingClientRect().height),
                              inDock: !!sl.closest('#mobile-dock') } : null;
          const pb = document.getElementById('btn-play');
          res.play = pb ? { inDock: !!pb.closest('#mobile-dock'), h: Math.round(pb.getBoundingClientRect().height) } : null;
          return res;
        })()`, awaitPromise: true
      }, sessionId);
    }

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const file = join(OUT, `page-${w}x${h}${mobile ? '-mobile' : '-desktop'}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));

    report.devices.push({
      device: d, screenshot: file, errors, badResources,
      probe: probe.result?.value,
      interactions: interactions?.result?.value ?? null
    });
  }

  await cdp.send('Browser.close').catch(() => {});
  console.log(JSON.stringify(report, null, 2));

  // 人读摘要
  console.log('\n===== SUMMARY =====');
  for (const d of report.devices) {
    const p = d.probe || {};
    console.log(`\n[${d.device}] mobile-ui=${p.mobileClass} dock=${p.dock ? p.dock.w + 'x' + p.dock.h : 'none'} ` +
                `(--dock-h=${p.dockCssVar || '-'}) errors=${d.errors.length}`);
    if (d.errors.length) d.errors.slice(0, 4).forEach(e => console.log('   ERR: ' + e.split('\n')[0].slice(0, 160)));
    if (d.badResources?.length) console.log('   BAD RES: ' + d.badResources.join(' | ').slice(0, 300));
    if (p.tabs?.length) console.log('   tabs: ' + p.tabs.map(t => `${t.tab}(${t.w}x${t.h})`).join(' '));
    if (p.invisible) {
      const inv = Object.entries(p.invisible).filter(([, v]) => v).map(([k]) => k);
      if (inv.length) console.log('   invisible: ' + inv.join(', '));
    }
    if (p.smallTargets?.length) {
      console.log('   small targets (<44px): ' + p.smallTargets.length);
      p.smallTargets.slice(0, 8).forEach(t => console.log(`      ${t.id} "${t.label}" ${t.w}x${t.h}`));
    }
    if (p.overflow?.length) {
      console.log('   overflow: ' + p.overflow.length);
      p.overflow.slice(0, 8).forEach(o => console.log(`      ${o.id} left=${o.left} right=${o.right}`));
    }
    console.log('   map topmost: ' + (p.mapCoveredBy || []).join(' | '));
    if (d.interactions) console.log('   interactions: ' + JSON.stringify(d.interactions));
    console.log('   screenshot: ' + d.screenshot);
  }
}

run().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1; })
  .finally(async () => {
    if (!KEEP) { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} }
  });

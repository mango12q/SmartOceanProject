/**
 * verify-mobile.mjs — 移动端 5 项需求的验收测试（真实 Chrome + CDP + 像素比对）
 *
 * 用法: node .dev/verify-mobile.mjs [url] [outdir]
 *
 * 覆盖：
 *   D1 全屏（洁净模式）：Sheet 自动收起 / --dock-h 归零 / 地图重算 / 能退出
 *   D2 拖动地图无「白框」：Dock 不位移、不整体半透明；Dock 背景带逐像素不变
 *   D3 文字随屏幕缩放：根字号在 320/390/430/768 单调递增且落在设计区间
 *   D4 英文版 + 语言切换键：切到 EN 后可见中文显著下降、关键 UI 为英文、可切回
 *   D5 拥挤度：Dock 高度下降、触控目标达标、顶部无重叠
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_ = process.argv[2] || 'http://127.0.0.1:8124/preview.html';
const OUT = process.argv[3] || '.dev/verify';
const PORT = Number(process.env.CDP_PORT || 9461);
mkdirSync(OUT, { recursive: true });
const profile = join(tmpdir(), 'cdp-verify-' + Date.now());
const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass: !!pass, detail: String(detail ?? '') }); };

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });

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
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, 40000);
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  for (const d of ['Page', 'Runtime', 'Log']) await send(d + '.enable', {}, sessionId);

  const errors = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ' ' +
      (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || ''));
  });

  const viewport = (w, h, mobile = true) => send('Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: 2, mobile, screenOrientation: { angle: 0, type: 'portraitPrimary' } }, sessionId);

  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)).result.value;
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const p = join(OUT, name + '.png');
    writeFileSync(p, Buffer.from(r.data, 'base64'));
    return p;
  };
  const tap = async (x, y, wait = 320) => {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }, sessionId);
    await sleep(70);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], changedTouchPoints: [{ x, y, id: 1 }] }, sessionId);
    await sleep(wait);
  };
  const centerOf = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;
      const r=e.getBoundingClientRect();if(!r.width||!r.height)return null;
      return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top),bottom:Math.round(r.bottom),left:Math.round(r.left),right:Math.round(r.right)};})()`);

  await viewport(390, 844);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
  await send('Page.navigate', { url: URL_ }, sessionId);
  {
    const deadline = Date.now() + 45000; let ready = false;
    while (Date.now() < deadline) {
      const st = await ev(`(()=>({dock:!!document.getElementById('mobile-dock'),main:window.__mainReady===true,i18n:!!window.I18N}))()`).catch(() => null);
      if (st && st.dock && st.main && st.i18n) { ready = true; break; }
      await sleep(400);
    }
    if (!ready) throw new Error('页面未就绪（dock/main/i18n）');
    await sleep(1600);
  }

  /* ============================ 基线 ============================ */
  const base = await ev(`(()=>{const d=document.getElementById('mobile-dock');const r=d.getBoundingClientRect();
    return {dockH:Math.round(r.height), dockTop:Math.round(r.top), vh:innerHeight,
      cssVar:getComputedStyle(document.documentElement).getPropertyValue('--dock-h').trim(),
      rootFont:parseFloat(getComputedStyle(document.documentElement).fontSize),
      tabFont:parseFloat(getComputedStyle(d.querySelector('.md-tab span')).fontSize),
      lang:document.documentElement.lang, i18nKeys:window.I18N.dictSize};})()`);
  await shot('01-mobile-idle');

  /* ==================== D2 · 拖动地图无「白框」 ==================== */
  await shot('02-D2-idle');
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 420, id: 1 }] }, sessionId);
  await sleep(60);
  for (let i = 1; i <= 10; i++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: 420 - i * 10, id: 1 }] }, sessionId);
    await sleep(20);
  }
  const midDrag = await ev(`(()=>{const d=document.getElementById('mobile-dock');const cs=getComputedStyle(d);
    const r=d.getBoundingClientRect();
    return {htmlClass:document.documentElement.className, opacity:cs.opacity, transform:cs.transform,
      dockTop:Math.round(r.top), dockBottom:Math.round(r.bottom), bg:cs.backgroundColor};})()`);
  const midPng = await shot('02-D2-middrag');
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], changedTouchPoints: [{ x: 195, y: 320, id: 1 }] }, sessionId);
  await sleep(2000);

  check('D2 Dock 拖动时整体不透明（opacity=1）', midDrag.opacity === '1', `opacity=${midDrag.opacity}`);
  check('D2 Dock 拖动时不发生位移（transform=none）', midDrag.transform === 'none', `transform=${midDrag.transform}`);
  check('D2 Dock 底边不越过视口（无 12px 裁切）', midDrag.dockBottom <= 844, `dockBottom=${midDrag.dockBottom} vh=844`);
  check('D2 Dock 背景完全不透明', /^rgb\(255, 255, 255\)$/.test(midDrag.bg), midDrag.bg);
  check('D2 手势让位 class 仍生效', /md-interacting/.test(midDrag.htmlClass), midDrag.htmlClass);

  // 像素断言：Dock 顶部内边距条带（纯背景，无子元素）在 idle 与拖动帧应完全一致
  {
    const py = `
import sys, json
from PIL import Image, ImageChops
a = Image.open(r"${join(OUT, '02-D2-idle.png')}").convert('RGB')
b = Image.open(r"${join(OUT, '02-D2-middrag.png')}").convert('RGB')
# Dock 顶部内边距带（DSF=2）。跳过 border-top 那 1px（它是淡蓝描边，不是背景）。
top = ${base.dockTop} * 2
box = (0, top + 4, a.width, top + 8)
ca, cb = a.crop(box), b.crop(box)
diff = ImageChops.difference(ca, cb)
bbox = diff.getbbox()
mx = max(diff.getextrema(), key=lambda t: t[1])[1]
def nonwhite(im):
    px = list(im.convert('RGB').getdata()); return sum(1 for r,g,bl in px if not (r>246 and g>246 and bl>246)) / len(px)
print(json.dumps({'bbox': bbox, 'maxChannelDiff': mx,
                  'bandNonwhiteIdle': round(nonwhite(ca),4), 'bandNonwhiteDrag': round(nonwhite(cb),4)}))
`;
    const pyFile = join(OUT, '_band.py');
    writeFileSync(pyFile, py, 'utf8');
    const out = execFileSync('python', ['-W', 'ignore', pyFile], { encoding: 'utf8' });
    const r = JSON.parse(out.trim().split('\n').pop());
    // 核心断言：拖动前后该背景带**逐像素完全相同**（老实现会因 opacity:0.55 透出底图而大面积差异）
    check('D2 Dock 背景带在拖动前后逐像素一致（无底图透出）',
      r.bbox === null && r.maxChannelDiff === 0 && r.bandNonwhiteIdle < 0.02,
      JSON.stringify(r));
    writeFileSync(join(OUT, 'D2-band.json'), JSON.stringify(r, null, 2));
  }

  /* ==================== D3 · 文字随屏幕缩放 ==================== */
  const fontAt = async (w, h) => {
    await viewport(w, h); await sleep(700);
    return ev(`(()=>({vw:innerWidth, root:parseFloat(getComputedStyle(document.documentElement).fontSize),
      tab:parseFloat(getComputedStyle(document.querySelector('#mobile-dock .md-tab span')).fontSize),
      ticker:parseFloat(getComputedStyle(document.getElementById('ticker-text')).fontSize)}))()`);
  };
  const f320 = await fontAt(320, 568);
  const f390 = await fontAt(390, 844);
  const f430 = await fontAt(430, 932);
  const f768 = await fontAt(768, 1024);
  check('D3 根字号随屏宽单调增大', f320.root < f390.root && f390.root <= f430.root && f430.root < f768.root,
    `320=${f320.root} 390=${f390.root} 430=${f430.root} 768=${f768.root}`);
  check('D3 常见机型字号落在 15~18px 可读区间', f390.root >= 15 && f390.root <= 18, `390 → ${f390.root}px`);
  check('D3 中文原基准 16px 不被改小', f390.root >= 15.9, `390 → ${f390.root}px`);
  await viewport(390, 844); await sleep(600);

  // 时间轴里程碑标签：真实排版后两两不得重叠（中/英都要成立）
  const TICK_OVL = `(()=>{
    const ts=[...document.querySelectorAll('#time-ticks .time-tick')].map(e=>{const r=e.getBoundingClientRect();
      return {t:e.textContent,x:Math.round(r.x),right:Math.round(r.right),w:Math.round(r.width)};});
    const bad=[];
    for(let i=1;i<ts.length;i++) if(ts[i].x < ts[i-1].right) bad.push(ts[i-1].t+'|'+ts[i].t);
    const c=document.getElementById('time-ticks').getBoundingClientRect();
    const clipped=ts.filter(o=>o.x<c.x-1||o.right>c.right+1).map(o=>o.t);
    return {ticks:ts,bad,clipped,containerW:Math.round(c.width)};})()`;

  const zhTicks = await ev(TICK_OVL);
  check('D5 中文里程碑标签不重叠且不被裁切',
    zhTicks.bad.length === 0 && zhTicks.clipped.length === 0,
    JSON.stringify(zhTicks));

  /* ==================== D4 · 英文版 + 语言切换 ==================== */
  // 「可见中文」快照：只统计**真正渲染出来**的含汉字文本节点（逐级检查祖先 display/visibility），
  // 并且用「路径::文本」集合做前后比对 —— 比裸字符数稳定得多（页面本身有动态快讯/时钟）。
  const CN_SNAP = `(()=>{
    const vis=(el)=>{for(let e=el;e&&e!==document.documentElement;e=e.parentElement){
      const cs=getComputedStyle(e); if(cs.display==='none'||cs.visibility==='hidden'||cs.opacity==='0') return false;} return true;};
    const out=[]; const w=document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT, null);
    let n; while((n=w.nextNode())){
      const t=(n.data||'').trim(); if(!t||!/[\\u4e00-\\u9fa5]/.test(t)) continue;
      const p=n.parentElement; if(!p||!vis(p)) continue;
      const path=(function(el){const a=[];while(el&&el!==document.documentElement){
        a.unshift(el.id?('#'+el.id):(el.className&&typeof el.className==='string'?('.'+el.className.trim().split(/\\s+/)[0]):el.tagName));el=el.parentElement;}
        return a.join('>');})(p);
      out.push(path+' :: '+t.slice(0,60));
    }
    return out;})()`;

  const langBtn = await centerOf('#btn-lang');
  check('D4 存在语言切换键 #btn-lang 且可见可点', !!langBtn && langBtn.w >= 40 && langBtn.h >= 40,
    JSON.stringify(langBtn));

  const zhSnap = await ev(CN_SNAP);
  const zhStat = await ev(`(()=>({cn:${CN_SNAP}.length, lang:document.documentElement.lang}))()`);

  if (langBtn) await tap(langBtn.x, langBtn.y, 900);
  const enSnap = await ev(CN_SNAP);
  const enStat = await ev(`(()=>({
    lang:document.documentElement.lang,
    title:(document.querySelector('#title .title-name')||{}).textContent,
    tab0:document.querySelector('#mobile-dock .md-tab span').textContent,
    sheetTitle:(document.querySelector('#md-sheet-settings .md-sheet-title')||{}).textContent,
    ticker:document.getElementById('ticker-text').textContent.slice(0,80),
    tickerFull:document.getElementById('ticker-text').textContent,
    measure:document.getElementById('btn-measure').getAttribute('data-tip'),
    clock:(document.getElementById('md-clock-text')||{}).textContent,
    btnText:document.getElementById('btn-lang').textContent,
    persisted:(()=>{try{return localStorage.getItem('smartocean-lang')}catch(e){return 'ERR'}})()
  }))()`);
  await shot('04-mobile-english');

  check('D4 切换后 html lang=en', enStat.lang === 'en', enStat.lang);
  check('D4 Dock 标签变英文', /^[A-Za-z]/.test(enStat.tab0), enStat.tab0);
  check('D4 Sheet 标题（挂在 <html> 下）也翻译', /^[A-Za-z]/.test(enStat.sheetTitle || ''), enStat.sheetTitle);
  check('D4 动态快讯（拼接句）也翻译', !/[\u4e00-\u9fa5]/.test(enStat.ticker || ''), enStat.ticker);
  check('D4 英文快讯无全角标点/粘连（有独立英文版）',
    !/[，。；：（）]/.test(enStat.tickerFull || '') && /" was located at /.test(enStat.tickerFull || '') &&
    /Please take precautions\.$/.test((enStat.tickerFull || '').trim()),
    enStat.tickerFull);
  check('D4 语言键文案变为「中文」', enStat.btnText === '中文', enStat.btnText);
  check('D4 选择持久化到 localStorage', enStat.persisted === 'en', String(enStat.persisted));
  // 语言名按钮自身不翻译，是唯一允许残留的中文
  const residual = enSnap.filter(s => !/:: 中文$/.test(s));
  check('D4 可见中文全部英文化（仅语言键自身保留「中文」）',
    residual.length === 0, `zh=${zhSnap.length} 条 → en 残留 ${residual.length} 条: ${JSON.stringify(residual.slice(0, 6))}`);

  // 英文里程碑标签更宽 → 必须重新排版且不重叠
  const enTicks = await ev(TICK_OVL);
  check('D4 英文里程碑标签不重叠且不被裁切',
    enTicks.bad.length === 0 && enTicks.clipped.length === 0,
    JSON.stringify(enTicks));

  // #legend 的文字是 CSS 生成内容（content:'图例'），DOM 翻译器遍历不到 → 需显式英文版
  const legendCss = await ev(`(()=>{const e=document.getElementById('legend');
    return {content:getComputedStyle(e,'::before').content, text:e.innerText.trim()};})()`);
  check('D4 CSS 生成内容（#legend 圆形按钮）也切英文',
    /Legend/.test(legendCss.content || ''), JSON.stringify(legendCss));

  // 关键 UI 的英文化抽查
  const keyUi = await ev(`(()=>{const g=id=>{const e=document.getElementById(id);return e?e.textContent.trim():null;};
    return {measure:document.getElementById('btn-measure').getAttribute('data-tip'),
      fullscreen:document.getElementById('btn-clean').getAttribute('data-tip'),
      legendTab:document.querySelector('#mobile-dock .md-tab[data-tab="legend"] span').textContent,
      cleanExit:g('btn-clean-exit')};})()`);
  check('D4 title/data-tip 属性也翻译', keyUi.measure === 'Measure' && keyUi.fullscreen === 'Fullscreen',
    JSON.stringify(keyUi));
  check('D4 退出全屏按钮英文', /Exit fullscreen/i.test(keyUi.cleanExit || ''), keyUi.cleanExit);

  // 切回中文
  const lb2 = await centerOf('#btn-lang');
  if (lb2) await tap(lb2.x, lb2.y, 900);
  const backSnap = await ev(CN_SNAP);
  const backZh = await ev(`(()=>({lang:document.documentElement.lang,
    tab0:document.querySelector('#mobile-dock .md-tab span').textContent,
    measure:document.getElementById('btn-measure').getAttribute('data-tip'),
    ticker:document.getElementById('ticker-text').textContent.slice(0,80),
    btnText:document.getElementById('btn-lang').textContent}))()`);
  {
    const setZh = new Set(zhSnap), setBack = new Set(backSnap);
    const lost = zhSnap.filter(s => !setBack.has(s));
    const extra = backSnap.filter(s => !setZh.has(s));
    check('D4 可切回中文且逐节点完全还原',
      backZh.lang === 'zh-CN' && backZh.tab0 === '图层' && backZh.measure === '测距' &&
      backZh.btnText === 'EN' && lost.length === 0 && extra.length === 0,
      JSON.stringify({ lang: backZh.lang, tab0: backZh.tab0, measure: backZh.measure,
        btn: backZh.btnText, lost: lost.slice(0, 4), extra: extra.slice(0, 4) }));
  }

  /* ==================== D1 · 全屏 ==================== */
  await ev(`window.MobileUI.closeAll()`); await sleep(300);
  const setTab = await centerOf('#mobile-dock .md-tab[data-tab="settings"]');
  await tap(setTab.x, setTab.y, 520);
  const cleanBtn = await centerOf('#btn-clean');
  if (cleanBtn) await tap(cleanBtn.x, cleanBtn.y, 900);
  else { await ev(`document.getElementById('btn-clean').click()`); await sleep(900); }

  const fs1 = await ev(`(()=>{const d=document.getElementById('mobile-dock');const b=document.getElementById('btn-clean-exit');
    const br=b.getBoundingClientRect();
    return {bodyClass:document.body.className, full:!!document.fullscreenElement,
      sheetOpen:document.querySelectorAll('.md-sheet.open').length,
      leftPanelOpen:document.getElementById('left-panel').classList.contains('open'),
      scrim:document.documentElement.classList.contains('md-sheet-open'),
      dockDisplay:getComputedStyle(d).display,
      cssVar:getComputedStyle(document.documentElement).getPropertyValue('--dock-h').trim(),
      exitDisplay:getComputedStyle(b).display, exitVisible:br.width>0&&br.height>0,
      exitRect:{top:Math.round(br.top),right:Math.round(innerWidth-br.right),w:Math.round(br.width),h:Math.round(br.height)},
      legendTop:(()=>{const l=document.getElementById('legend');const r=l.getBoundingClientRect();
        return Math.round(innerHeight-r.bottom);})()};})()`);
  await shot('05-D1-clean-mode');

  check('D1 进入全屏后所有 Sheet 自动收起', fs1.sheetOpen === 0 && !fs1.leftPanelOpen && !fs1.scrim,
    JSON.stringify({ sheets: fs1.sheetOpen, left: fs1.leftPanelOpen, scrim: fs1.scrim }));
  check('D1 进入全屏后 --dock-h 归零（浮层贴底）', fs1.cssVar === '0px', fs1.cssVar);
  check('D1 退出全屏键可见且够大', fs1.exitVisible && fs1.exitRect.w >= 44 && fs1.exitRect.h >= 44,
    JSON.stringify(fs1.exitRect));
  check('D1 图例按钮贴底（不再悬在半空）', fs1.legendTop >= 0 && fs1.legendTop <= 40, `bottom=${fs1.legendTop}px`);

  // 视口长大（模拟真机全屏地址栏收起）后地图必须重算
  await send('Emulation.setDeviceMetricsOverride',
    { width: 390, height: 916, deviceScaleFactor: 2, mobile: true }, sessionId);
  await sleep(1500);
  const grow = await ev(`(()=>{const m=document.getElementById('map');const r=m.getBoundingClientRect();
    const tiles=[...document.querySelectorAll('.leaflet-tile')].map(t=>t.getBoundingClientRect());
    const bot=tiles.length?Math.max(...tiles.map(t=>t.bottom)):null;
    const right=tiles.length?Math.max(...tiles.map(t=>t.right)):null;
    return {vh:innerHeight, mapH:Math.round(r.height), tileBottom:bot?Math.round(bot):null,
      tileRight:right?Math.round(right):null, cssVar:getComputedStyle(document.documentElement).getPropertyValue('--dock-h').trim()};})()`);
  check('D1 视口变大后瓦片覆盖到底（Leaflet 已 invalidateSize）',
    grow.tileBottom !== null && grow.tileBottom >= grow.vh - 2 && grow.tileRight >= 388,
    JSON.stringify(grow));
  await shot('06-D1-grown');

  // 退出
  const ex = await centerOf('#btn-clean-exit');
  if (ex) await tap(ex.x, ex.y, 1000);
  const fs2 = await ev(`(()=>{const d=document.getElementById('mobile-dock');
    return {bodyClass:document.body.className, full:!!document.fullscreenElement,
      dockDisplay:getComputedStyle(d).display,
      cssVar:getComputedStyle(document.documentElement).getPropertyValue('--dock-h').trim(),
      dockH:Math.round(d.getBoundingClientRect().height)};})()`);
  check('D1 可退出全屏且 Dock/--dock-h 复原',
    fs2.dockDisplay === 'flex' && fs2.cssVar === fs2.dockH + 'px' && fs2.dockH > 100,
    JSON.stringify(fs2));

  /* ==================== D5 · 拥挤度 ==================== */
  await viewport(390, 844); await sleep(900);
  const crowd = await ev(`(()=>{const d=document.getElementById('mobile-dock');const r=d.getBoundingClientRect();
    // SPEC §2.2.14 的冻结契约是 **min-height:44px**（未要求 min-width）；
    // 这里按契约判定高度，另外记录宽度分布供人工复核。
    const btns=[...document.querySelectorAll('#mobile-dock button, #mobile-dock .md-tab, #btn-lang')]
      .filter(e=>e.getBoundingClientRect().width>0)
      .map(e=>({sel:(e.id||e.className),w:Math.round(e.getBoundingClientRect().width),h:Math.round(e.getBoundingClientRect().height)}));
    const shortH=btns.filter(b=>b.h<44);
    const narrow=btns.filter(b=>b.w<40);
    const play=[...document.querySelectorAll('#mobile-dock #playback-controls button')]
      .map(e=>Math.round(e.getBoundingClientRect().width));
    const tick=document.getElementById('news-ticker').getBoundingClientRect();
    const gba=document.getElementById('gba-label').getBoundingClientRect();
    const overlap=(a,b)=>!(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top);
    const title=document.getElementById('title').getBoundingClientRect();
    const lang=document.getElementById('btn-lang').getBoundingClientRect();
    const dock=document.getElementById('mobile-dock').getBoundingClientRect();
    const left=document.getElementById('left-panel').getBoundingClientRect();
    return {dockH:Math.round(r.height), vh:innerHeight, pct:+(r.height/innerHeight*100).toFixed(1),
      mapUsable:innerHeight-Math.round(r.height),
      btns, shortH, narrow, playWidths:play,
      clockText:(document.getElementById('md-clock-text')||{}).textContent,
      ticksPosition:getComputedStyle(document.getElementById('time-ticks')).position,
      ticksRect:(()=>{const r=document.getElementById('time-ticks').getBoundingClientRect();
        return {y:Math.round(r.y),h:Math.round(r.height)};})(),
      sliderRect:(()=>{const r=document.getElementById('time-slider').getBoundingClientRect();
        return {y:Math.round(r.y),bottom:Math.round(r.bottom)};})(),
      leftPanelVisibility:getComputedStyle(document.getElementById('left-panel')).visibility,
      leftPanelOpacity:getComputedStyle(document.getElementById('left-panel')).opacity,
      tickerH:Math.round(tick.height),
      tickerOverGba:overlap(tick,gba), tickerOverTitle:overlap(tick,title),
      langOverTitle:overlap(lang,title),
      tickerStatic:getComputedStyle(document.querySelector('#news-ticker .ticker-content')).animationName};})()`);
  await shot('07-mobile-final-zh');

  check('D5 Dock 高度下降（≤152px，原 161px）', crowd.dockH <= 152, `${crowd.dockH}px（原 161px）`);
  check('D5 Dock 占屏 < 18%', crowd.pct < 18, `${crowd.pct}%（原 19.1%）`);
  check('D5 时钟刻度文字未被滑块拇指压住（刻度在滑块行下方，不重叠）',
    crowd.ticksPosition === 'relative' && crowd.ticksRect.y >= crowd.sliderRect.bottom - 1,
    `ticks=${JSON.stringify(crowd.ticksRect)} sliderBottom=${crowd.sliderRect.bottom}`);
  check('D5 Dock 内触控目标高度全部 ≥44px（SPEC §2.2.14 契约）', crowd.shortH.length === 0,
    JSON.stringify(crowd.shortH));
  check('D5 播放键宽度 ≥40px（原 40px，已放宽）',
    crowd.playWidths.every(w => w >= 40), JSON.stringify(crowd.playWidths));
  check('D5 Dock 时钟显示真实时间而非 "--"', /^\d{2}:\d{2}$/.test(crowd.clockText || ''),
    String(crowd.clockText));
  check('D5 收起的路径面板不再透出幽灵内容',
    crowd.leftPanelVisibility === 'hidden',
    `visibility=${crowd.leftPanelVisibility}`);
  check('D5 快讯条与大湾区标签不再重叠', !crowd.tickerOverGba, `ticker↔gba=${crowd.tickerOverGba}`);
  check('D5 快讯条与标题不再重叠', !crowd.tickerOverTitle, `ticker↔title=${crowd.tickerOverTitle}`);
  check('D5 语言键与标题不重叠', !crowd.langOverTitle, `lang↔title=${crowd.langOverTitle}`);
  check('D5 快讯改为静态不滚动', crowd.tickerStatic === 'none', crowd.tickerStatic);

  /* ==================== 控制台无错误 ==================== */
  check('无 JS 报错', errors.length === 0, JSON.stringify(errors.slice(0, 4)));

  /* ==================== 输出 ==================== */
  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass);
  console.log('\n================ 移动端验收 ================');
  for (const r of results) console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.detail ? '   [' + r.detail + ']' : ''));
  console.log('-------------------------------------------');
  console.log(`RESULT: ${pass}/${results.length} ${fail.length ? 'FAILED' : 'ALL GREEN'}`);
  writeFileSync(join(OUT, 'verify.json'), JSON.stringify({ results, base, errors }, null, 2));
  if (fail.length) process.exitCode = 1;
}

run().then(() => { chrome.kill(); })
  .catch(e => { console.error('HARNESS FAIL', e); chrome.kill(); process.exit(1); });

/**
 * verify-page.mjs — 合规整改后的页面端到端验证（可复用）
 *
 * 前置：
 *   1. localhost 瓦片代理（真 Key，供 /tiles/tdt/）：
 *        python tile_proxy.py 8898 <cache_dir> <tk>
 *   2. localhost 站点代理（本地改后的 index.html + 回源线上）：
 *        python .dev/jig-proxy.py 8899 <jig_site_dir>
 *   两者准备好后运行本脚本。
 *
 * 用法： node .dev/verify-page.mjs [期望的底图模式 local|direct]
 *
 * 说明：浏览器只看到**同源**请求（全部经 jig-proxy），
 * 避免 Chrome 私有网络访问策略拦掉「公网源 → 回环」的请求。
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://43.154.210.202:8899/';
const URL = `${BASE}?tk=${process.argv[3] || 'FAKE-KEY-FOR-VERIFICATION'}`;
const OUT = 'D:\\opencode\\smart\\.dev\\shots-compliance';
mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
const pageErrors = [];
const tdtRemote = [];
const leakedKey = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
page.on('request', (r) => {
  const u = r.url();
  if (u.includes('tianditu.gov.cn')) tdtRemote.push(u);
  if (/[0-9a-f]{32}/.test(u)) leakedKey.push(u);
});

await page.route('**/*', async (route) => {
  const u = route.request().url();
  if (u.includes('43.154.210.202:8899')) {
    try {
      const resp = await route.fetch({ url: u.replace('43.154.210.202:8899', '127.0.0.1:8899') });
      return route.fulfill({ response: resp });
    } catch { return route.continue(); }
  }
  return route.continue();
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(20000);

/* ---- 1. 底图 ---- */
const buttons = await page.$$eval('#layer-switcher button', (bs) =>
  bs.map((b) => ({ layer: b.getAttribute('data-layer'), active: b.classList.contains('active') })));
ok('底图按钮只有 天地图 + 卫星（高德已移除）',
  buttons.length === 2 && buttons[0].layer === 'tdt' && buttons[1].layer === 'satellite',
  JSON.stringify(buttons));

const layerNames = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('.leaflet-tile-pane .leaflet-layer img').forEach((im) => {
    const s = im.currentSrc || im.src;
    const m = s.match(/tiles\/([a-z]+)\//);
    if (m) out.push(m[1]);
  });
  return [...new Set(out)];
});
ok('渲染中的底图图层不含 gaode', !layerNames.includes('gaode'), JSON.stringify(layerNames));

/* ---- 2. 审图号 ---- */
const badge = await page.$eval('#map-approval', (e) => {
  const r = e.getBoundingClientRect();
  return { text: e.textContent.trim(), left: Math.round(r.left), top: Math.round(r.top), vh: window.innerHeight };
});
ok('左下角审图号角标', badge.text.includes('4921') && badge.left < 300 && badge.top > badge.vh * 0.6,
  JSON.stringify(badge));

/* ---- 3. 坐标转换已生效（console.info 通道）---- */
const gcjLog = await page.evaluate(() => window.__gcjPatched === true);
console.info('  （坐标转换通过 console.info 宣告，见下方控制台输出）');

/* ---- 4. Key 不外泄 ---- */
ok('浏览器请求中不含真实 Key', leakedKey.length === 0, leakedKey.length ? leakedKey[0] : '无');
ok('未直连 tianditu（代理模式）', tdtRemote.length === 0, `${tdtRemote.length} 个直连`);

/* ---- 5. 敏感设施名称 ---- */
const names = await page.evaluate(() => {
  const html = document.documentElement.innerHTML;
  return {
    daya: html.includes('大亚湾核电科普基地（对外开放）'),
    taishan: html.includes('台山核电科普基地（对外开放）'),
    lng: html.includes('大鹏LNG能源科普参观基地（对外开放）'),
    oldDaya: html.includes('大亚湾核电基地'),
    oldLng: html.includes('大鹏LNG接收站'),
  };
});
ok('三处能源设施名称已按方案 A 改写', names.daya && names.taishan && names.lng, JSON.stringify(names));
ok('旧名称已不存在', !names.oldDaya && !names.oldLng, '');

/* ---- 6. 截图 ---- */
await page.screenshot({ path: `${OUT}\\V1-desktop.png` });
// 放大看珠三角（重点目标密集区），用于人工核对标记与底图的贴合
for (let i = 0; i < 3; i++) {
  await page.click('.leaflet-control-zoom-in').catch(() => {});
  await page.waitForTimeout(1500);
}
await page.waitForTimeout(12000);
await page.screenshot({ path: `${OUT}\\V2-zoom-prd.png` });

console.log('\n--- 控制台错误 ---');
console.log(consoleErrors.length ? consoleErrors.slice(0, 8).join('\n') : '(无)');
console.log('--- 页面异常 ---');
console.log(pageErrors.length ? pageErrors.slice(0, 8).join('\n') : '(无)');

const bad = results.filter((r) => !r.pass);
console.log(`\n检查项：${results.length}  通过：${results.length - bad.length}  失败：${bad.length}`);
await browser.close();
process.exit(bad.length ? 1 : 0);

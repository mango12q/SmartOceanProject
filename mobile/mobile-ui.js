/* ============================================================================
 * mobile-ui.js — 手机端交互层（经典脚本，唯一全局 window.MobileUI）
 * ----------------------------------------------------------------------------
 * 设计要点（与 mobile/SPEC.md §3 一致）：
 *  1) 只在「页面加载时」判定一次移动端（matchMedia ≤768px）。桌面端完全不动 DOM，
 *     连 #mobile-dock 都不创建 —— 这样桌面端 100% 零回归；旋转/改窗口不切换布局，
 *     避免把主逻辑已经绑定的节点搬来搬去造成状态错乱。
 *  2) 本脚本在主 module 之前加载，但等 window.__mainReady（主逻辑 init 完成）之后
 *     才执行「搬节点」操作，保证主逻辑初始化时看到的是原始 DOM。
 *  3) 搬移节点用 appendChild 原节点而非克隆：DOM 移动不会丢失事件监听，
 *     且主逻辑里 `document.getElementById('btn-lock')` 仍然取得到同一个节点。
 *  4) 不读写主逻辑闭包变量；需要触发功能时直接调用原节点的 .click()。
 *  5) 幂等：window.__mobileUiReady 守卫，重复执行直接返回。
 * ==========================================================================*/
(function () {
    'use strict';
    if (window.__mobileUiReady) return;
    window.__mobileUiReady = true;

    var MQ = window.matchMedia ? window.matchMedia('(max-width: 768px)') : null;
    var IS_MOBILE = !!(MQ && MQ.matches);
    if (!IS_MOBILE) return;                       // 桌面端：什么都不做

    var doc = document;
    var html = doc.documentElement;
    var $ = function (id) { return doc.getElementById(id); };

    /* ---------------------------------------------------------------- 图标 */
    function svg(paths, extra) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
            'stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" ' +
            'aria-hidden="true"' + (extra || '') + '>' + paths + '</svg>';
    }
    var ICONS = {
        layers: svg('<path d="M12 3 3 7.5 12 12l9-4.5L12 3Z"/><path d="m3 12.5 9 4.5 9-4.5"/><path d="m3 17 9 4.5 9-4.5"/>'),
        tools: svg('<path d="M14.5 5.5a4 4 0 0 0 5 5L21 9l-1.5-1.5L21 6l-3-3-1.5 1.5L15 3l-1.5 1.5a4 4 0 0 0 1 1Z"/><path d="m13 8-8.5 8.5a2.1 2.1 0 0 0 3 3L16 11"/>'),
        settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.5-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.5l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4Z"/>'),
        data: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>'),
        legend: svg('<path d="M4 6h10M4 12h7M4 18h5"/><path d="M17 5.5 19 4l2 3.5-2 3-2-3Z"/><circle cx="18" cy="17" r="3"/>'),
        close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'
    };
    var TABS = [
        { id: 'layers',   label: '图层' },
        { id: 'tools',    label: '工具' },
        { id: 'settings', label: '设置' },
        { id: 'data',     label: '数据' },
        { id: 'legend',   label: '图例' }
    ];

    var ready = false;

    /* ------------------------------------------------------------ 样式 */
    /*
     * 组合层（在所有样式表之后的最后一层微调）。以下两条都是「用真实浏览器量出来」的缺口：
     *
     * 1) #btn-qr / #qr-modal：手机端不需要「扫码进入」（本机就是手机）。
     *    这条属于「行为开关」而非布局，放在 JS 层可避免与样式表修订互相踩踏；
     *    qr-popup.js 在 ≤768px 也直接不初始化。
     *
     * 2) #wind-toggle：设置面板里没有任何规则给它 min-width，实测仅 50×44（按钮被压窄、
     *    文案换行）。补成与其它 Sheet 按钮一致的触控规格。
     *
     * 3) Dock 行1 排版：实测 6 个播放键被挤到 30.5×44（宽度低于 44 的触控建议值）。
     *    根因是 #eye-coord（台风眼经纬度）在手机窄屏只能显示成 "17…" 这种截断文本，
     *    却占了约 60px。该数值在快讯条与「数据」面板里都有，这里直接隐藏，
     *    把宽度还给播放键（40×44）与速度选择。
     *
     * ⚠ 不要在这里覆盖 #tool-controls 的 display：mobile.css §3.5 是按 **flex**
     *   布局写的（标签 flex:1 1 100%、按钮与包装 div flex:1 1 42%/max-width:50%）。
     *   改成 grid 会让这些 flex 声明失效，按钮被 min/max-width 夹到 ~91px 且分组错位
     *   —— 这是实测踩过的坑，勿重蹈。
     */
    function injectMobileOverrides() {
        var s = doc.createElement('style');
        s.id = 'mobile-ui-overrides';
        s.textContent =
            '@media (max-width: 768px){' +
            'html.mobile-ui #btn-qr{display:none !important;}' +
            'html.mobile-ui #qr-modal{display:none !important;}' +
            'html.mobile-ui .md-sheet-body #wind-toggle{min-width:96px;min-height:48px;font-size:0.9rem;}' +
            'html.mobile-ui #mobile-dock #eye-coord{display:none;}' +
            'html.mobile-ui #mobile-dock #playback-controls button{min-width:40px;}' +
            // 洁净（全屏）模式：Dock 必须让位，否则「全屏」名不副实。
            // ⚠ #mobile-dock 挂在 <html> 下（是 <body> 的**兄弟节点**，不是子节点），
            //   所以 `body.clean-mode #mobile-dock`（后代）永远不匹配 —— 实测踩到。
            //   必须用兄弟组合子 `~`。（`:is(...)` 写法同样不匹配，已实测排除。）
            'html.mobile-ui body.clean-mode ~ #mobile-dock{display:none !important;}' +
            /*
             * Sheet 必须盖住「状态条」类浮层（#compare-legend / #title / #gba-label）。
             * 实测踩坑：双台风对比开启后 #compare-legend（z-index 1450）正好压住
             * 设置面板顶部一格，点击「灾害预警/强度演变」时事件被 compare-select 吃掉，
             * 表现为「点了没反应」。Sheet 是模态（有蒙层 + 关闭按钮），抬高它即可。
             */
            'html.mobile-ui .md-sheet.open{z-index:2750;}' +
            'html.mobile-ui #left-panel.open{z-index:2750;}' +
            // 多边形绘制的「完成/取消」浮动按钮（仅移动端显示；桌面端靠双击完成）
            'html.mobile-ui #focus-done-btn{' +
            'position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top, 0px) + 56px);' +
            'z-index:2800;display:none;gap:8px;align-items:center;}' +
            'html.mobile-ui #focus-done-btn button{' +
            'min-height:44px;padding:0 16px;font-size:0.9rem;border-radius:22px;' +
            'border:1px solid rgba(21,101,192,0.28);background:rgba(255,255,255,0.97);color:#0d47a1;' +
            'font-weight:600;box-shadow:0 2px 10px rgba(13,71,161,0.22);}' +
            'html.mobile-ui #focus-done-btn button[data-act="done"]{background:#1976d2;color:#fff;border-color:#1976d2;}' +
            '}';
        doc.head.appendChild(s);
    }

    /* -------------------------------------------------------- 一次性构建 */
    function build() {
        if (ready) return;
        ready = true;
        html.classList.add('mobile-ui');
        html.style.setProperty('--dock-h', '150px');   // 首帧兜底，随后由 syncDockHeight 写入真实值

        injectMobileOverrides();
        buildDock();
        buildScrim();
        buildSheets();
        moveNodes();
        hookFocusWindow();
        bindTabs();
        bindMapInteracting();
        syncDockHeight();

        window.addEventListener('resize', syncDockHeight, { passive: true });
        window.addEventListener('orientationchange', function () { setTimeout(syncDockHeight, 260); });
        doc.addEventListener('keydown', onKeydown);
    }

    /* ------------------------------------------------------------- Dock */
    function buildDock() {
        var dock = doc.createElement('div');
        dock.id = 'mobile-dock';
        dock.innerHTML =
            '<div class="md-clock" id="md-clock"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="2" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
                '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>' +
                '<span id="md-clock-text">--</span></div>' +
            '<div class="md-time"></div>' +
            '<div class="md-slider"></div>' +
            '<div class="md-tabs"></div>';
        html.appendChild(dock);          // 挂在 <html> 下，避免任何祖先 overflow 裁剪

        var tabs = dock.querySelector('.md-tabs');
        TABS.forEach(function (t) {
            var b = doc.createElement('button');
            b.type = 'button';
            b.className = 'md-tab';
            b.setAttribute('data-tab', t.id);
            b.innerHTML = ICONS[t.id] + '<span>' + t.label + '</span>';
            tabs.appendChild(b);
        });
    }

    function buildScrim() {
        var s = doc.createElement('div');
        s.id = 'md-scrim';
        s.addEventListener('click', function () { closeAll(); });
        html.appendChild(s);
    }

    /* ----------------------------------------------------------- Sheets */
    function sheet(id, title, icon) {
        var sec = doc.createElement('section');
        sec.className = 'md-sheet';
        sec.id = 'md-sheet-' + id;
        sec.setAttribute('aria-label', title);
        sec.innerHTML =
            '<div class="md-grabber" aria-hidden="true"></div>' +
            '<div class="md-sheet-head"><span class="md-sheet-title">' + icon + title + '</span>' +
            '<button type="button" class="md-close" aria-label="关闭">' + ICONS.close + '</button></div>' +
            '<div class="md-sheet-body"></div>';
        sec.querySelector('.md-close').addEventListener('click', function () { closeAll(); });
        html.appendChild(sec);
        bindDragClose(sec);
        return sec;
    }

    function buildSheets() {
        var layers = sheet('layers', '图层', ICONS.layers);
        var tools = sheet('tools', '工具', ICONS.tools);
        var settings = sheet('settings', '设置', ICONS.settings);
        var data = sheet('data', '路径数据', ICONS.data);
        sheet('legend', '图例', ICONS.legend);

        // #layer-switcher 的点击是父级委托，必须整块搬（搬原节点，监听随之保留）
        var ls = $('layer-switcher');
        if (ls) layers.querySelector('.md-sheet-body').appendChild(ls);

        // #tool-controls 内含绘图测量/视图/对比导出/缩放全部分组
        var tc = $('tool-controls');
        if (tc) tools.querySelector('.md-sheet-body').appendChild(tc);

        // 设置面板：风场开关 + 透明度 + 截图 + 洁净模式 + 锁定/复位 + 图表 + 雷达
        var body = settings.querySelector('.md-sheet-body');
        var windRow = $('wind-row');
        if (windRow) body.appendChild(windRow);
        var group = doc.createElement('div');
        group.className = 'md-grid';
        body.appendChild(group);
        ['btn-shot', 'btn-clean', 'btn-lock', 'btn-fit', 'btn-chart', 'btn-hazard'].forEach(function (id) {
            var el = $(id);
            if (el) group.appendChild(el);
        });
        var diff = $('diff-legend');
        if (diff) body.appendChild(diff);
    }

    function moveNodes() {
        var dock = $('mobile-dock');
        var time = dock.querySelector('.md-time');
        var slider = dock.querySelector('.md-slider');

        var pb = $('playback-controls');
        if (pb) time.appendChild(pb);
        var sp = $('speed-select');
        if (sp) time.appendChild(sp);
        var eye = $('eye-coord');
        if (eye) time.appendChild(eye);
        var sl = $('time-slider');
        if (sl) slider.appendChild(sl);
        var tk = $('time-ticks');
        if (tk) slider.appendChild(tk);

        // 时间读数：Dock 自带时钟显示，隐藏被搬空的 #time-display（主逻辑仍会更新它）
        var td = $('time-display');
        if (td) td.classList.add('md-hidden');

        // 「数据」标签复用的原按钮：隐藏它，点击交给代理
        var pt = $('left-panel-toggle');
        if (pt) pt.classList.add('md-hidden');
        /*
         * 注意：#btn-clean-exit（退出全屏）**不要**搬进设置 Sheet。
         * 它是 clean-mode 下唯一的逃生出口，而 clean-mode 会让工具区/面板全部隐藏；
         * 一旦搬进 Sheet，用户进入全屏后就再也退不出来了（实测踩到）。
         * mobile.css 已有 `html.mobile-ui body > #btn-clean-exit` 规则把它固定在右上角，
         * 所以这里保持它是 <body> 直接子节点即可。
         */
    }

    /* -------------------------------------------------- 关注区小窗定位 */
    /*
     * 主逻辑 createFocusWindow() 每次打开都会写死 inline：
     *     left:65px; top:auto; right:auto; bottom:90px;  （宽度 320px 来自 CSS）
     * 手机屏上这会让小窗跑到旧位置、且与 Dock 打架。这里做「首次定位」接管：
     *   - 只在用户还没自己拖过（!__mdUserMoved）时清掉 inline 定位，交给 CSS 贴 Dock 上方；
     *   - 一旦用户拖过/缩放器用过，就让 inline 值完全生效（拖拽逻辑本来就是写 inline）；
     *   - 同时把用户拖拽/缩放标记写回节点，避免「打开→拖→关闭→再打开」被重置。
     * 全部用已有监听追加，不改主模块一行代码。
     */
    function hookFocusWindow() {
        var fw = $('focus-window');
        if (!fw) return;
        var header = $('focus-window-header');
        var grip = $('focus-window-resize');
        var mark = function () { fw.__mdUserMoved = true; };
        if (header) header.addEventListener('pointerdown', mark);
        if (grip) grip.addEventListener('pointerdown', mark);
        if (fw.__mdHooked) return;
        fw.__mdHooked = true;
        new MutationObserver(function () {
            if (fw.style.display === 'flex' && !fw.__mdUserMoved) {
                fw.style.left = '';
                fw.style.top = '';
                fw.style.right = '';
                fw.style.bottom = '';
            }
        }).observe(fw, { attributes: true, attributeFilter: ['style'] });
    }

    /* ------------------------------------------------------- 标签与开合 */
    function bindTabs() {
        var dock = $('mobile-dock');
        dock.addEventListener('click', function (e) {
            var tab = e.target.closest ? e.target.closest('.md-tab') : null;
            if (!tab) return;
            var id = tab.getAttribute('data-tab');
            if (id === 'data') { toggleDataDrawer(tab); return; }
            var sec = $('md-sheet-' + id);
            if (!sec) return;
            var isOpen = sec.classList.contains('open');
            closeAll();
            if (!isOpen) openSheet(id, tab);
        });
    }

    function openSheet(id, tab) {
        var sec = $('md-sheet-' + id);
        if (!sec) return;
        // 「图例」标签：直接复用既有图例弹窗（内含完整分类/路径/符号说明）
        if (id === 'legend') {
            var lm = $('legend-modal');
            if (lm) {
                lm.classList.add('open');
                bindLegendModalClose();
            }
            setActiveTab(tab);
            return;
        }
        sec.classList.add('open');
        html.classList.add('md-sheet-open');
        setActiveTab(tab);
    }

    function toggleDataDrawer(tab) {
        var lp = $('left-panel');
        var wasOpen = lp && lp.classList.contains('open');
        closeAll();
        if (lp && !wasOpen) {
            lp.classList.add('open');
            html.classList.add('md-sheet-open');
            setActiveTab(tab);
        }
    }

    function bindLegendModalClose() {
        var lm = $('legend-modal');
        if (!lm || lm.__mdBound) return;
        lm.__mdBound = true;
        lm.addEventListener('click', function (e) {
            if (e.target === lm || (e.target.closest && e.target.closest('#legend-close'))) closeAll();
        });
    }

    function setActiveTab(tab) {
        var all = doc.querySelectorAll('#mobile-dock .md-tab');
        for (var i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i] === tab);
    }

    function closeAll() {
        var open = doc.querySelectorAll('.md-sheet.open');
        for (var i = 0; i < open.length; i++) open[i].classList.remove('open');
        var lp = $('left-panel');
        if (lp) lp.classList.remove('open');
        var lm = $('legend-modal');
        if (lm) lm.classList.remove('open');
        html.classList.remove('md-sheet-open');
        setActiveTab(null);
    }

    function onKeydown(e) {
        if (e.key === 'Escape') closeAll();
    }

    /* --------------------------------------------- 下拉手势关闭 Sheet */
    function bindDragClose(sec) {
        var startY = null, dy = 0;
        sec.addEventListener('pointerdown', function (e) {
            var grabber = e.target.closest && e.target.closest('.md-grabber');
            var head = e.target.closest && e.target.closest('.md-sheet-head');
            if (!grabber && !head) return;
            startY = e.clientY;
            dy = 0;
            sec.classList.add('md-dragging');
            sec.setPointerCapture(e.pointerId);
        });
        sec.addEventListener('pointermove', function (e) {
            if (startY === null) return;
            dy = Math.max(0, e.clientY - startY);
            sec.style.transform = 'translateY(' + dy + 'px)';
        });
        function end() {
            if (startY === null) return;
            sec.classList.remove('md-dragging');
            sec.style.transform = '';
            if (dy > 72) closeAll();
            startY = null; dy = 0;
        }
        sec.addEventListener('pointerup', end);
        sec.addEventListener('pointercancel', end);
    }

    /* -------------------------------------------- 地图手势时让位给地图 */
    function bindMapInteracting() {
        var mapEl = $('map');
        if (!mapEl) return;
        var t = null;
        var wake = function () {
            html.classList.remove('md-interacting');
            if (t) { clearTimeout(t); t = null; }
        };
        mapEl.addEventListener('touchstart', function () {
            html.classList.add('md-interacting');
            if (t) clearTimeout(t);
            t = setTimeout(wake, 2200);
        }, { passive: true });
        mapEl.addEventListener('touchend', function () {
            if (t) clearTimeout(t);
            t = setTimeout(wake, 1400);
        }, { passive: true });
    }

    /* -------------------------------------------------------- Dock 高度 */
    var syncing = false;
    function syncDockHeight() {
        var dock = $('mobile-dock');
        if (!dock) return;
        var h = Math.round(dock.getBoundingClientRect().height);
        if (h > 0) html.style.setProperty('--dock-h', h + 'px');
        // 关注区小窗 / 迷你地图需要在 Dock 变化后让 Leaflet 重算尺寸。
        // 注意：dispatchEvent 是同步派发 —— 本函数自身就是 resize 监听器，
        // 没有这道重入保护会 sync→dispatch→sync 无限递归爆栈。
        if (syncing) return;
        syncing = true;
        window.dispatchEvent(new Event('resize'));
        syncing = false;
    }

    /* ------------------------------------------------------------ 启动 */
    function start() {
        if (window.__mainReady) { build(); return; }
        // 主逻辑 init 结束后会把 __mainReady 置 true；这里非阻塞地等一小段
        var tries = 0;
        var timer = setInterval(function () {
            tries++;
            if (window.__mainReady) { clearInterval(timer); build(); }
            else if (tries > 100) { clearInterval(timer); build(); }   // 3s 兜底：主逻辑挂了也要能用
        }, 30);
    }

    if (doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', function () { setTimeout(start, 0); });
    } else {
        setTimeout(start, 0);
    }

    window.MobileUI = {
        isMobile: true,
        closeAll: closeAll,
        syncDockHeight: syncDockHeight,
        build: build
    };
})();

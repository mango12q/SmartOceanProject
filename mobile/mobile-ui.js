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

    /* 兜底解锁：主逻辑若因异常始终没置 __mainReady，8 秒后也要放行 ——
       否则 <head> 里的首屏隐藏规则会让整页永远空白。 */
    setTimeout(function () { html.classList.add('mobile-ready'); }, 8000);

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
            // 圆形「图例」按钮：与底部 Dock 的「图例」标签打开同一个 #legend-modal，
            // 手机上是重复入口，隐藏；PC 端左下角的完整图例框不受影响。
            'html.mobile-ui #legend{display:none !important;}' +
            /* 右下角浮层按钮组（2026-09-26 用户要求）：「全屏 / 放大 / 缩小」从工具
               Sheet 的「视图」组摘出，与「收起」一起竖排在 Dock 上沿右侧。
               44px 是触控下限；容器随 --dock-h 自动让位；z-index 1520 高于
               Sheet(1490)，面板开着时也点得到。
               ⚠ 必须显式重置 position/left/bottom —— #btn-clear-overlays 在 PC 段
               有 `position:fixed; left:64px; bottom:38px`（无前缀，移动端同样命中），
               不重置就会脱离 flex 流飞到 PC 的位置上。 */
            'html.mobile-ui #md-fab-group{position:fixed;right:12px;' +
            'bottom:calc(var(--dock-h, 150px) + 30px);display:flex;flex-direction:column;' +
            'gap:8px;z-index:1520;align-items:center;}' +
            'html.mobile-ui #md-fab-group > button{position:static;left:auto;right:auto;' +
            'top:auto;bottom:auto;margin:0;z-index:auto;' +
            'width:44px;height:44px;padding:0;border-radius:50%;' +
            'border:1px solid rgba(21,101,192,0.28);' +
            'background:rgba(255,255,255,0.94);color:#0d47a1;font-size:1rem;font-weight:600;' +
            'display:grid;place-items:center;box-shadow:0 2px 8px rgba(13,71,161,0.18);' +
            '-webkit-tap-highlight-color:transparent;}' +
            'html.mobile-ui #md-fab-group > button:active{background:#e3f2fd;}' +
            'html.mobile-ui #md-fab-group > #btn-clear-overlays{font-size:0.7rem;}' +
            /* ④ 矮屏/横屏：竖排 4 键共 200px 会顶到屏幕顶部，盖住右上角 EN 键与快讯 ✕
               （FAB 的 z 1520 > #top-controls 的 1000）。改为横排一行（4×44+3×8=200px
               宽，320px 屏也放得下），bottom 抬到 +28px 避开底图来源。 */
            '@media (max-height:480px){' +
            'html.mobile-ui #md-fab-group{flex-direction:row;' +
            'bottom:calc(var(--dock-h, 150px) + 28px);}}' +
            /* ⑦ 全屏（clean-mode）下 Dock 已隐藏，此时「全屏」键变成无效键，藏掉；
               放大/缩小在全屏里仍有用，保留。
               ⚠ 必须用兄弟组合子 `~` —— 按钮组挂在 <html> 下、是 <body> 的兄弟节点，
               `body.clean-mode #md-fab-group` 这种后代选择器永远不匹配（Dock 当初
               就踩过同一个坑）。 */
            'html.mobile-ui body.clean-mode ~ #md-fab-group > #btn-clean{display:none !important;}' +
            /* ⑧ 面板打开时藏掉按钮组：它 z 1520 高于 Sheet 1490，会压住面板正文右侧
               约 46px 并抢走点击（点最右列按钮会误触全屏/缩放）。面板自带 ✕ 与蒙层，
               收起入口不缺。 */
            'html.mobile-ui.md-sheet-open #md-fab-group{display:none;}' +
            /* 同上：图例弹窗打开时也藏掉按钮组。⑪ 把 #legend-modal 降到 1495 后，
               z 1520 的按钮组会浮到蒙层之上压住图例内容右缘（实测重叠 8800px²）。
               图例自带 ✕ 与「点蒙层关闭」两条退出路径，藏掉不影响使用。 */
            'html.mobile-ui:has(#legend-modal.open) #md-fab-group{display:none;}' +
            /* 底图来源（Leaflet attribution）：抬到 Dock 上沿之上，与 PC 端右下角一致 */
            'html.mobile-ui .leaflet-bottom.leaflet-right{' +
            'bottom:calc(var(--dock-h, 150px) + 6px);}' +
            /* ⑫ 比例尺（Leaflet scale，创建时 position:bottomleft）：同样抬到 Dock 之上。
               ⚠ 不能照抄底图来源的 +6px —— 那条高度正好是 #eye-coord 所在的横带
               （eye-coord 固定在 dock-h+8、高 21px），会与其完全重叠（实测 x 5..114 对
               12..123、y 616..639 对 616..637）。故再往上让一行：
               dock-h + 8(eye-coord 偏移) + 21(其高度) + 5(间隙) = dock-h + 34。 */
            'html.mobile-ui .leaflet-bottom.leaflet-left{' +
            'bottom:calc(var(--dock-h, 150px) + 34px);}' +
            /* 点击底部标签时收起前三行（2026-09-26 用户要求）：只留标签栏，露出更多
               地图。类名由 JS 在 openSheet / toggleDataDrawer / closeAll 里切换。 */
            /* Dock 前三行收起（2026-09-26）：改用 max-height + opacity 过渡，替掉原来的
               display:none 突变。⚠ 基础态必须给 max-height 一个具体值 —— `none` → `0`
               无法插值，动画会直接失效；overflow:hidden 是 max-height 动画的前提。
               过渡期间由 syncDockHeightAnimated() 持续把真实高度写回 --dock-h，
               让右下角按钮组 / 经纬度 / 底图来源跟着平滑上移，而不是动画结束后跳一下。 */
            'html.mobile-ui #mobile-dock .md-time{max-height:120px;overflow:hidden;' +
            'transition:max-height 0.22s ease,opacity 0.18s ease;}' +
            'html.mobile-ui #mobile-dock .md-slider{max-height:80px;overflow:hidden;' +
            'transition:max-height 0.22s ease,opacity 0.18s ease;}' +
            'html.mobile-ui.md-dock-collapsed #mobile-dock .md-time,' +
            'html.mobile-ui.md-dock-collapsed #mobile-dock .md-slider{max-height:0;' +
            'min-height:0;opacity:0;pointer-events:none;}' +
            // 航线名标签：窄屏上英文名很长，缩小一号给避让留出回旋余地。
            'html.mobile-ui .route-name-label span{font-size:11px;padding:2px 6px;border-width:1.5px;}' +
            'html.mobile-ui .md-sheet-body #wind-toggle{min-width:96px;min-height:48px;font-size:0.9rem;}' +
            /* 风眼经纬度：不再藏进 Dock，改固定在地图左下角、Dock 上沿之上，
               与 PC 端左下角（比例尺同行）保持一致（2026-09-26 用户要求）。 */
            'html.mobile-ui #eye-coord{' +
            'position:fixed;left:12px;bottom:calc(var(--dock-h, 150px) + 8px);' +
            /* ⑥ 修：必须显式 margin:0 —— PC 段 `#eye-coord.in-scale-row` 的
               `margin:0 0 5px 8px` 仍然命中（主逻辑给它加过 in-scale-row 类），
               不重置就会把实际位置从 12px/8px 顶到 20px/13px。
               z-index 1450 → 1340：与测距条(1420)、关注区小窗(1350)共用同一个
               `bottom: dock-h+8px` 锚点，降低后由它们盖住，不再互相叠字。 */
            'z-index:1340;margin:0;max-width:60vw;padding:2px 8px;border-radius:8px;' +
            'background:rgba(255,255,255,0.82);font-size:0.72rem;font-weight:700;' +
            'letter-spacing:0.02em;color:#222;pointer-events:none;white-space:nowrap;}' +
            'html.mobile-ui #mobile-dock #playback-controls button{min-width:34px;}' +
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
            /*
             * ⚠ 1490，不是 2750：仍高于状态条 #compare-legend(1450)，但**低于 Dock(1500)**。
             * 原来的 2750 会把 Dock 一起盖住 —— 而 Sheet 底部那条
             * `padding-bottom: dock-h` 本就是给 Dock 让位的，被盖住后就裸露成一块纯白
             * 「白框」，用户「往下划一下文字就被白框盖住」（2026-09-25 报）。
             * 1490 让 Dock 重新盖在那条空白上，白框消失且 Dock 恢复常驻可见可点。
             */
            'html.mobile-ui .md-sheet.open{z-index:1490;}' +
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
        buildFabGroup();
        hookFocusWindow();
        bindTabs();
        bindMapInteracting();
        bindTickerState();
        bindDockClock();
        bindViewportSync();
        syncDockHeight();

        window.addEventListener('resize', syncDockHeight, { passive: true });
        window.addEventListener('orientationchange', function () { setTimeout(syncDockHeight, 260); });
        doc.addEventListener('keydown', onKeydown);

        // 语言切换后，Sheet/Dock 里的标题与标签需要重新按新语言渲染（需求 4）
        if (window.I18N && window.I18N.onChange) {
            window.I18N.onChange(function () {
                resyncViewport();
                syncTickerState();
            });
        }

        /* 移动端的 CSS 覆盖（含地图标签的字号）到这一刻才真正生效，让主逻辑
           按真实像素尺寸把地图上的文字标签重排一次 —— 否则首屏会沿用桌面字号
           量出的位置，英文长标签会互压、也会压住台风路径。 */
        if (typeof window.__mobileRebuild === 'function') window.__mobileRebuild();

        /* 首屏解锁：build() 跑完，节点都已搬进底部 Sheet，才让 <head> 里那条
           `html.mobile-ui:not(.mobile-ready) body > *:not(#map)` 失效，
           这样中途不会先闪一下桌面布局。 */
        html.classList.add('mobile-ready');
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

        /* 设置面板：只保留「显示设置」—— 风场开关、透明度 + 订正场差值图例。
           全屏 / 锁定风眼 / 复位视图 / 强度演变 / 灾害预警 / 截图导出 一律**不搬**：
           它们在 #tool-controls 里本就分属「视图 / 分析图表 / 对比导出」三组，
           跟着「工具」Sheet 走才符合直觉；搬进设置面板会让两组归类错乱
           （2026-09-25 用户反馈「底部工具和设置里的功能按钮定位不明确」）。 */
        var body = settings.querySelector('.md-sheet-body');
        var windRow = $('wind-row');
        if (windRow) body.appendChild(windRow);
        var diff = $('diff-legend');
        if (diff) body.appendChild(diff);
    }

    function moveNodes() {
        var dock = $('mobile-dock');
        var time = dock.querySelector('.md-time');
        var slider = dock.querySelector('.md-slider');

        /*
         * Dock 行1 拆成两行（2026-09-25）：
         *   行1 = 5 个播放键独占整行（360px 屏上每个从 44px 放宽到 ≈67px）
         *   行2 = 完整时间读数 + 循环键 + 倍速
         * 原来行1 挤了「6 个播放键 + 倍速 + 时钟徽标」≈458px，360px 屏可用仅 344px，
         * 键宽只能压到 44px 触控下限。拆法：#btn-loop 从 #playback-controls 里摘出来，
         * 与 #speed-select 一起放进 .md-time。appendChild 的先后顺序配合 CSS 的
         * flex-wrap 决定视觉分行（#playback-controls 设 flex: 0 0 100% 独占行1）。
         * 搬的都是原节点，主逻辑绑在它们身上的监听随之保留。
         */
        var pb = $('playback-controls');
        if (pb) time.appendChild(pb);            // 行1
        var td = $('time-display');
        if (td) time.appendChild(td);            // 行2 左：'YYYY-MM-DD HH:MM' 完整读数
        var loop = $('btn-loop');
        if (loop) time.appendChild(loop);        // 行2 右：循环（从播放条里摘出）
        var sp = $('speed-select');
        if (sp) time.appendChild(sp);            // 行2 右：倍速
        var sl = $('time-slider');
        if (sl) slider.appendChild(sl);
        var tk = $('time-ticks');
        if (tk) slider.appendChild(tk);

        /*
         * 时间读数改为直接显示 #time-display（完整日期时间），不再隐藏后镜像到
         * .md-clock 徽标：徽标只有 46px 宽塞不下完整读数，而行1 已被播放键占满，
         * 那枚绝对定位的徽标会压在按钮上。徽标改由 CSS 隐藏（.md-clock），
         * syncDockClock 仍在跑但只写不显示，无害。
         */

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

    /* ------------------------------------------------------ 右下角浮层按钮组 */
    /* 「全屏 / 放大 / 缩小」从工具 Sheet 的「视图」组摘出，与页面原有的「收起」
       一起竖排在 Dock 上沿右侧（2026-09-26 用户要求）。搬的都是原节点，主逻辑
       绑在它们身上的监听随之保留，无需重新绑定。 */
    function buildFabGroup() {
        var g = doc.getElementById('md-fab-group');
        if (!g) {
            g = doc.createElement('div');
            g.id = 'md-fab-group';
            html.appendChild(g);
        }
        ['btn-clean', 'btn-zoom-in', 'btn-zoom-out', 'btn-clear-overlays'].forEach(function (id) {
            var el = $(id);
            if (el) g.appendChild(el);
        });
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
        // 面板打开时收起 Dock 前三行（2026-09-26 用户要求），露出更多地图
        html.classList.add('md-dock-collapsed');
        syncDockHeightAnimated();
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
            html.classList.add('md-dock-collapsed');
            html.classList.add('md-sheet-open');
            syncDockHeightAnimated();
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
        html.classList.remove('md-dock-collapsed');
        syncDockHeightAnimated();
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
            /* ⑬b 修：点 ✕ 时不能进拖拽分支。✕(.md-close) 是 .md-sheet-head 的后代，
               会命中上面的条件；随后 setPointerCapture 把后续 pointerup 重定向到 sec，
               click 便派发到 sec 而不是 ✕ 按钮 → .md-close 的关闭回调永不触发
               （点 ✕ 关不掉面板，且 dy≈0 也不会触发拖拽关闭）。 */
            if (e.target.closest && e.target.closest('.md-close')) return;
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

    /* ------------------------------------------------ Dock 时钟（需求 5） */
    /*
     * 实测缺陷：`.md-clock` 是 mobile-ui.js 自己造的徽标，`#md-clock-text` 初值 '--'
     * **从来没有人更新过** —— 于是 Dock 右上角永远显示一个没意义的「--」，白占 50px 宽度。
     * 主逻辑真正的读数在 `#time-display`（格式 'YYYY-MM-DD HH:MM'），手机端被 .md-hidden
     * 藏起来了。这里只读不写地把它镜像成 HH:MM 到徽标里，徽标才有存在意义。
     */
    function syncDockClock() {
        var src = $('time-display');
        var dst = $('md-clock-text');
        if (!src || !dst) return;
        var txt = (src.textContent || '').trim();
        var m = /(\d{2}:\d{2})/.exec(txt);
        var val = m ? m[1] : (txt || '--');
        if (dst.textContent !== val) dst.textContent = val;
        // 完整日期放进 title，长按/悬停仍可看到
        var chip = $('md-clock');
        if (chip) chip.setAttribute('title', txt);
    }

    function bindDockClock() {
        var src = $('time-display');
        if (!src) return;
        syncDockClock();
        new MutationObserver(syncDockClock)
            .observe(src, { childList: true, characterData: true, subtree: true });
    }

    /* -------------------------------------------------------- Dock 高度 */
    var syncing = false;
    function syncDockHeight() {
        var dock = $('mobile-dock');
        if (!dock) return;
        /*
         * ⚠ 全屏（洁净模式）下 Dock 被 `display:none`，此时 getBoundingClientRect().height
         * 是 0 —— 正是我们要的：所有 `bottom: calc(var(--dock-h) + Npx)` 的浮层必须贴底。
         * 老实现只在 resize 时同步，而「进/出全屏」在手机上不一定派发 resize，
         * 于是 --dock-h 一直停在 161px：全屏后图例按钮、测距条、关注区小窗全部悬在半空
         * —— 这就是「全屏后操作有 bug」的主因之一（需求 1）。
         */
        var h = Math.round(dock.getBoundingClientRect().height);
        html.style.setProperty('--dock-h', (h > 0 ? h : 0) + 'px');
        // 关注区小窗 / 迷你地图需要在 Dock 变化后让 Leaflet 重算尺寸。
        // 注意：dispatchEvent 是同步派发 —— 本函数自身就是 resize 监听器，
        // 没有这道重入保护会 sync→dispatch→sync 无限递归爆栈。
        if (syncing) return;
        syncing = true;
        window.dispatchEvent(new Event('resize'));
        syncing = false;
    }


    /* Dock 折叠过渡期间的高度同步（2026-09-26）。
       动画跑 0.28s，每帧把 Dock 的真实高度写回 --dock-h，让所有
       `bottom: calc(var(--dock-h) + Npx)` 的浮层跟着一起平滑上移。
       这里刻意**不**派发 resize —— 那会触发 Leaflet 与主逻辑重算，
       60fps 跑 0.28s 太重；动画结束后再走一次完整的 syncDockHeight()。 */
    function syncDockHeightAnimated() {
        var t0 = Date.now();
        (function loop() {
            var dock = $('mobile-dock');
            if (dock) {
                var h = Math.round(dock.getBoundingClientRect().height);
                html.style.setProperty('--dock-h', (h > 0 ? h : 0) + 'px');
            }
            if (Date.now() - t0 < 280) requestAnimationFrame(loop);
            else syncDockHeight();
        })();
    }
    /* -------------------------------------------------- 全屏 / 视口变化（需求 1） */
    /*
     * 手机上进/出全屏会同时改变三样东西，而它们都不会自动同步：
     *   1) --dock-h（Dock 被隐藏/恢复）
     *   2) Leaflet 内部缓存的容器尺寸 → 瓦片只画旧范围、点击/拖拽坐标整体偏移
     *   3) 风场 canvas（主逻辑按 devicePixelRatio 画的）→ 尺寸不匹配
     * 这三样的统一解法就是「重算 --dock-h + 派发一次 resize」：主逻辑与 Leaflet
     * 都监听了 window resize。全屏过渡是异步的，所以补两次延迟重算。
     */
    function resyncViewport() {
        syncDockHeight();
        setTimeout(syncDockHeight, 120);
        setTimeout(syncDockHeight, 420);
    }

    function onFullscreenChange() {
        // 进全屏后 Sheet 若还开着，会盖住大半个地图（实测就是「全屏后没法操作」的元凶）
        if (document.body.classList.contains('clean-mode')) closeAll();
        resyncViewport();
    }

    function bindViewportSync() {
        document.addEventListener('fullscreenchange', onFullscreenChange);
        document.addEventListener('webkitfullscreenchange', onFullscreenChange);
        document.addEventListener('MSFullscreenChange', onFullscreenChange);
        if (window.visualViewport) {
            // 真机上「地址栏收起 / 键盘弹出」只改 visualViewport，不一定派发 window resize
            visualViewport.addEventListener('resize', resyncViewport, { passive: true });
        }
        // 主逻辑的 enterCleanMode() 只加 body.clean-mode，我们在这里跟随（不改主模块一行）
        new MutationObserver(function () {
            if (document.body.classList.contains('clean-mode')) {
                closeAll();
                resyncViewport();
            } else {
                resyncViewport();
            }
        }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    /* ------------------------------------------------ 快讯条可见性（需求 5） */
    /*
     * #news-ticker 与 #gba-label 原来都定位在 top:52px，实测**完全重叠**。
     * 主逻辑只改 #news-ticker 的 display，我们只读不写，把结果映射成 html 上的
     * class，由 CSS 决定标签位置 —— 关掉快讯后不留空洞。
     */
    function syncTickerState() {
        var t = $('news-ticker');
        if (!t) return;
        var vis = t.style.display !== 'none' && getComputedStyle(t).display !== 'none';
        html.classList.toggle('md-ticker-off', !vis);
    }

    function bindTickerState() {
        var t = $('news-ticker');
        if (!t) return;
        syncTickerState();
        new MutationObserver(syncTickerState)
            .observe(t, { attributes: true, attributeFilter: ['style', 'class'] });
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
        resyncViewport: resyncViewport,
        syncTickerState: syncTickerState,
        syncDockClock: syncDockClock,
        build: build
    };
})();
/* ============================================================================
 * qr-popup.js — 「手机扫码进入」入口（经典脚本，唯一全局 window.MobileUI.QR）
 * ----------------------------------------------------------------------------
 * 依赖：qr-encoder.js（window.QRCode）。本文件先内联，随后由它引用。
 * 设计：模态框 DOM 与样式全部由本脚本注入 —— index.html 里只留一个按钮锚点，
 *       便于后续维护（改样式/文案不用翻 4000 行的主文件），也避免污染桌面布局。
 * ==========================================================================*/
(function () {
    'use strict';
    if (window.__qrPopupReady) return;
    window.__qrPopupReady = true;

    var doc = document;
    var $ = function (id) { return doc.getElementById(id); };
    var btn = $('btn-qr');
    if (!btn) return;                       // 没有入口（例如手机端被隐藏）就不装任何东西
    // 手机端：扫码是「电脑→手机」的入口，手机自己不需要；直接不初始化，省掉一次 DOM/画布开销
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) return;

    var DEFAULT_HINT = '手机与电脑需在同一网络（局域网 IP），或使用公网地址。';
    var state = { url: '', ready: false, modal: null };

    /* ------------------------------------------------------------ 样式 */
    var CSS =
        '#qr-modal{position:fixed;inset:0;z-index:3000;display:none;align-items:center;justify-content:center;' +
        'background:rgba(8,20,35,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);}' +
        '#qr-modal.open{display:flex;}' +
        '#qr-modal .qr-box{width:352px;max-width:94vw;max-height:92vh;overflow-y:auto;background:#fff;border-radius:16px;' +
        'box-shadow:0 18px 48px rgba(0,0,0,.35);padding:16px 18px 18px;color:#1a2b3c;}' +
        '#qr-modal .qr-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}' +
        '#qr-modal .qr-head h3{font-size:1rem;font-weight:700;color:#0d47a1;letter-spacing:.04em;}' +
        '#qr-modal .qr-close{border:none;background:#f1f5f9;color:#546e7a;width:28px;height:28px;border-radius:50%;' +
        'font-size:1rem;line-height:1;cursor:pointer;}' +
        '#qr-modal .qr-close:hover{background:#e2e8f0;}' +
        '#qr-modal .qr-sub{font-size:.72rem;color:#78909c;margin-bottom:10px;}' +
        '#qr-modal .qr-canvas-wrap{display:flex;align-items:center;justify-content:center;padding:8px;' +
        'background:#f8fafc;border:1px solid #e3eaf2;border-radius:12px;min-height:236px;}' +
        '#qr-modal canvas{display:block;border-radius:4px;}' +
        '#qr-modal .qr-url-row{display:flex;gap:6px;margin-top:10px;}' +
        '#qr-modal .qr-url-row input{flex:1 1 auto;min-width:0;padding:8px 10px;border:1px solid #cfd8e3;' +
        'border-radius:8px;font-size:.8rem;font-family:Consolas,Menlo,monospace;color:#1a2b3c;}' +
        '#qr-modal .qr-url-row input:focus{outline:none;border-color:#1976d2;box-shadow:0 0 0 2px rgba(25,118,210,.15);}' +
        '#qr-modal .qr-btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}' +
        '#qr-modal button.qr-act{border:1px solid #cfd8e3;background:#f8fafc;color:#37474f;border-radius:8px;' +
        'padding:6px 11px;font-size:.76rem;cursor:pointer;transition:all .15s;}' +
        '#qr-modal button.qr-act:hover{background:#e3f2fd;border-color:#1976d2;color:#0d47a1;}' +
        '#qr-modal button.qr-act.primary{background:#1976d2;border-color:#1976d2;color:#fff;}' +
        '#qr-modal button.qr-act.primary:hover{background:#1565c0;}' +
        '#qr-modal .qr-hint{margin-top:10px;font-size:.7rem;line-height:1.6;color:#607d8b;' +
        'background:#f1f8ff;border-left:3px solid #1976d2;border-radius:0 6px 6px 0;padding:7px 9px;}' +
        '#qr-modal .qr-hint.warn{background:#fff5f5;border-left-color:#e53935;color:#b71c1c;}' +
        '#qr-modal .qr-meta{margin-top:8px;font-size:.68rem;color:#90a4ae;text-align:center;}';

    function injectStyle() {
        var s = doc.createElement('style');
        s.id = 'qr-popup-style';
        s.textContent = CSS;
        doc.head.appendChild(s);
    }

    /* -------------------------------------------------------------- DOM */
    function buildModal() {
        var m = doc.createElement('div');
        m.id = 'qr-modal';
        m.innerHTML =
            '<div class="qr-box" role="dialog" aria-modal="true" aria-label="手机扫码进入">' +
                '<div class="qr-head"><h3>📱 手机扫码进入</h3>' +
                '<button type="button" class="qr-close" aria-label="关闭">✕</button></div>' +
                '<div class="qr-sub">用手机相机 / 微信扫一扫，直接打开下面这个地址（无需联网外网）。</div>' +
                '<div class="qr-canvas-wrap"><canvas id="qr-canvas" width="228" height="228"></canvas></div>' +
                '<div class="qr-url-row"><input id="qr-url-input" type="text" spellcheck="false" ' +
                'placeholder="http://192.168.x.x:8899/"></div>' +
                '<div class="qr-btns">' +
                    '<button type="button" class="qr-act primary" data-act="copy">复制链接</button>' +
                    '<button type="button" class="qr-act" data-act="cur">用当前地址</button>' +
                    '<button type="button" class="qr-act" data-act="lan">换成局域网 IP</button>' +
                    '<button type="button" class="qr-act" data-act="open">在新标签打开</button>' +
                '</div>' +
                '<div class="qr-hint" id="qr-hint"></div>' +
                '<div class="qr-meta" id="qr-meta"></div>' +
            '</div>';
        doc.body.appendChild(m);
        state.modal = m;

        m.querySelector('.qr-close').addEventListener('click', close);
        m.addEventListener('click', function (e) { if (e.target === m) close(); });
        m.querySelector('.qr-btns').addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('.qr-act') : null;
            if (!b) return;
            var act = b.getAttribute('data-act');
            if (act === 'copy') copyUrl(b);
            else if (act === 'cur') setUrl(currentUrl());
            else if (act === 'lan') setUrl(lanCandidate());
            else if (act === 'open') window.open($('qr-url-input').value, '_blank', 'noopener');
        });
        $('qr-url-input').addEventListener('input', function () { setUrl(this.value.trim(), true); });
    }

    /* ---------------------------------------------------------- 地址处理 */
    function currentUrl() {
        return location.origin + location.pathname + location.search;
    }

    // 把 localhost / 127.0.0.1 换成「可能可用的局域网 IP」占位：浏览器拿不到真实网卡 IP，
    // 所以给出当前主机名的替换建议，用户改成自己电脑的 192.168.x.x 即可。
    function lanCandidate() {
        var origin = location.origin;
        var host = location.hostname;
        var port = location.port ? ':' + location.port : '';
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
            return 'http://192.168.1.100' + port + location.pathname;
        }
        return origin + location.pathname;
    }

    function validate(u) {
        if (!u) return { level: 'warn', msg: '请输入要编码的地址。' };
        if (/^file:/i.test(u)) {
            return { level: 'warn', msg: '这是本地文件路径（file://），手机无法访问。请改用电脑的局域网 IP 或公网地址。' };
        }
        var m = /^(https?):\/\/([^\/\s:]+)(:\d+)?(\/[^\s]*)?$/i.exec(u);
        if (!m) {
            return { level: 'warn', msg: '地址格式无法识别，建议以 http:// 或 https:// 开头，例如 http://192.168.1.20:8899/' };
        }
        var host = m[2];
        var base = DEFAULT_HINT;
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
            return { level: 'warn', msg: 'localhost / 127.0.0.1 只在本机有效，手机扫码打不开。请点「换成局域网 IP」并把 IP 改成你电脑的地址。' };
        }
        if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
            return { level: 'ok', msg: '局域网地址：手机需连同一个 Wi-Fi / 同一网段。' + base };
        }
        return { level: 'ok', msg: base };
    }

    /* ------------------------------------------------------------ 渲染 */
    function setUrl(u, fromInput) {
        var input = $('qr-url-input');
        if (!fromInput) input.value = u;
        state.url = u;
        var hint = $('qr-hint');
        var meta = $('qr-meta');
        var v = validate(u);
        hint.className = 'qr-hint' + (v.level === 'warn' ? ' warn' : '');
        hint.textContent = v.msg;

        var canvas = $('qr-canvas');
        if (!window.QRCode) {
            meta.textContent = '二维码组件未加载';
            return;
        }
        try {
            var r = window.QRCode.render(canvas, u, { ecLevel: 'M', margin: 4, scale: 'auto' });
            var shown = u.length > 68 ? u.slice(0, 34) + ' … ' + u.slice(-30) : u;
            meta.textContent = '共 ' + u.length + ' 字符 · 版本 ' + r.version + ' · 纠错 ' + r.ecLevel +
                ' · 模块 ' + r.size + '×' + r.size + '\n' + shown;
            state.ready = true;
        } catch (err) {
            meta.textContent = '地址过长，无法生成二维码（' + (err && err.message) + '）';
            state.ready = false;
        }
    }

    function copyUrl(b) {
        var u = $('qr-url-input').value;
        var done = function () {
            var old = b.textContent;
            b.textContent = '✓ 已复制';
            setTimeout(function () { b.textContent = old; }, 1400);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(u).then(done, function () { fallbackCopy(u, done); });
        } else {
            fallbackCopy(u, done);
        }
    }

    function fallbackCopy(text, done) {
        var ta = doc.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        doc.body.appendChild(ta);
        ta.select();
        try { doc.execCommand('copy'); done(); } catch (e) { /* 忽略 */ }
        doc.body.removeChild(ta);
    }

    /* -------------------------------------------------------- 打开/关闭 */
    function open() {
        if (!state.modal) buildModal();
        var m = state.modal;
        m.classList.add('open');
        setUrl(currentUrl());
        doc.addEventListener('keydown', onKey);
    }
    function close() {
        if (state.modal) state.modal.classList.remove('open');
        doc.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    /* ------------------------------------------------------------ 启动 */
    injectStyle();
    buildModal();
    btn.addEventListener('click', open);

    window.MobileUI = window.MobileUI || {};
    window.MobileUI.QR = { open: open, close: close, isReady: function () { return state.ready; } };
})();

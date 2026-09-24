/* ============================================================================
 * mobile/i18n.js — 中英双语层（经典脚本，唯一全局 window.I18N）
 * ----------------------------------------------------------------------------
 * 设计目标（需求 4：添加英文版本与语言切换键）
 *
 *  1) **桌面端零风险**：默认语言是中文，此时本脚本只在 DOM 上做「记录原文」，
 *     不改任何可见文本；只有用户主动切到 English 才会替换。切回中文会**逐字
 *     还原**最初的中文（不是再翻译一次），所以来回切换不会累积误差。
 *
 *  2) **不改主逻辑**：主 module 里有 200+ 处动态拼接的中文（快讯、弹窗、表格、
 *     图例……）。这里用「精确查表 + 长串优先短语替换」的 t()，再叠加
 *     MutationObserver 监听新增/变更的文本节点 —— 主逻辑写什么，这里就译什么，
 *     不需要去改它一行代码。
 *
 *  3) **不动地图内容**：瓦片上的地名是图片像素，本来就不该被 DOM 翻译逻辑碰到；
 *     #map 内部仍然遍历（Leaflet 弹窗是主逻辑生成的 DOM，需要翻译），
 *     但纯 Leaflet 自带的英文注记不在词表里，原样保留。
 *
 *  4) 词表来自 mobile/i18n-dict.js（window.__I18N_DICT），由 .dev/i18n-en.json
 *     生成 —— 词表与引擎分离，方便复核与再生成。
 *
 * 接口（对内/对测试冻结）：
 *   I18N.lang                 当前语言 'zh' | 'en'
 *   I18N.t(s)                 翻译一个字符串（含拼接句）
 *   I18N.apply(root)          对子树做一次翻译/还原
 *   I18N.set(lang)            切换语言（持久化 + 派发 onChange）
 *   I18N.onChange(fn)         注册语言变化回调
 *   I18N.toggle()             中 ⇄ 英
 * ==========================================================================*/
(function () {
    'use strict';
    if (window.I18N) return;

    var STORE_KEY = 'smartocean-lang';
    var ZH = 'zh', EN = 'en';
    var DICT = window.__I18N_DICT || {};

    /* ------------------------------------------------------------ 短语表 */
    /*
     * 主逻辑的句子是拼出来的，例如
     *   '【台风快讯】台风"' + name + tToBeijingTime(t) + '位于' + lat + '°N, ' + ...
     * 整句不在词表里，但每个中文**片段**在。于是构造「长串优先」的替换表：
     *   - 只收纯文本片段（不含 HTML 标签）——含标签的交给精确查表；
     *   - 长度 ≥2 —— 单字（'一'/'年'/'月'/'日'）参与替换会把句子拆烂；
     *   - 按长度降序 —— '台风中心' 必须先于 '台风' 命中。
     */
    function buildPhrases(dict) {
        var out = [];
        for (var k in dict) {
            if (!Object.prototype.hasOwnProperty.call(dict, k)) continue;
            if (k.length < 2) continue;
            if (/[<>]/.test(k)) continue;              // HTML 片段：只走精确匹配
            if (!/[\u4e00-\u9fa5]/.test(k)) continue;  // 没有汉字，无需替换
            out.push([k, dict[k]]);
        }
        out.sort(function (a, b) { return b[0].length - a[0].length; });
        return out;
    }
    var PHRASES = buildPhrases(DICT);
    var HAS_CN = /[\u4e00-\u9fa5]/;

    /* --------------------------------------------------------------- t() */
    var exact = Object.create(null);
    for (var dk in DICT) if (Object.prototype.hasOwnProperty.call(DICT, dk)) exact[dk] = DICT[dk];

    function t(s) {
        if (typeof s !== 'string' || !s || !HAS_CN.test(s)) return s;
        var hit = exact[s];
        if (hit !== undefined) return hit;
        // 拼接句：长串优先做字面替换
        var out = s;
        for (var i = 0; i < PHRASES.length; i++) {
            if (out.indexOf(PHRASES[i][0]) >= 0) {
                out = out.split(PHRASES[i][0]).join(PHRASES[i][1]);
            }
            if (!HAS_CN.test(out)) break;              // 已经全英文，提前收工
        }
        return out;
    }

    /* ------------------------------------------------- 原文记录 / 还原 */
    /*
     * 每个被改写的文本节点/属性都留一份最初的中文，切回中文时逐字还原。
     * 用 WeakMap 而不是自定义属性，避免污染 DOM、也避免被 innerHTML 序列化带走。
     */
    var zhText = new WeakMap();     // TextNode -> 原始 data
    var zhAttr = new WeakMap();     // Element  -> { attr: 原始值 }

    var SKIP_TAG = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1 };
    var ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip', 'alt'];

    function translatableText(node) {
        var p = node.parentNode;
        if (!p || p.nodeType !== 1) return false;
        if (SKIP_TAG[p.tagName]) return false;
        if (p.closest && p.closest('[data-i18n-skip]')) return false;
        return true;
    }

    function doTextNode(node, lang) {
        if (!translatableText(node)) return;
        if (lang === EN) {
            var cur = node.data;
            if (!cur || !HAS_CN.test(cur)) return;
            if (!zhText.has(node)) zhText.set(node, cur);
            var next = t(zhText.get(node));
            if (next !== cur) node.data = next;
        } else if (zhText.has(node)) {
            var orig = zhText.get(node);
            if (node.data !== orig) node.data = orig;
        }
    }

    function doElementAttrs(el, lang) {
        if (SKIP_TAG[el.tagName]) return;
        if (el.hasAttribute && el.hasAttribute('data-i18n-skip')) return;
        for (var i = 0; i < ATTRS.length; i++) {
            var a = ATTRS[i];
            if (!el.hasAttribute || !el.hasAttribute(a)) continue;
            if (lang === EN) {
                var v = el.getAttribute(a);
                if (!v || !HAS_CN.test(v)) continue;
                var rec = zhAttr.get(el);
                if (!rec) { rec = {}; zhAttr.set(el, rec); }
                if (!(a in rec)) rec[a] = v;
                var nv = t(rec[a]);
                if (nv !== v) el.setAttribute(a, nv);
            } else {
                var r = zhAttr.get(el);
                if (r && (a in r) && el.getAttribute(a) !== r[a]) el.setAttribute(a, r[a]);
            }
        }
    }

    function walk(root, lang) {
        if (!root) return;
        if (root.nodeType === 3) { doTextNode(root, lang); return; }
        if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
        if (root.nodeType === 1) doElementAttrs(root, lang);
        var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null, false);
        var n;
        while ((n = tw.nextNode())) {
            if (n.nodeType === 3) doTextNode(n, lang);
            else doElementAttrs(n, lang);
        }
    }

    var lang = ZH;

    /* -------------------------------------------------- 对外：apply / set */
    /*
     * ⚠ 根节点必须是 documentElement，不能是 body。
     * `#mobile-dock`、`.md-sheet`、`#md-scrim` 都由 mobile-ui.js 挂在 **<html> 下**
     * （body 的兄弟节点，见 mobile-ui.js 的说明），只走 body 会把整套手机端 UI 漏掉
     * —— 实测：切到英文后 Dock 标签仍是「图层/工具/设置」。
     */
    function root() { return document.documentElement; }

    function apply(node) {
        walk(node || root(), lang);
    }

    var listeners = [];
    function emit() {
        for (var i = 0; i < listeners.length; i++) {
            try { listeners[i](lang); } catch (e) { /* 单个回调出错不影响其它 */ }
        }
    }

    var booted = false;
    function boot() {
        if (booted) return;
        booted = true;
        var el = root();
        if (!el) return;

        // 动态内容：主逻辑插入的表格行/弹窗/图例/快讯文本，以及 mobile-ui.js 建的 Dock/Sheet
        var scheduled = false;
        new MutationObserver(function (recs) {
            if (lang !== EN) return;
            for (var i = 0; i < recs.length; i++) {
                var r = recs[i];
                if (r.type === 'childList') {
                    for (var j = 0; j < r.addedNodes.length; j++) {
                        var an = r.addedNodes[j];
                        if (an.nodeType === 3 || an.nodeType === 1) walk(an, EN);
                    }
                }
            }
            // characterData（textContent 被整体替换的句子）合并到下一帧统一处理，
            // 避免逐字抖动、也避免观察器回调里再触发回调造成风暴。
            if (!scheduled) {
                scheduled = true;
                requestAnimationFrame(function () { scheduled = false; walk(el, lang); });
            }
        }).observe(el, { childList: true, subtree: true, characterData: true });

        if (lang === EN) apply(el);
    }

    function set(next, opts) {
        next = (next === EN) ? EN : ZH;
        var changed = next !== lang;
        lang = next;
        document.documentElement.lang = (next === EN) ? 'en' : 'zh-CN';
        document.documentElement.setAttribute('data-lang', next);
        try { localStorage.setItem(STORE_KEY, next); } catch (e) { /* 隐私模式 */ }
        apply(root());
        if (changed || (opts && opts.force)) emit();
    }

    function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }
    function toggle() { set(lang === EN ? ZH : EN); }

    /* ------------------------------------------------------ 语言切换键 */
    /*
     * #btn-lang 是 index.html 里的静态按钮（放在 #top-controls 内）：
     *   - 桌面端：右上角工具栏多一个 46×44 的按钮，与既有按钮同款；
     *   - 手机端：#layer-switcher / #btn-qr 都不显示，右上角只剩它，正好 44×44。
     * 按钮文字显示**目标语言**（中文界面显示 "EN"，英文界面显示 "中文"）。
     */
    function label() {
        var b = document.getElementById('btn-lang');
        if (!b) return;
        var text = (lang === EN) ? '中文' : 'EN';
        b.textContent = text;
        b.setAttribute('title', (lang === EN) ? '切换到中文' : 'Switch to English');
        b.setAttribute('aria-label', (lang === EN) ? '切换到中文界面' : 'Switch to English UI');
        // 按钮自身的文案不参与词表翻译（它是语言名，翻译会自我指涉）
        b.setAttribute('data-i18n-skip', '');
    }

    function bindButton() {
        var b = document.getElementById('btn-lang');
        if (!b || b.__i18nBound) return;
        b.__i18nBound = true;
        b.addEventListener('click', function (e) {
            e.preventDefault();
            toggle();
        });
    }

    function init() {
        var saved = null;
        try { saved = localStorage.getItem(STORE_KEY); } catch (e) { /* ignore */ }
        var qs = null;
        try { qs = new URLSearchParams(location.search).get('lang'); } catch (e) { /* ignore */ }
        var want = (qs === EN || qs === ZH) ? qs : (saved === EN ? EN : ZH);

        bindButton();
        lang = want;
        document.documentElement.lang = (want === EN) ? 'en' : 'zh-CN';
        document.documentElement.setAttribute('data-lang', want);
        label();
        boot();
        apply(root());
        onChange(label);
    }

    window.I18N = {
        t: t,
        apply: apply,
        set: set,
        onChange: onChange,
        toggle: toggle,
        dictSize: Object.keys(DICT).length,
        get lang() { return lang; }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 0);
    }
})();

// modules/phone/taPhone/taPhoneShared.js — Shared helpers used by every
// subpage. Lives outside taPhoneApp.js so subpages don't have to import
// from the app entry (which would create a circular dependency once
// taPhoneApp dispatches into subpages).
//
// Phase 1 surface: formatting + empty-state HTML.
// Phase 2 additions: short hash, detail-page LLM wrapper, and the
// navigation stack that backs the multi-layer back button.

import { callPhoneLLM } from '../../api.js';
import { cleanLlmJson, repairUnescapedQuotes } from '../utils/llmJsonCleaner.js';
import { tryAutoStartKeepAlive } from '../keepAlive.js';
import { openAppInViewport } from '../phoneController.js';

export const TP_LOG = '[TaPhone]';

/**
 * Render an ISO timestamp into a short, locale-aware form:
 *   - today:        HH:MM
 *   - this year:    M月D日 HH:MM
 *   - older:        YYYY/M/D
 * Returns the original string unchanged for invalid input so the UI never
 * shows literal "Invalid Date".
 */
export function formatTimestamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    const sameDay = d.toDateString() === now.toDateString();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (sameDay) return `${hh}:${mm}`;
    if (sameYear) return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * Standard empty-state card with an icon + message. Used by every subpage
 * when its data array is missing or empty.
 */
export function emptyHtml(text, icon = 'ph ph-circle-dashed') {
    const escapedText = _escapeText(text);
    return `
        <div class="tp-empty">
            <div class="tp-empty-icon"><i class="${icon}"></i></div>
            <div class="tp-empty-text">${escapedText}</div>
        </div>
    `;
}

function _escapeText(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════════════════
// Short hash — used as cache key for per-contact / per-url / per-query
// detail blobs. Truncated to 8 hex chars: collision-safe enough for the
// dozens-of-entries-per-phone scale (see plan/ta-phone-v2.md D2).
// ═══════════════════════════════════════════════════════════════════════
export async function shortHash(text) {
    const buf = new TextEncoder().encode(String(text ?? ''));
    const hashBuf = await crypto.subtle.digest('SHA-1', buf);
    const hex = Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    return hex.slice(0, 8);
}

// ═══════════════════════════════════════════════════════════════════════
// Detail-page LLM wrapper — every per-contact / per-page / per-app
// generation goes through this so the keepAlive bump, JSON repair, and
// failure toast stay in one place. maxTokens defaults to 8000 (smaller
// than the first-time 20000 because detail prompts cover a single
// context — one contact, one page, one app).
// ═══════════════════════════════════════════════════════════════════════
export async function callDetailLLM(systemPrompt, userPrompt, options = {}) {
    tryAutoStartKeepAlive();
    const maxTokens = options.maxTokens || 8000;
    let raw;
    try {
        raw = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens });
    } catch (e) {
        console.error(`${TP_LOG} detail LLM call failed:`, e);
        if (typeof toastr !== 'undefined') {
            toastr.error('生成失败，请稍后再试');
        }
        return null;
    }

    const cleaned = cleanLlmJson(raw);
    try {
        return JSON.parse(cleaned);
    } catch (_e1) {
        try {
            return JSON.parse(repairUnescapedQuotes(cleaned));
        } catch (e2) {
            console.warn(`${TP_LOG} detail JSON parse failed:`, e2.message);
            console.warn(`${TP_LOG} raw detail LLM response:`, raw);
            if (typeof toastr !== 'undefined') {
                toastr.error('生成内容格式有误，请再试一次');
            }
            return null;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Navigation stack — backs the multi-layer back button.
//
// Layering model: home is the bottom. Each time we open a deeper page
// (sub-page list, then detail) we push the *previous* page's restore
// function. When phone-app-back fires, we pop one entry and invoke it;
// when the stack is empty we let phoneController's default close fire
// (so home → back closes the app, matching the original behavior).
//
// Only one global listener is installed (idempotent). Subpages don't
// touch the stack directly — they call pushNav / popNav through the
// helpers exposed here.
// ═══════════════════════════════════════════════════════════════════════
let _navStack = [];
let _backListenerInstalled = false;

export function installBackHandler() {
    if (_backListenerInstalled) return;
    window.addEventListener('phone-app-back', _onPhoneAppBack);
    _backListenerInstalled = true;
}

function _onPhoneAppBack(e) {
    if (_navStack.length === 0) {
        // Let phoneController close the viewport.
        return;
    }
    e.preventDefault();
    const restore = _navStack.pop();
    try {
        restore?.();
    } catch (err) {
        console.error(`${TP_LOG} navStack restore failed:`, err);
    }
}

export function pushNav(restoreFn) {
    if (typeof restoreFn === 'function') _navStack.push(restoreFn);
}

export function popNav() {
    return _navStack.pop();
}

export function clearNav() {
    _navStack = [];
}

export function navDepth() {
    return _navStack.length;
}

// ═══════════════════════════════════════════════════════════════════════
// Loading page (peeking-at-her-phone carousel) — used by the initial
// generation AND by Phase 3.5 broad refresh. Same visual treatment so
// every "she's loading something" moment feels consistent.
//
// Optional `backRestoreFn` makes the loading page bounce back to the
// caller's previous view if the user hits the back button mid-LLM. The
// dismissLoading() call after the LLM resolves cleanly pops the same
// entry off the nav stack so the restore never fires.
// ═══════════════════════════════════════════════════════════════════════

const LOADING_LINES = [
    '正在偷偷打开你对象的相册……',
    '你对象写了一些只有自己会看的话……',
    '翻你对象的聊天收藏夹中，别被发现',
    '正在查看你对象最近搜过的关键词（小心，内容可能很那个）',
    '你对象的备忘录马上就加载完毕啦',
    '正在调用你对象的小秘密……',
    '此手机的电量是100%，准备好进行一个大偷看了吗',
    '你对象和别人的对话快加载完了……你真的要看？',
    '你的队友正在逛街……',
    '发电机进度……0/5……',
    '巴布正在守尸中……',
    '不知道啊，我们黎明杀机是一款乙女游戏',
    '今天你拉屎了吗？',
    '写代码好累啊，不如打一打黎明杀机这个样子',
    '哎！美国！唉！资本！唉！梦女！',
    '路人您好！Lets 纵横！',
    '我真的按了！',
    '冷知识：金针菇和驴一起食用是有毒的',
];

const LOADING_INTERVAL_MS = 4000;
const DEFAULT_LOADING_HINT = '请稍等片刻刻刻刻刻刻刻……';

let _loadingTimer = null;
// Token marking "loading page is still the live view." Cleared either
// by dismissLoading() (LLM finished) or by the user pressing back (the
// nav-pushed restore wrapper clears it before delegating).
let _loadingActiveToken = null;

// Shuffle-bag state for the carousel. Each round shuffles all lines and
// consumes them one by one so every line appears once before any repeats.
let _loadingQueue = [];
let _lastLoadingLine = null;

function _shuffled(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function _nextLoadingLine() {
    if (_loadingQueue.length === 0) {
        _loadingQueue = _shuffled(LOADING_LINES);
        // Don't let a new round start with the same line the previous
        // round ended on — would feel like a stutter.
        if (_loadingQueue.length > 1 && _loadingQueue[0] === _lastLoadingLine) {
            [_loadingQueue[0], _loadingQueue[1]] = [_loadingQueue[1], _loadingQueue[0]];
        }
    }
    const line = _loadingQueue.shift();
    _lastLoadingLine = line;
    return line;
}

/**
 * Show the standard peek-style loading page in the phone viewport.
 *
 * @param {string} titleText - title-bar text (escaped internally)
 * @param {object} [options]
 * @param {string} [options.hintText] - small hint line under the carousel
 * @param {(() => void) | null} [options.backRestoreFn] - if provided, the
 *        back button while loading bounces back to this view (typically
 *        the caller's sub-page list). If omitted, the loading page does
 *        not touch the nav stack — pressing back will fall through to
 *        whatever is already on the stack.
 */
export function showLoadingPage(titleText, options = {}) {
    const { hintText = DEFAULT_LOADING_HINT, backRestoreFn = null } = options;
    const title = `<span class="tp-title">${_escapeText(titleText || '')}</span>`;
    const html = `
        <div class="tp-loading-page tp-fade-in" id="tp_loading_page">
            <div class="tp-loading-card">
                <div class="tp-loading-spinner"></div>
                <div class="tp-loading-line" id="tp_loading_line">${_escapeText(_nextLoadingLine())}</div>
                <div class="tp-loading-hint">${_escapeText(hintText)}</div>
            </div>
        </div>
    `;

    const token = {};
    _loadingActiveToken = token;

    if (typeof backRestoreFn === 'function') {
        pushNav(() => {
            // User pressed back during the LLM call. Clear our token
            // before delegating so a late dismissLoading() from the
            // LLM-resolved branch doesn't try to popNav an unrelated entry.
            if (_loadingActiveToken === token) _loadingActiveToken = null;
            stopLoadingCarousel();
            backRestoreFn();
        });
    }

    openAppInViewport(title, html, () => {
        _startLoadingCarousel();
    });
}

/**
 * Tear down the loading page after the caller's LLM call resolves.
 * Stops the carousel timer and, if the back-restore entry from
 * showLoadingPage is still on top of the nav stack, pops it off so the
 * user's next back press lands on the right view.
 */
export function dismissLoading({ poppedBackEntry = true } = {}) {
    const wasActive = _loadingActiveToken;
    _loadingActiveToken = null;
    stopLoadingCarousel();
    // Only pop if (a) we were the active loading owner AND (b) the
    // caller actually pushed a back-restore entry. The initial-generation
    // flow doesn't push, so it would otherwise pop an unrelated entry.
    if (wasActive && poppedBackEntry) popNav();
}

function _startLoadingCarousel() {
    stopLoadingCarousel();
    _loadingTimer = setInterval(() => {
        const el = document.getElementById('tp_loading_line');
        if (!el) return;
        const next = _nextLoadingLine();
        el.classList.add('tp-fade-out');
        setTimeout(() => {
            const live = document.getElementById('tp_loading_line');
            if (!live) return;
            live.textContent = next;
            live.classList.remove('tp-fade-out');
        }, 200);
    }, LOADING_INTERVAL_MS);
}

export function stopLoadingCarousel() {
    if (_loadingTimer) {
        clearInterval(_loadingTimer);
        _loadingTimer = null;
    }
}

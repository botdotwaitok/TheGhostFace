// modules/phone/chat/chatVisibility.js — "手动调节可见消息" sub-page.
// Phase 4 redesign: floor-range addressing. The user picks a [from, to] floor
// interval and either hides that slice from the prompt or restores it to
// prompt-visibility. Replaces the older "fold the oldest N" slider, which
// couldn't target middle ranges and silently shifted meaning every time a
// new message arrived.
//
// The "清除全部已隐藏标记" button at the bottom is the safety net for both
// rolling-summary screw-ups and user mistakes in the range inputs.

import { openAppInViewport } from '../phoneController.js';
import { openChatSettingsPage } from './chatSettings.js';
import {
    loadChatHistory,
    markRangeAsSummarized,
    unmarkRangeAsSummarized,
    clearAllSummarizedMarks,
    ensureChatHistoryReady,
} from './chatStorage.js';

const LOG = '[ChatVisibility]';

let _backHandler = null;

// Snapshot of the full history at render time, refreshed each _render so
// background auto-summarize firings stay in sync with the meta display.
let _history = [];
let _floorMin = null;
let _floorMax = null;

export function openChatVisibilityPage() {
    const titleHtml = `<span class="chat-settings-nav-title">手动调节可见消息</span>`;
    const html = _buildPage();

    openAppInViewport(titleHtml, html, async () => {
        try {
            await ensureChatHistoryReady();
        } catch (e) {
            console.warn(LOG, 'ensureChatHistoryReady failed (rendering anyway):', e?.message);
        }
        _render();
        _bindEvents();
        _registerBackHandler();
    });
}

function _buildPage() {
    return `
    <div class="chat-settings-page" id="chat_visibility_root">
        <div class="chat-settings-scroll">
            <div class="chat-settings-section chat-hide-range-section">
                <div class="chat-summary-section-title">手动调节可见消息</div>
                <div class="chat-summary-section-hint">
                    用「楼层号」精确选择要隐藏 / 恢复可见的消息区间。被隐藏的消息仍然显示在聊天里，
                    只是不再进入下一次 LLM 调用。
                </div>

                <div class="chat-hide-range-card" id="chat_visibility_card">
                    <div class="chat-hide-range-meta">
                        <span>共 <strong id="chat_visibility_total">—</strong> 条</span>
                        <span>已隐藏消息 <strong id="chat_visibility_done">—</strong></span>
                        <span>可见消息数量 <strong id="chat_visibility_active">—</strong></span>
                        <span>楼层 <strong id="chat_visibility_floor_extent">—</strong></span>
                    </div>

                    <div class="chat-hide-range-segments" id="chat_visibility_segments_row">
                        <span class="chat-hide-range-segments-label">已隐藏区段</span>
                        <span class="chat-hide-range-segments-list" id="chat_visibility_segments_list">无</span>
                    </div>

                    <div class="chat-hide-range-input-row">
                        <label class="chat-hide-range-input-cell">
                            <span class="chat-hide-range-input-label">从</span>
                            <input
                                type="number"
                                class="chat-hide-range-input"
                                id="chat_visibility_from"
                                placeholder="#?"
                                inputmode="numeric"
                                step="1"
                                min="0">
                        </label>
                        <span class="chat-hide-range-input-sep">到</span>
                        <label class="chat-hide-range-input-cell">
                            <input
                                type="number"
                                class="chat-hide-range-input"
                                id="chat_visibility_to"
                                placeholder="#?"
                                inputmode="numeric"
                                step="1"
                                min="0">
                        </label>
                    </div>

                    <div class="chat-hide-range-input-hint" id="chat_visibility_input_hint">
                        我真的很想在这塞黎明杀机彩蛋来着。
                    </div>

                    <div class="chat-hide-range-action-row">
                        <button class="chat-hide-range-action-btn hide" id="chat_visibility_hide_btn" disabled>
                            <span>隐藏楼层</span>
                        </button>
                        <button class="chat-hide-range-action-btn restore" id="chat_visibility_restore_btn" disabled>
                            <span>取消隐藏</span>
                        </button>
                    </div>

                    <div class="chat-hide-range-reset-row">
                        <button class="chat-hide-range-reset-btn" id="chat_visibility_clear_btn">
                            <span>全部楼层恢复可见</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

function _render() {
    _history = loadChatHistory();
    const total = _history.length;
    const summarizedCount = _history.filter(m => m.summarized).length;
    const activeCount = total - summarizedCount;

    _setText('chat_visibility_total', String(total));
    _setText('chat_visibility_done', String(summarizedCount));
    _setText('chat_visibility_active', String(activeCount));

    // Pre-migration messages may lack `floor` entirely — those simply don't
    // participate in the extent / segments display. The extent reads "—" in
    // that case so the user can tell something is off instead of seeing a
    // silent "0 - 0".
    const extremes = _computeFloorExtremes(_history);
    _floorMin = extremes.min;
    _floorMax = extremes.max;
    const extentText = (_floorMin === null || _floorMax === null)
        ? '—'
        : `#${_floorMin} - #${_floorMax}`;
    _setText('chat_visibility_floor_extent', extentText);

    // Re-apply placeholders so the user can see the legal range without
    // typing — purely a hint, the actual bounds check lives in the action
    // handlers.
    const fromInput = document.getElementById('chat_visibility_from');
    const toInput = document.getElementById('chat_visibility_to');
    if (fromInput && _floorMin !== null) {
        fromInput.placeholder = `#${_floorMin}`;
        fromInput.min = String(_floorMin);
        fromInput.max = String(_floorMax);
    }
    if (toInput && _floorMax !== null) {
        toInput.placeholder = `#${_floorMax}`;
        toInput.min = String(_floorMin);
        toInput.max = String(_floorMax);
    }

    _renderSegments();
    _refreshActionButtons();
}

// Group adjacent summarized messages into [from, to] runs using their floor
// numbers. Adjacency follows the live-history order — a single visible (i.e.
// non-summarized) message between two hidden spans breaks the run. This
// matches the user's mental model: each segment is one contiguous "gap" in
// what the LLM can see.
function _computeHiddenSegments(history) {
    if (!Array.isArray(history) || history.length === 0) return [];
    const segs = [];
    let curr = null;
    for (const msg of history) {
        if (typeof msg?.floor !== 'number') continue;
        if (msg.summarized) {
            if (!curr) curr = { from: msg.floor, to: msg.floor };
            else curr.to = Math.max(curr.to, msg.floor);
        } else {
            if (curr) { segs.push(curr); curr = null; }
        }
    }
    if (curr) segs.push(curr);
    return segs;
}

function _computeFloorExtremes(history) {
    let min = null, max = null;
    for (const msg of history) {
        if (typeof msg?.floor !== 'number') continue;
        if (min === null || msg.floor < min) min = msg.floor;
        if (max === null || msg.floor > max) max = msg.floor;
    }
    return { min, max };
}

function _formatSegment(seg) {
    return seg.from === seg.to ? `#${seg.from}` : `#${seg.from}-#${seg.to}`;
}

function _renderSegments() {
    const slot = document.getElementById('chat_visibility_segments_list');
    if (!slot) return;
    const segs = _computeHiddenSegments(_history);
    if (segs.length === 0) {
        slot.textContent = '无';
        slot.classList.remove('has-segments');
        return;
    }
    slot.classList.add('has-segments');
    // Each segment renders as its own pill so the user can scan them quickly;
    // they're rendered as buttons so tapping fills the from/to inputs — quick
    // path for "I want to undo this specific segment".
    slot.innerHTML = segs.map(seg => `
        <button type="button"
                class="chat-hide-range-segment-pill"
                data-action="fill-range"
                data-from="${seg.from}"
                data-to="${seg.to}">
            ${_formatSegment(seg)}
        </button>
    `).join('');
}

function _readRange() {
    const fromEl = document.getElementById('chat_visibility_from');
    const toEl = document.getElementById('chat_visibility_to');
    if (!fromEl || !toEl) return null;
    const fromRaw = fromEl.value.trim();
    const toRaw = toEl.value.trim();
    if (fromRaw === '' || toRaw === '') return null;
    const from = parseInt(fromRaw, 10);
    const to = parseInt(toRaw, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    return { from, to };
}

function _refreshActionButtons() {
    const range = _readRange();
    const hideBtn = document.getElementById('chat_visibility_hide_btn');
    const restoreBtn = document.getElementById('chat_visibility_restore_btn');
    const hintEl = document.getElementById('chat_visibility_input_hint');

    const valid = range && range.from <= range.to;
    if (hideBtn) hideBtn.disabled = !valid;
    if (restoreBtn) restoreBtn.disabled = !valid;

    if (!hintEl) return;
    if (!range) {
        hintEl.textContent = '我真的很想在这塞黎明杀机彩蛋来着。';
        hintEl.classList.remove('error');
        return;
    }
    if (range.from > range.to) {
        hintEl.textContent = '「从」必须 ≤「到」。';
        hintEl.classList.add('error');
        return;
    }
    // Soft out-of-range warning — we don't block the action (the storage layer
    // skips floors that don't exist anyway), but flagging it makes typos less
    // confusing when "0 条被处理" comes back.
    if (_floorMin !== null && _floorMax !== null
        && (range.to < _floorMin || range.from > _floorMax)) {
        hintEl.textContent = `当前楼层范围是 #${_floorMin} - #${_floorMax}，输入的区间在外面，操作可能不影响任何消息。`;
        hintEl.classList.add('error');
        return;
    }
    const span = range.to - range.from + 1;
    hintEl.textContent = `区间 #${range.from} - #${range.to}（覆盖 ${span} 个楼层号）。点对应按钮执行。`;
    hintEl.classList.remove('error');
}

function _bindEvents() {
    const root = document.getElementById('chat_visibility_root');
    if (!root) return;

    const fromInput = document.getElementById('chat_visibility_from');
    const toInput = document.getElementById('chat_visibility_to');
    if (fromInput) fromInput.addEventListener('input', _refreshActionButtons);
    if (toInput) toInput.addEventListener('input', _refreshActionButtons);

    const hideBtn = document.getElementById('chat_visibility_hide_btn');
    if (hideBtn) hideBtn.addEventListener('click', _onApplyHide);

    const restoreBtn = document.getElementById('chat_visibility_restore_btn');
    if (restoreBtn) restoreBtn.addEventListener('click', _onApplyRestore);

    const clearBtn = document.getElementById('chat_visibility_clear_btn');
    if (clearBtn) clearBtn.addEventListener('click', _onClearAll);

    // Delegated handler for segment-pill quick-fill.
    root.addEventListener('click', (e) => {
        const pill = e.target.closest('[data-action="fill-range"]');
        if (!pill) return;
        const from = parseInt(pill.dataset.from, 10);
        const to = parseInt(pill.dataset.to, 10);
        if (!Number.isFinite(from) || !Number.isFinite(to)) return;
        if (fromInput) fromInput.value = String(from);
        if (toInput) toInput.value = String(to);
        _refreshActionButtons();
    });
}

async function _onApplyHide() {
    const range = _readRange();
    if (!range || range.from > range.to) return;
    const span = range.to - range.from + 1;
    if (!confirm(
        `将楼层 #${range.from} - #${range.to}（共 ${span} 个楼层号）标记为「已隐藏」，从 prompt 中折叠出去。\n\n` +
        `它们仍然会显示在聊天里，只是不再进入下一次 LLM 调用。\n` +
        `要恢复可见，对同一范围点「恢复此范围可见」即可。\n\n` +
        `继续吗？`
    )) return;
    try {
        const marked = await markRangeAsSummarized(range.from, range.to);
        if (typeof toastr !== 'undefined') {
            if (marked > 0) {
                toastr.success(`已隐藏 ${marked} 条`, '', { timeOut: 1800 });
            } else {
                toastr.info('范围内没有需要隐藏的消息', '', { timeOut: 2000 });
            }
        }
        console.log(LOG, `manual hide range [${range.from},${range.to}]: marked ${marked}`);
        _render();
    } catch (e) {
        console.warn(LOG, 'markRangeAsSummarized failed:', e);
        if (typeof toastr !== 'undefined') toastr.error('隐藏失败');
    }
}

async function _onApplyRestore() {
    const range = _readRange();
    if (!range || range.from > range.to) return;
    const span = range.to - range.from + 1;
    if (!confirm(
        `将楼层 #${range.from} - #${range.to}（共 ${span} 个楼层号）的「已隐藏」标记清除。\n\n` +
        `这些消息会重新进入 LLM 的可见范围，再次进入聊天后生效。\n\n` +
        `继续吗？`
    )) return;
    try {
        const restored = await unmarkRangeAsSummarized(range.from, range.to);
        if (typeof toastr !== 'undefined') {
            if (restored > 0) {
                _showPersistentToast(
                    `已恢复 ${restored} 条消息可见（楼层 #${range.from} - #${range.to}）。\n` +
                    `再次进入聊天后即生效。`,
                    '已取消隐藏',
                );
            } else {
                toastr.info('范围内没有需要恢复的消息', '', { timeOut: 2000 });
            }
        }
        console.log(LOG, `manual restore range [${range.from},${range.to}]: restored ${restored}`);
        _render();
    } catch (e) {
        console.warn(LOG, 'unmarkRangeAsSummarized failed:', e);
        if (typeof toastr !== 'undefined') toastr.error('恢复失败');
    }
}

async function _onClearAll() {
    if (!confirm(
        '将恢复所有消息可见。\n\n' +
        '所有被手动隐藏（以及历史上被自动总结折叠）的消息都会重新进入 prompt。\n' +
        '当前总结和历史总结不会受影响——下次自动总结会重新处理它们。\n\n' +
        '继续吗？'
    )) return;
    try {
        const removed = await clearAllSummarizedMarks();
        if (typeof toastr !== 'undefined') {
            toastr.success(`已恢复 ${removed} 条消息可见`, '', { timeOut: 2000 });
        }
        console.log(LOG, `cleared ${removed} summarized marks`);
        _render();
    } catch (e) {
        console.warn(LOG, 'clearAllSummarizedMarks failed:', e);
        if (typeof toastr !== 'undefined') toastr.error('操作失败');
    }
}

// Persistent toastr for prompt-affecting actions (same pattern as
// chatSummaryView._showPersistentToast). Both timeOut and extendedTimeOut
// must be 0 for true stickiness — timeOut alone still lets it fade on
// mouseleave.
function _showPersistentToast(message, title = '已恢复可见') {
    if (typeof toastr === 'undefined') return;
    toastr.success(message, title, {
        timeOut: 0,
        extendedTimeOut: 0,
        closeButton: true,
        tapToDismiss: true,
    });
}

function _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function _registerBackHandler() {
    _unregisterBackHandler();
    _backHandler = (e) => {
        e.preventDefault();
        _unregisterBackHandler();
        openChatSettingsPage();
    };
    window.addEventListener('phone-app-back', _backHandler);
}

function _unregisterBackHandler() {
    if (_backHandler) {
        window.removeEventListener('phone-app-back', _backHandler);
        _backHandler = null;
    }
}

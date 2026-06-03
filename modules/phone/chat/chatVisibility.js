// modules/phone/chat/chatVisibility.js — "手动调节可见消息" sub-page.
// Lets the user fold a prefix of the oldest still-visible phone messages out
// of the prompt without running an LLM summarize cycle, and undo all hide
// marks in one shot. Both live together because they're inverse operations
// over the same `summarized` flag.

import { openAppInViewport } from '../phoneController.js';
import { openChatSettingsPage } from './chatSettings.js';
import {
    loadChatHistory,
    markOldestNAsSummarized,
    estimateMessagePromptCost,
    clearAllSummarizedMarks,
} from './chatStorage.js';

const LOG = '[ChatVisibility]';

let _backHandler = null;

// Snapshot of the full history at render time. The slider readout / apply
// handler resolve against this — refreshed on every _render so an
// autosummarize firing in the background still updates the meta counts.
let _history = [];

export function openChatVisibilityPage() {
    const titleHtml = `<span class="chat-settings-nav-title">手动调节可见消息</span>`;
    const html = _buildPage();

    openAppInViewport(titleHtml, html, () => {
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
                    选择想要隐藏的消息范围。
                </div>
                <div class="chat-hide-range-card" id="chat_visibility_card">
                    <div class="chat-hide-range-meta">
                        <span>共 <strong id="chat_visibility_total">—</strong> 条</span>
                        <span>已隐藏 <strong id="chat_visibility_done">—</strong></span>
                        <span>进 prompt <strong id="chat_visibility_active">—</strong></span>
                    </div>
                    <input
                        type="range"
                        class="chat-hide-range-slider"
                        id="chat_visibility_slider"
                        min="0" max="0" value="0" step="1">
                    <div class="chat-hide-range-readout">
                        <span>本次将隐藏前 <strong id="chat_visibility_n">0</strong> 条</span>
                        <span class="chat-hide-range-token-cell">
                            预估剩余 chat_history ≈
                            <strong id="chat_visibility_tokens">0</strong> tokens
                        </span>
                    </div>
                    <button class="chat-hide-range-apply-btn" id="chat_visibility_apply" disabled>
                        <span>点击隐藏</span>
                    </button>

                    <div class="chat-hide-range-reset-row">
                        <div class="chat-hide-range-reset-hint">
                            下方按钮会把所有「已隐藏」标记清掉，
                            当前总结和历史总结不受影响。
                        </div>
                        <button class="chat-hide-range-reset-btn" id="chat_visibility_clear_btn">
                            <i class="ph ph-arrow-counter-clockwise"></i>
                            <span>清除全部「已隐藏」标记</span>
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

    const slider = document.getElementById('chat_visibility_slider');
    if (!slider) return;

    // Range = count of currently-unsummarized messages. activeCount === 0
    // still sets max=0 so the slider disables cleanly without a DOM gap.
    slider.min = '0';
    slider.max = String(activeCount);
    if (parseInt(slider.value, 10) > activeCount) slider.value = String(activeCount);
    slider.disabled = activeCount === 0;

    _refreshReadout(parseInt(slider.value, 10) || 0);
}

function _refreshReadout(n) {
    _setText('chat_visibility_n', String(n));

    // Tokens after applying: sum prompt-side cost of every currently
    // unsummarized message MINUS the n oldest ones we'd fold off.
    let tokensAfter = 0;
    let costsSeen = 0;
    for (const msg of _history) {
        if (msg.summarized) continue;
        if (costsSeen < n) {
            costsSeen++;
            continue;
        }
        tokensAfter += estimateMessagePromptCost(msg);
    }
    _setText('chat_visibility_tokens', tokensAfter.toLocaleString('en-US'));

    const applyBtn = document.getElementById('chat_visibility_apply');
    if (applyBtn) applyBtn.disabled = n <= 0;
}

function _bindEvents() {
    const slider = document.getElementById('chat_visibility_slider');
    if (slider) {
        slider.addEventListener('input', () => {
            _refreshReadout(parseInt(slider.value, 10) || 0);
        });
    }

    const applyBtn = document.getElementById('chat_visibility_apply');
    if (applyBtn) applyBtn.addEventListener('click', _onApplyHide);

    const clearBtn = document.getElementById('chat_visibility_clear_btn');
    if (clearBtn) clearBtn.addEventListener('click', _onClearAll);
}

async function _onApplyHide() {
    const slider = document.getElementById('chat_visibility_slider');
    if (!slider) return;
    const n = parseInt(slider.value, 10) || 0;
    if (n <= 0) return;
    if (!confirm(
        `将把最旧的 ${n} 条消息标记为「已隐藏」，从 prompt 中折叠出去。\n\n` +
        `它们仍然会显示在聊天里，只是不再进入下一次 LLM 调用。\n` +
        `如需恢复，点同一卡片底部的「清除全部已隐藏标记」。\n\n` +
        `继续吗？`
    )) return;
    try {
        const marked = await markOldestNAsSummarized(n);
        if (typeof toastr !== 'undefined') {
            toastr.success(`已隐藏 ${marked} 条`, '', { timeOut: 1800 });
        }
        console.log(LOG, `manual hide: marked ${marked}`);
        _render();
    } catch (e) {
        console.warn(LOG, 'markOldestNAsSummarized failed:', e);
        if (typeof toastr !== 'undefined') toastr.error('隐藏失败');
    }
}

async function _onClearAll() {
    if (!confirm(
        '将清除所有消息的「已隐藏」标记。\n\n' +
        '所有被手动隐藏（以及历史上被自动总结折叠）的消息都会重新进入 prompt。\n' +
        '当前总结和历史总结不会受影响——下次自动总结会重新处理它们。\n\n' +
        '继续吗？'
    )) return;
    try {
        const removed = await clearAllSummarizedMarks();
        if (typeof toastr !== 'undefined') {
            toastr.success(`已清除 ${removed} 条消息的标记`, '', { timeOut: 2000 });
        }
        console.log(LOG, `cleared ${removed} summarized marks`);
        _render();
    } catch (e) {
        console.warn(LOG, 'clearAllSummarizedMarks failed:', e);
        if (typeof toastr !== 'undefined') toastr.error('操作失败');
    }
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

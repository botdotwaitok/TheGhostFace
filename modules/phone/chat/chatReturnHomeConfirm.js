// modules/phone/chat/chatReturnHomeConfirm.js — "回家总结确认" full-screen sub-page.
//
// Sits between summary GENERATION and the irreversible commit (send to ST main
// chat + advance home marker + archive + write memory fragments to world book).
// The user reviews / edits the Ghost Face summary, then 确认发送 commits, or
// 取消 discards the whole 回家 run — nothing lands. The commit / discard logic
// lives in chatInventory.js (handleReturnHome's two-phase split); this page only
// collects the edited text and routes it through onConfirm / onCancel.
//
// Only the 压缩总结 (summary) sync mode routes through here. 原文灌入 (raw) still
// sends instantly without a confirm step.

import { openAppInViewport } from '../phoneController.js';
import { escHtml } from './chatApp.js';

let _backHandler = null;
// Holds the in-flight confirm context so the button / back handlers can reach
// the original text and the caller's callbacks without threading them through.
let _ctx = null; // { initialText, msgCount, onConfirm, onCancel }

/**
 * Open the full-screen 回家总结 confirm / edit page.
 * @param {object} opts
 * @param {string} opts.initialText  Ghost Face summary to pre-fill the editor with.
 * @param {number} [opts.msgCount]   Number of phone messages this summary folded (for the hint line).
 * @param {(editedText: string) => void} opts.onConfirm  Called with the trimmed edited text on 确认发送.
 * @param {() => void} opts.onCancel  Called when the user discards the run (取消 / back).
 */
export function openReturnHomeConfirmPage({ initialText, msgCount, onConfirm, onCancel }) {
    _ctx = {
        initialText: initialText || '',
        msgCount: Number.isFinite(msgCount) ? msgCount : 0,
        onConfirm,
        onCancel,
    };

    const titleHtml = `<span class="chat-settings-nav-title">回家总结确认</span>`;
    const hint = _ctx.msgCount > 0
        ? `鬼面已浓缩 ${_ctx.msgCount} 条短信。确认无误后会发送给线下场景；可直接编辑后再发。`
        : `确认无误后会发送给线下场景；可直接编辑后再发。`;

    const html = `
    <div class="chat-summary-edit-page chat-rh-confirm-page" id="chat_rh_confirm_root">
        <div class="chat-rh-confirm-hint">${escHtml(hint)}</div>
        <textarea
            class="chat-summary-edit-textarea"
            id="chat_rh_confirm_textarea"
            placeholder="鬼面生成的回家总结会显示在这里，可编辑后再发送给线下场景。"
            spellcheck="false"
        ></textarea>
    </div>`;

    const actionsHtml = `
        <button class="chat-summary-edit-action cancel" id="chat_rh_confirm_cancel">取消</button>
        <button class="chat-summary-edit-action save" id="chat_rh_confirm_send">确认发送</button>
    `;

    openAppInViewport(titleHtml, html, () => {
        const ta = document.getElementById('chat_rh_confirm_textarea');
        if (ta) {
            ta.value = _ctx.initialText;
            // Caret to the top so the user reads from the beginning, not the tail.
            ta.setSelectionRange(0, 0);
            ta.scrollTop = 0;
        }
        document.getElementById('chat_rh_confirm_send')?.addEventListener('click', _onSend);
        document.getElementById('chat_rh_confirm_cancel')?.addEventListener('click', _onCancel);
        _registerBackHandler();
    }, actionsHtml);
}

function _onSend() {
    const ta = document.getElementById('chat_rh_confirm_textarea');
    const text = ta ? ta.value.trim() : '';
    if (!text) {
        if (typeof toastr !== 'undefined') toastr.warning('总结内容为空，无法发送');
        return;
    }
    const cb = _ctx?.onConfirm;
    _teardown();
    if (typeof cb === 'function') cb(text);
}

function _onCancel() {
    const ta = document.getElementById('chat_rh_confirm_textarea');
    const current = ta ? ta.value.trim() : '';
    const original = (_ctx?.initialText || '').trim();
    const msg = current !== original
        ? '放弃本次回家？\n\n你的修改不会保存，鬼面的总结也不会发送给线下场景，本次聊天保持原样。'
        : '放弃本次回家？\n\n鬼面的总结不会发送给线下场景，本次聊天保持原样。';
    if (!confirm(msg)) return;
    const cb = _ctx?.onCancel;
    _teardown();
    if (typeof cb === 'function') cb();
}

function _registerBackHandler() {
    _unregisterBackHandler();
    _backHandler = (e) => {
        e.preventDefault();
        _onCancel();
    };
    window.addEventListener('phone-app-back', _backHandler);
}

function _unregisterBackHandler() {
    if (_backHandler) {
        window.removeEventListener('phone-app-back', _backHandler);
        _backHandler = null;
    }
}

function _teardown() {
    _unregisterBackHandler();
    _ctx = null;
}

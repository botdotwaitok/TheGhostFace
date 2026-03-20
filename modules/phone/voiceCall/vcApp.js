// modules/phone/voiceCall/vcApp.js — Voice Call app (phone home screen entry)
// Shows call history list and provides a dial button to start new calls.

import { openAppInViewport } from '../phoneController.js';
import { openVoiceCall } from './voiceCallUI.js';
import { loadCallLogs, deleteCallLog } from './vcStorage.js';
import { getPhoneCharInfo } from '../phoneContext.js';
import { saveMetadataDebounced } from '../../../../../../extensions.js';
import { chat_metadata } from '../../../../../../../script.js';
import { escapeHtml } from '../utils/helpers.js';

const LOG_PREFIX = '[VcApp]';

// ═══════════════════════════════════════════════════════════════════════
// Entry Point
// ═══════════════════════════════════════════════════════════════════════

/**
 * Open the Voice Call app in the phone viewport.
 * Displays call history with a floating dial button.
 */
export function openVcApp() {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '联系人';

    const html = `
    <div class="vc-app-container">
        <div id="vc_call_list" class="vc-call-list">
            <!-- Call history rendered here -->
        </div>
        <button id="vc_dial_fab" class="vc-dial-fab" title="拨打电话"><i class="fa-solid fa-phone"></i></button>
    </div>
    `;

    const actionsHtml = `
        <button id="vc_clear_all_btn" class="phone-header-action-btn" title="清空通话记录" style="background: none; border: none; color: #ff3b30; font-size: 14px; cursor: pointer; padding: 4px 8px;">
            清空
        </button>
    `;

    openAppInViewport('电话', html, () => {
        _renderCallList();
        _bindEvents();
    }, actionsHtml);
}

// ═══════════════════════════════════════════════════════════════════════
// Call List Rendering
// ═══════════════════════════════════════════════════════════════════════

function _renderCallList() {
    const container = document.getElementById('vc_call_list');
    if (!container) return;

    const logs = loadCallLogs();
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '联系人';

    if (logs.length === 0) {
        container.innerHTML = `
            <div class="vc-empty-state">
                <i class="fa-solid fa-phone" style="font-size: 48px; color: rgba(0,0,0,0.08); margin-bottom: 16px;"></i>
                <div style="font-size: 17px; font-weight: 600; color: #1c1c1e; margin-bottom: 6px;">暂无通话记录</div>
                <div style="font-size: 14px; color: #8e8e93;">点击下方按钮拨打电话</div>
            </div>
        `;
        return;
    }

    const listHtml = logs.map(log => {
        const startDate = new Date(log.startTime);
        const dateStr = _formatCallDate(startDate);
        const timeStr = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const durationStr = _formatDuration(log.duration || 0);
        const messageCount = log.messages?.length || 0;
        const summaryPreview = log.summary
            ? escapeHtml(log.summary.substring(0, 80)) + (log.summary.length > 80 ? '...' : '')
            : `${messageCount} 条对话`;

        return `
        <div class="vc-call-item" data-call-id="${log.id}">
            <div class="vc-call-item-main">
                <div class="vc-call-item-avatar">
                    <i class="fa-solid fa-phone"></i>
                </div>
                <div class="vc-call-item-info">
                    <div class="vc-call-item-name">${escapeHtml(charName)}</div>
                    <div class="vc-call-item-meta">
                        <span class="vc-call-item-date">${dateStr} ${timeStr}</span>
                        <span class="vc-call-item-duration">${durationStr}</span>
                    </div>
                    <div class="vc-call-item-summary">${summaryPreview}</div>
                </div>
                <div class="vc-call-item-actions">
                    <button class="vc-call-item-delete" data-delete-id="${log.id}" title="删除">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                    <i class="fa-solid fa-chevron-right" style="color: #c7c7cc; font-size: 12px;"></i>
                </div>
            </div>
        </div>
        `;
    }).join('');

    container.innerHTML = listHtml;

    // Bind click events
    container.querySelectorAll('.vc-call-item').forEach(el => {
        el.addEventListener('click', (e) => {
            // Don't open detail if clicking delete button
            if (e.target.closest('.vc-call-item-delete')) return;
            const callId = el.dataset.callId;
            _openCallDetail(callId);
        });
    });

    // Bind delete buttons
    container.querySelectorAll('.vc-call-item-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.deleteId;
            if (confirm('确定删除这条通话记录？')) {
                deleteCallLog(id);
                _renderCallList();
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Call Detail — Transcript View
// ═══════════════════════════════════════════════════════════════════════

function _openCallDetail(callId) {
    const logs = loadCallLogs();
    const log = logs.find(l => l.id === callId);
    if (!log) return;

    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '联系人';
    const startDate = new Date(log.startTime);
    const dateStr = startDate.toLocaleDateString('zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric',
    });
    const timeStr = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const durationStr = _formatDuration(log.duration || 0);

    // Build transcript bubbles
    const transcriptHtml = (log.messages || []).map(msg => {
        const isUser = msg.role === 'user';
        const bubbleClass = isUser ? 'user' : 'char';
        const msgTime = new Date(msg.timestamp).toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        return `
            <div class="vc-transcript-bubble ${bubbleClass}">
                <div class="vc-transcript-text">${escapeHtml(msg.content)}</div>
                <div class="vc-transcript-time">${msgTime}</div>
            </div>
        `;
    }).join('');

    const summaryBlock = log.summary
        ? `<div class="vc-detail-summary">
               <div class="vc-detail-summary-title">通话概要</div>
               <div class="vc-detail-summary-text">${escapeHtml(log.summary)}</div>
           </div>`
        : '';

    const html = `
    <div class="vc-detail-container">
        <div class="vc-detail-header">
            <div class="vc-detail-header-name">${escapeHtml(charName)}</div>
            <div class="vc-detail-header-meta">${dateStr} ${timeStr} · ${durationStr}</div>
        </div>

        ${summaryBlock}

        <div class="vc-detail-transcript">
            ${transcriptHtml || '<div style="text-align: center; color: #8e8e93; padding: 20px;">无通话内容</div>'}
        </div>
    </div>
    `;

    // Render inline — replace the viewport body content, not the whole app
    const body = document.getElementById('phone_app_viewport_body');
    const titleEl = document.getElementById('phone_app_viewport_title');
    const actionsEl = document.getElementById('phone_app_viewport_actions');
    if (!body) return;

    // Hide FAB when viewing detail
    const fab = document.getElementById('vc_dial_fab');
    if (fab) fab.style.display = 'none';

    body.innerHTML = html;
    if (titleEl) titleEl.textContent = '通话详情';
    if (actionsEl) actionsEl.innerHTML = '';

    // Intercept back button to return to call list instead of home screen
    const _backHandler = (e) => {
        e.preventDefault();
        window.removeEventListener('phone-app-back', _backHandler);
        openVcApp(); // Re-open the call list
    };
    window.addEventListener('phone-app-back', _backHandler);
}



function _bindEvents() {
    // Dial FAB
    const dialBtn = document.getElementById('vc_dial_fab');
    if (dialBtn) {
        dialBtn.addEventListener('click', () => {
            openVoiceCall();
        });
    }

    // Clear all button
    const clearBtn = document.getElementById('vc_clear_all_btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            const logs = loadCallLogs();
            if (logs.length === 0) return;
            if (confirm(`确定清空全部 ${logs.length} 条通话记录？`)) {
                if (chat_metadata) {
                    chat_metadata['gf_voiceCallLogs'] = [];
                    saveMetadataDebounced();
                }
                _renderCallList();
            }
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Format call duration in human-readable form.
 * @param {number} seconds
 * @returns {string}
 */
function _formatDuration(seconds) {
    if (seconds < 60) return `${seconds}秒`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m < 60) return s > 0 ? `${m}分${s}秒` : `${m}分钟`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm > 0 ? `${h}小时${rm}分` : `${h}小时`;
}

/**
 * Format call date relative to today.
 * @param {Date} date
 * @returns {string}
 */
function _formatCallDate(date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return '今天';
    if (date.toDateString() === yesterday.toDateString()) return '昨天';

    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

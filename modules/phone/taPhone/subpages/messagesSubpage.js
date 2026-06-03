// modules/phone/taPhone/subpages/messagesSubpage.js — Messages (消息) sub-page.
// Phase 1: list-only render extracted verbatim from taPhoneApp.js.
// Phase 2: contact list rows are clickable → on-demand LLM generates an
// iMessage-style conversation flow for that contact, cached per chat.

import { openAppInViewport } from '../../phoneController.js';
import {
    getPhoneCharInfo,
    getPhoneUserName,
    getPhoneUserPersona,
    getPhoneRecentChat,
    getPhoneWorldBookContext,
} from '../../phoneContext.js';
import { escapeHtml } from '../../utils/helpers.js';
import {
    formatTimestamp,
    emptyHtml,
    callDetailLLM,
    pushNav,
    TP_LOG,
} from '../taPhoneShared.js';
import {
    getMessageDetail,
    appendMessageDetail,
    appendMessagesBatch,
    loadData,
} from '../taPhoneStore.js';
import {
    buildMessageDetailIncrementalPrompt,
    buildMessagesBatchPrompt,
} from '../taPhonePromptBuilder.js';

export const MESSAGES_TITLE = '消息';
export const MESSAGES_EMPTY_ICON = 'ph ph-chat-circle-text';

const CONTACT_TYPE_LABELS = {
    family: '家人',
    friend: '朋友',
    colleague: '同事',
    classmate: '同学',
    service: '服务',
    spam: '垃圾信息',
    scam: '诈骗信息',
    group: '群聊',
};

const TIME_DIVIDER_GAP_MS = 60 * 60 * 1000; // 60 min silence → insert time divider

// Cancel token for the in-flight detail open. If the user backs out of
// the loading screen, the late-returning LLM result drops on the floor
// instead of stomping the page they navigated to.
let _activeDetailToken = null;

// ═══════════════════════════════════════════════════════════════════════
// List view (Phase 1, with Phase 2 click target on each row)
// ═══════════════════════════════════════════════════════════════════════

export function renderMessagesList(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return emptyHtml('她还没有任何消息', MESSAGES_EMPTY_ICON);
    }
    const items = messages.map((m, i) => {
        const name = (m.contactName || '').trim() || '未命名联系人';
        const typeLabel = CONTACT_TYPE_LABELS[m.contactType] || '';
        const preview = (m.lastMessage || '').trim();
        const ts = formatTimestamp(m.timestamp);
        const unread = Number.isFinite(m.unread) && m.unread > 0
            ? `<span class="tp-msg-unread">${m.unread > 99 ? '99+' : m.unread}</span>`
            : '';
        const avatar = name.slice(0, 1);
        return `
            <div class="tp-msg-row" data-msg-index="${i}" role="button" tabindex="0">
                <div class="tp-msg-avatar">${escapeHtml(avatar)}</div>
                <div class="tp-msg-main">
                    <div class="tp-msg-header">
                        <span class="tp-msg-name">${escapeHtml(name)}</span>
                        ${typeLabel ? `<span class="tp-msg-tag">${escapeHtml(typeLabel)}</span>` : ''}
                    </div>
                    <div class="tp-msg-preview">${escapeHtml(preview)}</div>
                </div>
                <div class="tp-msg-side">
                    <div class="tp-msg-time">${escapeHtml(ts)}</div>
                    ${unread}
                </div>
            </div>
        `;
    }).join('');
    return `<div class="tp-msg-list">${items}</div>`;
}

/**
 * Hook click handlers onto the messages list rows. Called by taPhoneApp
 * right after the sub-page mounts. The `restoreSelf` callback re-renders
 * the messages list — used by the detail page's back button to return here.
 *
 * @param {HTMLElement} root - container that holds .tp-msg-row elements
 * @param {Array} messages - the same array used by renderMessagesList
 * @param {() => void} restoreSelf - re-render the list (e.g. tabbing back here)
 */
export function bindMessagesListEvents(root, messages, restoreSelf) {
    if (!root || !Array.isArray(messages)) return;
    root.querySelectorAll('.tp-msg-row').forEach(row => {
        row.addEventListener('click', () => {
            const idx = Number(row.dataset.msgIndex);
            const contact = messages[idx];
            if (!contact) return;
            pushNav(restoreSelf);
            openMessageDetail(contact);
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Detail page — iMessage-style conversation flow
// ═══════════════════════════════════════════════════════════════════════

/**
 * Open the per-contact conversation detail page. Cache hit renders the
 * stored conversation; cache miss shows the empty prompt card pointing
 * to the list's top ⟳ button (Phase 3.5 — no more per-tap LLM calls).
 * @param {object} contact - { contactName, contactType, lastMessage, timestamp, ... }
 */
export async function openMessageDetail(contact) {
    const contactName = (contact?.contactName || '').trim() || '未命名联系人';

    let cached;
    try {
        cached = await getMessageDetail(contactName);
    } catch (e) {
        console.warn(`${TP_LOG} getMessageDetail failed:`, e);
        cached = null;
    }

    if (cached && Array.isArray(cached.conversation) && cached.conversation.length > 0) {
        _activeDetailToken = { contactName };
        _renderDetailPage(contact, cached.conversation);
        return;
    }

    _activeDetailToken = { contactName };
    _renderEmptyDetailPage(contact);
}

/**
 * Called by taPhoneApp / messages subpage list when the user navigates
 * away from the detail flow (back button, sub-page re-render, etc.).
 * Drops any in-flight LLM result so it can't stomp the new page.
 */
export function cancelActiveMessageDetail() {
    _activeDetailToken = null;
}

function _normalizeConversation(list) {
    const cleaned = list
        .filter(m => m && typeof m === 'object' && (m.from === 'self' || m.from === 'other') && typeof m.content === 'string')
        .map(m => ({
            from: m.from,
            content: m.content,
            timestamp: typeof m.timestamp === 'string' ? m.timestamp : new Date().toISOString(),
        }));
    // Defensive sort — LLM may return slightly out-of-order timestamps.
    cleaned.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return cleaned;
}

// ─── Rendering ────────────────────────────────────────────────────────────

function _renderEmptyDetailPage(contact) {
    const contactName = (contact?.contactName || '').trim() || '未命名联系人';
    const title = `<span class="tp-title">${escapeHtml(contactName)}</span>`;
    const html = `
        <div class="tp-detail-empty tp-fade-in">
            <div class="tp-empty-prompt-card">
                <div class="tp-empty-prompt-icon"><i class="ph ph-chat-circle-dots"></i></div>
                <div class="tp-empty-prompt-title">这条对话还没加载</div>
                <div class="tp-empty-prompt-body">
                    回到消息列表，点顶部的 <i class="ph ph-arrows-clockwise"></i> 一次性加载所有联系人的对话。
                </div>
            </div>
        </div>
    `;
    openAppInViewport(title, html, () => {});
}

function _renderDetailPage(contact, conversation) {
    const contactName = (contact?.contactName || '').trim() || '未命名联系人';
    const charName = getPhoneCharInfo()?.name || 'ta';

    const title = `<span class="tp-title">${escapeHtml(contactName)}</span>`;
    const bubblesHtml = _renderBubbles(conversation, contactName, charName);
    const html = `
        <div class="tp-msg-detail tp-fade-in" id="tp_msg_detail">
            <div class="tp-msg-detail-stream" id="tp_msg_detail_stream">
                ${bubblesHtml}
            </div>
        </div>
    `;
    const actionsHtml = `
        <button class="tp-header-btn" id="tp_msg_detail_more" title="再来几条">
            <i class="ph ph-plus-circle"></i>
        </button>
    `;
    openAppInViewport(title, html, () => {
        const moreBtn = document.getElementById('tp_msg_detail_more');
        moreBtn?.addEventListener('click', () => _handleMoreClick(contact));
        _scrollStreamToBottom();
    }, actionsHtml);
}

function _renderBubbles(conversation, contactName, charName) {
    if (!Array.isArray(conversation) || conversation.length === 0) {
        return emptyHtml('这条对话还是空的', 'ph ph-chat-circle');
    }

    const parts = [];
    let lastTime = null;
    let lastFrom = null;
    let openCluster = false;

    for (const msg of conversation) {
        const t = new Date(msg.timestamp);
        const tValid = !Number.isNaN(t.getTime());

        // Time divider when gap > threshold (or first message).
        if (tValid && (lastTime === null || t.getTime() - lastTime.getTime() > TIME_DIVIDER_GAP_MS)) {
            if (openCluster) {
                parts.push('</div>');
                openCluster = false;
            }
            parts.push(`<div class="tp-msg-time-divider">${escapeHtml(_formatDividerTime(t))}</div>`);
            lastFrom = null;
        }

        // Cluster boundary when speaker switches.
        if (msg.from !== lastFrom) {
            if (openCluster) {
                parts.push('</div>');
                openCluster = false;
            }
            const sideCls = msg.from === 'self' ? 'tp-msg-cluster-self' : 'tp-msg-cluster-other';
            const speaker = msg.from === 'self' ? charName : contactName;
            parts.push(`<div class="tp-msg-cluster ${sideCls}" data-speaker="${escapeHtml(speaker)}">`);
            openCluster = true;
        }

        parts.push(`<div class="tp-msg-bubble">${escapeHtml(msg.content)}</div>`);
        if (tValid) lastTime = t;
        lastFrom = msg.from;
    }

    if (openCluster) parts.push('</div>');
    return parts.join('');
}

function _formatDividerTime(d) {
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (sameDay) return `今天 ${hh}:${mm}`;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hh}:${mm}`;
    const sameYear = d.getFullYear() === now.getFullYear();
    if (sameYear) return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

function _scrollStreamToBottom() {
    const stream = document.getElementById('tp_msg_detail_stream');
    if (stream) stream.scrollTop = stream.scrollHeight;
}

// ─── "Re-write a few more" ────────────────────────────────────────────────

let _moreInFlight = false;

async function _handleMoreClick(contact) {
    if (_moreInFlight) return;
    const contactName = (contact?.contactName || '').trim() || '未命名联系人';
    const moreBtn = document.getElementById('tp_msg_detail_more');

    let cached;
    try {
        cached = await getMessageDetail(contactName);
    } catch (e) {
        console.warn(`${TP_LOG} getMessageDetail (incremental) failed:`, e);
        cached = null;
    }
    if (!cached || !Array.isArray(cached.conversation) || cached.conversation.length === 0) {
        // Edge case: cache wiped between open and click. Detail-page LLM
        // is no longer single-shot — bounce back to the empty prompt card
        // so the user uses the list-page ⟳ to refill in bulk.
        if (typeof toastr !== 'undefined') toastr.info('对话缓存没了，回列表点 ⟳ 补齐');
        openMessageDetail(contact);
        return;
    }

    _moreInFlight = true;
    moreBtn?.classList.add('tp-header-btn-busy');
    if (moreBtn) moreBtn.innerHTML = '<i class="ph ph-circle-notch tp-spin"></i>';

    try {
        const charInfo = getPhoneCharInfo();
        const userName = getPhoneUserName();
        const userPersona = getPhoneUserPersona();
        const recentChatSummary = getPhoneRecentChat(20);
        let worldBookText = '';
        try { worldBookText = await getPhoneWorldBookContext(); } catch {}

        const tail = cached.conversation.slice(-6);
        const { systemPrompt, userPrompt } = buildMessageDetailIncrementalPrompt({
            charInfo, userName, userPersona, worldBookText, recentChatSummary,
            contact: {
                contactName: contact.contactName,
                contactType: contact.contactType,
                lastMessage: contact.lastMessage,
            },
            existing: { totalCount: cached.conversation.length, tail },
        });

        const parsed = await callDetailLLM(systemPrompt, userPrompt, { maxTokens: 4000 });
        const newList = Array.isArray(parsed) ? parsed : null;
        if (!newList || newList.length === 0) {
            if (typeof toastr !== 'undefined') toastr.warning('暂时写不出新内容，过会再试');
            return;
        }
        const normalized = _normalizeConversation(newList);
        if (normalized.length === 0) {
            if (typeof toastr !== 'undefined') toastr.warning('新内容格式不对，过会再试');
            return;
        }

        await appendMessageDetail(contactName, normalized);

        const full = cached.conversation.concat(normalized);
        // Re-sort the full set defensively in case the LLM put earlier timestamps.
        full.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        const stream = document.getElementById('tp_msg_detail_stream');
        if (stream) {
            const charName = getPhoneCharInfo()?.name || 'ta';
            stream.innerHTML = _renderBubbles(full, contactName, charName);
            _scrollStreamToBottom();
        }
    } catch (e) {
        console.error(`${TP_LOG} incremental message detail failed:`, e);
        if (typeof toastr !== 'undefined') toastr.error('再来几条失败了');
    } finally {
        _moreInFlight = false;
        if (moreBtn) {
            moreBtn.classList.remove('tp-header-btn-busy');
            moreBtn.innerHTML = '<i class="ph ph-plus-circle"></i>';
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Broad refresh (top ⟳ on the messages list page) — Phase 3.5
// ═══════════════════════════════════════════════════════════════════════

/**
 * Refresh every contact's conversation flow in one LLM call. Fills the
 * ones that have no cache, extends the ones that do, and optionally adds
 * 1-2 brand-new contacts. Writes happen atomically through appendMessagesBatch.
 *
 * @returns {Promise<{ filled:number, extended:number, added:number, totalMessages:number } | null>}
 */
export async function refreshMessages() {
    let data;
    try {
        data = await loadData();
    } catch (e) {
        console.warn(`${TP_LOG} refreshMessages loadData failed:`, e);
        return null;
    }

    const contacts = Array.isArray(data?.messages) ? data.messages : [];

    // Split list into "needs fill" (no cache yet) and "has cache" (can extend).
    const fillsList = [];
    const extensionsList = [];
    for (const c of contacts) {
        const name = (c?.contactName || '').trim();
        if (!name) continue;
        let cache = null;
        try {
            cache = await getMessageDetail(name);
        } catch {}
        if (cache && Array.isArray(cache.conversation) && cache.conversation.length > 0) {
            extensionsList.push({
                contactName: name,
                contactType: c.contactType || '',
                totalCount: cache.conversation.length,
                tail: cache.conversation.slice(-4),
            });
        } else {
            fillsList.push({
                contactName: name,
                contactType: c.contactType || '',
                lastMessage: c.lastMessage || '',
            });
        }
    }

    const charInfo = getPhoneCharInfo();
    const userName = getPhoneUserName();
    const userPersona = getPhoneUserPersona();
    const recentChatSummary = getPhoneRecentChat(20);
    let worldBookText = '';
    try { worldBookText = await getPhoneWorldBookContext(); } catch {}

    const { systemPrompt, userPrompt } = buildMessagesBatchPrompt({
        charInfo, userName, userPersona, worldBookText, recentChatSummary,
        fillsList, extensionsList,
    });

    console.log(`${TP_LOG} calling LLM for messages broad refresh (fills=${fillsList.length}, extensions=${extensionsList.length})`);
    const parsed = await callDetailLLM(systemPrompt, userPrompt, { maxTokens: 12000 });
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const existingNames = new Set(contacts.map(c => (c?.contactName || '').trim()).filter(Boolean));

    const fills = Array.isArray(parsed.fills) ? parsed.fills.map(f => ({
        contactName: (f?.contactName || '').trim(),
        conversation: _normalizeConversation(Array.isArray(f?.conversation) ? f.conversation : []),
    })).filter(f => f.contactName && f.conversation.length > 0) : [];

    const extensions = Array.isArray(parsed.extensions) ? parsed.extensions.map(e => ({
        contactName: (e?.contactName || '').trim(),
        newMessages: _normalizeConversation(Array.isArray(e?.newMessages) ? e.newMessages : []),
    })).filter(e => e.contactName && e.newMessages.length > 0) : [];

    const newContacts = Array.isArray(parsed.newContacts) ? parsed.newContacts.map(c => ({
        contactName: (c?.contactName || '').trim(),
        contactType: typeof c?.contactType === 'string' ? c.contactType : '',
        lastMessage: typeof c?.lastMessage === 'string' ? c.lastMessage : '',
        unread: Number.isFinite(c?.unread) ? c.unread : 0,
        timestamp: typeof c?.timestamp === 'string' ? c.timestamp : new Date().toISOString(),
        conversation: _normalizeConversation(Array.isArray(c?.conversation) ? c.conversation : []),
    })).filter(c => c.contactName && !existingNames.has(c.contactName)) : [];

    if (fills.length === 0 && extensions.length === 0 && newContacts.length === 0) return null;

    try {
        await appendMessagesBatch({ fills, extensions, newContacts });
    } catch (e) {
        console.warn(`${TP_LOG} appendMessagesBatch failed:`, e);
        return null;
    }

    const totalMessages = fills.reduce((n, f) => n + f.conversation.length, 0)
        + extensions.reduce((n, e) => n + e.newMessages.length, 0)
        + newContacts.reduce((n, c) => n + c.conversation.length, 0);

    return {
        filled: fills.length,
        extended: extensions.length,
        added: newContacts.length,
        totalMessages,
    };
}

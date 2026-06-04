// modules/phone/chat/chatReturnHomeArchive.js — "回家档案" sub-page under 查看总结.
//
// Phase 6 scope: read-only paper trail of every "我已回家" run. Each entry
// records what got sent to ST main chat (LLM summary or raw transcript),
// the phone-message slice it covered (floorRange), and optional memory-fragment
// count. The user can read full payloads and delete entries — deleting an
// entry with a known floorRange also un-summarizes that range so the affected
// messages re-enter the next chat prompt (mirrors chatSummaryView's
// "delete & restore" semantics, but for the 回家 flow that never wrote into
// chatSummaryHistory).
//
// Editing is intentionally NOT offered: the payload already left this device
// for ST main chat, so any local edit would be cosmetic-only and would make
// the archive look like a source of truth it cannot be.

import { openAppInViewport } from '../phoneController.js';
import { escHtml } from './chatApp.js';
import { openChatSummaryViewPage } from './chatSummaryView.js';
import {
    loadReturnHomeArchive,
    deleteReturnHomeArchiveEntry,
    unmarkRangeAsSummarized,
    loadHomeMarker,
    saveHomeMarker,
    ensureChatHistoryReady,
} from './chatStorage.js';

const LOG = '[ChatReturnHomeArchive]';

let _backHandler = null;

// Tracks which entry indices the user has expanded inline. Keyed by ORIGINAL
// chronological index (same convention as chatSummaryView) so a rerender after
// a delete keeps the user's expand state on the entries that survived.
const _expanded = new Set();

const PREVIEW_CLAMP = 200; // chars shown in collapsed payload preview

// ───────────────────────────────────────────────────────────────────────
// Entry point
// ───────────────────────────────────────────────────────────────────────

export function openChatReturnHomeArchivePage() {
    const titleHtml = `<span class="chat-settings-nav-title">回家档案</span>`;
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

// ───────────────────────────────────────────────────────────────────────
// Markup
// ───────────────────────────────────────────────────────────────────────

function _buildPage() {
    return `
    <div class="chat-summary-page" id="chat_rh_archive_root">
        <div class="chat-summary-scroll">
            <div class="chat-summary-section">
                <div class="chat-summary-section-title">回家档案</div>
                <div class="chat-summary-section-hint">每次"我已回家"送往主聊的内容会在这里留档；删除条目可同时恢复对应消息的可见性</div>
                <div id="chat_rh_archive_slot"></div>
            </div>
        </div>
    </div>`;
}

// ───────────────────────────────────────────────────────────────────────
// Render
// ───────────────────────────────────────────────────────────────────────

function _render() {
    const slot = document.getElementById('chat_rh_archive_slot');
    if (!slot) return;

    const archive = loadReturnHomeArchive();
    if (archive.length === 0) {
        _expanded.clear();
        slot.innerHTML = `
            <div class="chat-summary-empty">
                <i class="ph ph-house-line chat-summary-empty-icon"></i>
                <div class="chat-summary-empty-title">暂无回家档案</div>
                <div class="chat-summary-empty-hint">每次"我已回家"成功送达 ST 主聊后，会在这里留下一条记录</div>
            </div>`;
        return;
    }

    // Drop stale expand state — indices may have shifted after a delete.
    for (const idx of [..._expanded]) {
        if (idx < 0 || idx >= archive.length) _expanded.delete(idx);
    }

    // Newest first — render in reverse without mutating the stored array.
    let html = '';
    for (let i = archive.length - 1; i >= 0; i--) {
        html += _buildArchiveRowHtml(archive[i], i);
    }
    slot.innerHTML = html;
}

function _buildArchiveRowHtml(entry, originalIdx) {
    const time = _formatTimestamp(entry.archivedAt);
    const isRaw = entry.mode === 'raw';
    const modeLabel = isRaw ? '原文同步' : '压缩总结';
    const modeClass = isRaw ? 'raw' : 'summary';

    const payload = (entry.payload || '').trim();
    const charCount = [...payload].length;
    const isExpanded = _expanded.has(originalIdx);
    const visible = isExpanded ? payload : _clamp(payload, PREVIEW_CLAMP);
    const isClamped = visible !== payload;

    const fr = _entryFloorRange(entry);
    const msgCount = Number.isFinite(entry.msgCount) ? entry.msgCount : 0;
    const rangeLabel = fr
        ? `覆盖 #${fr.from}-#${fr.to}（共 ${msgCount} 条）`
        : (msgCount > 0 ? `共 ${msgCount} 条 · 范围未知（旧版回家）` : '范围未知（旧版回家）');

    const memoryLabel = (Number.isFinite(entry.memoryFragmentCount) && entry.memoryFragmentCount > 0)
        ? ` · 记忆碎片 ${entry.memoryFragmentCount} 条`
        : '';

    const deleteAriaLabel = fr ? '删除并恢复' : '删除这条记录';

    return `
        <div class="chat-rh-archive-row" data-expanded="${isExpanded ? '1' : '0'}" data-rh-idx="${originalIdx}">
            <div class="chat-rh-archive-header">
                <span class="chat-rh-archive-mode ${modeClass}">${modeLabel}</span>
                <span class="chat-rh-archive-time">${escHtml(time)}</span>
                <button class="chat-rh-archive-delete-btn" data-action="delete-one" data-rh-idx="${originalIdx}" aria-label="${deleteAriaLabel}">
                    <i class="ph ph-trash"></i>
                </button>
            </div>
            <div class="chat-rh-archive-meta">${escHtml(rangeLabel)}${escHtml(memoryLabel)}</div>
            <div class="chat-rh-archive-body">${escHtml(visible)}</div>
            <div class="chat-rh-archive-footer">
                <span class="chat-rh-archive-count">${charCount} 字</span>
                ${isClamped || isExpanded ? `
                    <button class="chat-summary-expand-btn" data-action="toggle-expand" data-rh-idx="${originalIdx}">
                        <i class="ph ${isExpanded ? 'ph-caret-up' : 'ph-caret-down'}"></i>
                        <span>${isExpanded ? '收起' : '展开'}</span>
                    </button>` : ''}
            </div>
        </div>`;
}

// ───────────────────────────────────────────────────────────────────────
// Events
// ───────────────────────────────────────────────────────────────────────

function _bindEvents() {
    const root = document.getElementById('chat_rh_archive_root');
    if (!root) return;

    root.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const idx = parseInt(btn.dataset.rhIdx, 10);
        if (!Number.isInteger(idx)) return;

        if (action === 'toggle-expand') {
            e.stopPropagation();
            _toggleExpand(idx);
        } else if (action === 'delete-one') {
            e.stopPropagation();
            await _deleteSingle(idx);
        }
    });
}

function _toggleExpand(idx) {
    if (_expanded.has(idx)) _expanded.delete(idx);
    else _expanded.add(idx);
    _render();
}

async function _deleteSingle(idx) {
    const archive = loadReturnHomeArchive();
    const entry = archive[idx];
    if (!entry) return; // index may have shifted between render and click
    const fr = _entryFloorRange(entry);

    const span = fr ? (fr.to - fr.from + 1) : 0;
    const confirmMsg = fr
        ? `删除这条回家档案并恢复对应消息？\n\n这条档案覆盖了 #${fr.from} - #${fr.to}（共 ${span} 条消息）。\n` +
          `删除后，这些消息会重新进入 LLM 的可见范围，下次"我已回家"也会重新把它们同步给主聊（再次进入聊天后生效）。\n\n注意：已发到 ST 主聊的内容不会被撤回。\n\n操作不可撤销。`
        : '删除这条回家档案？\n\n这条没有记录覆盖范围（旧版回家），无法自动恢复消息可见性，也不会自动回退"已同步"标记。\n\n注意：已发到 ST 主聊的内容不会被撤回。\n\n操作不可撤销。';
    if (!confirm(confirmMsg)) return;

    try {
        const removed = await deleteReturnHomeArchiveEntry(idx);
        if (!removed) {
            if (typeof toastr !== 'undefined') toastr.warning('未找到该条档案，可能已被其它操作删除');
            _render();
            return;
        }

        // ─── Roll the homeMarker back so 回家 sees this slice as new again ───
        // getMessagesSinceHome() gates by homeMarker, not by .summarized — so
        // clearing the summarized marks alone leaves the next 回家 short-
        // circuiting with "上次回家之后还没有新的聊天记录". Walk the marker
        // back to the value recorded on this entry, but only if it's older
        // than the current marker (a later run may have pushed it further;
        // we never want a delete to advance the marker). Empty string is a
        // valid prev value (entry came from the first-ever 回家) — rolling
        // back to empty means "no marker", which is the correct starting
        // state. Entries without prevHomeMarker predate this fix and have
        // no safe rollback target — log + skip.
        const prev = removed.prevHomeMarker;
        if (typeof prev === 'string') {
            const current = loadHomeMarker();
            if (!current || prev < current) {
                await saveHomeMarker(prev);
                console.log(LOG, `homeMarker rolled back: ${current || '(empty)'} → ${prev || '(empty)'}`);
            } else {
                console.log(LOG, `homeMarker not rolled back: prev=${prev} not older than current=${current}`);
            }
        } else {
            console.log(LOG, 'entry has no prevHomeMarker — skipping marker rollback (legacy archive)');
        }

        if (fr) {
            const restoredCount = await unmarkRangeAsSummarized(fr.from, fr.to);
            _showPersistentToast(
                `已删除该条回家档案，第 #${fr.from} - #${fr.to} 共 ${restoredCount} 条消息已取消隐藏。\n` +
                `下次"我已回家"会重新同步这段对话。再次进入聊天后即生效。`,
            );
        } else if (typeof toastr !== 'undefined') {
            toastr.success('已删除', '', { timeOut: 1200 });
        }
    } catch (e) {
        console.warn(LOG, 'delete archive entry failed:', e);
        if (typeof toastr !== 'undefined') toastr.error('删除失败');
    }
    _render();
}

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

function _clamp(text, max) {
    const cps = [...text];
    if (cps.length <= max) return text;
    return cps.slice(0, max).join('') + '…';
}

// Mirrors chatSummaryView's helper — centralized normalization keeps the
// row markup and delete handler from disagreeing on what counts as a usable
// range when an import / hand edit leaves a partial floorRange object.
function _entryFloorRange(entry) {
    const fr = entry?.floorRange;
    if (!fr) return null;
    const { from, to } = fr;
    if (typeof from !== 'number' || typeof to !== 'number') return null;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    if (from > to) return null;
    return { from, to };
}

// Persistent toastr for prompt-affecting actions — same configuration as
// chatSummaryView._showPersistentToast (extendedTimeOut: 0 is what actually
// keeps it on screen; timeOut: 0 alone still fades on mouseout).
function _showPersistentToast(message, title = '已删除并恢复') {
    if (typeof toastr === 'undefined') return;
    toastr.success(message, title, {
        timeOut: 0,
        extendedTimeOut: 0,
        closeButton: true,
        tapToDismiss: true,
    });
}

function _formatTimestamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin} 分钟前`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} 小时前`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay} 天前`;

    const sameYear = d.getFullYear() === now.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return sameYear
        ? `${m}月${day}日 ${hh}:${mm}`
        : `${d.getFullYear()}年${m}月${day}日`;
}

// ───────────────────────────────────────────────────────────────────────
// Back navigation: returns to 查看总结
// ───────────────────────────────────────────────────────────────────────

function _registerBackHandler() {
    _unregisterBackHandler();
    _backHandler = (e) => {
        e.preventDefault();
        _exitToSummaryView();
    };
    window.addEventListener('phone-app-back', _backHandler);
}

function _unregisterBackHandler() {
    if (_backHandler) {
        window.removeEventListener('phone-app-back', _backHandler);
        _backHandler = null;
    }
}

function _exitToSummaryView() {
    _unregisterBackHandler();
    openChatSummaryViewPage();
}

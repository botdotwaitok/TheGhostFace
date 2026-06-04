// modules/phone/chat/chatSummaryView.js — "查看总结" sub-page under ChatSettings.
// Phase 2 scope: read-only display of the current rolling summary plus a
// chronological list of prior snapshots (pushed into history by
// maybeAutoSummarize before each overwrite). The current-summary card carries
// a 「编辑」 button placeholder that toasts "敬请期待" until Phase 3 wires up
// the full-screen edit page.
//
// History entries are stored chronologically (oldest first, newest at tail)
// inside chat_metadata. We render newest-first by reversing on read so the
// user sees the most recent change at the top.

import { openAppInViewport } from '../phoneController.js';
import { escHtml } from './chatApp.js';
import { openChatSettingsPage } from './chatSettings.js';
import {
    loadChatSummary,
    saveChatSummary,
    loadChatSummaryHistory,
    pushChatSummaryHistory,
    removeChatSummaryHistoryByIndices,
    deleteChatSummaryHistoryEntry,
    unmarkRangeAsSummarized,
    ensureChatHistoryReady,
    loadReturnHomeArchive,
} from './chatStorage.js';
import { openChatReturnHomeArchivePage } from './chatReturnHomeArchive.js';

const LOG = '[ChatSummaryView]';

let _backHandler = null;

// Multi-select state for history rows. Lives at the module level so the
// rerender after a delete can paint rows in the right mode without re-binding
// every listener. _selectionMode is the gate (toolbar visible, rows show
// checkboxes); _selected stores the ORIGINAL chronological indices users have
// ticked, so we can hand them to removeChatSummaryHistoryByIndices verbatim.
let _selectionMode = false;
const _selected = new Set();
let _longPressTimer = null;
let _longPressStartXY = null;
const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE = 8;

// ───────────────────────────────────────────────────────────────────────
// Entry point
// ───────────────────────────────────────────────────────────────────────

export function openChatSummaryViewPage() {
    const titleHtml = `<span class="chat-settings-nav-title">查看总结</span>`;
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
    <div class="chat-summary-page" id="chat_summary_root">
        <div class="chat-summary-selection-toolbar" id="chat_summary_selection_toolbar" hidden>
            <button class="chat-summary-selection-btn" data-action="selection-cancel">
                <i class="ph ph-x"></i><span>取消</span>
            </button>
            <span class="chat-summary-selection-count" id="chat_summary_selection_count">已选 0 条</span>
            <button class="chat-summary-selection-btn danger" data-action="selection-delete" disabled>
                <i class="ph ph-trash"></i><span>删除</span>
            </button>
        </div>
        <div class="chat-summary-scroll">
            <div class="chat-summary-section">
                <div class="chat-summary-section-title">当前总结</div>
                <div class="chat-summary-section-hint">每轮发送给 LLM 的滚动总结，可手动编辑修正</div>
                <div id="chat_summary_current_slot"></div>
            </div>

            <div class="chat-summary-section">
                <div class="chat-summary-section-title">历史总结</div>
                <div class="chat-summary-section-hint">每次自动总结或手动保存前的快照，按时间倒序；长按可批量管理</div>
                <div id="chat_summary_history_slot"></div>
            </div>

            <div class="chat-summary-section">
                <div class="chat-summary-section-title">回家档案</div>
                <div class="chat-summary-section-hint">"我已回家"送往主聊的内容会在这里留档，可单独删除并恢复对应消息</div>
                <div id="chat_summary_rh_archive_slot"></div>
            </div>

        </div>
    </div>`;
}

// ───────────────────────────────────────────────────────────────────────
// Render
// ───────────────────────────────────────────────────────────────────────

const CURRENT_PREVIEW_CLAMP = 280;  // chars shown collapsed for current card
const HISTORY_PREVIEW_CLAMP = 120;  // chars shown collapsed for each history row

function _render() {
    _renderCurrent();
    _renderHistory();
    _renderReturnHomeArchiveEntry();
}

function _renderCurrent() {
    const slot = document.getElementById('chat_summary_current_slot');
    if (!slot) return;

    const text = (loadChatSummary() || '').trim();
    if (!text) {
        slot.innerHTML = `
            <div class="chat-summary-empty">
                <i class="ph ph-scroll chat-summary-empty-icon"></i>
                <div class="chat-summary-empty-title">还没有总结</div>
                <div class="chat-summary-empty-hint">聊到一定长度后会自动生成（约 5w token 阈值）</div>
            </div>`;
        return;
    }

    const charCount = [...text].length;
    const preview = _clamp(text, CURRENT_PREVIEW_CLAMP);
    const isClamped = preview !== text;

    slot.innerHTML = `
        <div class="chat-summary-current-card" data-expanded="0">
            <div class="chat-summary-current-meta">
                <span class="chat-summary-current-count">${charCount} 字</span>
            </div>
            <div class="chat-summary-current-body">${escHtml(preview)}</div>
            ${isClamped ? `
                <button class="chat-summary-expand-btn" data-action="toggle-current">
                    <i class="ph ph-caret-down"></i><span>展开全文</span>
                </button>` : ''}
            <div class="chat-summary-current-actions">
                <button class="chat-summary-action-btn" data-action="edit">
                    <i class="ph ph-pencil-simple"></i><span>编辑</span>
                </button>
            </div>
        </div>`;
}

function _renderHistory() {
    const slot = document.getElementById('chat_summary_history_slot');
    if (!slot) return;

    const history = loadChatSummaryHistory();
    if (history.length === 0) {
        // Reset selection state defensively — if the last item was deleted while
        // we were in selection mode, the toolbar would otherwise dangle.
        _exitSelectionMode({ render: false });
        slot.innerHTML = `
            <div class="chat-summary-empty chat-summary-empty-history">
                <i class="ph ph-clock-counter-clockwise chat-summary-empty-icon"></i>
                <div class="chat-summary-empty-title">暂无历史</div>
                <div class="chat-summary-empty-hint">总结被自动或手动替换时，旧版本会留档在这里</div>
            </div>`;
        return;
    }

    // Drop stale selections (indices that no longer exist after a delete batch).
    if (_selected.size > 0) {
        for (const idx of [...selectedAsArray()]) {
            if (idx < 0 || idx >= history.length) _selected.delete(idx);
        }
    }

    // Newest first — reverse a shallow copy so we don't mutate the stored array.
    const ordered = history.slice().reverse();
    let html = '';
    for (let i = 0; i < ordered.length; i++) {
        // Render-index of the ORIGINAL entry (used as a stable data-attr).
        // Since we reversed, original index = history.length - 1 - i.
        html += _buildHistoryRowHtml(ordered[i], history.length - 1 - i);
    }
    slot.innerHTML = html;
    _refreshSelectionToolbar();
}

function selectedAsArray() {
    return [..._selected];
}

// Renders the 回家档案 entry-card at the bottom of the summary view. Always
// shows a count badge so the user knows whether there's anything to open;
// always clickable (the archive page handles its own empty state).
function _renderReturnHomeArchiveEntry() {
    const slot = document.getElementById('chat_summary_rh_archive_slot');
    if (!slot) return;
    const count = loadReturnHomeArchive().length;
    slot.innerHTML = `
        <button class="chat-summary-rh-entry" data-action="open-rh-archive" type="button">
            <span class="chat-summary-rh-entry-icon"><i class="ph ph-house-line"></i></span>
            <span class="chat-summary-rh-entry-label">查看回家档案</span>
            <span class="chat-summary-rh-entry-count">${count}</span>
            <span class="chat-summary-rh-entry-chevron"><i class="ph ph-caret-right"></i></span>
        </button>
    `;
}

function _buildHistoryRowHtml(entry, originalIdx) {
    const time = _formatTimestamp(entry.savedAt);
    const sourceLabel = entry.source === 'manual' ? '手动编辑' : '自动总结';
    const sourceClass = entry.source === 'manual' ? 'manual' : 'auto';
    const text = (entry.summary || '').trim();
    const charCount = [...text].length;
    const preview = _clamp(text, HISTORY_PREVIEW_CLAMP);
    const isClamped = preview !== text;
    const msgCountLabel = (typeof entry.msgCount === 'number' && entry.source === 'auto')
        ? ` · 折叠 ${entry.msgCount} 条`
        : '';
    // Floor range tells the user (and Phase 3 delete-and-restore) which
    // message slice this summary folded. Entries written before Phase 2
    // (or via the editor's version-overwrite path) have no floorRange, so
    // they render as "范围未知（旧版总结）" and lose the restore semantics
    // — they can still be deleted, but no messages will become re-visible.
    const fr = _entryFloorRange(entry);
    const rangeLabel = fr
        ? ` · 覆盖 #${fr.from}-#${fr.to}`
        : ' · 范围未知（旧版总结）';
    const deleteAriaLabel = fr ? '删除并恢复' : '删除这条历史';

    const isSelected = _selected.has(originalIdx);
    const selectionClass = _selectionMode ? 'selection-mode' : '';
    const selectedClass = isSelected ? 'selected' : '';

    // In selection mode the checkbox sits where the delete button would live;
    // in normal mode the delete button is always available so single-row removal
    // doesn't require entering multi-select first. Same button handles both
    // "delete & restore" (entry has floorRange) and bare "delete" (no range)
    // paths — the branching lives in _deleteSingle to keep the markup uniform.
    const trailingControl = _selectionMode
        ? `<span class="chat-summary-history-check" data-action="toggle-select" data-history-idx="${originalIdx}">
                <i class="ph ${isSelected ? 'ph-check-circle-fill' : 'ph-circle'}"></i>
           </span>`
        : `<button class="chat-summary-history-delete-btn" data-action="delete-one" data-history-idx="${originalIdx}" aria-label="${deleteAriaLabel}">
                <i class="ph ph-trash"></i>
           </button>`;

    return `
        <div class="chat-summary-history-row ${selectionClass} ${selectedClass}" data-expanded="0" data-history-idx="${originalIdx}">
            <div class="chat-summary-history-header">
                <span class="chat-summary-history-source ${sourceClass}">${sourceLabel}</span>
                <span class="chat-summary-history-time">${escHtml(time)}${msgCountLabel}${rangeLabel}</span>
                ${trailingControl}
            </div>
            <div class="chat-summary-history-body">${escHtml(preview)}</div>
            <div class="chat-summary-history-footer">
                <span class="chat-summary-history-count">${charCount} 字</span>
                ${isClamped ? `
                    <button class="chat-summary-expand-btn" data-action="toggle-history" data-history-idx="${originalIdx}">
                        <i class="ph ph-caret-down"></i><span>展开</span>
                    </button>` : ''}
            </div>
        </div>`;
}

// ───────────────────────────────────────────────────────────────────────
// Events
// ───────────────────────────────────────────────────────────────────────

function _bindEvents() {
    const root = document.getElementById('chat_summary_root');
    if (!root) return;

    root.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'toggle-current') {
            _toggleCurrentExpansion();
        } else if (action === 'toggle-history') {
            // In selection mode the toggle button is still rendered (for entries
            // long enough to clamp) — but a tap on it should NOT count as a row
            // tap. Block bubbling so the row-level select handler doesn't also fire.
            e.stopPropagation();
            const idx = parseInt(btn.dataset.historyIdx, 10);
            if (Number.isInteger(idx)) _toggleHistoryExpansion(idx);
        } else if (action === 'edit') {
            _unregisterBackHandler();
            openChatSummaryEditPage();
        } else if (action === 'delete-one') {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.historyIdx, 10);
            if (Number.isInteger(idx)) await _deleteSingle(idx);
        } else if (action === 'toggle-select') {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.historyIdx, 10);
            if (Number.isInteger(idx)) _toggleSelection(idx);
        } else if (action === 'selection-cancel') {
            _exitSelectionMode();
        } else if (action === 'selection-delete') {
            await _deleteSelected();
        } else if (action === 'open-rh-archive') {
            // Tear down the summary-view back handler before transitioning so
            // pressing Back on the archive page doesn't fall through to here
            // and try to render against an unmounted DOM.
            _unregisterBackHandler();
            openChatReturnHomeArchivePage();
        }
    });

    // Row-level interactions for entering selection mode and ticking checkboxes.
    // Using pointer events so the same handler covers mouse + touch; we cancel
    // the long-press timer if the pointer moves more than a few pixels or
    // leaves the element, which prevents scroll gestures from being misread.
    const historySlot = document.getElementById('chat_summary_history_slot');
    if (historySlot) {
        historySlot.addEventListener('pointerdown', (e) => {
            const row = e.target.closest('.chat-summary-history-row[data-history-idx]');
            if (!row) return;
            // Ignore presses on interactive controls — their own handlers run.
            if (e.target.closest('[data-action]')) return;
            const idx = parseInt(row.dataset.historyIdx, 10);
            if (!Number.isInteger(idx)) return;
            _longPressStartXY = { x: e.clientX, y: e.clientY };
            _longPressTimer = setTimeout(() => {
                _longPressTimer = null;
                if (!_selectionMode) _enterSelectionMode(idx);
            }, LONG_PRESS_MS);
        });
        const cancelLongPress = () => {
            if (_longPressTimer) {
                clearTimeout(_longPressTimer);
                _longPressTimer = null;
            }
            _longPressStartXY = null;
        };
        historySlot.addEventListener('pointermove', (e) => {
            if (!_longPressStartXY) return;
            const dx = Math.abs(e.clientX - _longPressStartXY.x);
            const dy = Math.abs(e.clientY - _longPressStartXY.y);
            if (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE) {
                cancelLongPress();
            }
        });
        historySlot.addEventListener('pointerup', (e) => {
            cancelLongPress();
            // In selection mode, a normal tap on the row also toggles selection
            // so the user can keep tapping without aiming at the checkbox.
            if (!_selectionMode) return;
            const row = e.target.closest('.chat-summary-history-row[data-history-idx]');
            if (!row) return;
            if (e.target.closest('[data-action]')) return;
            const idx = parseInt(row.dataset.historyIdx, 10);
            if (Number.isInteger(idx)) _toggleSelection(idx);
        });
        historySlot.addEventListener('pointercancel', cancelLongPress);
        historySlot.addEventListener('pointerleave', cancelLongPress);
    }
}

function _enterSelectionMode(initialIdx) {
    _selectionMode = true;
    _selected.clear();
    if (Number.isInteger(initialIdx)) _selected.add(initialIdx);
    _renderHistory();
}

function _exitSelectionMode({ render = true } = {}) {
    _selectionMode = false;
    _selected.clear();
    if (render) _renderHistory();
}

function _toggleSelection(idx) {
    if (_selected.has(idx)) _selected.delete(idx);
    else _selected.add(idx);
    _renderHistory();
}

function _refreshSelectionToolbar() {
    const toolbar = document.getElementById('chat_summary_selection_toolbar');
    const countEl = document.getElementById('chat_summary_selection_count');
    const deleteBtn = toolbar?.querySelector('[data-action="selection-delete"]');
    if (!toolbar) return;
    if (!_selectionMode) {
        toolbar.hidden = true;
        return;
    }
    toolbar.hidden = false;
    if (countEl) countEl.textContent = `已选 ${_selected.size} 条`;
    if (deleteBtn) deleteBtn.disabled = _selected.size === 0;
}

async function _deleteSingle(idx) {
    const history = loadChatSummaryHistory();
    const entry = history[idx];
    if (!entry) return; // index may have shifted between render and click
    const fr = _entryFloorRange(entry);

    // Two confirm-and-feedback paths share the same delete primitive:
    //   - With floorRange: warn the user that the covered slice will become
    //     prompt-visible again, then unmark + show a persistent toast so the
    //     "this is the prompt-affecting move you just made" feedback is
    //     impossible to miss.
    //   - Without floorRange (旧版总结 / 编辑覆盖产生的快照): bare delete
    //     with a short toast — there's no message slice to put back, so the
    //     heavy toast would be noise.
    const span = fr ? (fr.to - fr.from + 1) : 0;
    const confirmMsg = fr
        ? `删除并恢复这条总结？\n\n这条总结覆盖了 #${fr.from} - #${fr.to}（共 ${span} 条消息）。\n` +
          `删除后，这些消息会重新进入LLM的可见范围（再次进入聊天后生效）。\n\n操作不可撤销。`
        : '删除这条历史总结？\n\n这是旧版/编辑覆盖产生的快照，没有记录覆盖范围，无法自动恢复消息可见性。\n\n操作不可撤销。';
    if (!confirm(confirmMsg)) return;

    try {
        const removed = await deleteChatSummaryHistoryEntry(idx);
        if (!removed) {
            if (typeof toastr !== 'undefined') toastr.warning('未找到该条历史，可能已被其它操作删除');
            _renderHistory();
            return;
        }
        if (fr) {
            const restoredCount = await unmarkRangeAsSummarized(fr.from, fr.to);
            _showPersistentToast(
                `已删除该条总结，第 #${fr.from} - #${fr.to} 共 ${restoredCount} 条消息已取消隐藏。\n` +
                `再次进入聊天后即生效。`,
            );
        } else if (typeof toastr !== 'undefined') {
            toastr.success('已删除', '', { timeOut: 1200 });
        }
    } catch (e) {
        console.warn(LOG, 'delete single history failed:', e);
        if (typeof toastr !== 'undefined') toastr.error('删除失败');
    }
    _renderHistory();
}

async function _deleteSelected() {
    if (_selected.size === 0) return;
    const n = _selected.size;
    if (!confirm(`删除已选的 ${n} 条历史总结？\n\n删除后无法恢复。`)) return;
    const indices = selectedAsArray();
    try {
        const removed = await removeChatSummaryHistoryByIndices(indices);
        if (typeof toastr !== 'undefined') {
            toastr.success(`已删除 ${removed} 条`, '', { timeOut: 1200 });
        }
    } catch (e) {
        console.warn(LOG, 'batch delete history failed:', e);
        if (typeof toastr !== 'undefined') toastr.error('删除失败');
    }
    _exitSelectionMode();
}

function _toggleCurrentExpansion() {
    const card = document.querySelector('#chat_summary_current_slot .chat-summary-current-card');
    if (!card) return;
    const expanded = card.dataset.expanded === '1';
    const text = (loadChatSummary() || '').trim();
    const body = card.querySelector('.chat-summary-current-body');
    const btn = card.querySelector('.chat-summary-expand-btn');
    if (!body) return;

    if (expanded) {
        body.textContent = _clamp(text, CURRENT_PREVIEW_CLAMP);
        if (btn) btn.innerHTML = `<i class="ph ph-caret-down"></i><span>展开全文</span>`;
        card.dataset.expanded = '0';
    } else {
        body.textContent = text;
        if (btn) btn.innerHTML = `<i class="ph ph-caret-up"></i><span>收起</span>`;
        card.dataset.expanded = '1';
    }
}

function _toggleHistoryExpansion(originalIdx) {
    const row = document.querySelector(
        `#chat_summary_history_slot .chat-summary-history-row[data-history-idx="${originalIdx}"]`
    );
    if (!row) return;
    const history = loadChatSummaryHistory();
    const entry = history[originalIdx];
    if (!entry) return;

    const expanded = row.dataset.expanded === '1';
    const text = (entry.summary || '').trim();
    const body = row.querySelector('.chat-summary-history-body');
    const btn = row.querySelector('.chat-summary-expand-btn');
    if (!body) return;

    if (expanded) {
        body.textContent = _clamp(text, HISTORY_PREVIEW_CLAMP);
        if (btn) btn.innerHTML = `<i class="ph ph-caret-down"></i><span>展开</span>`;
        row.dataset.expanded = '0';
    } else {
        body.textContent = text;
        if (btn) btn.innerHTML = `<i class="ph ph-caret-up"></i><span>收起</span>`;
        row.dataset.expanded = '1';
    }
}

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

function _clamp(text, max) {
    const cps = [...text];
    if (cps.length <= max) return text;
    return cps.slice(0, max).join('') + '…';
}

// Returns a normalized { from, to } if the entry carries a valid floorRange,
// otherwise null. Centralized so the row markup and the delete handler agree
// on what "has a usable range" means — guards against partial / malformed
// objects (e.g. from a corrupted import) silently becoming NaN ranges.
function _entryFloorRange(entry) {
    const fr = entry?.floorRange;
    if (!fr) return null;
    const { from, to } = fr;
    if (typeof from !== 'number' || typeof to !== 'number') return null;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    if (from > to) return null;
    return { from, to };
}

// Persistent toastr for prompt-affecting actions (delete & restore, etc.):
// the user MUST notice this happened, so we disable auto-timeout and require
// an explicit dismiss. extendedTimeOut: 0 is what actually makes it sticky —
// timeOut: 0 alone still lets it fade out on mouseover/mouseout.
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
// Back navigation: returns to ChatSettings
// ───────────────────────────────────────────────────────────────────────

function _registerBackHandler() {
    _unregisterBackHandler();
    _backHandler = (e) => {
        e.preventDefault();
        // If user is in selection mode, back should pop the selection toolbar
        // first — matches the chat app's iMessage-style delete-mode escape.
        if (_selectionMode) {
            _exitSelectionMode();
            return;
        }
        _exitToSettings();
    };
    window.addEventListener('phone-app-back', _backHandler);
}

function _unregisterBackHandler() {
    if (_backHandler) {
        window.removeEventListener('phone-app-back', _backHandler);
        _backHandler = null;
    }
}

function _exitToSettings() {
    _unregisterBackHandler();
    openChatSettingsPage();
}

// ═══════════════════════════════════════════════════════════════════════
// Edit sub-page — full-screen textarea with race-detection on save
// ═══════════════════════════════════════════════════════════════════════
//
// We snapshot the on-disk summary the moment the user enters the editor
// (_editBaseline). On save, we re-read it and compare: if it has changed
// in the meantime (a background maybeAutoSummarize fired while the user
// was typing), we surface a confirm so the user explicitly decides whether
// to overwrite the auto-generated version with their edit.

let _editBackHandler = null;
let _editBaseline = '';   // snapshot of loadChatSummary() taken at editor open
let _editOriginal = '';   // same as baseline at open — used to detect "dirty" on cancel

export function openChatSummaryEditPage() {
    const titleHtml = `<span class="chat-settings-nav-title">编辑总结</span>`;
    _editBaseline = (loadChatSummary() || '');
    _editOriginal = _editBaseline;

    const html = `
    <div class="chat-summary-edit-page" id="chat_summary_edit_root">
        <textarea
            class="chat-summary-edit-textarea"
            id="chat_summary_edit_textarea"
            placeholder="在这里编辑总结。下一轮发送给 LLM 时会用编辑后的内容。"
            spellcheck="false"
        ></textarea>
    </div>`;

    const actionsHtml = `
        <button class="chat-summary-edit-action cancel" id="chat_summary_edit_cancel">取消</button>
        <button class="chat-summary-edit-action save" id="chat_summary_edit_save">保存</button>
    `;

    openAppInViewport(titleHtml, html, () => {
        const ta = document.getElementById('chat_summary_edit_textarea');
        if (ta) {
            ta.value = _editOriginal;
            // Move caret to start so the user sees the beginning, not the tail.
            ta.setSelectionRange(0, 0);
            ta.scrollTop = 0;
        }
        _bindEditEvents();
        _registerEditBackHandler();
    }, actionsHtml);
}

function _bindEditEvents() {
    const saveBtn = document.getElementById('chat_summary_edit_save');
    if (saveBtn) saveBtn.addEventListener('click', _attemptSave);

    const cancelBtn = document.getElementById('chat_summary_edit_cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', _attemptCancel);
}

async function _attemptSave() {
    const ta = document.getElementById('chat_summary_edit_textarea');
    if (!ta) return;
    const newText = ta.value.trim();
    const baselineTrim = _editBaseline.trim();

    if (newText === baselineTrim) {
        if (typeof toastr !== 'undefined') {
            toastr.info('未修改', '', { timeOut: 1500 });
        }
        return;
    }

    // ─── Race detection ───
    // The user opened the editor against _editBaseline; while they typed,
    // maybeAutoSummarize / handleManualSummarize could have overwritten the
    // on-disk summary. We compare with trimmed strings to avoid false-positives
    // from incidental trailing whitespace differences between the two reads.
    const currentOnDisk = (loadChatSummary() || '');
    const onDiskTrim = currentOnDisk.trim();
    const baselineTrimRaw = _editBaseline.trim();
    if (onDiskTrim !== baselineTrimRaw) {
        const baselineChars = [...baselineTrimRaw].length;
        const diskChars = [...onDiskTrim].length;
        const confirmed = confirm(
            `编辑期间，鬼面把当前总结刷新了。\n\n` +
            `你的编辑是基于 ${baselineChars} 字版本，现在磁盘上是 ${diskChars} 字的新版本。\n\n` +
            `点「确定」= 用你的编辑覆盖最新版本（最新版本会被存进历史）\n` +
            `点「取消」= 放弃编辑，回到当前最新版本`
        );
        if (!confirmed) {
            _exitToView();
            return;
        }
        // User chose to overwrite — archive the LATEST disk content (not the
        // stale baseline), otherwise the auto-summary they just saw would be lost.
        // No floorRange: this is a version-overwrite snapshot, not a fold
        // operation, so there's no message slice to "restore" if the user later
        // deletes the entry. Phase 3 will hide the delete button on these.
        await pushChatSummaryHistory({ summary: currentOnDisk, source: 'auto' });
    } else {
        // Normal path: archive the previous version before overwriting.
        // floorRange intentionally omitted — see comment in the branch above.
        await pushChatSummaryHistory({ summary: _editBaseline, source: 'manual' });
    }

    await saveChatSummary(newText);
    if (typeof toastr !== 'undefined') {
        toastr.success('已保存', '', { timeOut: 1500 });
    }
    _exitToView();
}

function _attemptCancel() {
    const ta = document.getElementById('chat_summary_edit_textarea');
    const currentText = ta ? ta.value.trim() : '';
    const originalTrim = _editOriginal.trim();

    if (currentText !== originalTrim) {
        if (!confirm('放弃修改？未保存的内容将会丢失。')) return;
    }
    _exitToView();
}

function _exitToView() {
    _unregisterEditBackHandler();
    _editBaseline = '';
    _editOriginal = '';
    openChatSummaryViewPage();
}

function _registerEditBackHandler() {
    _unregisterEditBackHandler();
    _editBackHandler = (e) => {
        e.preventDefault();
        _attemptCancel();
    };
    window.addEventListener('phone-app-back', _editBackHandler);
}

function _unregisterEditBackHandler() {
    if (_editBackHandler) {
        window.removeEventListener('phone-app-back', _editBackHandler);
        _editBackHandler = null;
    }
}

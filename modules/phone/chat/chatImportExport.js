// modules/phone/chat/chatImportExport.js — Import/export sub-page under ChatSettings.
// Scope: the active character's active chat (one self-managed file). Export
// produces a single JSON file the user downloads via the browser; import
// reads a JSON file via <input type=file>, validates it, and OVERWRITES the
// current chat after a confirm dialog.
//
// Why overwrite-only (not append/merge): the message schema has mutable
// per-message flags (favoritedByUser, summarized, reactions) and chat_metadata
// carries summary + sync markers that all reference timestamps. A merge would
// either drop these or leave them in an inconsistent state — overwrite matches
// the user's mental model of "restore a backup" and keeps the code small.

import { openAppInViewport } from '../phoneController.js';
import { openChatApp } from './chatApp.js';
import { openChatSettingsPage } from './chatSettings.js';
import {
    loadChatHistory,
    saveChatHistory,
    loadChatSummary,
    saveChatSummary,
    loadChatSummaryHistory,
    replaceChatSummaryHistory,
    loadHomeMarker,
    saveHomeMarker,
    saveSTSyncMarker,
    saveCharacterNickname,
    getCharacterInfo,
    getCharacterDisplayName,
    ensureChatHistoryReady,
    prepareImportedFloors,
} from './chatStorage.js';
import * as chatHistoryStore from '../../storage/chatHistoryStore.js';

const LOG = '[ChatImportExport]';
// Legacy export envelope. New exports produce the raw self-managed-storage
// shape directly (see buildPhoneChatExportPayload below) so backups match
// what chatHistoryStore writes to /user/files/ghostface_chat_*.json. These
// constants stay so the import path keeps recognizing older envelope-shaped
// backups produced before the switch (v1 / v2 / v3) — same forward-
// compatibility courtesy that v1/v2 imports got when v3 launched.
const LEGACY_FORMAT_ID = 'ghostface-chat-export';
const LEGACY_MAX_VERSION = 3;

let _backHandler = null;
let _fileInputEl = null;

// ───────────────────────────────────────────────────────────────────────
// Entry point
// ───────────────────────────────────────────────────────────────────────

export function openChatImportExportPage() {
    const titleHtml = `<span class="chat-settings-nav-title">导入 / 导出</span>`;
    const html = _buildPage();

    openAppInViewport(titleHtml, html, async () => {
        try {
            await ensureChatHistoryReady();
        } catch (e) {
            console.warn(LOG, 'ensureChatHistoryReady failed (rendering anyway):', e?.message);
        }
        _refreshInfoCard();
        _bindEvents();
        _registerBackHandler();
    });
}

function _buildPage() {
    return `
    <div class="chat-settings-page" id="chat_importexport_root">
        <div class="chat-settings-scroll">

            <!-- Info card: shows what would be exported -->
            <div class="chat-settings-section">
                <div class="chat-settings-card chat-importexport-info-card">
                    <div class="chat-importexport-info-row">
                        <span class="chat-importexport-info-label">角色</span>
                        <span class="chat-importexport-info-value" id="chat_ie_info_char">—</span>
                    </div>
                    <div class="chat-importexport-info-row">
                        <span class="chat-importexport-info-label">消息数</span>
                        <span class="chat-importexport-info-value" id="chat_ie_info_count">—</span>
                    </div>
                    <div class="chat-importexport-info-row">
                        <span class="chat-importexport-info-label">最近一条</span>
                        <span class="chat-importexport-info-value" id="chat_ie_info_last">—</span>
                    </div>
                </div>
            </div>

            <!-- Actions -->
            <div class="chat-settings-section">
                <div class="chat-settings-card">
                    <div class="chat-settings-item" id="chat_ie_export_btn">
                        <i class="ph ph-download-simple chat-settings-item-icon"></i>
                        <span class="chat-settings-item-label">导出聊天文件</span>
                        <i class="ph ph-caret-right chat-settings-item-chevron"></i>
                    </div>
                    <div class="chat-settings-item" id="chat_ie_import_btn">
                        <i class="ph ph-upload-simple chat-settings-item-icon"></i>
                        <span class="chat-settings-item-label">导入聊天文件</span>
                        <i class="ph ph-caret-right chat-settings-item-chevron"></i>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

function _refreshInfoCard() {
    const charName = getCharacterDisplayName() || '—';
    const history = loadChatHistory();
    const count = Array.isArray(history) ? history.length : 0;

    let lastLabel = '暂无消息';
    if (count > 0) {
        const lastTs = history[count - 1]?.timestamp;
        if (lastTs) {
            lastLabel = _formatTimestamp(lastTs);
        }
    }

    _setText('chat_ie_info_char', charName);
    _setText('chat_ie_info_count', String(count));
    _setText('chat_ie_info_last', lastLabel);
}

function _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function _bindEvents() {
    const exportBtn = document.getElementById('chat_ie_export_btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            _runExport().catch(e => {
                console.error(LOG, 'export failed:', e);
                _toast(`导出失败：${e?.message || e}`, 'error');
            });
        });
    }

    const importBtn = document.getElementById('chat_ie_import_btn');
    if (importBtn) {
        importBtn.addEventListener('click', () => {
            _openFilePicker();
        });
    }
}

// ───────────────────────────────────────────────────────────────────────
// Export
// ───────────────────────────────────────────────────────────────────────

async function _runExport() {
    await ensureChatHistoryReady();
    const result = await buildPhoneChatExportPayload({ filenameStyle: 'manual' });
    if (!result) {
        _toast('当前会话没有可导出的消息', 'info');
        return;
    }
    _triggerBrowserDownload(result.filename, result.json);
    _toast(`已导出 ${result.messageCount} 条消息`, 'success');
}

/**
 * Build the export payload for the active character's active chat. Pure
 * function over the chat-storage layer: callers decide what to do with the
 * resulting JSON (manual download vs. auto-backup attachment).
 *
 * Returns null when there's no current chat or no messages to export — the
 * caller should treat that as "nothing to back up" and skip silently rather
 * than surface an error (an empty phone chat is a normal state for a freshly
 * created character).
 *
 * Output shape: the same `{ schema, messages, nextFloor, summary,
 * summaryHistory, homeMarker }` that chatHistoryStore writes to
 * /user/files/ghostface_chat_*.json. This holds even on the chat_metadata
 * backend — we synthesize the same shape so the user's mental model
 * ("a backup is the chat database snapshot") works regardless of which
 * storage backend is active. stSyncMarker and nickname live in chat_metadata
 * as ST-integration / UI state, not phone-chat content, and are intentionally
 * NOT part of this shape: restoring without them re-absorbs the main ST chat
 * on the next injection and keeps the existing nickname intact — both
 * acceptable side-effects, and extending the raw shape would diverge from
 * the on-disk format that defines the import contract.
 *
 * Filename style:
 *   - 'manual'     → 鬼面聊天-{角色}-{YYYYMMDD-HHmm}.json   (user-facing download)
 *   - 'backup'     → {角色}_phonechat_{ISO-19}.json         (matches backup.js
 *                                                            character/ST chat
 *                                                            attachment naming
 *                                                            for visual consistency
 *                                                            inside an autobackup
 *                                                            email / download set)
 *
 * Caller MUST await ensureChatHistoryReady() upstream when running under the
 * external-storage backend; we don't call it here to keep this a pure value
 * helper (chatImportExport's UI path does it; backup.js does it before calling).
 *
 * @param {{ filenameStyle?: 'manual'|'backup' }} [opts]
 * @returns {Promise<{json: string, filename: string, messageCount: number, charName: string} | null>}
 */
export async function buildPhoneChatExportPayload({ filenameStyle = 'manual' } = {}) {
    const history = loadChatHistory();
    if (!Array.isArray(history) || history.length === 0) return null;

    const charInfo = getCharacterInfo() || {};
    const charName = charInfo.name || '';

    const payload = chatHistoryStore.buildFilePayload(
        history,
        _readActiveNextFloor(history),
        {
            summary: loadChatSummary() || '',
            // Archived rolling-summary entries. Carries floorRange on Phase 2+
            // entries so a restored backup can still drive the "delete &
            // restore covered messages" flow against its imported history.
            summaryHistory: loadChatSummaryHistory(),
            homeMarker: loadHomeMarker() || '',
        },
    );

    const json = JSON.stringify(payload, null, 2);
    const filename = _buildExportFilename(charName || '角色', filenameStyle);
    return { json, filename, messageCount: history.length, charName };
}

function _buildExportFilename(charName, style = 'manual') {
    const safeName = String(charName).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40) || '角色';
    if (style === 'backup') {
        // Match backup.js's `{charName}_{kind}_{ISO-19}.{ext}` convention so all
        // three attachments (角色卡 / ST 聊天 / 手机聊天) sort and read uniformly.
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        return `${safeName}_phonechat_${stamp}.json`;
    }
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    return `鬼面聊天-${safeName}-${stamp}.json`;
}

function _triggerBrowserDownload(filename, content) {
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Give the browser a beat to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ───────────────────────────────────────────────────────────────────────
// Silent backup (summarize hook)
// ───────────────────────────────────────────────────────────────────────

// Lightweight escape hatch read from extension_settings — defaults to on so
// users get a backup-before-summarize safety net without configuring anything.
// Setting `extension_settings.the_ghost_face.silentChatBackupOnSummarize = false`
// turns the auto-download off without touching code.
function _isSilentBackupEnabled() {
    try {
        const ext = window?.extension_settings?.the_ghost_face;
        if (ext && ext.silentChatBackupOnSummarize === false) return false;
    } catch { /* settings not loaded yet — fall through to default-on */ }
    return true;
}

/**
 * Auto-download a phone-chat raw backup as a side-effect of rolling
 * summarize. Surfaces no UI and never throws: failure logs and returns,
 * so a backup hiccup can never block the summarize success path.
 *
 * Default-on; users disable via extension_settings (see _isSilentBackupEnabled).
 *
 * @param {{ reason?: string }} [opts]
 */
export async function triggerSilentPhoneChatBackup({ reason = '' } = {}) {
    if (!_isSilentBackupEnabled()) return;
    try {
        await ensureChatHistoryReady();
        const result = await buildPhoneChatExportPayload({ filenameStyle: 'backup' });
        if (!result) {
            console.log(`${LOG} silent backup skipped (no messages)${reason ? ` — ${reason}` : ''}`);
            return;
        }
        _triggerBrowserDownload(result.filename, result.json);
        console.log(`${LOG} silent backup downloaded: ${result.filename} (${result.messageCount} msgs)${reason ? ` — ${reason}` : ''}`);
    } catch (err) {
        console.warn(`${LOG} silent backup failed (non-fatal):`, err?.message || err);
    }
}

// ───────────────────────────────────────────────────────────────────────
// Import
// ───────────────────────────────────────────────────────────────────────

function _openFilePicker() {
    // Reuse a single hidden input across clicks so cancel doesn't leak nodes.
    if (!_fileInputEl) {
        _fileInputEl = document.createElement('input');
        _fileInputEl.type = 'file';
        _fileInputEl.accept = 'application/json,.json';
        _fileInputEl.style.display = 'none';
        document.body.appendChild(_fileInputEl);
        _fileInputEl.addEventListener('change', _onFilePicked);
    }
    // Clear value so picking the same file twice still fires change.
    _fileInputEl.value = '';
    _fileInputEl.click();
}

async function _onFilePicked(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    let text;
    try {
        text = await file.text();
    } catch (err) {
        _toast(`读取文件失败：${err?.message || err}`, 'error');
        return;
    }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        _toast('文件不是合法的 JSON', 'error');
        return;
    }

    // One step normalizes both supported input shapes into a single canonical
    // raw-shape object + an extras bag for envelope-only fields (stSyncMarker,
    // nickname) — the rest of the path treats both inputs uniformly.
    const norm = _normalizeImportPayload(parsed);
    if (!norm.ok) {
        _toast(`导入文件格式错误：${norm.error}`, 'error');
        return;
    }

    const validation = _validateCanonical(norm.canonical);
    if (!validation.ok) {
        _toast(`导入文件格式错误：${validation.error}`, 'error');
        return;
    }

    const messages = norm.canonical.messages;
    const currentCharName = getCharacterInfo()?.name || '当前角色';

    const confirmMsg = `准备导入 ${messages.length} 条消息（来源：${norm.sourceLabel}）。\n\n此操作将完全覆盖当前与「${currentCharName}」的会话记录、滚动总结和昵称。\n\n确定要继续吗？`;
    if (!confirm(confirmMsg)) return;

    try {
        await _applyImport(norm.canonical, norm.extras);
    } catch (err) {
        console.error(LOG, 'apply import failed:', err);
        _toast(`导入失败：${err?.message || err}`, 'error');
        return;
    }

    _toast(`已导入 ${messages.length} 条消息`, 'success');
    _unregisterBackHandler();
    // Re-open chat app so the user sees the freshly imported conversation.
    openChatApp().catch(err => console.warn(LOG, 'openChatApp after import failed:', err));
}

/**
 * Reduce any supported input file into a canonical raw-shape object plus
 * the envelope-only extras that aren't part of the raw shape.
 *
 * Two recognized inputs:
 *   1. Raw self-managed storage file (current export format and the file
 *      chatHistoryStore writes to /user/files/ghostface_chat_*.json):
 *        { schema: number, messages, nextFloor, summary, summaryHistory, homeMarker }
 *      Direct mapping; extras is empty.
 *   2. Legacy export envelope (`format: 'ghostface-chat-export'`, v1/v2/v3):
 *      Unwrap `data.*` into raw shape, lift `data.stSyncMarker` and
 *      `source.nickname` into extras so _applyImport can restore them when
 *      present.
 *
 * Returned `canonical.summaryHistory` is undefined (NOT []) when the input
 * lacked it — _applyImport uses that distinction to leave the destination's
 * existing summary archive intact instead of wiping it. Same convention for
 * `extras.stSyncMarker` and `extras.nickname`: undefined ⇒ "do not touch".
 */
function _normalizeImportPayload(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
        return { ok: false, error: '内容为空或不是对象' };
    }

    // Legacy envelope path.
    if (p.format === LEGACY_FORMAT_ID) {
        if (typeof p.version !== 'number' || p.version < 1 || p.version > LEGACY_MAX_VERSION) {
            return { ok: false, error: `不支持的版本 ${p.version}` };
        }
        const d = p.data;
        if (!d || typeof d !== 'object') {
            return { ok: false, error: '缺少 data 段' };
        }
        if (!Array.isArray(d.history)) {
            return { ok: false, error: 'history 不是数组' };
        }
        return {
            ok: true,
            canonical: {
                schema: 2,
                messages: d.history,
                nextFloor: typeof d.nextFloor === 'number' ? d.nextFloor : undefined,
                summary: typeof d.summary === 'string' ? d.summary : '',
                summaryHistory: Array.isArray(d.summaryHistory) ? d.summaryHistory : undefined,
                homeMarker: typeof d.homeMarker === 'string' ? d.homeMarker : '',
            },
            extras: {
                stSyncMarker: typeof d.stSyncMarker === 'string' ? d.stSyncMarker : undefined,
                nickname: typeof p.source?.nickname === 'string' ? p.source.nickname : undefined,
            },
            sourceLabel: p.source?.charName || '未知角色',
        };
    }

    // Raw storage shape path.
    if (typeof p.schema === 'number' && Array.isArray(p.messages)) {
        return {
            ok: true,
            canonical: {
                schema: p.schema,
                messages: p.messages,
                nextFloor: typeof p.nextFloor === 'number' ? p.nextFloor : undefined,
                summary: typeof p.summary === 'string' ? p.summary : '',
                summaryHistory: Array.isArray(p.summaryHistory) ? p.summaryHistory : undefined,
                homeMarker: typeof p.homeMarker === 'string' ? p.homeMarker : '',
            },
            extras: {},
            sourceLabel: '聊天数据快照',
        };
    }

    return { ok: false, error: '无法识别的文件格式' };
}

function _validateCanonical(c) {
    if (!Array.isArray(c.messages)) {
        return { ok: false, error: 'messages 不是数组' };
    }
    // Light shape check on the first message — guards against someone uploading
    // a different ST export by mistake. We don't deeply validate every message:
    // forward compatibility wins over strictness, and our own loader is lenient.
    if (c.messages.length > 0) {
        const m = c.messages[0];
        if (!m || typeof m !== 'object' || typeof m.content !== 'string' || !('role' in m)) {
            return { ok: false, error: '消息结构不符合预期' };
        }
    }
    return { ok: true };
}

async function _applyImport(canonical, extras) {
    const messages = canonical.messages;
    // Stamp floor ids on every imported message + seed the counter BEFORE
    // saveChatHistory queues the write — saveHistory snapshots the counter
    // at queue time, so a later setNextFloor would land on the next write
    // instead of this one. Works for both backends; see prepareImportedFloors.
    await prepareImportedFloors(messages, canonical.nextFloor);
    // Order matters mildly: history first (largest write, most likely to fail),
    // then markers / summary / nickname. If history save throws we abort before
    // touching anything else, leaving the chat in its prior state.
    //
    // allowEmpty: importing a zero-message snapshot IS the user's intent —
    // the empty-write safety net in chatHistoryStore.saveHistory would
    // otherwise refuse to overwrite a populated file. We've reached this
    // call after explicit user confirmation of the import.
    await saveChatHistory(messages, { allowEmpty: messages.length === 0 });
    await saveChatSummary(canonical.summary);
    // summaryHistory undefined ⇒ source file had no entry (raw shape default
    // OR legacy v1/v2 envelope) — leave the destination's existing summary
    // archive intact instead of wiping it. Explicit [] from a v3 envelope /
    // raw file still replaces (overwrite semantics match the rest of the
    // contract).
    if (Array.isArray(canonical.summaryHistory)) {
        await replaceChatSummaryHistory(canonical.summaryHistory);
    }
    await saveHomeMarker(canonical.homeMarker);
    // stSyncMarker / nickname only exist on legacy envelopes; on raw-shape
    // imports they're undefined and we leave the destination's values alone
    // (an undefined nickname must not clobber the current one with '').
    if (typeof extras.stSyncMarker === 'string') {
        await saveSTSyncMarker(extras.stSyncMarker);
    }
    if (typeof extras.nickname === 'string') {
        saveCharacterNickname(extras.nickname);
    }
}

// Pulls the active backend's persisted next-floor counter for export, with a
// max(history.floor)+1 fallback for the moment between schema upgrade and the
// first assignNextFloor call (counter not yet materialized on disk).
function _readActiveNextFloor(history) {
    let counter = chatHistoryStore.getNextFloor();
    if (typeof counter !== 'number') {
        // Either chat_metadata backend, or self-managed cache not primed.
        // Either way, derive from message data as a best-effort.
        if (Array.isArray(history) && history.length > 0) {
            let max = -1;
            for (const m of history) {
                if (typeof m?.floor === 'number' && m.floor > max) max = m.floor;
            }
            counter = max + 1;
        } else {
            counter = 0;
        }
    }
    return counter;
}

// ───────────────────────────────────────────────────────────────────────
// Misc
// ───────────────────────────────────────────────────────────────────────

function _toast(text, level = 'info') {
    if (typeof toastr === 'undefined') {
        console.log(LOG, text);
        return;
    }
    const fn = toastr[level] || toastr.info;
    fn(text, '', { timeOut: level === 'error' ? 4000 : 2500 });
}

function _formatTimestamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return sameYear
        ? `${m}月${day}日 ${hh}:${mm}`
        : `${d.getFullYear()}年${m}月${day}日 ${hh}:${mm}`;
}

// ───────────────────────────────────────────────────────────────────────
// Back navigation
// ───────────────────────────────────────────────────────────────────────

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

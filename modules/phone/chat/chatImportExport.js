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
    loadHomeMarker,
    saveHomeMarker,
    loadSTSyncMarker,
    saveSTSyncMarker,
    loadCharacterNickname,
    saveCharacterNickname,
    getCharacterInfo,
    getCharacterDisplayName,
    getCharacterId,
    ensureChatHistoryReady,
} from './chatStorage.js';
import { getContext } from '../../../../../../extensions.js';

const LOG = '[ChatImportExport]';
const FORMAT_ID = 'ghostface-chat-export';
const FORMAT_VERSION = 1;

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
                        <span class="chat-settings-item-label">导出聊天记录</span>
                        <i class="ph ph-caret-right chat-settings-item-chevron"></i>
                    </div>
                    <div class="chat-settings-item" id="chat_ie_import_btn">
                        <i class="ph ph-upload-simple chat-settings-item-icon"></i>
                        <span class="chat-settings-item-label">导入聊天记录</span>
                        <i class="ph ph-caret-right chat-settings-item-chevron"></i>
                    </div>
                </div>
            </div>

            <div class="chat-importexport-note">
                导入会<strong>完全覆盖</strong>当前会话的聊天记录、滚动总结和昵称设置。建议先导出做一份备份。
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

    const ctx = (() => { try { return getContext(); } catch { return {}; } })();
    const charInfo = getCharacterInfo() || {};
    const charName = charInfo.name || '';

    const payload = {
        format: FORMAT_ID,
        version: FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        source: {
            charName,
            charId: getCharacterId(),
            chatId: ctx?.chatId || ctx?.chat_id || '',
            nickname: loadCharacterNickname() || '',
        },
        stats: {
            messageCount: history.length,
            firstMessageAt: history[0]?.timestamp || '',
            lastMessageAt: history[history.length - 1]?.timestamp || '',
        },
        data: {
            history,
            summary: loadChatSummary() || '',
            homeMarker: loadHomeMarker() || '',
            stSyncMarker: loadSTSyncMarker() || '',
        },
    };

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

    let payload;
    try {
        payload = JSON.parse(text);
    } catch (err) {
        _toast('文件不是合法的 JSON', 'error');
        return;
    }

    const validation = _validatePayload(payload);
    if (!validation.ok) {
        _toast(`导入文件格式错误：${validation.error}`, 'error');
        return;
    }

    const history = payload.data.history;
    const sourceCharName = payload.source?.charName || '未知角色';
    const currentCharName = getCharacterInfo()?.name || '当前角色';

    const confirmMsg = `准备导入 ${history.length} 条消息（来源：${sourceCharName}）。\n\n此操作将完全覆盖当前与「${currentCharName}」的会话记录、滚动总结和昵称。\n\n确定要继续吗？`;
    if (!confirm(confirmMsg)) return;

    try {
        await _applyImport(payload);
    } catch (err) {
        console.error(LOG, 'apply import failed:', err);
        _toast(`导入失败：${err?.message || err}`, 'error');
        return;
    }

    _toast(`已导入 ${history.length} 条消息`, 'success');
    _unregisterBackHandler();
    // Re-open chat app so the user sees the freshly imported conversation.
    openChatApp().catch(err => console.warn(LOG, 'openChatApp after import failed:', err));
}

function _validatePayload(p) {
    if (!p || typeof p !== 'object') {
        return { ok: false, error: '内容为空' };
    }
    if (p.format !== FORMAT_ID) {
        return { ok: false, error: '不是鬼面聊天导出文件' };
    }
    if (typeof p.version !== 'number' || p.version < 1 || p.version > FORMAT_VERSION) {
        return { ok: false, error: `不支持的版本 ${p.version}` };
    }
    if (!p.data || typeof p.data !== 'object') {
        return { ok: false, error: '缺少 data 段' };
    }
    if (!Array.isArray(p.data.history)) {
        return { ok: false, error: 'history 不是数组' };
    }
    // Light shape check on the first message — guards against someone uploading
    // a different ST export by mistake. We don't deeply validate every message:
    // forward compatibility wins over strictness, and our own loader is lenient.
    if (p.data.history.length > 0) {
        const m = p.data.history[0];
        if (!m || typeof m !== 'object' || typeof m.content !== 'string' || !('role' in m)) {
            return { ok: false, error: '消息结构不符合预期' };
        }
    }
    return { ok: true };
}

async function _applyImport(payload) {
    const d = payload.data;
    // Order matters mildly: history first (largest write, most likely to fail),
    // then markers / summary / nickname. If history save throws we abort before
    // touching anything else, leaving the chat in its prior state.
    await saveChatHistory(d.history);
    await saveChatSummary(typeof d.summary === 'string' ? d.summary : '');
    await saveHomeMarker(typeof d.homeMarker === 'string' ? d.homeMarker : '');
    await saveSTSyncMarker(typeof d.stSyncMarker === 'string' ? d.stSyncMarker : '');

    const nickname = payload.source?.nickname;
    if (typeof nickname === 'string') {
        saveCharacterNickname(nickname);
    }
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

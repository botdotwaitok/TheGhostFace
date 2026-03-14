// modules/phone/voiceCall/vcStorage.js — Voice call log persistence
// Storage: chat_metadata (persisted inside .jsonl chat file, cross-device)

import { saveMetadataDebounced } from '../../../../../../extensions.js';
import { chat_metadata } from '../../../../../../../script.js';

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

const LOG_PREFIX = '[VoiceCallStorage]';
const META_KEY_LOGS = 'gf_voiceCallLogs';
const MAX_CALL_LOGS = 50;

// ═══════════════════════════════════════════════════════════════════════
// Call Log Shape:
// {
//   id: string,           // unique call ID (timestamp-based)
//   startTime: string,    // ISO timestamp
//   endTime: string,      // ISO timestamp
//   duration: number,     // seconds
//   summary: string,      // AI-generated brief summary (optional)
//   messages: [           // realtime transcript
//     { role: 'user'|'char', content: string, timestamp: string }
//   ]
// }
// ═══════════════════════════════════════════════════════════════════════

/**
 * Load all call logs from chat_metadata.
 * @returns {Array} call logs, newest first
 */
export function loadCallLogs() {
    try {
        const data = chat_metadata?.[META_KEY_LOGS];
        if (Array.isArray(data) && data.length > 0) return data;
    } catch (e) {
        console.warn(`${LOG_PREFIX} chat_metadata 读取失败:`, e);
    }
    return [];
}

/**
 * Save all call logs to chat_metadata.
 * Trims to MAX_CALL_LOGS (FIFO, oldest dropped).
 * @param {Array} logs
 */
function _saveCallLogs(logs) {
    const trimmed = logs.slice(0, MAX_CALL_LOGS);
    try {
        if (chat_metadata) {
            chat_metadata[META_KEY_LOGS] = trimmed;
            saveMetadataDebounced();
        }
    } catch (e) {
        console.warn(`${LOG_PREFIX} chat_metadata 保存失败:`, e);
    }
}

/**
 * Save a new call log. Prepends to the list (newest first).
 * @param {Object} log - Call log object
 */
export function saveCallLog(log) {
    const logs = loadCallLogs();
    logs.unshift(log);
    _saveCallLogs(logs);
    console.log(`${LOG_PREFIX} 📝 通话记录已保存 (ID: ${log.id}, 时长: ${log.duration}s, ${log.messages?.length || 0} 条消息)`);
}

/**
 * Get a single call log by ID.
 * @param {string} id
 * @returns {Object|null}
 */
export function getCallLog(id) {
    return loadCallLogs().find(l => l.id === id) || null;
}

/**
 * Delete a call log by ID.
 * @param {string} id
 * @returns {boolean} true if deleted
 */
export function deleteCallLog(id) {
    const logs = loadCallLogs();
    const idx = logs.findIndex(l => l.id === id);
    if (idx === -1) return false;
    logs.splice(idx, 1);
    _saveCallLogs(logs);
    console.log(`${LOG_PREFIX} 🗑️ 通话记录已删除 (ID: ${id})`);
    return true;
}

/**
 * Get the most recent call log (for chat prompt injection).
 * @returns {Object|null}
 */
export function getLatestCallLog() {
    const logs = loadCallLogs();
    return logs.length > 0 ? logs[0] : null;
}

/**
 * Generate a unique call ID based on timestamp.
 * @returns {string}
 */
export function generateCallId() {
    return `vc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

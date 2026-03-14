// utils.js
import { getContext, extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced, this_chid, characters } from '../../../../../script.js';
import { getCharaFilename } from '../../../../utils.js';



// 定义常量（避免依赖其她模块）
const MODULE_NAME = 'the_ghost_face';
const PANEL_ID = `${MODULE_NAME}_control_panel`;
const MAX_LOG_ENTRIES = 100;

// 系统初始化状态（全局管理）
let systemInitialized = false;

// 设置系统初始化状态的函数
export function setSystemInitialized(status) {
    systemInitialized = status;
    console.log(`🔧 [鬼面] 系统初始化状态: ${status}`);
}



// 日志级别
export const LOG_LEVEL = {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error'
};

// HTML转义函数
export function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// 改进的日志记录函数
export function logToUI(level, message, details = null) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString();
    const consoleMessage = `[鬼面][${timeStr}] ${message}`;
    const args = details != null ? [consoleMessage, details] : [consoleMessage];

    // 系统未初始化或面板容器不存在时，只输出到控制台
    const content = systemInitialized ? document.getElementById(`${PANEL_ID}_log_content`) : null;
    if (!content) {
        switch (level) {
            case LOG_LEVEL.DEBUG: console.debug(...args); break;
            case LOG_LEVEL.WARN: console.warn(...args); break;
            case LOG_LEVEL.ERROR: console.error(...args); break;
            default: console.log(...args);
        }
        return;
    }

    // 同时输出到控制台和面板
    switch (level) {
        case LOG_LEVEL.DEBUG: console.debug(...args); break;
        case LOG_LEVEL.INFO: console.info(...args); break;
        case LOG_LEVEL.WARN: console.warn(...args); break;
        case LOG_LEVEL.ERROR: console.error(...args); break;
        case 'SUCCESS': console.info(`✅ ${consoleMessage}`, ...(details != null ? [details] : [])); break;
        default: console.log(...args);
    }

    // 限制日志条目数量
    const logs = content.querySelectorAll('.log-line');
    if (logs.length >= MAX_LOG_ENTRIES) {
        for (let i = 0; i < 10 && logs[i]; i++) {
            logs[i].remove();
        }
    }

    // 日志级别 → CSS 类
    let levelClass = 'log-info';
    switch (level) {
        case LOG_LEVEL.DEBUG: levelClass = 'log-debug'; break;
        case LOG_LEVEL.INFO: levelClass = 'log-info'; break;
        case LOG_LEVEL.WARN: levelClass = 'log-warn'; break;
        case LOG_LEVEL.ERROR: levelClass = 'log-error'; break;
        case 'SUCCESS': levelClass = 'log-success'; break;
    }

    // 简单纯文本行
    const line = document.createElement('div');
    line.className = `log-line ${levelClass}`;
    const detailStr = details ? ` — ${typeof details === 'string' ? details : JSON.stringify(details)}` : '';
    line.textContent = `[${timeStr}] ${message}${detailStr}`;

    content.appendChild(line);
    content.scrollTop = content.scrollHeight;
}

// logger对象
export const logger = {
    debug: (msg, details) => logToUI(LOG_LEVEL.DEBUG, msg, details),
    info: (msg, details) => logToUI(LOG_LEVEL.INFO, msg, details),
    warn: (msg, details) => logToUI(LOG_LEVEL.WARN, msg, details),
    error: (msg, details) => logToUI(LOG_LEVEL.ERROR, msg, details),
    success: (msg, details) => logToUI('SUCCESS', msg, details)
};

// 获取最新的 character ID (数字索引)
export function getCurrentChid() {
    try {
        const ctx = typeof getContext === 'function' ? getContext() : null;
        if (ctx && ctx.characterId !== undefined) return ctx.characterId;
    } catch (e) { }
    return typeof this_chid !== 'undefined' ? this_chid : null;
}

// 获取当前角色的稳定文件名标识符（不随列表顺序变化）
export function getCharacterFileName() {
    try {
        const currentChid = getCurrentChid();
        if (currentChid === null || currentChid === undefined) return null;
        // getCharaFilename 是 ST 内置的，返回角色文件名（不含路径）
        if (typeof getCharaFilename === 'function') {
            const fileName = getCharaFilename(currentChid);
            if (fileName) return fileName;
        }
        // fallback: 从 characters 数组取 avatar 字段
        if (characters && characters[currentChid]) {
            return characters[currentChid].avatar || null;
        }
    } catch (e) {
        console.warn('[鬼面] getCharacterFileName error:', e);
    }
    return null;
}

// 获取当前聊天窗口的唯一 ID（用于 per-chat 世界书绑定）
export function getCurrentChatId() {
    try {
        const ctx = typeof getContext === 'function' ? getContext() : null;
        if (ctx && typeof ctx.getCurrentChatId === 'function') {
            return ctx.getCurrentChatId() ?? null;
        }
    } catch (e) { }
    return null;
}

// 将旧的数字索引 customWbMap 迁移为文件名格式
export function migrateCustomWbMap() {
    try {
        const map = extension_settings?.the_ghost_face?.customWbMap;
        if (!map || typeof map !== 'object') return;

        // 检查是否需要迁移：如果 key 是纯数字，说明是旧格式
        const keys = Object.keys(map);
        const needsMigration = keys.some(k => /^\d+$/.test(k));
        if (!needsMigration) return;

        console.log('[鬼面] 🔄 开始迁移 customWbMap 从数字索引到文件名格式...');
        const worldSelect = document.querySelector('#world_editor_select');
        const newMap = {};

        for (const [oldChid, oldWbValue] of Object.entries(map)) {
            // 如果 key 已经不是纯数字，保留原样
            if (!/^\d+$/.test(oldChid)) {
                newMap[oldChid] = oldWbValue;
                continue;
            }

            // 尝试把数字 chid 转换为角色文件名
            const chidNum = parseInt(oldChid);
            let charFileName = null;
            if (typeof getCharaFilename === 'function') {
                try { charFileName = getCharaFilename(chidNum); } catch { }
            }
            if (!charFileName && characters && characters[chidNum]) {
                charFileName = characters[chidNum]?.avatar;
            }

            // 尝试把数字 wb value 转换为世界书名
            let wbName = oldWbValue;
            if (/^\d+$/.test(oldWbValue) && worldSelect) {
                const option = Array.from(worldSelect.options).find(opt => opt.value === oldWbValue);
                if (option) {
                    wbName = option.textContent.trim();
                }
            }

            if (charFileName && wbName) {
                newMap[charFileName] = wbName;
                console.log(`[鬼面]   迁移: chid ${oldChid} → "${charFileName}" → wb "${wbName}"`);
            } else {
                console.warn(`[鬼面]   跳过: chid ${oldChid} (角色=${charFileName}, 世界书=${wbName})`);
            }
        }

        extension_settings.the_ghost_face.customWbMap = newMap;
        saveSettingsDebounced();
        console.log('[鬼面] ✅ customWbMap 迁移完成', newMap);
    } catch (e) {
        console.warn('[鬼面] customWbMap 迁移失败:', e);
    }
}

//查找绑定世界书（优先 per-chat，fallback per-character）
export async function findActiveWorldBook() {
    try {
        // 🥇 优先：per-chat 绑定（同角色不同聊天可绑不同世界书）
        const chatId = getCurrentChatId();
        if (chatId && extension_settings?.the_ghost_face?.customWbMap?.[chatId]) {
            const customWbName = extension_settings.the_ghost_face.customWbMap[chatId];
            console.log(`🔒 使用为聊天 "${chatId}" 绑定的世界书: ${customWbName}`);
            return customWbName;
        }

        // 🥈 Fallback: per-character 绑定（兼容旧数据）
        const charFileName = getCharacterFileName();
        if (charFileName && extension_settings?.the_ghost_face?.customWbMap?.[charFileName]) {
            const customWbName = extension_settings.the_ghost_face.customWbMap[charFileName];
            console.log(`🔒 使用角色 "${charFileName}" 的旧绑定世界书(fallback): ${customWbName}`);
            return customWbName;
        }

        return null;
    } catch (e) {
        console.warn('findActiveWorldBook error:', e);
        return null;
    }
}



// modules/phone/console/consoleApp.js — Console debugging app for the GF Phone
// Provides real-time log viewing, error tracking, and prompt inspection.

import { openAppInViewport } from '../phoneController.js';

// ═══════════════════════════════════════════════════════════════════════
// Constants & State
// ═══════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'gf_phone_console_enabled';
const MAX_LOG_ENTRIES = 200;
const PROMPT_PREVIEW_LENGTH = 200;

// Ring buffers for each tab
const _errorLogs = [];     // { time, level, message } — all error/warn from anywhere
const _moduleLogs = [];    // { time, level, message, source }
const _promptLogs = [];    // { time, label, systemPrompt, userPrompt }

// Module log prefixes we intercept
const MODULE_PREFIXES = [
    '[PhoneContext]',
    '[聊天]',
    '[鬼面]',
    '[GF Phone]',
    '[Phone]',
    '[Moments]',
    '[Shop]',
    '[Tree]',
    '[树树]',
    '[树树·LLM]',
    '[树树·游戏]',
    '[树树WI]',
    '[Tarot]',
    '[Diary]',
    '[Console]',
];

let _patchInstalled = false;
let _activeTab = 'module'; // 'error' | 'module' | 'prompt'

// ── Auto-install monkey-patch on module load if previously enabled ──
// This ensures logs are captured from the very start of a page session,
// not only after the user manually opens the Console app.
if (isConsoleEnabled() && !_patchInstalled) {
    // Defer slightly so other modules finish importing first
    setTimeout(() => installConsolePatch(), 0);
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/** Check if console app is enabled */
export function isConsoleEnabled() {
    return localStorage.getItem(STORAGE_KEY) === 'true';
}

/** Set console enabled state */
export function setConsoleEnabled(enabled) {
    localStorage.setItem(STORAGE_KEY, String(enabled));
    if (enabled && !_patchInstalled) {
        installConsolePatch();
    }
}

/** Push an error/warn log entry (called by the monkey-patch) */
export function pushErrorLog(message, level = 'error') {
    if (!isConsoleEnabled()) return;
    _pushLog(_errorLogs, { time: new Date(), level, message });
}

/** Push a prompt log entry (called after building prompts) */
export function pushPromptLog(label, systemPrompt, userPrompt) {
    if (!isConsoleEnabled()) return;
    _pushLog(_promptLogs, {
        time: new Date(),
        label: label || 'Chat Prompt',
        systemPrompt: systemPrompt || '',
        userPrompt: userPrompt || '',
    });
}

/** Open the Console app UI */
export function openConsoleApp() {
    // If console is not enabled in Settings, show a disabled-state page
    if (!isConsoleEnabled()) {
        const disabledHtml = `
        <div class="console-app" id="console_app_root" style="display:flex; align-items:center; justify-content:center; height:100%;">
            <div style="text-align:center; padding:40px 20px; color:#8e8e93;">
                <div style="font-size:48px; margin-bottom:16px; opacity:0.3;">🖥️</div>
                <div style="font-size:16px; font-weight:600; color:#1c1c1e; margin-bottom:8px;">Console 未启用</div>
                <div style="font-size:14px; line-height:1.6;">
                    请前往 <b>设置</b> → <b>开发者工具</b><br>打开 Console 调试工具开关
                </div>
            </div>
        </div>`;
        openAppInViewport('Console', disabledHtml, () => {});
        return;
    }

    // Ensure patch is installed whenever the app opens
    if (!_patchInstalled) installConsolePatch();

    const html = buildConsolePageHtml();
    openAppInViewport('Console', html, () => bindConsoleEvents());
}

// ═══════════════════════════════════════════════════════════════════════
// Console Monkey-Patch — intercepts console.* calls from phone modules
// ═══════════════════════════════════════════════════════════════════════

function installConsolePatch() {
    if (_patchInstalled) return;
    _patchInstalled = true;

    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);
    const origInfo = console.info.bind(console);
    const origDebug = console.debug.bind(console);

    function intercept(level, origFn, args) {
        // Always call original
        origFn(...args);

        // Only capture if console is enabled
        if (!isConsoleEnabled()) return;

        // Convert args to a single string
        const message = args.map(a => {
            if (typeof a === 'string') return a;
            try { return JSON.stringify(a, null, 0); } catch { return String(a); }
        }).join(' ');

        // Check if it matches any known phone module prefix
        const isPhoneModule = MODULE_PREFIXES.some(p => message.includes(p));

        // Capture ALL error/warn messages globally (not just phone modules)
        if (level === 'error' || level === 'warn') {
            _pushLog(_errorLogs, { time: new Date(), level, message });
        }

        if (isPhoneModule) {
            // Determine source from prefix
            const source = MODULE_PREFIXES.find(p => message.includes(p)) || '[Unknown]';
            _pushLog(_moduleLogs, { time: new Date(), level, message, source });
        }
    }

    console.log = (...args) => intercept('log', origLog, args);
    console.warn = (...args) => intercept('warn', origWarn, args);
    console.error = (...args) => intercept('error', origError, args);
    console.info = (...args) => intercept('info', origInfo, args);
    console.debug = (...args) => intercept('debug', origDebug, args);

    // ─── Browser-level errors (404, script errors, etc.) ───
    // These bypass console.error() entirely, so we need event listeners.
    window.addEventListener('error', (event) => {
        if (!isConsoleEnabled()) return;
        let msg;
        if (event.target && (event.target.tagName === 'IMG' || event.target.tagName === 'SCRIPT' || event.target.tagName === 'LINK')) {
            // Resource load failure (404, etc.)
            const url = event.target.src || event.target.href || '(unknown)';
            msg = `[Resource Error] Failed to load ${event.target.tagName.toLowerCase()}: ${url}`;
        } else if (event.message) {
            // JS runtime error
            msg = `[JS Error] ${event.message} (${event.filename || '?'}:${event.lineno || '?'})`;
        } else {
            return; // Not interesting
        }
        _pushLog(_errorLogs, { time: new Date(), level: 'error', message: msg });
    }, true); // useCapture = true to catch resource errors

    window.addEventListener('unhandledrejection', (event) => {
        if (!isConsoleEnabled()) return;
        const reason = event.reason;
        const msg = `[Unhandled Promise] ${reason?.message || reason?.toString() || String(reason)}`;
        _pushLog(_errorLogs, { time: new Date(), level: 'error', message: msg });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Internal — Ring Buffer
// ═══════════════════════════════════════════════════════════════════════

function _pushLog(buffer, entry) {
    buffer.push(entry);
    if (buffer.length > MAX_LOG_ENTRIES) {
        buffer.splice(0, buffer.length - MAX_LOG_ENTRIES);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// UI — Page Builder
// ═══════════════════════════════════════════════════════════════════════

function buildConsolePageHtml() {
    return `
    <div class="console-app" id="console_app_root">
        <!-- Tab bar -->
        <div class="console-tab-bar">
            <button class="console-tab ${_activeTab === 'module' ? 'active' : ''}" data-tab="module">
                [模块日志]
            </button>
            <button class="console-tab ${_activeTab === 'error' ? 'active' : ''}" data-tab="error">
                [错误]
            </button>
            <button class="console-tab ${_activeTab === 'prompt' ? 'active' : ''}" data-tab="prompt">
                [提示词]
            </button>
        </div>

        <!-- Tab content -->
        <div class="console-content" id="console_content">
            ${renderTabContent(_activeTab)}
        </div>

        <!-- Action bar -->
        <div class="console-action-bar">
            <button class="console-action-btn" id="console_clear_btn">
                [清除]
            </button>
            <button class="console-action-btn" id="console_refresh_btn">
                [刷新]
            </button>
            <span class="console-log-count" id="console_log_count">${getActiveLogCount()} 条</span>
        </div>
    </div>`;
}

function renderTabContent(tab) {
    switch (tab) {
        case 'error':
            return renderLogList(_errorLogs, '暂无错误/警告日志\n\n所有 console.error 和 console.warn 会被捕获到这里');
        case 'module':
            return renderLogList(_moduleLogs, '暂无模块日志\n\n日志会在手机模块运行时自动捕获');
        case 'prompt':
            return renderPromptList();
        default:
            return '';
    }
}

function renderLogList(logs, emptyMessage) {
    if (logs.length === 0) {
        return `<div class="console-empty">
            <div>C:\\> _</div>
            <div>${escHtml(emptyMessage)}</div>
        </div>`;
    }

    // Show newest first
    const reversed = [...logs].reverse();
    return reversed.map((entry, i) => {
        const timeStr = formatTime(entry.time);
        const levelClass = `console-level-${entry.level || 'log'}`;
        const levelIcon = getLevelIcon(entry.level);
        return `
        <div class="console-log-entry ${levelClass}">
            <div class="console-log-header">
                <span class="console-log-icon">${levelIcon}</span>
                <span class="console-log-time">${timeStr}</span>
                ${entry.source ? `<span class="console-log-source">${escHtml(entry.source)}</span>` : ''}
            </div>
            <div class="console-log-message">${escHtml(entry.message)}</div>
        </div>`;
    }).join('');
}

function renderPromptList() {
    if (_promptLogs.length === 0) {
        return `<div class="console-empty">
            <div>C:\\> _</div>
            <div>暂无提示词记录</div>
            <div style="font-size: 12px; opacity: 0.6; margin-top: 4px;">在聊天 App 发送消息后，提示词会自动捕获到这里</div>
        </div>`;
    }

    const reversed = [..._promptLogs].reverse();
    return reversed.map((entry, i) => {
        const timeStr = formatTime(entry.time);
        const sysPreview = truncatePrompt(entry.systemPrompt, PROMPT_PREVIEW_LENGTH);
        const userPreview = truncatePrompt(entry.userPrompt, PROMPT_PREVIEW_LENGTH);

        return `
        <div class="console-prompt-entry" data-prompt-index="${_promptLogs.length - 1 - i}">
            <div class="console-prompt-header">
                <span class="console-prompt-label">${escHtml(entry.label)}</span>
                <span class="console-prompt-time">${timeStr}</span>
            </div>
            <div class="console-prompt-preview">
                <div class="console-prompt-section">
                    <div class="console-prompt-section-title">System Prompt</div>
                    <div class="console-prompt-section-preview">${escHtml(sysPreview)}</div>
                </div>
                <div class="console-prompt-section">
                    <div class="console-prompt-section-title">User Prompt</div>
                    <div class="console-prompt-section-preview">${escHtml(userPreview)}</div>
                </div>
            </div>
            <div class="console-prompt-full" style="display:none;">
                <div class="console-prompt-section">
                    <div class="console-prompt-section-title">System Prompt (完整)</div>
                    <pre class="console-prompt-full-text">${escHtml(entry.systemPrompt)}</pre>
                </div>
                <div class="console-prompt-section">
                    <div class="console-prompt-section-title">User Prompt (完整)</div>
                    <pre class="console-prompt-full-text">${escHtml(entry.userPrompt)}</pre>
                </div>
            </div>
            <div class="console-prompt-toggle">
                [+] 展开完整内容
            </div>
        </div>`;
    }).join('');
}

function getActiveLogCount() {
    switch (_activeTab) {
        case 'error': return _errorLogs.length;
        case 'module': return _moduleLogs.length;
        case 'prompt': return _promptLogs.length;
        default: return 0;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// UI — Event Binding
// ═══════════════════════════════════════════════════════════════════════

function bindConsoleEvents() {
    // Tab switching
    document.querySelectorAll('.console-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            _activeTab = tab.dataset.tab;
            // Update active state
            document.querySelectorAll('.console-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            // Re-render content
            const content = document.getElementById('console_content');
            if (content) content.innerHTML = renderTabContent(_activeTab);
            // Update count
            const countEl = document.getElementById('console_log_count');
            if (countEl) countEl.textContent = `${getActiveLogCount()} 条`;
            // Re-bind prompt toggles
            bindPromptToggles();
        });
    });

    // Clear button
    const clearBtn = document.getElementById('console_clear_btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            switch (_activeTab) {
                case 'error': _errorLogs.length = 0; break;
                case 'module': _moduleLogs.length = 0; break;
                case 'prompt': _promptLogs.length = 0; break;
            }
            const content = document.getElementById('console_content');
            if (content) content.innerHTML = renderTabContent(_activeTab);
            const countEl = document.getElementById('console_log_count');
            if (countEl) countEl.textContent = '0 条';
        });
    }

    // Refresh button
    const refreshBtn = document.getElementById('console_refresh_btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            const content = document.getElementById('console_content');
            if (content) content.innerHTML = renderTabContent(_activeTab);
            const countEl = document.getElementById('console_log_count');
            if (countEl) countEl.textContent = `${getActiveLogCount()} 条`;
            bindPromptToggles();
        });
    }

    // Prompt expand/collapse
    bindPromptToggles();
}

function bindPromptToggles() {
    document.querySelectorAll('.console-prompt-entry').forEach(entry => {
        const toggle = entry.querySelector('.console-prompt-toggle');
        if (!toggle) return;

        // Remove old listener by cloning
        const newToggle = toggle.cloneNode(true);
        toggle.parentNode.replaceChild(newToggle, toggle);

        newToggle.addEventListener('click', () => {
            const preview = entry.querySelector('.console-prompt-preview');
            const full = entry.querySelector('.console-prompt-full');
            if (!preview || !full) return;

            const isExpanded = full.style.display !== 'none';
            if (isExpanded) {
                full.style.display = 'none';
                preview.style.display = '';
                newToggle.innerHTML = '[+] 展开完整内容';
            } else {
                full.style.display = '';
                preview.style.display = 'none';
                newToggle.innerHTML = '[-] 收起';
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function formatTime(date) {
    if (!date) return '--:--:--';
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function getLevelIcon(level) {
    switch (level) {
        case 'error': return '[ERR]';
        case 'warn': return '[WRN]';
        case 'info': return '[INF]';
        case 'debug': return '[DBG]';
        default: return '[LOG]';
    }
}

function truncatePrompt(text, maxLen) {
    if (!text) return '(空)';
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen) + '…';
}

function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

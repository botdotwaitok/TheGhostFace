// modules/phone/console/consoleApp.js — Console debugging app for the GF Phone
// Provides real-time log viewing, error tracking, network monitoring, and prompt inspection.
// Inspired by Chrome DevTools — with left sidebar tabs, object tree, search, auto-refresh.

import { openAppInViewport } from '../phoneController.js';


// ═══════════════════════════════════════════════════════════════════════
// Constants & State
// ═══════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'gf_phone_console_enabled';
const MAX_LOG_ENTRIES = 300;
const PROMPT_PREVIEW_LENGTH = 200;
const AUTO_REFRESH_INTERVAL = 1000; // ms
const MAX_OBJ_DEPTH = 4;
const MAX_OBJ_KEYS = 50;

// Ring buffers for each tab
const _allLogs = [];       // { time, level, args } — ALL console.* calls
const _errorLogs = [];     // { time, level, args } — error/warn only
const _moduleLogs = [];    // { time, level, args, source } — phone module logs
const _networkLogs = [];   // { time, method, url, status, duration, error, isLLM, llmInfo, requestBody }
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
    '[VoiceCall]',
    '[Calendar]',
    '[Friends]',
    '[Settings]',
    '[D&D]',
];

let _patchInstalled = false;
let _fetchPatchInstalled = false;
let _activeTab = 'all'; // 'all' | 'module' | 'error' | 'network' | 'prompt'
let _autoRefresh = true;
let _autoRefreshTimer = null;
let _filterText = '';
let _lastRenderedCount = -1; // track for smart refresh

// ── Auto-install monkey-patch on module load if previously enabled ──
if (isConsoleEnabled() && !_patchInstalled) {
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
    _pushLog(_errorLogs, { time: new Date(), level, args: [message] });
}

/** Push a prompt log entry (called after building prompts) */
export function pushPromptLog(label, systemPrompt, userPrompt) {
    if (!isConsoleEnabled()) return;
    const entry = {
        time: new Date(),
        label: label || 'Chat Prompt',
        systemPrompt: systemPrompt || '',
        userPrompt: userPrompt || '',
    };
    _pushLog(_promptLogs, entry);
}



/** Open the Console app UI */
export function openConsoleApp() {
    // If console is not enabled in Settings, show a disabled-state page
    if (!isConsoleEnabled()) {
        const disabledHtml = `
        <div class="console-app" id="console_app_root" style="display:flex; align-items:center; justify-content:center; height:100%;">
            <div style="text-align:center; padding:40px 20px; color:#8e8e93;">
                <div style="font-size:48px; margin-bottom:16px; opacity:0.3;"><i class="ph ph-terminal"></i></div>
                <div style="font-size:16px; font-weight:600; color:#1c1c1e; margin-bottom:8px;">Console 未启用</div>
                <div style="font-size:14px; line-height:1.6;">
                    请前往 <b>设置</b> → <b>开发者工具</b><br>打开 Console 调试工具开关
                </div>
            </div>
        </div>`;
        openAppInViewport('Console', disabledHtml, () => {});
        return;
    }

    // Ensure patches are installed whenever the app opens
    if (!_patchInstalled) installConsolePatch();
    if (!_fetchPatchInstalled) installFetchPatch();

    const html = buildConsolePageHtml();
    openAppInViewport('Console', html, () => {
        bindConsoleEvents();
        startAutoRefresh();
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Console Monkey-Patch — intercepts console.* calls
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

        // Deep-clone args for storage (avoid holding references to large live objects)
        const clonedArgs = args.map(a => _safeClone(a));

        // ── Push to ALL logs (like Chrome F12 — everything shows up) ──
        _pushLog(_allLogs, { time: new Date(), level, args: clonedArgs });

        // ── Error/warn → error tab ──
        if (level === 'error' || level === 'warn') {
            _pushLog(_errorLogs, { time: new Date(), level, args: clonedArgs });
        }

        // ── Module detection → module tab ──
        const firstStr = typeof args[0] === 'string' ? args[0] : '';
        const matchedPrefix = MODULE_PREFIXES.find(p => firstStr.includes(p));
        if (matchedPrefix) {
            _pushLog(_moduleLogs, { time: new Date(), level, args: clonedArgs, source: matchedPrefix });
        }
    }

    console.log = (...args) => intercept('log', origLog, args);
    console.warn = (...args) => intercept('warn', origWarn, args);
    console.error = (...args) => intercept('error', origError, args);
    console.info = (...args) => intercept('info', origInfo, args);
    console.debug = (...args) => intercept('debug', origDebug, args);

    // ─── Browser-level errors (404, script errors, etc.) ───
    window.addEventListener('error', (event) => {
        if (!isConsoleEnabled()) return;
        let msg;
        if (event.target && (event.target.tagName === 'IMG' || event.target.tagName === 'SCRIPT' || event.target.tagName === 'LINK')) {
            const url = event.target.src || event.target.href || '(unknown)';
            msg = `[Resource Error] Failed to load ${event.target.tagName.toLowerCase()}: ${url}`;
        } else if (event.message) {
            msg = `[JS Error] ${event.message} (${event.filename || '?'}:${event.lineno || '?'})`;
        } else {
            return;
        }
        _pushLog(_errorLogs, { time: new Date(), level: 'error', args: [msg] });
        _pushLog(_allLogs, { time: new Date(), level: 'error', args: [msg] });
    }, true);

    window.addEventListener('unhandledrejection', (event) => {
        if (!isConsoleEnabled()) return;
        const reason = event.reason;
        const msg = `[Unhandled Promise] ${reason?.message || reason?.toString() || String(reason)}`;
        _pushLog(_errorLogs, { time: new Date(), level: 'error', args: [msg] });
        _pushLog(_allLogs, { time: new Date(), level: 'error', args: [msg] });
    });

    // Also install fetch patch
    installFetchPatch();
}

// ═══════════════════════════════════════════════════════════════════════
// Fetch Monkey-Patch — intercepts all network requests
// ═══════════════════════════════════════════════════════════════════════

function installFetchPatch() {
    if (_fetchPatchInstalled) return;
    _fetchPatchInstalled = true;

    const origFetch = window.fetch.bind(window);

    window.fetch = async function patchedFetch(input, init) {
        if (!isConsoleEnabled()) {
            return origFetch(input, init);
        }

        const startTime = performance.now();
        const method = (init?.method || 'GET').toUpperCase();
        const url = typeof input === 'string' ? input : (input?.url || String(input));

        // Detect LLM calls
        const isLLM = _isLLMRequest(url, init);
        let requestBody = null;
        if (isLLM && init?.body) {
            try { requestBody = JSON.parse(init.body); } catch { /* not JSON */ }
        }

        const entry = {
            time: new Date(),
            method,
            url: _shortenUrl(url),
            fullUrl: url,
            status: null,
            duration: null,
            error: null,
            isLLM,
            llmInfo: null,
            requestBody,
        };

        try {
            const response = await origFetch(input, init);
            entry.status = response.status;
            entry.duration = Math.round(performance.now() - startTime);

            // Extract LLM info from response — but SKIP for streaming (SSE)
            // responses. Calling clone.json() on a stream blocks until the
            // entire body is consumed, which delays returning the response
            // to SillyTavern and breaks the typewriter streaming effect.
            if (isLLM && response.ok) {
                const contentType = response.headers.get('content-type') || '';
                const isStreamingResponse =
                    contentType.includes('text/event-stream') ||
                    contentType.includes('text/plain') ||
                    (requestBody && requestBody.stream === true);

                if (isStreamingResponse) {
                    // For streaming, just record the model from request body
                    entry.llmInfo = { model: requestBody?.model || '?', streaming: true };
                } else {
                    try {
                        const clone = response.clone();
                        const data = await clone.json();
                        entry.llmInfo = _extractLLMInfo(data, requestBody);
                    } catch { /* response not JSON or already consumed */ }
                }
            }

            _pushLog(_networkLogs, entry);
            return response;
        } catch (err) {
            entry.error = err.message || String(err);
            entry.duration = Math.round(performance.now() - startTime);
            _pushLog(_networkLogs, entry);
            throw err;
        }
    };
}

function _isLLMRequest(url, init) {
    const method = (init?.method || 'GET').toUpperCase();
    if (method !== 'POST') return false;
    // Common LLM endpoints
    return url.includes('/chat/completions') ||
           url.includes('/api/backends/chat-completions/generate') ||
           url.includes('generativelanguage.googleapis.com') ||
           url.includes('/v1/completions');
}

function _shortenUrl(url) {
    try {
        const u = new URL(url, window.location.origin);
        // For same-origin, show just the path
        if (u.origin === window.location.origin) {
            return u.pathname + (u.search ? u.search.substring(0, 30) : '');
        }
        // For external, show host + path
        return u.host + u.pathname.substring(0, 40);
    } catch {
        return url.substring(0, 60);
    }
}

function _extractLLMInfo(data, requestBody) {
    const info = {};
    // Model
    info.model = data?.model || requestBody?.model || '?';
    // Token usage
    if (data?.usage) {
        info.promptTokens = data.usage.prompt_tokens;
        info.completionTokens = data.usage.completion_tokens;
        info.totalTokens = data.usage.total_tokens;
    }
    // Finish reason
    if (data?.choices?.[0]?.finish_reason) {
        info.finishReason = data.choices[0].finish_reason;
    }
    return info;
}

// ═══════════════════════════════════════════════════════════════════════
// Internal — Ring Buffer & Utilities
// ═══════════════════════════════════════════════════════════════════════

function _pushLog(buffer, entry) {
    buffer.push(entry);
    if (buffer.length > MAX_LOG_ENTRIES) {
        buffer.splice(0, buffer.length - MAX_LOG_ENTRIES);
    }
}

function _safeClone(val) {
    if (val === null || val === undefined) return val;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return val;
    try {
        // structuredClone handles most cases
        return structuredClone(val);
    } catch {
        try {
            return JSON.parse(JSON.stringify(val));
        } catch {
            return String(val);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// UI — Page Builder (Left Sidebar Layout)
// ═══════════════════════════════════════════════════════════════════════

function buildConsolePageHtml() {
    return `
    <div class="console-app" id="console_app_root">
        <!-- Left sidebar tabs -->
        <div class="console-sidebar">
            <button class="console-side-tab ${_activeTab === 'all' ? 'active' : ''}" data-tab="all" title="全部日志">
                <span class="console-side-icon"><i class="ph ph-list-bullets"></i></span>
                <span class="console-side-label">全部</span>
            </button>
            <button class="console-side-tab ${_activeTab === 'module' ? 'active' : ''}" data-tab="module" title="模块日志">
                <span class="console-side-icon"><i class="ph ph-package"></i></span>
                <span class="console-side-label">模块</span>
            </button>
            <button class="console-side-tab ${_activeTab === 'error' ? 'active' : ''}" data-tab="error" title="错误/警告">
                <span class="console-side-icon"><i class="ph ph-warning"></i></span>
                <span class="console-side-label">错误</span>
                ${_errorLogs.length > 0 ? `<span class="console-side-badge">${_errorLogs.length}</span>` : ''}
            </button>
            <button class="console-side-tab ${_activeTab === 'network' ? 'active' : ''}" data-tab="network" title="网络请求">
                <span class="console-side-icon"><i class="ph ph-globe"></i></span>
                <span class="console-side-label">网络</span>
            </button>
            <button class="console-side-tab ${_activeTab === 'prompt' ? 'active' : ''}" data-tab="prompt" title="提示词">
                <span class="console-side-icon"><i class="ph ph-chat-text"></i></span>
                <span class="console-side-label">提示词</span>
            </button>
        </div>

        <!-- Main content area -->
        <div class="console-main">
            <!-- Toolbar -->
            <div class="console-toolbar">
                <input type="text" class="console-filter-input" id="console_filter"
                    placeholder="过滤..." value="${escHtml(_filterText)}">
                <button class="console-tool-btn ${_autoRefresh ? 'active' : ''}" id="console_auto_btn"
                    title="${_autoRefresh ? '自动刷新中' : '手动模式'}">
                    ${_autoRefresh ? '<i class="ph ph-pause"></i>' : '<i class="ph ph-play"></i>'}
                </button>
                <button class="console-tool-btn" id="console_clear_btn" title="清除"><i class="ph ph-trash"></i></button>
                <span class="console-log-count" id="console_log_count">${getActiveLogCount()} 条</span>
            </div>

            <!-- Tab content -->
            <div class="console-content" id="console_content">
                ${renderTabContent(_activeTab)}
            </div>
        </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// UI — Tab Content Rendering
// ═══════════════════════════════════════════════════════════════════════

function renderTabContent(tab) {
    switch (tab) {
        case 'all':
            return renderLogList(_allLogs, '暂无日志\n\n所有 console.* 输出会被捕获到这里\n就像 Chrome F12 Console 一样');
        case 'error':
            return renderLogList(_errorLogs, '暂无错误/警告日志\n\nconsole.error 和 console.warn 会被捕获到这里');
        case 'module':
            return renderLogList(_moduleLogs, '暂无模块日志\n\n手机模块运行时的日志会自动捕获');
        case 'network':
            return renderNetworkList();
        case 'prompt':
            return renderPromptList();
        default:
            return '';
    }
}

function renderLogList(logs, emptyMessage) {
    const filtered = _applyFilter(logs, entry => _argsToString(entry.args));
    if (filtered.length === 0) {
        const isEmpty = logs.length === 0;
        return `<div class="console-empty">
            <div>C:\\> _</div>
            <div>${escHtml(isEmpty ? emptyMessage : '没有匹配的日志')}</div>
        </div>`;
    }

    // Show newest first
    const reversed = [...filtered].reverse();
    return reversed.map(entry => {
        const timeStr = formatTime(entry.time);
        const levelClass = `console-level-${entry.level || 'log'}`;
        const levelIcon = getLevelIcon(entry.level);
        const argsHtml = entry.args.map(a => renderValue(a, 0)).join(' ');
        return `
        <div class="console-log-entry ${levelClass}">
            <div class="console-log-header">
                <span class="console-log-icon">${levelIcon}</span>
                <span class="console-log-time">${timeStr}</span>
                ${entry.source ? `<span class="console-log-source">${escHtml(entry.source)}</span>` : ''}
            </div>
            <div class="console-log-message">${argsHtml}</div>
        </div>`;
    }).join('');
}

function _renderSingleNetEntry(entry) {
    const timeStr = formatTime(entry.time);
    const statusClass = entry.error ? 'console-net-status-err'
        : (entry.status && entry.status >= 400) ? 'console-net-status-err'
        : 'console-net-status-ok';
    const statusText = entry.error ? 'ERR' : (entry.status || '...');
    const durationText = entry.duration != null ? `${entry.duration}ms` : '...';

    let llmBadge = '';
    let llmDetail = '';
    if (entry.isLLM) {
        llmBadge = '<span class="console-net-llm-badge">LLM</span>';
        if (entry.llmInfo) {
            const parts = [];
            if (entry.llmInfo.model) parts.push(`model: ${entry.llmInfo.model}`);
            if (entry.llmInfo.totalTokens) parts.push(`tokens: ${entry.llmInfo.totalTokens}`);
            if (entry.llmInfo.finishReason) parts.push(`finish: ${entry.llmInfo.finishReason}`);
            if (parts.length > 0) {
                llmDetail = `<div class="console-net-llm-detail">${escHtml(parts.join(' · '))}</div>`;
            }
        }
    }

    return `
    <div class="console-net-entry ${statusClass}" data-full-url="${escHtml(entry.fullUrl || entry.url)}">
        <div class="console-net-header">
            <span class="console-net-method">${entry.method}</span>
            <span class="console-net-status">${statusText}</span>
            ${llmBadge}
            <span class="console-net-time">${timeStr}</span>
        </div>
        <div class="console-net-url">${escHtml(entry.url)}</div>
        <div class="console-net-meta">
            <span class="console-net-duration">${durationText}</span>
            ${entry.error ? `<span class="console-net-error">${escHtml(entry.error)}</span>` : ''}
        </div>
        ${llmDetail}
    </div>`;
}

function renderNetworkList() {
    const filtered = _applyFilter(_networkLogs, entry => `${entry.method} ${entry.url} ${entry.status || ''}`);
    if (filtered.length === 0) {
        const isEmpty = _networkLogs.length === 0;
        return `<div class="console-empty">
            <div>C:\\> _</div>
            <div>${escHtml(isEmpty ? '暂无网络请求\n\n所有 fetch 请求会被自动捕获' : '没有匹配的请求')}</div>
        </div>`;
    }

    // Separate entries: non-200 (important) vs 200 (collapsible)
    const important = [];
    const ok200 = [];
    for (const entry of filtered) {
        if (entry.status === 200 && !entry.error && !entry.isLLM) {
            ok200.push(entry);
        } else {
            important.push(entry);
        }
    }

    // Render important entries (newest first)
    const importantHtml = [...important].reverse().map(e => _renderSingleNetEntry(e)).join('');

    // Render 200 group
    let ok200Html = '';
    if (ok200.length > 0) {
        const groupId = `net200_group_${Date.now()}`;
        const ok200Items = [...ok200].reverse().map(e => _renderSingleNetEntry(e)).join('');
        ok200Html = `
        <div class="console-net-200-group">
            <div class="console-net-200-header" onclick="
                const body = document.getElementById('${groupId}');
                const open = body.style.display !== 'none';
                body.style.display = open ? 'none' : 'block';
                this.querySelector('.console-net-200-arrow').textContent = open ? '▶' : '▼';
            ">
                <span class="console-net-200-arrow">▶</span>
                <span class="console-net-200-badge">200</span>
                <span class="console-net-200-count">${ok200.length} 条成功请求已折叠</span>
            </div>
            <div class="console-net-200-body" id="${groupId}" style="display:none;">
                ${ok200Items}
            </div>
        </div>`;
    }

    // If no important entries, just show the 200 group
    if (important.length === 0) {
        return `<div class="console-empty" style="min-height:auto; padding:16px 0;">
            <div style="color:#4ade80; font-size:13px;"><i class="ph ph-check-circle"></i> 暂无错误请求</div>
        </div>${ok200Html}`;
    }

    return importantHtml + ok200Html;
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



        // Build structured section outline (collapsed view)
        const sysOutline = _buildSectionOutline(entry.systemPrompt);
        const usrOutline = _buildSectionOutline(entry.userPrompt);

        return `
        <div class="console-prompt-entry" data-prompt-index="${_promptLogs.length - 1 - i}">
            <div class="console-prompt-header">
                <span class="console-prompt-label">${escHtml(entry.label)}</span>
                <span class="console-prompt-time">${timeStr}</span>
            </div>
            <div class="console-prompt-preview">
                <div class="console-prompt-section">
                    <div class="console-prompt-section-title">System Prompt</div>
                    <div class="console-prompt-section-preview">${sysOutline}</div>
                </div>
                <div class="console-prompt-section">
                    <div class="console-prompt-section-title">User Prompt</div>
                    <div class="console-prompt-section-preview">${usrOutline}</div>
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

/**
 * Parse a prompt string into a structured section outline.
 * Recognizes XML-like tags (<tag>, </tag>), markdown headers (### ...),
 * and labeled blocks (** ... **:) as section boundaries.
 * Returns an HTML string showing each section name + first ~80 chars.
 */
function _buildSectionOutline(text) {
    if (!text) return `<span style="opacity:0.4;">(空)</span>`;

    // Split into lines and identify section boundaries
    const lines = text.split('\n');
    const sections = [];
    let currentName = null;
    let currentContent = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Detect XML opening tags: <tag_name> or <tag_name attr="..."> (but not closing </tag>)
        const xmlMatch = trimmed.match(/^<([a-zA-Z_][a-zA-Z0-9_-]*)(?:\s[^>]*)?>$/);
        // Detect markdown headers: ### Title or ## Title
        const mdMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
        // Detect bold-labeled lines: **Label**: or **Label**
        const boldMatch = trimmed.match(/^\*\*(.+?)\*\*\s*[:：]?\s*$/);

        const isNewSection = xmlMatch || mdMatch || boldMatch;

        if (isNewSection) {
            // Flush previous section
            if (currentName !== null) {
                sections.push({ name: currentName, preview: currentContent.join(' ').substring(0, 80) });
            }
            // Start new section
            if (xmlMatch) {
                currentName = `<${xmlMatch[1]}>`;
            } else if (mdMatch) {
                currentName = mdMatch[2].trim();
            } else if (boldMatch) {
                currentName = boldMatch[1].trim();
            }
            currentContent = [];
        } else {
            // Skip XML closing tags from content preview
            if (/^<\/[a-zA-Z_][a-zA-Z0-9_-]*>$/.test(trimmed)) continue;
            currentContent.push(trimmed);
        }
    }
    // Flush last section
    if (currentName !== null) {
        sections.push({ name: currentName, preview: currentContent.join(' ').substring(0, 80) });
    }

    if (sections.length === 0) {
        // No sections found — show a flat truncated preview
        return escHtml(text.substring(0, 120)) + (text.length > 120 ? '…' : '');
    }

    // Render as compact outline
    return sections.map(s => {
        const preview = s.preview ? ` <span style="opacity:0.5;">${escHtml(s.preview)}${s.preview.length >= 80 ? '…' : ''}</span>` : '';
        return `<div style="line-height:1.5;"><span style="color:#007aff; font-weight:500;">${escHtml(s.name)}</span>${preview}</div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════════════
// UI — Object Tree Renderer (Chrome DevTools style)
// ═══════════════════════════════════════════════════════════════════════

function renderValue(val, depth) {
    if (val === null) return '<span class="console-val-null">null</span>';
    if (val === undefined) return '<span class="console-val-null">undefined</span>';

    switch (typeof val) {
        case 'string':
            // If it's a log message (first arg, depth 0), render as plain text
            if (depth === 0) return `<span class="console-val-string">${escHtml(val)}</span>`;
            return `<span class="console-val-string">"${escHtml(val)}"</span>`;
        case 'number':
            return `<span class="console-val-number">${val}</span>`;
        case 'boolean':
            return `<span class="console-val-boolean">${val}</span>`;
        case 'function':
            return `<span class="console-val-null">ƒ ${escHtml(val.name || 'anonymous')}</span>`;
    }

    // Object or Array
    if (typeof val === 'object') {
        if (depth >= MAX_OBJ_DEPTH) {
            return Array.isArray(val)
                ? `<span class="console-val-null">[Array(${val.length})]</span>`
                : `<span class="console-val-null">{…}</span>`;
        }

        const isArray = Array.isArray(val);
        const keys = Object.keys(val).slice(0, MAX_OBJ_KEYS);
        const bracket = isArray ? ['[', ']'] : ['{', '}'];
        const preview = _objectPreview(val, isArray);
        const uid = `obj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

        if (keys.length === 0) {
            return `<span class="console-val-null">${isArray ? '[]' : '{}'}</span>`;
        }

        const childrenHtml = keys.map(k => {
            const keyLabel = isArray ? k : `<span class="console-obj-key">${escHtml(k)}</span>`;
            return `<div class="console-obj-row">${keyLabel}: ${renderValue(val[k], depth + 1)}</div>`;
        }).join('');

        const overflowNote = Object.keys(val).length > MAX_OBJ_KEYS
            ? `<div class="console-obj-row console-val-null">… ${Object.keys(val).length - MAX_OBJ_KEYS} more</div>`
            : '';

        return `<span class="console-obj-tree">` +
            `<span class="console-obj-toggle" data-uid="${uid}" onclick="this.classList.toggle('open');` +
            `this.nextElementSibling.style.display=this.classList.contains('open')?'block':'none'">` +
            `▶ ${escHtml(preview)}</span>` +
            `<div class="console-obj-content" style="display:none">` +
            `${childrenHtml}${overflowNote}` +
            `</div></span>`;
    }

    return `<span>${escHtml(String(val))}</span>`;
}

function _objectPreview(obj, isArray) {
    if (isArray) {
        if (obj.length === 0) return '[]';
        if (obj.length <= 3) {
            const items = obj.slice(0, 3).map(v => _primitivePreview(v));
            return `Array(${obj.length}) [${items.join(', ')}]`;
        }
        return `Array(${obj.length})`;
    }
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';
    if (keys.length <= 3) {
        const items = keys.slice(0, 3).map(k => `${k}: ${_primitivePreview(obj[k])}`);
        return `{${items.join(', ')}}`;
    }
    return `Object {${keys.slice(0, 2).join(', ')}, …}`;
}

function _primitivePreview(val) {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'string') return val.length > 20 ? `"${val.substring(0, 20)}…"` : `"${val}"`;
    if (typeof val === 'object') return Array.isArray(val) ? `[…]` : `{…}`;
    return String(val);
}

// ═══════════════════════════════════════════════════════════════════════
// UI — Search / Filter
// ═══════════════════════════════════════════════════════════════════════

function _applyFilter(logs, textExtractor) {
    if (!_filterText) return logs;
    const lower = _filterText.toLowerCase();
    return logs.filter(entry => textExtractor(entry).toLowerCase().includes(lower));
}

function _argsToString(args) {
    if (!args) return '';
    return args.map(a => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
}

// ═══════════════════════════════════════════════════════════════════════
// UI — Auto Refresh
// ═══════════════════════════════════════════════════════════════════════

function startAutoRefresh() {
    stopAutoRefresh();
    if (!_autoRefresh) return;
    _autoRefreshTimer = setInterval(() => {
        const root = document.getElementById('console_app_root');
        if (!root) { stopAutoRefresh(); return; }

        const currentCount = getActiveLogCount();
        if (currentCount !== _lastRenderedCount) {
            refreshContent();
            _lastRenderedCount = currentCount;
        }
    }, AUTO_REFRESH_INTERVAL);
}

function stopAutoRefresh() {
    if (_autoRefreshTimer) {
        clearInterval(_autoRefreshTimer);
        _autoRefreshTimer = null;
    }
}

function refreshContent() {
    const content = document.getElementById('console_content');
    if (content) {
        content.innerHTML = renderTabContent(_activeTab);
        bindPromptToggles();
    }
    const countEl = document.getElementById('console_log_count');
    if (countEl) countEl.textContent = `${getActiveLogCount()} 条`;
    // Update error badge in sidebar
    const errorTab = document.querySelector('.console-side-tab[data-tab="error"]');
    if (errorTab) {
        const badge = errorTab.querySelector('.console-side-badge');
        if (_errorLogs.length > 0) {
            if (badge) {
                badge.textContent = _errorLogs.length;
            } else {
                const newBadge = document.createElement('span');
                newBadge.className = 'console-side-badge';
                newBadge.textContent = _errorLogs.length;
                errorTab.appendChild(newBadge);
            }
        } else if (badge) {
            badge.remove();
        }
    }
}

function getActiveLogCount() {
    switch (_activeTab) {
        case 'all': return _allLogs.length;
        case 'error': return _errorLogs.length;
        case 'module': return _moduleLogs.length;
        case 'network': return _networkLogs.length;
        case 'prompt': return _promptLogs.length;
        default: return 0;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// UI — Event Binding
// ═══════════════════════════════════════════════════════════════════════

function bindConsoleEvents() {
    // Sidebar tab switching
    document.querySelectorAll('.console-side-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            _activeTab = tab.dataset.tab;
            document.querySelectorAll('.console-side-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            _lastRenderedCount = -1; // force refresh
            refreshContent();
        });
    });

    // Filter input
    const filterInput = document.getElementById('console_filter');
    if (filterInput) {
        filterInput.addEventListener('input', (e) => {
            _filterText = e.target.value;
            _lastRenderedCount = -1;
            refreshContent();
        });
    }

    // Clear button
    const clearBtn = document.getElementById('console_clear_btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            switch (_activeTab) {
                case 'all': _allLogs.length = 0; break;
                case 'error': _errorLogs.length = 0; break;
                case 'module': _moduleLogs.length = 0; break;
                case 'network': _networkLogs.length = 0; break;
                case 'prompt': _promptLogs.length = 0; break;
            }
            _lastRenderedCount = -1;
            refreshContent();
        });
    }

    // Auto-refresh toggle
    const autoBtn = document.getElementById('console_auto_btn');
    if (autoBtn) {
        autoBtn.addEventListener('click', () => {
            _autoRefresh = !_autoRefresh;
            autoBtn.innerHTML = _autoRefresh ? '<i class="ph ph-pause"></i>' : '<i class="ph ph-play"></i>';
            autoBtn.title = _autoRefresh ? '自动刷新中' : '手动模式';
            autoBtn.classList.toggle('active', _autoRefresh);
            if (_autoRefresh) {
                startAutoRefresh();
            } else {
                stopAutoRefresh();
            }
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
        case 'error': return '<i class="ph ph-x-circle"></i>';
        case 'warn': return '<i class="ph ph-warning-circle"></i>';
        case 'info': return '<i class="ph ph-info"></i>';
        case 'debug': return '<i class="ph ph-bug"></i>';
        default: return '▸';
    }
}

function truncatePrompt(text, maxLen) {
    if (!text) return '(空)';
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen) + '…';
}

function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

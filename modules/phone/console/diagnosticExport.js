// modules/phone/console/diagnosticExport.js
// Build a diagnostic bundle from the console buffers (errors / network /
// module logs) and download it as a .txt. Bundle is scoped to "what's
// currently in the console list" — no full plugin-settings dump.
// See plan/diagnostic-export.md for design notes.

import { CLIENT_VERSION, main_api } from '../../../../../../../script.js';
import { getContext } from '../../../../../../extensions.js';
import { getChatCompletionModel } from '../../../../../../openai.js';
import { SCRIPT_TYPES, getScriptsByType } from '../../../../../regex/engine.js';
import { getLogBuffers } from './consoleApp.js';

// ═══════════════════════════════════════════════════════════════════════
// Redaction config
// ═══════════════════════════════════════════════════════════════════════

const REDACT_PLACEHOLDER = '***REDACTED***';

// Tail-scan: catch raw secrets that slipped into log message strings.
const VALUE_PATTERNS_TO_REDACT = [
    /sk-[A-Za-z0-9_-]{20,}/g,
    /Bearer\s+[A-Za-z0-9_.\-]{20,}/g,
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_.\-]+/g,
];

// Query-string params commonly carrying secrets.
const URL_QUERY_KEY_PARAMS = ['key', 'api_key', 'apikey', 'token', 'access_token', 'auth'];

// Bundle size caps (see D7 in plan)
const LIMITS = {
    errors: 50,
    network: 50,
    moduleLogs: 50,
    regexPerBucket: 50,
};

// Per-field cap inside a regex script — find/replace bodies can be huge
// (long prompt-rewrites), and we don't need their full text to diagnose.
const REGEX_FIELD_MAX = 200;

// Cap excessively long strings (mostly defensive — log args could contain
// data URLs or very large payloads).
const MAX_STRING_LEN = 500;

// ═══════════════════════════════════════════════════════════════════════
// Redaction
// ═══════════════════════════════════════════════════════════════════════

function maybeTruncate(str) {
    if (typeof str !== 'string' || str.length <= MAX_STRING_LEN) return str;
    // Special-case data URLs (most common cause: base64 images)
    if (str.startsWith('data:')) {
        const semi = str.indexOf(';');
        const mime = semi > 0 ? str.substring(5, semi) : 'unknown';
        return `[data URL truncated: ${mime}, ${str.length} chars]`;
    }
    const head = str.substring(0, 80).replace(/\s+/g, ' ');
    return `[truncated: ${str.length} chars, head: "${head}..."]`;
}

function redactStringValue(str) {
    if (typeof str !== 'string') return str;
    // Fast path: skip regex scan on huge strings — truncate instead
    if (str.length > MAX_STRING_LEN) return maybeTruncate(str);
    let result = str;
    for (const pattern of VALUE_PATTERNS_TO_REDACT) {
        result = result.replace(pattern, REDACT_PLACEHOLDER);
    }
    return result;
}

function redactUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.length > MAX_STRING_LEN) return maybeTruncate(url);
    try {
        const u = new URL(url, window.location.origin);
        let changed = false;
        for (const param of URL_QUERY_KEY_PARAMS) {
            if (u.searchParams.has(param)) {
                u.searchParams.set(param, REDACT_PLACEHOLDER);
                changed = true;
            }
        }
        return changed ? u.toString() : url;
    } catch {
        return url;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Environment & log formatting
// ═══════════════════════════════════════════════════════════════════════

// Cached at module load from manifest.json (same approach as updateChecker.js).
// Diagnostic export is user-initiated via button click, so the fetch will have
// resolved long before getPluginVersion() is called in practice.
let _cachedPluginVersion = null;
(async () => {
    try {
        const url = new URL('../../../manifest.json', import.meta.url).href;
        const resp = await fetch(url, { cache: 'no-cache' });
        if (!resp.ok) return;
        const data = await resp.json();
        if (typeof data?.version === 'string') _cachedPluginVersion = data.version;
    } catch { /* noop */ }
})();

function getPluginVersion() {
    return _cachedPluginVersion || 'unknown';
}

function getEnvironmentInfo() {
    // CLIENT_VERSION format: "1.12.0:abc123" (version : commit-hash)
    let stVersion = 'unknown';
    try {
        if (typeof CLIENT_VERSION === 'string' && CLIENT_VERSION) {
            stVersion = CLIENT_VERSION;
        }
    } catch { /* noop */ }

    return {
        time: new Date().toISOString(),
        pluginVersion: getPluginVersion(),
        stVersion,
        userAgent: navigator.userAgent,
        screen: `${window.innerWidth}x${window.innerHeight}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        api: getStApiInfo(),
        regex: getRegexScriptsInfo(),
    };
}

// Extract just the host of a URL, so a proxy or custom endpoint shows up as
// "api.deepseek.com" instead of a full URL that might leak path segments.
function safeHost(url) {
    if (!url || typeof url !== 'string') return null;
    try {
        const u = new URL(url, window.location.origin);
        return u.host || null;
    } catch {
        return null;
    }
}

// Snapshot whichever ST API / model the user has selected right now. Users
// run wildly different providers (openai-compatible, claude, gemini, custom
// proxies, local textgen…); knowing which one was active when the bug hit
// usually narrows the cause. Defensive: any read can fail if ST internals
// shift, so wrap each piece in try/catch and report "unknown" rather than
// letting the whole bundle bail out.
function getStApiInfo() {
    const info = {
        mainApi: null,
        chatCompletionSource: null,
        model: null,
        streaming: null,
        customUrlHost: null,
        reverseProxyHost: null,
        textgenType: null,
        textgenServerHost: null,
    };

    let ctx = null;
    try { ctx = (typeof getContext === 'function') ? getContext() : null; } catch { /* noop */ }

    try {
        info.mainApi = ctx?.mainApi || (typeof main_api === 'string' ? main_api : null) || null;
    } catch { /* noop */ }

    try {
        const oai = ctx?.chatCompletionSettings;
        if (oai) {
            info.chatCompletionSource = oai.chat_completion_source || null;
            try { info.model = getChatCompletionModel(oai) || null; } catch { /* noop */ }
            if (typeof oai.stream_openai === 'boolean') info.streaming = oai.stream_openai;
            if (oai.custom_url) info.customUrlHost = safeHost(oai.custom_url);
            if (oai.reverse_proxy) info.reverseProxyHost = safeHost(oai.reverse_proxy);
        }
    } catch { /* noop */ }

    // Local / self-hosted text-gen backends (ooba, tabby, koboldcpp, mancer …)
    try {
        const tgw = ctx?.textgenerationwebuiSettings;
        if (tgw && info.mainApi === 'textgenerationwebui') {
            info.textgenType = tgw.type || null;
            const candidate =
                (tgw.server_urls && tgw.type && tgw.server_urls[tgw.type]) ||
                tgw.server_url ||
                null;
            if (candidate) info.textgenServerHost = safeHost(candidate);
        }
    } catch { /* noop */ }

    return info;
}

function summarizeRegexScript(s) {
    const truncateField = (str) => {
        if (typeof str !== 'string') return '';
        const safe = redactStringValue(str);
        if (safe.length <= REGEX_FIELD_MAX) return safe;
        return safe.substring(0, REGEX_FIELD_MAX) + `… (${safe.length} chars)`;
    };
    return {
        name: s?.scriptName || '(unnamed)',
        disabled: s?.disabled === true,
        find: truncateField(s?.findRegex || ''),
        replace: truncateField(s?.replaceString || ''),
        placement: Array.isArray(s?.placement) ? s.placement : [],
        markdownOnly: s?.markdownOnly === true,
        promptOnly: s?.promptOnly === true,
        runOnEdit: s?.runOnEdit === true,
        substituteRegex: s?.substituteRegex ?? null,
        minDepth: s?.minDepth ?? null,
        maxDepth: s?.maxDepth ?? null,
    };
}

// Collect all three regex buckets (Global / Scoped / Preset). Users hit a lot
// of weird bugs that turn out to be a regex stripping or mangling the message —
// having the actual patterns in hand lets us reproduce instead of guess.
function getRegexScriptsInfo() {
    const out = {
        global: [], scoped: [], preset: [],
        globalTotal: 0, scopedTotal: 0, presetTotal: 0,
        error: null,
    };
    try {
        const global = getScriptsByType(SCRIPT_TYPES.GLOBAL) || [];
        const scoped = getScriptsByType(SCRIPT_TYPES.SCOPED) || [];
        const preset = getScriptsByType(SCRIPT_TYPES.PRESET) || [];
        out.globalTotal = global.length;
        out.scopedTotal = scoped.length;
        out.presetTotal = preset.length;
        out.global = global.slice(0, LIMITS.regexPerBucket).map(summarizeRegexScript);
        out.scoped = scoped.slice(0, LIMITS.regexPerBucket).map(summarizeRegexScript);
        out.preset = preset.slice(0, LIMITS.regexPerBucket).map(summarizeRegexScript);
    } catch (e) {
        out.error = e?.message || String(e);
    }
    return out;
}

function formatLogEntry(entry) {
    const time = entry.time instanceof Date
        ? entry.time.toISOString().substring(11, 19)
        : String(entry.time || '');
    const args = entry.args || [];
    const messageRaw = args.map(a => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    return {
        time,
        level: entry.level || 'log',
        source: entry.source,
        message: redactStringValue(messageRaw),
    };
}

function formatNetworkEntry(entry) {
    return {
        time: entry.time instanceof Date
            ? entry.time.toISOString().substring(11, 19)
            : String(entry.time || ''),
        method: entry.method,
        url: redactUrl(entry.fullUrl || entry.url),
        status: entry.status,
        duration: entry.duration,
        error: entry.error,
        isLLM: entry.isLLM,
        llmInfo: entry.llmInfo,
    };
}

// ═══════════════════════════════════════════════════════════════════════
// Bundle builder
// ═══════════════════════════════════════════════════════════════════════

export function buildBundle({ userDescription = '' } = {}) {
    const env = getEnvironmentInfo();
    const buffers = getLogBuffers();

    const errors = (buffers.errorLogs || [])
        .slice(-LIMITS.errors)
        .map(formatLogEntry);

    const network = (buffers.networkLogs || [])
        .slice(-LIMITS.network)
        .map(formatNetworkEntry);

    const moduleLogs = (buffers.moduleLogs || [])
        .slice(-LIMITS.moduleLogs)
        .map(formatLogEntry);

    return formatMarkdown({ env, userDescription, errors, network, moduleLogs });
}

function formatApiInfo(api) {
    if (!api) return '_(读取失败)_';
    const lines = [];
    lines.push(`- Main API：${api.mainApi || 'unknown'}`);
    if (api.chatCompletionSource) {
        lines.push(`- Chat Completion Source：${api.chatCompletionSource}`);
    }
    lines.push(`- Model：${api.model || 'unknown'}`);
    if (api.streaming !== null) {
        lines.push(`- Streaming：${api.streaming ? '开' : '关'}`);
    }
    if (api.customUrlHost) {
        lines.push(`- Custom URL host：${api.customUrlHost}`);
    }
    if (api.reverseProxyHost) {
        lines.push(`- Reverse proxy host：${api.reverseProxyHost}`);
    }
    if (api.textgenType) {
        lines.push(`- TextGen type：${api.textgenType}`);
    }
    if (api.textgenServerHost) {
        lines.push(`- TextGen server host：${api.textgenServerHost}`);
    }
    return lines.join('\n');
}

function formatRegexInfo(regex) {
    if (!regex) return '_(读取失败)_';
    if (regex.error) return `_(读取失败: ${regex.error})_`;

    const total = regex.globalTotal + regex.scopedTotal + regex.presetTotal;
    if (total === 0) return '_(用户未配置任何正则脚本)_';

    const allShown = [...regex.global, ...regex.scoped, ...regex.preset];
    const enabledShown = allShown.filter(s => !s.disabled).length;

    const lines = [];
    lines.push(`共 ${total} 个正则脚本，启用 ${enabledShown}/${allShown.length} 个（已显示）。`);
    lines.push('');

    const renderBucket = (label, shown, total) => {
        const truncatedNote = total > shown.length ? `，已截取前 ${shown.length} 个` : '';
        lines.push(`### ${label}（${total} 个${truncatedNote}）`);
        if (shown.length === 0) {
            lines.push('_(空)_');
            return;
        }
        lines.push('```json');
        lines.push(JSON.stringify(shown, null, 2));
        lines.push('```');
    };

    renderBucket('Global', regex.global, regex.globalTotal);
    lines.push('');
    renderBucket('Scoped (当前角色)', regex.scoped, regex.scopedTotal);
    lines.push('');
    renderBucket('Preset (当前预设)', regex.preset, regex.presetTotal);

    return lines.join('\n');
}

function formatMarkdown({ env, userDescription, errors, network, moduleLogs }) {
    const out = [];
    out.push('# TheGhostFace 诊断包');
    out.push('');
    out.push(`- 生成时间：${env.time}`);
    out.push(`- 插件版本：${env.pluginVersion}`);
    out.push(`- ST 版本：${env.stVersion}`);
    out.push(`- 屏幕：${env.screen}`);
    out.push(`- 时区：${env.timezone}`);
    out.push(`- UA：${env.userAgent}`);
    out.push('');

    out.push('## 当前 ST API / 模型');
    out.push(formatApiInfo(env.api));
    out.push('');

    out.push('## 当前正则脚本');
    out.push(formatRegexInfo(env.regex));
    out.push('');

    out.push('## 用户描述');
    out.push(userDescription || '_(用户未填写)_');
    out.push('');

    out.push(`## 最近错误（${errors.length} 条）`);
    out.push('```json');
    out.push(JSON.stringify(errors, null, 2));
    out.push('```');
    out.push('');

    out.push(`## 最近网络请求（${network.length} 条）`);
    out.push('```json');
    out.push(JSON.stringify(network, null, 2));
    out.push('```');
    out.push('');

    out.push(`## 最近模块日志（${moduleLogs.length} 条）`);
    out.push('```json');
    out.push(JSON.stringify(moduleLogs, null, 2));
    out.push('```');

    return out.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
// Download as file
// ═══════════════════════════════════════════════════════════════════════

export function generateFilename() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    return `theghostface-diag-${stamp}.txt`;
}

export function downloadAsFile(text, filename) {
    let url = null;
    let a = null;
    try {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        url = URL.createObjectURL(blob);
        a = document.createElement('a');
        a.href = url;
        a.download = filename || generateFilename();
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        return { success: true };
    } catch (err) {
        console.error('[Diagnostic] download failed:', err);
        return { success: false, error: err?.message || String(err) };
    } finally {
        if (a && a.parentNode) a.parentNode.removeChild(a);
        // Defer revoke so the browser has time to actually start the download
        if (url) setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
}

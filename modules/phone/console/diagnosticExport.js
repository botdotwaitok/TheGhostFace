// modules/phone/console/diagnosticExport.js
// Build a diagnostic bundle from the console buffers (errors / network /
// module logs) and download it as a .txt. Bundle is scoped to "what's
// currently in the console list" — no full plugin-settings dump.
// See plan/diagnostic-export.md for design notes.

import { CLIENT_VERSION } from '../../../../../../../script.js';
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
};

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

function getPluginVersion() {
    // Try DOM-cached manifest first (loaded by ST at boot)
    try {
        const meta = document.querySelector('meta[name="gf-plugin-version"]');
        if (meta?.content) return meta.content;
    } catch { /* noop */ }
    // Fallback: hardcoded — keep in sync with manifest.json on each release
    return '4.2.8';
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
    };
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

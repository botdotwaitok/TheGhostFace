// modules/phone/utils/corsProxyFetch.js
// Shared utility: route HTTP URLs through ST's built-in CORS proxy
// when the page is served over HTTPS (Secure Context).

/**
 * When the page runs in a Secure Context (HTTPS), rewrite plain HTTP URLs
 * to go through SillyTavern's built-in CORS proxy at `/proxy/<url>`.
 * This prevents Mixed Content errors (HTTPS page → HTTP API).
 *
 * On plain HTTP pages this is a no-op — the original URL is returned as-is.
 *
 * @param {string} url - The original URL (e.g. "https://api.entity.li/api/auth/login")
 * @returns {string}   - Possibly rewritten URL (e.g. "/proxy/http://example.com/api/auth/login")
 */
export function resolveProxyUrl(url) {
    if (window.isSecureContext && url.startsWith('http://')) {
        // ST's CORS proxy uses Express req.params.url which only captures the
        // path portion — the browser/Express strips everything after '?' into
        // req.query, so query params never reach the proxy handler.
        // Fix: encode '?' and '&' so they stay inside the path segment.
        const qIndex = url.indexOf('?');
        if (qIndex !== -1) {
            const base = url.slice(0, qIndex);
            const qs = url.slice(qIndex); // includes '?'
            const encoded = qs.replace(/\?/g, '%3F').replace(/&/g, '%26');
            return `/proxy/${base}${encoded}`;
        }
        return `/proxy/${url}`;
    }
    return url;
}

/**
 * Check whether a URL would be proxied through ST's CORS proxy.
 * Useful for callers that need to adjust headers (e.g. avoid
 * overwriting the Authorization header used by ST's basicAuth).
 *
 * @param {string} url - The original URL
 * @returns {boolean}
 */
export function needsProxy(url) {
    return window.isSecureContext && url.startsWith('http://');
}

/**
 * Combine an optional caller-provided AbortSignal with a hard timeout into a
 * single signal suitable for `fetch({ signal })`. If the caller passes nothing,
 * the returned signal still aborts after `timeoutMs` so a hung backend can't
 * leave the engine stuck in PROCESSING state forever.
 *
 * Uses AbortSignal.any when available (Chrome 116+, Firefox 124+, Safari 17.4+)
 * and falls back to a manual combinator on older browsers.
 *
 * @param {AbortSignal|undefined} sessionSignal - Optional session-level signal.
 * @param {number} [timeoutMs=30000] - Hard timeout in ms.
 * @returns {AbortSignal}
 */
export function withTimeout(sessionSignal, timeoutMs = 30000) {
    if (typeof AbortSignal !== 'undefined'
        && typeof AbortSignal.any === 'function'
        && typeof AbortSignal.timeout === 'function') {
        const signals = [AbortSignal.timeout(timeoutMs)];
        if (sessionSignal) signals.push(sessionSignal);
        return AbortSignal.any(signals);
    }
    // Fallback combinator
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
        try { ctrl.abort(new DOMException('timeout', 'AbortError')); } catch { ctrl.abort(); }
    }, timeoutMs);
    if (sessionSignal) {
        if (sessionSignal.aborted) {
            clearTimeout(timer);
            ctrl.abort();
        } else {
            sessionSignal.addEventListener('abort', () => {
                clearTimeout(timer);
                ctrl.abort();
            }, { once: true });
        }
    }
    return ctrl.signal;
}

/**
 * Encode an ArrayBuffer to base64 in 32 KB chunks.
 *
 * The naïve `btoa(reduce((s, b) => s + String.fromCharCode(b), ''))` pattern is
 * O(N²) memory due to the immutable string concat — a 30s mono 16-bit recording
 * (~960 KB raw, ~1.3 MB base64) takes seconds and can OOM on iOS Safari.
 * `String.fromCharCode.apply(null, hugeArray)` blows the call stack instead.
 *
 * Chunking through `apply` on slices ≤ 0x8000 stays under the per-call argument
 * limit and lets each chunk hit the `String.fromCharCode` fast path.
 *
 * @param {ArrayBuffer} buffer
 * @returns {string} base64-encoded payload (no `data:` prefix)
 */
export function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

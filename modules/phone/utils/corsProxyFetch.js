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

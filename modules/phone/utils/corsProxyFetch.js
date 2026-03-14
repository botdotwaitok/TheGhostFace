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
 * @param {string} url - The original URL (e.g. "http://74.208.78.209:3421/api/auth/login")
 * @returns {string}   - Possibly rewritten URL (e.g. "/proxy/http://74.208.78.209:3421/api/auth/login")
 */
export function resolveProxyUrl(url) {
    if (window.isSecureContext && url.startsWith('http://')) {
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

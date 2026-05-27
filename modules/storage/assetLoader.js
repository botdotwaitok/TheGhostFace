// modules/storage/assetLoader.js — Resilient image asset loading.
//
// Wraps Image() preload with timeout + retries, then applies the URL to a
// caller-specified CSS var only after the asset is confirmed loaded. Decouples
// "did the bytes actually arrive" from CSS application so a failed remote fetch
// never leaves the page showing a broken or stale image.
//
// Intended for any GhostFace asset served via HTTP (chat background, future
// stickers, future media). Not coupled to phone UI — caller hands in
// onError / onSuccess to drive its own UX.

const LOG = '[AssetLoader]';

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Preload an image URL with timeout + retry. Resolves once the browser has
 * the image bytes (and the decoder accepted them, via Image.onload). Throws
 * on final failure.
 *
 * Browser image cache means subsequent preloads of the same URL within the
 * session return instantly — no manual cache needed here.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=8000] - Per-attempt timeout
 * @param {number} [opts.retries=2] - Extra attempts after the first failure (3 total tries by default)
 * @returns {Promise<string>} The URL, for convenience chaining
 */
export async function preloadImage(url, { timeoutMs = 8000, retries = 2 } = {}) {
    if (!url) throw new Error('preloadImage: url is required');
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            await _loadOnce(url, timeoutMs);
            if (attempt > 0) console.log(`${LOG} succeeded after ${attempt + 1} attempts: ${url}`);
            return url;
        } catch (e) {
            lastError = e;
            console.warn(`${LOG} attempt ${attempt + 1}/${retries + 1} failed (${e.message}): ${url}`);
            // Linear-ish backoff to avoid thundering on transient remote outages
            if (attempt < retries) await _delay(300 * (attempt + 1));
        }
    }
    throw lastError;
}

/**
 * Preload an image then atomically set it as a CSS var on an element.
 * If the new image loads, the var is set and onSuccess fires. If the load
 * fails after all retries, the var is CLEARED (so no stale or broken image
 * remains visible) and onError fires for the caller to show retry UI.
 *
 * @param {HTMLElement} el - Element to set the CSS var on
 * @param {string} cssVarName - e.g. '--chat-app-bg'
 * @param {string} url - Image URL (empty/null clears the var synchronously)
 * @param {object} [opts]
 * @param {object} [opts.preload] - Forwarded to preloadImage (timeoutMs, retries)
 * @param {(err: Error) => void} [opts.onError]
 * @param {() => void} [opts.onSuccess]
 * @returns {Promise<void>}
 */
export async function applyImageAsBackground(el, cssVarName, url, { preload = {}, onError, onSuccess } = {}) {
    if (!el) return;
    if (!url) {
        el.style.removeProperty(cssVarName);
        return;
    }
    try {
        await preloadImage(url, preload);
        el.style.setProperty(cssVarName, `url("${url}")`);
        onSuccess?.();
    } catch (err) {
        // Critical: clear the var so UI doesn't keep showing stale state.
        el.style.removeProperty(cssVarName);
        console.warn(`${LOG} apply failed for ${cssVarName}:`, err.message);
        onError?.(err);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Internals
// ═══════════════════════════════════════════════════════════════════════

function _loadOnce(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const timer = setTimeout(() => {
            img.onload = img.onerror = null;
            img.src = '';
            reject(new Error(`timeout ${timeoutMs}ms`));
        }, timeoutMs);
        img.onload = () => { clearTimeout(timer); resolve(); };
        img.onerror = () => {
            clearTimeout(timer);
            reject(new Error('image load error (network/decode)'));
        };
        img.src = url;
    });
}

function _delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

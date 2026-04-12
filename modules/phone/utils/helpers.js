// phone/utils/helpers.js — Shared UI helpers for phone modules

/**
 * Escape a string for safe insertion into HTML.
 * Uses the browser's built-in text→HTML encoding.
 */
export function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

/**
 * Shorthand: attach a click handler to an element by its ID.
 * Silently no-ops if the element doesn't exist.
 */
export function onClick(id, handler) {
    document.getElementById(id)?.addEventListener('click', handler);
}

/**
 * Strip non-plain-text tags leaked from LLM output.
 * Covers: <think>…</think>, <状态栏>…</状态栏>, and any other
 * paired or orphan XML-like tags (English + CJK tag names).
 * Does NOT touch content outside of tags — pure text passes through unchanged.
 *
 * @param {string} text - Raw LLM output
 * @returns {string} Cleaned text with tags removed and excess blank lines collapsed
 */
export function stripLLMTags(text) {
    if (!text || typeof text !== 'string') return text;
    let cleaned = text;
    // 1. Paired tags: <xxx>…</xxx>  (supports English, CJK, underscores)
    //    Excludes <say> (TTS tone tags parsed downstream by parseSayTags)
    cleaned = cleaned.replace(/<(?!say\b)([a-zA-Z\u4e00-\u9fff_]+)>[\s\S]*?<\/\1>/g, '');
    // 2. Orphan tags: <xxx> or </xxx>  (excludes <say …> and </say>)
    cleaned = cleaned.replace(/<\/?(?!say\b)[a-zA-Z\u4e00-\u9fff_]+>/g, '');
    // 3. Collapse excess blank lines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    return cleaned;
}

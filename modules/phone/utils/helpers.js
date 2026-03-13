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

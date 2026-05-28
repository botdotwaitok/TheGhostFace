// modules/phone/chat/chatBackground.js — Chat app global background image.
// Stores web path in extension_settings.the_ghost_face.phone.chatAppBackground.
// File is uploaded to user/files/ via /api/files/upload (same pattern as voiceMessageService).
// Replacing the background deletes the previous file from the server.

import { getRequestHeaders } from '../../../../../../../script.js';
import { getPhoneSetting, setPhoneSetting, removePhoneSetting } from '../phoneSettings.js';
import { applyImageAsBackground } from '../../storage/assetLoader.js';

const LOG = '[ChatBackground]';
const SETTING_KEY = 'chatAppBackground';
const MAX_DIMENSION = 1920;          // Resize large images to this max side length
const COMPRESS_THRESHOLD = 2 * 1024 * 1024; // Recompress when source file is over 2MB
const JPEG_QUALITY = 0.85;

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

export function hasChatBackground() {
    return Boolean(getPhoneSetting(SETTING_KEY));
}

export function getChatBackgroundPath() {
    return getPhoneSetting(SETTING_KEY) || '';
}

/**
 * Apply the saved background (if any) to the chat page root.
 * Safe to call repeatedly; no-op when the chat page is not mounted.
 *
 * The CSS var is set on the phone viewport (not the chat page) so it cascades
 * to both the header and the body — without that, a transparent header would
 * reveal the viewport's solid gray instead of the chat background.
 *
 * Resilient: routes through assetLoader.applyImageAsBackground which preloads
 * with timeout + retry. On final failure both the CSS var AND .has-chat-bg
 * class are stripped, so the UI cleanly falls back to "no background" instead
 * of half-applying bg-mode styling (transparent bubbles, etc.) over a blank
 * background. A retry toast lets the user re-trigger manually.
 *
 * @returns {Promise<void>} resolves after the load attempt; safe to ignore
 */
export async function applyChatBackground() {
    const root = document.getElementById('chat_page_root');
    if (!root) return;
    const viewport = document.getElementById('phone_app_viewport');
    if (!viewport) return;
    const path = getChatBackgroundPath();

    if (!path) {
        viewport.style.removeProperty('--chat-app-bg');
        root.classList.remove('has-chat-bg');
        return;
    }

    const url = path.startsWith('/') ? path : `/${path}`;
    await applyImageAsBackground(viewport, '--chat-app-bg', url, {
        onSuccess: () => root.classList.add('has-chat-bg'),
        onError: () => {
            root.classList.remove('has-chat-bg');
            _showRetryToast('背景加载失败，点击重试', () => applyChatBackground());
        },
    });
}

/**
 * Upload a new background image. Replaces any existing one.
 * @param {File} file
 * @returns {Promise<string>} Web path of the uploaded image
 */
export async function uploadChatBackground(file) {
    if (!file || !file.type.startsWith('image/')) {
        throw new Error('Not an image file');
    }

    const oldPath = getChatBackgroundPath();

    const { blob, ext } = await _prepareBlob(file);
    const base64Data = await _blobToBase64(blob);
    const filename = `chatbg_${Date.now()}.${ext}`;

    const webPath = await new Promise((resolve, reject) => {
        jQuery.ajax({
            url: '/api/files/upload',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ name: filename, data: base64Data }),
            success: (result) => {
                const path = (result.path || `user/files/${filename}`).replace(/\\/g, '/');
                resolve(path);
            },
            error: (xhr, status, err) => reject(new Error(`Upload failed: ${xhr.status} ${err}`)),
        });
    });

    setPhoneSetting(SETTING_KEY, webPath);
    applyChatBackground();

    if (oldPath && oldPath !== webPath) {
        _deleteServerFile(oldPath).catch((err) => {
            console.warn(`${LOG} failed to remove previous background:`, err);
        });
    }

    console.debug(`${LOG} background updated -> ${webPath}`);
    return webPath;
}

/**
 * Clear the current background (removes setting and deletes server file).
 */
export async function clearChatBackground() {
    const oldPath = getChatBackgroundPath();
    removePhoneSetting(SETTING_KEY);
    applyChatBackground();
    if (oldPath) {
        try {
            await _deleteServerFile(oldPath);
        } catch (err) {
            console.warn(`${LOG} failed to delete background file:`, err);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Show a toast with a retry button anchored to the chat page. Deduplicates:
 * any existing retry toast is removed first. Auto-dismisses after 8 s if the
 * user does not click. Click clears the toast and invokes onRetry().
 *
 * Uses the base .chat-toast class for positioning/animation, plus the
 * .chat-toast-retry modifier to re-enable pointer events and host the button.
 */
function _showRetryToast(message, onRetry) {
    const root = document.getElementById('chat_page_root');
    if (!root) return;
    root.querySelector('.chat-toast-retry')?.remove();

    const toast = document.createElement('div');
    toast.className = 'chat-toast chat-toast-retry';

    const msgSpan = document.createElement('span');
    msgSpan.className = 'chat-toast-retry-msg';
    msgSpan.textContent = message;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-toast-retry-btn';
    btn.textContent = '重试';

    toast.appendChild(msgSpan);
    toast.appendChild(btn);

    let timer;
    btn.addEventListener('click', () => {
        clearTimeout(timer);
        toast.remove();
        try { onRetry(); } catch (e) { console.warn(`${LOG} retry handler threw:`, e); }
    });
    timer = setTimeout(() => toast.remove(), 8000);

    root.appendChild(toast);
}

/**
 * If the file is large or oversized, resize to MAX_DIMENSION and re-encode as JPEG.
 * Otherwise pass through the original blob.
 * @param {File} file
 * @returns {Promise<{ blob: Blob, ext: string }>}
 */
async function _prepareBlob(file) {
    const needsRecompress = file.size > COMPRESS_THRESHOLD;
    const dataUrl = await _fileToDataUrl(file);
    const img = await _loadImage(dataUrl);

    const oversized = img.width > MAX_DIMENSION || img.height > MAX_DIMENSION;
    if (!needsRecompress && !oversized) {
        const ext = _extFromMime(file.type) || 'jpg';
        return { blob: file, ext };
    }

    const ratio = oversized
        ? Math.min(MAX_DIMENSION / img.width, MAX_DIMENSION / img.height)
        : 1;
    const targetW = Math.round(img.width * ratio);
    const targetH = Math.round(img.height * ratio);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    return { blob, ext: 'jpg' };
}

function _fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function _loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

function _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result || '';
            const comma = result.indexOf(',');
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function _extFromMime(mime) {
    if (!mime) return null;
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    return null;
}

async function _deleteServerFile(path) {
    const resp = await fetch('/api/files/delete', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ path }),
    });
    if (!resp.ok) {
        throw new Error(`Delete failed: ${resp.status}`);
    }
}

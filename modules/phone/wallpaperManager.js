// modules/phone/wallpaperManager.js — Phone home wallpaper storage & apply.
//
// Phase 1.5: moves the wallpaper image off extension_settings (where it lived
// as a multi-MB base64 string) onto a self-managed file. The setting now holds
// only a path string, so any unrelated saveSettingsDebounced no longer drags
// MB-scale payload through ST's settings.json rewrite.
//
// Load path goes through assetLoader (Phase 1) so remote tailscale sessions
// get retry + timeout + graceful fallback instead of a stuck wallpaper.

import { uploadBlob, deleteFile } from '../storage/fileStore.js';
import { applyImageAsBackground } from '../storage/assetLoader.js';
import { getPhoneSetting, setPhoneSetting, removePhoneSetting } from './phoneSettings.js';

const LOG = '[Wallpaper]';
const SETTING_KEY = 'wallpaper';
const FILE_PREFIX = 'ghostface_wallpaper_';
const MAX_DIMENSION = 1920;
const COMPRESS_THRESHOLD = 2 * 1024 * 1024;
const JPEG_QUALITY = 0.85;
const CSS_VAR = '--phone-wallpaper-bg';
const WALLPAPER_SELECTOR = '.phone-wallpaper';
const CUSTOM_CLASS = 'has-custom-wallpaper';

// Module-scoped guard so concurrent migrate calls don't run the heavy work twice.
let _migrationPromise = null;

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/** Current persisted wallpaper value (path string post-migration, '' if none). */
export function getWallpaperValue() {
    return getPhoneSetting(SETTING_KEY) || '';
}

/** True when the stored value is still in the legacy inline base64 form. */
export function isLegacyBase64(value) {
    return typeof value === 'string' && value.startsWith('data:image/');
}

/**
 * Apply the currently saved wallpaper (if any) to the .phone-wallpaper element.
 * Safe to call repeatedly — also a no-op when the phone shell is not mounted.
 *
 * If the saved value is a remote-served path, routes through assetLoader so
 * load failures clear the CSS var cleanly instead of leaving stale state.
 * If it is still legacy base64 (migration pending or failed), falls back to
 * setting the var directly — base64 is local, no preload needed.
 *
 * @returns {Promise<void>}
 */
export async function applyWallpaper() {
    const el = document.querySelector(WALLPAPER_SELECTOR);
    if (!el) return;

    const value = getWallpaperValue();
    if (!value) {
        el.style.removeProperty(CSS_VAR);
        el.classList.remove(CUSTOM_CLASS);
        return;
    }

    if (isLegacyBase64(value)) {
        // Pre-migration fallback: data URLs are local, skip the preload dance.
        el.style.setProperty(CSS_VAR, `url("${value}")`);
        el.classList.add(CUSTOM_CLASS);
        return;
    }

    const url = value.startsWith('/') ? value : `/${value}`;
    await applyImageAsBackground(el, CSS_VAR, url, {
        onSuccess: () => el.classList.add(CUSTOM_CLASS),
        onError: () => {
            el.classList.remove(CUSTOM_CLASS);
            console.warn(`${LOG} wallpaper load failed, falling back to default gradient`);
        },
    });
}

/**
 * Upload a new wallpaper. Replaces any existing self-managed file.
 *
 * @param {File} file
 * @returns {Promise<string>} the new web path now stored in the setting
 */
export async function uploadWallpaper(file) {
    if (!file || !file.type.startsWith('image/')) {
        throw new Error('Not an image file');
    }

    const oldValue = getWallpaperValue();
    const { blob, ext } = await _prepareBlob(file);
    const filename = `${FILE_PREFIX}${Date.now()}.${ext}`;
    const webPath = await uploadBlob(filename, blob);

    // Only commit the setting AFTER upload succeeds — failure leaves the old
    // wallpaper intact (or empty), never half-applied state.
    setPhoneSetting(SETTING_KEY, webPath);

    // Best-effort cleanup of the previously stored self-managed file.
    if (oldValue && !isLegacyBase64(oldValue) && oldValue !== webPath) {
        deleteFile(oldValue).catch((e) =>
            console.warn(`${LOG} failed to delete old wallpaper ${oldValue}:`, e.message));
    }

    await applyWallpaper();
    return webPath;
}

/**
 * Reset wallpaper: removes the setting and deletes the server file.
 */
export async function clearWallpaper() {
    const oldValue = getWallpaperValue();
    removePhoneSetting(SETTING_KEY);
    await applyWallpaper();
    if (oldValue && !isLegacyBase64(oldValue)) {
        deleteFile(oldValue).catch((e) =>
            console.warn(`${LOG} failed to delete wallpaper ${oldValue}:`, e.message));
    }
}

/**
 * One-shot migration from legacy inline base64 → self-managed file.
 * Idempotent and concurrency-safe: simultaneous callers share the same
 * in-flight promise; once migration finishes (success OR documented failure)
 * subsequent calls early-return because the setting is no longer base64.
 *
 * Strict ordering to prevent data loss:
 *   1. Convert dataURL → Blob
 *   2. Upload to /user/files/ — failure here aborts and leaves base64 untouched
 *   3. Only after upload succeeds, overwrite the setting with the path
 *
 * Returns true if a migration ran successfully, false on no-op or failure.
 * @returns {Promise<boolean>}
 */
export async function migrateLegacyBase64() {
    if (_migrationPromise) return _migrationPromise;
    _migrationPromise = (async () => {
        const value = getWallpaperValue();
        if (!isLegacyBase64(value)) return false;

        console.log(`${LOG} migrating legacy base64 wallpaper to self-managed file…`);
        try {
            const blob = _dataUrlToBlob(value);
            const ext = _extFromMime(blob.type) || 'jpg';
            const filename = `${FILE_PREFIX}${Date.now()}.${ext}`;
            const webPath = await uploadBlob(filename, blob);

            // Only swap the setting AFTER upload has succeeded.
            setPhoneSetting(SETTING_KEY, webPath);
            console.log(`${LOG} ✅ migrated wallpaper → ${webPath} (saved ${value.length} bytes from settings.json)`);
            return true;
        } catch (e) {
            console.warn(`${LOG} migration failed, keeping legacy base64 for retry:`, e.message);
            return false;
        }
    })();
    return _migrationPromise;
}

// ═══════════════════════════════════════════════════════════════════════
// Internals — image processing
// (Copied from chatBackground.js; both modules share the same compress
//  semantics. If this duplicates a third time, extract to a util module.)
// ═══════════════════════════════════════════════════════════════════════

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

function _extFromMime(mime) {
    if (!mime) return null;
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    return null;
}

function _dataUrlToBlob(dataUrl) {
    const match = /^data:([^;,]+)(?:;base64)?,(.*)$/.exec(dataUrl);
    if (!match) throw new Error('Not a valid data URL');
    const mime = match[1] || 'application/octet-stream';
    const isBase64 = dataUrl.includes(';base64,');
    const raw = isBase64 ? atob(match[2]) : decodeURIComponent(match[2]);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

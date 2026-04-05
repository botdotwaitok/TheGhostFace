// modules/phone/discord/discordEmoji.js — Custom Sticker & Reaction system
// Handles: sticker panel, quick reactions, custom sticker management for server settings.
// Unicode emoji input is handled by the user's own keyboard — we only provide custom sticker packs.

import { escapeHtml } from '../utils/helpers.js';
import { loadCustomEmojis, addCustomEmoji, removeCustomEmoji, uploadFileToST } from './discordStorage.js';
import { showDiscordDialog, showDiscordPrompt } from './discordDialog.js';

const LOG = '[Discord Emoji]';

// ═══════════════════════════════════════════════════════════════════════
// URL Emoji Cache (localStorage — fast local access for external URLs)
// ═══════════════════════════════════════════════════════════════════════
// When an emoji uses an external URL, we cache its image data locally
// in the browser for faster repeat access and offline resilience.

const EMOJI_CACHE_PREFIX = 'gf_dc_emoji_cache_';

/**
 * Get a cached version of a URL emoji, or fetch & cache it.
 * Returns the original URL immediately, triggers background caching.
 * @param {string} url - External image URL
 * @param {string} emojiId - Unique emoji ID for cache key
 * @returns {string} - Best available source (cached data URI or original URL)
 */
function _getCachedEmojiSrc(url, emojiId) {
    const cacheKey = EMOJI_CACHE_PREFIX + emojiId;
    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;

    // Background: fetch the URL and cache as data URL
    _cacheUrlEmoji(url, cacheKey);

    // Return original URL for now (cache will be used on next render)
    return url;
}

/**
 * Fetch an external URL image and cache it as base64 in localStorage.
 * @param {string} url
 * @param {string} cacheKey
 */
async function _cacheUrlEmoji(url, cacheKey) {
    try {
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) return;
        const blob = await response.blob();
        // Only cache if small enough (< 512KB)
        if (blob.size > 512 * 1024) return;

        const reader = new FileReader();
        reader.onloadend = () => {
            try {
                localStorage.setItem(cacheKey, reader.result);
                console.debug(`${LOG} Cached URL emoji: ${cacheKey} (${blob.size} bytes)`);
            } catch (e) {
                // localStorage quota exceeded — silently skip
                console.debug(`${LOG} Cache quota exceeded, skipping`);
            }
        };
        reader.readAsDataURL(blob);
    } catch (e) {
        // CORS or network error — not cacheable, that's fine
        console.debug(`${LOG} Cannot cache URL emoji:`, e.message);
    }
}

/**
 * Clear cached data for a removed emoji.
 * @param {string} emojiId
 */
function _clearEmojiCache(emojiId) {
    localStorage.removeItem(EMOJI_CACHE_PREFIX + emojiId);
}

// ═══════════════════════════════════════════════════════════════════════
// Quick Reaction Set (hardcoded favorites for context menu)
// ═══════════════════════════════════════════════════════════════════════

const QUICK_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🔥'];

/** Get the quick reaction emoji set */
export function getQuickReactions() {
    return [...QUICK_REACTIONS];
}

// ═══════════════════════════════════════════════════════════════════════
// Sticker Panel (floating picker — custom stickers only)
// ═══════════════════════════════════════════════════════════════════════

let _stickerCallback = null;
let _panelOpen = false;

/**
 * Open the sticker picker panel (custom stickers only).
 * @param {Function} onSelect — called with the selected sticker string (e.g. ":bear_hug:")
 * @param {Function} [onGoToSettings] — callback to navigate to server settings (for empty state)
 */
export function openStickerPanel(onSelect, onGoToSettings = null) {
    if (_panelOpen) {
        closeStickerPanel();
        return;
    }

    _stickerCallback = onSelect;
    _panelOpen = true;

    const page = document.getElementById('dc_channel_page');
    if (!page) return;

    // Remove existing panel if any
    const existing = document.getElementById('dc_sticker_panel');
    if (existing) existing.remove();

    const customEmojis = loadCustomEmojis();

    const panel = document.createElement('div');
    panel.id = 'dc_sticker_panel';
    panel.className = 'dc-sticker-panel dc-fade-in';

    if (!customEmojis || customEmojis.length === 0) {
        // ── Empty state ──
        panel.innerHTML = `
            <div class="dc-sticker-empty">
                <i class="ph ph-sticker"></i>
                <div class="dc-sticker-empty-title">还没有自定义表情包</div>
                <div class="dc-sticker-empty-hint">在服务器设置中上传表情包，社区成员也可以在聊天中使用</div>
                ${onGoToSettings
                    ? '<button class="dc-btn dc-btn-primary dc-btn-sm" id="dc_sticker_go_settings"><i class="ph ph-gear"></i> 前往设置</button>'
                    : ''
                }
            </div>
        `;
    } else {
        // ── Sticker grid ──
        const gridHtml = customEmojis.map(e => {
            const imgSrc = _getStickerSrc(e);
            return `
                <div class="dc-sticker-item" data-sticker=":${escapeHtml(e.name)}:" title=":${escapeHtml(e.name)}:">
                    <img src="${imgSrc}" alt="${escapeHtml(e.name)}" loading="lazy" />
                    <span class="dc-sticker-label">${escapeHtml(e.name)}</span>
                </div>
            `;
        }).join('');

        panel.innerHTML = `
            <div class="dc-sticker-header">
                <span class="dc-sticker-header-title">
                    <i class="ph ph-sticker"></i> 表情包
                </span>
                <div class="dc-sticker-header-right">
                    <span class="dc-sticker-count">${customEmojis.length}</span>
                    <button class="dc-icon-btn dc-sticker-close" id="dc_sticker_close"><i class="ph ph-x"></i></button>
                </div>
            </div>
            <div class="dc-sticker-grid" id="dc_sticker_grid">
                ${gridHtml}
            </div>
        `;
    }

    // ── Create a backdrop for outside-click dismiss ──
    let backdrop = document.getElementById('dc_sticker_backdrop');
    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'dc_sticker_backdrop';
        backdrop.className = 'dc-sticker-backdrop';
        page.appendChild(backdrop);
    }
    backdrop.style.display = 'block';
    backdrop.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeStickerPanel();
    }, { once: true });

    page.appendChild(panel);

    // ── Bind events ──
    _bindStickerPanelEvents(onGoToSettings);
}

export function closeStickerPanel() {
    _panelOpen = false;
    const panel = document.getElementById('dc_sticker_panel');
    if (panel) {
        panel.style.opacity = '0';
        panel.style.transform = 'translateY(10px)';
        setTimeout(() => panel.remove(), 150);
    }
    // Remove backdrop
    const backdrop = document.getElementById('dc_sticker_backdrop');
    if (backdrop) backdrop.style.display = 'none';
}

/** Check if the sticker panel is currently open */
export function isStickerPanelOpen() {
    return _panelOpen;
}

function _bindStickerPanelEvents(onGoToSettings) {
    // Sticker item clicks
    document.querySelectorAll('#dc_sticker_panel .dc-sticker-item').forEach(item => {
        item.addEventListener('click', () => {
            const sticker = item.dataset.sticker;
            if (sticker && _stickerCallback) {
                _stickerCallback(sticker);
            }
            closeStickerPanel();
        });
    });

    // Close button
    document.getElementById('dc_sticker_close')?.addEventListener('click', () => {
        closeStickerPanel();
    });

    // "Go to settings" button in empty state
    if (onGoToSettings) {
        document.getElementById('dc_sticker_go_settings')?.addEventListener('click', () => {
            closeStickerPanel();
            onGoToSettings();
        });
    }
}

/**
 * Get the display source URL for a sticker.
 * Supports ST file paths, external URLs (with localStorage caching), and legacy base64.
 * @param {Object} sticker - { id, name, data, url? }
 * @returns {string}
 */
function _getStickerSrc(sticker) {
    // URL-based emoji: use cached version if available
    if (sticker.url) return _getCachedEmojiSrc(sticker.url, sticker.id);
    // ST file path or legacy base64 data URI
    if (sticker.data) return sticker.data;
    // Fallback placeholder
    return '';
}

// ═══════════════════════════════════════════════════════════════════════
// Sticker Rendering in Messages
// ═══════════════════════════════════════════════════════════════════════

/**
 * Process message text and replace :stickerName: with inline sticker images.
 * Call this during message rendering.
 * @param {string} htmlText - Already-escaped HTML text
 * @returns {string} Text with sticker :name: replaced by <img> tags
 */
export function renderStickersInText(htmlText) {
    if (!htmlText) return '';

    const customEmojis = loadCustomEmojis();
    if (!customEmojis || customEmojis.length === 0) return htmlText;

    // Build name → sticker lookup
    const stickerMap = {};
    for (const e of customEmojis) {
        stickerMap[e.name] = e;
        stickerMap[e.name.toLowerCase()] = e;
    }

    // Replace :name: patterns  — work on the already-escaped HTML
    return htmlText.replace(/:([^:<>\s]+):/g, (match, name) => {
        const sticker = stickerMap[name] || stickerMap[name.toLowerCase()];
        if (!sticker) return match; // Not a known sticker, leave as-is

        const src = _getStickerSrc(sticker);
        if (!src) return match;

        return `<img class="dc-inline-sticker" src="${src}" alt=":${escapeHtml(sticker.name)}:" title=":${escapeHtml(sticker.name)}:" />`;
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Custom Sticker Management (used by server settings page)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the sticker management section HTML for server settings.
 * @returns {string}
 */
export function buildStickerManagementHtml() {
    const emojis = loadCustomEmojis();

    const emojiItems = emojis.map(e => {
        const src = _getStickerSrc(e);
        const sourceLabel = e.source === 'url' ? 'URL' : '上传';
        return `
            <div class="dc-custom-emoji-item" data-emoji-id="${e.id}">
                <div class="dc-custom-emoji-preview">
                    <img src="${src}" alt="${escapeHtml(e.name)}" />
                </div>
                <div class="dc-custom-emoji-info">
                    <span class="dc-custom-emoji-name">:${escapeHtml(e.name)}:</span>
                    <span class="dc-custom-emoji-source">${sourceLabel}</span>
                </div>
                <button class="dc-icon-btn dc-emoji-remove-btn" data-emoji-id="${e.id}">
                    <i class="ph ph-trash"></i>
                </button>
            </div>
        `;
    }).join('');

    return `
        <div class="dc-emoji-management" id="dc_emoji_management">
            <div class="dc-emoji-list">
                ${emojiItems || '<div class="dc-form-note"><i class="ph ph-info"></i> 还没有自定义表情包</div>'}
            </div>
            <div class="dc-emoji-upload-area">
                <button class="dc-btn dc-btn-secondary dc-btn-sm" id="dc_emoji_upload_btn">
                    <i class="ph ph-upload-simple"></i> 上传图片
                </button>
                <button class="dc-btn dc-btn-secondary dc-btn-sm" id="dc_emoji_url_btn">
                    <i class="ph ph-link"></i> 从URL添加
                </button>
                <input type="file" accept="image/*" id="dc_emoji_file_input" style="display:none" />
            </div>
        </div>
    `;
}

/**
 * Bind events for the sticker management section.
 * Call after rendering buildStickerManagementHtml().
 * @param {Function} onRefresh — callback to re-render current page
 */
export function bindStickerManagementEvents(onRefresh) {
    // Upload file
    const uploadBtn = document.getElementById('dc_emoji_upload_btn');
    const fileInput = document.getElementById('dc_emoji_file_input');

    uploadBtn?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 256 * 1024) {
            if (typeof toastr !== 'undefined') toastr.warning('表情图片不能超过 256KB');
            return;
        }

        showDiscordPrompt({
            title: '添加表情包',
            placeholder: '表情名称（用于 :名称: 引用）',
            onConfirm: async (name, close) => {
                if (!name) {
                    if (typeof toastr !== 'undefined') toastr.warning('请输入表情名称');
                    return false;
                }

                try {
                    // Read file as base64
                    const base64 = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = () => reject(reader.error);
                        reader.readAsDataURL(file);
                    });

                    // Upload to ST file system
                    if (typeof toastr !== 'undefined') toastr.info('正在上传表情包...');
                    const webPath = await uploadFileToST(base64, 'discord_emoji');

                    // Store with web path (not base64)
                    addCustomEmoji(name, webPath);
                    if (typeof toastr !== 'undefined') toastr.success(`表情 :${name}: 已添加`);
                    if (onRefresh) onRefresh();
                    close();
                } catch (err) {
                    console.error(`${LOG} Emoji upload failed:`, err);
                    if (typeof toastr !== 'undefined') toastr.error('表情包上传失败');
                    close();
                }
            }
        });
    });

    // Add from URL
    const urlBtn = document.getElementById('dc_emoji_url_btn');
    urlBtn?.addEventListener('click', () => {
        showDiscordDialog({
            title: '从URL添加表情包',
            contentHtml: `
                <div class="dc-form-section">
                    <div class="dc-form-label">表情名称</div>
                    <input type="text" class="dc-input" id="dc_emoji_url_name" placeholder="用于 :名称: 引用" maxlength="30" autocomplete="off" />
                </div>
                <div class="dc-form-section" style="margin-bottom:0;">
                    <div class="dc-form-label">图片URL</div>
                    <input type="text" class="dc-input" id="dc_emoji_url_link" placeholder="支持 catbox、imgur 等图床" autocomplete="off" />
                    <div class="dc-form-note" style="margin-top:4px;">
                        <i class="ph ph-info"></i>
                        请确保链接以图片格式结尾（.png/.jpg等）
                    </div>
                </div>
            `,
            onRender: (overlay) => {
                const input = overlay.querySelector('#dc_emoji_url_name');
                if (input) {
                    setTimeout(() => input.focus(), 100);
                }
            },
            onSave: (close) => {
                const name = document.getElementById('dc_emoji_url_name')?.value?.trim();
                const url = document.getElementById('dc_emoji_url_link')?.value?.trim();

                if (!name) {
                    if (typeof toastr !== 'undefined') toastr.warning('请输入表情名称');
                    return false;
                }

                if (!url) {
                    if (typeof toastr !== 'undefined') toastr.warning('请输入图片URL');
                    return false;
                }

                // Validate URL format
                try {
                    new URL(url);
                } catch {
                    if (typeof toastr !== 'undefined') toastr.warning('请输入有效的URL');
                    return false;
                }

                addCustomEmoji(name, null, url);
                if (typeof toastr !== 'undefined') toastr.success(`表情 :${name}: 已添加`);
                if (onRefresh) onRefresh();
                close();
            }
        });
    });

    // Remove
    document.querySelectorAll('.dc-emoji-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const emojiId = btn.dataset.emojiId;
            if (!confirm('确定要删除这个表情包吗？')) return;
            // Clear localStorage cache for this emoji
            _clearEmojiCache(emojiId);
            removeCustomEmoji(emojiId);
            if (typeof toastr !== 'undefined') toastr.success('表情包已删除');
            if (onRefresh) onRefresh();
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Legacy API shims (for backward compatibility)
// ═══════════════════════════════════════════════════════════════════════

/** @deprecated Use openStickerPanel instead */
export const openEmojiPanel = openStickerPanel;

/** @deprecated Use closeStickerPanel instead */
export const closeEmojiPanel = closeStickerPanel;

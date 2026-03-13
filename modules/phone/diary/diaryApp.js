// modules/phone/diary/diaryApp.js — 情侣日记本 (Couple's Diary) App
// Persistent local storage + dual LLM integration (custom API / main LLM)

import { openAppInViewport } from '../phoneController.js';
// API mode routing is handled internally by callPhoneLLM in diaryGeneration.js
import { generateCharacterDiaryEntry, generateProactiveDiaryEntry } from './diaryGeneration.js';
import { updateDiaryWorldInfo, parseDiaryFromChatOutput } from './diaryWorldInfo.js';
import { getPhoneCharInfo, getPhoneUserName } from '../phoneContext.js';
import { getContext, extension_settings, saveMetadataDebounced } from '../../../../../../extensions.js';
import { chat_metadata, saveSettingsDebounced } from '../../../../../../../script.js';

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

const MODULE_NAME = 'the_ghost_face';
const DIARY_STORAGE_KEY_PREFIX = `${MODULE_NAME}_diary_v1_`; // used by legacy localStorage migration
const DIARY_LOG_PREFIX = '[日记本]';
const META_KEY_DIARY = 'gf_phoneDiaryEntries'; // chat_metadata key
const DIARY_THEME_KEY = 'gf_phone_diary_theme';
const DIARY_CUSTOM_KEY = 'gf_phone_diary_custom_vars';
const DIARY_PAGE_SIZE = 10; // entries per page

// ── Pagination state ─────────────────────────────────────────────────────
let _diaryCurrentPage = 0; // 0-indexed
let _globalDiaryEventsBound = false;

function getLocalDateString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
const DIARY_THEMES = [
    { id: 'default', name: '暖阳', emoji: '☀️', desc: '温暖默认' },
    { id: 'sakura', name: '樱花', emoji: '🌸', desc: '粉色浪漫' },
    { id: 'lavender', name: '薰衣草', emoji: '💜', desc: '紫色梦幻' },
    { id: 'forest', name: '墨绿', emoji: '🌿', desc: '清新自然' },
];
const DIARY_FONTS = [
    {
        label: '中文 — 经典', options: [
            { value: "'ZCOOL XiaoWei', cursive", name: '小薇体' },
            { value: "'Ma Shan Zheng', cursive", name: '马善政楷' },
            { value: "'Noto Serif SC', serif", name: '思源宋体' },
        ]
    },
    {
        label: '中文 — 手写', options: [
            { value: "'Long Cang', cursive", name: '龙藏' },
            { value: "'Liu Jian Mao Cao', cursive", name: '流光草' },
            { value: "'Zhi Mang Xing', cursive", name: '织网行' },
        ]
    },
    {
        label: 'English — Script', options: [
            { value: "'Caveat', cursive", name: 'Caveat' },
            { value: "'Dancing Script', cursive", name: 'Dancing Script' },
            { value: "'Shadows Into Light', cursive", name: 'Shadows' },
            { value: "'Indie Flower', cursive", name: 'Indie Flower' },
        ]
    },
];
// CSS variable defaults — used for matching and resetting
const CUSTOM_VAR_DEFAULTS = {
    '--diary-bg-color': '#fef9f3',
    '--diary-card-bg-color': '#ffffff',
    '--diary-title-color': '#4a3728',
    '--diary-user-text-color': '#5a4035',
    '--diary-char-text-color': '#4a627a',
    '--diary-accent-color': '#f8a4b8',
    '--diary-font-main': "'Noto Serif SC', serif",
    '--diary-char-font': "'Caveat', cursive",
    '--diary-font-size': '14',
    '--diary-line-height': '1.9',
    '--diary-custom-font-user': '',
    '--diary-custom-font-char': '',
    '--diary-custom-font-url': '',
};

// ═══════════════════════════════════════════════════════════════════════
// Diary Feature Gate
// ═══════════════════════════════════════════════════════════════════════

export function isDiaryEnabled() {
    return localStorage.getItem('gf_phone_diary_enabled') !== 'false';
}

export function setDiaryEnabled(enabled) {
    localStorage.setItem('gf_phone_diary_enabled', String(enabled));
}

export function getDiaryMode() {
    return localStorage.getItem('gf_phone_diary_mode') || 'manual';
}

export function setDiaryMode(mode) {
    localStorage.setItem('gf_phone_diary_mode', mode);
}

// ═══════════════════════════════════════════════════════════════════════
// Local Persistence (dual: localStorage + extension_settings)
// ═══════════════════════════════════════════════════════════════════════

function _getCharacterId() {
    try {
        const context = getContext();
        return context.characterId != null ? `char_${context.characterId}` : 'global_fallback';
    } catch {
        return 'global_system';
    }
}

// _getCharacterInfo / _getUserName → use centralized getPhoneCharInfo / getPhoneUserName from phoneContext.js

/**
 * Load diary entries from storage.
 * Primary: chat_metadata (persisted inside .jsonl chat file, cross-device)
 * Fallback 1: extension_settings (legacy, auto-migrates)
 * Fallback 2: localStorage (legacy, auto-migrates)
 */
export function loadDiaryEntries() {
    const charId = _getCharacterId();

    // 1. chat_metadata (primary — persisted in .jsonl chat file)
    // If the key exists at all (even as []), trust it — don't fall back to legacy sources
    try {
        const data = chat_metadata?.[META_KEY_DIARY];
        if (Array.isArray(data)) return data;
    } catch { }

    // 2. Fallback: extension_settings (legacy — auto-migrate to chat_metadata)
    try {
        const ext = extension_settings?.[MODULE_NAME];
        if (ext?.diaryEntries?.[charId]) {
            const data = ext.diaryEntries[charId];
            if (Array.isArray(data) && data.length > 0) {
                console.log(`${DIARY_LOG_PREFIX} 从 extension_settings 迁移数据到 chat_metadata`);
                saveDiaryEntries(data); // migrate to chat_metadata
                return data;
            }
        }
    } catch { }

    // 3. Fallback: localStorage (legacy — auto-migrate to chat_metadata)
    try {
        const key = `${DIARY_STORAGE_KEY_PREFIX}${charId}`;
        const raw = localStorage.getItem(key);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                console.log(`${DIARY_LOG_PREFIX} 从 localStorage 迁移数据到 chat_metadata`);
                saveDiaryEntries(parsed); // migrate to chat_metadata
                return parsed;
            }
        }
    } catch (e) {
        console.warn(`${DIARY_LOG_PREFIX} localStorage fallback read failed:`, e);
    }

    return [];
}

/**
 * Save diary entries to chat_metadata (primary, persisted in .jsonl chat file).
 * Also keeps extension_settings as secondary backup.
 */
export function saveDiaryEntries(entries) {
    const charId = _getCharacterId();

    // 1. chat_metadata (primary — cross-device, persisted in chat file)
    try {
        if (chat_metadata) {
            chat_metadata[META_KEY_DIARY] = entries;
            saveMetadataDebounced();
        }
    } catch (e) {
        console.warn(`${DIARY_LOG_PREFIX} chat_metadata save failed:`, e);
    }

    // 2. extension_settings (secondary backup)
    try {
        if (typeof extension_settings !== 'undefined') {
            if (!extension_settings[MODULE_NAME]) extension_settings[MODULE_NAME] = {};
            if (!extension_settings[MODULE_NAME].diaryEntries) {
                extension_settings[MODULE_NAME].diaryEntries = {};
            }
            extension_settings[MODULE_NAME].diaryEntries[charId] = entries;
            if (typeof saveSettingsDebounced === 'function') {
                saveSettingsDebounced();
            }
        }
    } catch (e) {
        console.warn(`${DIARY_LOG_PREFIX} extension_settings backup save failed:`, e);
    }

    // 3. Update world book injection (auto mode only)
    if (getDiaryMode() === 'auto') {
        updateDiaryWorldInfo(entries).catch(() => { });
    }
}

/**
 * Get the next available entry ID.
 */
function _nextId(entries) {
    if (entries.length === 0) return 1;
    return Math.max(...entries.map(e => e.id)) + 1;
}

// ═══════════════════════════════════════════════════════════════════════
// Main LLM Output Handler — called from index.js on GENERATION_ENDED
// ═══════════════════════════════════════════════════════════════════════

/**
 * Parse main LLM output for diary content.
 * Finds the most recent entry that's missing a char segment and appends.
 * @param {string} content - The character's chat message
 * @param {number} [messageIndex] - The chat message index (for dedup tracking)
 * @returns {boolean} true if a diary entry was created
 */
export function handleDiaryChatOutput(content, messageIndex) {
    // Guard: disabled or manual mode → skip
    if (!isDiaryEnabled() || getDiaryMode() !== 'auto') return false;

    // Layer 2: dedup — skip if this message was already processed
    const META_KEY_PROCESSED = 'gf_diaryProcessedMsgIds';
    if (messageIndex != null) {
        const processedIds = chat_metadata?.[META_KEY_PROCESSED] || [];
        if (processedIds.includes(messageIndex)) {
            console.log(`${DIARY_LOG_PREFIX} 消息 #${messageIndex} 已处理过，跳过`);
            return false;
        }
    }

    const parsed = parseDiaryFromChatOutput(content);
    if (!parsed) return false;

    const entries = loadDiaryEntries();
    const charInfo = getPhoneCharInfo();
    if (!charInfo) return false;

    // Find the most recent entry that's missing a char segment
    const pendingEntry = entries.find(e => !e.segments.some(s => s.author === 'char'));
    if (pendingEntry) {
        pendingEntry.segments.push({
            author: 'char',
            name: charInfo.name,
            content: parsed.diaryContent,
        });
        saveDiaryEntries(entries);
        console.log(`${DIARY_LOG_PREFIX} 从主 LLM 输出追加了角色日记段落`);

        // Layer 2: record processed message index
        if (messageIndex != null) {
            const processedIds = chat_metadata?.[META_KEY_PROCESSED] || [];
            processedIds.push(messageIndex);
            if (chat_metadata) {
                chat_metadata[META_KEY_PROCESSED] = processedIds;
                saveMetadataDebounced();
            }
        }

        // Notify UI to refresh if diary is open
        window.dispatchEvent(new CustomEvent('diary-entries-updated'));
        return true;
    }

    return false;
}

// ═══════════════════════════════════════════════════════════════════════
// App Entry Point
// ═══════════════════════════════════════════════════════════════════════

export function openDiaryApp() {
    if (!isDiaryEnabled()) {
        const html = `
        <div class="diary-page" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:40px;text-align:center;">
            <div style="font-size:48px;margin-bottom:16px;">📔</div>
            <div style="font-size:18px;font-weight:600;margin-bottom:8px;">日记本功能已关闭</div>
            <div style="font-size:14px;opacity:0.6;">请在设置中开启日记本功能</div>
        </div>`;
        openAppInViewport('日记本', html, () => { });
        return;
    }
    _diaryCurrentPage = 0; // reset to first page on open
    const entries = loadDiaryEntries();
    const html = buildDiaryPage(entries);
    openAppInViewport('日记本', html, () => {
        bindDiaryEvents();
        restoreCustomVarsOnLoad();
        // Initial paged render (feed is empty placeholder until this runs)
        if (entries.length > 0) renderPagedFeed(entries);
    });
}

// ═══════════════════════════════════════════════════════════════════════
// HTML Builders
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check if there's already a diary entry for today.
 */
function _hasTodayEntry(entries) {
    const todayStr = getLocalDateString();
    return entries.some(e => e.date === todayStr);
}

function buildDiaryPage(entries) {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '角色';

    if (entries.length === 0) {
        return buildEmptyState(charName);
    }

    // Feed is rendered by renderPagedFeed() after mount — no feedHtml needed here

    // Calculate stats
    const totalEntries = entries.length;
    const firstDate = entries.length > 0 ? entries[entries.length - 1].date : '';
    const streakDays = calculateStreak(entries);

    const savedTheme = getSavedTheme();
    const themeClass = savedTheme !== 'default' ? ` diary-theme-${savedTheme}` : '';

    return `
    <div class="diary-page${themeClass}" id="diary_page_root">
        <div class="diary-scroll-content">
            <!-- Header -->
            <div class="diary-header">
                <div class="diary-header-left">
                    <div class="diary-header-title">我们的日记</div>
                    <div class="diary-header-subtitle">Our Little Story ♡</div>
                </div>
                <div class="diary-header-actions">
                    <button class="diary-header-btn diary-btn-tool" id="diary_search_btn" title="搜索">
                        <i class="fa-solid fa-magnifying-glass"></i>
                    </button>
                    <button class="diary-header-btn diary-btn-tool" id="diary_calendar_btn" title="日历">
                        <i class="fa-regular fa-calendar"></i>
                    </button>
                    <button class="diary-header-btn diary-btn-settings" id="diary_settings_btn" title="设置">
                        <i class="fa-solid fa-ellipsis"></i>
                    </button>
                    <button class="diary-header-btn diary-btn-compose" id="diary_compose_open_btn" title="写日记">
                        <i class="fa-solid fa-feather-pointed"></i>
                    </button>
                </div>
            </div>

            <!-- Stats -->
            <div class="diary-stats">
                <div class="diary-stats-hearts">💕</div>
                <div class="diary-stats-text">
                    <div class="diary-stats-title">一起写了 ${totalEntries} 篇日记</div>
                    <div class="diary-stats-count">${firstDate ? 'since ' + firstDate : 'start your story today'}</div>
                </div>
                <div class="diary-stats-streak">
                    <div class="diary-stats-streak-num">${streakDays}</div>
                    <div class="diary-stats-streak-label">连续天</div>
                </div>
            </div>

            <!-- Feed -->
            <div id="diary_feed"></div>

            <!-- Pagination -->
            <div class="diary-pagination" id="diary_pagination"></div>
        </div>

        <!-- Compose Overlay -->
        ${buildComposeOverlay(_hasTodayEntry(entries))}

        <!-- Settings Sheet -->
        ${buildSettingsSheet()}


        <!-- Calendar Overlay -->
        ${buildCalendarOverlay(entries)}

        <!-- Search Overlay -->
        ${buildSearchOverlay()}

        <!-- Detail Overlay -->
        <div class="diary-detail-overlay" id="diary_detail_overlay"></div>

        <!-- Loading Overlay -->
        <div class="diary-loading-overlay" id="diary_loading_overlay">
            <div class="diary-loading-content">
                <div class="diary-loading-icon">✍️</div>
                <div class="diary-loading-text">${charName}正在写日记…</div>
                <div class="diary-loading-dots"><span>.</span><span>.</span><span>.</span></div>
            </div>
        </div>
    </div>
    `;
}

function buildEmptyState(charName) {
    const savedTheme = getSavedTheme();
    const themeClass = savedTheme !== 'default' ? ` diary-theme-${savedTheme}` : '';

    return `
    <div class="diary-page${themeClass}" id="diary_page_root">
        <div class="diary-scroll-content">
            <div class="diary-header">
                <div class="diary-header-left">
                    <div class="diary-header-title">我们的日记</div>
                    <div class="diary-header-subtitle">Our Little Story ♡</div>
                </div>
                <div class="diary-header-actions">
                    <button class="diary-header-btn diary-btn-tool" id="diary_search_btn" title="搜索">
                        <i class="fa-solid fa-magnifying-glass"></i>
                    </button>
                    <button class="diary-header-btn diary-btn-tool" id="diary_calendar_btn" title="日历">
                        <i class="fa-regular fa-calendar"></i>
                    </button>
                    <button class="diary-header-btn diary-btn-settings" id="diary_settings_btn" title="设置">
                        <i class="fa-solid fa-ellipsis"></i>
                    </button>
                    <button class="diary-header-btn diary-btn-compose" id="diary_compose_open_btn" title="写日记">
                        <i class="fa-solid fa-feather-pointed"></i>
                    </button>
                </div>
            </div>

            <div class="diary-empty">
                <div class="diary-empty-icon">📔</div>
                <div class="diary-empty-title">还没有日记呢</div>
                <div class="diary-empty-desc">
                    在这里和${charName}一起记录你们的故事吧…<br/>
                    每一天都值得被记住 ♡
                </div>
            </div>
        </div>

        <!-- Compose Overlay -->
        ${buildComposeOverlay(false)}

        <!-- Settings Sheet -->
        ${buildSettingsSheet()}


        <!-- Calendar Overlay -->
        ${buildCalendarOverlay([])}

        <!-- Search Overlay -->
        ${buildSearchOverlay()}

        <!-- Detail Overlay -->
        <div class="diary-detail-overlay" id="diary_detail_overlay"></div>

        <!-- Loading Overlay -->
        <div class="diary-loading-overlay" id="diary_loading_overlay">
            <div class="diary-loading-content">
                <div class="diary-loading-icon">✍️</div>
                <div class="diary-loading-text">${charName}正在写ta的回应…</div>
                <div class="diary-loading-dots"><span>.</span><span>.</span><span>.</span></div>
            </div>
        </div>
    </div>
    `;
}

/**
 * Convert newlines in plain text to <br> for HTML rendering.
 */
function nl2br(text) {
    if (!text) return '';
    return text.replace(/\n/g, '<br>');
}

function buildDateGroup(dateStr, entries) {
    const label = formatDateLabel(dateStr);
    const cards = entries.map(e => buildEntryCard(e)).join('');
    return `
    <div class="diary-date-group">
        <div class="diary-date-divider">
            <div class="diary-date-line"></div>
            <div class="diary-date-label">${label}</div>
            <div class="diary-date-line"></div>
        </div>
        ${cards}
    </div>
    `;
}

function buildEntryCard(entry) {
    const segmentsHtml = entry.segments.map(seg => `
        <div class="diary-segment diary-segment-${seg.author}">
            <div class="diary-segment-content">${nl2br(escHtml(truncate(seg.content, 80)))}</div>
        </div>
    `).join('');

    const tagsHtml = (entry.tags || []).map(t => `<span class="diary-tag">#${escHtml(t)}</span>`).join('');

    const pendingBadge = !entry.segments.some(s => s.author === 'char')
        ? '<span class="diary-pending-badge">等待回应</span>'
        : '';

    return `
    <div class="diary-entry-card" data-entry-id="${entry.id}">
        <div class="diary-card-header">
            <div class="diary-card-mood">
                <span class="diary-card-mood-emoji">${entry.mood}</span>
                <span class="diary-card-mood-text">${entry.moodText}</span>
                ${pendingBadge}
            </div>
            <span class="diary-card-time">${formatTime(entry.date)}</span>
        </div>
        <div class="diary-segments">
            ${segmentsHtml}
        </div>
        <div class="diary-card-footer">
            <div class="diary-card-tags">${tagsHtml}</div>
            <div class="diary-card-actions">
                <button class="diary-card-action-btn diary-delete-btn" data-action="delete" title="删除">
                    <i class="fa-regular fa-trash-can"></i>
                </button>
            </div>
        </div>
    </div>
    `;
}

function buildComposeOverlay(isContinuation = false) {
    const today = new Date();
    const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

    const composeTitle = isContinuation ? '续写今日日记' : '写日记';
    const submitLabel = isContinuation ? '续写' : '发布';
    const continuationHint = isContinuation
        ? `<div class="diary-compose-continuation-hint">
               <i class="fa-solid fa-pen-nib"></i>
               续写今天的日记，新内容将追加到已有日记中
           </div>`
        : '';

    return `
    <div class="diary-compose-overlay" id="diary_compose_overlay">
        <div class="diary-compose-header">
            <button class="diary-compose-cancel" id="diary_compose_cancel">取消</button>
            <div class="diary-compose-title">${composeTitle}</div>
            <div class="diary-compose-header-actions">
                <button class="diary-compose-submit" id="diary_compose_submit">${submitLabel}</button>
                <button class="diary-compose-submit" id="diary_compose_ai_write" title="让你对象主动写日记">
                    让TA写
                </button>
            </div>
        </div>
        <div class="diary-compose-body">
            ${continuationHint}
            <!-- Date -->
            <div class="diary-compose-date-row">
                <span class="diary-compose-date-icon">📅</span>
                <span class="diary-compose-date-text" id="diary_compose_date">${dateStr}</span>
            </div>

            <!-- Mood -->
            <div class="diary-compose-mood-section">
                <div class="diary-compose-section-label">今天的心情 ✧</div>
                <div class="diary-compose-mood-input-row">
                    <input type="text" class="diary-compose-mood-emoji-input" id="diary_mood_input"
                        value="🥰" maxlength="4" placeholder="🥰" />
                    <span class="diary-compose-mood-hint">输入任意 emoji</span>
                </div>
            </div>

            <!-- Content -->
            <div class="diary-compose-textarea-wrap">
                <div class="diary-compose-section-label">写点什么吧 ♡</div>
                <textarea class="diary-compose-textarea" id="diary_compose_text"
                    placeholder="今天发生了什么让你心动的事呢…"></textarea>
                <div class="diary-compose-char-count"><span id="diary_char_count">0</span> 字</div>
            </div>

            <!-- Tags -->
            <div class="diary-compose-mood-section">
                <div class="diary-compose-section-label">添加标签</div>
                <div class="diary-compose-tags-row" id="diary_tags_row">
                    <input class="diary-compose-tag-input" id="diary_tag_input"
                        placeholder="输入标签，按回车添加" />
                </div>
            </div>
        </div>
    </div>
    `;
}

function buildDetailView(entry) {
    const segmentsHtml = entry.segments.map((seg, idx) => `
        <div class="diary-segment diary-segment-${seg.author}" data-seg-idx="${idx}">
            <div class="diary-segment-content">${nl2br(escHtml(seg.content))}</div>
        </div>
    `).join('');

    const tagsHtml = (entry.tags || []).map(t => `<span class="diary-tag">#${escHtml(t)}</span>`).join('');

    return `
        <div class="diary-detail-header">
            <button class="diary-calendar-close" id="diary_detail_close_btn">
                <i class="fa-solid fa-xmark"></i>
            </button>
            <span class="diary-detail-date">${formatFullDate(entry.date)}</span>
            <div class="diary-detail-actions">
                <button class="diary-detail-edit-btn" id="diary_detail_edit_btn" title="编辑日记">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="diary-detail-print-btn" id="diary_detail_print_btn" title="打印这篇日记">
                    <i class="fa-solid fa-print"></i>
                </button>
            </div>
        </div>
        <div class="diary-detail-body">
            <div class="diary-detail-page">
                <div class="diary-detail-mood-line">
                    <span class="diary-detail-mood-emoji">${entry.mood}</span>
                    <span class="diary-detail-mood-text">${entry.moodText}</span>
                </div>
                ${segmentsHtml}
                <div class="diary-detail-tags">${tagsHtml}</div>
            </div>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════════════════
// Settings Sheet
// ═══════════════════════════════════════════════════════════════════════

function getSavedTheme() {
    return localStorage.getItem(DIARY_THEME_KEY) || 'default';
}

function saveTheme(themeId) {
    localStorage.setItem(DIARY_THEME_KEY, themeId);
}

function applyTheme(themeId) {
    const root = document.getElementById('diary_page_root');
    if (!root) return;
    // Remove all theme classes
    DIARY_THEMES.forEach(t => {
        if (t.id !== 'default') root.classList.remove(`diary-theme-${t.id}`);
    });
    // Add new theme class
    if (themeId !== 'default') {
        root.classList.add(`diary-theme-${themeId}`);
    }
    saveTheme(themeId);
    // Clear custom vars when switching to a preset theme
    clearCustomVars();
    // Update selected state in settings sheet
    document.querySelectorAll('.diary-theme-card').forEach(card => {
        card.classList.toggle('theme-selected', card.dataset.theme === themeId);
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Custom Visual Settings (CSS Variables)
// ═══════════════════════════════════════════════════════════════════════

function loadCustomVars() {
    try {
        const raw = localStorage.getItem(DIARY_CUSTOM_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function saveCustomVars(vars) {
    localStorage.setItem(DIARY_CUSTOM_KEY, JSON.stringify(vars));
}

function clearCustomVars() {
    localStorage.removeItem(DIARY_CUSTOM_KEY);
    const root = document.getElementById('diary_page_root');
    if (!root) return;
    // Remove all custom CSS variables from inline style
    Object.keys(CUSTOM_VAR_DEFAULTS).forEach(key => root.style.removeProperty(key));
    // Also clear computed vars
    ['--diary-bg', '--diary-card-bg', '--diary-accent-gradient', '--diary-accent-shadow',
        '--diary-title-color', '--diary-user-text-color', '--diary-char-text-color',
        '--diary-font-main', '--diary-char-font', '--diary-font-size', '--diary-char-font-size',
        '--diary-line-height'].forEach(v => root.style.removeProperty(v));
    // Re-apply saved theme
    const themeId = getSavedTheme();
    DIARY_THEMES.forEach(t => {
        if (t.id !== 'default') root.classList.remove(`diary-theme-${t.id}`);
    });
    if (themeId !== 'default') {
        root.classList.add(`diary-theme-${themeId}`);
    }
}

function applyCustomVars(vars) {
    const root = document.getElementById('diary_page_root');
    if (!root || !vars) return;

    // Remove theme classes — they use !important and override CSS variables
    DIARY_THEMES.forEach(t => {
        if (t.id !== 'default') root.classList.remove(`diary-theme-${t.id}`);
    });

    // Map input values → actual CSS custom properties
    if (vars['--diary-bg-color']) {
        root.style.setProperty('--diary-bg', vars['--diary-bg-color']);
    }
    if (vars['--diary-card-bg-color']) {
        root.style.setProperty('--diary-card-bg', vars['--diary-card-bg-color'] + 'dd');
    }
    if (vars['--diary-title-color']) {
        root.style.setProperty('--diary-title-color', vars['--diary-title-color']);
    }
    if (vars['--diary-user-text-color']) {
        root.style.setProperty('--diary-user-text-color', vars['--diary-user-text-color']);
    }
    if (vars['--diary-char-text-color']) {
        root.style.setProperty('--diary-char-text-color', vars['--diary-char-text-color']);
    }
    if (vars['--diary-accent-color']) {
        const c = vars['--diary-accent-color'];
        root.style.setProperty('--diary-accent-gradient', `linear-gradient(135deg, ${c}, ${darkenHex(c, 20)})`);
        root.style.setProperty('--diary-accent-shadow', `${c}66`);
    }
    // Font: custom name overrides dropdown
    const customUserFont = (vars['--diary-custom-font-user'] || '').trim();
    const customCharFont = (vars['--diary-custom-font-char'] || '').trim();
    if (customUserFont) {
        root.style.setProperty('--diary-font-main', `'${customUserFont}', serif`);
    } else if (vars['--diary-font-main']) {
        root.style.setProperty('--diary-font-main', vars['--diary-font-main']);
    }
    if (customCharFont) {
        root.style.setProperty('--diary-char-font', `'${customCharFont}', cursive`);
    } else if (vars['--diary-char-font']) {
        root.style.setProperty('--diary-char-font', vars['--diary-char-font']);
    }
    if (vars['--diary-font-size']) {
        root.style.setProperty('--diary-font-size', vars['--diary-font-size'] + 'px');
        root.style.setProperty('--diary-char-font-size', (parseInt(vars['--diary-font-size']) + 3) + 'px');
    }
    if (vars['--diary-line-height']) {
        root.style.setProperty('--diary-line-height', vars['--diary-line-height']);
    }

    // Load custom Google Fonts URL
    const fontUrl = (vars['--diary-custom-font-url'] || '').trim();
    const existing = document.getElementById('diary_custom_font_link');
    if (fontUrl) {
        // Normalize: if user pastes a full @import or CSS URL, extract the href
        let href = fontUrl;
        const importMatch = fontUrl.match(/url\(['"]?([^)'"]+)['"]?\)/);
        if (importMatch) href = importMatch[1];

        if (existing) {
            if (existing.href !== href) existing.href = href;
        } else {
            const link = document.createElement('link');
            link.id = 'diary_custom_font_link';
            link.rel = 'stylesheet';
            link.href = href;
            document.head.appendChild(link);
        }
    } else if (existing) {
        existing.remove();
    }
}

function darkenHex(hex, amount) {
    hex = hex.replace('#', '');
    const r = Math.max(0, parseInt(hex.substring(0, 2), 16) - amount);
    const g = Math.max(0, parseInt(hex.substring(2, 4), 16) - amount);
    const b = Math.max(0, parseInt(hex.substring(4, 6), 16) - amount);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function restoreCustomVarsOnLoad() {
    const vars = loadCustomVars();
    if (vars) applyCustomVars(vars);
}

function updateFontPreview(vars) {
    const userPreview = document.getElementById('diary_font_preview_user');
    const charPreview = document.getElementById('diary_font_preview_char');
    if (!userPreview || !charPreview) return;

    const customUser = (vars['--diary-custom-font-user'] || '').trim();
    const customChar = (vars['--diary-custom-font-char'] || '').trim();
    const userFont = customUser ? `'${customUser}', serif` : (vars['--diary-font-main'] || CUSTOM_VAR_DEFAULTS['--diary-font-main']);
    const charFont = customChar ? `'${customChar}', cursive` : (vars['--diary-char-font'] || CUSTOM_VAR_DEFAULTS['--diary-char-font']);
    const fontSize = (vars['--diary-font-size'] || CUSTOM_VAR_DEFAULTS['--diary-font-size']) + 'px';
    const lineHeight = vars['--diary-line-height'] || CUSTOM_VAR_DEFAULTS['--diary-line-height'];

    userPreview.style.fontFamily = userFont;
    userPreview.style.fontSize = fontSize;
    userPreview.style.lineHeight = lineHeight;
    userPreview.style.color = vars['--diary-user-text-color'] || CUSTOM_VAR_DEFAULTS['--diary-user-text-color'];

    charPreview.style.fontFamily = charFont;
    charPreview.style.fontSize = (parseInt(vars['--diary-font-size'] || CUSTOM_VAR_DEFAULTS['--diary-font-size']) + 3) + 'px';
    charPreview.style.lineHeight = lineHeight;
    charPreview.style.color = vars['--diary-char-text-color'] || CUSTOM_VAR_DEFAULTS['--diary-char-text-color'];
}

function buildSettingsSheet() {
    const currentTheme = getSavedTheme();
    const saved = loadCustomVars() || CUSTOM_VAR_DEFAULTS;

    const themesHtml = DIARY_THEMES.map(t => `
        <div class="diary-theme-card ${t.id === currentTheme ? 'theme-selected' : ''}" data-theme="${t.id}">
            <div class="diary-theme-preview diary-theme-preview-${t.id}"></div>
            <div class="diary-theme-info">
                <span class="diary-theme-emoji">${t.emoji}</span>
                <span class="diary-theme-name">${t.name}</span>
            </div>
        </div>
    `).join('');

    const fontOptionsHtml = (currentVal) => DIARY_FONTS.map(group => `
        <optgroup label="${group.label}">
            ${group.options.map(f => `
                <option value="${f.value}" ${f.value === currentVal ? 'selected' : ''}>${f.name}</option>
            `).join('')}
        </optgroup>
    `).join('');

    return `
    <div class="diary-settings-overlay" id="diary_settings_overlay">
        <div class="diary-settings-header">
            <button class="diary-calendar-close" id="diary_settings_close">
                <i class="fa-solid fa-xmark"></i>
            </button>
            <div class="diary-calendar-title">日记本设置</div>
            <div style="width:38px;"></div>
        </div>
        <div class="diary-settings-body">
            <div class="diary-settings-section">
                <div class="diary-settings-section-label">主题</div>
                <div class="diary-settings-theme-grid" id="diary_theme_grid">
                    ${themesHtml}
                </div>
            </div>

            <div class="diary-customize-divider"></div>

            <!-- Custom Colors -->
            <div class="diary-customize-section">
                <div class="diary-customize-section-label">颜色</div>
                <div class="diary-customize-row">
                    <div class="diary-customize-group">
                        <label>背景色</label>
                        <input type="color" data-var="--diary-bg-color" value="${saved['--diary-bg-color'] || CUSTOM_VAR_DEFAULTS['--diary-bg-color']}">
                    </div>
                    <div class="diary-customize-group">
                        <label>卡片背景</label>
                        <input type="color" data-var="--diary-card-bg-color" value="${saved['--diary-card-bg-color'] || CUSTOM_VAR_DEFAULTS['--diary-card-bg-color']}">
                    </div>
                    <div class="diary-customize-group">
                        <label>强调色</label>
                        <input type="color" data-var="--diary-accent-color" value="${saved['--diary-accent-color'] || CUSTOM_VAR_DEFAULTS['--diary-accent-color']}">
                    </div>
                </div>
                <div class="diary-customize-row">
                    <div class="diary-customize-group">
                        <label>标题颜色</label>
                        <input type="color" data-var="--diary-title-color" value="${saved['--diary-title-color'] || CUSTOM_VAR_DEFAULTS['--diary-title-color']}">
                    </div>
                    <div class="diary-customize-group">
                        <label>我的文字</label>
                        <input type="color" data-var="--diary-user-text-color" value="${saved['--diary-user-text-color'] || CUSTOM_VAR_DEFAULTS['--diary-user-text-color']}">
                    </div>
                    <div class="diary-customize-group">
                        <label>Ta的文字</label>
                        <input type="color" data-var="--diary-char-text-color" value="${saved['--diary-char-text-color'] || CUSTOM_VAR_DEFAULTS['--diary-char-text-color']}">
                    </div>
                </div>
            </div>

            <div class="diary-customize-divider"></div>

            <!-- Custom Typography -->
            <div class="diary-customize-section">
                <div class="diary-customize-section-label">字体</div>
                <div class="diary-font-hint">选择预设字体可直接使用，也可以在下方配置自定义字体</div>
                <div class="diary-customize-row">
                    <div class="diary-customize-group" style="flex:2">
                        <label>我的字体</label>
                        <select data-var="--diary-font-main">
                            ${fontOptionsHtml(saved['--diary-font-main'] || CUSTOM_VAR_DEFAULTS['--diary-font-main'])}
                        </select>
                    </div>
                </div>
                <div class="diary-customize-row">
                    <div class="diary-customize-group" style="flex:2">
                        <label>Ta的字体</label>
                        <select data-var="--diary-char-font">
                            ${fontOptionsHtml(saved['--diary-char-font'] || CUSTOM_VAR_DEFAULTS['--diary-char-font'])}
                        </select>
                    </div>
                </div>

                <div class="diary-font-guide" id="diary_font_guide">
                    <div class="diary-font-guide-toggle" id="diary_font_guide_toggle">
                        <span class="diary-font-guide-toggle-icon"><i class="fa-solid fa-lightbulb"></i></span>
                        <span>如何使用自定义字体？</span>
                        <i class="fa-solid fa-chevron-down diary-font-guide-arrow"></i>
                    </div>
                    <div class="diary-font-guide-body" id="diary_font_guide_body">
                        <div class="diary-font-guide-step">
                            <span class="diary-font-guide-num">①</span>
                            <span>打开 <a href="https://fonts.google.com" target="_blank" rel="noopener">Google Fonts</a>，搜索喜欢的字体<br><span class="diary-font-guide-tip">推荐中文字体搜索：LXGW WenKai、Noto Serif SC 等</span></span>
                        </div>
                        <div class="diary-font-guide-step">
                            <span class="diary-font-guide-num">②</span>
                            <span>点击字体 → "Get Font" → "Get embed code"</span>
                        </div>
                        <div class="diary-font-guide-step">
                            <span class="diary-font-guide-num">③</span>
                            <span>复制 <code>&lt;link&gt;</code> 标签中 href="…" 的链接，粘贴到下方「Google Fonts 链接」框</span>
                        </div>
                        <div class="diary-font-guide-step">
                            <span class="diary-font-guide-num">④</span>
                            <span>在「自定义字体名」中输入字体的英文名（如 <code>LXGW WenKai</code>），即可生效</span>
                        </div>
                    </div>
                </div>

                <div class="diary-customize-row">
                    <div class="diary-customize-group" style="flex:1">
                        <label>Google Fonts 链接</label>
                        <input type="text" data-var="--diary-custom-font-url" value="${saved['--diary-custom-font-url'] || ''}" placeholder="例: https://fonts.googleapis.com/css2?family=…">
                    </div>
                </div>
                <div class="diary-customize-row">
                    <div class="diary-customize-group">
                        <label>自定义我的字体</label>
                        <input type="text" data-var="--diary-custom-font-user" value="${saved['--diary-custom-font-user'] || ''}" placeholder="例: LXGW WenKai">
                    </div>
                    <div class="diary-customize-group">
                        <label>自定义Ta的字体</label>
                        <input type="text" data-var="--diary-custom-font-char" value="${saved['--diary-custom-font-char'] || ''}" placeholder="例: Caveat">
                    </div>
                </div>
                <div class="diary-font-hint diary-font-hint-subtle">填写自定义字体名后将覆盖上方对应的预设字体</div>

                <div class="diary-font-preview" id="diary_font_preview">
                    <div class="diary-font-preview-label">预览</div>
                    <div class="diary-font-preview-row">
                        <span class="diary-font-preview-who">我：</span>
                        <span class="diary-font-preview-text diary-font-preview-user" id="diary_font_preview_user">今天天气真好呀 ☀️</span>
                    </div>
                    <div class="diary-font-preview-row">
                        <span class="diary-font-preview-who">Ta：</span>
                        <span class="diary-font-preview-text diary-font-preview-char" id="diary_font_preview_char">是呢，和你在一起每天都是好天气 💕</span>
                    </div>
                </div>

                <div class="diary-customize-row">
                    <div class="diary-customize-group">
                        <label>字号 (px)</label>
                        <input type="number" data-var="--diary-font-size" value="${saved['--diary-font-size'] || CUSTOM_VAR_DEFAULTS['--diary-font-size']}" min="12" max="28" step="1">
                    </div>
                    <div class="diary-customize-group">
                        <label>行高</label>
                        <input type="number" data-var="--diary-line-height" value="${saved['--diary-line-height'] || CUSTOM_VAR_DEFAULTS['--diary-line-height']}" min="1.2" max="3.0" step="0.1">
                    </div>
                </div>
            </div>

            <div class="diary-customize-divider"></div>

            <!-- Reset -->
            <button class="diary-customize-reset-btn" id="diary_customize_reset">
                <i class="fa-solid fa-rotate-left"></i>
                恢复默认
            </button>
            <div class="diary-customize-hint">修改实时生效并自动保存 ♡</div>
        </div>
    </div>
    `;
}

// ═══════════════════════════════════════════════════════════════════════
// Calendar Overlay
// ═══════════════════════════════════════════════════════════════════════

function buildCalendarOverlay(entries) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    return `
    <div class="diary-calendar-overlay" id="diary_calendar_overlay">
        <div class="diary-calendar-header">
            <button class="diary-calendar-close" id="diary_calendar_close">
                <i class="fa-solid fa-xmark"></i>
            </button>
            <div class="diary-calendar-title">日记日历</div>
            <div style="width:38px;"></div>
        </div>
        <div class="diary-calendar-nav">
            <button class="diary-calendar-nav-btn" id="diary_cal_prev">
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            <span class="diary-calendar-month" id="diary_cal_month_label">${year}年${month + 1}月</span>
            <button class="diary-calendar-nav-btn" id="diary_cal_next">
                <i class="fa-solid fa-chevron-right"></i>
            </button>
        </div>
        <div class="diary-calendar-weekdays">
            <span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>
        </div>
        <div class="diary-calendar-grid" id="diary_cal_grid">
        </div>
        <div class="diary-calendar-legend">
            <span class="diary-calendar-legend-dot diary-cal-has-entry"></span>
            <span>写了日记</span>
        </div>
    </div>
    `;
}

function renderCalendarMonth(year, month, entries) {
    const grid = document.getElementById('diary_cal_grid');
    const label = document.getElementById('diary_cal_month_label');
    if (!grid || !label) return;

    label.textContent = `${year}年${month + 1}月`;

    const diaryDates = new Set(entries.map(e => e.date));
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = getLocalDateString();

    let html = '';
    for (let i = 0; i < firstDay; i++) {
        html += '<div class="diary-cal-cell diary-cal-empty"></div>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const hasEntry = diaryDates.has(dateStr);
        const isToday = dateStr === todayStr;
        const classes = [
            'diary-cal-cell',
            hasEntry ? 'diary-cal-has-entry' : '',
            isToday ? 'diary-cal-today' : '',
        ].filter(Boolean).join(' ');
        html += `<div class="${classes}" data-date="${dateStr}">${d}</div>`;
    }

    grid.innerHTML = html;

    grid.querySelectorAll('.diary-cal-has-entry').forEach(cell => {
        cell.addEventListener('click', () => {
            const date = cell.dataset.date;
            const overlay = document.getElementById('diary_calendar_overlay');
            if (overlay) overlay.classList.remove('calendar-active');
            scrollToDate(date);
        });
    });
}

function scrollToDate(dateStr) {
    // Find which page contains an entry for this date and navigate there first
    const entries = loadDiaryEntries();
    const idx = entries.findIndex(e => e.date === dateStr);
    if (idx !== -1) {
        const targetPage = Math.floor(idx / DIARY_PAGE_SIZE);
        if (targetPage !== _diaryCurrentPage) {
            _diaryCurrentPage = targetPage;
            renderPagedFeed(entries);
        }
    }

    // Now scroll into view
    requestAnimationFrame(() => {
        const feed = document.getElementById('diary_feed');
        if (!feed) return;
        const cards = feed.querySelectorAll('.diary-entry-card');
        for (const card of cards) {
            const id = parseInt(card.dataset.entryId);
            const entry = entries.find(e => e.id === id);
            if (entry && entry.date === dateStr) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.classList.add('diary-card-highlight');
                setTimeout(() => card.classList.remove('diary-card-highlight'), 1500);
                return;
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Search Overlay
// ═══════════════════════════════════════════════════════════════════════

function buildSearchOverlay() {
    return `
    <div class="diary-search-overlay" id="diary_search_overlay">
        <div class="diary-search-header">
            <div class="diary-search-input-wrap">
                <i class="fa-solid fa-magnifying-glass diary-search-icon"></i>
                <input type="text" class="diary-search-input" id="diary_search_input"
                    placeholder="搜索日记内容、标签…" autocomplete="off" />
            </div>
            <button class="diary-search-cancel" id="diary_search_cancel">取消</button>
        </div>
        <div class="diary-search-results" id="diary_search_results">
            <div class="diary-search-empty">
                <div class="diary-search-empty-icon">🔍</div>
                <div class="diary-search-empty-text">输入关键词搜索日记</div>
            </div>
        </div>
    </div>
    `;
}

function performSearch(query) {
    const resultsEl = document.getElementById('diary_search_results');
    if (!resultsEl) return;

    if (!query.trim()) {
        resultsEl.innerHTML = `
            <div class="diary-search-empty">
                <div class="diary-search-empty-icon">🔍</div>
                <div class="diary-search-empty-text">输入关键词搜索日记</div>
            </div>
        `;
        return;
    }

    const entries = loadDiaryEntries();
    const q = query.toLowerCase();
    const matches = entries.filter(e => {
        const segMatch = e.segments.some(s => s.content.toLowerCase().includes(q));
        const tagMatch = e.tags.some(t => t.toLowerCase().includes(q));
        const moodMatch = e.moodText?.toLowerCase().includes(q);
        return segMatch || tagMatch || moodMatch;
    });

    if (matches.length === 0) {
        resultsEl.innerHTML = `
            <div class="diary-search-empty">
                <div class="diary-search-empty-icon">📭</div>
                <div class="diary-search-empty-text">没有找到相关日记</div>
            </div>
        `;
        return;
    }

    resultsEl.innerHTML = `
        <div class="diary-search-count">${matches.length} 条结果</div>
        ${matches.map(e => {
        const preview = e.segments.map(s => s.content).join(' ');
        const highlighted = highlightQuery(truncate(preview, 100), query);
        return `
            <div class="diary-search-result-card" data-entry-id="${e.id}">
                <div class="diary-search-result-header">
                    <span class="diary-search-result-mood">${e.mood}</span>
                    <span class="diary-search-result-date">${formatDateLabel(e.date)}</span>
                </div>
                <div class="diary-search-result-preview">${highlighted}</div>
                <div class="diary-search-result-tags">
                    ${e.tags.map(t => `<span class="diary-tag">#${t}</span>`).join('')}
                </div>
            </div>
            `;
    }).join('')}
    `;

    resultsEl.querySelectorAll('.diary-search-result-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = parseInt(card.dataset.entryId);
            const entry = entries.find(en => en.id === id);
            if (entry) {
                const overlay = document.getElementById('diary_search_overlay');
                if (overlay) overlay.classList.remove('search-active');
                openDetail(entry);
            }
        });
    });
}

function highlightQuery(text, query) {
    if (!query) return escHtml(text);
    const escaped = escHtml(text);
    const q = escHtml(query);
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escaped.replace(regex, '<mark class="diary-search-highlight">$1</mark>');
}

// ═══════════════════════════════════════════════════════════════════════
// Event Binding
// ═══════════════════════════════════════════════════════════════════════


function bindDiaryEvents() {
    const root = document.getElementById('diary_page_root');
    if (!root) return;

    // Open compose — dynamically update title/button/hint based on whether today has an entry
    const openCompose = () => {
        const overlay = document.getElementById('diary_compose_overlay');
        if (!overlay) return;

        // Check if today already has an entry
        const entries = loadDiaryEntries();
        const isContinuation = _hasTodayEntry(entries);

        // Update compose title
        const title = overlay.querySelector('.diary-compose-title');
        if (title) title.textContent = isContinuation ? '续写今日日记' : '写日记';

        // Update submit button label
        const submitBtn = overlay.querySelector('.diary-compose-submit');
        if (submitBtn) submitBtn.textContent = isContinuation ? '续写' : '发布';

        // Update or insert/remove continuation hint
        const existingHint = overlay.querySelector('.diary-compose-continuation-hint');
        const composeBody = overlay.querySelector('.diary-compose-body');
        if (isContinuation && !existingHint && composeBody) {
            const hint = document.createElement('div');
            hint.className = 'diary-compose-continuation-hint';
            hint.innerHTML = '<i class="fa-solid fa-pen-nib"></i> 续写今天的日记，新内容将追加到已有日记中';
            composeBody.prepend(hint);
        } else if (!isContinuation && existingHint) {
            existingHint.remove();
        }

        overlay.classList.add('compose-active');
    };
    onClick('diary_compose_open_btn', openCompose);

    // Settings button
    onClick('diary_settings_btn', () => {
        const overlay = document.getElementById('diary_settings_overlay');
        if (overlay) overlay.classList.add('settings-active');
    });

    // Settings close
    onClick('diary_settings_close', () => {
        const overlay = document.getElementById('diary_settings_overlay');
        if (overlay) overlay.classList.remove('settings-active');
    });

    // Theme selection
    const themeGrid = document.getElementById('diary_theme_grid');
    if (themeGrid) {
        themeGrid.addEventListener('click', (e) => {
            const card = e.target.closest('.diary-theme-card');
            if (!card) return;
            applyTheme(card.dataset.theme);
        });
    }


    // Customize panel — live input binding (now inside settings body)
    const customizeBody = document.querySelector('.diary-settings-body');
    if (customizeBody) {
        const allInputs = customizeBody.querySelectorAll('[data-var]');
        allInputs.forEach(input => {
            const handler = () => {
                // Collect all current values
                const vars = {};
                allInputs.forEach(inp => {
                    vars[inp.dataset.var] = inp.value;
                });
                saveCustomVars(vars);
                applyCustomVars(vars);
                updateFontPreview(vars);
            };
            input.addEventListener('input', handler);
            input.addEventListener('change', handler);
        });

        // Initialize font preview with current values
        const initVars = {};
        allInputs.forEach(inp => { initVars[inp.dataset.var] = inp.value; });
        updateFontPreview(initVars);
    }

    // Font guide tutorial toggle
    onClick('diary_font_guide_toggle', () => {
        const guide = document.getElementById('diary_font_guide');
        if (guide) guide.classList.toggle('guide-open');
    });

    // Customize reset button
    onClick('diary_customize_reset', () => {
        clearCustomVars();
        // Reset all inputs to defaults
        const body = document.querySelector('.diary-settings-body');
        if (body) {
            body.querySelectorAll('[data-var]').forEach(input => {
                const key = input.dataset.var;
                if (CUSTOM_VAR_DEFAULTS[key] !== undefined) {
                    input.value = CUSTOM_VAR_DEFAULTS[key];
                }
            });
        }
    });

    // Print button — removed from settings, now in detail view
    // (bound dynamically in openDetail via bindDetailEvents)

    // Calendar button
    onClick('diary_calendar_btn', () => {
        const overlay = document.getElementById('diary_calendar_overlay');
        if (overlay) {
            overlay.classList.add('calendar-active');
            // Initialize with current month
            const now = new Date();
            overlay._calYear = now.getFullYear();
            overlay._calMonth = now.getMonth();
            renderCalendarMonth(overlay._calYear, overlay._calMonth, loadDiaryEntries());
        }
    });

    // Calendar close
    onClick('diary_calendar_close', () => {
        const overlay = document.getElementById('diary_calendar_overlay');
        if (overlay) overlay.classList.remove('calendar-active');
    });

    // Calendar navigation
    onClick('diary_cal_prev', () => {
        const overlay = document.getElementById('diary_calendar_overlay');
        if (!overlay) return;
        overlay._calMonth--;
        if (overlay._calMonth < 0) { overlay._calMonth = 11; overlay._calYear--; }
        renderCalendarMonth(overlay._calYear, overlay._calMonth, loadDiaryEntries());
    });
    onClick('diary_cal_next', () => {
        const overlay = document.getElementById('diary_calendar_overlay');
        if (!overlay) return;
        overlay._calMonth++;
        if (overlay._calMonth > 11) { overlay._calMonth = 0; overlay._calYear++; }
        renderCalendarMonth(overlay._calYear, overlay._calMonth, loadDiaryEntries());
    });

    // Search button
    onClick('diary_search_btn', () => {
        const overlay = document.getElementById('diary_search_overlay');
        if (overlay) {
            overlay.classList.add('search-active');
            const input = document.getElementById('diary_search_input');
            if (input) { input.value = ''; input.focus(); }
            performSearch('');
        }
    });

    // Search cancel
    onClick('diary_search_cancel', () => {
        const overlay = document.getElementById('diary_search_overlay');
        if (overlay) overlay.classList.remove('search-active');
    });

    // Search input
    const searchInput = document.getElementById('diary_search_input');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => performSearch(searchInput.value), 200);
        });
    }

    // Close compose
    onClick('diary_compose_cancel', () => {
        const overlay = document.getElementById('diary_compose_overlay');
        if (overlay) overlay.classList.remove('compose-active');
    });

    // Compose submit — THE REAL DEAL (with same-day merging)
    onClick('diary_compose_submit', async () => {
        const textarea = document.getElementById('diary_compose_text');
        const content = textarea?.value?.trim();
        if (!content) return;

        // Gather mood
        const moodInput = document.getElementById('diary_mood_input');
        const mood = moodInput?.value?.trim() || '🥰';

        // Gather tags
        const tags = [];
        document.querySelectorAll('#diary_tags_row .diary-compose-tag-chip').forEach(chip => {
            const text = chip.textContent.replace(/[#×✕]/g, '').trim();
            if (text) tags.push(text);
        });

        const userName = getPhoneUserName();
        const charInfo = getPhoneCharInfo();
        const charName = charInfo?.name || 'Character';

        const entries = loadDiaryEntries();
        const todayStr = getLocalDateString();
        const existingToday = entries.find(e => e.date === todayStr);

        let targetEntryId;
        let existingSegments = [];

        if (existingToday) {
            // ═══ 续写模式：追加 segment 到今天已有的日记 ═══
            existingSegments = [...existingToday.segments]; // snapshot for LLM context
            existingToday.segments.push({
                author: 'user',
                name: userName,
                content,
            });
            // 合并 tags（去重）
            const mergedTags = [...new Set([...existingToday.tags, ...tags])];
            existingToday.tags = mergedTags;
            // 更新 mood
            existingToday.mood = mood;
            targetEntryId = existingToday.id;
            saveDiaryEntries(entries);
            console.log(`${DIARY_LOG_PREFIX} 续写今日日记 (id=${targetEntryId})`);
        } else {
            // ═══ 新建模式：创建全新 entry ═══
            const newEntry = {
                id: _nextId(entries),
                date: todayStr,
                mood,
                moodText: '心有所感',
                segments: [
                    { author: 'user', name: userName, content },
                ],
                tags,
                liked: false,
                createdAt: new Date().toISOString(),
            };
            targetEntryId = newEntry.id;
            entries.unshift(newEntry);
            saveDiaryEntries(entries);
            console.log(`${DIARY_LOG_PREFIX} 新建今日日记 (id=${targetEntryId})`);
        }

        // Close compose overlay
        const overlay = document.getElementById('diary_compose_overlay');
        if (overlay) overlay.classList.remove('compose-active');

        // Clear compose form
        if (textarea) textarea.value = '';
        const charCount = document.getElementById('diary_char_count');
        if (charCount) charCount.textContent = '0';
        // Reset mood input
        const moodInput2 = document.getElementById('diary_mood_input');
        if (moodInput2) moodInput2.value = '🥰';
        // Remove tag chips
        document.querySelectorAll('#diary_tags_row .diary-compose-tag-chip').forEach(chip => chip.remove());

        // Refresh the feed immediately with user's entry
        refreshFeed();

        // Generate character response (callPhoneLLM handles API mode routing)
        showLoading(true);
        try {
            const result = await generateCharacterDiaryEntry(
                content, mood, tags,
                entries.filter(e => e.id !== targetEntryId).slice(0, 3),
                existingSegments,
            );
            if (result) {
                // Re-load entries (in case of concurrent writes)
                const latest = loadDiaryEntries();
                const target = latest.find(e => e.id === targetEntryId);
                if (target) {
                    target.segments.push({
                        author: 'char',
                        name: charName,
                        content: result.content,
                    });
                    if (result.moodText) {
                        target.moodText = result.moodText;
                    }
                    saveDiaryEntries(latest);
                }
                refreshFeed();
            }
        } catch (e) {
            console.warn(`${DIARY_LOG_PREFIX} Character diary generation failed:`, e);
        } finally {
            showLoading(false);
        }
    });

    // AI proactive diary write button — 让角色主动写日记
    onClick('diary_compose_ai_write', async () => {
        const charInfo = getPhoneCharInfo();
        const charName = charInfo?.name || 'Character';
        const entries = loadDiaryEntries();
        const todayStr = getLocalDateString();
        const existingToday = entries.find(e => e.date === todayStr);

        // Close compose overlay
        const overlay = document.getElementById('diary_compose_overlay');
        if (overlay) overlay.classList.remove('compose-active');

        // Show loading
        showLoading(true);
        try {
            const existingSegments = existingToday ? [...existingToday.segments] : [];
            const contextEntries = entries.filter(e => e.date !== todayStr).slice(0, 3);
            const result = await generateProactiveDiaryEntry(contextEntries, existingSegments);

            if (result) {
                const latest = loadDiaryEntries();
                const todayEntry = latest.find(e => e.date === todayStr);

                if (todayEntry) {
                    // Append to existing today entry
                    todayEntry.segments.push({
                        author: 'char',
                        name: charName,
                        content: result.content,
                    });
                    if (result.moodText) todayEntry.moodText = result.moodText;
                    if (result.mood) todayEntry.mood = result.mood;
                    saveDiaryEntries(latest);
                } else {
                    // Create brand new entry written entirely by the character
                    const newEntry = {
                        id: _nextId(latest),
                        date: todayStr,
                        mood: result.mood || '📝',
                        moodText: result.moodText || '心有所感',
                        segments: [
                            { author: 'char', name: charName, content: result.content },
                        ],
                        tags: [],
                        liked: false,
                        createdAt: new Date().toISOString(),
                    };
                    latest.unshift(newEntry);
                    saveDiaryEntries(latest);
                }
                refreshFeed();
            } else {
                console.warn(`${DIARY_LOG_PREFIX} 角色主动写日记返回空结果`);
            }
        } catch (e) {
            console.warn(`${DIARY_LOG_PREFIX} AI proactive diary write failed:`, e);
        } finally {
            showLoading(false);
        }
    });


    // Character count
    const textarea = document.getElementById('diary_compose_text');
    const charCount = document.getElementById('diary_char_count');
    if (textarea && charCount) {
        textarea.addEventListener('input', () => {
            charCount.textContent = textarea.value.length;
        });
    }

    // Tag input
    const tagInput = document.getElementById('diary_tag_input');
    const tagsRow = document.getElementById('diary_tags_row');
    if (tagInput && tagsRow) {
        tagInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && tagInput.value.trim()) {
                e.preventDefault();
                const tag = tagInput.value.trim();
                const chip = document.createElement('div');
                chip.className = 'diary-compose-tag-chip';
                chip.innerHTML = `#${escHtml(tag)} <button class="diary-compose-tag-remove"><i class="fa-solid fa-xmark"></i></button>`;
                chip.querySelector('.diary-compose-tag-remove').addEventListener('click', () => chip.remove());
                tagsRow.insertBefore(chip, tagInput);
                tagInput.value = '';
            }
        });
    }

    // Card click → detail view
    bindCardEvents(root);

    // Listen for external updates (from main LLM parsing)
    if (!_globalDiaryEventsBound) {
        window.addEventListener('diary-entries-updated', () => {
            refreshFeed();
        });
        _globalDiaryEventsBound = true;
    }
}

function bindCardEvents(root) {
    if (!root) return;

    root.querySelectorAll('.diary-entry-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.diary-card-action-btn')) return;
            const id = parseInt(card.dataset.entryId);
            const entries = loadDiaryEntries();
            const entry = entries.find(en => en.id === id);
            if (entry) openDetail(entry);
        });
    });


    // Delete
    root.querySelectorAll('.diary-card-action-btn[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const card = btn.closest('.diary-entry-card');
            const id = parseInt(card?.dataset?.entryId);
            if (!id) return;

            if (!confirm('确定要删除这篇日记吗？删除后无法恢复。')) return;

            const entries = loadDiaryEntries();
            const idx = entries.findIndex(en => en.id === id);
            if (idx !== -1) {
                entries.splice(idx, 1);
                saveDiaryEntries(entries);
                refreshFeed();
            }
        });
    });
}

function refreshFeed() {
    const entries = loadDiaryEntries();
    const statsTitle = document.querySelector('.diary-stats-title');
    const statsCount = document.querySelector('.diary-stats-count');
    const streakNum = document.querySelector('.diary-stats-streak-num');

    if (entries.length === 0) {
        // Reopen to show empty state
        openDiaryApp();
        return;
    }

    // Clamp current page to valid range after possible deletions
    const totalPages = Math.max(1, Math.ceil(entries.length / DIARY_PAGE_SIZE));
    if (_diaryCurrentPage >= totalPages) _diaryCurrentPage = totalPages - 1;

    renderPagedFeed(entries);

    if (statsTitle) statsTitle.textContent = `一起写了 ${entries.length} 篇日记`;
    if (statsCount && entries.length > 0) {
        statsCount.textContent = `since ${entries[entries.length - 1].date}`;
    }
    if (streakNum) streakNum.textContent = calculateStreak(entries);
}

/**
 * Render the diary feed for the current page and update pagination controls.
 * @param {Array} entries - All diary entries (sorted newest-first)
 */
function renderPagedFeed(entries) {
    const feedEl = document.getElementById('diary_feed');
    const paginationEl = document.getElementById('diary_pagination');
    if (!feedEl) return;

    const totalPages = Math.max(1, Math.ceil(entries.length / DIARY_PAGE_SIZE));
    // Clamp page
    if (_diaryCurrentPage < 0) _diaryCurrentPage = 0;
    if (_diaryCurrentPage >= totalPages) _diaryCurrentPage = totalPages - 1;

    // Slice entries for current page
    const start = _diaryCurrentPage * DIARY_PAGE_SIZE;
    const pageEntries = entries.slice(start, start + DIARY_PAGE_SIZE);

    // Build feed HTML
    const grouped = groupByDate(pageEntries);
    feedEl.innerHTML = Object.entries(grouped)
        .map(([date, dateEntries]) => buildDateGroup(date, dateEntries))
        .join('');

    // Re-bind card events
    const root = document.getElementById('diary_page_root');
    bindCardEvents(root);

    // Build pagination bar
    if (paginationEl) {
        if (totalPages <= 1) {
            paginationEl.innerHTML = '';
        } else {
            const prevDisabled = _diaryCurrentPage === 0 ? 'disabled' : '';
            const nextDisabled = _diaryCurrentPage === totalPages - 1 ? 'disabled' : '';
            paginationEl.innerHTML = `
                <button class="diary-page-btn" id="diary_page_prev" ${prevDisabled}>
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                <span class="diary-page-indicator">${_diaryCurrentPage + 1} / ${totalPages}</span>
                <button class="diary-page-btn" id="diary_page_next" ${nextDisabled}>
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
            `;
            const prevBtn = document.getElementById('diary_page_prev');
            const nextBtn = document.getElementById('diary_page_next');
            if (prevBtn) {
                prevBtn.addEventListener('click', () => {
                    if (_diaryCurrentPage > 0) {
                        _diaryCurrentPage--;
                        renderPagedFeed(loadDiaryEntries());
                        feedEl.closest('.diary-scroll-content')?.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                });
            }
            if (nextBtn) {
                nextBtn.addEventListener('click', () => {
                    if (_diaryCurrentPage < totalPages - 1) {
                        _diaryCurrentPage++;
                        renderPagedFeed(loadDiaryEntries());
                        feedEl.closest('.diary-scroll-content')?.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                });
            }
        }
    }
}

function showLoading(show) {
    const overlay = document.getElementById('diary_loading_overlay');
    if (overlay) {
        overlay.classList.toggle('loading-active', show);
    }
}

function openDetail(entry) {
    const overlay = document.getElementById('diary_detail_overlay');
    if (!overlay) return;
    overlay.innerHTML = buildDetailView(entry);
    requestAnimationFrame(() => overlay.classList.add('detail-active'));

    // Print button in detail view
    const printBtn = document.getElementById('diary_detail_print_btn');
    if (printBtn) {
        printBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.print();
        });
    }

    // Edit button in detail view
    const editBtn = document.getElementById('diary_detail_edit_btn');
    if (editBtn) {
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleEditMode(entry, overlay);
        });
    }

    // Close button in detail view
    const closeBtn = document.getElementById('diary_detail_close_btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            overlay.classList.remove('detail-active');
            setTimeout(() => { overlay.innerHTML = ''; }, 300);
        });
    }
}

/**
 * Toggle edit mode for the detail view.
 * Replaces segment content divs with textareas, adds save/cancel buttons.
 */
function toggleEditMode(entry, overlay) {
    const page = overlay.querySelector('.diary-detail-page');
    const editBtn = document.getElementById('diary_detail_edit_btn');
    if (!page) return;

    const isEditing = page.classList.contains('diary-editing');
    if (isEditing) {
        // Cancel edit → re-render
        overlay.innerHTML = buildDetailView(entry);
        // Re-bind buttons
        openDetail(entry);
        return;
    }

    // Enter edit mode
    page.classList.add('diary-editing');
    if (editBtn) {
        editBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        editBtn.title = '取消编辑';
    }

    // Replace each segment content with a textarea
    page.querySelectorAll('.diary-segment').forEach(segEl => {
        const idx = parseInt(segEl.dataset.segIdx);
        const contentEl = segEl.querySelector('.diary-segment-content');
        if (!contentEl || isNaN(idx)) return;

        const seg = entry.segments[idx];
        if (!seg) return;

        const textarea = document.createElement('textarea');
        textarea.className = 'diary-edit-textarea';
        textarea.value = seg.content;
        textarea.dataset.segIdx = idx;
        textarea.rows = Math.max(3, Math.ceil(seg.content.length / 30));

        contentEl.replaceWith(textarea);
    });

    // Add save button at bottom of page
    const saveBar = document.createElement('div');
    saveBar.className = 'diary-edit-save-bar';
    saveBar.innerHTML = `
        <button class="diary-edit-save-btn" id="diary_edit_save">
            <i class="fa-solid fa-check"></i> 保存修改
        </button>
    `;
    page.appendChild(saveBar);

    // Save handler
    const saveBtn = document.getElementById('diary_edit_save');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            // Read all textareas and update entry
            const textareas = page.querySelectorAll('.diary-edit-textarea');
            textareas.forEach(ta => {
                const segIdx = parseInt(ta.dataset.segIdx);
                if (!isNaN(segIdx) && entry.segments[segIdx]) {
                    entry.segments[segIdx].content = ta.value.trim();
                }
            });

            // Persist
            const entries = loadDiaryEntries();
            const target = entries.find(e => e.id === entry.id);
            if (target) {
                target.segments = entry.segments;
                saveDiaryEntries(entries);
            }

            console.log(`${DIARY_LOG_PREFIX} 日记已编辑保存 (id=${entry.id})`);

            // Re-render detail view with updated content
            overlay.innerHTML = buildDetailView(entry);
            openDetail(entry);

            // Refresh feed in background
            refreshFeed();
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function groupByDate(entries) {
    const groups = {};
    for (const e of entries) {
        if (!groups[e.date]) groups[e.date] = [];
        groups[e.date].push(e);
    }
    return groups;
}

function calculateStreak(entries) {
    if (entries.length === 0) return 0;
    const dates = [...new Set(entries.map(e => e.date))].sort().reverse();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let streak = 0;
    for (let i = 0; i < dates.length; i++) {
        const expected = new Date(today);
        expected.setDate(expected.getDate() - i);
        const y = expected.getFullYear();
        const m = String(expected.getMonth() + 1).padStart(2, '0');
        const d = String(expected.getDate()).padStart(2, '0');
        const expectedStr = `${y}-${m}-${d}`;
        if (dates[i] === expectedStr) {
            streak++;
        } else {
            break;
        }
    }
    return streak;
}

function formatDateLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.floor((today - d) / 86400000);

    if (diff === 0) return ' 今天';
    if (diff === 1) return ' 昨天';
    if (diff === 2) return ' 前天';

    const month = d.getMonth() + 1;
    const day = d.getDate();
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return ` ${month}月${day}日 · 周${weekdays[d.getDay()]}`;
}

function formatFullDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return ` ${year}年${month}月${day}日 · 周${weekdays[d.getDay()]}`;
}

function formatTime(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

function truncate(str, len) {
    return str.length > len ? str.slice(0, len) + '……' : str;
}

function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function onClick(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
}

// ═══════════════════════════════════════════════════════════════════════
// Global Listeners
// ═══════════════════════════════════════════════════════════════════════

// Hijack the global phone back button when the detail overlay is active
window.addEventListener('phone-app-back', (e) => {
    // Detail overlay
    const detailOverlay = document.getElementById('diary_detail_overlay');
    if (detailOverlay && detailOverlay.classList.contains('detail-active')) {
        e.preventDefault();
        detailOverlay.classList.remove('detail-active');
        setTimeout(() => { detailOverlay.innerHTML = ''; }, 300);
        return;
    }

    // Calendar overlay
    const calOverlay = document.getElementById('diary_calendar_overlay');
    if (calOverlay && calOverlay.classList.contains('calendar-active')) {
        e.preventDefault();
        calOverlay.classList.remove('calendar-active');
        return;
    }

    // Search overlay
    const searchOverlay = document.getElementById('diary_search_overlay');
    if (searchOverlay && searchOverlay.classList.contains('search-active')) {
        e.preventDefault();
        searchOverlay.classList.remove('search-active');
        return;
    }

    // Compose overlay
    const composeOverlay = document.getElementById('diary_compose_overlay');
    if (composeOverlay && composeOverlay.classList.contains('compose-active')) {
        e.preventDefault();
        composeOverlay.classList.remove('compose-active');
        return;
    }

    // Settings overlay
    const settingsOverlay = document.getElementById('diary_settings_overlay');
    if (settingsOverlay && settingsOverlay.classList.contains('settings-active')) {
        e.preventDefault();
        settingsOverlay.classList.remove('settings-active');
        return;
    }
});

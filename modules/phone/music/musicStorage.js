// modules/phone/music/musicStorage.js — 音乐推荐数据持久化 + 去重逻辑 + 偏好设置
// Storage: localStorage (song history), chat_metadata (preferences).

import { getContext, saveMetadataDebounced } from '../../../../../../extensions.js';
import { chat_metadata } from '../../../../../../../script.js';

const MODULE_NAME = 'the_ghost_face';
const MUSIC_STORAGE_KEY_PREFIX = `${MODULE_NAME}_music_v1_`;
const META_KEY_PREFS = 'gf_musicPreferences'; // chat_metadata key

// ═══════════════════════════════════════════════════════════════════════
// Character ID Helper
// ═══════════════════════════════════════════════════════════════════════

function _getCharKey() {
    try {
        const context = getContext();
        const charId = context.characterId;
        return charId != null ? `char_${charId}` : 'global_fallback';
    } catch {
        return 'global_fallback';
    }
}

function _storageKey() {
    return `${MUSIC_STORAGE_KEY_PREFIX}${_getCharKey()}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Data Access
// ═══════════════════════════════════════════════════════════════════════

/**
 * Create empty music data structure.
 * @returns {{ history: Array, allSongKeys: string[] }}
 */
function _emptyData() {
    return { history: [], allSongKeys: [] };
}

/**
 * Load music data from localStorage.
 * @returns {{ history: Array, allSongKeys: string[] }}
 */
export function loadMusicData() {
    try {
        const raw = localStorage.getItem(_storageKey());
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.history)) {
                // Ensure allSongKeys exists
                if (!Array.isArray(parsed.allSongKeys)) {
                    parsed.allSongKeys = _rebuildAllSongKeys(parsed.history);
                }
                return parsed;
            }
        }
    } catch (e) {
        console.warn('[音乐] loadMusicData failed:', e);
    }
    return _emptyData();
}

/**
 * Save music data to localStorage.
 * @param {{ history: Array, allSongKeys: string[] }} data
 */
export function saveMusicData(data) {
    try {
        localStorage.setItem(_storageKey(), JSON.stringify(data));
    } catch (e) {
        console.warn('[音乐] saveMusicData failed:', e);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Song Key Utilities
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate a normalized key for a song: "title|artist" in lowercase.
 */
export function songKey(title, artist) {
    return `${(title || '').trim().toLowerCase()}|${(artist || '').trim().toLowerCase()}`;
}

/**
 * Rebuild allSongKeys from history (for migration/repair).
 */
function _rebuildAllSongKeys(history) {
    const keys = [];
    for (const day of history) {
        for (const song of (day.songs || [])) {
            const k = songKey(song.title, song.artist);
            if (!keys.includes(k)) keys.push(k);
        }
    }
    return keys;
}

/**
 * Check if a song has been recommended before.
 * Uses the full allSongKeys set for exact dedup.
 */
export function isDuplicate(data, title, artist) {
    const k = songKey(title, artist);
    return data.allSongKeys.includes(k);
}

/**
 * Get the most recent N song keys (for prompt injection).
 * @param {Object} data
 * @param {number} n - Max keys to return (default 200)
 * @returns {string[]}
 */
export function getRecentSongKeys(data, n = 200) {
    // allSongKeys is ordered chronologically (appended), so take the last N
    return data.allSongKeys.slice(-n);
}

// ═══════════════════════════════════════════════════════════════════════
// Recommendation Access
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get today's date string in YYYY-MM-DD format (local time).
 */
export function getTodayDateStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Get recommendation for a specific date.
 * @returns {{ date: string, songs: Array } | null}
 */
export function getRecommendationByDate(data, dateStr) {
    return data.history.find(h => h.date === dateStr) || null;
}

/**
 * Get today's recommendation.
 */
export function getTodayRecommendation(data) {
    return getRecommendationByDate(data, getTodayDateStr());
}

/**
 * Add a daily recommendation. Updates history and allSongKeys.
 * @param {Object} data
 * @param {string} dateStr
 * @param {Array<{title: string, artist: string, comment: string}>} songs
 * @returns {Object} updated data
 */
export function addDailyRecommendation(data, dateStr, songs) {
    // Remove existing entry for this date if any (overwrite)
    data.history = data.history.filter(h => h.date !== dateStr);

    const entry = {
        date: dateStr,
        songs: songs.map(s => ({
            title: s.title,
            artist: s.artist,
            comment: s.comment,
            liked: false,
        })),
    };

    // Insert in chronological order (newest first for display, but store newest last)
    data.history.push(entry);
    // Sort by date ascending
    data.history.sort((a, b) => a.date.localeCompare(b.date));

    // Update allSongKeys
    for (const song of songs) {
        const k = songKey(song.title, song.artist);
        if (!data.allSongKeys.includes(k)) {
            data.allSongKeys.push(k);
        }
    }

    saveMusicData(data);
    return data;
}

/**
 * Toggle the liked status of a song.
 * @returns {Object} updated data
 */
export function toggleLike(data, dateStr, songIndex) {
    const day = data.history.find(h => h.date === dateStr);
    if (day && day.songs[songIndex] != null) {
        day.songs[songIndex].liked = !day.songs[songIndex].liked;
        saveMusicData(data);
    }
    return data;
}

/**
 * Get all dates that have recommendations, sorted newest first.
 * @returns {string[]}
 */
export function getAllDates(data) {
    return data.history.map(h => h.date).sort((a, b) => b.localeCompare(a));
}

// ═══════════════════════════════════════════════════════════════════════
// Music Preferences (chat_metadata)
// ═══════════════════════════════════════════════════════════════════════

/** Predefined genre/style options for onboarding */
export const MUSIC_GENRES = [
    { id: 'pop',         label: '流行 Pop',         icon: 'ph-microphone-stage' },
    { id: 'rock',        label: '摇滚 Rock',        icon: 'ph-guitar' },
    { id: 'hiphop',      label: '说唱 Hip-Hop',     icon: 'ph-headphones' },
    { id: 'electronic',  label: '电子 Electronic',  icon: 'ph-waveform' },
    { id: 'rnb',         label: 'R&B / Soul',       icon: 'ph-music-note' },
    { id: 'jazz',        label: '爵士 Jazz',        icon: 'ph-piano-keys' },
    { id: 'classical',   label: '古典 Classical',   icon: 'ph-music-notes-simple' },
    { id: 'indie',       label: '独立 Indie',       icon: 'ph-vinyl-record' },
    { id: 'folk',        label: '民谣 Folk',        icon: 'ph-campfire' },
    { id: 'anime',       label: '动漫 Anime/OST',   icon: 'ph-shooting-star' },
    { id: 'kpop',        label: 'K-Pop / J-Pop',    icon: 'ph-star' },
    { id: 'chinese',     label: '华语 Chinese',     icon: 'ph-translate' },
    { id: 'lofi',        label: 'Lo-Fi / Chill',    icon: 'ph-cloud-moon' },
    { id: 'metal',       label: '金属 Metal',       icon: 'ph-lightning' },
];

/** Supported music platforms for deep-linking.
 *  nativeScheme: URI scheme to try opening the native app first.
 *  urlTemplate:  Web fallback URL (always works).
 */
export const MUSIC_PLATFORMS = [
    { id: 'spotify',  label: 'Spotify',       icon: 'ph-spotify-logo', urlTemplate: 'https://open.spotify.com/search/{q}' },
    { id: 'apple',    label: 'Apple Music',   icon: 'ph-apple-logo',   urlTemplate: 'https://music.apple.com/search?term={q}',               nativeScheme: 'music://music.apple.com/search?term={q}' },
    { id: 'netease',  label: '网易云音乐',     icon: 'ph-cloud',        urlTemplate: 'https://music.163.com/#/search?keywords={q}',           nativeScheme: 'orpheuswidget://openurl?url=https%3A%2F%2Fmusic.163.com%2F%23%2Fsearch%3Fkeywords%3D{q}' },
    { id: 'qqmusic',  label: 'QQ 音乐',       icon: 'ph-music-note',   urlTemplate: 'https://y.qq.com/n/ryqq/search?search_text={q}&t=0',   nativeScheme: 'qqmusic://qq.com/ui/search?p=%7B%22searchWord%22%3A%22{q}%22%7D' },
    { id: 'ytmusic',  label: 'YouTube Music', icon: 'ph-youtube-logo', urlTemplate: 'https://music.youtube.com/search?q={q}' },
];

/**
 * Build a web search URL for a specific music platform.
 */
export function buildPlatformUrl(title, artist, platformId) {
    const pid = platformId || getSelectedPlatform();
    const platform = MUSIC_PLATFORMS.find(p => p.id === pid) || MUSIC_PLATFORMS[0];
    const query = encodeURIComponent(`${title} ${artist}`.trim());
    return platform.urlTemplate.replace('{q}', query);
}

/**
 * Build a native scheme URL (if available) for a specific platform.
 * @returns {string|null} native URL or null if not available
 */
export function buildNativeUrl(title, artist, platformId) {
    const pid = platformId || getSelectedPlatform();
    const platform = MUSIC_PLATFORMS.find(p => p.id === pid) || MUSIC_PLATFORMS[0];
    if (!platform.nativeScheme) return null;
    const query = encodeURIComponent(`${title} ${artist}`.trim());
    return platform.nativeScheme.replace('{q}', query);
}

/**
 * Get the user's selected platform id from preferences.
 * @returns {string} platform id, defaults to 'spotify'
 */
export function getSelectedPlatform() {
    const prefs = loadPreferences();
    return prefs?.platform || 'spotify';
}

/**
 * Get the platform info object for the currently selected platform.
 */
export function getSelectedPlatformInfo() {
    const pid = getSelectedPlatform();
    return MUSIC_PLATFORMS.find(p => p.id === pid) || MUSIC_PLATFORMS[0];
}

/**
 * Check if music preferences have been set for this chat.
 * @returns {boolean}
 */
export function hasPreferences() {
    try {
        const prefs = chat_metadata?.[META_KEY_PREFS];
        const hasGenres = prefs && Array.isArray(prefs.genres) && prefs.genres.length > 0;
        const hasCustom = prefs && Array.isArray(prefs.customGenres) && prefs.customGenres.length > 0;
        return !!(hasGenres || hasCustom);
    } catch {
        return false;
    }
}

/**
 * Load music preferences from chat_metadata.
 * @returns {{ genres: string[], customNote: string } | null}
 */
export function loadPreferences() {
    try {
        return chat_metadata?.[META_KEY_PREFS] || null;
    } catch {
        return null;
    }
}

/**
 * Save music preferences to chat_metadata.
 * @param {string[]} genres - Array of predefined genre IDs
 * @param {string} customNote - Optional free-text note
 * @param {string[]} customGenres - Array of user-created genre labels
 * @param {string} platform - Selected music platform id
 */
export function savePreferences(genres, customNote = '', customGenres = [], platform = '') {
    try {
        if (chat_metadata) {
            chat_metadata[META_KEY_PREFS] = {
                genres: genres || [],
                customNote: (customNote || '').trim(),
                customGenres: (customGenres || []).map(s => s.trim()).filter(Boolean),
                platform: platform || getSelectedPlatform(),
            };
            saveMetadataDebounced();
            console.log('[音乐] 偏好已保存:', { genres, customNote, customGenres, platform });
        }
    } catch (e) {
        console.warn('[音乐] savePreferences failed:', e);
    }
}

/**
 * Get a human-readable description of preferences for prompt injection.
 * @returns {string} e.g. "偏好风格：流行、独立、民谣。备注：喜欢伤感的歌"
 */
export function getPreferencesDescription() {
    const prefs = loadPreferences();
    if (!prefs) return '';

    const allLabels = [];

    // Predefined genres
    if (prefs.genres?.length) {
        for (const id of prefs.genres) {
            const g = MUSIC_GENRES.find(g => g.id === id);
            allLabels.push(g ? g.label : id);
        }
    }

    // Custom genres
    if (prefs.customGenres?.length) {
        allLabels.push(...prefs.customGenres);
    }

    if (allLabels.length === 0) return '';

    let desc = `偏好风格：${allLabels.join('、')}`;
    if (prefs.customNote) {
        desc += `。备注：${prefs.customNote}`;
    }
    return desc;
}

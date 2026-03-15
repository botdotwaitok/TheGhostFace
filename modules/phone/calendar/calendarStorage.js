// modules/phone/calendar/calendarStorage.js — 日历数据持久化层
// 全部数据存储在 chat_metadata 中，确保跨设备同步

import { getContext, extension_settings, saveMetadataDebounced } from '../../../../../../extensions.js';
import { chat_metadata, saveSettingsDebounced } from '../../../../../../../script.js';
import { resolveProxyUrl, needsProxy } from '../utils/corsProxyFetch.js';

const LOG = '[日历]';
const META_KEY_EVENTS = 'gf_calendarEvents';
const META_KEY_PERIOD = 'gf_calendarPeriodData';
const META_KEY_WI_SETTINGS = 'gf_calendarWISettings';
const MODULE_NAME = 'the_ghost_face';

// Default World Info injection settings
const DEFAULT_WI_SETTINGS = {
    enabled: false,       // 是否启用世界书注入
    lookAheadDays: 7,     // 未来预告天数 (3/7/14/30)
};

// ═══════════════════════════════════════════════════════════════════════
// Event Types & Defaults
// ═══════════════════════════════════════════════════════════════════════

export const EVENT_TYPES = [
    { id: 'custom', label: '普通事件', icon: 'ph ph-push-pin', emoji: '📌', color: '#5b9bd5' },
    { id: 'anniversary', label: '纪念日', icon: 'ph ph-heart', emoji: '💕', color: '#e88db6' },
    { id: 'period', label: '经期', icon: 'ph ph-drop', emoji: '🩸', color: '#ff6b6b' },
    { id: 'birthday', label: '生日', icon: 'ph ph-cake', emoji: '🎂', color: '#ffb347' },
    { id: 'holiday', label: '节日', icon: 'ph ph-confetti', emoji: '🎉', color: '#ffa726' },
    { id: 'reminder', label: '提醒', icon: 'ph ph-alarm', emoji: '⏰', color: '#7e57c2' },
];

// Period symptom presets — user picks which apply + can add custom
export const PERIOD_SYMPTOMS = [
    { id: 'cramps', label: '肚子疼/痛经', emoji: '😣' },
    { id: 'headache', label: '头疼', emoji: '🤕' },
    { id: 'fatigue', label: '疲惫/嗜睡', emoji: '😴' },
    { id: 'mood', label: '情绪波动', emoji: '🥺' },
    { id: 'bloating', label: '腹胀', emoji: '😮‍💨' },
    { id: 'appetite', label: '食欲变化', emoji: '🍫' },
    { id: 'backpain', label: '腰酸背痛', emoji: '😩' },
    { id: 'none', label: '基本没啥反应', emoji: '😊' },
];

// Default period config
const DEFAULT_PERIOD_DATA = {
    enabled: false,
    periodDays: 5,          // 持续天数
    cycleDays: 28,          // 周期天数
    periodStarts: [],       // 历史经期开始日期列表 ['YYYY-MM-DD']
    symptoms: [],           // 选中的症状 id 列表
    customNote: '',         // 用户自定义经期描述
    promptInjection: true,  // 是否注入 prompt
};

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

export function getLocalDateString(date) {
    const d = date || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD to Date at midnight local */
export function parseDate(dateStr) {
    return new Date(dateStr + 'T00:00:00');
}

/** Get day diff (date2 - date1) in days */
function dayDiff(d1, d2) {
    return Math.round((d2 - d1) / 86400000);
}

// ═══════════════════════════════════════════════════════════════════════
// Events CRUD
// ═══════════════════════════════════════════════════════════════════════

export function loadEvents() {
    try {
        const data = chat_metadata?.[META_KEY_EVENTS];
        if (Array.isArray(data)) return data;
    } catch { }
    return [];
}

export function saveEvents(events) {
    try {
        if (chat_metadata) {
            chat_metadata[META_KEY_EVENTS] = events;
            saveMetadataDebounced();
        }
    } catch (e) {
        console.warn(`${LOG} saveEvents failed:`, e);
    }

    // Secondary backup in extension_settings
    try {
        if (typeof extension_settings !== 'undefined') {
            if (!extension_settings[MODULE_NAME]) extension_settings[MODULE_NAME] = {};
            extension_settings[MODULE_NAME].calendarEvents = events;
            if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
        }
    } catch { }
}

export function addEvent(event) {
    const events = loadEvents();
    event.id = events.length === 0 ? 1 : Math.max(...events.map(e => e.id)) + 1;
    event.createdAt = new Date().toISOString();
    events.push(event);
    saveEvents(events);
    return event;
}

export function deleteEvent(id) {
    const events = loadEvents();
    const idx = events.findIndex(e => e.id === id);
    if (idx !== -1) {
        events.splice(idx, 1);
        saveEvents(events);
        return true;
    }
    return false;
}

// ═══════════════════════════════════════════════════════════════════════
// Period Data
// ═══════════════════════════════════════════════════════════════════════

export function loadPeriodData() {
    try {
        const data = chat_metadata?.[META_KEY_PERIOD];
        if (data && typeof data === 'object') {
            return { ...DEFAULT_PERIOD_DATA, ...data };
        }
    } catch { }
    return { ...DEFAULT_PERIOD_DATA };
}

export function savePeriodData(data) {
    try {
        if (chat_metadata) {
            chat_metadata[META_KEY_PERIOD] = data;
            saveMetadataDebounced();
        }
    } catch (e) {
        console.warn(`${LOG} savePeriodData failed:`, e);
    }

    // Secondary backup
    try {
        if (typeof extension_settings !== 'undefined') {
            if (!extension_settings[MODULE_NAME]) extension_settings[MODULE_NAME] = {};
            extension_settings[MODULE_NAME].calendarPeriodData = data;
            if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
        }
    } catch { }
}

// ═══════════════════════════════════════════════════════════════════════
// WI (World Info) Injection Settings
// ═══════════════════════════════════════════════════════════════════════

export function loadWISettings() {
    try {
        const data = chat_metadata?.[META_KEY_WI_SETTINGS];
        if (data && typeof data === 'object') {
            return { ...DEFAULT_WI_SETTINGS, ...data };
        }
    } catch { }
    return { ...DEFAULT_WI_SETTINGS };
}

export function saveWISettings(data) {
    try {
        if (chat_metadata) {
            chat_metadata[META_KEY_WI_SETTINGS] = data;
            saveMetadataDebounced();
        }
    } catch (e) {
        console.warn(`${LOG} saveWISettings failed:`, e);
    }

    // Secondary backup
    try {
        if (typeof extension_settings !== 'undefined') {
            if (!extension_settings[MODULE_NAME]) extension_settings[MODULE_NAME] = {};
            extension_settings[MODULE_NAME].calendarWISettings = data;
            if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
        }
    } catch { }
}

/**
 * Collect upcoming events for the next N days.
 * Aggregates: user-created events + holidays + predicted period.
 * @param {number} days - look-ahead days
 * @returns {Array<{date: string, emoji: string, title: string, type: string}>}
 */
export function getUpcomingEvents(days = 7) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const results = [];

    for (let i = 0; i <= days; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const dateStr = getLocalDateString(d);

        // User events
        const events = loadEvents();
        for (const ev of events) {
            if (dateStr >= ev.startDate && dateStr <= ev.endDate) {
                const typeInfo = EVENT_TYPES.find(t => t.id === ev.type);
                results.push({
                    date: dateStr,
                    emoji: ev.emoji || typeInfo?.emoji || '📌',
                    title: ev.title + (ev.note ? ` · ${ev.note}` : ''),
                    type: ev.type,
                });
            }
        }

        // Holidays
        const holidays = getHolidaysForDate(dateStr);
        for (const h of holidays) {
            results.push({
                date: dateStr,
                emoji: h.emoji || '🎉',
                title: h.name,
                type: 'holiday',
            });
        }

        // Predicted period
        const pd = loadPeriodData();
        if (pd.enabled && pd.periodStarts.length > 0) {
            const ps = getPeriodStatusForDate(dateStr);
            if (ps) {
                results.push({
                    date: dateStr,
                    emoji: '🩸',
                    title: `经期 Day ${ps.dayOfPeriod}`,
                    type: 'period',
                });
            }
        }
    }

    // Deduplicate (same date+title combo)
    const seen = new Set();
    const unique = results.filter(r => {
        const key = `${r.date}|${r.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // Sort by date
    unique.sort((a, b) => a.date.localeCompare(b.date));
    return unique;
}

/**
 * Check if a given date falls within a period range.
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @returns {{inPeriod: boolean, dayOfPeriod: number, periodStart: string}|null}
 */
export function getPeriodStatusForDate(dateStr) {
    const pd = loadPeriodData();
    if (!pd.enabled || pd.periodStarts.length === 0) return null;

    const target = parseDate(dateStr);

    for (const startStr of pd.periodStarts) {
        const start = parseDate(startStr);
        const diff = dayDiff(start, target);
        if (diff >= 0 && diff < pd.periodDays) {
            return { inPeriod: true, dayOfPeriod: diff + 1, periodStart: startStr };
        }
    }
    return null;
}

/**
 * Get predicted next period start date based on cycle length.
 * @returns {string|null} 'YYYY-MM-DD' or null
 */
export function getPredictedNextPeriod() {
    const pd = loadPeriodData();
    if (!pd.enabled || pd.periodStarts.length === 0) return null;

    // Sort descending
    const sorted = [...pd.periodStarts].sort().reverse();
    const lastStart = parseDate(sorted[0]);
    const nextStart = new Date(lastStart);
    nextStart.setDate(nextStart.getDate() + pd.cycleDays);

    return getLocalDateString(nextStart);
}

/**
 * Check if TODAY is in a period.
 */
export function isTodayInPeriod() {
    return getPeriodStatusForDate(getLocalDateString());
}

// ═══════════════════════════════════════════════════════════════════════
// Real-World Holidays (Local Hardcoded + Cloud Push)
// ═══════════════════════════════════════════════════════════════════════

// Hardcoded fixed-date holidays (always available, no network needed)
const HOLIDAYS_BUILTIN = [
    // 国际 / 中国
    { month: 1, day: 1, name: '元旦' },
    { month: 2, day: 14, name: '情人节' },
    { month: 3, day: 8, name: '妇女节' },
    { month: 3, day: 14, name: '白色情人节' },
    { month: 4, day: 1, name: '愚人节' },
    { month: 5, day: 1, name: '劳动节' },
    { month: 5, day: 20, name: '520' },
    { month: 6, day: 1, name: '儿童节' },
    { month: 10, day: 1, name: '国庆节' },
    { month: 10, day: 31, name: '万圣节' },
    { month: 11, day: 11, name: '双十一/光棍节' },
    { month: 12, day: 24, name: '平安夜' },
    { month: 12, day: 25, name: '圣诞节' },
    { month: 12, day: 31, name: '跨年夜' },
    // USA fixed-date
    { month: 6, day: 19, name: 'Juneteenth' },
    { month: 7, day: 4, name: 'Independence Day' },
    { month: 11, day: 11, name: 'Veterans Day' },
    // Floating holidays computed dynamically below:
    // Mother's Day, MLK Day, Presidents' Day, Memorial Day,
    // Labor Day, Indigenous Peoples' Day, Thanksgiving
];

// ── Cloud Holiday Cache (localStorage) ──────────────────────────────

const CLOUD_HOLIDAYS_CACHE_KEY = 'gf_calendarCloudHolidays';
const CLOUD_HOLIDAYS_TTL = 24 * 60 * 60 * 1000; // 24 hours

let _cloudHolidaysCache = null; // in-memory cache: [{date, name, emoji}]

/**
 * Fetch holiday data from cloud server.
 * Uses the moments module's backendUrl and secretToken settings.
 * Caches result in localStorage for 24h.
 */
export async function fetchCloudHolidays() {
    try {
        // Check localStorage cache first
        const cached = localStorage.getItem(CLOUD_HOLIDAYS_CACHE_KEY);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed.fetchedAt && Date.now() - parsed.fetchedAt < CLOUD_HOLIDAYS_TTL) {
                _cloudHolidaysCache = parsed.holidays || [];
                console.log(`${LOG} Cloud holidays loaded from cache (${_cloudHolidaysCache.length} items)`);
                return _cloudHolidaysCache;
            }
        }

        // Get server config from moments settings
        const settings = extension_settings?.[MODULE_NAME];
        const backendUrl = settings?.backendUrl?.trim();
        const secretToken = settings?.secretToken;

        if (!backendUrl || !secretToken) {
            console.log(`${LOG} No server configured, skipping cloud holidays`);
            return [];
        }

        const baseUrl = backendUrl.endsWith('/') ? backendUrl.slice(0, -1) : backendUrl;
        const fullUrl = `${baseUrl}/api/calendar/holidays`;
        const proxied = needsProxy(fullUrl);
        const headers = { 'Content-Type': 'application/json' };
        if (proxied) {
            headers['X-Cloud-Bearer'] = secretToken;
        } else {
            headers['Authorization'] = `Bearer ${secretToken}`;
        }
        const response = await fetch(resolveProxyUrl(fullUrl), {
            method: 'GET',
            headers,
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        _cloudHolidaysCache = data.holidays || [];

        // Save to localStorage
        localStorage.setItem(CLOUD_HOLIDAYS_CACHE_KEY, JSON.stringify({
            holidays: _cloudHolidaysCache,
            fetchedAt: Date.now(),
            updatedAt: data.updatedAt,
        }));

        console.log(`${LOG} Cloud holidays fetched (${_cloudHolidaysCache.length} items, updated: ${data.updatedAt})`);
        return _cloudHolidaysCache;
    } catch (e) {
        console.warn(`${LOG} fetchCloudHolidays failed:`, e.message);
        // Fallback to stale cache
        try {
            const cached = localStorage.getItem(CLOUD_HOLIDAYS_CACHE_KEY);
            if (cached) {
                _cloudHolidaysCache = JSON.parse(cached).holidays || [];
                return _cloudHolidaysCache;
            }
        } catch { }
        return [];
    }
}

/**
 * Get holidays for a given date.
 * Merges hardcoded fixed-date holidays + dynamic (Mother's/Father's Day) + cloud-pushed holidays.
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @returns {Array<{name: string, emoji: string}>}
 */
export function getHolidaysForDate(dateStr) {
    const d = parseDate(dateStr);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const year = d.getFullYear();

    const results = [];
    const seen = new Set(); // deduplicate by name

    // Cloud holidays (exact date match, higher priority)
    if (_cloudHolidaysCache && _cloudHolidaysCache.length > 0) {
        for (const h of _cloudHolidaysCache) {
            if (h.date === dateStr && !seen.has(h.name)) {
                results.push({ name: h.name, emoji: h.emoji || '' });
                seen.add(h.name);
            }
        }
    }

    // Fixed-date holidays
    for (const h of HOLIDAYS_BUILTIN) {
        if (h.month === month && h.day === day && !seen.has(h.name)) {
            results.push({ name: h.name, emoji: h.emoji || '' });
            seen.add(h.name);
        }
    }

    // ── Floating US & intl holidays (computed dynamically) ───

    // Helper: Nth weekday of month (wday: 0=Sun, 1=Mon, ...)
    const nthWeekday = (y, m, wday, n) => {
        const first = new Date(y, m - 1, 1).getDay();
        let d = 1 + ((wday - first + 7) % 7) + (n - 1) * 7;
        return d;
    };
    // Helper: last Monday of month
    const lastMonday = (y, m) => {
        const last = new Date(y, m, 0).getDate(); // last day of month
        const wd = new Date(y, m - 1, last).getDay();
        return last - ((wd - 1 + 7) % 7);
    };

    const addIfMatch = (name, m, computedDay) => {
        if (month === m && day === computedDay && !seen.has(name)) {
            results.push({ name, emoji: '' });
            seen.add(name);
        }
    };

    // Mother's Day: 2nd Sunday of May
    addIfMatch('母亲节', 5, nthWeekday(year, 5, 0, 2));
    // MLK Day: 3rd Monday of January
    addIfMatch('MLK Day', 1, nthWeekday(year, 1, 1, 3));
    // Presidents' Day: 3rd Monday of February
    addIfMatch('Presidents\' Day', 2, nthWeekday(year, 2, 1, 3));
    // Memorial Day: Last Monday of May
    addIfMatch('Memorial Day', 5, lastMonday(year, 5));
    // Labor Day: 1st Monday of September
    addIfMatch('Labor Day', 9, nthWeekday(year, 9, 1, 1));
    // Indigenous Peoples' Day: 2nd Monday of October
    addIfMatch('Indigenous Peoples\' Day', 10, nthWeekday(year, 10, 1, 2));
    // Thanksgiving: 4th Thursday of November
    addIfMatch('Thanksgiving', 11, nthWeekday(year, 11, 4, 4));

    return results;
}

/**
 * Get all holidays for a given month (for rendering dots on calendar).
 * @returns {Map<number, Array<{name, emoji}>>} day → holidays
 */
export function getHolidaysForMonth(year, month) {
    const map = new Map();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const holidays = getHolidaysForDate(dateStr);
        if (holidays.length > 0) {
            map.set(d, holidays);
        }
    }
    return map;
}

// ═══════════════════════════════════════════════════════════════════════
// Activity Detection (Cross-Module)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get activity indicators for a given date.
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {{ diary: boolean, chat: boolean, tree: boolean }}
 */
export function getActivityForDate(dateStr) {
    const result = { diary: false, chat: false, tree: false };

    // ── Diary check ─────────────────────────────────────────────
    try {
        const diaryEntries = chat_metadata?.['gf_phoneDiaryEntries'];
        if (Array.isArray(diaryEntries)) {
            result.diary = diaryEntries.some(e => e.date === dateStr);
        }
    } catch { }

    // ── Chat check ─────────────────────────────────────────────
    try {
        const chatMsgs = chat_metadata?.['gf_phoneChatMessages'];
        if (Array.isArray(chatMsgs)) {
            result.chat = chatMsgs.some(m => {
                if (!m.timestamp) return false;
                const msgDate = getLocalDateString(new Date(m.timestamp));
                return msgDate === dateStr;
            });
        }
    } catch { }

    // ── Tree check ─────────────────────────────────────────────
    try {
        const raw = localStorage.getItem('gf_tree_data');
        if (raw) {
            const treeData = JSON.parse(raw);
            const ts = treeData?.treeState;
            if (ts?.lastCareDate === dateStr) {
                result.tree = true;
            } else if (Array.isArray(ts?.careDateHistory) && ts.careDateHistory.includes(dateStr)) {
                result.tree = true;
            }
        }
    } catch { }

    return result;
}

/**
 * Get all events + period markers for a given month.
 * Returns a map: day (1-31) → array of markers
 */
export function getMarkersForMonth(year, month) {
    const map = new Map();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const events = loadEvents();
    const pd = loadPeriodData();

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const markers = [];

        // User events
        for (const ev of events) {
            if (dateStr >= ev.startDate && dateStr <= ev.endDate) {
                markers.push({
                    type: ev.type,
                    color: ev.color || EVENT_TYPES.find(t => t.id === ev.type)?.color || '#5b9bd5',
                    label: ev.title,
                    emoji: ev.emoji || EVENT_TYPES.find(t => t.id === ev.type)?.emoji || '📌',
                });
            }
        }

        // Period markers
        if (pd.enabled) {
            const ps = getPeriodStatusForDate(dateStr);
            if (ps) {
                markers.push({
                    type: 'period',
                    color: '#ff6b6b',
                    label: `经期 Day ${ps.dayOfPeriod}`,
                    emoji: '🩸',
                });
            }
        }

        // Holidays
        const holidays = getHolidaysForDate(dateStr);
        for (const h of holidays) {
            markers.push({
                type: 'holiday',
                color: '#ffa726',
                label: h.name,
                emoji: h.emoji,
            });
        }

        // Activities
        const acts = getActivityForDate(dateStr);
        if (acts.diary) markers.push({ type: 'diary', color: '#f8a4b8', label: '写了日记', emoji: '📓' });
        if (acts.chat) markers.push({ type: 'chat', color: '#65d552', label: '聊天了', emoji: '💬' });
        if (acts.tree) markers.push({ type: 'tree', color: '#2d936c', label: '照顾了树树', emoji: '🌳' });

        if (markers.length > 0) {
            map.set(d, markers);
        }
    }

    return map;
}

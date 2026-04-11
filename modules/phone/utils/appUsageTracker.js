// modules/phone/utils/appUsageTracker.js
import { getPhoneSetting } from '../phoneSettings.js';

const LS_KEY = 'gf_phone_screen_time_data';
const MAX_DAYS = 30;

let currentAppId = null;
let startTime = null;
let updateInterval = null;

// Ensure we load and clean up old data
export function getUsageData() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            return _cleanOldData(data);
        }
    } catch (e) {
        console.warn('Failed to parse screen time data', e);
    }
    return {};
}

function saveUsageData(data) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('Failed to save screen time data', e);
    }
}

function _cleanOldData(data) {
    const today = new Date();
    const cutoff = new Date(today.getTime() - MAX_DAYS * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    
    let changed = false;
    for (const dateStr in data) {
        if (dateStr < cutoffStr) {
            delete data[dateStr];
            changed = true;
        }
    }
    if (changed) saveUsageData(data);
    return data;
}

function getTodayStr() {
    return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD format
}

export function isScreenTimeEnabled() {
    return getPhoneSetting('screenTimeEnabled', false);
}

export function startAppUsage(appId) {
    if (!isScreenTimeEnabled()) {
        stopAppUsage(); // stop any running if they just toggled off
        return;
    }
    
    // If switching apps, accumulate previous one
    if (currentAppId && currentAppId !== appId) {
        stopAppUsage();
    }
    
    if (currentAppId === appId) {
        // Resume tracking if it was paused by blur
        if (!startTime) startTime = Date.now();
        return;
    }
    
    currentAppId = appId;
    startTime = Date.now();
    
    // Periodically save every 30 seconds just to avoid data loss on crash
    if (updateInterval) clearInterval(updateInterval);
    updateInterval = setInterval(() => {
        accumulateTime();
        if (startTime) startTime = Date.now(); // reset start time to now after accumulating
    }, 30000);
    
    // Listen for blur/unload to accumulate
    window.addEventListener('beforeunload', stopAppUsage);
    window.addEventListener('blur', _onBlur);
    window.addEventListener('focus', _onFocus);
}

export function stopAppUsage() {
    if (!currentAppId) return;
    accumulateTime();
    
    currentAppId = null;
    startTime = null;
    if (updateInterval) clearInterval(updateInterval);
    updateInterval = null;
    
    window.removeEventListener('beforeunload', stopAppUsage);
    window.removeEventListener('blur', _onBlur);
    window.removeEventListener('focus', _onFocus);
}

function accumulateTime() {
    if (!currentAppId || !startTime) return;
    if (!isScreenTimeEnabled()) return; // just in case
    
    const now = Date.now();
    const durationSec = Math.floor((now - startTime) / 1000);
    if (durationSec <= 0) return;
    
    const today = getTodayStr();
    const data = getUsageData();
    
    if (!data[today]) data[today] = {};
    if (!data[today][currentAppId]) data[today][currentAppId] = 0;
    
    data[today][currentAppId] += durationSec;
    saveUsageData(data);
}

function _onBlur() {
    accumulateTime();
    startTime = null; // pause tracking
}

function _onFocus() {
    if (currentAppId && isScreenTimeEnabled()) {
        startTime = Date.now(); // resume tracking
    }
}

export function getTodayUsage() {
    const today = getTodayStr();
    const data = getUsageData();
    return data[today] || {};
}

export function getAppListInfo() {
    // A helper to map appId back to UI info for settings
    return {
        moments: { name: '朋友圈', icon: 'fa-solid fa-camera', color: '#fd5949' },
        chat: { name: '聊天', icon: 'fa-solid fa-comment', color: '#65d552' },
        diary: { name: '日记本', icon: 'fa-solid fa-book', color: '#ff7e5f' },
        tree: { name: '树树', icon: 'fa-solid fa-tree', color: '#2d936c' },
        tarot: { name: '占卜', icon: 'fa-solid fa-hat-wizard', color: '#7c3aed' },
        calendar: { name: '日历', icon: 'fa-solid fa-calendar-days', color: '#ff6b6b' },
        discord: { name: '社区', icon: 'fa-brands fa-discord', color: '#5865f2' },
        friends: { name: '好友', icon: 'fa-solid fa-user-group', color: '#5ec1fa' },
        settings: { name: '设置', icon: 'fa-solid fa-gear', color: '#a3a3a8' },
        music: { name: '歌单', icon: 'ph ph-music-notes', color: '#fc3c44' },
        shop: { name: '商城', icon: 'fa-solid fa-store', color: '#ffe05f' },
        voicecall: { name: '电话', icon: 'fa-solid fa-phone', color: '#34C759' },
        dnd: { name: 'D&D', icon: 'ph ph-sword', color: '#1a1a2e' },
        console: { name: 'Console', icon: 'fa-solid fa-terminal', color: '#1e1e1e' },
        handbook: { name: '手账本', icon: 'ph ph-notebook', color: '#d4a76a' },
        literature: { name: '文学', icon: 'ph ph-book-open-text', color: '#8b5e3c' },
        home_screen: { name: '主屏幕', icon: 'fa-solid fa-mobile-screen-button', color: '#8e8e93' }
    };
}

export function clearAllUsageData() {
    localStorage.removeItem(LS_KEY);
    stopAppUsage();
}

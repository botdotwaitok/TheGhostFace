
// modules/moments/state.js — 共享可变状态中心
// 所有子模块通过 getter/setter 函数访问共享状态，避免循环依赖。

import { defaultSettings } from './constants.js';

// ═══════════════════════════════════════════════════════════════════════
// State variables
// ═══════════════════════════════════════════════════════════════════════

let settings = { ...defaultSettings };
let feedCache = [];                // In-memory feed
let lastSyncTimestamp = null;
let syncTimerId = null;
let isGeneratingPost = false;
let isGeneratingComment = false;
let isGeneratingLike = false;
let consecutiveFailures = 0;
let lastCharacterId = null;
let settingsSyncTimeout = null;

export const MAX_CONSECUTIVE_FAILURES = 3;

// ═══════════════════════════════════════════════════════════════════════
// Getters
// ═══════════════════════════════════════════════════════════════════════

export function getSettings() { return settings; }
export function getFeedCache() { return feedCache; }
export function getLastSyncTimestamp() { return lastSyncTimestamp; }
export function getSyncTimerId() { return syncTimerId; }
export function getIsGeneratingPost() { return isGeneratingPost; }
export function getIsGeneratingComment() { return isGeneratingComment; }
export function getIsGeneratingLike() { return isGeneratingLike; }
export function getConsecutiveFailures() { return consecutiveFailures; }
export function getLastCharacterId() { return lastCharacterId; }
export function getSettingsSyncTimeout() { return settingsSyncTimeout; }

// ═══════════════════════════════════════════════════════════════════════
// Setters
// ═══════════════════════════════════════════════════════════════════════

export function setSettings(s) { settings = s; }
export function setFeedCache(fc) { feedCache = fc; }
export function setLastSyncTimestamp(ts) { lastSyncTimestamp = ts; }
export function setSyncTimerId(id) { syncTimerId = id; }
export function setIsGeneratingPost(v) { isGeneratingPost = v; }
export function setIsGeneratingComment(v) { isGeneratingComment = v; }
export function setIsGeneratingLike(v) { isGeneratingLike = v; }
export function setConsecutiveFailures(v) { consecutiveFailures = v; }
export function setLastCharacterId(v) { lastCharacterId = v; }
export function setSettingsSyncTimeout(v) { settingsSyncTimeout = v; }

// ═══════════════════════════════════════════════════════════════════════
// Convenience mutators
// ═══════════════════════════════════════════════════════════════════════

export function resetSettings() { settings = { ...defaultSettings }; }
export function clearFeedCache() { feedCache = []; }
export function incrementConsecutiveFailures() { consecutiveFailures++; }
export function resetConsecutiveFailures() { consecutiveFailures = 0; }

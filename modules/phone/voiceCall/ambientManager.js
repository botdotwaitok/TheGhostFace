// modules/phone/voiceCall/ambientManager.js — 通话氛围音管理
// Downloads ambient audio from server, lets user upload custom audio,
// plays low-volume looping background sound during LLM thinking gaps.

import { uploadAudioToST } from '../chat/voiceMessageService.js';
import { resolveProxyUrl } from '../utils/corsProxyFetch.js';
import { getSettings as getMomentsSettings } from '../moments/state.js';
import { getPhoneSetting, setPhoneSetting, removePhoneSetting } from '../phoneSettings.js';

const LOG = '[AmbientManager]';

// ═══════════════════════════════════════════════════════════════════════
// Constants & Config
// ═══════════════════════════════════════════════════════════════════════



const AMBIENT_VOLUME = 0.15;
const FADE_DURATION = 300; // ms

const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/webm'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB (ambient files can be longer)

// ═══════════════════════════════════════════════════════════════════════
// Audio Playback State
// ═══════════════════════════════════════════════════════════════════════

/** @type {HTMLAudioElement|null} */
let _audioEl = null;
let _fadeInterval = null;
let _isFadingOut = false;  // Guard: tracks ongoing fade-out to prevent race conditions

// ═══════════════════════════════════════════════════════════════════════
// Settings — localStorage persistence (global, not per-chat)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check if ambient sound is enabled. Default: true.
 * @returns {boolean}
 */
export function isAmbientEnabled() {
    return getPhoneSetting('ambientEnabled', true);
}

/**
 * Set ambient enabled state.
 * @param {boolean} enabled
 */
export function setAmbientEnabled(enabled) {
    setPhoneSetting('ambientEnabled', enabled);
    console.log(`${LOG} Ambient ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Get current ambient audio info.
 * @returns {{ enabled: boolean, isCustom: boolean, name: string, audioPath: string|null }}
 */
export function getAmbientInfo() {
    const customPath = getPhoneSetting('ambientCustomPath');
    const customName = getPhoneSetting('ambientCustomName');
    const defaultPath = getPhoneSetting('ambientDefaultPath');

    const isCustom = !!customPath;
    return {
        enabled: isAmbientEnabled(),
        isCustom,
        name: isCustom ? (customName || '自定义音频') : '默认氛围音',
        audioPath: customPath || defaultPath || null,
    };
}

// ═══════════════════════════════════════════════════════════════════════
// Init — ensure ambient audio is cached (download from server if needed)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Initialize ambient audio. Downloads default from server if not cached.
 * Call this when a voice call starts.
 * @returns {Promise<void>}
 */
export async function initAmbient() {
    if (!isAmbientEnabled()) {
        console.log(`${LOG} Ambient disabled, skipping init`);
        return;
    }

    // If user has custom audio, we're good
    const customPath = getPhoneSetting('ambientCustomPath');
    if (customPath) {
        console.log(`${LOG} Using custom ambient: ${customPath}`);
        return;
    }

    // Check if default is already cached
    const cachedPath = getPhoneSetting('ambientDefaultPath');
    if (cachedPath) {
        console.log(`${LOG} Default ambient already cached: ${cachedPath}`);
        return;
    }

    // Download default from server
    try {
        const backendUrl = _getBackendUrl();
        if (!backendUrl) {
            console.warn(`${LOG} No backend URL, cannot download default ambient`);
            return;
        }

        const audioUrl = `${backendUrl.replace(/\/$/, '')}/ambient/default.mp3`;
        const fetchUrl = resolveProxyUrl(audioUrl);

        console.log(`${LOG} Downloading default ambient from: ${fetchUrl}`);
        const resp = await fetch(fetchUrl);
        if (!resp.ok) {
            console.warn(`${LOG} Download failed: ${resp.status} ${resp.statusText}`);
            return;
        }

        const audioBlob = await resp.blob();
        console.log(`${LOG} Downloaded: ${audioBlob.size} bytes`);

        // Cache to ST file system
        const webPath = await uploadAudioToST(audioBlob, 'ambient_default');
        setPhoneSetting('ambientDefaultPath', webPath);
        console.log(`${LOG} Default ambient cached: ${webPath}`);
    } catch (e) {
        console.warn(`${LOG} Failed to download default ambient:`, e);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Playback — low-volume looping with fade in/out
// ═══════════════════════════════════════════════════════════════════════

/**
 * Start playing ambient audio (loop, low volume, fade-in).
 * Safe to call multiple times — only one instance plays.
 * @returns {boolean} true if playback started successfully
 */
export function startAmbient() {
    if (!isAmbientEnabled()) return false;

    const info = getAmbientInfo();
    if (!info.audioPath) {
        console.log(`${LOG} No ambient audio available`);
        return false;
    }

    // If fading out from a previous stop, cancel fade and force cleanup
    if (_isFadingOut) {
        _clearFade();
        _isFadingOut = false;
        _destroyAudio();
    }

    // Already playing
    if (_audioEl && !_audioEl.paused) return true;

    _clearFade();
    stopAmbientImmediate(); // Clean up any previous

    const path = info.audioPath.startsWith('/') ? info.audioPath : `/${info.audioPath}`;
    _audioEl = new Audio(path);
    _audioEl.loop = true;
    _audioEl.volume = 0;

    _audioEl.play().catch(e => {
        console.warn(`${LOG} Playback failed:`, e);
    });

    // Fade in
    _fadeToVolume(AMBIENT_VOLUME, FADE_DURATION);

    console.log(`${LOG} Ambient started: ${info.name}`);
    return true;
}

/**
 * Stop ambient audio with fade-out.
 */
export function stopAmbient() {
    if (!_audioEl) return;

    _clearFade();

    if (_audioEl.paused) {
        _destroyAudio();
        return;
    }

    // Fade out then destroy
    _isFadingOut = true;
    _fadeToVolume(0, FADE_DURATION, () => {
        _isFadingOut = false;
        _destroyAudio();
        console.log(`${LOG} Ambient stopped`);
    });
}

/**
 * Immediately stop ambient (no fade, for cleanup).
 */
export function stopAmbientImmediate() {
    _clearFade();
    _isFadingOut = false;
    _destroyAudio();
}

/**
 * Check if ambient is currently playing.
 * @returns {boolean}
 */
export function isAmbientPlaying() {
    return _audioEl !== null && !_audioEl.paused;
}

// ═══════════════════════════════════════════════════════════════════════
// User Upload — custom ambient audio
// ═══════════════════════════════════════════════════════════════════════

/**
 * Upload a user-selected audio file as custom ambient sound.
 * @param {File} audioFile - File from <input type="file">
 * @returns {Promise<{name: string, audioPath: string}>}
 */
export async function uploadUserAmbient(audioFile) {
    // Validate
    if (!ALLOWED_AUDIO_TYPES.includes(audioFile.type) && !audioFile.name.match(/\.(mp3|wav|ogg|m4a|aac|webm)$/i)) {
        throw new Error('不支持的音频格式，请选择 mp3/wav/ogg/m4a 文件');
    }
    if (audioFile.size > MAX_FILE_SIZE) {
        throw new Error('文件太大，请选择 10MB 以内的音频文件');
    }

    console.log(`${LOG} Uploading user ambient: ${audioFile.name} (${audioFile.size} bytes)`);

    const audioBlob = new Blob([await audioFile.arrayBuffer()], { type: audioFile.type });
    const audioPath = await uploadAudioToST(audioBlob, 'ambient_user');

    const displayName = audioFile.name.replace(/\.[^.]+$/, '');
    setPhoneSetting('ambientCustomPath', audioPath);
    setPhoneSetting('ambientCustomName', displayName);

    console.log(`${LOG} User ambient uploaded: "${displayName}" → ${audioPath}`);
    return { name: displayName, audioPath };
}

/**
 * Clear custom ambient, revert to server default.
 */
export function clearUserAmbient() {
    removePhoneSetting('ambientCustomPath');
    removePhoneSetting('ambientCustomName');
    console.log(`${LOG} Custom ambient cleared, using default`);
}

// ═══════════════════════════════════════════════════════════════════════
// Internal Helpers
// ═══════════════════════════════════════════════════════════════════════

function _getBackendUrl() {
    try {
        const settings = getMomentsSettings();
        return settings?.backendUrl || null;
    } catch (e) {
        console.warn(`${LOG} Cannot get backend URL:`, e);
        return null;
    }
}

function _destroyAudio() {
    if (_audioEl) {
        _audioEl.pause();
        _audioEl.currentTime = 0;
        _audioEl.src = '';
        _audioEl = null;
    }
}

function _clearFade() {
    if (_fadeInterval) {
        clearInterval(_fadeInterval);
        _fadeInterval = null;
    }
}

/**
 * Smoothly fade audio volume to target over duration.
 * @param {number} targetVol
 * @param {number} durationMs
 * @param {Function} [onDone]
 */
function _fadeToVolume(targetVol, durationMs, onDone) {
    if (!_audioEl) { onDone?.(); return; }

    _clearFade();

    const startVol = _audioEl.volume;
    const diff = targetVol - startVol;
    if (Math.abs(diff) < 0.01) {
        _audioEl.volume = targetVol;
        onDone?.();
        return;
    }

    const steps = 15;
    const stepTime = durationMs / steps;
    const stepVol = diff / steps;
    let step = 0;

    _fadeInterval = setInterval(() => {
        step++;
        if (step >= steps || !_audioEl) {
            _clearFade();
            if (_audioEl) _audioEl.volume = targetVol;
            onDone?.();
        } else {
            _audioEl.volume = Math.max(0, Math.min(1, startVol + stepVol * step));
        }
    }, stepTime);
}

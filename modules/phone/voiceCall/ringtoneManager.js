// modules/phone/voiceCall/ringtoneManager.js — 角色专属铃声管理
// Fetches ringtone manifest from cloud server, lets LLM choose a ringtone
// for the character, downloads & caches via ST file system, plays/stops ringtone.

import { saveMetadataDebounced } from '../../../../../../extensions.js';
import { chat_metadata } from '../../../../../../../script.js';
import { getPhoneCharInfo, getCoreFoundationPrompt } from '../phoneContext.js';
import { callPhoneLLM } from '../../api.js';
import { resolveProxyUrl } from '../utils/corsProxyFetch.js';
import { uploadAudioToST } from '../chat/voiceMessageService.js';
import { getSettings as getMomentsSettings } from '../moments/state.js';

const LOG = '[RingtoneManager]';
const META_KEY = 'gf_phone_ringtone';

// ═══════════════════════════════════════════════════════════════════════
// Audio playback state
// ═══════════════════════════════════════════════════════════════════════

/** @type {HTMLAudioElement|null} */
let _audioEl = null;

// ═══════════════════════════════════════════════════════════════════════
// Manifest — fetch ringtone list from cloud server
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fetch the ringtone manifest from the cloud server.
 * The manifest is a static JSON file at `/ringtones/manifest.json`.
 * @returns {Promise<Array<{id: string, name: string, description: string, mood: string[], file: string, duration: number}>>}
 */
export async function fetchManifest() {
    const backendUrl = _getBackendUrl();
    if (!backendUrl) {
        throw new Error('未配置后端地址，请先在设置中填写后端 URL');
    }

    // Static file — no auth needed, but may need CORS proxy
    const manifestUrl = `${backendUrl.replace(/\/$/, '')}/ringtones/manifest.json`;
    const fetchUrl = resolveProxyUrl(manifestUrl);

    console.log(`${LOG} Fetching manifest from: ${fetchUrl}`);
    const resp = await fetch(fetchUrl);
    if (!resp.ok) {
        throw new Error(`获取铃声清单失败: ${resp.status} ${resp.statusText}`);
    }

    const manifest = await resp.json();
    if (!Array.isArray(manifest) || manifest.length === 0) {
        throw new Error('铃声清单为空');
    }

    console.log(`${LOG} Manifest loaded: ${manifest.length} ringtones`);
    return manifest;
}

// ═══════════════════════════════════════════════════════════════════════
// LLM Selection — character picks a ringtone
// ═══════════════════════════════════════════════════════════════════════

/**
 * Ask the LLM (as the character) to choose a ringtone.
 * Returns the chosen ringtone ID and the character's reason.
 * @param {Array} manifest - Ringtone manifest array
 * @returns {Promise<{id: string, reason: string}>}
 */
export async function selectRingtoneViaLLM(manifest) {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '角色';

    // Build the ringtone list for the LLM
    const ringtoneList = manifest.map((r, i) =>
        `${i + 1}. ${r.id}: ${r.description}  [${r.mood.join(', ')}]`
    ).join('\n');

    const validIds = manifest.map(r => r.id);

    const systemPrompt = `${getCoreFoundationPrompt()}

你现在是${charName}。你正在为自己的手机挑选来电铃声。
以下是可选的铃声列表，请根据你的性格和喜好选择最适合你的一首。

规则：
- 必须从列表中选择一个
- 用 JSON 格式回复: {"choice": "铃声id", "reason": "用你自己的口吻说为什么喜欢这首（1-2句话，要有你的个性）"}
- 只回复 JSON，不要多余内容`;

    const userPrompt = `可选铃声列表：
${ringtoneList}

请选择你最喜欢的一首铃声。`;

    console.log(`${LOG} Asking ${charName} to choose a ringtone...`);
    const response = await callPhoneLLM(systemPrompt, userPrompt);

    // Parse the JSON response
    const parsed = _parseJsonResponse(response, validIds);
    console.log(`${LOG} ${charName} chose: "${parsed.id}" — "${parsed.reason}"`);
    return parsed;
}

/**
 * Parse the LLM JSON response, with fallback handling.
 * @param {string} response
 * @param {string[]} validIds
 * @returns {{id: string, reason: string}}
 */
function _parseJsonResponse(response, validIds) {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
        // Fallback: try to find a valid ID mentioned in the text
        const foundId = validIds.find(id => response.includes(id));
        if (foundId) {
            return { id: foundId, reason: response.replace(/[{}"]/g, '').trim().substring(0, 100) };
        }
        throw new Error('LLM 返回格式异常，无法解析铃声选择');
    }

    try {
        const parsed = JSON.parse(jsonMatch[0]);
        const chosenId = parsed.choice || parsed.id || parsed.ringtone;
        const reason = parsed.reason || parsed.why || '';

        if (!chosenId || !validIds.includes(chosenId)) {
            // Try fuzzy match
            const foundId = validIds.find(id =>
                (chosenId || '').toLowerCase().includes(id.toLowerCase()) ||
                id.toLowerCase().includes((chosenId || '').toLowerCase())
            );
            if (foundId) {
                return { id: foundId, reason: reason.substring(0, 200) };
            }
            throw new Error(`LLM 选择了无效的铃声 ID: "${chosenId}"`);
        }

        return { id: chosenId, reason: reason.substring(0, 200) };
    } catch (e) {
        if (e.message.includes('无效的铃声')) throw e;
        // JSON parse failed, try to find ID in text
        const foundId = validIds.find(id => response.includes(id));
        if (foundId) {
            return { id: foundId, reason: '' };
        }
        throw new Error('LLM 返回格式异常，无法解析铃声选择');
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Download & Cache — persist ringtone audio to ST file system
// ═══════════════════════════════════════════════════════════════════════

/**
 * Download a ringtone mp3 from the cloud server and cache it to ST's file system.
 * @param {string} ringtoneId - The ringtone ID
 * @param {string} filename - The file name (e.g. "evening_star.mp3")
 * @returns {Promise<string>} ST web path to the cached audio file
 */
export async function downloadAndCache(ringtoneId, filename) {
    const backendUrl = _getBackendUrl();
    if (!backendUrl) throw new Error('未配置后端地址');

    const audioUrl = `${backendUrl.replace(/\/$/, '')}/ringtones/${filename}`;
    const fetchUrl = resolveProxyUrl(audioUrl);

    console.log(`${LOG} Downloading ringtone: ${fetchUrl}`);
    const resp = await fetch(fetchUrl);
    if (!resp.ok) {
        throw new Error(`下载铃声失败: ${resp.status} ${resp.statusText}`);
    }

    const audioBlob = await resp.blob();
    console.log(`${LOG} Downloaded: ${audioBlob.size} bytes`);

    // Upload to ST file system for persistence
    const webPath = await uploadAudioToST(audioBlob, `ringtone_${ringtoneId}`);
    console.log(`${LOG} Cached to ST: ${webPath}`);
    return webPath;
}

// ═══════════════════════════════════════════════════════════════════════
// Storage — chat_metadata persistence
// ═══════════════════════════════════════════════════════════════════════

/**
 * Ringtone data shape stored in chat_metadata[META_KEY]:
 * {
 *   id: string,           // ringtone ID from manifest
 *   name: string,         // display name
 *   mood: string[],       // mood tags
 *   reason: string,       // character's reason for choosing
 *   audioPath: string,    // ST web path to cached mp3
 *   selectedAt: string,   // ISO timestamp
 * }
 */

/**
 * Get the current ringtone selection for this conversation.
 * @returns {object|null}
 */
export function getCurrentRingtone() {
    try {
        const data = chat_metadata?.[META_KEY];
        if (data && data.id && data.audioPath) return data;
    } catch (e) {
        console.warn(`${LOG} Read failed:`, e);
    }
    return null;
}

/**
 * Save a ringtone selection to chat_metadata.
 * @param {object} ringtoneData
 */
export function saveRingtoneSelection(ringtoneData) {
    try {
        if (chat_metadata) {
            chat_metadata[META_KEY] = {
                ...ringtoneData,
                selectedAt: new Date().toISOString(),
            };
            saveMetadataDebounced();
            console.log(`${LOG} Saved ringtone selection: ${ringtoneData.id}`);
        }
    } catch (e) {
        console.warn(`${LOG} Save failed:`, e);
    }
}

/**
 * Clear the ringtone selection (for re-selection).
 */
export function clearRingtoneSelection() {
    try {
        if (chat_metadata) {
            delete chat_metadata[META_KEY];
            saveMetadataDebounced();
            console.log(`${LOG} Ringtone selection cleared`);
        }
    } catch (e) {
        console.warn(`${LOG} Clear failed:`, e);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Playback — Audio element with loop
// ═══════════════════════════════════════════════════════════════════════

/**
 * Play the ringtone audio in a loop.
 * Uses HTMLAudioElement for simplicity and loop support.
 * @param {string} [audioPath] - ST web path. If omitted, uses current selection.
 * @returns {boolean} true if playback started
 */
export function playRingtone(audioPath) {
    const path = audioPath || getCurrentRingtone()?.audioPath;
    if (!path) {
        console.log(`${LOG} No ringtone to play (silent fallback)`);
        return false;
    }

    stopRingtone(); // Stop any existing playback

    _audioEl = new Audio(path.startsWith('/') ? path : `/${path}`);
    _audioEl.loop = true;
    _audioEl.volume = 0.7;
    _audioEl.play().catch(e => {
        console.warn(`${LOG} Playback failed:`, e);
    });

    console.log(`${LOG} Playing ringtone: ${path}`);
    return true;
}

/**
 * Stop the ringtone playback.
 */
export function stopRingtone() {
    if (_audioEl) {
        _audioEl.pause();
        _audioEl.currentTime = 0;
        _audioEl.src = ''; // Release resource
        _audioEl = null;
        console.log(`${LOG} Ringtone stopped`);
    }
}

/**
 * Check if ringtone is currently playing.
 * @returns {boolean}
 */
export function isRingtonePlaying() {
    return _audioEl !== null && !_audioEl.paused;
}

// ═══════════════════════════════════════════════════════════════════════
// Full Selection Flow — orchestrates manifest → LLM → download → save
// ═══════════════════════════════════════════════════════════════════════

/**
 * Run the complete ringtone selection flow:
 * 1. Fetch manifest from server
 * 2. Ask LLM to choose
 * 3. Download and cache the chosen ringtone
 * 4. Save selection to chat_metadata
 *
 * @param {(status: string) => void} [onStatus] - Status update callback for UI
 * @returns {Promise<object>} The saved ringtone data
 */
export async function runSelectionFlow(onStatus) {
    const notify = onStatus || (() => {});

    // Step 1: Fetch manifest
    notify('正在获取铃声列表...');
    const manifest = await fetchManifest();

    // Step 2: LLM selection
    const charName = getPhoneCharInfo()?.name || 'TA';
    notify(`${charName} 正在挑选中...`);
    const { id, reason } = await selectRingtoneViaLLM(manifest);

    // Find the chosen ringtone in manifest
    const chosen = manifest.find(r => r.id === id);
    if (!chosen) throw new Error(`铃声 "${id}" 不在清单中`);

    // Step 3: Download and cache
    notify('正在下载铃声...');
    const audioPath = await downloadAndCache(id, chosen.file);

    // Step 4: Save selection
    const ringtoneData = {
        id: chosen.id,
        name: chosen.name,
        mood: chosen.mood,
        reason,
        audioPath,
    };
    saveRingtoneSelection(ringtoneData);

    console.log(`${LOG} Selection complete: "${chosen.name}" — ${reason}`);
    return ringtoneData;
}

// ═══════════════════════════════════════════════════════════════════════
// User Upload — user picks their own ringtone file
// ═══════════════════════════════════════════════════════════════════════

const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/webm'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Upload a user-selected audio file as the ringtone.
 * Validates file type & size, uploads to ST file system, saves selection.
 * @param {File} audioFile - File object from <input type="file">
 * @param {(status: string) => void} [onStatus] - Status update callback
 * @returns {Promise<object>} The saved ringtone data
 */
export async function uploadUserRingtone(audioFile, onStatus) {
    const notify = onStatus || (() => {});

    // Validate file type
    if (!ALLOWED_AUDIO_TYPES.includes(audioFile.type) && !audioFile.name.match(/\.(mp3|wav|ogg|m4a|aac|webm)$/i)) {
        throw new Error('不支持的音频格式，请选择 mp3/wav/ogg/m4a 文件');
    }

    // Validate size
    if (audioFile.size > MAX_FILE_SIZE) {
        throw new Error('文件太大，请选择 5MB 以内的音频文件');
    }

    notify('正在上传铃声...');
    console.log(`${LOG} Uploading user ringtone: ${audioFile.name} (${audioFile.size} bytes)`);

    // Upload to ST file system
    const audioBlob = new Blob([await audioFile.arrayBuffer()], { type: audioFile.type });
    const audioPath = await uploadAudioToST(audioBlob, 'ringtone_user');

    // Build ringtone data
    const displayName = audioFile.name.replace(/\.[^.]+$/, ''); // Strip extension
    const ringtoneData = {
        id: 'user_custom',
        name: displayName,
        mood: [],
        reason: '自选铃声',
        source: 'user',
        audioPath,
    };

    saveRingtoneSelection(ringtoneData);
    console.log(`${LOG} User ringtone uploaded: "${displayName}" → ${audioPath}`);
    return ringtoneData;
}

// ═══════════════════════════════════════════════════════════════════════
// Internal Helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get the backend URL from moments settings.
 * @returns {string|null}
 */
function _getBackendUrl() {
    try {
        const settings = getMomentsSettings();
        return settings?.backendUrl || null;
    } catch (e) {
        console.warn(`${LOG} Cannot get backend URL:`, e);
        return null;
    }
}

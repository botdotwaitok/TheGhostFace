// modules/phone/chat/chatVoice.js — Voice message recording, STT, playback
// Extracted from chatApp.js

import {
    escHtml, CHAT_LOG_PREFIX, scrollToBottom,
    getPendingMessages, updateButtonStates,
} from './chatApp.js';
import { renderDraftArea } from './chatMessageHandler.js';
import {
    startRecording, stopRecording, cancelRecording, isRecording,
    transcribe,
    playAudio, stopAudio,
    uploadAudioToST,
} from './voiceMessageService.js';

// ═════════════════════════════════════════════════════════════════════
// Voice Message — Recording, STT, TTS, Playback
// ═════════════════════════════════════════════════════════════════════

let _recordingStartY = 0;  // pointer Y at recording start, for swipe-up-to-cancel
let _isCancelMode = false; // User has swiped up

/**
 * Pending voice data — set after recording+STT, cleared when sent or discarded.
 * @type {{ audioPath: string, duration: number } | null}
 */
let _pendingVoiceData = null;

export function getPendingVoiceData() { return _pendingVoiceData; }
export function clearPendingVoiceData() { _pendingVoiceData = null; }

/**
 * Begin voice recording. Shows the overlay.
 */
export async function beginRecording() {
    const overlay = document.getElementById('chat_recording_overlay');
    const timerEl = document.getElementById('chat_recording_timer');
    const hintEl = document.getElementById('chat_recording_hint');
    if (!overlay) return;

    _isCancelMode = false;
    overlay.classList.remove('hidden', 'cancel-mode');
    if (timerEl) timerEl.textContent = '0:00';
    if (hintEl) hintEl.textContent = '松开发送，上滑取消';
    // Clear previous preview text
    const previewEl = document.getElementById('chat_recording_preview');
    if (previewEl) previewEl.textContent = '';

    try {
        await startRecording({
            onTick: (sec) => {
                if (timerEl) {
                    const m = Math.floor(sec / 60);
                    const s = String(sec % 60).padStart(2, '0');
                    timerEl.textContent = `${m}:${s}`;
                }
            },
            onInterim: (text) => {
                // Show live STT preview in the overlay
                const previewEl = document.getElementById('chat_recording_preview');
                if (previewEl) previewEl.textContent = text || '';
            },
        });

        // Pointer events for swipe-up cancel
        _recordingStartY = 0;
        const _onPointerDown = (e) => { _recordingStartY = e.clientY; };
        const _onPointerMove = (e) => {
            if (_recordingStartY && e.clientY < _recordingStartY - 80) {
                _isCancelMode = true;
                overlay.classList.add('cancel-mode');
                if (hintEl) hintEl.textContent = '松开取消发送';
            } else {
                _isCancelMode = false;
                overlay.classList.remove('cancel-mode');
                if (hintEl) hintEl.textContent = '松开发送，上滑取消';
            }
        };
        const _onPointerUp = async () => {
            overlay.removeEventListener('pointerdown', _onPointerDown);
            overlay.removeEventListener('pointermove', _onPointerMove);
            overlay.removeEventListener('pointerup', _onPointerUp);

            if (_isCancelMode) {
                cancelRecording();
                overlay.classList.add('hidden');
                return;
            }

            // Finish recording
            await _finishRecording(overlay);
        };

        overlay.addEventListener('pointerdown', _onPointerDown);
        overlay.addEventListener('pointermove', _onPointerMove);
        overlay.addEventListener('pointerup', _onPointerUp);

        // Also allow clicking the overlay itself to stop (for desktop click workflow)
        overlay.addEventListener('click', async function _clickStop(e) {
            if (e.target === overlay || e.target.closest('.chat-recording-panel')) {
                overlay.removeEventListener('click', _clickStop);
                if (isRecording()) await _finishRecording(overlay);
            }
        });

    } catch (err) {
        console.error(`${CHAT_LOG_PREFIX} Recording start failed:`, err);
        overlay.classList.add('hidden');
    }
}

/**
 * Stop recording, do STT, put transcribed text in input for user review.
 * Voice data stored in _pendingVoiceData; sendAllMessages() will detect it.
 */
async function _finishRecording(overlay) {
    const hintEl = document.getElementById('chat_recording_hint');
    const previewEl = document.getElementById('chat_recording_preview');

    // Show processing state
    if (hintEl) hintEl.textContent = '正在识别...';
    if (previewEl && !previewEl.textContent) {
        previewEl.textContent = '请稍候，正在转写语音...';
    }

    const result = await stopRecording();
    if (!result || result.duration < 1) {
        overlay.classList.add('hidden');
        return;
    }

    try {
        // Upload audio to ST server
        const audioPath = await uploadAudioToST(result.audioBlob, 'voice_user');

        // STT transcribe
        let text = '';
        try {
            text = await transcribe(result.audioBlob);
        } catch (sttErr) {
            console.warn(`${CHAT_LOG_PREFIX} STT failed:`, sttErr);
            text = '';
        }

        overlay.classList.add('hidden');

        if (!text) {
            // STT 完全失败 — 提示用户手动输入
            const messagesArea = document.getElementById('chat_messages_area');
            if (messagesArea) {
                messagesArea.insertAdjacentHTML('beforeend',
                    `<div class="chat-retract">⚠️ 语音转写失败，请手动输入</div>`);
                scrollToBottom(true);
            }
            return;
        }

        // Store voice data for sendAllMessages() to pick up
        _pendingVoiceData = { audioPath, duration: result.duration };

        // Push transcribed text into pending drafts (like kiwi drafts)
        getPendingMessages().push(text);
        renderDraftArea();
        updateButtonStates();

        console.log(`${CHAT_LOG_PREFIX} Voice transcribed, in pending: "${text}"`);

    } catch (err) {
        console.error(`${CHAT_LOG_PREFIX} Voice message failed:`, err);
        overlay.classList.add('hidden');
        const messagesArea = document.getElementById('chat_messages_area');
        if (messagesArea) {
            messagesArea.insertAdjacentHTML('beforeend',
                `<div class="chat-retract">⚠️ 语音发送失败: ${escHtml(err.message)}</div>`);
            scrollToBottom(true);
        }
    }
}

/**
 * Handle clicking a voice bubble play button.
 */
export async function handleVoicePlayback(bubble, playBtn) {
    const audioSrc = bubble.dataset.audioSrc;
    if (!audioSrc) return;

    const icon = playBtn.querySelector('i');

    // If already playing this one → stop
    if (bubble.classList.contains('playing')) {
        stopAudio();
        bubble.classList.remove('playing');
        if (icon) icon.className = 'fa-solid fa-play';
        return;
    }

    // Stop any other playing bubble
    document.querySelectorAll('.voice-bubble.playing').forEach(b => {
        b.classList.remove('playing');
        const btn = b.querySelector('.voice-play-btn i');
        if (btn) btn.className = 'fa-solid fa-play';
    });
    stopAudio();

    // Play
    bubble.classList.add('playing');
    if (icon) icon.className = 'fa-solid fa-stop';

    try {
        await playAudio(audioSrc, {
            onEnd: () => {
                bubble.classList.remove('playing');
                if (icon) icon.className = 'fa-solid fa-play';
            },
        });
    } catch (err) {
        console.error(`${CHAT_LOG_PREFIX} Voice playback failed:`, err);
        bubble.classList.remove('playing');
        if (icon) icon.className = 'fa-solid fa-play';
    }
}

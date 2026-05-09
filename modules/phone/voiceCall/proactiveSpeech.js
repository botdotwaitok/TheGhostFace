// modules/phone/voiceCall/proactiveSpeech.js — 语音通话主动提示词调度器
// 通话期间监测用户沉默时长，按阶段触发 AI 主动开口。
// 重置规则：只看用户开口（含 STT 转写 + 键盘输入），AI 自己说话不重置，避免死循环。

import { getPhoneUserName } from '../phoneContext.js';

const LOG_PREFIX = '[ProactiveSpeech]';

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

const STAGE_1_MS = 90 * 1000;         // 90s 后第一次触发 stage 1
const STAGE_2_START_MS = 240 * 1000;  // 240s（4min）起进入 stage 2
const STAGE_2_REPEAT_MS = 60 * 1000;  // stage 2 内每 60s 重复一次
const TICK_INTERVAL_MS = 5 * 1000;    // 每 5s 检查一次

// ═══════════════════════════════════════════════════════════════════════
// Module State
// ═══════════════════════════════════════════════════════════════════════

let _lastUserSpeechTime = 0;       // ms epoch；0 表示未启动
let _stage1Fired = false;
let _lastStage2FireTime = 0;       // ms epoch；0 表示 stage 2 还没触发过
let _tickInterval = null;

// 由调用方注入的回调：触发时调用 _onFire(instruction)；canFire() 返回当前是否允许触发
let _onFire = null;
let _canFire = null;

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * 注入回调。每次 openVoiceCall 时调用一次即可，多次调用会覆盖之前的回调。
 * @param {object} cfg
 * @param {(instruction: string) => void} cfg.onFire - 触发时调用，参数是要注入到 system prompt 的指令
 * @param {() => boolean} cfg.canFire - 返回当前 tick 是否允许触发（例如 TTS/LLM 不在进行中）
 */
export function initProactive({ onFire, canFire }) {
    _onFire = onFire;
    _canFire = canFire;
}

/**
 * 启动监听 —— 通话接通后立刻调用。
 * 把"最后一次说话时间"置为当前时刻，作为沉默计时基准。
 */
export function startProactive() {
    stopProactive();
    _lastUserSpeechTime = Date.now();
    _stage1Fired = false;
    _lastStage2FireTime = 0;
    _tickInterval = setInterval(_tick, TICK_INTERVAL_MS);
    console.log(`${LOG_PREFIX} started (stage1 in ${STAGE_1_MS / 1000}s, stage2 in ${STAGE_2_START_MS / 1000}s)`);
}

/**
 * 停止监听并清空所有状态 —— 通话关闭时调用。
 */
export function stopProactive() {
    if (_tickInterval) {
        clearInterval(_tickInterval);
        _tickInterval = null;
    }
    _lastUserSpeechTime = 0;
    _stage1Fired = false;
    _lastStage2FireTime = 0;
    console.log(`${LOG_PREFIX} stopped`);
}

/**
 * 用户开口（语音或文字）时调用 —— 重置全部状态。
 * @param {string} text - 用户说的内容（含 trim 后非空判断，避免 VAD 短噪声触发空文本误重置）
 */
export function notifyUserSpoke(text) {
    if (!text || !text.trim()) return;
    if (!_tickInterval) return;
    _lastUserSpeechTime = Date.now();
    _stage1Fired = false;
    _lastStage2FireTime = 0;
}

// ═══════════════════════════════════════════════════════════════════════
// Tick
// ═══════════════════════════════════════════════════════════════════════

function _tick() {
    if (!_lastUserSpeechTime) return;

    // 安全门：AI 正在说话 / LLM 正在请求 → 跳过本次 tick，等下次再判断（不重置计时器）
    if (_canFire && !_canFire()) return;
    if (!_onFire) return;

    const now = Date.now();
    const elapsed = now - _lastUserSpeechTime;

    // ── Stage 2：240s 起进入；首次立刻触发，之后每 60s 重复 ──
    // 优先级高于 stage 1，避免长时间沉默后还卡在 stage 1 的一次性触发上
    if (elapsed >= STAGE_2_START_MS) {
        if (!_lastStage2FireTime || (now - _lastStage2FireTime) >= STAGE_2_REPEAT_MS) {
            _lastStage2FireTime = now;
            // 进入 stage 2 后 stage 1 就不再有意义；标记成已触发避免回退
            _stage1Fired = true;
            console.log(`${LOG_PREFIX} Stage 2 fired (elapsed=${Math.round(elapsed / 1000)}s)`);
            try {
                _onFire(_buildStage2Instruction());
            } catch (e) {
                console.warn(`${LOG_PREFIX} onFire threw:`, e);
            }
        }
        return;
    }

    // ── Stage 1：90s 后触发一次 ──
    if (!_stage1Fired && elapsed >= STAGE_1_MS) {
        _stage1Fired = true;
        console.log(`${LOG_PREFIX} Stage 1 fired (elapsed=${Math.round(elapsed / 1000)}s)`);
        try {
            _onFire(_buildStage1Instruction());
        } catch (e) {
            console.warn(`${LOG_PREFIX} onFire threw:`, e);
        }
        return;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Prompt Text
// ═══════════════════════════════════════════════════════════════════════

function _buildStage1Instruction() {
    const userName = getPhoneUserName();
    return `${userName}已经快一分钟没说话了。请主动根据当前对话氛围，自然地选一个话题继续聊下去。不要点破或提及"${userName}没说话"这件事——就像真实通话中你忍不住想说点什么一样。`;
}

function _buildStage2Instruction() {
    const userName = getPhoneUserName();
    return [
        `${userName}已经很久没回应了，可能不方便说话、走神、或者睡着了。`,
        `请你自由选择如何反应：`,
        `- 继续轻声碎碎念、说说自己的感受或正在做的事`,
        `- 温柔地说一句话然后主动结束通话`,
        `- 或别的你觉得合适的反应`,
        ``,
        `如果决定结束通话，请在你最后一句台词的 </say> 标签之后，另起一行单独输出：[挂断]`,
    ].join('\n');
}

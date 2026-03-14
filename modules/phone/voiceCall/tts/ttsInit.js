// modules/phone/voiceCall/tts/ttsInit.js — TTS 单例工厂
// 创建全局 TtsEngine 单例，注册所有 Provider，供 voiceCallUI 使用。

import { TtsEngine } from './ttsEngine.js';
import { GsviTtsProvider } from './providers/gsviTtsProvider.js';
import { ElevenlabsTtsProvider } from './providers/elevenlabsTtsProvider.js';
import { MinimaxTtsProvider } from './providers/minimaxTtsProvider.js';

const LOG_PREFIX = '[TtsInit]';

/** @type {TtsEngine|null} */
let _engine = null;

/**
 * 获取全局 TtsEngine 单例（懒初始化）
 * @returns {TtsEngine}
 */
export function getTtsEngine() {
    if (!_engine) {
        _engine = new TtsEngine();

        _engine.registerProvider('GPT-SoVITS', GsviTtsProvider);
        _engine.registerProvider('ElevenLabs', ElevenlabsTtsProvider);
        _engine.registerProvider('MiniMax', MinimaxTtsProvider);

        // 恢复上次保存的 Provider
        const saved = _engine.getSettings();
        if (saved.provider && saved.provider !== 'none') {
            _engine.setProvider(saved.provider);
        }

        console.debug(`${LOG_PREFIX} TtsEngine initialized`);
    }
    return _engine;
}

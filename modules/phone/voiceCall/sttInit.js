// modules/phone/voiceCall/sttInit.js — STT 初始化模块
// 注册所有 Provider，创建全局 SttEngine 单例，供 settingsApp 和其她模块使用。

import { SttEngine } from './sttEngine.js';
import { BrowserSttProvider } from './providers/browserProvider.js';
import { GroqSttProvider } from './providers/groqProvider.js';
import { OpenAISttProvider } from './providers/openaiProvider.js';
import { WhisperLocalSttProvider } from './providers/whisperLocalProvider.js';
import { KoboldCppSttProvider } from './providers/koboldCppProvider.js';

const LOG_PREFIX = '[SttInit]';

/** @type {SttEngine|null} */
let _engine = null;

/**
 * 获取全局 SttEngine 单例（懒初始化）
 * @returns {SttEngine}
 */
export function getSttEngine() {
    if (!_engine) {
        _engine = new SttEngine();

        // 注册所有 Provider
        _engine.registerProvider('Browser', BrowserSttProvider);
        _engine.registerProvider('Groq', GroqSttProvider);
        _engine.registerProvider('OpenAI', OpenAISttProvider);
        _engine.registerProvider('Whisper (Local)', WhisperLocalSttProvider);
        _engine.registerProvider('KoboldCpp', KoboldCppSttProvider);

        // 恢复上次保存的 Provider
        const saved = _engine.getSettings();
        if (saved.provider && saved.provider !== 'none') {
            _engine.setProvider(saved.provider).catch(e => {
                console.warn(`${LOG_PREFIX} restore provider failed:`, e);
            });
        }

        console.debug(`${LOG_PREFIX} SttEngine initialized with ${_engine.getAvailableProviders().length} providers`);
    }
    return _engine;
}

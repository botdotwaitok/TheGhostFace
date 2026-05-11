// modules/phone/voiceCall/providers/browserProvider.js
// Web Speech API (SpeechRecognition) Provider — P0 优先级
// 零成本，iOS Safari + PC Edge 原生支持，最多用户受益。
// 独立实现，不复制原始 AGPLv3 代码。

const LOG_PREFIX = '[STT:Browser]';

export class BrowserSttProvider {
    constructor() {
        this.name = 'Browser';
        this.description = '浏览器内置语音识别 (免费)';
        this.note = 'iOS Safari / PC Edge / Chrome 原生支持';

        /** @type {SpeechRecognition|null} */
        this._recognition = null;
        this._listening = false;
    }

    /**
     * 检查当前浏览器是否支持 Web Speech API
     * @returns {boolean}
     */
    isAvailable() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    /**
     * 开始语音识别（Browser Provider 直接使用 SpeechRecognition，不走 MediaRecorder）
     * @param {Object} opts
     * @param {string} opts.language - 语言代码 (e.g. 'zh-CN')
     * @param {(text: string) => void} opts.onTranscript - 最终识别结果
     * @param {(text: string) => void} opts.onInterim - 中间结果
     * @param {() => void} opts.onEnd - 识别结束
     * @param {(err: Error) => void} opts.onError - 错误
     */
    startRecognition({ language, onTranscript, onInterim, onEnd, onError }) {
        if (this._listening) {
            console.debug(`${LOG_PREFIX} already listening`);
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            onError(new Error('此浏览器不支持语音识别'));
            return;
        }

        const recognition = new SpeechRecognition();
        // continuous=false: the engine commits ONE final result after a natural
        // pause, then fires onend on its own. Avoids the continuous=true trap
        // where the recognition stays alive forever and we have to hand-roll a
        // silence detector (which gets fooled by ambient music / TTS bleed-through
        // keeping interim events flowing). Multi-sentence input still works fine:
        // voiceCallUI auto-restarts STT after each transcript via onSttStateChange.
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = language || 'zh-CN';

        let finalTranscript = '';
        // Safety net: if the engine never fires onend for any reason (some mobile
        // browsers under heavy background noise will hang in continuous=false too),
        // force-abort after this long so the call doesn't get stuck.
        const MAX_RECOGNITION_MS = 20000;
        let maxTimer = setTimeout(() => {
            maxTimer = null;
            try { recognition.abort(); } catch { /* ignore */ }
        }, MAX_RECOGNITION_MS);

        // onEnd / onerror 都可能 fire，且部分浏览器在 'aborted' 错误后
        // 不会再 fire onend。用 onEndFired 做一次性闸门，保证上层只收到一次
        // 结束事件，避免被卡在 LISTENING。
        let onEndFired = false;
        const fireOnEnd = () => {
            if (onEndFired) return;
            onEndFired = true;
            if (maxTimer) {
                clearTimeout(maxTimer);
                maxTimer = null;
            }
            this._listening = false;
            this._recognition = null;
            if (finalTranscript.trim()) {
                onTranscript(finalTranscript.trim());
            }
            onEnd();
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;

                if (event.results[i].isFinal) {
                    let processed = this._capitalizeFirst(transcript.trim());
                    if (processed) {
                        // 确保末尾有标点
                        if (!/[.?!。？！]$/.test(processed)) processed += '。';
                        finalTranscript += processed;
                    }
                    // continuous=false makes the engine auto-end after this fires;
                    // no manual abort needed here.
                } else {
                    interimTranscript += transcript;
                }
            }

            // 发送中间结果（实时预览）
            if (interimTranscript) {
                onInterim(this._capitalizeFirst(interimTranscript));
            }
        };

        recognition.onerror = (event) => {
            // 'no-speech' 和 'aborted' 不算严重错误（abort 是我们主动调的）
            if (event.error === 'no-speech' || event.error === 'aborted') {
                console.debug(`${LOG_PREFIX} (benign) ${event.error}`);
                // 部分浏览器在 'aborted' 后不再 fire onend，
                // 这里兜底走 fireOnEnd（onEndFired 保证不会和后续 onend 重复）。
                if (event.error === 'aborted') fireOnEnd();
                return;
            }
            console.error(`${LOG_PREFIX} error:`, event.error);
            onError(new Error(`语音识别错误: ${event.error}`));
        };

        recognition.onend = () => {
            console.debug(`${LOG_PREFIX} recognition ended`);
            fireOnEnd();
        };

        recognition.onstart = () => {
            console.debug(`${LOG_PREFIX} recognition started, lang: ${recognition.lang}`);
        };

        this._recognition = recognition;
        this._listening = true;
        recognition.start();
    }

    /**
     * 停止语音识别
     * stop() 优先（保留 in-progress 的最后一句），但部分浏览器在 continuous=false
     * + 背景噪声场景下不会及时 fire onend；600ms 后兜底走 abort() 保证上层一定能
     * 从 LISTENING 解套。
     */
    stopRecognition() {
        if (!this._recognition || !this._listening) return;
        const rec = this._recognition;
        try { rec.stop(); } catch { /* ignore */ }
        this._listening = false;
        // 引用立即清掉，防 onend 还没回到主线程时上层又拨新会话
        // 拿到旧 recognition 状态。真正的 final transcript 投递走 onend → fireOnEnd。
        this._recognition = null;
        // Fallback: if stop() didn't trigger onend, force abort to guarantee the
        // upper layer transitions out of LISTENING. fireOnEnd's once-only guard
        // makes this safe even when stop() did fire onend already.
        setTimeout(() => {
            try { rec.abort(); } catch { /* ignore */ }
        }, 600);
    }

    /**
     * Browser Provider 不使用 processAudio（不走 MediaRecorder 路径）
     */
    async processAudio(_audioBlob) {
        throw new Error('Browser Provider 使用 startRecognition/stopRecognition，不支持 processAudio');
    }

    // ── 内部工具 ──

    _capitalizeFirst(text) {
        if (!text || text.length === 0) return text;
        const trimmed = text.trimStart();
        if (trimmed.length === 0) return text;
        return text.slice(0, text.length - trimmed.length) +
            trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }
}

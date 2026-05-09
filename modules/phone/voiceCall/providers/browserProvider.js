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
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = language || 'zh-CN';

        let finalTranscript = '';
        // onEnd / onerror 都可能 fire，且部分浏览器在 'aborted' 错误后
        // 不会再 fire onend。用 onEndFired 做一次性闸门，保证上层只收到一次
        // 结束事件，避免被卡在 LISTENING。
        let onEndFired = false;
        const fireOnEnd = () => {
            if (onEndFired) return;
            onEndFired = true;
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
                    // 不在第一句 final 上 abort —— continuous 模式本意就是
                    // 让用户连说多句一起累计上来，旧版在这里 abort 会把第二句
                    // 直接吞掉。停止改由上层 stopRecognition 显式触发。
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
     */
    stopRecognition() {
        if (this._recognition && this._listening) {
            this._recognition.stop();
            this._listening = false;
            // 引用立即清掉，防 onend 还没回到主线程时上层又拨新会话
            // 拿到旧 recognition 状态。真正的 final transcript 投递走 onend → fireOnEnd。
            this._recognition = null;
        }
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

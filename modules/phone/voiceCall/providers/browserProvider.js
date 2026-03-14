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
                    // 获得最终结果后自动停止
                    recognition.abort();
                    this._listening = false;
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
                return;
            }
            console.error(`${LOG_PREFIX} error:`, event.error);
            onError(new Error(`语音识别错误: ${event.error}`));
        };

        recognition.onend = () => {
            this._listening = false;
            this._recognition = null;
            console.debug(`${LOG_PREFIX} recognition ended`);

            if (finalTranscript.trim()) {
                onTranscript(finalTranscript.trim());
            }
            onEnd();
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

// modules/phone/voiceCall/vad.js — Voice Activity Detection (VAD)
// 独立实现的 FFT 能量检测器，通过分析音频频谱能量判断是否有人声。
// 提供 onVoiceStart / onVoiceStop 回调，用于自动开始/停止录音。

const LOG_PREFIX = '[VAD]';

/**
 * @typedef {Object} VADOptions
 * @property {MediaStreamAudioSourceNode} source - 音频源节点（必填）
 * @property {Function} [voice_start] - 检测到语音开始
 * @property {Function} [voice_stop]  - 检测到语音结束
 * @property {number} [fftSize]       - FFT 分析大小 (默认 512)
 * @property {number} [bufferLen]     - 处理缓冲区大小 (默认 512)
 * @property {number} [smoothingTimeConstant] - 频谱平滑系数 (默认 0.99)
 * @property {number} [energy_offset] - 初始能量偏移 (默认 1e-8)
 * @property {number} [energy_threshold_ratio_pos] - 正向阈值比 (默认 2)
 * @property {number} [energy_threshold_ratio_neg] - 负向阈值比 (默认 0.5)
 * @property {number} [energy_integration] - 能量积分系数 (默认 1)
 * @property {number} [min_speech_ms] - 段最短时长 (默认 300)，短于此的段不上报，过滤咳嗽 / 清嗓
 * @property {number} [max_speech_ms] - 段最长时长 (默认 30000)，超过则强制截段
 */

// _energyOffset 钳制范围：太小会被极小数值噪声触发误报，
// 太大会让阈值漂到正常人声之上，永远 trip 不到 voice_start。
const ENERGY_OFFSET_MIN = 1e-6;
const ENERGY_OFFSET_MAX = 1;

export class VoiceActivityDetector {
    /**
     * @param {VADOptions} options
     */
    constructor(options) {
        if (!options.source) {
            throw new Error('VAD requires a MediaStreamAudioSourceNode as source.');
        }

        this._opts = {
            fftSize: 512,
            bufferLen: 512,
            smoothingTimeConstant: 0.99,
            energy_offset: 1e-8,
            energy_threshold_ratio_pos: 2,
            energy_threshold_ratio_neg: 0.5,
            energy_integration: 1,
            min_speech_ms: 300,
            max_speech_ms: 30000,
            voice_start: () => {},
            voice_stop: () => {},
            // 频率过滤：仅关注 200Hz ~ 2kHz 的人声频段
            filter: [
                { f: 200, v: 0 },
                { f: 2000, v: 1 },
            ],
            ...options,
        };

        const ctx = this._opts.source.context;

        // 频率分辨率和迭代周期
        this._hertzPerBin = ctx.sampleRate / this._opts.fftSize;
        this._iterationPeriod = this._opts.bufferLen / ctx.sampleRate;

        // 能量检测状态
        this._energyOffset = this._opts.energy_offset;
        this._energyThresholdPos = this._energyOffset * this._opts.energy_threshold_ratio_pos;
        this._energyThresholdNeg = this._energyOffset * this._opts.energy_threshold_ratio_neg;
        this._voiceTrend = 0;
        this._vadState = false;
        this._destroyed = false;

        // 段时长跟踪：vadState 翻 true 时记录起点；
        // _voiceStartFired 用于"短段静默丢弃"——内部已进入 active，
        // 但段时长还没满足 min_speech_ms 就不对外 fire voice_start，
        // 这样咳嗽 / 清嗓不会触发上层录音 / 调付费 API。
        this._speechStartTime = 0;
        this._voiceStartFired = false;

        // 趋势边界
        this._TREND_MAX = 10;
        this._TREND_MIN = -10;
        this._TREND_START = 5;   // voiceTrend 超过此值 → 语音开始
        this._TREND_END = -5;    // voiceTrend 低于此值 → 语音结束

        // 构建频率过滤器
        this._filter = this._buildFilter(this._opts.filter);

        // 创建分析器节点
        this._analyser = ctx.createAnalyser();
        this._analyser.smoothingTimeConstant = this._opts.smoothingTimeConstant;
        this._analyser.fftSize = this._opts.fftSize;

        this._freqData = new Float32Array(this._analyser.frequencyBinCount);
        this._freqDataLinear = new Float32Array(this._freqData.length);

        // 连接分析器
        this._opts.source.connect(this._analyser);

        // 创建处理节点（ScriptProcessorNode 虽已过时，但兼容性最好）
        this._processor = ctx.createScriptProcessor(this._opts.bufferLen, 1, 1);
        // 通过 gain=0 的静音 GainNode 桥接到 destination：
        // 不连 destination 在某些浏览器上 onaudioprocess 不会触发；
        // 直连 destination 又会把麦克风原始数据回放到扬声器，
        // 在外放场景下形成正反馈（VAD 啸叫）。中间夹一层 gain=0 既保证
        // 处理回调被调度、又彻底切断声音回放。
        this._dummyGain = ctx.createGain();
        this._dummyGain.gain.value = 0;
        this._processor.connect(this._dummyGain);
        this._dummyGain.connect(ctx.destination);
        this._opts.source.connect(this._processor);

        this._processor.onaudioprocess = () => {
            if (this._destroyed) return;
            this._analyser.getFloatFrequencyData(this._freqData);
            this._updateLinearData();
            this._monitor();
        };

        console.debug(`${LOG_PREFIX} initialized | sampleRate: ${ctx.sampleRate} | hertzPerBin: ${this._hertzPerBin.toFixed(1)}`);
    }

    /** 是否当前检测到语音 */
    get isVoiceActive() {
        return this._vadState;
    }

    /** 销毁 VAD，断开所有音频节点 */
    destroy() {
        this._destroyed = true;
        try {
            this._processor.disconnect();
            this._analyser.disconnect();
            this._dummyGain?.disconnect();
        } catch { /* 静默处理 */ }
        console.debug(`${LOG_PREFIX} destroyed`);
    }

    // ── 内部方法 ──

    _buildFilter(shape) {
        const binCount = this._opts.fftSize / 2;
        const filter = new Float32Array(binCount);
        for (let i = 0; i < binCount; i++) {
            filter[i] = 0;
            for (let j = 0; j < shape.length; j++) {
                if (i * this._hertzPerBin < shape[j].f) {
                    filter[i] = shape[j].v;
                    break;
                }
            }
        }
        return filter;
    }

    _updateLinearData() {
        for (let i = 0; i < this._freqData.length; i++) {
            this._freqDataLinear[i] = Math.pow(10, this._freqData[i] / 10);
        }
    }

    _getEnergy() {
        let energy = 0;
        for (let i = 0; i < this._freqDataLinear.length; i++) {
            energy += this._filter[i] * this._freqDataLinear[i] * this._freqDataLinear[i];
        }
        return energy;
    }

    _monitor() {
        const energy = this._getEnergy();
        const signal = energy - this._energyOffset;

        // 更新趋势
        if (signal > this._energyThresholdPos) {
            this._voiceTrend = Math.min(this._voiceTrend + 1, this._TREND_MAX);
        } else if (signal < -this._energyThresholdNeg) {
            this._voiceTrend = Math.max(this._voiceTrend - 1, this._TREND_MIN);
        } else {
            // 趋势衰减
            if (this._voiceTrend > 0) this._voiceTrend--;
            else if (this._voiceTrend < 0) this._voiceTrend++;
        }

        const isStart = this._voiceTrend > this._TREND_START;
        const isEnd = this._voiceTrend < this._TREND_END;

        // 能量积分（自适应偏移）
        const integration = signal * this._iterationPeriod * this._opts.energy_integration;
        if (integration > 0 || !isEnd) {
            this._energyOffset += integration;
        } else {
            this._energyOffset += integration * 10;
        }
        // 钳制 offset 上下限：旧实现只保 >= 0，长时间静音 / 极静环境会让 offset
        // 漂到无穷小，导致一点点底噪都触发；反过来突发巨响也能把 offset 顶到
        // 高位再也回不来。
        this._energyOffset = Math.min(
            ENERGY_OFFSET_MAX,
            Math.max(ENERGY_OFFSET_MIN, this._energyOffset),
        );
        this._energyThresholdPos = this._energyOffset * this._opts.energy_threshold_ratio_pos;
        this._energyThresholdNeg = this._energyOffset * this._opts.energy_threshold_ratio_neg;

        const now = (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();

        // 状态切换与回调
        if (isStart && !this._vadState) {
            this._vadState = true;
            this._speechStartTime = now;
            this._voiceStartFired = false;
        }

        // 内部已 active，但要等持续时间满足 min_speech_ms 才对外 fire voice_start。
        // 短促噪声（咳嗽 / 清嗓 / 关门）不会经过这个门槛，自然被丢弃，
        // 上层不会启动录音 / 调付费 STT API。
        if (this._vadState && !this._voiceStartFired
            && (now - this._speechStartTime) >= this._opts.min_speech_ms) {
            this._voiceStartFired = true;
            this._opts.voice_start();
        }

        // 强制截段：单段超过 max_speech_ms 时，不等 trend 衰减，
        // 直接收尾并重置 trend。防一直说话导致 STT 一次推超长 audio。
        if (this._vadState && this._voiceStartFired
            && (now - this._speechStartTime) >= this._opts.max_speech_ms) {
            this._vadState = false;
            this._voiceStartFired = false;
            this._voiceTrend = 0;
            this._opts.voice_stop();
            return;
        }

        if (isEnd && this._vadState) {
            const startWasFired = this._voiceStartFired;
            this._vadState = false;
            this._voiceStartFired = false;
            // 段时长不到 min_speech_ms 时 voice_start 没有发出过，
            // 静默丢弃，对应的 voice_stop 也不发，保持上下游成对。
            if (startWasFired) {
                this._opts.voice_stop();
            }
        }
    }
}

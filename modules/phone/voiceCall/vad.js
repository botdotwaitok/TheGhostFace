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
 */

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
        this._processor.connect(ctx.destination);
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
        this._energyOffset = Math.max(0, this._energyOffset);
        this._energyThresholdPos = this._energyOffset * this._opts.energy_threshold_ratio_pos;
        this._energyThresholdNeg = this._energyOffset * this._opts.energy_threshold_ratio_neg;

        // 状态切换与回调
        if (isStart && !this._vadState) {
            this._vadState = true;
            this._opts.voice_start();
        }
        if (isEnd && this._vadState) {
            this._vadState = false;
            this._opts.voice_stop();
        }
    }
}

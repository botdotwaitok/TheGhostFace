// modules/phone/voiceCall/waveWorker.js — Web Worker: PCM → WAV 转换
// 在后台线程处理音频数据，不阻塞主线程 UI。
// 独立实现，参考 WAV 文件格式规范 (RIFF header + PCM data)。

self.onmessage = function (e) {
    const { pcmArrays, config } = e.data;
    const sampleRate = config.sampleRate || 48000;
    const bitDepth = config.bitDepth || 16;
    const bytesPerSample = bitDepth / 8;
    const numberOfChannels = pcmArrays.length;

    // 入口守卫：空数组 / 空通道时直接返回 44 字节空 WAV header，
    // 避免后面 pcmArrays[0].length 抛 TypeError。
    if (numberOfChannels === 0 || !pcmArrays[0] || pcmArrays[0].length === 0) {
        const empty = new Uint8Array(44);
        self.postMessage(empty, [empty.buffer]);
        self.close();
        return;
    }

    const bufferLength = pcmArrays[0].length;

    // Interleave channels and convert float32 → int PCM
    const dataLength = bufferLength * numberOfChannels * bytesPerSample;
    const pcmData = new Uint8Array(dataLength);

    for (let i = 0; i < bufferLength; i++) {
        for (let ch = 0; ch < numberOfChannels; ch++) {
            const outputIndex = (i * numberOfChannels + ch) * bytesPerSample;
            let sample = pcmArrays[ch][i];

            // Clamp to [-1, 1]
            if (sample > 1) sample = 1;
            else if (sample < -1) sample = -1;

            // Convert to integer based on bit depth
            if (bytesPerSample === 2) {
                // 16-bit signed integer.
                // 非对称缩放：负值乘 32768（最小到 -32768，正好 int16 下界），
                // 正值乘 32767（最大到 32767，int16 上界）。统一乘 32768 会让
                // sample=1.0 得到 32768，与 -32768 写成同样字节，造成 +1 → -1
                // 的削顶溢出（loud 段听感上变成爆音）。
                sample = sample < 0 ? sample * 32768 : sample * 32767;
                pcmData[outputIndex] = sample & 0xFF;
                pcmData[outputIndex + 1] = (sample >> 8) & 0xFF;
            } else if (bytesPerSample === 1) {
                // 8-bit unsigned integer
                pcmData[outputIndex] = ((sample + 1) * 128) & 0xFF;
            }
        }
    }

    // Build WAV file (44-byte RIFF header + PCM data)
    const headerLength = 44;
    const wav = new Uint8Array(headerLength + dataLength);
    const view = new DataView(wav.buffer);

    // 'RIFF' chunk descriptor
    view.setUint32(0, 0x52494646, false);  // 'RIFF'
    view.setUint32(4, 36 + dataLength, true); // file size - 8
    view.setUint32(8, 0x57415645, false);  // 'WAVE'

    // 'fmt ' sub-chunk
    view.setUint32(12, 0x666D7420, false); // 'fmt '
    view.setUint32(16, 16, true);           // sub-chunk size (PCM = 16)
    view.setUint16(20, 1, true);            // audio format (1 = PCM)
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample * numberOfChannels, true); // byte rate
    view.setUint16(32, bytesPerSample * numberOfChannels, true); // block align
    view.setUint16(34, bitDepth, true);

    // 'data' sub-chunk
    view.setUint32(36, 0x64617461, false); // 'data'
    view.setUint32(40, dataLength, true);

    // Copy PCM data
    wav.set(pcmData, headerLength);

    // Transfer buffer back to main thread (zero-copy)
    self.postMessage(wav, [wav.buffer]);
    self.close();
};

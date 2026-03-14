// modules/phone/voiceCall/waveWorker.js — Web Worker: PCM → WAV 转换
// 在后台线程处理音频数据，不阻塞主线程 UI。
// 独立实现，参考 WAV 文件格式规范 (RIFF header + PCM data)。

self.onmessage = function (e) {
    const { pcmArrays, config } = e.data;
    const sampleRate = config.sampleRate || 48000;
    const bitDepth = config.bitDepth || 16;
    const bytesPerSample = bitDepth / 8;
    const numberOfChannels = pcmArrays.length;
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
                // 16-bit signed integer
                sample = sample * 32768;
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

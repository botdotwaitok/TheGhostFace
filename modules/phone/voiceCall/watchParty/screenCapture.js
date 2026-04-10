// modules/phone/voiceCall/watchParty/screenCapture.js — Screen Capture Engine
// Manages getDisplayMedia() lifecycle, canvas frame extraction, and stream state.
// Desktop-only (mobile browsers do not support getDisplayMedia).

const LOG_PREFIX = '[ScreenCapture]';

// ─── Internal State ───
let _stream = null;          // MediaStream from getDisplayMedia
let _videoEl = null;         // Hidden <video> element rendering the stream
let _canvasEl = null;        // Hidden <canvas> for frame extraction
let _canvasCtx = null;       // 2D context
let _onEndedCallback = null; // Called when user stops sharing via browser UI

// ─── Configuration ───
const CAPTURE_WIDTH = 512;   // Max width for captured frames (controls token cost)
const CAPTURE_QUALITY = 0.6; // JPEG quality (0-1), lower = smaller base64

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check if the browser supports screen capture.
 * @returns {boolean}
 */
export function isScreenCaptureSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
}

/**
 * Start screen capture. Prompts the user with the browser's native
 * screen/window/tab picker dialog.
 * @returns {Promise<void>}
 * @throws {Error} if not supported from browser or user denies permission
 */
export async function startScreenCapture() {
    if (_stream) {
        console.warn(`${LOG_PREFIX} Already capturing, stopping previous stream first.`);
        stopScreenCapture();
    }

    if (!isScreenCaptureSupported()) {
        throw new Error('当前浏览器不支持屏幕捕获 (getDisplayMedia)');
    }

    console.log(`${LOG_PREFIX} Requesting screen capture...`);

    try {
        _stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: 'never',        // Don't capture cursor
                frameRate: { ideal: 5 }, // Low FPS is fine, we only take periodic snapshots
            },
            audio: false, // Phase 1: no audio capture
        });
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            throw new Error('用户拒绝了屏幕共享请求');
        }
        throw err;
    }

    // ── Create hidden video element to render the stream ──
    _videoEl = document.createElement('video');
    _videoEl.srcObject = _stream;
    _videoEl.muted = true;
    _videoEl.playsInline = true;
    _videoEl.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(_videoEl);

    // Wait for video to be ready
    await new Promise((resolve, reject) => {
        _videoEl.onloadedmetadata = () => {
            _videoEl.play().then(resolve).catch(reject);
        };
        _videoEl.onerror = reject;
        // Timeout after 5s
        setTimeout(() => reject(new Error('视频流加载超时')), 5000);
    });

    // ── Create hidden canvas for frame extraction ──
    _canvasEl = document.createElement('canvas');
    _canvasEl.style.cssText = 'display:none;';
    document.body.appendChild(_canvasEl);
    _canvasCtx = _canvasEl.getContext('2d');

    // ── Listen for user stopping the share via browser UI ──
    const videoTrack = _stream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
            console.log(`${LOG_PREFIX} Screen share ended by user (browser UI).`);
            _cleanup();
            if (_onEndedCallback) _onEndedCallback();
        });
    }

    console.log(`${LOG_PREFIX} ✅ Screen capture started. Video: ${_videoEl.videoWidth}x${_videoEl.videoHeight}`);
}

/**
 * Capture a single frame from the screen share stream.
 * Returns a base64 data URL (JPEG) resized to CAPTURE_WIDTH.
 * @returns {string|null} base64 data URL, or null if not capturing
 */
export function captureFrame() {
    if (!_stream || !_videoEl || !_canvasEl || !_canvasCtx) {
        return null;
    }

    // Check if stream is still active
    const videoTrack = _stream.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState !== 'live') {
        console.warn(`${LOG_PREFIX} Video track not live, cannot capture frame.`);
        return null;
    }

    const vw = _videoEl.videoWidth;
    const vh = _videoEl.videoHeight;
    if (vw === 0 || vh === 0) return null;

    // Calculate target dimensions (maintain aspect ratio)
    const scale = Math.min(1, CAPTURE_WIDTH / vw);
    const tw = Math.round(vw * scale);
    const th = Math.round(vh * scale);

    _canvasEl.width = tw;
    _canvasEl.height = th;

    _canvasCtx.drawImage(_videoEl, 0, 0, tw, th);

    return _canvasEl.toDataURL('image/jpeg', CAPTURE_QUALITY);
}

/**
 * Get a low-resolution thumbnail for display/storage purposes.
 * Returns a very small JPEG (128px wide) for embedding in call logs.
 * @returns {string|null} base64 data URL
 */
export function captureThumbnail() {
    if (!_stream || !_videoEl || !_canvasEl || !_canvasCtx) {
        return null;
    }

    const vw = _videoEl.videoWidth;
    const vh = _videoEl.videoHeight;
    if (vw === 0 || vh === 0) return null;

    const scale = Math.min(1, 128 / vw);
    const tw = Math.round(vw * scale);
    const th = Math.round(vh * scale);

    _canvasEl.width = tw;
    _canvasEl.height = th;
    _canvasCtx.drawImage(_videoEl, 0, 0, tw, th);

    return _canvasEl.toDataURL('image/jpeg', 0.4);
}

/**
 * Stop screen capture and clean up all resources.
 */
export function stopScreenCapture() {
    console.log(`${LOG_PREFIX} Stopping screen capture.`);
    _cleanup();
}

/**
 * Check if screen capture is currently active.
 * @returns {boolean}
 */
export function isCapturing() {
    if (!_stream) return false;
    const videoTrack = _stream.getVideoTracks()[0];
    return videoTrack && videoTrack.readyState === 'live';
}

/**
 * Register a callback for when the user stops sharing via browser UI.
 * @param {Function} callback
 */
export function onCaptureEnded(callback) {
    _onEndedCallback = callback;
}

// ═══════════════════════════════════════════════════════════════════════
// Internal Cleanup
// ═══════════════════════════════════════════════════════════════════════

function _cleanup() {
    // Stop all tracks
    if (_stream) {
        _stream.getTracks().forEach(track => track.stop());
        _stream = null;
    }

    // Remove video element
    if (_videoEl) {
        _videoEl.pause();
        _videoEl.srcObject = null;
        _videoEl.remove();
        _videoEl = null;
    }

    // Remove canvas
    if (_canvasEl) {
        _canvasEl.remove();
        _canvasEl = null;
        _canvasCtx = null;
    }
}

// modules/phone/voiceCall/wakeLockManager.js — 通话期间保持屏幕常亮
// 移动浏览器在屏幕熄灭后会暂停 JS 与 SpeechSynthesis，TTS 会被打断。
// 使用 Screen Wake Lock API 在通话期间保持屏幕唤醒；系统会在 document
// 进入隐藏态时自动释放 sentinel，因此监听 visibilitychange 在重新可见时
// 重新申请，覆盖快速切换 App 后回到通话的场景。


const LOG = '[WakeLock]';

/** @type {WakeLockSentinel|null} */
let _sentinel = null;
let _wantLock = false;

async function _request() {
    if (!('wakeLock' in navigator)) {
        console.log(`${LOG} Wake Lock API not supported in this browser`);
        return;
    }
    if (_sentinel) return;
    if (document.visibilityState !== 'visible') return;

    try {
        // Resolve to a local first — if the caller releases mid-await we must
        // drop this sentinel right away instead of stashing it where nothing
        // will ever release it. This is the "answer→hang up" race.
        const sentinel = await navigator.wakeLock.request('screen');
        if (!_wantLock) {
            try { await sentinel.release(); } catch { /* already released */ }
            console.log(`${LOG} Acquired sentinel after release was requested — dropped immediately`);
            return;
        }
        _sentinel = sentinel;
        _sentinel.addEventListener('release', () => {
            console.log(`${LOG} Sentinel released by system`);
            _sentinel = null;
        });
        console.log(`${LOG} Screen wake lock acquired`);
    } catch (e) {
        console.warn(`${LOG} Acquire failed: ${e.name} - ${e.message}`);
    }
}

function _onVisibilityChange() {
    if (_wantLock && document.visibilityState === 'visible') {
        _request();
    }
}

export async function acquireWakeLock() {
    if (_wantLock) return;
    _wantLock = true;
    document.addEventListener('visibilitychange', _onVisibilityChange);
    await _request();
}

export async function releaseWakeLock() {
    if (!_wantLock) return;
    _wantLock = false;
    document.removeEventListener('visibilitychange', _onVisibilityChange);
    if (_sentinel) {
        try {
            await _sentinel.release();
        } catch (e) {
            console.warn(`${LOG} Release failed: ${e.message}`);
        }
        _sentinel = null;
        console.log(`${LOG} Screen wake lock released`);
    }
}

// modules/phone/chat/chatProgressCard.js — Half-transparent centered overlay
// card shown during long-running chat operations (auto/manual summarize).
//
// Mounted on the phone shell container (#phone_progress_overlay), not the
// chat app DOM, so the card stays visible when the user switches to another
// app while the background task keeps running. This is the core fix for the
// old toast UX, which disappeared as soon as the user left the chat app.
//
// API:
//   const card = openProgressCard({ title });
//   card.setStage('正在估算上下文 …');
//   ... work ...
//   card.complete('压缩完成');   // holds 1.5s then auto-closes
//   card.fail('压缩失败');       // holds 3s then auto-closes
//   card.close();                 // immediate, no terminal text
//
// Singleton semantics: only one card alive at a time. A second openProgressCard
// while one is active will close the existing card first.

const LOG_PREFIX = '[ChatProgressCard]';
const MOUNT_ID = 'phone_progress_overlay';
const TIP_ROTATE_MS = 4000;
const COMPLETE_HOLD_MS = 1500;
const FAIL_HOLD_MS = 3000;
const CLOSE_ANIM_MS = 250;

// Playful sister-circle tips rotated under the stage text. Pure static array
// so we don't pull in extra state. Style guide: no emoji, no he/him, keep it
// warm and a touch silly — matches the workspace voice.
const TIPS = [
    '鬼面戴着老花镜在奋笔疾书',
    '把零散的便签订成厚厚一本',
    '她说慢慢来，中不中？',
    '正在挑恶灵严选小片段',
    '鬼面打了个巨大的喷嚏',
    '鬼面去吃泡面了…还回来吗？',
    '正在折角做记号',
    '在打一份漂亮的目录',
    '把写坏了的的草稿揉成团扔进马桶',
    '鬼面闷了一口二锅头',
    '正在对照旧记录核实细节',
    '哼着歌排版下一页',
    '鬼面真的很讨厌吃蒜苔',
    '小情侣就酱紫黏黏乎乎',
];

let _currentHandle = null;

/**
 * Return the currently open progress card handle, or null. Useful for code
 * that needs to push a stage update from a deeper call site without passing
 * the handle through every layer (e.g. watchdog timer in chatStorage).
 */
export function getCurrentProgressCard() {
    return _currentHandle && _currentHandle.isAlive() ? _currentHandle : null;
}

/**
 * Open a progress card. Returns a handle the caller drives through its
 * lifecycle. If the mount point isn't ready (phone shell not rendered yet),
 * returns a no-op handle so the caller's try/finally chain doesn't blow up.
 */
export function openProgressCard({ title } = {}) {
    const mount = document.getElementById(MOUNT_ID);
    if (!mount) {
        console.warn(`${LOG_PREFIX} mount #${MOUNT_ID} not in DOM, returning no-op handle`);
        return _makeNoopHandle();
    }

    if (_currentHandle && _currentHandle.isAlive()) {
        console.warn(`${LOG_PREFIX} replacing existing card`);
        _currentHandle.close();
    }
    // Defensive: drop any stale DOM nodes from a previous card whose close
    // animation was interrupted (e.g. phone overlay torn down mid-fade).
    mount.querySelectorAll('.phone-progress-card').forEach(el => el.remove());

    const handle = _makeRealHandle(mount, title || '');
    _currentHandle = handle;
    return handle;
}

function _makeNoopHandle() {
    return {
        setStage() {},
        complete() {},
        fail() {},
        close() {},
        isAlive() { return false; },
    };
}

function _makeRealHandle(mount, title) {
    const card = document.createElement('div');
    card.className = 'phone-progress-card';
    card.innerHTML = `
        <div class="phone-progress-card-spinner"><i class="ph ph-circle-notch"></i></div>
        <div class="phone-progress-card-title"></div>
        <div class="phone-progress-card-stage"></div>
        <div class="phone-progress-card-tip"></div>
    `;
    mount.appendChild(card);

    const titleEl = card.querySelector('.phone-progress-card-title');
    const stageEl = card.querySelector('.phone-progress-card-stage');
    const tipEl = card.querySelector('.phone-progress-card-tip');
    const iconEl = card.querySelector('.phone-progress-card-spinner i');
    titleEl.textContent = title;
    stageEl.textContent = '正在准备 …';
    tipEl.textContent = _pickTip();

    requestAnimationFrame(() => card.classList.add('phone-progress-card-visible'));

    let alive = true;
    let closeTimer = null;
    let tipTimer = setInterval(() => {
        if (!alive) return;
        tipEl.textContent = _pickTip();
    }, TIP_ROTATE_MS);

    function _cancelTimers() {
        if (tipTimer) { clearInterval(tipTimer); tipTimer = null; }
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    }

    const handle = {
        setStage(text) {
            if (!alive) return;
            stageEl.textContent = text || '';
            tipEl.textContent = _pickTip();
        },
        complete(text) {
            if (!alive) return;
            card.classList.add('phone-progress-card-success');
            iconEl.className = 'ph ph-check-circle';
            stageEl.textContent = text || '完成';
            tipEl.textContent = '';
            _cancelTimers();
            closeTimer = setTimeout(() => handle.close(), COMPLETE_HOLD_MS);
        },
        fail(text) {
            if (!alive) return;
            card.classList.add('phone-progress-card-error');
            iconEl.className = 'ph ph-x-circle';
            stageEl.textContent = text || '出错了';
            tipEl.textContent = '';
            _cancelTimers();
            closeTimer = setTimeout(() => handle.close(), FAIL_HOLD_MS);
        },
        close() {
            if (!alive) return;
            alive = false;
            _cancelTimers();
            card.classList.remove('phone-progress-card-visible');
            card.classList.add('phone-progress-card-closing');
            setTimeout(() => {
                card.remove();
                if (_currentHandle === handle) _currentHandle = null;
            }, CLOSE_ANIM_MS);
        },
        isAlive() {
            return alive;
        },
    };
    return handle;
}

function _pickTip() {
    return TIPS[Math.floor(Math.random() * TIPS.length)];
}

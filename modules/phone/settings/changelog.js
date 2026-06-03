// Changelog viewer — hand-curated release notes shown on the phone.
//
// Two entry points:
//   - openChangelogPopup()                manual: triggered from settings footer
//   - maybeShowChangelogOnPhoneOpen()     auto: called from openPhone() after version bump
//
// To add a new version's notes, just prepend an entry to RELEASE_NOTES below.
// Version key MUST match manifest.json's `version` field, otherwise the auto
// popup won't fire for that release.

// ═══════════════════════════════════════════════════════════════════════
// Hand-curated release notes — newest entry on top.
// Each entry: { date, sections: [{ title, items: [...] }] }
// - title: shown as the section header (e.g. "新增" / "修复" / "调整")
// - items: each item may include inline HTML tags <strong> <code> <em> <br>
// ═══════════════════════════════════════════════════════════════════════

const RELEASE_NOTES = {
    '4.4.0': {
        date: '2026-06-03',
        sections: [
            {
                title: '上次忘了说',
                items: [
                    '<strong>聊天数据和壁纸搬出 settings.json</strong> —— v4.3.5 起改成独立文件存储，不再挤在公用 settings 里。聊天可以放心写到上万条而不影响 ST 启动速度，单独备份也方便。',
                    '<strong>设置里加了"自管聊天"开关 + 清理（实验）</strong> —— 在「设置 → 聊天历史」里可以切换是否启用自管文件，也能一键清掉某个角色的存档。还在实验阶段，不喜欢可以关掉退回旧模式。',
                    '<strong>聊天背景加载更稳 + 更新检查识别全局/本地安装</strong> —— 网络抖动不再让背景变空白',
                ],
            },
            {
                title: '新增',
                items: [
                    '<strong>聊天设置 · 一个入口聚合所有新功能</strong> —— 聊天右上角的设置按钮现在打开一个完整的二级页，把搜索、收藏、统计、导入导出、查看总结、调可见消息全部聚到一起。',
                    '<strong>聊天内搜索</strong> —— 在当前对话里搜一句话，模糊匹配 + 摘要预览；命中后跳转到该条消息所在位置，如果在已折叠区会自动展开。',
                    '<strong>聊天统计 · 看一段关系的全貌</strong> —— 话痨度、内心戏比、消息时段热力图、高频词、emoji 使用排行。流式扫描，扫到的实时显示进度。',
                    '<strong>聊天导入导出</strong> —— 一键导出当前对话为 JSON 存到本地；导入时确认后覆盖当前对话。',
                    '<strong>查看总结 + 总结历史</strong> —— 现有的总结内容可以直接打开看；每次总结会把旧总结存为历史快照，按时间倒序排列。',
                    '<strong>手动调节可见消息</strong> ，也就是隐藏。',
                    '<strong>消息收藏</strong> ：长按聊天里的任意一条消息，菜单里多了"收藏"项；你对象也会主动收藏消息，记得去偷看ta的手机。',
                    '<strong>ta 的手机</strong> ：首次打开会加载所有的app预览，点击单独的app之后可以进行深度偷看。旧的内容不会丢失，会一直叠加（已考虑过上下文相关问题了）',
                    '<strong>设置页底部加上版本号和更新说明入口</strong> —— 每次手机升级到新版本，打开手机会自动弹一份本次更新摘要；也可以随时从设置页底部点开回看。'
                ],
            },
                        {
                title: '优化',
                items: [
                    '提示词优化 x n',
                ],
            },
        ],
    },
    '4.3.5': {
        date: '2026-06-02',
        sections: [
            {
                title: '修复',
                items: [
                    '观影伴侣相关小问题',
                ],
            },
        ],
    },
    // ── 历史版本示例（要保留就解开） ──
    // '4.3.4': {
    //     date: '2026-05-27',
    //     sections: [
    //         { title: '新增', items: ['…'] },
    //         { title: '修复', items: ['…'] },
    //     ],
    // },
};

const STORAGE_KEY = 'ghostface_changelog_last_seen';

let _cachedManifestVersion = null;

async function fetchManifestVersion() {
    if (_cachedManifestVersion) return _cachedManifestVersion;
    try {
        const url = new URL('../../../manifest.json', import.meta.url).href;
        const resp = await fetch(url, { cache: 'no-cache' });
        if (!resp.ok) return null;
        const data = await resp.json();
        _cachedManifestVersion = typeof data?.version === 'string' ? data.version : null;
        return _cachedManifestVersion;
    } catch {
        return null;
    }
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Re-allow a small set of inline HTML tags after escaping. Safe because
// RELEASE_NOTES is hand-authored in this file (not user input).
function unescapeAllowedTags(html) {
    const allowed = ['br', 'code', 'strong', 'b', 'em', 'i'];
    for (const tag of allowed) {
        const openRe = new RegExp(`&lt;${tag}(?:\\s+[^&]*?)?&gt;`, 'g');
        const closeRe = new RegExp(`&lt;/${tag}&gt;`, 'g');
        html = html.replace(openRe, match => match.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
        html = html.replace(closeRe, `</${tag}>`);
    }
    return html;
}

function transformInline(text) {
    return unescapeAllowedTags(escapeHtml(text));
}

function renderEntryHtml(entry) {
    if (!entry?.sections?.length) {
        return '<div class="phone-changelog-empty">本次没有面向用户的改动说明。</div>';
    }
    return entry.sections.map(section => {
        const itemsHtml = (section.items || [])
            .map(item => `<li>${transformInline(item)}</li>`)
            .join('');
        const titleHtml = section.title
            ? `<h4 class="phone-changelog-group-title">${escapeHtml(section.title)}</h4>`
            : '';
        return `<div class="phone-changelog-group">${titleHtml}<ul class="phone-changelog-list">${itemsHtml}</ul></div>`;
    }).join('');
}

function readSeenVersion() {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

function writeSeenVersion(version) {
    try {
        localStorage.setItem(STORAGE_KEY, version);
    } catch {
        // ignore
    }
}

function buildPopupHtml({ version, date, bodyHtml, isAuto }) {
    const dateLine = date ? `<span class="phone-changelog-date">${escapeHtml(date)}</span>` : '';
    const subtitle = isAuto
        ? '欢迎更新到新版本！这是本次带来的改动。'
        : '当前正在运行的版本带来的改动。';

    return `
        <div class="phone-changelog-modal" id="phone_changelog_modal">
            <div class="phone-changelog-backdrop" data-action="dismiss"></div>
            <div class="phone-changelog-panel" role="dialog" aria-modal="true">
                <div class="phone-changelog-header">
                    <div class="phone-changelog-header-text">
                        <div class="phone-changelog-title">
                            <i class="ph ph-sparkle"></i>
                            <span>v${escapeHtml(version)} 更新说明</span>
                        </div>
                        <div class="phone-changelog-subtitle">
                            ${escapeHtml(subtitle)} ${dateLine}
                        </div>
                    </div>
                    <button class="phone-changelog-close-btn" data-action="dismiss" aria-label="关闭">
                        <i class="ph ph-x"></i>
                    </button>
                </div>
                <div class="phone-changelog-body">
                    ${bodyHtml}
                </div>
                <div class="phone-changelog-footer">
                    <button class="phone-changelog-ack-btn" data-action="dismiss">知道啦</button>
                </div>
            </div>
        </div>
    `;
}

let _activePhoneClosedListener = null;

function attachToPhone(html) {
    const phoneContainer = document.querySelector('.phone-container');
    const host = phoneContainer || document.body;
    const existing = document.getElementById('phone_changelog_modal');
    if (existing) existing.remove();
    host.insertAdjacentHTML('beforeend', html);
    const modal = document.getElementById('phone_changelog_modal');
    requestAnimationFrame(() => modal?.classList.add('visible'));
    modal?.querySelectorAll('[data-action="dismiss"]').forEach(el => {
        el.addEventListener('click', () => closePopup());
    });
    // If the user closes the phone without dismissing, drop the modal so it
    // doesn't reappear next time the overlay becomes visible.
    if (_activePhoneClosedListener) {
        window.removeEventListener('phone-closed', _activePhoneClosedListener);
    }
    _activePhoneClosedListener = () => closePopup();
    window.addEventListener('phone-closed', _activePhoneClosedListener);
}

function closePopup() {
    if (_activePhoneClosedListener) {
        window.removeEventListener('phone-closed', _activePhoneClosedListener);
        _activePhoneClosedListener = null;
    }
    const modal = document.getElementById('phone_changelog_modal');
    if (!modal) return;
    modal.classList.remove('visible');
    setTimeout(() => modal.remove(), 200);
}

// Public: manually open from settings footer.
export async function openChangelogPopup() {
    const version = await fetchManifestVersion();
    if (!version) return;
    const entry = RELEASE_NOTES[version];

    let bodyHtml;
    if (entry) {
        bodyHtml = renderEntryHtml(entry);
    } else {
        bodyHtml = `<div class="phone-changelog-empty">
            这个版本（v${escapeHtml(version)}）的更新说明还没写。
        </div>`;
    }

    attachToPhone(buildPopupHtml({
        version,
        date: entry?.date || '',
        bodyHtml,
        isAuto: false,
    }));
    writeSeenVersion(version);
}

// Public: called from openPhone(). Shows popup only when version actually
// changed since the last time the user opened the phone.
export async function maybeShowChangelogOnPhoneOpen() {
    const version = await fetchManifestVersion();
    if (!version) return;
    const seen = readSeenVersion();

    // First install — record silently, don't dump release notes onto a new user.
    if (!seen) {
        writeSeenVersion(version);
        return;
    }
    if (seen === version) return;

    const entry = RELEASE_NOTES[version];
    if (!entry) {
        // Version changed but no notes for it. Mark seen so we don't keep
        // checking each open, then skip silently.
        writeSeenVersion(version);
        return;
    }

    attachToPhone(buildPopupHtml({
        version,
        date: entry.date,
        bodyHtml: renderEntryHtml(entry),
        isAuto: true,
    }));
    writeSeenVersion(version);
}

// Public: used by the settings footer to render the version label.
export async function getCurrentVersionString() {
    return await fetchManifestVersion();
}

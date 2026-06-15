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
                '4.4.5': {
        date: '2026-06-15',
        sections: [
            {
                title: 'discord小优化',
                items: [
                    '二级菜单唤出效果优化+待发送消息改为竖排',
                ],
            },
        ],
    },
            '4.4.4': {
        date: '2026-06-05',
        sections: [
            {
                title: '修复：prewarm 失败不会反向覆盖数据',
                items: [
                    '聊天文件数据丢失保底',
                ],
            },
        ],
    },
        '4.4.3': {
        date: '2026-06-05',
        sections: [
            {
                title: '本次主题：聊天导出/导入+自动备份',
                items: [
                    '<strong>导出的 JSON 现在和 <code>/user/files/ghostface_chat_*.json</code> 完全是同一份 shape</strong>——也就是说，导出文件就是数据库快照本身。',
                ],
            },
            {
                title: '修复',
                items: [
                    '<strong>原始 <code>ghostface_chat_*.json</code> 文件导入失败</strong>——这次让导入路径同时识别两种 shape，原始文件和导出文件都能导回来。',
                ],
            },
            {
                title: '新增',
                items: [
                    '<strong>手动/自动总结后自动备份</strong>——每次手动/自动总结成功后，浏览器会默默下载一份当前会话的json文件，恢复路径就是普通的"导入聊天文件"。',
                ],
            },
            {
                title: '一些说明',
                items: [
                    '<strong>老备份文件仍然能导入</strong>——v1 / v2 / v3 envelope 格式的 <code>鬼面聊天-*.json</code> 老导出文件，识别路径仍然保留，不会因为这次格式变化失效。',
                    '原始 raw shape 里没有 <code>stSyncMarker</code> 和昵称——前者用来记录"ST 主聊天已吸收到哪条"，后者是 UI 层的本地命名，都不算手机聊天数据本身。从 raw 文件恢复后：下次注入会重新吸收一遍 ST 主聊天（无害，只是多算一次），昵称保持现状不被清空。',
                ],
            },
        ],
    },
    '4.4.2': {
        date: '2026-06-04',
        sections: [
            {
                title: '本次主题：每条消息有了"楼层号"',
                items: [
                    '<strong>每条短信现在有一个稳定的楼层号</strong>：嗯对抄袭了酒馆的逻辑。长按任意一条消息，菜单底部能看到 "楼层 #N"。',
                    '<em>楼层号只在聊天设置页面里出现，聊天气泡上看不到，LLM 也不会读到。</em>',
                ],
            },
            {
                title: '新增',
                items: [
                    '<strong>总结后悔了可以撤回</strong>：进设置 → 查看总结 → 历史总结，每条总结现在显示"覆盖 #X-#Y"，点删除按钮会同时把这段消息恢复成 LLM 可见。再次进入聊天后生效。',
                    '<strong>手动隐藏改成"按范围"</strong> —— 「手动调节可见消息」页换了新 UI：输入"从 #几 到 #几"就能精准隐藏 / 恢复中间任意一段消息。比之前只能"从最旧开始隐藏前 N 条"灵活很多。',
                    '<strong>聊天统计加了"楼层"和"prompt 分解"</strong> —— 统计页能直接看到当前聊天的楼层范围；下一轮 token 估算从原来的两栏，拆成了「系统Prompt（包括角色卡和人设等信息） / ST本体剧情前提 / 世界书可见内容 / 可见短信消息」四栏，能更清楚地看出 token 都花在哪儿。',
                ],
            },
            {
                title: '修复',
                items: [
                    '<strong>聊天备份不再丢"历史总结"</strong>：之前导出 JSON 备份时一直忘记带上"历史总结快照"，恢复后只剩当前总结。这次修了，并且导出格式升到 v3：备份现在带完整的总结历史 + 楼层计数器，恢复后可以无缝接着用"删除总结 → 恢复消息"功能。<br><em>旧版的 v1 / v2 备份依然能正常导入，不会因为格式升级而失效。</em>',
                ],
            },
            {
                title: '一些说明',
                items: [
                    '升级到 v4.4.2 后会自动给现有消息按当前顺序补楼层号（0、1、2、...），无感完成。',
                    '升级<strong>之前</strong>就存在的旧总结条目没有楼层范围信息，会显示"范围未知（旧版总结）"，删除时不会自动恢复消息——这是正常的，新总结从这次升级开始就都带范围了。',
                ],
            },
        ],
    },
    '4.4.1': {
        date: '2026-06-03',
        sections: [
            {
                title: 'V4.4.1小修复',
                items: [
                    '回家按钮/隐藏逻辑。',
                ],
            },
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
                    <a class="phone-changelog-history-link" data-action="open-history" href="javascript:void(0)">点击查看历史版本说明 →</a>
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
    modal?.querySelectorAll('[data-action="open-history"]').forEach(el => {
        el.addEventListener('click', () => openChangelogHistoryPage());
    });
    // If the user closes the phone without dismissing, drop the modal so it
    // doesn't reappear next time the overlay becomes visible.
    if (_activePhoneClosedListener) {
        window.removeEventListener('phone-closed', _activePhoneClosedListener);
    }
    _activePhoneClosedListener = () => {
        closePopup();
        closeHistoryPage();
    };
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

// ═══════════════════════════════════════════════════════════════════════
// History page — full-screen subpage listing every version's notes,
// newest first. Reuses renderEntryHtml so per-section markup stays in sync
// with the main popup.
// ═══════════════════════════════════════════════════════════════════════

function compareVersionsDesc(a, b) {
    const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const diff = (pb[i] || 0) - (pa[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

function renderHistoryBodyHtml(currentVersion) {
    const versions = Object.keys(RELEASE_NOTES).sort(compareVersionsDesc);
    if (!versions.length) {
        return '<div class="phone-changelog-empty">还没有任何历史版本记录。</div>';
    }
    return versions.map(version => {
        const entry = RELEASE_NOTES[version];
        const isCurrent = version === currentVersion;
        const dateLine = entry?.date
            ? `<span class="phone-changelog-date">${escapeHtml(entry.date)}</span>`
            : '';
        const currentBadge = isCurrent
            ? '<span class="phone-changelog-history-current-badge">当前版本</span>'
            : '';
        return `
            <section class="phone-changelog-history-version">
                <header class="phone-changelog-history-version-head">
                    <span class="phone-changelog-history-version-num">v${escapeHtml(version)}</span>
                    ${dateLine}
                    ${currentBadge}
                </header>
                <div class="phone-changelog-history-version-body">
                    ${renderEntryHtml(entry)}
                </div>
            </section>
        `;
    }).join('');
}

function buildHistoryPageHtml(currentVersion) {
    const bodyHtml = renderHistoryBodyHtml(currentVersion);
    return `
        <div class="phone-changelog-history-page" id="phone_changelog_history_page" role="dialog" aria-modal="true">
            <div class="phone-changelog-history-header">
                <button class="phone-changelog-history-back-btn" data-action="history-back" aria-label="返回">
                    <i class="ph ph-arrow-left"></i>
                </button>
                <div class="phone-changelog-history-title">
                    <i class="ph ph-clock-counter-clockwise"></i>
                    <span>历史版本说明</span>
                </div>
            </div>
            <div class="phone-changelog-history-body">
                ${bodyHtml}
            </div>
        </div>
    `;
}

// Public: open the full-screen history subpage (triggered from popup footer
// link or, optionally, from anywhere else in the future).
export async function openChangelogHistoryPage() {
    const version = await fetchManifestVersion();
    const phoneContainer = document.querySelector('.phone-container');
    const host = phoneContainer || document.body;
    const existing = document.getElementById('phone_changelog_history_page');
    if (existing) existing.remove();
    host.insertAdjacentHTML('beforeend', buildHistoryPageHtml(version || ''));
    const page = document.getElementById('phone_changelog_history_page');
    requestAnimationFrame(() => page?.classList.add('visible'));
    page?.querySelectorAll('[data-action="history-back"]').forEach(el => {
        el.addEventListener('click', () => closeHistoryPage());
    });
}

function closeHistoryPage() {
    const page = document.getElementById('phone_changelog_history_page');
    if (!page) return;
    page.classList.remove('visible');
    setTimeout(() => page.remove(), 220);
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

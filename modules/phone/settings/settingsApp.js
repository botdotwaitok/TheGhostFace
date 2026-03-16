// ui/phone/settings/settingsApp.js — Settings app for the GF Phone
// iPhone-style layout: top profile card → account detail page → module settings

import { getSttEngine } from '../voiceCall/sttInit.js';
import { getTtsEngine } from '../voiceCall/tts/ttsInit.js';

import { openAppInViewport } from '../phoneController.js';
import { escapeHtml } from '../utils/helpers.js';
import { isConsoleEnabled, setConsoleEnabled, openConsoleApp } from '../console/consoleApp.js';
import { getConfig as getAutoMsgConfig, saveConfig as saveAutoMsgConfig, startAutoMessageTimer, stopAutoMessageTimer, formatIntervalLabel } from '../chat/autoMessage.js';
import { isDiaryEnabled, getDiaryMode, setDiaryEnabled, setDiaryMode } from '../diary/diaryApp.js';
import {
    populateSettings, saveSettingsFromUI, toggleEnable, updateToggleBtn,
    onClick, bindSlider, showToast, getVal
} from '../moments/momentsUI.js';
import * as moments from '../moments/moments.js';
import { loadTreeData, getTreeState, updateTreeState, updateTreeSettings } from '../tree/treeStorage.js';
import { disableTreeWorldInfo, updateTreeWorldInfo } from '../tree/treeWorldInfo.js';
import { updateCalendarWorldInfo, disableCalendarWorldInfo } from '../calendar/calendarWorldInfo.js';
import { loadWISettings, saveWISettings } from '../calendar/calendarStorage.js';
import { getCurrentSeason, getStageByGrowth } from '../tree/treeConfig.js';
import { getPhoneCharInfo, getPhoneUserName } from '../phoneContext.js';
import { getAllActiveWorldBookNames, getAllActiveEntries } from '../../worldbookManager.js';
import { loadCallLogs } from '../voiceCall/vcStorage.js';
import { loadChatHistory } from '../chat/chatStorage.js';
import {
    isBookBlockedInScope, isEntryBlockedInScope,
    toggleBookBlock, toggleEntryBlock
} from './wbBlacklist.js';
import {
    getCurrentRingtone, clearRingtoneSelection,
    runSelectionFlow, playRingtone, stopRingtone, isRingtonePlaying,
    uploadUserRingtone
} from '../voiceCall/ringtoneManager.js';
import {
    isAmbientEnabled, setAmbientEnabled, getAmbientInfo,
    initAmbient, uploadUserAmbient, clearUserAmbient,
    startAmbient, stopAmbient, isAmbientPlaying
} from '../voiceCall/ambientManager.js';

// ═══════════════════════════════════════════════════════════════════════
// Discord Binding Section (reused in account detail page)
// ═══════════════════════════════════════════════════════════════════════

async function renderDiscordBindSection(P) {
    const container = document.getElementById(`${P}_discord_bind_section`);
    if (!container) return;

    let discordId = null;
    try {
        const s = moments.getSettings();
        if (s.authToken && s.backendUrl && s.userId) {
            try {
                const discordResult = await moments.apiRequest('GET', `/api/users/${s.userId}/discord`);
                discordId = discordResult?.discordId || discordResult?.discord_id || discordResult?.id || null;
            } catch (e1) {
                try {
                    const profileResult = await moments.apiRequest('GET', `/api/users/${s.userId}`);
                    const user = profileResult?.user || profileResult;
                    discordId = user?.discordId || user?.discord_id || user?.discordUserId || null;
                } catch (e2) { /* silent */ }
            }
        }
    } catch (e) { /* silent */ }

    if (discordId) {
        container.innerHTML = `
            <div class="phone-settings-row" style="justify-content: center; padding: 12px 0;">
                <div style="display: flex; align-items: center; gap: 8px; padding: 8px 18px; border-radius: 20px; background: rgba(72, 199, 142, 0.13); border: 1px solid rgba(72, 199, 142, 0.3);">
                    <i class="fa-solid fa-circle-check" style="color: #48C78E; font-size: 18px;"></i>
                    <span style="color: #48C78E; font-weight: 600; font-size: 14px;">已绑定 Discord</span>
                </div>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="phone-settings-row">
                <label>绑定码（在 Discord 输入 /绑定码 获取）</label>
                <div class="phone-settings-id-row">
                    <input id="${P}_bind_code" type="text" class="phone-settings-input"
                           placeholder="输入6位绑定码" maxlength="6"
                           style="text-transform: uppercase; letter-spacing: 2px; font-weight: 700; font-size: 16px; text-align: center;" />
                    <button id="${P}_bind_discord_btn" class="phone-settings-small-btn phone-settings-btn-primary" title="绑定"><i class="fa-solid fa-link"></i></button>
                </div>
            </div>
        `;

        onClick(`${P}_bind_discord_btn`, async () => {
            const input = document.getElementById(`${P}_bind_code`);
            const code = input?.value?.trim().toUpperCase();
            if (!code) return showToast('请输入绑定码');
            if (!/^[A-Z0-9]{6}$/.test(code)) return showToast('绑定码格式不正确（6位字母数字）');
            try {
                await moments.bindDiscordByCode(code);
                showToast('绑定成功！');
                if (input) input.value = '';
                renderDiscordBindSection(P);
            } catch (e) {
                showToast('绑定失败: ' + (e.message || '未知错误'));
            }
        });
    }
}

// escapeHtml is now imported from '../utils/helpers.js'

// ═══════════════════════════════════════════════════════════════════════
// Account Detail Page (opened when tapping the profile card)
// ═══════════════════════════════════════════════════════════════════════

let _globalSettingsEventsBound = false;

function bindSettingsGlobalEvents() {
    if (_globalSettingsEventsBound) return;
    _globalSettingsEventsBound = true;
    window.addEventListener('phone-app-back', (e) => {
        const accountSection = document.getElementById('phone_account_auth_container');
        if (accountSection) {
            e.preventDefault();
            openSettingsApp();
        }
    });
}

function openAccountDetailPage() {
    bindSettingsGlobalEvents();
    const P = 'phone_account';
    const s = moments.getSettings();
    const isLoggedIn = !!s.authToken;

    // Build the detail page HTML
    const html = `
    <div class="phone-settings-page">
        <!-- ═══ Server Connection (always on top) ═══ -->
        <div class="phone-settings-section phone-settings-account-card">
            <div class="phone-settings-section-body" style="padding: 16px;">
                <div class="phone-settings-group-title" style="margin-top: 0;">服务器连接</div>
                <div class="phone-settings-row">
                    <label>后端地址 (Backend URL)</label>
                    <input id="${P}_backend_url" type="text" class="phone-settings-input" placeholder="https://api.entity.li" />
                </div>
                <div class="phone-settings-row">
                    <label>密钥 (Secret Token)</label>
                    <input id="${P}_secret_token" type="password" class="phone-settings-input" placeholder="your-secret-token" />
                </div>
            </div>
        </div>

        <!-- ═══ Auth / Profile Section ═══ -->
        <div class="phone-settings-section phone-settings-account-card">
            <div class="phone-settings-section-body" style="padding: 16px;">
                <div id="${P}_auth_container" class="moments-auth-container"></div>
            </div>
        </div>

        <!-- ═══ Your ID (only when logged in) ═══ -->
        <div id="${P}_id_section" class="phone-settings-section phone-settings-account-card" ${isLoggedIn ? '' : 'style="display: none;"'}>
            <div class="phone-settings-section-body" style="padding: 16px;">
                <div class="phone-settings-row">
                    <label>你的ID（复制给好友）</label>
                    <div class="phone-settings-id-row">
                        <input id="${P}_user_id" type="text" class="phone-settings-input phone-settings-id-input" readonly />
                        <button id="${P}_copy_id_btn" class="phone-settings-small-btn" title="复制"><i class="fa-solid fa-copy"></i></button>
                    </div>
                </div>
            </div>
        </div>

        <!-- ═══ Discord Binding (only when logged in) ═══ -->
        <div id="${P}_discord_section" class="phone-settings-section phone-settings-account-card" ${isLoggedIn ? '' : 'style="display: none;"'}>
            <div class="phone-settings-section-body" style="padding: 16px;">
                <div class="phone-settings-group-title" style="margin-top: 0;">Discord 绑定</div>
                <div id="${P}_discord_bind_section">
                    <div class="phone-settings-row" style="justify-content: center;">
                        <span style="opacity: 0.5; font-size: 13px;">加载中...</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- ═══ Logout (only when logged in) ═══ -->
        <div id="${P}_logout_section" ${isLoggedIn ? '' : 'style="display: none;"'}>
            <button id="${P}_logout_btn" class="phone-settings-btn phone-settings-logout-btn">
                退出登录
            </button>
        </div>
    </div>
    `;

    openAppInViewport('账号', html, async () => {
        // Populate backend URL & secret token
        const settings = moments.getSettings();
        const backendUrlInput = document.getElementById(`${P}_backend_url`);
        const secretTokenInput = document.getElementById(`${P}_secret_token`);
        if (backendUrlInput) backendUrlInput.value = settings.backendUrl || '';
        if (secretTokenInput) secretTokenInput.value = settings.secretToken || '';

        // Auto-save backend URL & Secret Token on blur
        if (backendUrlInput) {
            backendUrlInput.addEventListener('change', () => {
                moments.updateSettings({ backendUrl: backendUrlInput.value.trim() });
                showToast('后端地址已保存');
            });
        }
        if (secretTokenInput) {
            secretTokenInput.addEventListener('change', () => {
                moments.updateSettings({ secretToken: secretTokenInput.value.trim() });
                showToast('密钥已保存');
            });
        }

        // Populate user ID
        const userIdInput = document.getElementById(`${P}_user_id`);
        if (userIdInput) userIdInput.value = settings.userId || '';

        // Bind copy ID
        onClick(`${P}_copy_id_btn`, () => {
            const id = getVal(`${P}_user_id`);
            navigator.clipboard?.writeText(id).then(() => showToast('ID已复制 📋'));
        });

        // Render auth/profile section
        renderAccountAuth(P);

        // Discord binding (only if logged in)
        if (settings.authToken) {
            renderDiscordBindSection(P);
        }

        // Logout
        onClick(`${P}_logout_btn`, () => {
            if (confirm('确定退出登录?')) {
                moments.logout();
                showToast('已退出登录');
                // Re-open the account page to show login form
                openAccountDetailPage();
            }
        });
    });
}

/**
 * Render the auth/profile section inside the account detail page.
 * If logged in: show profile card (avatar + name + edit).
 * If not logged in: show login/register form.
 */
function renderAccountAuth(prefix = 'phone_account') {
    const container = document.getElementById(`${prefix}_auth_container`);
    if (!container) return;

    const s = moments.getSettings();

    if (s.authToken && s.discordBound === false) {
        // ── Logged in but Discord not bound: force binding step ──
        renderDiscordBindStep(container, prefix);
        return;
    }

    if (s.authToken) {
        // ── Logged in: Show profile card ──
        container.innerHTML = `
            <div class="moments-profile-card">
                <div class="moments-profile-info">
                    <div class="moments-profile-avatar" id="${prefix}_avatar_wrapper" style="cursor: pointer; position: relative;" title="更换头像">
                        ${s.avatarUrl ? `<img src="${s.avatarUrl}" />` : `<div class="moments-avatar-placeholder" style="width:100%; height:100%;">${(s.displayName || 'U')[0]}</div>`}
                        <input type="file" id="${prefix}_avatar_input" accept="image/*" style="display:none;" />
                    </div>
                    <div class="moments-profile-text">
                        <div class="moments-profile-name" id="${prefix}_name_display" style="cursor: pointer;" title="修改名称">
                            ${escapeHtml(s.displayName || 'User')} <i class="fa-solid fa-pen-to-square" style="font-size: 0.8em; opacity: 0.6; margin-left: 4px;"></i>
                        </div>
                        <div class="moments-profile-id">@${s.username || ''}</div>
                    </div>
                </div>
            </div>
        `;

        // Bind Edit Name
        const nameEl = document.getElementById(`${prefix}_name_display`);
        if (nameEl) {
            nameEl.addEventListener('click', async () => {
                const currentName = s.displayName || '';
                const newName = prompt('请输入新的显示名称:', currentName);
                if (newName !== null && newName.trim() !== '' && newName.trim() !== currentName) {
                    const trimmedName = newName.trim();
                    moments.updateSettings({ displayName: trimmedName });
                    if (s.enabled && s.backendUrl) {
                        try {
                            await moments.registerUser();
                            showToast('名称已更新');
                        } catch (e) {
                            showToast('名称同步失败');
                        }
                    } else {
                        showToast('名称本地已更新（未连接服务器）');
                    }
                    renderAccountAuth(prefix);
                }
            });
        }

        // Bind Avatar Upload
        const avatarWrapper = document.getElementById(`${prefix}_avatar_wrapper`);
        const avatarInput = document.getElementById(`${prefix}_avatar_input`);
        if (avatarWrapper && avatarInput) {
            avatarWrapper.addEventListener('click', (e) => {
                if (e.target !== avatarInput) avatarInput.click();
            });

            avatarInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                if (file.size > 2 * 1024 * 1024) {
                    showToast('头像图片太大 (最大 2MB)');
                    e.target.value = '';
                    return;
                }
                const reader = new FileReader();
                reader.onload = async (evt) => {
                    const base64 = evt.target.result;
                    moments.updateSettings({ avatarUrl: base64 });
                    if (s.enabled && s.backendUrl) {
                        try {
                            await moments.registerUser();
                            showToast('头像已同步更新');
                        } catch (e) {
                            showToast('头像同步失败');
                        }
                    } else {
                        showToast('头像本地已更新（未连接服务器）');
                    }
                    renderAccountAuth(prefix);
                };
                reader.readAsDataURL(file);
            });
        }
    } else {
        // ── Not logged in: Show login/register form ──
        renderAccountAuthForm(container, 'login', prefix);
    }
}

/**
 * Render the login/register form inside the account detail page.
 */
function renderAccountAuthForm(container, mode = 'login', prefix = 'phone_account') {
    const isLogin = mode === 'login';
    container.innerHTML = `
        <div class="moments-auth-switch">
            <button class="moments-auth-tab ${isLogin ? 'active' : ''}" data-mode="login">登录</button>
            <button class="moments-auth-tab ${!isLogin ? 'active' : ''}" data-mode="register">注册</button>
        </div>
        <div class="moments-auth-form">
            ${!isLogin ? `
            <div class="moments-form-group">
                <input type="text" id="${prefix}_auth_username" class="moments-input" placeholder="用户名 (ID)">
            </div>
            <div class="moments-form-group">
                <input type="text" id="${prefix}_auth_displayname" class="moments-input" placeholder="显示名称">
            </div>
            ` : `
            <div class="moments-form-group">
                <input type="text" id="${prefix}_auth_username" class="moments-input" placeholder="用户名">
            </div>
            `}
            <div class="moments-form-group">
                <input type="password" id="${prefix}_auth_password" class="moments-input" placeholder="密码">
            </div>
            <div id="${prefix}_auth_error" class="moments-error-msg"></div>
            <button id="${prefix}_auth_submit" class="moments-btn moments-btn-primary" style="width:100%">
                ${isLogin ? '登录' : '注册'}
            </button>
        </div>
    `;

    // Bind Tabs
    container.querySelectorAll('.moments-auth-tab').forEach(btn => {
        btn.addEventListener('click', () => renderAccountAuthForm(container, btn.dataset.mode, prefix));
    });

    // Bind Submit
    document.getElementById(`${prefix}_auth_submit`)?.addEventListener('click', async () => {
        const btn = document.getElementById(`${prefix}_auth_submit`);
        const errEl = document.getElementById(`${prefix}_auth_error`);
        const u = document.getElementById(`${prefix}_auth_username`)?.value?.trim();
        const p = document.getElementById(`${prefix}_auth_password`)?.value?.trim();
        const n = document.getElementById(`${prefix}_auth_displayname`)?.value?.trim();

        if (errEl) errEl.textContent = '';
        if (!u || !p) { if (errEl) errEl.textContent = '请输入用户名和密码'; return; }
        if (!isLogin && !n) { if (errEl) errEl.textContent = '请输入显示名称'; return; }

        // Check that backend URL is configured
        const currentSettings = moments.getSettings();
        if (!currentSettings.backendUrl) {
            if (errEl) errEl.textContent = '请先在上方填写后端地址';
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

        try {
            if (isLogin) {
                const result = await moments.login(u, p);
                if (!result.discordBound) {
                    // Discord not bound — show binding step
                    showToast('登录成功，请绑定 Discord');
                    renderDiscordBindStep(container, prefix);
                } else {
                    showToast('登录成功! 🎉');
                    openAccountDetailPage();
                }
            } else {
                const result = await moments.register(u, p, n);
                // Registration always requires Discord binding
                showToast('注册成功，请绑定 Discord');
                renderDiscordBindStep(container, prefix);
            }
        } catch (e) {
            if (errEl) errEl.textContent = e.message;
            btn.disabled = false;
            btn.textContent = isLogin ? '登录' : '注册';
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Discord Binding Step (mandatory after register / login without binding)
// ═══════════════════════════════════════════════════════════════════════

function renderDiscordBindStep(container, prefix = 'phone_account') {
    container.innerHTML = `
        <div style="text-align: center; padding: 20px 0 8px;">
            <div style="width: 60px; height: 60px; border-radius: 50%; background: linear-gradient(135deg, #5865F2, #7289DA); display: flex; align-items: center; justify-content: center; margin: 0 auto 12px;">
                <i class="fa-brands fa-discord" style="font-size: 28px; color: #fff;"></i>
            </div>
            <div class="phone-settings-discord-title">绑定 Discord 账号</div>
            <div class="phone-settings-discord-desc">
                为了保护服务器安全，注册需要绑定 Discord 账号。<br>
                请在 Discord 中输入 <b style="color: #5865F2;">/绑定码</b> 获取 6 位验证码。
            </div>
        </div>
        <div class="moments-auth-form" style="margin-top: 12px;">
            <div class="moments-form-group">
                <input type="text" id="${prefix}_discord_code" class="moments-input"
                       placeholder="输入 6 位绑定码" maxlength="6"
                       style="text-transform: uppercase; letter-spacing: 3px; font-weight: 700; font-size: 20px; text-align: center;" />
            </div>
            <div id="${prefix}_discord_error" class="moments-error-msg"></div>
            <button id="${prefix}_discord_submit" class="moments-btn moments-btn-primary" style="width:100%; background: linear-gradient(135deg, #5865F2, #7289DA); border: none;">
                <i class="fa-brands fa-discord" style="margin-right: 6px;"></i>验证并绑定
            </button>
        </div>
    `;

    document.getElementById(`${prefix}_discord_submit`)?.addEventListener('click', async () => {
        const btn = document.getElementById(`${prefix}_discord_submit`);
        const errEl = document.getElementById(`${prefix}_discord_error`);
        const input = document.getElementById(`${prefix}_discord_code`);
        const code = input?.value?.trim().toUpperCase();

        if (errEl) errEl.textContent = '';
        if (!code) { if (errEl) errEl.textContent = '请输入绑定码'; return; }
        if (!/^[A-Z0-9]{6}$/.test(code)) { if (errEl) errEl.textContent = '绑定码格式不正确（6位字母数字）'; return; }

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 验证中...';

        try {
            await moments.bindDiscordByCode(code);
            moments.updateSettings({ discordBound: true });
            showToast('绑定成功，欢迎! 🎉🔗');
            openAccountDetailPage();
        } catch (e) {
            if (errEl) errEl.textContent = e.message || '绑定失败';
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-brands fa-discord" style="margin-right: 6px;"></i>验证并绑定';
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Top-level Profile Card (shown at the top of Settings page)
// ═══════════════════════════════════════════════════════════════════════

function buildProfileCardHtml() {
    const s = moments.getSettings();

    if (s.authToken) {
        // Logged in — show avatar + name + chevron
        const avatarHtml = s.avatarUrl
            ? `<img src="${s.avatarUrl}" style="width: 60px; height: 60px; border-radius: 50%; object-fit: cover;" />`
            : `<div style="width: 60px; height: 60px; border-radius: 50%; background: linear-gradient(135deg, #667EEA, #764BA2); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 24px; font-weight: 600;">${(s.displayName || 'U')[0]}</div>`;

        return `
        <div class="phone-settings-profile-card" id="phone_settings_profile_card">
            <div style="display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0;">
                <div style="flex-shrink: 0;">${avatarHtml}</div>
                <div style="min-width: 0;">
                    <div class="phone-settings-profile-card-name">
                        ${escapeHtml(s.displayName || 'User')}
                    </div>
                    <div class="phone-settings-profile-card-sub">
                        @${escapeHtml(s.username || '')}
                    </div>
                </div>
            </div>
            <i class="fa-solid fa-chevron-right" style="color: #c7c7cc; font-size: 14px; flex-shrink: 0;"></i>
        </div>
        `;
    } else {
        // Not logged in — placeholder card
        return `
        <div class="phone-settings-profile-card phone-settings-profile-card-placeholder" id="phone_settings_profile_card">
            <div style="display: flex; align-items: center; gap: 14px; flex: 1;">
                <div style="width: 60px; height: 60px; border-radius: 50%; background: rgba(120, 120, 128, 0.12); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <i class="fa-solid fa-user" style="font-size: 24px; color: #c7c7cc;"></i>
                </div>
                <div>
                    <div class="phone-settings-profile-card-name">登录 / 注册</div>
                    <div class="phone-settings-profile-card-sub">点击管理你的账号</div>
                </div>
            </div>
            <i class="fa-solid fa-chevron-right" style="color: #c7c7cc; font-size: 14px; flex-shrink: 0;"></i>
        </div>
        `;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// World Book Blacklist — Dynamic render helper
// ═══════════════════════════════════════════════════════════════════════

/**
 * Render the world book blacklist panel into the list container.
 * Called when the section is expanded or when the scope tab changes.
 * @param {string} P - Settings prefix
 * @param {'global'|'char'} scope
 */
async function renderWbBlacklist(P, scope) {
    const container = document.getElementById(`${P}_wb_bl_list`);
    if (!container) return;

    // Lock height to prevent page jitter during async reload
    const prevHeight = container.offsetHeight;
    if (prevHeight > 0) container.style.minHeight = `${prevHeight}px`;

    container.innerHTML = `<div style="text-align: center; padding: 20px; color: #8e8e93; font-size: 13px;">
        <i class="fa-solid fa-spinner fa-spin"></i> 加载世界书...
    </div>`;

    try {
        const bookNames = await getAllActiveWorldBookNames();
        if (!bookNames || bookNames.length === 0) {
            container.innerHTML = `<div style="text-align: center; padding: 20px; color: #8e8e93; font-size: 13px;">
                当前没有激活的世界书
            </div>`;
            return;
        }

        // Load all entries grouped by book
        const bookEntries = {};
        for (const bookName of bookNames) {
            try {
                const entries = await getAllActiveEntries([bookName]);
                bookEntries[bookName] = entries.filter(e => e && (e.comment || '').trim());
            } catch { bookEntries[bookName] = []; }
        }

        // Build HTML
        let html = '';
        for (const bookName of bookNames) {
            const isBlocked = isBookBlockedInScope(bookName, scope);
            const entries = bookEntries[bookName] || [];
            const entryCount = entries.length;
            const blockedEntryCount = entries.filter(e =>
                isEntryBlockedInScope(bookName, (e.comment || '').trim(), scope)
            ).length;

            const bookId = `${P}_wb_bl_book_${_hashStr(bookName)}`;

            html += `<div class="phone-wb-bl-book" data-book="${escapeHtml(bookName)}">
                <div class="phone-wb-bl-book-header">
                    <div class="phone-wb-bl-book-info">
                        <button class="phone-wb-bl-expand-btn" id="${bookId}_expand" title="展开条目">
                            <i class="fa-solid fa-chevron-right"></i>
                        </button>
                        <div class="phone-wb-bl-book-meta">
                            <span class="phone-wb-bl-book-name">${escapeHtml(bookName)}</span>
                            <span class="phone-wb-bl-book-count">${entryCount} 条${blockedEntryCount > 0 ? ` · <span style="color: #FF6B6B;">${blockedEntryCount} 已屏蔽</span>` : ''}</span>
                        </div>
                    </div>
                    <button class="phone-settings-ios-toggle ${isBlocked ? 'active blocked' : ''}"
                            id="${bookId}_toggle" aria-checked="${isBlocked}" title="${isBlocked ? '已屏蔽整本' : '点击屏蔽整本'}">
                        <span class="phone-settings-ios-toggle-knob"></span>
                    </button>
                </div>
                <div class="phone-wb-bl-entries" id="${bookId}_entries" style="display: none;">
                    ${entries.length === 0 ? '<div style="padding: 8px 16px; color: #8e8e93; font-size: 12px;">无条目</div>' : ''}
                    ${entries.map(entry => {
                const comment = (entry.comment || '').trim();
                if (!comment) return '';
                const entryBlocked = isEntryBlockedInScope(bookName, comment, scope);
                const isDisabled = !!entry.disable;
                const entryId = `${bookId}_e_${_hashStr(comment)}`;
                return `<label class="phone-wb-bl-entry ${isDisabled ? 'disabled' : ''} ${entryBlocked ? 'blocked' : ''}" for="${entryId}">
                            <input type="checkbox" id="${entryId}" ${entryBlocked ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}
                                   data-book="${escapeHtml(bookName)}" data-comment="${escapeHtml(comment)}" />
                            <span class="phone-wb-bl-entry-name">${escapeHtml(comment)}</span>
                            ${isDisabled ? '<span class="phone-wb-bl-entry-badge">已禁用</span>' : ''}
                        </label>`;
            }).join('')}
                </div>
            </div>`;
        }

        container.innerHTML = html;
        container.style.minHeight = ''; // Release height lock

        // Bind events
        for (const bookName of bookNames) {
            const bookId = `${P}_wb_bl_book_${_hashStr(bookName)}`;

            // Toggle whole book
            const toggle = document.getElementById(`${bookId}_toggle`);
            toggle?.addEventListener('click', () => {
                toggleBookBlock(bookName, scope);
                const nowBlocked = isBookBlockedInScope(bookName, scope);
                toggle.setAttribute('aria-checked', String(nowBlocked));
                toggle.classList.toggle('active', nowBlocked);
                toggle.classList.toggle('blocked', nowBlocked);
                showToast(nowBlocked ? `已屏蔽: ${bookName}` : `已取消屏蔽: ${bookName}`);
            });

            // Expand/collapse entries
            const expandBtn = document.getElementById(`${bookId}_expand`);
            const entriesDiv = document.getElementById(`${bookId}_entries`);
            expandBtn?.addEventListener('click', () => {
                const isOpen = entriesDiv.style.display !== 'none';
                entriesDiv.style.display = isOpen ? 'none' : 'block';
                expandBtn.querySelector('i').style.transform = isOpen ? '' : 'rotate(90deg)';
            });

            // Entry checkboxes
            const checkboxes = entriesDiv?.querySelectorAll('input[type="checkbox"]');
            checkboxes?.forEach(cb => {
                cb.addEventListener('change', () => {
                    const bk = cb.dataset.book;
                    const cm = cb.dataset.comment;
                    toggleEntryBlock(bk, cm, scope);
                    cb.parentElement.classList.toggle('blocked', cb.checked);
                    // Update counter in header (without re-rendering the whole list)
                    const bookEl = cb.closest('.phone-wb-bl-book');
                    if (bookEl) {
                        const allCbs = bookEl.querySelectorAll('.phone-wb-bl-entries input[type="checkbox"]:checked');
                        const countEl = bookEl.querySelector('.phone-wb-bl-book-count');
                        const totalEntries = bookEl.querySelectorAll('.phone-wb-bl-entries input[type="checkbox"]').length;
                        const blockedCount = allCbs.length;
                        countEl.innerHTML = `${totalEntries} 条${blockedCount > 0 ? ` · <span style="color: #FF6B6B;">${blockedCount} 已屏蔽</span>` : ''}`;
                    }
                });
            });
        }
    } catch (e) {
        console.warn('[Settings] renderWbBlacklist failed:', e);
        container.innerHTML = `<div style="text-align: center; padding: 20px; color: #FF6B6B; font-size: 13px;">
            加载失败: ${e.message || '未知错误'}
        </div>`;
    }
}

/** Simple string hash for generating unique DOM IDs */
function _hashStr(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
}

// ═══════════════════════════════════════════════════════════════════════
// Main Settings Page
// ═══════════════════════════════════════════════════════════════════════

export function openSettingsApp() {
    const P = 'phone_settings'; // prefix for unique IDs
    const html = `
    <div class="phone-settings-page">
        <!-- ═══ Top Profile Card (iPhone-style) ═══ -->
        <div id="phone_settings_profile_card_container">
            ${buildProfileCardHtml()}
        </div>

        <!-- ═══ 朋友圈设置 (Moments Settings) — only nickname, automation, enable ═══ -->
        <details class="phone-settings-section">
            <summary class="phone-settings-section-header">
                <span class="phone-settings-section-icon" style="background: linear-gradient(135deg, #FF6B9D, #C44569);"><i class="fa-solid fa-camera-retro"></i></span>
                <span>朋友圈</span>
                <i class="fa-solid fa-chevron-down phone-settings-chevron"></i>
            </summary>
            <div class="phone-settings-section-body">

                <div class="phone-settings-group-title">网名设置</div>
                <div class="phone-settings-row">
                    <label>你的网名</label>
                    <input id="${P}_custom_user_name" type="text" class="phone-settings-input" placeholder="留空则显示用户名" />
                </div>
                <div class="phone-settings-row">
                    <label>当前角色网名</label>
                    <input id="${P}_custom_char_name" type="text" class="phone-settings-input" placeholder="留空则显示角色原名" />
                </div>

                <div class="phone-settings-group-title">自动化设置</div>
                <div class="phone-settings-row">
                    <label>发帖概率</label>
                    <div class="phone-settings-slider-row">
                        <input id="${P}_auto_post_chance" type="range" min="0" max="100" step="5" class="phone-settings-slider" />
                        <span id="${P}_auto_post_chance_val" class="phone-settings-slider-val">80%</span>
                    </div>
                </div>
                <div class="phone-settings-row">
                    <label>评论概率</label>
                    <div class="phone-settings-slider-row">
                        <input id="${P}_auto_comment_chance" type="range" min="0" max="100" step="5" class="phone-settings-slider" />
                        <span id="${P}_auto_comment_chance_val" class="phone-settings-slider-val">30%</span>
                    </div>
                </div>
                <div class="phone-settings-row">
                    <label>点赞概率</label>
                    <div class="phone-settings-slider-row">
                        <input id="${P}_auto_like_chance" type="range" min="0" max="100" step="5" class="phone-settings-slider" />
                        <span id="${P}_auto_like_chance_val" class="phone-settings-slider-val">80%</span>
                    </div>
                </div>

                <div class="phone-settings-actions">
                    <button id="${P}_save_settings_btn" class="phone-settings-btn phone-settings-btn-primary">保存设置</button>
                    <button id="${P}_toggle_enable_btn" class="phone-settings-btn phone-settings-btn-toggle">启用朋友圈</button>
                </div>
            </div>
        </details>

        <!-- ═══ 日记本设置 (Diary Settings) ═══ -->
        <details class="phone-settings-section">
            <summary class="phone-settings-section-header">
                <span class="phone-settings-section-icon" style="background: linear-gradient(135deg, #F6D365, #FDA085);"><i class="fa-solid fa-book-open"></i></span>
                <span>日记本</span>
                <i class="fa-solid fa-chevron-down phone-settings-chevron"></i>
            </summary>
            <div class="phone-settings-section-body">

                <div class="phone-settings-row">
                    <div class="phone-settings-toggle-row">
                        <span class="phone-settings-toggle-label">启用日记本</span>
                        <button id="${P}_diary_enable_toggle" class="phone-settings-ios-toggle" aria-checked="false">
                            <span class="phone-settings-ios-toggle-knob"></span>
                        </button>
                    </div>
                </div>

                <div class="phone-settings-group-title">日记生成模式</div>
                <div class="phone-settings-row" style="flex-direction: column; gap: 8px;">
                    <div class="phone-settings-mode-card" data-diary-mode="manual" id="${P}_diary_mode_manual">
                        <div class="phone-settings-mode-card-header">
                            <span class="phone-settings-mode-card-title">手动模式</span>
                            <span class="phone-settings-mode-card-badge">推荐·省Token</span>
                        </div>
                        <div class="phone-settings-mode-card-desc">你写一条日记，你对象回应一条。不消耗额外 Token。</div>
                    </div>
                    <div class="phone-settings-mode-card" data-diary-mode="auto" id="${P}_diary_mode_auto">
                        <div class="phone-settings-mode-card-header">
                            <span class="phone-settings-mode-card-title">自动模式</span>
                            <span class="phone-settings-mode-card-badge" style="background: rgba(255,107,157,0.15); color: #FF6B9D;">消耗更多Token</span>
                        </div>
                        <div class="phone-settings-mode-card-desc">日记内容持续注入世界书，你对象有几率主动写日记回应。</div>
                    </div>
                </div>

            </div>
        </details>

        <!-- ═══ 树树设置 (Tree Settings) ═══ -->
        <details class="phone-settings-section">
            <summary class="phone-settings-section-header">
                <span class="phone-settings-section-icon" style="background: linear-gradient(135deg, #A8E063, #56AB2F);"><i class="fa-solid fa-leaf"></i></span>
                <span>树树</span>
                <i class="fa-solid fa-chevron-down phone-settings-chevron"></i>
            </summary>
            <div class="phone-settings-section-body">

                <div class="phone-settings-row">
                    <div class="phone-settings-toggle-row">
                        <span class="phone-settings-toggle-label"></i>世界书条目注入</span>
                        <button id="${P}_tree_wb_toggle" class="phone-settings-ios-toggle" aria-checked="false">
                            <span class="phone-settings-ios-toggle-knob"></span>
                        </button>
                    </div>
                </div>

                <div class="phone-settings-actions">
                    <button id="${P}_tree_rename_btn" class="phone-settings-btn phone-settings-btn-primary">修改树名</button>
                    <button id="${P}_tree_regen_btn" class="phone-settings-btn" style="background: rgba(45, 147, 108, 0.1); color: #2d936c; border: none;">重新生成内容</button>
                </div>

            </div>
        </details>

        <!-- ═══ 日历设置 (Calendar Settings) ═══ -->
        <details class="phone-settings-section">
            <summary class="phone-settings-section-header">
                <span class="phone-settings-section-icon" style="background: linear-gradient(135deg, #5B9BD5, #3A7BD5);"><i class="fa-solid fa-calendar-days"></i></span>
                <span>日历</span>
                <i class="fa-solid fa-chevron-down phone-settings-chevron"></i>
            </summary>
            <div class="phone-settings-section-body">

                <div class="phone-settings-row">
                    <div class="phone-settings-toggle-row">
                        <span class="phone-settings-toggle-label">世界书条目注入</span>
                        <button id="${P}_cal_wb_toggle" class="phone-settings-ios-toggle" aria-checked="false">
                            <span class="phone-settings-ios-toggle-knob"></span>
                        </button>
                    </div>
                </div>
                <div style="padding: 0 16px 12px; font-size: 12px; color: #8e8e93; line-height: 1.5;">
                    开启后，近期日历事件（用户事件/节日/经期预测）将注入世界书，让你对象主动感知和提起未来的事件。
                </div>

                <div id="${P}_cal_days_settings" style="display: none;">
                    <div class="phone-settings-row">
                        <label>预告天数</label>
                        <select id="${P}_cal_lookahead_days" class="phone-settings-input" style="height: 36px; max-width: 120px;">
                            <option value="3">3 天</option>
                            <option value="7">7 天</option>
                            <option value="14">14 天</option>
                            <option value="30">30 天</option>
                        </select>
                    </div>
                </div>

            </div>
        </details>

        <!-- ═══ 聊天 (Chat Settings — merged from 消息提醒 + 回家模式) ═══ -->
        <details class="phone-settings-section">
            <summary class="phone-settings-section-header">
                <span class="phone-settings-section-icon" style="background: linear-gradient(135deg, #667EEA, #764BA2);"><i class="fa-solid fa-comments"></i></span>
                <span>聊天</span>
                <i class="fa-solid fa-chevron-down phone-settings-chevron"></i>
            </summary>
            <div class="phone-settings-section-body">

                <div class="phone-settings-group-title">主动消息</div>
                <div class="phone-settings-row">
                    <div class="phone-settings-toggle-row">
                        <span class="phone-settings-toggle-label">让你对象主动发消息</span>
                        <button id="${P}_auto_msg_toggle" class="phone-settings-ios-toggle" aria-checked="false">
                            <span class="phone-settings-ios-toggle-knob"></span>
                        </button>
                    </div>
                </div>
                <div id="${P}_auto_msg_settings" style="display: none;">
                    <div class="phone-settings-row">
                        <label>间隔时间</label>
                        <div class="phone-settings-slider-row">
                            <input id="${P}_auto_msg_interval" type="range" min="1" max="480" step="1" class="phone-settings-slider" />
                            <span id="${P}_auto_msg_interval_val" class="phone-settings-slider-val">30分钟</span>
                        </div>
                    </div>
                </div>

                <div class="phone-settings-group-title">自动压缩</div>
                <div class="phone-settings-row">
                    <div class="phone-settings-toggle-row">
                        <span class="phone-settings-toggle-label">自动压缩时提取记忆碎片</span>
                        <button id="${P}_auto_summarize_memory_toggle" class="phone-settings-ios-toggle" aria-checked="false">
                            <span class="phone-settings-ios-toggle-knob"></span>
                        </button>
                    </div>
                </div>
                <div style="padding: 0 16px 12px; font-size: 12px; color: #8e8e93; line-height: 1.5;">
                    开启后，聊天自动压缩时也会调用鬼面记忆碎片系统提取关键信息写入世界书。关闭则仅做滚动总结，省一次 API 调用。
                </div>

                <div class="phone-settings-group-title">回家模式</div>
                <div class="phone-settings-row">
                    <div class="phone-settings-toggle-row">
                        <span class="phone-settings-toggle-label">回家时提取记忆碎片</span>
                        <button id="${P}_rh_memory_toggle" class="phone-settings-ios-toggle" aria-checked="false">
                            <span class="phone-settings-ios-toggle-knob"></span>
                        </button>
                    </div>
                </div>
                <div style="padding: 0 16px 12px; font-size: 12px; color: #8e8e93; line-height: 1.5;">
                    开启后，点击"我已回家"时会先调用鬼面记忆碎片系统，从手机聊天记录中提取关键信息写入世界书（绿灯条目）。适合使用了 GhostFace 世界书记忆系统的用户。
                </div>

                <div class="phone-settings-group-title">同步方式</div>
                <div class="phone-settings-row" style="flex-direction: column; gap: 8px;">
                    <div class="phone-settings-mode-card" data-rh-mode="summary" id="${P}_rh_mode_summary">
                        <div class="phone-settings-mode-card-header">
                            <span class="phone-settings-mode-card-title">压缩总结</span>
                            <span class="phone-settings-mode-card-badge">推荐</span>
                        </div>
                        <div class="phone-settings-mode-card-desc">鬼面将手机聊天内容总结为结构化摘要后，作为用户消息发送到酒馆本体。省 Token，信息完整。</div>
                    </div>
                    <div class="phone-settings-mode-card" data-rh-mode="raw" id="${P}_rh_mode_raw">
                        <div class="phone-settings-mode-card-header">
                            <span class="phone-settings-mode-card-title">原文灌入</span>
                            <span class="phone-settings-mode-card-badge" style="background: rgba(255,107,157,0.15); color: #FF6B9D;">消耗更多Token</span>
                        </div>
                        <div class="phone-settings-mode-card-desc">将全部手机聊天记录原文直接作为用户消息送入酒馆本体。保留原汁原味的对话细节，但会占用大量 Token（几百条聊天可能超出上下文限制）。</div>
                    </div>
                </div>

            </div>
        </details>

        <!-- ═══ 外观设置 ═══ -->
        <details class="phone-settings-section">
            <summary class="phone-settings-section-header">
                <span class="phone-settings-section-icon" style="background: linear-gradient(135deg, #38B2AC, #2C7A7B);"><i class="fa-solid fa-palette"></i></span>
                <span>外观</span>
                <i class="fa-solid fa-chevron-down phone-settings-chevron"></i>
            </summary>
            <div class="phone-settings-section-body">

                <div class="phone-settings-group-title">自定义桌面背景</div>
                <div class="phone-settings-row">
                    <label>选择图片（仅存储在本地服务器缓存）</label>
                    <div class="phone-settings-wallpaper-row">
                        <div id="${P}_wallpaper_preview" class="phone-settings-wallpaper-preview">
                            <i class="fa-solid fa-image"></i>
                        </div>
                        <div class="phone-settings-wallpaper-actions">
                            <label for="${P}_wallpaper_input" class="phone-settings-btn phone-settings-btn-primary phone-settings-wallpaper-upload-btn">
                                <i class="fa-solid fa-upload"></i> 选择图片
                            </label>
                            <input id="${P}_wallpaper_input" type="file" accept="image/*" style="display:none;" />
                            <button id="${P}_wallpaper_reset_btn" class="phone-settings-btn" style="font-size:13px;">
                                <i class="fa-solid fa-rotate-left"></i> 恢复默认
                            </button>
                        </div>
                    </div>
                </div>

                <div class="phone-settings-row">
                    <div class="phone-settings-toggle-row">
                        <span class="phone-settings-toggle-label">深色模式</span>
                        <button id="${P}_dark_mode_toggle" class="phone-settings-ios-toggle" aria-checked="false">
                            <span class="phone-settings-ios-toggle-knob"></span>
                        </button>
                    </div>
                </div>

            </div>
        </details>

        <!-- ═══ 语音通话设置 (Voice Call — STT + TTS merged) ═══ -->
        <details class="phone-settings-section">
            <summary class="phone-settings-section-header">
                <span class="phone-settings-section-icon" style="background: linear-gradient(135deg, #34C759, #30D158);"><i class="fa-solid fa-phone"></i></span>
                <span>语音通话</span>
                <i class="fa-solid fa-chevron-down phone-settings-chevron"></i>
            </summary>
            <div class="phone-settings-section-body">

                <div style="padding: 0 16px 12px; font-size: 12px; color: #8e8e93; line-height: 1.5; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                    <span>配置语音通话的语音识别 (STT) 和语音合成 (TTS) 引擎。</span>
                    <span style="flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 14px; background: rgba(52, 199, 89, 0.12); color: #34C759; font-size: 11px; font-weight: 600; white-space: nowrap;">
                        <i class="fa-solid fa-circle-question" style="font-size: 12px;"></i> iOS 用户请看社区教程
                    </span>
                </div>

                <!-- ─── 来电铃声 ─── -->
                <div class="phone-settings-group-title">来电铃声</div>
                <div id="${P}_ringtone_card" class="phone-ringtone-card">
                    <!-- Dynamically rendered by _renderRingtoneCard() -->
                </div>

                <!-- ─── 通话氛围音 ─── -->
                <div class="phone-settings-group-title">通话氛围音</div>
                <div id="${P}_ambient_card" class="phone-ambient-card">
                    <!-- Dynamically rendered by _renderAmbientCard() -->
                </div>

                <!-- ─── STT 语音识别 ─── -->
                <div class="phone-settings-group-title">语音识别 (STT)</div>
                <div class="phone-settings-row">
                    <label>Provider</label>
                    <select id="${P}_stt_provider" class="phone-settings-input" style="height: 36px;">
                        <option value="none">关闭</option>
                    </select>
                </div>
                <div id="${P}_stt_browser_tip" style="display: none;"></div>

                <div class="phone-settings-row">
                    <label>识别语言</label>
                    <select id="${P}_stt_language" class="phone-settings-input" style="height: 36px;">
                        <option value="zh-CN">zh-CN: 中文</option>
                        <option value="en-US">en-US: English (US)</option>
                        <option value="ja-JP">ja-JP: 日本語</option>
                        <option value="ko-KR">ko-KR: 한국어</option>
                        <option value="zh-TW">zh-TW: 繁體中文</option>
                        <option value="en-GB">en-GB: English (UK)</option>
                        <option value="fr-FR">fr-FR: Français</option>
                        <option value="de-DE">de-DE: Deutsch</option>
                        <option value="es-ES">es-ES: Español</option>
                        <option value="ru-RU">ru-RU: Русский</option>
                        <option value="">自动检测</option>
                    </select>
                </div>

                <div class="phone-settings-row">
                    <div class="phone-settings-toggle-row">
                        <span class="phone-settings-toggle-label">语音激活模式 (VAD)</span>
                        <button id="${P}_stt_vad_toggle" class="phone-settings-ios-toggle" aria-checked="false">
                            <span class="phone-settings-ios-toggle-knob"></span>
                        </button>
                    </div>
                </div>
                <div style="padding: 0 16px 12px; font-size: 12px; color: #8e8e93; line-height: 1.5;">
                    开启后，检测到说话声自动开始录音，停止说话自动识别。关闭则需手动按按钮。
                </div>

                <div id="${P}_stt_provider_settings"></div>

                <!-- ─── TTS 语音合成 ─── -->
                <div class="phone-settings-group-title">语音合成 (TTS)</div>
                <div style="padding: 0 16px 8px; font-size: 12px; color: #8e8e93; line-height: 1.5;">
                    通话时你对象的回复将被朗读。GPT-SoVITS 走本地推理，ElevenLabs / MiniMax 走云代理。
                </div>
                <div class="phone-settings-row">
                    <label>Provider</label>
                    <select id="${P}_tts_provider" class="phone-settings-input" style="height: 36px;">
                        <option value="none">关闭</option>
                        <option value="GPT-SoVITS">GPT-SoVITS（本地）</option>
                        <option value="ElevenLabs">ElevenLabs</option>
                        <option value="MiniMax">MiniMax</option>
                    </select>
                </div>

                <!-- GPT-SoVITS 专属设置 -->
                <div id="${P}_tts_gsvi_settings" style="display:none;">
                    <div class="phone-settings-row">
                        <label>本地端点</label>
                        <input id="${P}_tts_gsvi_endpoint" type="text" class="phone-settings-input"
                               placeholder="http://localhost:9881" />
                    </div>
                    <div class="phone-settings-row">
                        <label>API 格式</label>
                        <select id="${P}_tts_gsvi_format" class="phone-settings-input" style="height:36px;">
                            <option value="auto">自动检测 (按端口)</option>
                            <option value="adapter">Adapter (9881 风格)</option>
                            <option value="gsvi">GSVI Inference (8000 风格)</option>
                        </select>
                    </div>
                    <div style="padding: 0 16px 8px; font-size: 11px; color: #8e8e93; line-height: 1.4;">
                        如果自动检测不对，请手动选择。换了非默认端口（如8001）请手动选。
                    </div>
                    <div class="phone-settings-row">
                        <label>角色名 (Voice ID)</label>
                        <div style="display:flex;gap:6px;align-items:center;flex:1;min-width:0;">
                            <select id="${P}_tts_gsvi_voice" class="phone-settings-input" style="height:36px;flex:1;min-width:0;">
                                <option value="">点击右侧按钮获取模型列表</option>
                            </select>
                            <button id="${P}_tts_gsvi_fetch_btn" class="phone-settings-btn" style="padding:6px 10px;font-size:12px;white-space:nowrap;flex-shrink:0;height:36px;box-sizing:border-box;" title="获取模型列表">
                                <i class="fa-solid fa-rotate"></i> 获取
                            </button>
                        </div>
                    </div>
                    <div class="phone-settings-row">
                        <label>语速</label>
                        <div class="phone-settings-slider-row">
                            <input id="${P}_tts_gsvi_speed" type="range" min="0.5" max="2.0" step="0.1" value="1.0" class="phone-settings-slider" />
                            <span id="${P}_tts_gsvi_speed_val" class="phone-settings-slider-val">1.0x</span>
                        </div>
                    </div>
                    <div class="phone-settings-row">
                        <label>文本语言</label>
                        <select id="${P}_tts_gsvi_text_lang" class="phone-settings-input" style="height:36px;">
                            <option value="中文">中文</option>
                            <option value="英语">英语</option>
                            <option value="日语">日语</option>
                            <option value="粤语">粤语</option>
                            <option value="韩语">韩语</option>
                            <option value="中英混合">中英混合</option>
                            <option value="日英混合">日英混合</option>
                            <option value="粤英混合">粤英混合</option>
                            <option value="韩英混合">韩英混合</option>
                            <option value="多语种混合">多语种混合</option>
                            <option value="多语种混合(粤语)">多语种混合(粤语)</option>
                        </select>
                    </div>
                    <div class="phone-settings-row">
                        <label>参考语言</label>
                        <select id="${P}_tts_gsvi_prompt_lang" class="phone-settings-input" style="height:36px;">
                            <option value="">(请先获取声音列表)</option>
                        </select>
                    </div>
                    <div class="phone-settings-row">
                        <label>默认情绪</label>
                        <select id="${P}_tts_gsvi_emotion" class="phone-settings-input" style="height:36px;">
                            <option value="">(请先获取声音列表)</option>
                        </select>
                    </div>
                    <div class="phone-settings-row">
                        <label>文本切分</label>
                        <select id="${P}_tts_gsvi_split_method" class="phone-settings-input" style="height:36px;">
                            <option value="不切">不切</option>
                            <option value="凑四句一切">凑四句一切</option>
                            <option value="凑50字一切">凑50字一切</option>
                            <option value="按中文句号。切">按中文句号。切</option>
                            <option value="按英文句号.切">按英文句号.切</option>
                            <option value="按标点符号切">按标点符号切</option>
                        </select>
                    </div>
                    <div class="phone-settings-row">
                        <label>Batch Size</label>
                        <div class="phone-settings-slider-row">
                            <input id="${P}_tts_gsvi_batch_size" type="range" min="1" max="100" step="1" value="1" class="phone-settings-slider" />
                            <span id="${P}_tts_gsvi_batch_size_val" class="phone-settings-slider-val">1</span>
                        </div>
                    </div>
                    <div class="phone-settings-row" style="justify-content:center; padding-top: 4px;">
                        <button id="${P}_tts_gsvi_test_btn" class="phone-settings-btn" style="width:100%; max-width: 200px; font-size: 13px;">
                            <i class="fa-solid fa-play"></i> 试听当前设置
                        </button>
                    </div>
                </div>

                <!-- ElevenLabs 专属设置 -->
                <div id="${P}_tts_elevenlabs_settings" style="display:none;">
                    <div class="phone-settings-row">
                        <label>API Key</label>
                        <input id="${P}_tts_11labs_key" type="password" class="phone-settings-input"
                               placeholder="不是sk开头的那个哦..." />
                    </div>
                    <div class="phone-settings-row">
                        <label>Voice ID</label>
                        <div style="display:flex;gap:6px;align-items:center;flex:1;min-width:0;">
                            <select id="${P}_tts_11labs_voice" class="phone-settings-input" style="height:36px;flex:1;min-width:0;">
                                <option value="">点击右侧按钮获取声音列表</option>
                            </select>
                            <button id="${P}_tts_11labs_fetch_btn" class="phone-settings-btn" style="padding:6px 10px;font-size:12px;white-space:nowrap;flex-shrink:0;height:36px;box-sizing:border-box;" title="获取声音列表">
                                <i class="fa-solid fa-rotate"></i> 获取
                            </button>
                        </div>
                    </div>
                    <div class="phone-settings-row">
                        <label>模型</label>
                        <select id="${P}_tts_11labs_model" class="phone-settings-input" style="height: 36px;">
                            <option value="eleven_multilingual_v2">Multilingual v2 (推荐)</option>
                            <option value="eleven_turbo_v2_5">Turbo v2.5 (快速)</option>
                            <option value="eleven_turbo_v2">Turbo v2</option>
                            <option value="eleven_multilingual_v1">Multilingual v1</option>
                            <option value="eleven_monolingual_v1">English v1</option>
                        </select>
                    </div>
                    <div class="phone-settings-row">
                        <label>语速</label>
                        <div class="phone-settings-slider-row">
                            <input id="${P}_tts_11labs_speed" type="range" min="0.5" max="2.0" step="0.1" value="1.0" class="phone-settings-slider" />
                            <span id="${P}_tts_11labs_speed_val" class="phone-settings-slider-val">1.0x</span>
                        </div>
                    </div>
                </div>

                <!-- MiniMax 专属设置 -->
                <div id="${P}_tts_minimax_settings" style="display:none;">
                    <div class="phone-settings-row">
                        <label>API Key</label>
                        <input id="${P}_tts_minimax_key" type="password" class="phone-settings-input"
                               placeholder="eyJ..." />
                    </div>
                    <div class="phone-settings-row">
                        <label>Voice ID</label>
                        <div style="display:flex;gap:6px;align-items:center;flex:1;min-width:0;">
                            <select id="${P}_tts_minimax_voice" class="phone-settings-input" style="height:36px;flex:1;min-width:0;">
                                <option value="">点击右侧按钮获取声音列表</option>
                            </select>
                            <button id="${P}_tts_minimax_fetch_btn" class="phone-settings-btn" style="padding:6px 10px;font-size:12px;white-space:nowrap;flex-shrink:0;height:36px;box-sizing:border-box;" title="获取声音列表">
                                <i class="fa-solid fa-rotate"></i> 获取
                            </button>
                        </div>
                    </div>
                    <div class="phone-settings-row">
                        <label>自定义 Voice ID</label>
                        <input id="${P}_tts_minimax_custom_voice" type="text" class="phone-settings-input"
                               placeholder="留空则使用上方下拉框的选择" />
                    </div>
                    <div style="padding: 0 16px 8px; font-size: 11px; color: #8e8e93; line-height: 1.4;">
                        如果你有国际服生成的 Voice ID，可以直接粘贴在这里，会覆盖上方下拉框的选择。
                    </div>
                    <div class="phone-settings-row">
                        <label>模型</label>
                        <select id="${P}_tts_minimax_model" class="phone-settings-input" style="height: 36px;">
                            <option value="speech-02-hd">speech-02-hd (推荐)</option>
                            <option value="speech-02">speech-02</option>
                            <option value="speech-01-hd">speech-01-hd</option>
                            <option value="speech-01">speech-01</option>
                        </select>
                    </div>
                    <div class="phone-settings-row">
                        <label>语速</label>
                        <div class="phone-settings-slider-row">
                            <input id="${P}_tts_minimax_speed" type="range" min="0.5" max="2.0" step="0.1" value="1.0" class="phone-settings-slider" />
                            <span id="${P}_tts_minimax_speed_val" class="phone-settings-slider-val">1.0x</span>
                        </div>
                    </div>
                </div>

                <!-- 云代理（ElevenLabs / MiniMax 共用）-->
                <div id="${P}_tts_proxy_settings" style="display:none;">
                    <div class="phone-settings-group-title">云服务器代理</div>
                    <div class="phone-settings-row">
                        <label>代理地址</label>
                        <input id="${P}_tts_proxy_server" type="text" class="phone-settings-input"
                               placeholder="https://api.entity.li" />
                    </div>
                </div>

                <!-- 已保存语音文件 -->
                <div class="phone-settings-group-title">已保存语音</div>
                <div style="padding: 0 16px 8px; font-size: 12px; color: #8e8e93; line-height: 1.5;">
                    聊天和通话中 TTS 合成的语音文件。保存在 SillyTavern 的 user/files/ 目录下。
                </div>
                <div class="phone-settings-row" style="justify-content: center; padding-top: 4px;">
                    <button id="${P}_saved_audio_btn" class="phone-settings-btn" style="width:100%; max-width: 240px; font-size: 13px;">
                        <i class="fa-solid fa-folder-open"></i> 查看已保存音频
                    </button>
                </div>
                <div id="${P}_saved_audio_list" style="display: none; padding: 8px 16px 12px;"></div>

                <div class="phone-settings-actions">
                    <button id="${P}_tts_save_btn" class="phone-settings-btn phone-settings-btn-primary">保存设置</button>
                </div>

            </div>
        </details>

        <!-- ═══ 世界书黑名单 (World Book Blacklist) ═══ -->
        <details class="phone-settings-section">
            <summary class="phone-settings-section-header">
                <span class="phone-settings-section-icon" style="background: linear-gradient(135deg, #FF8C42, #D45113);"><i class="fa-solid fa-book-skull"></i></span>
                <span>世界书黑名单</span>
                <i class="fa-solid fa-chevron-down phone-settings-chevron"></i>
            </summary>
            <div class="phone-settings-section-body">

                <div style="padding: 0 16px 12px; font-size: 12px; color: #8e8e93; line-height: 1.5;">
                    在这里选择不想在手机里发送给 LLM 的世界书或条目，被屏蔽的内容不会出现在手机的提示词中。可以全局屏蔽，也可以针对当前角色屏蔽。建议全局屏蔽交稿日。
                </div>

                <div class="phone-settings-group-title">范围</div>
                <div class="phone-wb-bl-tabs" id="${P}_wb_bl_tabs">
                    <button class="phone-wb-bl-tab active" data-scope="global">全局</button>
                    <button class="phone-wb-bl-tab" data-scope="char">当前</button>
                </div>

                <div id="${P}_wb_bl_list" class="phone-wb-bl-list">
                    <div style="text-align: center; padding: 20px; color: #8e8e93; font-size: 13px;">
                        <i class="fa-solid fa-spinner fa-spin"></i> 加载世界书...
                    </div>
                </div>

            </div>
        </details>

        <!-- ═══ 开发者工具 (Dev Tools) ═══ -->
        <details class="phone-settings-section">
            <summary class="phone-settings-section-header">
                <span class="phone-settings-section-icon" style="background: linear-gradient(135deg, #1e1e1e, #3a3a3a);"><i class="fa-solid fa-terminal"></i></span>
                <span>开发者工具</span>
                <i class="fa-solid fa-chevron-down phone-settings-chevron"></i>
            </summary>
            <div class="phone-settings-section-body">

                <div class="phone-settings-row">
                    <div class="phone-settings-toggle-row">
                        <span class="phone-settings-toggle-label">Console 调试工具</span>
                        <button id="${P}_console_enable_toggle" class="phone-settings-ios-toggle" aria-checked="false">
                            <span class="phone-settings-ios-toggle-knob"></span>
                        </button>
                    </div>
                </div>
                <div style="padding: 0 16px 12px; font-size: 12px; color: #8e8e93; line-height: 1.5;">
                    开启后 Console App 可正常使用，实时查看模块日志和发出的提示词。
                </div>

            </div>
        </details>
    </div>
    `;

    openAppInViewport('设置', html, async () => {
        // Populate moments settings values (nickname, automation, toggle)
        populateSettings(P);

        // Bind profile card click → open account detail
        onClick('phone_settings_profile_card', () => openAccountDetailPage());

        // Bind moments events
        onClick(`${P}_save_settings_btn`, () => saveSettingsFromUI(P));
        onClick(`${P}_toggle_enable_btn`, () => toggleEnable(P));

        // Sliders
        bindSlider(`${P}_auto_post_chance`, `${P}_auto_post_chance_val`);
        bindSlider(`${P}_auto_comment_chance`, `${P}_auto_comment_chance_val`);
        bindSlider(`${P}_auto_like_chance`, `${P}_auto_like_chance_val`);

        // ═══ Appearance: Custom Wallpaper ═══
        const wallpaperPreview = document.getElementById(`${P}_wallpaper_preview`);
        const wallpaperInput = document.getElementById(`${P}_wallpaper_input`);

        const savedWallpaper = localStorage.getItem('gf_phone_wallpaper');
        if (savedWallpaper && wallpaperPreview) {
            wallpaperPreview.style.backgroundImage = `url(${savedWallpaper})`;
            wallpaperPreview.querySelector('i')?.remove();
        }

        if (wallpaperInput) {
            wallpaperInput.addEventListener('change', (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) {
                    showToast('图片大小不能超过 5MB');
                    return;
                }
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const base64 = ev.target.result;
                    localStorage.setItem('gf_phone_wallpaper', base64);
                    applyWallpaper(base64);
                    if (wallpaperPreview) {
                        wallpaperPreview.style.backgroundImage = `url(${base64})`;
                        const icon = wallpaperPreview.querySelector('i');
                        if (icon) icon.remove();
                    }
                    showToast('壁纸已更换');
                };
                reader.readAsDataURL(file);
            });
        }

        onClick(`${P}_wallpaper_reset_btn`, () => {
            localStorage.removeItem('gf_phone_wallpaper');
            applyWallpaper(null);
            if (wallpaperPreview) {
                wallpaperPreview.style.backgroundImage = '';
                if (!wallpaperPreview.querySelector('i')) {
                    wallpaperPreview.innerHTML = '<i class="fa-solid fa-image"></i>';
                }
            }
            showToast('已恢复默认壁纸');
        });

        // ═══ Appearance: Dark Mode Toggle ═══
        const darkToggle = document.getElementById(`${P}_dark_mode_toggle`);
        const isDark = localStorage.getItem('gf_phone_dark_mode') === 'true';
        if (darkToggle) {
            darkToggle.setAttribute('aria-checked', String(isDark));
            if (isDark) darkToggle.classList.add('active');
        }

        if (darkToggle) {
            darkToggle.addEventListener('click', () => {
                const isNowDark = darkToggle.getAttribute('aria-checked') === 'true';
                const newState = !isNowDark;
                darkToggle.setAttribute('aria-checked', String(newState));
                darkToggle.classList.toggle('active', newState);
                localStorage.setItem('gf_phone_dark_mode', String(newState));
                applyDarkMode(newState);
                showToast(newState ? '已切换为深色模式' : '已切换为浅色模式');
            });
        }

        // ═══ Diary: Enable Toggle ═══
        const diaryToggle = document.getElementById(`${P}_diary_enable_toggle`);
        const diaryOn = isDiaryEnabled();
        if (diaryToggle) {
            diaryToggle.setAttribute('aria-checked', String(diaryOn));
            if (diaryOn) diaryToggle.classList.add('active');
            diaryToggle.addEventListener('click', () => {
                const wasOn = diaryToggle.getAttribute('aria-checked') === 'true';
                const newState = !wasOn;
                diaryToggle.setAttribute('aria-checked', String(newState));
                diaryToggle.classList.toggle('active', newState);
                setDiaryEnabled(newState);
                showToast(newState ? '日记本已启用' : '日记本已关闭');
            });
        }

        // ═══ Diary: Mode Selector ═══
        const currentMode = getDiaryMode();
        const modeCards = document.querySelectorAll('.phone-settings-mode-card[data-diary-mode]');
        modeCards.forEach(card => {
            if (card.dataset.diaryMode === currentMode) card.classList.add('mode-selected');
            card.addEventListener('click', () => {
                modeCards.forEach(c => c.classList.remove('mode-selected'));
                card.classList.add('mode-selected');
                setDiaryMode(card.dataset.diaryMode);
                const label = card.dataset.diaryMode === 'auto' ? '自动模式' : '手动模式';
                showToast(`日记模式: ${label}`);
            });
        });

        // ═══ Tree Settings ═══
        const treeData = loadTreeData();
        const treeWbToggle = document.getElementById(`${P}_tree_wb_toggle`);
        if (treeWbToggle) {
            const isWbOn = !!treeData.settings.injectWorldBook;
            treeWbToggle.setAttribute('aria-checked', String(isWbOn));
            if (isWbOn) treeWbToggle.classList.add('active');

            treeWbToggle.addEventListener('click', () => {
                const wasOn = treeWbToggle.getAttribute('aria-checked') === 'true';
                const newState = !wasOn;
                treeWbToggle.setAttribute('aria-checked', String(newState));
                treeWbToggle.classList.toggle('active', newState);
                updateTreeSettings({ injectWorldBook: newState });

                if (newState) {
                    const state = getTreeState();
                    if (state && state.treeName) {
                        const season = getCurrentSeason();
                        const stage = getStageByGrowth(state.growth);
                        const charName = getPhoneCharInfo()?.name || '恋人';
                        const userName = getPhoneUserName() || '玩家';
                        updateTreeWorldInfo(state, season, stage, charName, userName).catch(e => {
                            console.warn('[Settings] 树树世界书条目更新:', e);
                        });
                    }
                } else {
                    disableTreeWorldInfo();
                }
                showToast(newState ? '世界书注入已开启' : '世界书注入已关闭');
            });
        }

        onClick(`${P}_tree_rename_btn`, () => {
            const state = getTreeState();
            if (!state || !state.treeName) {
                return showToast('你还没有领养小树哦！');
            }
            const newName = prompt('给小树改个名字:', state.treeName);
            if (newName !== null && newName.trim()) {
                updateTreeState({ treeName: newName.trim() });
                showToast(`已改名为: ${newName.trim()}`);
            }
        });

        onClick(`${P}_tree_regen_btn`, () => {
            const state = getTreeState();
            if (!state || !state.treeName) {
                return showToast('你还没有领养小树哦！');
            }
            const confirmed = confirm('确定要重新生成所有台词和题目吗？\n（小树成长、图鉴、果实等数据会保留）');
            if (confirmed) {
                import('../tree/treeStorage.js').then(({ resetTreeContent }) => {
                    resetTreeContent();
                    showToast('内容已清除，打开树树即可重新生成');
                });
            }
        });

        // ═══ Calendar Settings ═══
        {
            const calWiSettings = loadWISettings();
            const calWbToggle = document.getElementById(`${P}_cal_wb_toggle`);
            const calDaysSettings = document.getElementById(`${P}_cal_days_settings`);
            const calDaysSelect = document.getElementById(`${P}_cal_lookahead_days`);

            // Initialize toggle state
            if (calWbToggle) {
                const isOn = !!calWiSettings.enabled;
                calWbToggle.setAttribute('aria-checked', String(isOn));
                if (isOn) calWbToggle.classList.add('active');
                if (calDaysSettings) calDaysSettings.style.display = isOn ? '' : 'none';

                calWbToggle.addEventListener('click', () => {
                    const wasOn = calWbToggle.getAttribute('aria-checked') === 'true';
                    const newState = !wasOn;
                    calWbToggle.setAttribute('aria-checked', String(newState));
                    calWbToggle.classList.toggle('active', newState);
                    if (calDaysSettings) calDaysSettings.style.display = newState ? '' : 'none';

                    const ws = loadWISettings();
                    ws.enabled = newState;
                    saveWISettings(ws);

                    if (newState) {
                        updateCalendarWorldInfo().catch(e => {
                            console.warn('[Settings] 日历世界书条目更新:', e);
                        });
                    } else {
                        disableCalendarWorldInfo();
                    }
                    showToast(newState ? '日历世界书注入已开启 📅' : '日历世界书注入已关闭');
                });
            }

            // Initialize day selector
            if (calDaysSelect) {
                calDaysSelect.value = String(calWiSettings.lookAheadDays || 7);
                calDaysSelect.addEventListener('change', () => {
                    const ws = loadWISettings();
                    ws.lookAheadDays = parseInt(calDaysSelect.value, 10) || 7;
                    saveWISettings(ws);

                    if (ws.enabled) {
                        updateCalendarWorldInfo().catch(e => {
                            console.warn('[Settings] 日历世界书条目更新:', e);
                        });
                    }
                    showToast(`日历预告天数: ${ws.lookAheadDays} 天`);
                });
            }
        }

        // ═══ Auto-Summarize: Memory Toggle ═══
        const autoSumMemToggle = document.getElementById(`${P}_auto_summarize_memory_toggle`);
        const autoSumMemOn = localStorage.getItem('gf_phone_auto_summarize_memory') !== 'false'; // default ON
        if (autoSumMemToggle) {
            autoSumMemToggle.setAttribute('aria-checked', String(autoSumMemOn));
            if (autoSumMemOn) autoSumMemToggle.classList.add('active');
            autoSumMemToggle.addEventListener('click', () => {
                const wasOn = autoSumMemToggle.getAttribute('aria-checked') === 'true';
                const newState = !wasOn;
                autoSumMemToggle.setAttribute('aria-checked', String(newState));
                autoSumMemToggle.classList.toggle('active', newState);
                localStorage.setItem('gf_phone_auto_summarize_memory', String(newState));
                showToast(newState ? '自动压缩将提取记忆碎片 🧩' : '自动压缩仅做滚动总结');
            });
        }

        // ═══ Return Home: Memory Toggle + Sync Mode ═══
        const rhMemoryToggle = document.getElementById(`${P}_rh_memory_toggle`);
        const rhMemoryOn = localStorage.getItem('gf_phone_rh_memory') === 'true';
        if (rhMemoryToggle) {
            rhMemoryToggle.setAttribute('aria-checked', String(rhMemoryOn));
            if (rhMemoryOn) rhMemoryToggle.classList.add('active');
            rhMemoryToggle.addEventListener('click', () => {
                const wasOn = rhMemoryToggle.getAttribute('aria-checked') === 'true';
                const newState = !wasOn;
                rhMemoryToggle.setAttribute('aria-checked', String(newState));
                rhMemoryToggle.classList.toggle('active', newState);
                localStorage.setItem('gf_phone_rh_memory', String(newState));
                showToast(newState ? '回家时将提取记忆碎片 🧩' : '记忆碎片提取已关闭');
            });
        }

        const currentRhMode = localStorage.getItem('gf_phone_rh_sync_mode') || 'summary';
        const rhModeCards = document.querySelectorAll('.phone-settings-mode-card[data-rh-mode]');
        rhModeCards.forEach(card => {
            if (card.dataset.rhMode === currentRhMode) card.classList.add('mode-selected');
            card.addEventListener('click', () => {
                rhModeCards.forEach(c => c.classList.remove('mode-selected'));
                card.classList.add('mode-selected');
                localStorage.setItem('gf_phone_rh_sync_mode', card.dataset.rhMode);
                const label = card.dataset.rhMode === 'raw' ? '原文灌入' : '压缩总结';
                showToast(`回家同步方式: ${label}`);
            });
        });

        // ═══ World Book Blacklist ═══
        {
            const charInfo = getPhoneCharInfo();
            const charLabel = document.getElementById(`${P}_wb_bl_char_label`);
            if (charLabel && charInfo?.name) charLabel.textContent = charInfo.name;

            let currentScope = 'global';
            const tabs = document.querySelectorAll(`#${P}_wb_bl_tabs .phone-wb-bl-tab`);
            tabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    tabs.forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    currentScope = tab.dataset.scope;
                    renderWbBlacklist(P, currentScope);
                });
            });

            // Initial render when expanded
            const blSection = document.querySelector(`.phone-settings-section:has(#${P}_wb_bl_list)`);
            if (blSection) {
                blSection.addEventListener('toggle', () => {
                    if (blSection.open) {
                        renderWbBlacklist(P, currentScope);
                    }
                });
            }
        }

        // ═══ Ringtone Settings ═══
        {
            _renderRingtoneCard(P);
        }

        // ═══ Ambient Settings ═══
        {
            _renderAmbientCard(P);
        }

        // ═══ STT Settings ═══
        {
            const sttEngine = getSttEngine();
            const sttSettings = sttEngine.getSettings();
            const providerSelect = document.getElementById(`${P}_stt_provider`);
            const langSelect = document.getElementById(`${P}_stt_language`);
            const vadToggle = document.getElementById(`${P}_stt_vad_toggle`);
            const providerSettingsContainer = document.getElementById(`${P}_stt_provider_settings`);

            // Populate provider dropdown
            if (providerSelect) {
                const providers = sttEngine.getAvailableProviders();
                providers.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.name;
                    const provider = sttEngine._providers.get(p.name);
                    const instance = provider?.instance || new provider.ProviderClass();
                    opt.textContent = `${instance.description || p.name}${p.available ? '' : ' (不可用)'}`;
                    opt.disabled = !p.available;
                    providerSelect.appendChild(opt);
                });
                providerSelect.value = sttSettings.provider || 'none';

                // Show tip when on insecure context (Safari / iOS blocks ALL microphone access over HTTP)
                const tipEl = document.getElementById(`${P}_stt_browser_tip`);
                const isInsecure = !window.isSecureContext;
                const browserInfo = providers.find(p => p.name === 'Browser');
                const browserUnavailable = browserInfo && !browserInfo.available;
                if (tipEl && (isInsecure || browserUnavailable)) {
                    tipEl.style.display = '';
                    if (isInsecure) {
                        tipEl.innerHTML = `
                            <div style="margin: 0 16px 12px; padding: 10px 14px; border-radius: 10px; background: rgba(255, 59, 48, 0.1); border: 1px solid rgba(255, 59, 48, 0.25); font-size: 12px; line-height: 1.6; color: #8e8e93;">
                                <div style="font-weight: 600; margin-bottom: 4px; color: #FF3B30;"><i class="fa-solid fa-lock" style="margin-right: 4px;"></i>需要 HTTPS 连接</div>
                                当前通过 <b>HTTP</b> 访问，Safari 和 iOS 浏览器会阻止所有麦克风访问（包括录音和语音识别）。<br>
                                请通过 <b>HTTPS</b> 或 <b>localhost</b> 访问酒馆，或在 PC 端使用 Edge / Chrome。
                                <div style="display: flex; align-items: center; gap: 4px; margin-top: 6px; color: #34C759; font-weight: 600;">
                                    <i class="fa-solid fa-book-open" style="font-size: 11px;"></i> 请去社区查看《iOS 语音通话设置指南》教程帖子
                                </div>
                            </div>
                        `;
                    } else {
                        tipEl.innerHTML = `
                            <div style="margin: 0 16px 12px; padding: 10px 14px; border-radius: 10px; background: rgba(255, 204, 0, 0.12); border: 1px solid rgba(255, 204, 0, 0.25); font-size: 12px; line-height: 1.6; color: #8e8e93;">
                                <div style="font-weight: 600; margin-bottom: 4px; color: #FFa500;"><i class="fa-solid fa-triangle-exclamation" style="margin-right: 4px;"></i>浏览器语音识别不可用</div>
                                此浏览器不支持内置语音识别，请改用 <b style="color: #34C759;">Groq Whisper (免费快速)</b> 等 API 方案。
                                <div style="display: flex; align-items: center; gap: 4px; margin-top: 6px; color: #34C759; font-weight: 600;">
                                    <i class="fa-solid fa-book-open" style="font-size: 11px;"></i> 请去社区查看《iOS 语音通话设置指南》教程指南
                                </div>
                            </div>
                        `;
                    }
                }

                providerSelect.addEventListener('change', () => {
                    sttEngine.setProvider(providerSelect.value);
                    _renderSttProviderSettings(P, sttEngine);
                    showToast(`语音识别: ${providerSelect.value === 'none' ? '已关闭' : providerSelect.options[providerSelect.selectedIndex].text}`);
                });
            }

            // Language
            if (langSelect) {
                langSelect.value = sttSettings.language || 'zh-CN';
                langSelect.addEventListener('change', () => {
                    sttEngine.language = langSelect.value;
                });
            }

            // VAD toggle
            if (vadToggle) {
                vadToggle.setAttribute('aria-checked', String(sttSettings.vadEnabled));
                if (sttSettings.vadEnabled) vadToggle.classList.add('active');
                vadToggle.addEventListener('click', () => {
                    const wasOn = vadToggle.getAttribute('aria-checked') === 'true';
                    const newState = !wasOn;
                    vadToggle.setAttribute('aria-checked', String(newState));
                    vadToggle.classList.toggle('active', newState);
                    sttEngine.vadEnabled = newState;
                    showToast(newState ? '语音激活已开启' : '语音激活已关闭');
                });
            }

            // Render provider-specific settings
            _renderSttProviderSettings(P, sttEngine);
        }

        // ═══ TTS Settings ═══
        {
            const ttsEngine = getTtsEngine();
            const ttsSettings = ttsEngine.getSettings();
            const ttsProviderSelect = document.getElementById(`${P}_tts_provider`);

            const gsviPanel = document.getElementById(`${P}_tts_gsvi_settings`);
            const elevPanel = document.getElementById(`${P}_tts_elevenlabs_settings`);
            const mmPanel = document.getElementById(`${P}_tts_minimax_settings`);
            const proxyPanel = document.getElementById(`${P}_tts_proxy_settings`);

            // Helper: toggle visible sub-panels based on selected provider
            function _updateTtsPanels(providerName) {
                gsviPanel && (gsviPanel.style.display = providerName === 'GPT-SoVITS' ? '' : 'none');
                elevPanel && (elevPanel.style.display = providerName === 'ElevenLabs' ? '' : 'none');
                mmPanel && (mmPanel.style.display = providerName === 'MiniMax' ? '' : 'none');
                // Cloud proxy shown for ElevenLabs and MiniMax
                const needsProxy = providerName === 'ElevenLabs' || providerName === 'MiniMax';
                proxyPanel && (proxyPanel.style.display = needsProxy ? '' : 'none');
            }

            // Populate provider select and show saved value
            if (ttsProviderSelect) {
                ttsProviderSelect.value = ttsSettings.provider || 'none';
                _updateTtsPanels(ttsSettings.provider || 'none');
                ttsProviderSelect.addEventListener('change', () => {
                    _updateTtsPanels(ttsProviderSelect.value);
                });
            }

            // Populate fields from saved settings
            const gsviS = ttsEngine.getProviderSettings('GPT-SoVITS');
            const elevS = ttsEngine.getProviderSettings('ElevenLabs');
            const mmS = ttsEngine.getProviderSettings('MiniMax');

            const gsviEndpointInput = document.getElementById(`${P}_tts_gsvi_endpoint`);
            const gsviFormatSelect = document.getElementById(`${P}_tts_gsvi_format`);
            const gsviVoiceInput = document.getElementById(`${P}_tts_gsvi_voice`);
            const gsviSpeedSlider = document.getElementById(`${P}_tts_gsvi_speed`);
            const gsviSpeedVal = document.getElementById(`${P}_tts_gsvi_speed_val`);
            const gsviTextLang = document.getElementById(`${P}_tts_gsvi_text_lang`);
            const gsviPromptLang = document.getElementById(`${P}_tts_gsvi_prompt_lang`);
            const gsviSplitMethod = document.getElementById(`${P}_tts_gsvi_split_method`);
            const gsviBatchSize = document.getElementById(`${P}_tts_gsvi_batch_size`);
            const gsviBatchSizeVal = document.getElementById(`${P}_tts_gsvi_batch_size_val`);
            const gsviEmotion = document.getElementById(`${P}_tts_gsvi_emotion`);
            const elevKeyInput = document.getElementById(`${P}_tts_11labs_key`);
            const elevVoiceInput = document.getElementById(`${P}_tts_11labs_voice`);
            const elevModelSelect = document.getElementById(`${P}_tts_11labs_model`);
            const elevSpeedSlider = document.getElementById(`${P}_tts_11labs_speed`);
            const elevSpeedVal = document.getElementById(`${P}_tts_11labs_speed_val`);
            const mmKeyInput = document.getElementById(`${P}_tts_minimax_key`);
            const mmVoiceInput = document.getElementById(`${P}_tts_minimax_voice`);
            const mmCustomVoiceInput = document.getElementById(`${P}_tts_minimax_custom_voice`);
            const mmModelSelect = document.getElementById(`${P}_tts_minimax_model`);
            const mmSpeedSlider = document.getElementById(`${P}_tts_minimax_speed`);
            const mmSpeedVal = document.getElementById(`${P}_tts_minimax_speed_val`);
            const proxyInput = document.getElementById(`${P}_tts_proxy_server`);

            // Fill existing fields
            if (gsviEndpointInput) gsviEndpointInput.value = gsviS.endpoint || 'http://localhost:9881';
            if (gsviFormatSelect) gsviFormatSelect.value = gsviS.apiFormat || 'auto';
            if (gsviTextLang) gsviTextLang.value = gsviS.textLang === undefined ? '多语种混合' : gsviS.textLang;
            if (gsviPromptLang) {
                if (gsviS.promptLang) {
                    gsviPromptLang.innerHTML = `<option value="${gsviS.promptLang}">${gsviS.promptLang}</option>`;
                    gsviPromptLang.value = gsviS.promptLang;
                } else {
                    gsviPromptLang.innerHTML = `<option value="">(请先获取声音列表)</option>`;
                    gsviPromptLang.value = '';
                }
            }
            if (gsviEmotion) {
                if (gsviS.emotion) {
                    gsviEmotion.innerHTML = `<option value="${gsviS.emotion}">${gsviS.emotion}</option>`;
                    gsviEmotion.value = gsviS.emotion;
                } else {
                    gsviEmotion.innerHTML = `<option value="">(请先获取声音列表)</option>`;
                    gsviEmotion.value = '';
                }
            }
            if (gsviSplitMethod) gsviSplitMethod.value = gsviS.textSplitMethod === undefined ? '按标点符号切' : gsviS.textSplitMethod;
            if (gsviBatchSize && gsviBatchSizeVal) {
                const bVal = gsviS.batchSize !== undefined ? gsviS.batchSize : 1;
                gsviBatchSize.value = bVal;
                gsviBatchSizeVal.textContent = bVal;
                gsviBatchSize.addEventListener('input', () => {
                    gsviBatchSizeVal.textContent = gsviBatchSize.value;
                });
            }
            if (elevKeyInput) elevKeyInput.value = elevS.apiKey || '';
            if (mmKeyInput) mmKeyInput.value = mmS.apiKey || '';
            if (mmCustomVoiceInput) mmCustomVoiceInput.value = mmS.customVoiceId || '';
            if (proxyInput) proxyInput.value = elevS.proxyServer || mmS.proxyServer || 'https://api.entity.li';

            // Fill new model + speed fields
            if (elevModelSelect) elevModelSelect.value = elevS.model || 'eleven_multilingual_v2';
            if (mmModelSelect) mmModelSelect.value = mmS.model || 'speech-02-hd';

            // ── Voice Select helpers ──

            /**
             * 填充声音下拉框
             * @param {HTMLSelectElement} selectEl
             * @param {Array<{id:string, name:string}>} voices
             * @param {string} savedId
             */
            function _populateVoiceSelect(selectEl, voices, savedId) {
                if (!selectEl) return;
                selectEl.innerHTML = '';
                if (voices.length === 0) {
                    selectEl.innerHTML = '<option value="">无可用声音</option>';
                    return;
                }
                voices.forEach(v => {
                    const opt = document.createElement('option');
                    opt.value = v.id;
                    opt.textContent = v.name || v.id;
                    if (v.promptLangs) {
                        opt.dataset.promptLangs = JSON.stringify(v.promptLangs);
                    }
                    if (v.emotionsMap) {
                        opt.dataset.emotionsMap = JSON.stringify(v.emotionsMap);
                    }
                    if (v.version) {
                        opt.dataset.version = v.version;
                    }
                    selectEl.appendChild(opt);
                });
                if (savedId) selectEl.value = savedId;
                // If savedId not in list, keep first option selected
            }

            function _updateGsviOptions(opt) {
                if (!opt || !gsviPromptLang || !gsviEmotion) return;
                try {
                    const promptLangs = JSON.parse(opt.dataset.promptLangs || '[]');
                    const emotionsMap = JSON.parse(opt.dataset.emotionsMap || '{}');

                    const currentPromptLang = gsviPromptLang.value;
                    const currentEmotion = gsviEmotion.value;

                    // Update promptLangs
                    if (promptLangs.length > 0) {
                        gsviPromptLang.innerHTML = promptLangs.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
                        if (currentPromptLang && promptLangs.includes(currentPromptLang)) {
                            gsviPromptLang.value = currentPromptLang;
                        } else {
                            gsviPromptLang.value = promptLangs[0];
                        }
                    } else {
                        gsviPromptLang.innerHTML = `<option value="">(请先获取声音列表)</option>`;
                        gsviPromptLang.value = '';
                    }

                    // Update emotions based on selected promptLang
                    const selectedPromptLang = gsviPromptLang.value;
                    const emotions = emotionsMap[selectedPromptLang] || [];

                    if (emotions.length > 0) {
                        gsviEmotion.innerHTML = emotions.map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('');
                        if (currentEmotion && emotions.includes(currentEmotion)) {
                            gsviEmotion.value = currentEmotion;
                        } else {
                            gsviEmotion.value = emotions[0];
                        }
                    } else {
                        gsviEmotion.innerHTML = `<option value="默认">默认</option>`;
                        gsviEmotion.value = '默认';
                    }
                } catch (e) {
                    console.error('Failed to parse GSVI options', e);
                }
            }

            if (gsviPromptLang) {
                gsviPromptLang.addEventListener('change', () => {
                    if (gsviVoiceInput && gsviVoiceInput.options.length > 0) {
                        _updateGsviOptions(gsviVoiceInput.options[gsviVoiceInput.selectedIndex]);
                    }
                });
            }

            /**
             * 处理 fetch 按钮点击
             */
            async function _handleFetchVoices(providerName, selectEl, savedId, fetchBtn) {
                if (!selectEl) return;
                const origHtml = fetchBtn?.innerHTML;
                try {
                    if (fetchBtn) fetchBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

                    // For providers that need current input values as settings (e.g. API key, endpoint),
                    // temporarily save them so fetchVoices can use them
                    if (providerName === 'GPT-SoVITS') {
                        ttsEngine.updateProviderSettings('GPT-SoVITS', {
                            endpoint: gsviEndpointInput?.value?.trim() || 'http://localhost:9881',
                            apiFormat: gsviFormatSelect?.value || 'auto',
                        });
                    } else if (providerName === 'ElevenLabs') {
                        ttsEngine.updateProviderSettings('ElevenLabs', {
                            apiKey: elevKeyInput?.value?.trim() || '',
                        });
                    } else if (providerName === 'MiniMax') {
                        ttsEngine.updateProviderSettings('MiniMax', {
                            apiKey: mmKeyInput?.value?.trim() || '',
                        });
                    }

                    const voices = await ttsEngine.fetchVoices(providerName);
                    _populateVoiceSelect(selectEl, voices, savedId);
                    showToast(`已获取 ${voices.length} 个声音/模型`);

                    // Try to auto-set promptLang if we got data back from GSVI
                    if (providerName === 'GPT-SoVITS' && selectEl.options.length > 0) {
                        const selectedOpt = selectEl.options[selectEl.selectedIndex];
                        _updateGsviOptions(selectedOpt);
                    }
                } catch (err) {
                    console.error(`[Settings] fetchVoices(${providerName}) failed:`, err);
                    showToast(`获取失败: ${err.message}`);
                } finally {
                    if (fetchBtn && origHtml) fetchBtn.innerHTML = origHtml;
                }
            }

            // Restore saved voice IDs as pre-selected option (even before fetch)
            if (gsviVoiceInput && gsviS.voiceId) {
                const preVersion = (gsviS.model || '').replace('GSVI-', '');
                gsviVoiceInput.innerHTML = `<option value="${gsviS.voiceId}" data-version="${preVersion}">${gsviS.voiceId}</option>`;
                gsviVoiceInput.value = gsviS.voiceId;
            }
            if (gsviVoiceInput) {
                gsviVoiceInput.addEventListener('change', () => {
                    const opt = gsviVoiceInput.options[gsviVoiceInput.selectedIndex];
                    _updateGsviOptions(opt);
                });
            }
            if (elevVoiceInput && elevS.voiceId) {
                elevVoiceInput.innerHTML = `<option value="${elevS.voiceId}">${elevS.voiceId}</option>`;
                elevVoiceInput.value = elevS.voiceId;
            }
            if (mmVoiceInput && mmS.voiceId) {
                mmVoiceInput.innerHTML = `<option value="${mmS.voiceId}">${mmS.voiceId}</option>`;
                mmVoiceInput.value = mmS.voiceId;
            }

            // Bind fetch buttons
            const gsviFetchBtn = document.getElementById(`${P}_tts_gsvi_fetch_btn`);
            const elevFetchBtn = document.getElementById(`${P}_tts_11labs_fetch_btn`);
            const mmFetchBtn = document.getElementById(`${P}_tts_minimax_fetch_btn`);

            if (gsviFetchBtn) {
                gsviFetchBtn.addEventListener('click', () =>
                    _handleFetchVoices('GPT-SoVITS', gsviVoiceInput, gsviS.voiceId, gsviFetchBtn));
            }
            if (elevFetchBtn) {
                elevFetchBtn.addEventListener('click', () =>
                    _handleFetchVoices('ElevenLabs', elevVoiceInput, elevS.voiceId, elevFetchBtn));
            }
            if (mmFetchBtn) {
                mmFetchBtn.addEventListener('click', () =>
                    _handleFetchVoices('MiniMax', mmVoiceInput, mmS.voiceId, mmFetchBtn));
            }

            // Speed sliders — restore values + bind live label updates
            const _initSpeedSlider = (slider, label, savedSpeed) => {
                if (!slider || !label) return;
                const val = parseFloat(savedSpeed) || 1.0;
                slider.value = val;
                label.textContent = `${val.toFixed(1)}x`;
                slider.addEventListener('input', () => {
                    label.textContent = `${parseFloat(slider.value).toFixed(1)}x`;
                });
            };
            _initSpeedSlider(gsviSpeedSlider, gsviSpeedVal, gsviS.speed);
            _initSpeedSlider(elevSpeedSlider, elevSpeedVal, elevS.speed);
            _initSpeedSlider(mmSpeedSlider, mmSpeedVal, mmS.speed);

            // Test GSVI audio
            const gsviTestBtn = document.getElementById(`${P}_tts_gsvi_test_btn`);
            if (gsviTestBtn) {
                gsviTestBtn.addEventListener('click', async () => {
                    const origHtml = gsviTestBtn.innerHTML;
                    try {
                        gsviTestBtn.disabled = true;
                        gsviTestBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 生成中...';

                        let tempVersion = 'GSVI-v4';
                        if (gsviVoiceInput && gsviVoiceInput.options.length > 0) {
                            const opt = gsviVoiceInput.options[gsviVoiceInput.selectedIndex];
                            if (opt && opt.dataset.version) {
                                tempVersion = `GSVI-${opt.dataset.version}`;
                            }
                        }

                        // Temporary settings object for testing
                        const tempSettings = {
                            endpoint: gsviEndpointInput?.value?.trim() || 'http://localhost:9881',
                            apiFormat: gsviFormatSelect?.value || 'auto',
                            voiceId: gsviVoiceInput?.value?.trim() || '',
                            model: tempVersion,
                            speed: parseFloat(gsviSpeedSlider?.value) || 1.0,
                            textLang: gsviTextLang?.value || '多语种混合',
                            promptLang: gsviPromptLang?.value && gsviPromptLang.value !== '(请先获取声音列表)' ? gsviPromptLang.value : '',
                            emotion: gsviEmotion?.value && gsviEmotion.value !== '(请先获取声音列表)' ? gsviEmotion.value : '',
                            textSplitMethod: gsviSplitMethod?.value || '按标点符号切',
                            batchSize: gsviBatchSize ? parseInt(gsviBatchSize.value, 10) || 1 : 1,
                        };

                        if (!tempSettings.voiceId || tempSettings.voiceId === '') {
                            throw new Error('请先选择一个声音角色！');
                        }

                        // Get provider via public accessor
                        let provider = null;
                        if (typeof ttsEngine.getProvider === 'function') {
                            provider = ttsEngine.getProvider('GPT-SoVITS');
                        } else if (ttsEngine._providers) {
                            const entry = ttsEngine._providers.get ? ttsEngine._providers.get('GPT-SoVITS') : ttsEngine._providers['GPT-SoVITS'];
                            provider = entry?.instance || entry;
                        }
                        if (!provider) throw new Error('TTS Provider 初始化失败');

                        const testText = '你好，这是一段语音测试合成效果。';
                        const audioBuffer = await provider.synthesize(testText, tempSettings);

                        const blob = new Blob([audioBuffer], { type: 'audio/wav' });
                        const url = URL.createObjectURL(blob);
                        const audio = new Audio(url);

                        gsviTestBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i> 播放中...';
                        audio.onended = () => {
                            URL.revokeObjectURL(url);
                            gsviTestBtn.disabled = false;
                            gsviTestBtn.innerHTML = origHtml;
                        };
                        audio.onerror = () => {
                            URL.revokeObjectURL(url);
                            gsviTestBtn.disabled = false;
                            gsviTestBtn.innerHTML = origHtml;
                            showToast('音频播放失败');
                        };

                        await audio.play();
                    } catch (err) {
                        console.error('Test TTS failed:', err);
                        showToast('试听失败: ' + err.message);
                        gsviTestBtn.disabled = false;
                        gsviTestBtn.innerHTML = origHtml;
                    }
                });
            }

            // Save button
            onClick(`${P}_tts_save_btn`, () => {
                const selectedProvider = ttsProviderSelect?.value || 'none';

                let gsviModelVersion = 'GSVI-v4';
                if (gsviVoiceInput && gsviVoiceInput.options.length > 0) {
                    const selectedOpt = gsviVoiceInput.options[gsviVoiceInput.selectedIndex];
                    if (selectedOpt && selectedOpt.dataset.version) {
                        gsviModelVersion = `GSVI-${selectedOpt.dataset.version}`;
                    }
                }

                // Save GPT-SoVITS settings
                ttsEngine.updateProviderSettings('GPT-SoVITS', {
                    endpoint: gsviEndpointInput?.value?.trim() || 'http://localhost:9881',
                    apiFormat: gsviFormatSelect?.value || 'auto',
                    voiceId: gsviVoiceInput?.value?.trim() || '',
                    model: gsviModelVersion,
                    speed: parseFloat(gsviSpeedSlider?.value) || 1.0,
                    textLang: gsviTextLang?.value || '多语种混合',
                    promptLang: gsviPromptLang?.value || '',
                    emotion: gsviEmotion?.value || '',
                    textSplitMethod: gsviSplitMethod?.value || '按标点符号切',
                    batchSize: gsviBatchSize ? parseInt(gsviBatchSize.value, 10) || 1 : 1,
                });

                // Save ElevenLabs settings
                ttsEngine.updateProviderSettings('ElevenLabs', {
                    apiKey: elevKeyInput?.value?.trim() || '',
                    voiceId: elevVoiceInput?.value?.trim() || '',
                    model: elevModelSelect?.value || 'eleven_multilingual_v2',
                    speed: parseFloat(elevSpeedSlider?.value) || 1.0,
                    proxyServer: proxyInput?.value?.trim() || 'https://api.entity.li',
                });

                // Save MiniMax settings
                const mmCustomVoice = mmCustomVoiceInput?.value?.trim() || '';
                ttsEngine.updateProviderSettings('MiniMax', {
                    apiKey: mmKeyInput?.value?.trim() || '',
                    voiceId: mmCustomVoice || mmVoiceInput?.value?.trim() || '',
                    customVoiceId: mmCustomVoice,
                    model: mmModelSelect?.value || 'speech-02-hd',
                    speed: parseFloat(mmSpeedSlider?.value) || 1.0,
                    proxyServer: proxyInput?.value?.trim() || 'https://api.entity.li',
                });

                // Switch active provider
                ttsEngine.setProvider(selectedProvider);

                showToast(selectedProvider === 'none'
                    ? 'TTS 已关闭'
                    : `语音合成已切换: ${selectedProvider}`
                );
            });

            // ── Saved Audio Viewer ──
            onClick(`${P}_saved_audio_btn`, () => {
                const listEl = document.getElementById(`${P}_saved_audio_list`);
                if (!listEl) return;

                // Toggle visibility
                if (listEl.style.display !== 'none') {
                    listEl.style.display = 'none';
                    return;
                }

                // Collect all saved audio paths
                const audioPaths = [];

                // 1. From chat history (voice_user_* and voice_char_*)
                try {
                    const chatHistory = loadChatHistory();
                    for (const msg of chatHistory) {
                        if (msg.audioPath) {
                            audioPaths.push({
                                path: msg.audioPath,
                                source: msg.role === 'user' ? '聊天-用户语音' : '聊天-角色语音',
                                time: msg.timestamp || '',
                            });
                        }
                    }
                } catch (e) { console.warn('[Settings] Chat audio scan failed:', e); }

                // 2. From voice call logs (voice_call_*)
                try {
                    const callLogs = loadCallLogs();
                    for (const log of callLogs) {
                        if (!log.messages) continue;
                        for (const msg of log.messages) {
                            if (msg.audioPath) {
                                audioPaths.push({
                                    path: msg.audioPath,
                                    source: '通话-角色语音',
                                    time: msg.timestamp || log.startTime || '',
                                });
                            }
                        }
                    }
                } catch (e) { console.warn('[Settings] Call audio scan failed:', e); }

                // Render
                if (audioPaths.length === 0) {
                    listEl.innerHTML = `<div style="text-align: center; padding: 16px; color: #8e8e93; font-size: 13px;">
                        <i class="fa-solid fa-box-open" style="font-size: 24px; margin-bottom: 8px; display: block; opacity: 0.5;"></i>
                        暂无已保存的语音文件
                    </div>`;
                } else {
                    const chatCount = audioPaths.filter(a => a.source.startsWith('聊天')).length;
                    const callCount = audioPaths.filter(a => a.source.startsWith('通话')).length;

                    let html = `<div style="margin-bottom: 10px; font-size: 12px; color: #8e8e93;">
                        共 <b style="color: #34C759;">${audioPaths.length}</b> 个音频文件
                        （聊天 ${chatCount} · 通话 ${callCount}）
                    </div>`;
                    html += `<div style="max-height: 240px; overflow-y: auto; border-radius: 8px; background: rgba(0,0,0,0.15); padding: 8px;">`;
                    for (const item of audioPaths) {
                        const filename = item.path.split('/').pop();
                        const timeStr = item.time ? new Date(item.time).toLocaleString() : '';
                        html += `<div style="padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 12px; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-file-audio" style="color: #34C759; flex-shrink: 0;"></i>
                            <div style="min-width: 0; flex: 1;">
                                <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #e0e0e0;" title="${escapeHtml(item.path)}">${escapeHtml(filename)}</div>
                                <div style="font-size: 10px; color: #8e8e93; margin-top: 2px;">${escapeHtml(item.source)}${timeStr ? ' · ' + timeStr : ''}</div>
                            </div>
                        </div>`;
                    }
                    html += `</div>`;
                    listEl.innerHTML = html;
                }
                listEl.style.display = '';
            });
        }

        // ═══ Console: Enable Toggle ═══

        const consoleToggle = document.getElementById(`${P}_console_enable_toggle`);
        const consoleOn = isConsoleEnabled();
        if (consoleToggle) {
            consoleToggle.setAttribute('aria-checked', String(consoleOn));
            if (consoleOn) consoleToggle.classList.add('active');
            consoleToggle.addEventListener('click', () => {
                const wasOn = consoleToggle.getAttribute('aria-checked') === 'true';
                const newState = !wasOn;
                consoleToggle.setAttribute('aria-checked', String(newState));
                consoleToggle.classList.toggle('active', newState);
                setConsoleEnabled(newState);
                showToast(newState ? 'Console 已启用' : 'Console 已关闭');
            });
        }

        // ═══ Auto Message: Enable Toggle + Interval Slider ═══
        const autoMsgToggle = document.getElementById(`${P}_auto_msg_toggle`);
        const autoMsgSettings = document.getElementById(`${P}_auto_msg_settings`);
        const autoMsgSlider = document.getElementById(`${P}_auto_msg_interval`);
        const autoMsgVal = document.getElementById(`${P}_auto_msg_interval_val`);

        const autoMsgConfig = getAutoMsgConfig();

        // Initialize toggle state
        if (autoMsgToggle) {
            autoMsgToggle.setAttribute('aria-checked', String(autoMsgConfig.enabled));
            if (autoMsgConfig.enabled) autoMsgToggle.classList.add('active');

            // Show/hide slider based on enabled state
            if (autoMsgSettings) {
                autoMsgSettings.style.display = autoMsgConfig.enabled ? 'block' : 'none';
            }

            autoMsgToggle.addEventListener('click', () => {
                const wasOn = autoMsgToggle.getAttribute('aria-checked') === 'true';
                const newState = !wasOn;
                autoMsgToggle.setAttribute('aria-checked', String(newState));
                autoMsgToggle.classList.toggle('active', newState);
                saveAutoMsgConfig({ enabled: newState });

                // Show/hide slider
                if (autoMsgSettings) {
                    autoMsgSettings.style.display = newState ? 'block' : 'none';
                }

                if (newState) {
                    startAutoMessageTimer();
                    showToast('主动消息已开启 💬');
                } else {
                    stopAutoMessageTimer();
                    showToast('主动消息已关闭');
                }
            });
        }

        // Initialize slider value from config
        if (autoMsgSlider) {
            autoMsgSlider.value = autoMsgConfig.interval || 30;
            if (autoMsgVal) autoMsgVal.textContent = formatIntervalLabel(autoMsgConfig.interval || 30);

            autoMsgSlider.addEventListener('input', () => {
                const val = parseInt(autoMsgSlider.value, 10);
                if (autoMsgVal) autoMsgVal.textContent = formatIntervalLabel(val);
            });

            autoMsgSlider.addEventListener('change', () => {
                const val = parseInt(autoMsgSlider.value, 10);
                saveAutoMsgConfig({ interval: val });
                // Restart timer with new interval if enabled
                const cfg = getAutoMsgConfig();
                if (cfg.enabled) {
                    startAutoMessageTimer();
                }
            });
        }

    });
}

// ═══════════════════════════════════════════════════════════════════════
// STT Provider Settings Renderer
// ═══════════════════════════════════════════════════════════════════════

function _renderSttProviderSettings(P, sttEngine) {
    const container = document.getElementById(`${P}_stt_provider_settings`);
    if (!container) return;

    const provider = sttEngine.currentProvider;
    if (!provider || !provider.modelOptions) {
        container.innerHTML = '';
        return;
    }

    const providerName = sttEngine.currentProviderName;
    const savedSettings = sttEngine.getProviderSettings(providerName);

    // 是否需要 API Key + 代理（Groq / OpenAI 需要，Browser 不需要）
    const needsProxy = providerName === 'Groq' || providerName === 'OpenAI';

    // Build model options HTML
    let optionsHtml = '';
    if (Array.isArray(provider.modelOptions)) {
        const isGrouped = provider.modelOptions.length > 0 && provider.modelOptions[0].group;
        if (isGrouped) {
            optionsHtml = provider.modelOptions.map(group => {
                const opts = group.options.map(o =>
                    `<option value="${o.value}">${o.label}</option>`
                ).join('');
                return `<optgroup label="${group.group}">${opts}</optgroup>`;
            }).join('');
        } else {
            optionsHtml = provider.modelOptions.map(o =>
                `<option value="${o.value}">${o.label}</option>`
            ).join('');
        }
    }

    let html = '';

    // API Key 输入（仅 Groq / OpenAI）
    if (needsProxy) {
        html += `
        <div class="phone-settings-row">
            <label>API Key</label>
            <input id="${P}_stt_api_key" type="password" class="phone-settings-input"
                   placeholder="${providerName === 'Groq' ? 'gsk_...' : 'sk-...'}"
                   value="${savedSettings.apiKey || ''}" />
        </div>`;
    }

    // 模型选择
    if (optionsHtml) {
        html += `
        <div class="phone-settings-row">
            <label>${providerName} 模型</label>
            <select id="${P}_stt_model" class="phone-settings-input" style="height: 36px;">
                ${optionsHtml}
            </select>
        </div>`;
    }

    // 代理地址（仅 Groq / OpenAI，与 TTS 共享默认值）
    if (needsProxy) {
        // 从 TTS 设置中读取代理地址作为默认值（共享显示）
        const ttsEngine = typeof getTtsEngine === 'function' ? getTtsEngine() : null;
        const ttsProxyFallback = ttsEngine
            ? (ttsEngine.getProviderSettings('ElevenLabs')?.proxyServer
                || ttsEngine.getProviderSettings('MiniMax')?.proxyServer
                || 'https://api.entity.li')
            : 'https://api.entity.li';
        const sttProxy = savedSettings.proxyServer || ttsProxyFallback;

        html += `
        <div class="phone-settings-group-title">云服务器代理</div>
        <div class="phone-settings-row">
            <label>代理地址</label>
            <input id="${P}_stt_proxy_server" type="text" class="phone-settings-input"
                   placeholder="https://api.entity.li"
                   value="${sttProxy}" />
        </div>
        <div style="padding: 0 16px 8px; font-size: 11px; color: #8e8e93; line-height: 1.4;">
            与 TTS 共用同一个代理服务器，修改后两边都会更新。
        </div>

        <div class="phone-settings-actions">
            <button id="${P}_stt_save_btn" class="phone-settings-btn phone-settings-btn-primary">保存 STT 设置</button>
        </div>`;
    }

    container.innerHTML = html;

    // Restore saved model selection
    const modelSelect = document.getElementById(`${P}_stt_model`);
    if (modelSelect) {
        const savedModel = savedSettings.model || provider.defaultSettings?.model;
        if (savedModel) modelSelect.value = savedModel;

        // 如果不需要代理（Browser），model 变化直接保存
        if (!needsProxy) {
            modelSelect.addEventListener('change', () => {
                sttEngine.updateProviderSettings(providerName, { model: modelSelect.value });
            });
        }
    }

    // Save button click handler（Groq / OpenAI）
    const saveBtn = document.getElementById(`${P}_stt_save_btn`);
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const apiKeyInput = document.getElementById(`${P}_stt_api_key`);
            const proxyInput = document.getElementById(`${P}_stt_proxy_server`);
            const proxyValue = proxyInput?.value?.trim() || 'https://api.entity.li';

            // 保存 STT provider settings
            sttEngine.updateProviderSettings(providerName, {
                apiKey: apiKeyInput?.value?.trim() || '',
                model: modelSelect?.value || provider.defaultSettings?.model,
                proxyServer: proxyValue,
            });

            // 同步代理地址到 TTS（共享）
            const ttsEngine = typeof getTtsEngine === 'function' ? getTtsEngine() : null;
            if (ttsEngine) {
                const elevS = ttsEngine.getProviderSettings('ElevenLabs');
                const mmS = ttsEngine.getProviderSettings('MiniMax');
                ttsEngine.updateProviderSettings('ElevenLabs', { ...elevS, proxyServer: proxyValue });
                ttsEngine.updateProviderSettings('MiniMax', { ...mmS, proxyServer: proxyValue });
            }

            showToast('STT 设置已保存');
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Ambient Card — dynamic render + event binding
// ═══════════════════════════════════════════════════════════════════════

function _renderAmbientCard(P) {
    const container = document.getElementById(`${P}_ambient_card`);
    if (!container) return;

    const info = getAmbientInfo();

    container.innerHTML = `
        <div class="phone-ambient-content">
            <div class="phone-ambient-header">
                <div class="phone-ambient-info">
                    <i class="ph ph-waveform phone-ambient-icon"></i>
                    <div>
                        <div class="phone-ambient-name">${escapeHtml(info.name)}</div>
                        <div class="phone-ambient-hint">通话中你对象思考时播放低音量背景音</div>
                    </div>
                </div>
                <button id="${P}_ambient_toggle" class="phone-settings-ios-toggle ${info.enabled ? 'active' : ''}" aria-checked="${info.enabled}">
                    <span class="phone-settings-ios-toggle-knob"></span>
                </button>
            </div>
            <div class="phone-ambient-actions">
                <button id="${P}_ambient_preview_btn" class="phone-settings-btn phone-ambient-preview-btn">
                    <i class="ph ph-play"></i> 试听
                </button>
                <label for="${P}_ambient_upload_input" class="phone-settings-btn phone-ambient-upload-btn">
                    <i class="ph ph-upload-simple"></i> 自己上传
                </label>
                <input id="${P}_ambient_upload_input" type="file" accept="audio/*" style="display:none;" />
                ${info.isCustom ? `
                <button id="${P}_ambient_reset_btn" class="phone-settings-btn phone-ambient-reset-btn">
                    <i class="ph ph-arrow-counter-clockwise"></i> 恢复默认
                </button>` : ''}
            </div>
        </div>
    `;

    // Toggle
    const toggle = document.getElementById(`${P}_ambient_toggle`);
    if (toggle) {
        toggle.addEventListener('click', () => {
            const nowEnabled = toggle.getAttribute('aria-checked') === 'true';
            const newState = !nowEnabled;
            setAmbientEnabled(newState);
            toggle.setAttribute('aria-checked', String(newState));
            toggle.classList.toggle('active', newState);
            showToast(newState ? '氛围音已开启' : '氛围音已关闭');
        });
    }

    // Preview
    const previewBtn = document.getElementById(`${P}_ambient_preview_btn`);
    if (previewBtn) {
        previewBtn.addEventListener('click', async () => {
            if (isAmbientPlaying()) {
                stopAmbient();
                previewBtn.innerHTML = '<i class="ph ph-play"></i> 试听';
                previewBtn.classList.remove('playing');
            } else {
                // Ensure audio is downloaded/cached first
                previewBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 加载中...';
                await initAmbient();
                const ok = startAmbient();
                if (ok) {
                    previewBtn.innerHTML = '<i class="ph ph-stop"></i> 停止';
                    previewBtn.classList.add('playing');
                } else {
                    previewBtn.innerHTML = '<i class="ph ph-play"></i> 试听';
                    showToast('暂无可用的氛围音');
                }
            }
        });
    }

    // Upload
    const uploadInput = document.getElementById(`${P}_ambient_upload_input`);
    if (uploadInput) {
        uploadInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                stopAmbient();
                showToast('正在上传...');
                await uploadUserAmbient(file);
                _renderAmbientCard(P);
                showToast('氛围音已更换！');
            } catch (err) {
                showToast('上传失败: ' + (err.message || '未知错误'));
            }
        });
    }

    // Reset
    const resetBtn = document.getElementById(`${P}_ambient_reset_btn`);
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            stopAmbient();
            clearUserAmbient();
            _renderAmbientCard(P);
            showToast('已恢复默认氛围音');
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Ringtone Card — dynamic render + event binding
// ═══════════════════════════════════════════════════════════════════════

/**
 * Render the ringtone selection card inside the voice call settings.
 * 3 states: unselected → selecting → selected (with reveal).
 * @param {string} P - Settings ID prefix
 */
function _renderRingtoneCard(P) {
    const container = document.getElementById(`${P}_ringtone_card`);
    if (!container) return;

    const ringtone = getCurrentRingtone();

    if (ringtone) {
        // ── State C: Selected (reveal!) ──
        const isUserUploaded = ringtone.source === 'user';
        const moodTags = (ringtone.mood || []).join(' · ');
        container.innerHTML = `
            <div class="phone-ringtone-selected">
                <div class="phone-ringtone-reveal-header">
                    <i class="ph ph-music-note phone-ringtone-icon"></i>
                    <span class="phone-ringtone-name">${escapeHtml(ringtone.name)}</span>
                    ${isUserUploaded ? '<span class="phone-ringtone-user-badge"><i class="ph ph-upload-simple"></i> 自选</span>' : ''}
                </div>
                ${!isUserUploaded && moodTags ? `<div class="phone-ringtone-mood">${escapeHtml(moodTags)}</div>` : ''}
                ${!isUserUploaded && ringtone.reason ? `<div class="phone-ringtone-reason">"${escapeHtml(ringtone.reason)}"</div>` : ''}
                <div class="phone-ringtone-actions">
                    <button id="${P}_ringtone_preview_btn" class="phone-settings-btn phone-ringtone-preview-btn">
                        <i class="ph ph-play"></i> 试听
                    </button>
                    <button id="${P}_ringtone_reselect_btn" class="phone-settings-btn phone-ringtone-reselect-btn">
                        <i class="ph ph-arrow-counter-clockwise"></i> 重新选择
                    </button>
                </div>
            </div>
        `;

        // Bind preview button
        const previewBtn = document.getElementById(`${P}_ringtone_preview_btn`);
        if (previewBtn) {
            previewBtn.addEventListener('click', () => {
                if (isRingtonePlaying()) {
                    stopRingtone();
                    previewBtn.innerHTML = '<i class="ph ph-play"></i> 试听';
                    previewBtn.classList.remove('playing');
                } else {
                    playRingtone();
                    previewBtn.innerHTML = '<i class="ph ph-stop"></i> 停止';
                    previewBtn.classList.add('playing');
                }
            });
        }

        // Bind reselect button
        const reselectBtn = document.getElementById(`${P}_ringtone_reselect_btn`);
        if (reselectBtn) {
            reselectBtn.addEventListener('click', () => {
                stopRingtone();
                clearRingtoneSelection();
                _renderRingtoneCard(P); // Re-render to show unselected state
            });
        }
    } else {
        // ── State A: Not selected ──
        container.innerHTML = `
            <div class="phone-ringtone-empty">
                <div class="phone-ringtone-empty-icon">
                    <i class="ph ph-question"></i>
                </div>
                <div class="phone-ringtone-empty-text">??? (尚未选择)</div>
                <div class="phone-ringtone-empty-actions">
                    <button id="${P}_ringtone_select_btn" class="phone-settings-btn phone-settings-btn-primary phone-ringtone-select-btn">
                        <i class="ph ph-music-notes"></i> 让Ta选
                    </button>
                    <label for="${P}_ringtone_upload_input" class="phone-settings-btn phone-ringtone-upload-btn">
                        <i class="ph ph-upload-simple"></i> 自己选
                    </label>
                    <input id="${P}_ringtone_upload_input" type="file" accept="audio/*" style="display:none;" />
                </div>
            </div>
        `;

        // Bind select button (LLM selection)
        const selectBtn = document.getElementById(`${P}_ringtone_select_btn`);
        if (selectBtn) {
            selectBtn.addEventListener('click', async () => {
                // ── State B: Selecting (loading) ──
                const charName = getPhoneCharInfo()?.name || 'TA';
                container.innerHTML = `
                    <div class="phone-ringtone-loading">
                        <div class="phone-ringtone-loading-icon">
                            <i class="ph ph-music-notes phone-ringtone-bounce"></i>
                        </div>
                        <div class="phone-ringtone-loading-text">${escapeHtml(charName)} 正在挑选中...</div>
                    </div>
                `;

                try {
                    await runSelectionFlow((status) => {
                        const textEl = container.querySelector('.phone-ringtone-loading-text');
                        if (textEl) textEl.textContent = status;
                    });

                    // Re-render to show selected state
                    _renderRingtoneCard(P);
                    showToast('铃声已选好！');
                } catch (e) {
                    console.error('[RingtoneSettings] Selection failed:', e);
                    showToast('铃声选择失败: ' + (e.message || '未知错误'));
                    _renderRingtoneCard(P); // Reset to unselected state
                }
            });
        }

        // Bind upload button (user upload)
        const uploadInput = document.getElementById(`${P}_ringtone_upload_input`);
        if (uploadInput) {
            uploadInput.addEventListener('change', async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;

                // Show loading state
                container.innerHTML = `
                    <div class="phone-ringtone-loading">
                        <div class="phone-ringtone-loading-icon">
                            <i class="ph ph-upload-simple phone-ringtone-bounce"></i>
                        </div>
                        <div class="phone-ringtone-loading-text">正在上传铃声...</div>
                    </div>
                `;

                try {
                    await uploadUserRingtone(file, (status) => {
                        const textEl = container.querySelector('.phone-ringtone-loading-text');
                        if (textEl) textEl.textContent = status;
                    });

                    _renderRingtoneCard(P);
                    showToast('铃声已上传！');
                } catch (err) {
                    console.error('[RingtoneSettings] Upload failed:', err);
                    showToast('上传失败: ' + (err.message || '未知错误'));
                    _renderRingtoneCard(P);
                }
            });
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Appearance Helpers (exported for phoneController to call on open)
// ═══════════════════════════════════════════════════════════════════════

export function applyWallpaper(base64Url) {
    const wallpaperEl = document.querySelector('.phone-wallpaper');
    if (!wallpaperEl) return;
    if (base64Url) {
        wallpaperEl.style.background = `url(${base64Url}) center/cover no-repeat`;
    } else {
        wallpaperEl.style.background = '';
    }
}

export function applyDarkMode(enabled) {
    const container = document.querySelector('.phone-container');
    if (!container) return;
    container.classList.toggle('phone-dark-mode', enabled);
}

export function applySavedAppearance() {
    const wallpaper = localStorage.getItem('gf_phone_wallpaper');
    if (wallpaper) applyWallpaper(wallpaper);

    const isDark = localStorage.getItem('gf_phone_dark_mode') === 'true';
    applyDarkMode(isDark);
}

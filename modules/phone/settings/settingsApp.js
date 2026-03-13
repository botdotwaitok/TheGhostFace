// ui/phone/settings/settingsApp.js — Settings app for the GF Phone
// iPhone-style layout: top profile card → account detail page → module settings

import { openAppInViewport } from '../phoneController.js';
import { escapeHtml } from '../utils/helpers.js';
import { isConsoleEnabled, setConsoleEnabled, openConsoleApp } from '../console/consoleApp.js';
import { isKeepAliveEnabled, setKeepAliveEnabled, startKeepAlive, stopKeepAlive } from '../keepAlive.js';
import { getConfig as getAutoMsgConfig, saveConfig as saveAutoMsgConfig, startAutoMessageTimer, stopAutoMessageTimer, formatIntervalLabel } from '../chat/autoMessage.js';
import { isDiaryEnabled, getDiaryMode, setDiaryEnabled, setDiaryMode } from '../diary/diaryApp.js';
import {
    populateSettings, saveSettingsFromUI, toggleEnable, updateToggleBtn,
    onClick, bindSlider, showToast, getVal
} from '../moments/momentsUI.js';
import * as moments from '../moments/moments.js';
import { loadTreeData, getTreeState, updateTreeState, updateTreeSettings } from '../tree/treeStorage.js';
import { disableTreeWorldInfo, updateTreeWorldInfo } from '../tree/treeWorldInfo.js';
import { getCurrentSeason, getStageByGrowth } from '../tree/treeConfig.js';
import { getPhoneCharInfo, getPhoneUserName } from '../phoneContext.js';
import { getAllActiveWorldBookNames, getAllActiveEntries } from '../../worldbookManager.js';
import {
    isBookBlockedInScope, isEntryBlockedInScope,
    toggleBookBlock, toggleEntryBlock
} from './wbBlacklist.js';

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
                showToast('绑定成功！🔗');
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
        <div class="phone-settings-section" style="background: rgba(255,255,255,0.85); backdrop-filter: blur(20px); border-radius: 12px; margin-bottom: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
            <div class="phone-settings-section-body" style="padding: 16px;">
                <div class="phone-settings-group-title" style="margin-top: 0;">服务器连接</div>
                <div class="phone-settings-row">
                    <label>后端地址 (Backend URL)</label>
                    <input id="${P}_backend_url" type="text" class="phone-settings-input" placeholder="https://your-server.com:3421" />
                </div>
                <div class="phone-settings-row">
                    <label>密钥 (Secret Token)</label>
                    <input id="${P}_secret_token" type="password" class="phone-settings-input" placeholder="your-secret-token" />
                </div>
            </div>
        </div>

        <!-- ═══ Auth / Profile Section ═══ -->
        <div class="phone-settings-section" style="background: rgba(255,255,255,0.85); backdrop-filter: blur(20px); border-radius: 12px; margin-bottom: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
            <div class="phone-settings-section-body" style="padding: 16px;">
                <div id="${P}_auth_container" class="moments-auth-container"></div>
            </div>
        </div>

        <!-- ═══ Your ID (only when logged in) ═══ -->
        <div id="${P}_id_section" class="phone-settings-section" style="background: rgba(255,255,255,0.85); backdrop-filter: blur(20px); border-radius: 12px; margin-bottom: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); ${isLoggedIn ? '' : 'display: none;'}">
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
        <div id="${P}_discord_section" class="phone-settings-section" style="background: rgba(255,255,255,0.85); backdrop-filter: blur(20px); border-radius: 12px; margin-bottom: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); ${isLoggedIn ? '' : 'display: none;'}">
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
        <div id="${P}_logout_section" style="${isLoggedIn ? '' : 'display: none;'}">
            <button id="${P}_logout_btn" class="phone-settings-btn" style="width: 100%; background: rgba(255, 59, 48, 0.1); color: #ff3b30; border: none; border-radius: 12px; padding: 14px; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 8px;">
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
                            showToast('名称已更新 ✅');
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
                            showToast('头像已同步更新 ✅');
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
            <div style="font-size: 17px; font-weight: 600; color: #1c1c1e; margin-bottom: 6px;">绑定 Discord 账号</div>
            <div style="font-size: 13px; color: #8e8e93; line-height: 1.6; padding: 0 12px;">
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
                    <div style="font-size: 20px; font-weight: 600; color: #1c1c1e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${escapeHtml(s.displayName || 'User')}
                    </div>
                    <div style="font-size: 13px; color: #8e8e93; margin-top: 2px;">
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
                    <div style="font-size: 17px; font-weight: 600; color: #1c1c1e;">登录 / 注册</div>
                    <div style="font-size: 13px; color: #8e8e93; margin-top: 2px;">点击管理你的账号</div>
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

        <!-- ═══ 聊天 (Chat Settings — merged from 消息提醒 + 回家模式) ═══ -->
        <details class="phone-settings-section">
            <summary class="phone-settings-section-header">
                <span class="phone-settings-section-icon" style="background: linear-gradient(135deg, #667EEA, #764BA2);"><i class="fa-solid fa-comments"></i></span>
                <span>聊天</span>
                <i class="fa-solid fa-chevron-down phone-settings-chevron"></i>
            </summary>
            <div class="phone-settings-section-body">

                <div class="phone-settings-group-title">后台保活</div>
                <div class="phone-settings-row">
                    <div class="phone-settings-toggle-row">
                        <span class="phone-settings-toggle-label">静默保活（iOS推荐开启）</span>
                        <button id="${P}_keepalive_toggle" class="phone-settings-ios-toggle" aria-checked="false">
                            <span class="phone-settings-ios-toggle-knob"></span>
                        </button>
                    </div>
                </div>
                <div style="padding: 0 16px 12px; font-size: 12px; color: #8e8e93; line-height: 1.5;">
                    防止浏览器杀掉后台进程。开启后，发送聊天消息时会自动播放无声音频保持页面活跃（注意，不能看视频/听音乐）。推荐 iOS 用户开启。
                </div>

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
                            <span class="phone-settings-mode-card-badge" style="background: rgba(255,107,157,0.15); color: #FF6B9D;">⚠️ 高Token</span>
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
                    showToast('壁纸已更换 🖼️');
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
                showToast(newState ? '已切换为深色模式 🌙' : '已切换为浅色模式 ☀️');
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
                showToast(newState ? '日记本已启用 📔' : '日记本已关闭');
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
                const label = card.dataset.diaryMode === 'auto' ? '自动模式 🤖' : '手动模式 ✍️';
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
                showToast(newState ? 'Console 已启用 🖥️' : 'Console 已关闭');
            });
        }

        // ═══ Keep-Alive: Enable Toggle ═══
        const keepAliveToggle = document.getElementById(`${P}_keepalive_toggle`);
        const keepAliveOn = isKeepAliveEnabled();
        if (keepAliveToggle) {
            keepAliveToggle.setAttribute('aria-checked', String(keepAliveOn));
            if (keepAliveOn) keepAliveToggle.classList.add('active');
            keepAliveToggle.addEventListener('click', () => {
                const wasOn = keepAliveToggle.getAttribute('aria-checked') === 'true';
                const newState = !wasOn;
                keepAliveToggle.setAttribute('aria-checked', String(newState));
                keepAliveToggle.classList.toggle('active', newState);
                setKeepAliveEnabled(newState);
                if (newState) {
                    startKeepAlive();
                    showToast('静默保活已开启 🔒');
                } else {
                    stopKeepAlive();
                    showToast('静默保活已关闭');
                }
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

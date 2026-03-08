// ui/phone/settings/settingsApp.js — Settings app for the GF Phone
// iPhone-style layout: top profile card → account detail page → module settings

import { openAppInViewport } from '../phoneController.js';
import { isDiaryEnabled, getDiaryMode, setDiaryEnabled, setDiaryMode } from '../diary/diaryApp.js';
import {
    populateSettings, saveSettingsFromUI, toggleEnable, updateToggleBtn,
    onClick, bindSlider, showToast, getVal
} from '../moments/momentsUI.js';
import * as moments from '../moments/moments.js';

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

// ═══════════════════════════════════════════════════════════════════════
// Helper: escape HTML
// ═══════════════════════════════════════════════════════════════════════
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════════════════
// Account Detail Page (opened when tapping the profile card)
// ═══════════════════════════════════════════════════════════════════════

function openAccountDetailPage() {
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
                await moments.login(u, p);
                showToast('登录成功! 🎉');
            } else {
                await moments.register(u, p, n);
                showToast('注册成功! 🎉');
            }
            // Re-open account page to show logged-in state
            openAccountDetailPage();
        } catch (e) {
            if (errEl) errEl.textContent = e.message;
            btn.disabled = false;
            btn.textContent = isLogin ? '登录' : '注册';
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
                <span>朋友圈设置</span>
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
                <span>日记本设置</span>
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
                            <span class="phone-settings-mode-card-icon">✍️</span>
                            <span class="phone-settings-mode-card-title">手动模式</span>
                            <span class="phone-settings-mode-card-badge">推荐·省Token</span>
                        </div>
                        <div class="phone-settings-mode-card-desc">你写一条日记，你对象回应一条。不消耗额外 Token。</div>
                    </div>
                    <div class="phone-settings-mode-card" data-diary-mode="auto" id="${P}_diary_mode_auto">
                        <div class="phone-settings-mode-card-header">
                            <span class="phone-settings-mode-card-icon">🤖</span>
                            <span class="phone-settings-mode-card-title">自动模式</span>
                            <span class="phone-settings-mode-card-badge" style="background: rgba(255,107,157,0.15); color: #FF6B9D;">消耗更多Token</span>
                        </div>
                        <div class="phone-settings-mode-card-desc">日记内容持续注入世界书，你对象有几率主动写日记回应。</div>
                    </div>
                </div>

            </div>
        </details>

        <!-- ═══ 通知设置 ═══ -->
        <details class="phone-settings-section">
            <summary class="phone-settings-section-header">
                <span class="phone-settings-section-icon" style="background: linear-gradient(135deg, #667EEA, #764BA2);"><i class="fa-solid fa-bell"></i></span>
                <span>通知设置</span>
                <i class="fa-solid fa-chevron-down phone-settings-chevron"></i>
            </summary>
            <div class="phone-settings-section-body">
                <div class="phone-settings-coming-soon">🚀 即将上线</div>
            </div>
        </details>

        <!-- ═══ 外观设置 ═══ -->
        <details class="phone-settings-section">
            <summary class="phone-settings-section-header">
                <span class="phone-settings-section-icon" style="background: linear-gradient(135deg, #38B2AC, #2C7A7B);"><i class="fa-solid fa-palette"></i></span>
                <span>外观设置</span>
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

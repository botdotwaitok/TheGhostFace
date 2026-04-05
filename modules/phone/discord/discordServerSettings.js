// modules/phone/discord/discordServerSettings.js — Server detail & settings page
// Handles: server info edit, member/role/channel management, auto-chat config, danger zone.

import { openAppInViewport } from '../phoneController.js';
import { escapeHtml } from '../utils/helpers.js';
import {
    loadServerConfig, saveServerConfig,
    loadMembers, loadRoles, saveRoles, addRole, removeRole, updateRole,
    addCategory, addChannel, removeCategory, removeChannel,
    loadAutoChatConfig, saveAutoChatConfig,
    resetAllData, getAllChannels, clearChannelMessages, generateId,
    getMemberAvatarUrl, uploadFileToST
} from './discordStorage.js';
import { openMembersPage } from './discordMembers.js';
import { startAutoChatTimer, stopAutoChatTimer } from './discordAutoChat.js';
import { buildStickerManagementHtml, bindStickerManagementEvents } from './discordEmoji.js';

const LOG = '[Discord Settings]';

// ═══════════════════════════════════════════════════════════════════════
// External Navigation Callback
// ═══════════════════════════════════════════════════════════════════════

let _returnToHome = null;

/**
 * Open the Server Settings page.
 * @param {Function} onReturn - Callback to return to server home
 */
export function openServerSettings(onReturn = null) {
    _returnToHome = onReturn;
    _renderSettingsPage();
}

// ═══════════════════════════════════════════════════════════════════════
// Settings Page Render
// ═══════════════════════════════════════════════════════════════════════

function _renderSettingsPage() {
    const config = loadServerConfig();
    if (!config) return;

    const members = loadMembers();
    const roles = loadRoles();
    const autoChatConfig = loadAutoChatConfig();

    const html = `
        <div class="dc-server-page dc-fade-in" id="dc_settings_page">
            <div class="dc-settings-scroll">
                ${_buildServerInfoSection(config)}
                ${_buildMembersSection(members)}
                ${_buildRolesSection(roles)}
                ${_buildStickersSection()}
                ${_buildChannelsSection(config)}
                ${_buildAutoChatSection(autoChatConfig)}
                ${_buildDangerZone()}
            </div>
        </div>
    `;

    const titleHtml = `<span style="font-weight:600;">服务器设置</span>`;

    openAppInViewport(titleHtml, html, () => {
        _bindSettingsEvents(config);
        // Back button
        const backHandler = (e) => {
            e.preventDefault();
            window.removeEventListener('phone-app-back', backHandler);
            if (_returnToHome) _returnToHome();
        };
        window.addEventListener('phone-app-back', backHandler);
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Section Builders
// ═══════════════════════════════════════════════════════════════════════

function _buildServerInfoSection(config) {
    const bannerPreviewHtml = config.banner
        ? `<img src="${config.banner}" style="width:100%; height:100%; object-fit:cover; display:block;" />`
        : `<i class="ph ph-image" style="font-size:24px; color:var(--dc-text-muted);"></i>`;

    return `
        <div class="dc-settings-section">
            <div class="dc-settings-section-title">
                <i class="ph ph-house"></i> 服务器信息
            </div>
            <div class="dc-settings-card">
                <div class="dc-form-section">
                    <div class="dc-form-label">服务器名称</div>
                    <input type="text" class="dc-input" id="dc_server_name"
                           value="${escapeHtml(config.name)}" maxlength="40" />
                </div>
                <div class="dc-form-section">
                    <div class="dc-form-label">服务器描述</div>
                    <textarea class="dc-input dc-textarea" id="dc_server_desc"
                              placeholder="描述你的社区..."
                              maxlength="200">${escapeHtml(config.description || '')}</textarea>
                </div>
                <div class="dc-form-section">
                    <div class="dc-form-label">服务器 Banner 图片</div>
                    <div class="dc-settings-banner-preview" id="dc_server_banner_preview"
                         style="width: 100%; height: 100px; background-color: var(--dc-bg-tertiary); border-radius: 8px; margin-bottom: 8px; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative;">
                        ${bannerPreviewHtml}
                        <input type="file" id="dc_server_banner_input" accept="image/png, image/jpeg, image/gif" style="display:none;" />
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="dc-btn dc-btn-secondary dc-btn-sm" id="dc_server_banner_upload_btn" style="flex: 1;">上传图片</button>
                        ${config.banner ? `<button class="dc-btn dc-btn-danger-outline dc-btn-sm" id="dc_server_banner_remove_btn" style="flex: 1;">移除图片</button>` : ''}
                    </div>
                </div>
                <button class="dc-btn dc-btn-primary dc-btn-sm" id="dc_server_info_save" style="margin-top: 12px; width: 100%;">
                    <i class="ph ph-check"></i> 保存
                </button>
            </div>
        </div>
    `;
}

function _buildMembersSection(members) {
    const memberCount = members.length;
    // Show first few member avatars as preview
    const previewAvatars = members.slice(0, 5).map(m => {
        const initial = (m.name || '?').charAt(0);
        const avatarUrl = getMemberAvatarUrl(m);
        return avatarUrl
            ? `<div class="dc-avatar small" style="background:${m.avatarColor || '#5865f2'}"><img src="${avatarUrl}" alt="" /></div>`
            : `<div class="dc-avatar small" style="background:${m.avatarColor || '#5865f2'}">${escapeHtml(initial)}</div>`;
    }).join('');
    const moreCount = memberCount > 5 ? `<span class="dc-member-more">+${memberCount - 5}</span>` : '';

    return `
        <div class="dc-settings-section">
            <div class="dc-settings-section-title">
                <i class="ph ph-users"></i> 成员管理
            </div>
            <div class="dc-settings-card dc-settings-card-clickable" id="dc_settings_members_btn">
                <div class="dc-settings-members-preview">
                    <div class="dc-settings-avatar-stack">
                        ${previewAvatars}${moreCount}
                    </div>
                    <div class="dc-settings-members-info">
                        <span>${memberCount} 位成员</span>
                        <span class="dc-settings-members-hint">点击管理</span>
                    </div>
                </div>
                <i class="ph ph-caret-right dc-settings-chevron"></i>
            </div>
        </div>
    `;
}

function _buildRolesSection(roles) {
    const roleItems = roles.map(r => `
        <div class="dc-role-item" data-role-id="${r.id}">
            <div class="dc-role-color-dot" style="background:${r.color}"></div>
            <div class="dc-role-item-name">${escapeHtml(r.name)}</div>
            <div class="dc-role-item-actions">
                <button class="dc-icon-btn dc-role-edit-btn" data-role-id="${r.id}" title="编辑">
                    <i class="ph ph-pencil-simple"></i>
                </button>
                <button class="dc-icon-btn dc-role-delete-btn" data-role-id="${r.id}" title="删除">
                    <i class="ph ph-trash"></i>
                </button>
            </div>
        </div>
    `).join('');

    return `
        <div class="dc-settings-section">
            <div class="dc-settings-section-title">
                <i class="ph ph-crown"></i> 身份组
            </div>
            <div class="dc-settings-card">
                <div class="dc-roles-list" id="dc_roles_list">
                    ${roleItems}
                </div>
                <button class="dc-btn dc-btn-secondary dc-btn-sm" id="dc_role_add_btn">
                    <i class="ph ph-plus"></i> 添加身份组
                </button>
            </div>
        </div>
    `;
}

function _buildStickersSection() {
    return `
        <div class="dc-settings-section">
            <div class="dc-settings-section-title">
                <i class="ph ph-sticker"></i> 表情包管理
            </div>
            <div class="dc-settings-card">
                ${buildStickerManagementHtml()}
                <div class="dc-form-note" style="margin-top:8px;">
                    <i class="ph ph-info"></i>
                    上传图片或填入URL来添加自定义表情包。成员可以在聊天中使用 :表情名: 来发送表情包。
                </div>
            </div>
        </div>
    `;
}

function _buildChannelsSection(config) {
    const categories = config.categories || [];

    const catItems = categories.map(cat => {
        const channelItems = (cat.channels || []).map(ch => `
            <div class="dc-channel-manage-item" data-channel-id="${ch.id}" data-cat-id="${cat.id}">
                <span class="dc-channel-manage-hash">#</span>
                <span class="dc-channel-manage-name">${escapeHtml(ch.name)}</span>
                <div class="dc-channel-manage-actions">
                    <button class="dc-icon-btn dc-ch-rename-btn" data-channel-id="${ch.id}" title="重命名">
                        <i class="ph ph-pencil-simple"></i>
                    </button>
                    <button class="dc-icon-btn dc-ch-delete-btn" data-channel-id="${ch.id}" title="删除">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');

        return `
            <div class="dc-category-manage" data-cat-id="${cat.id}">
                <div class="dc-category-manage-header">
                    <span class="dc-category-manage-name">${escapeHtml(cat.name)}</span>
                    <div class="dc-category-manage-actions">
                        <button class="dc-icon-btn dc-cat-add-ch-btn" data-cat-id="${cat.id}" title="添加频道">
                            <i class="ph ph-plus"></i>
                        </button>
                        <button class="dc-icon-btn dc-cat-rename-btn" data-cat-id="${cat.id}" title="重命名">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="dc-icon-btn dc-cat-delete-btn" data-cat-id="${cat.id}" title="删除">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="dc-category-channels-manage">
                    ${channelItems}
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="dc-settings-section">
            <div class="dc-settings-section-title">
                <i class="ph ph-hash"></i> 频道管理
            </div>
            <div class="dc-settings-card">
                <div class="dc-channels-manage-list" id="dc_channels_manage">
                    ${catItems}
                </div>
                <button class="dc-btn dc-btn-secondary dc-btn-sm" id="dc_cat_add_btn">
                    <i class="ph ph-plus"></i> 添加分类
                </button>
            </div>
        </div>
    `;
}

function _buildAutoChatSection(autoChatConfig) {
    const checked = autoChatConfig.enabled ? 'checked' : '';
    const interval = autoChatConfig.interval || 30;

    return `
        <div class="dc-settings-section">
            <div class="dc-settings-section-title">
                <i class="ph ph-robot"></i> 自动群聊
            </div>
            <div class="dc-settings-card">
                <div class="dc-settings-row">
                    <span class="dc-settings-row-label">启用自动群聊</span>
                    <label class="dc-toggle">
                        <input type="checkbox" id="dc_auto_chat_toggle" ${checked} />
                        <span class="dc-toggle-slider"></span>
                    </label>
                </div>
                <div class="dc-settings-row">
                    <span class="dc-settings-row-label">
                        间隔时间
                        <span class="dc-settings-row-value" id="dc_auto_chat_value">${interval} 分钟</span>
                    </span>
                    <input type="range" class="dc-slider" id="dc_auto_chat_slider"
                           min="5" max="120" step="5" value="${interval}" />
                </div>
                <div class="dc-form-note" style="margin-top:8px;">
                    <i class="ph ph-info"></i>
                    开启后，社区成员会在随机频道自动发起对话
                </div>
            </div>
        </div>
    `;
}

function _buildDangerZone() {
    return `
        <div class="dc-settings-section">
            <div class="dc-settings-section-title dc-danger-title">
                <i class="ph ph-warning"></i> 危险区域
            </div>
            <div class="dc-settings-card dc-danger-card">
                <button class="dc-btn dc-btn-danger-outline dc-btn-sm dc-btn-full" id="dc_clear_all_messages">
                    <i class="ph ph-broom"></i> 清空所有聊天记录
                </button>
                <button class="dc-btn dc-btn-danger dc-btn-sm dc-btn-full" id="dc_reset_server">
                    <i class="ph ph-trash"></i> 重置整个服务器
                </button>
            </div>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════════════════
// Settings Events
// ═══════════════════════════════════════════════════════════════════════

function _bindSettingsEvents(config) {
    // ── Server Info Save ──
    document.getElementById('dc_server_info_save')?.addEventListener('click', () => {
        const nameVal = document.getElementById('dc_server_name')?.value?.trim();
        const descVal = document.getElementById('dc_server_desc')?.value?.trim() || '';
        if (!nameVal) {
            if (typeof toastr !== 'undefined') toastr.warning('服务器名称不能为空');
            return;
        }
        const updated = loadServerConfig();
        if (updated) {
            updated.name = nameVal;
            updated.description = descVal;
            saveServerConfig(updated);
            if (typeof toastr !== 'undefined') toastr.success('服务器信息已保存');
            _renderSettingsPage();
        }
    });

    // ── Server Banner Upload ──
    const bannerInput = document.getElementById('dc_server_banner_input');
    document.getElementById('dc_server_banner_upload_btn')?.addEventListener('click', () => {
        bannerInput?.click();
    });

    bannerInput?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            const base64Url = event.target.result;
            try {
                if (typeof toastr !== 'undefined') toastr.info('正在上传图片...');
                const webPath = await uploadFileToST(base64Url, 'discord_banner');
                const config = loadServerConfig();
                config.banner = webPath;
                saveServerConfig(config);
                if (typeof toastr !== 'undefined') toastr.success('Banner 上传成功');
                _renderSettingsPage();
            } catch (err) {
                console.error(`${LOG} Banner upload failed:`, err);
                if (typeof toastr !== 'undefined') toastr.error('Banner 上传失败');
            }
        };
        reader.readAsDataURL(file);
    });

    // ── Server Banner Remove ──
    document.getElementById('dc_server_banner_remove_btn')?.addEventListener('click', () => {
        const config = loadServerConfig();
        config.banner = null;
        saveServerConfig(config);
        if (typeof toastr !== 'undefined') toastr.success('Banner 已移除');
        _renderSettingsPage();
    });

    // ── Members Section → open members page ──
    document.getElementById('dc_settings_members_btn')?.addEventListener('click', () => {
        openMembersPage(() => _renderSettingsPage());
    });

    // ── Role Management ──
    _bindRoleEvents();

    // ── Sticker Management ──
    bindStickerManagementEvents(() => _renderSettingsPage());

    // ── Channel Management ──
    _bindChannelEvents();

    // ── Auto-Chat Config ──
    _bindAutoChatEvents();

    // ── Danger Zone ──
    _bindDangerEvents();
}

// ─── Role Events ───

function _bindRoleEvents() {
    // Add role
    document.getElementById('dc_role_add_btn')?.addEventListener('click', () => {
        _showRoleDialog(null);
    });

    // Edit role
    document.querySelectorAll('.dc-role-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const roleId = btn.dataset.roleId;
            _showRoleDialog(roleId);
        });
    });

    // Delete role
    document.querySelectorAll('.dc-role-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const roleId = btn.dataset.roleId;
            if (!confirm('确定要删除这个身份组吗？所有成员将被移除该身份组。')) return;
            removeRole(roleId);
            if (typeof toastr !== 'undefined') toastr.success('身份组已删除');
            _renderSettingsPage();
        });
    });
}

function _showRoleDialog(roleId) {
    const isEdit = !!roleId;
    const role = isEdit ? loadRoles().find(r => r.id === roleId) : null;

    const name = role?.name || '';
    const color = role?.color || '#5865f2';

    const colorPalette = [
        '#e74c3c', '#e91e63', '#eb459e', '#9b59b6', '#7c3aed',
        '#5865f2', '#3498db', '#1abc9c', '#2ecc71', '#57f287',
        '#f39c12', '#fee75c', '#e67e22', '#ed4245', '#99aab5',
        '#2c3e50',
    ];

    const colorOptions = colorPalette.map(c => {
        const selected = c === color ? 'dc-color-selected' : '';
        return `<div class="dc-color-dot ${selected}" data-color="${c}" style="background:${c}"></div>`;
    }).join('');

    // Create inline dialog overlay
    const overlay = document.createElement('div');
    overlay.className = 'dc-dialog-overlay dc-fade-in';
    overlay.innerHTML = `
        <div class="dc-dialog">
            <div class="dc-dialog-title">${isEdit ? '编辑身份组' : '添加身份组'}</div>
            <div class="dc-form-section">
                <div class="dc-form-label">名称</div>
                <input type="text" class="dc-input" id="dc_role_dialog_name"
                       value="${escapeHtml(name)}" placeholder="身份组名称" maxlength="20" />
            </div>
            <div class="dc-form-section">
                <div class="dc-form-label">颜色</div>
                <div class="dc-color-palette" id="dc_role_dialog_colors">
                    ${colorOptions}
                </div>
            </div>
            <div class="dc-dialog-actions">
                <button class="dc-btn dc-btn-secondary dc-btn-sm" id="dc_role_dialog_cancel">取消</button>
                <button class="dc-btn dc-btn-primary dc-btn-sm" id="dc_role_dialog_save">
                    ${isEdit ? '保存' : '添加'}
                </button>
            </div>
        </div>
    `;

    const page = document.getElementById('dc_settings_page');
    if (!page) return;
    page.style.position = 'relative';
    page.appendChild(overlay);

    let selectedColor = color;

    // Color picker events
    overlay.querySelectorAll('.dc-color-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            overlay.querySelectorAll('.dc-color-dot').forEach(d => d.classList.remove('dc-color-selected'));
            dot.classList.add('dc-color-selected');
            selectedColor = dot.dataset.color;
        });
    });

    // Cancel
    document.getElementById('dc_role_dialog_cancel')?.addEventListener('click', () => {
        overlay.remove();
    });

    // Clicking overlay background closes it
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    // Save
    document.getElementById('dc_role_dialog_save')?.addEventListener('click', () => {
        const nameVal = document.getElementById('dc_role_dialog_name')?.value?.trim();
        if (!nameVal) {
            if (typeof toastr !== 'undefined') toastr.warning('请输入身份组名称');
            return;
        }

        if (isEdit) {
            updateRole(roleId, { name: nameVal, color: selectedColor });
            if (typeof toastr !== 'undefined') toastr.success('身份组已更新');
        } else {
            addRole(nameVal, selectedColor);
            if (typeof toastr !== 'undefined') toastr.success('身份组已添加');
        }

        overlay.remove();
        _renderSettingsPage();
    });
}

// ─── Channel Events ───

function _bindChannelEvents() {
    // Add category
    document.getElementById('dc_cat_add_btn')?.addEventListener('click', () => {
        const name = prompt('分类名称：');
        if (!name?.trim()) return;
        addCategory(name.trim());
        if (typeof toastr !== 'undefined') toastr.success('分类已添加');
        _renderSettingsPage();
    });

    // Add channel to category
    document.querySelectorAll('.dc-cat-add-ch-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const catId = btn.dataset.catId;
            const name = prompt('频道名称：');
            if (!name?.trim()) return;
            addChannel(catId, name.trim());
            if (typeof toastr !== 'undefined') toastr.success('频道已添加');
            _renderSettingsPage();
        });
    });

    // Rename category
    document.querySelectorAll('.dc-cat-rename-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const catId = btn.dataset.catId;
            const config = loadServerConfig();
            const cat = config?.categories?.find(c => c.id === catId);
            if (!cat) return;
            const name = prompt('新分类名称：', cat.name);
            if (!name?.trim()) return;
            cat.name = name.trim();
            saveServerConfig(config);
            if (typeof toastr !== 'undefined') toastr.success('分类已重命名');
            _renderSettingsPage();
        });
    });

    // Delete category
    document.querySelectorAll('.dc-cat-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const catId = btn.dataset.catId;
            if (!confirm('确定要删除这个分类和其中所有频道吗？频道内的聊天记录也将被清除。')) return;
            removeCategory(catId);
            if (typeof toastr !== 'undefined') toastr.success('分类已删除');
            _renderSettingsPage();
        });
    });

    // Rename channel
    document.querySelectorAll('.dc-ch-rename-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const chId = btn.dataset.channelId;
            const config = loadServerConfig();
            if (!config) return;
            for (const cat of config.categories) {
                const ch = cat.channels?.find(c => c.id === chId);
                if (ch) {
                    const name = prompt('新频道名称：', ch.name);
                    if (!name?.trim()) return;
                    ch.name = name.trim();
                    saveServerConfig(config);
                    if (typeof toastr !== 'undefined') toastr.success('频道已重命名');
                    _renderSettingsPage();
                    return;
                }
            }
        });
    });

    // Delete channel
    document.querySelectorAll('.dc-ch-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const chId = btn.dataset.channelId;
            if (!confirm('确定要删除这个频道吗？频道内的聊天记录也将被清除。')) return;
            removeChannel(chId);
            if (typeof toastr !== 'undefined') toastr.success('频道已删除');
            _renderSettingsPage();
        });
    });
}

// ─── Auto-Chat Events ───

function _bindAutoChatEvents() {
    const toggle = document.getElementById('dc_auto_chat_toggle');
    const slider = document.getElementById('dc_auto_chat_slider');
    const valueLabel = document.getElementById('dc_auto_chat_value');

    toggle?.addEventListener('change', () => {
        const config = loadAutoChatConfig();
        config.enabled = toggle.checked;
        saveAutoChatConfig(config);
        // Start or stop the auto-chat timer
        if (toggle.checked) {
            startAutoChatTimer();
            if (typeof toastr !== 'undefined') toastr.info('自动群聊已启用');
        } else {
            stopAutoChatTimer();
            if (typeof toastr !== 'undefined') toastr.info('自动群聊已停用');
        }
    });

    slider?.addEventListener('input', () => {
        const val = parseInt(slider.value, 10);
        if (valueLabel) valueLabel.textContent = `${val} 分钟`;
    });

    slider?.addEventListener('change', () => {
        const config = loadAutoChatConfig();
        config.interval = parseInt(slider.value, 10);
        saveAutoChatConfig(config);
        // Reschedule timer with new interval if active
        if (config.enabled) startAutoChatTimer();
    });
}

// ─── Danger Zone Events ───

function _bindDangerEvents() {
    // Clear all messages
    document.getElementById('dc_clear_all_messages')?.addEventListener('click', () => {
        if (!confirm('确定要清空所有频道的聊天记录吗？此操作不可撤销。')) return;
        const channels = getAllChannels();
        for (const ch of channels) {
            clearChannelMessages(ch.id);
        }
        if (typeof toastr !== 'undefined') toastr.success('所有聊天记录已清空');
    });

    // Reset entire server
    document.getElementById('dc_reset_server')?.addEventListener('click', () => {
        if (!confirm('⚠️ 确定要重置整个服务器吗？\n\n这将删除所有数据：服务器配置、成员、身份组、频道、聊天记录。\n\n此操作不可撤销！')) return;
        if (!confirm('再次确认：删除所有 Discord 社区数据？')) return;
        stopAutoChatTimer();
        resetAllData();
        if (typeof toastr !== 'undefined') toastr.success('服务器已重置');
        // Return to the Discord init page (via openDiscordApp)
        if (_returnToHome) _returnToHome();
    });
}

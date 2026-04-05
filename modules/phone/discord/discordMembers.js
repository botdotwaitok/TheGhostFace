// modules/phone/discord/discordMembers.js — Member management UI + LLM generation
// Handles: member list, manual create, LLM generate, edit, delete.

import { openAppInViewport } from '../phoneController.js';
import { getPhoneCharInfo, getPhoneUserName, getPhoneWorldBookContext, getCoreFoundationPrompt } from '../phoneContext.js';
import { callPhoneLLM } from '../../api.js';
import { cleanLlmJson } from '../utils/llmJsonCleaner.js';
import { escapeHtml } from '../utils/helpers.js';
import {
    loadMembers, saveMembers, addMember, updateMember, removeMember,
    loadRoles, getMemberColor, generateId, uploadFileToST,
    getMemberAvatarUrl, setTempBioUpdate
} from './discordStorage.js';

const LOG = '[Discord Members]';

// ═══════════════════════════════════════════════════════════════════════
// External Navigation Callback — set by server settings to return there
// ═══════════════════════════════════════════════════════════════════════

let _returnCallback = null;

/**
 * Open the member list page.
 * @param {Function} [onReturn] - Callback to invoke when user navigates back
 */
export function openMembersPage(onReturn = null) {
    _returnCallback = onReturn;
    _renderMemberList();
}

// ═══════════════════════════════════════════════════════════════════════
// Member List Page
// ═══════════════════════════════════════════════════════════════════════

function _renderMemberList() {
    const members = loadMembers();
    const roles = loadRoles();

    // Group members by their highest-priority role
    const roleMap = {};
    for (const role of roles) roleMap[role.id] = role;

    // Separate into categorized groups: admins, then by role, then unassigned
    const grouped = _groupMembersByRole(members, roles);

    let listHtml = '';
    for (const group of grouped) {
        const countLabel = group.members.length;
        listHtml += `
            <div class="dc-member-group">
                <div class="dc-member-group-header">
                    <span class="dc-member-group-name" style="color:${group.color}">${escapeHtml(group.name)}</span>
                    <span class="dc-member-group-count">${countLabel}</span>
                </div>
                ${group.members.map(m => _buildMemberItemHtml(m, roleMap)).join('')}
            </div>
        `;
    }

    const html = `
        <div class="dc-server-page dc-fade-in" id="dc_members_page">
            <div class="dc-members-list" id="dc_members_list">
                ${listHtml || '<div class="dc-empty"><div class="dc-empty-text">还没有成员</div></div>'}
            </div>
            <div class="dc-members-actions">
                <button class="dc-btn dc-btn-primary" id="dc_member_add_manual">
                    手动添加
                </button>
                <button class="dc-btn dc-btn-secondary" id="dc_member_add_llm">
                    自动生成
                </button>
            </div>
        </div>
    `;

    const titleHtml = `<span style="font-weight:600;">成员管理</span>`;
    const actionsHtml = `
        <span class="dc-header-member-count" style="font-size:12px; color:var(--dc-text-secondary);">
            ${members.length} 位成员
        </span>`;

    openAppInViewport(titleHtml, html, () => {
        _bindMemberListEvents();
        // Back button → return to settings
        const backHandler = (e) => {
            e.preventDefault();
            window.removeEventListener('phone-app-back', backHandler);
            if (_returnCallback) _returnCallback();
        };
        window.addEventListener('phone-app-back', backHandler);
    }, actionsHtml);
}

function _groupMembersByRole(members, roles) {
    const roleMap = {};
    for (const r of roles) roleMap[r.id] = r;

    // Sort roles by order
    const sortedRoles = [...roles].sort((a, b) => a.order - b.order);
    const groups = [];
    const placed = new Set();

    for (const role of sortedRoles) {
        const roleMembers = members.filter(m => {
            if (placed.has(m.id)) return false;
            return m.roles?.includes(role.id);
        });
        if (roleMembers.length > 0) {
            roleMembers.forEach(m => placed.add(m.id));
            groups.push({
                name: role.name,
                color: role.color,
                members: roleMembers,
            });
        }
    }

    // Any members without a matched role
    const unplaced = members.filter(m => !placed.has(m.id));
    if (unplaced.length > 0) {
        groups.push({
            name: '无身份组',
            color: '#99aab5',
            members: unplaced,
        });
    }

    return groups;
}

function _buildMemberItemHtml(member, roleMap) {
    const color = getMemberColor(member);
    const avatarHtml = _buildAvatarHtml(member);

    // Role tags
    const roleTags = (member.roles || [])
        .map(rid => roleMap[rid])
        .filter(Boolean)
        .map(r => `<span class="dc-role-tag" style="--role-color:${r.color}">${escapeHtml(r.name)}</span>`)
        .join('');

    // Status badges
    let badgeHtml = '';
    if (member.isProtagonist) {
        badgeHtml = `<span class="dc-member-badge protagonist"><i class="ph ph-star"></i></span>`;
    } else if (member.isUser) {
        badgeHtml = `<span class="dc-member-badge user"><i class="ph ph-user"></i></span>`;
    }

    const canEdit = true; // everyone is editable, constraints inside form
    const dataAttr = `data-member-id="${member.id}"`;

    return `
        <div class="dc-member-item dc-member-editable" ${dataAttr}>
            ${avatarHtml}
            <div class="dc-member-info">
                <div class="dc-member-name" style="color:${color}">
                    ${escapeHtml(member.name)}${badgeHtml}
                </div>
                ${member.bio ? `<div class="dc-member-bio">${escapeHtml(member.bio)}</div>` : ''}
                <div class="dc-member-roles">${roleTags}</div>
            </div>
            <i class="ph ph-caret-right dc-member-chevron"></i>
        </div>
    `;
}

function _buildAvatarHtml(member, size = '') {
    const sizeClass = size ? ` ${size}` : '';
    const avatarUrl = getMemberAvatarUrl(member);
    if (avatarUrl) {
        return `<div class="dc-avatar${sizeClass}" style="background:${member.avatarColor || '#5865f2'}">
            <img src="${avatarUrl}" alt="" />
        </div>`;
    }
    const initial = (member.name || '?').charAt(0);
    return `<div class="dc-avatar${sizeClass}" style="background:${member.avatarColor || '#5865f2'}">
        ${escapeHtml(initial)}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// Member List Events
// ═══════════════════════════════════════════════════════════════════════

function _bindMemberListEvents() {
    // Manual add
    document.getElementById('dc_member_add_manual')?.addEventListener('click', () => {
        _showMemberForm(null);
    });

    // LLM generate
    document.getElementById('dc_member_add_llm')?.addEventListener('click', () => {
        _handleLLMGenerate();
    });

    // Click on editable member → edit
    document.querySelectorAll('.dc-member-editable').forEach(el => {
        el.addEventListener('click', () => {
            const memberId = el.dataset.memberId;
            if (memberId) _showMemberForm(memberId);
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Member Form (Create / Edit)
// ═══════════════════════════════════════════════════════════════════════

function _showMemberForm(memberId = null) {
    const isEdit = !!memberId;
    const member = isEdit ? loadMembers().find(m => m.id === memberId) : null;
    const roles = loadRoles();

    // For edit, prevent editing protagonist personality (it comes from char card)
    const isProtagonist = member?.isProtagonist;

    // Pre-fill form values
    const name = member?.name || '';
    const bio = member?.bio || '';
    const personality = member?.personality || '';
    const avatarColor = member?.avatarColor || _randomAvatarColor();
    const selectedRoles = member?.roles || [];

    // Avatar color palette
    const colorPalette = [
        '#e91e8e', '#5865f2', '#57f287', '#fee75c', '#ed4245',
        '#eb459e', '#1abc9c', '#e67e22', '#9b59b6', '#3498db',
        '#2ecc71', '#e74c3c', '#f39c12', '#2c3e50',
    ];

    const roleCheckboxes = roles.map(r => {
        const checked = selectedRoles.includes(r.id) ? 'checked' : '';
        return `
            <label class="dc-role-checkbox">
                <input type="checkbox" value="${r.id}" ${checked} />
                <span class="dc-role-checkbox-label" style="--role-color:${r.color}">
                    ${escapeHtml(r.name)}
                </span>
            </label>
        `;
    }).join('');

    const colorOptions = colorPalette.map(c => {
        const selected = c === avatarColor ? 'dc-color-selected' : '';
        return `<div class="dc-color-dot ${selected}" data-color="${c}" style="background:${c}"></div>`;
    }).join('');

    const deleteBtn = isEdit && !member?.isProtagonist && !member?.isUser
        ? `<button class="dc-btn dc-btn-danger" id="dc_member_delete">
               <i class="ph ph-trash"></i> 删除成员
           </button>`
        : '';

    const html = `
        <div class="dc-server-page dc-fade-in" id="dc_member_form_page">
            <div class="dc-form-scroll">
                <div class="dc-form-section">
                    <div class="dc-form-label">头像颜色</div>
                    <div class="dc-color-palette" id="dc_avatar_color_picker">
                        ${colorOptions}
                    </div>
                    <div class="dc-avatar-preview" id="dc_avatar_preview">
                        <div class="dc-avatar" style="background:${avatarColor}">
                            ${escapeHtml((name || '?').charAt(0))}
                        </div>
                    </div>
                </div>

                <div class="dc-form-section">
                    <div class="dc-form-label">名字 <span class="dc-required">*</span></div>
                    <input type="text" class="dc-input" id="dc_member_name"
                           value="${escapeHtml(name)}" placeholder="成员名字"
                           maxlength="30" ${isProtagonist ? 'disabled' : ''} />
                </div>

                <div class="dc-form-section">
                    <div class="dc-form-label">状态/签名</div>
                    <input type="text" class="dc-input" id="dc_member_bio"
                           value="${escapeHtml(bio)}" placeholder="设定人物的社区签名或者当前状态"
                           maxlength="100" />
                </div>

                ${(!isProtagonist && !member?.isUser) ? `
                <div class="dc-form-section">
                    <div class="dc-form-label">性格描述</div>
                    <textarea class="dc-input dc-textarea" id="dc_member_personality"
                              placeholder="可以粘贴角色原始设定信息，点击鬼面优化由鬼面优化为合适的群聊人设！">${escapeHtml(personality)}</textarea>
                    
                    <div class="dc-refine-section" id="dc_refine_section">
                        <button class="dc-btn dc-btn-secondary dc-btn-sm dc-btn-full" id="dc_member_refine_btn">
                            <i class="ph ph-sparkle" style="color:var(--dc-brand);"></i> 鬼面优化
                        </button>
                        <div class="dc-refine-loading" id="dc_refine_loading" style="display:none;">
                            <div class="dc-init-spinner" style="width:20px;height:20px; border-width:2px;"></div>
                            <span>鬼面正在优化中...</span>
                        </div>
                        <div class="dc-refine-result" id="dc_refine_result" style="display:none;">
                            <div class="dc-form-label" style="display:flex; justify-content:space-between; align-items:center;">
                                <span><i class="ph ph-magic-wand"></i> 优化结果</span>
                                <span style="font-size:10px; color:var(--dc-text-muted);">可手动微调</span>
                            </div>
                            <textarea class="dc-input dc-textarea dc-refine-textarea" id="dc_refine_textarea"
                                      maxlength="200" placeholder="优化结果..."></textarea>
                            <div class="dc-refine-actions">
                                <button class="dc-btn dc-btn-primary dc-btn-sm" id="dc_refine_accept" style="flex:1;">
                                    <i class="ph ph-check"></i> 采用结果
                                </button>
                                <button class="dc-btn dc-btn-secondary dc-btn-sm" id="dc_refine_retry">
                                    <i class="ph ph-arrows-clockwise"></i> 重新生成
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                ` : `
                <div class="dc-form-section">
                    <div class="dc-form-label">性格描述</div>
                    <div class="dc-form-note">
                        <i class="ph ph-info"></i>
                        ${isProtagonist ? '你对象' : '你自己的'}完整人设由${isProtagonist ? '角色卡' : '当前 Persona'}提供，无需在社区内单独设置
                    </div>
                </div>
                `}

                <div class="dc-form-section">
                    <div class="dc-form-label">身份组</div>
                    <div class="dc-role-checkbox-group" id="dc_member_roles">
                        ${roleCheckboxes}
                    </div>
                </div>

                <div class="dc-form-section">
                    <div class="dc-form-label">头像图片（可选）</div>
                    <div class="dc-avatar-upload" id="dc_avatar_upload_area">
                        ${member?.avatar
            ? `<img src="${member.avatar}" class="dc-avatar-upload-preview" />`
            : `<i class="ph ph-upload-simple"></i><span>点击上传</span>`
        }
                        <input type="file" accept="image/*" id="dc_avatar_file" style="display:none" />
                    </div>
                    ${member?.avatar ? '<button class="dc-btn-text" id="dc_avatar_clear">移除头像图片</button>' : ''}
                </div>

                <div class="dc-form-actions">
                    <button class="dc-btn dc-btn-primary dc-btn-full" id="dc_member_save">
                        <i class="ph ph-check"></i> ${isEdit ? '保存修改' : '创建成员'}
                    </button>
                    ${deleteBtn}
                </div>
            </div>
        </div>
    `;

    const titleHtml = `<span style="font-weight:600;">${isEdit ? '编辑成员' : '添加成员'}</span>`;

    openAppInViewport(titleHtml, html, () => {
        _bindMemberFormEvents(memberId, avatarColor);
        // Back → return to member list
        const backHandler = (e) => {
            e.preventDefault();
            window.removeEventListener('phone-app-back', backHandler);
            _renderMemberList();
        };
        window.addEventListener('phone-app-back', backHandler);
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Member Form Events
// ═══════════════════════════════════════════════════════════════════════

function _bindMemberFormEvents(memberId, initialColor) {
    let currentColor = initialColor;
    let currentAvatar = memberId ? loadMembers().find(m => m.id === memberId)?.avatar || null : null;

    // ── Color picker ──
    document.querySelectorAll('#dc_avatar_color_picker .dc-color-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            document.querySelectorAll('#dc_avatar_color_picker .dc-color-dot')
                .forEach(d => d.classList.remove('dc-color-selected'));
            dot.classList.add('dc-color-selected');
            currentColor = dot.dataset.color;
            // Update preview
            const preview = document.querySelector('#dc_avatar_preview .dc-avatar');
            if (preview) {
                preview.style.background = currentColor;
            }
        });
    });

    // ── Name input → update avatar preview ──
    const nameInput = document.getElementById('dc_member_name');
    nameInput?.addEventListener('input', () => {
        const preview = document.querySelector('#dc_avatar_preview .dc-avatar');
        if (preview && !currentAvatar) {
            const initial = (nameInput.value || '?').charAt(0);
            preview.textContent = initial;
        }
    });

    // ── Avatar upload ──
    const uploadArea = document.getElementById('dc_avatar_upload_area');
    const fileInput = document.getElementById('dc_avatar_file');

    uploadArea?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 500 * 1024) {
            if (typeof toastr !== 'undefined') toastr.warning('图片不能超过 500KB');
            return;
        }
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const base64 = ev.target.result;
            // Show preview immediately with base64
            uploadArea.innerHTML = `<img src="${base64}" class="dc-avatar-upload-preview" />`;
            const preview = document.querySelector('#dc_avatar_preview .dc-avatar');
            if (preview) {
                preview.innerHTML = `<img src="${base64}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
            }
            // Upload to ST file system — replaces base64 with persistent web path
            try {
                const webPath = await uploadFileToST(base64, 'discord_avatar');
                currentAvatar = webPath;
                // Update preview src to web path (for consistency)
                const previewImg = uploadArea.querySelector('img');
                if (previewImg) previewImg.src = webPath;
                const avatarImg = preview?.querySelector('img');
                if (avatarImg) avatarImg.src = webPath;
            } catch (err) {
                console.error(`${LOG} Avatar upload failed, using base64 fallback:`, err);
                currentAvatar = base64;
            }
        };
        reader.readAsDataURL(file);
    });

    // ── Clear avatar ──
    document.getElementById('dc_avatar_clear')?.addEventListener('click', () => {
        currentAvatar = null;
        const uploadArea = document.getElementById('dc_avatar_upload_area');
        if (uploadArea) {
            uploadArea.innerHTML = `<i class="ph ph-upload-simple"></i><span>点击上传</span>`;
        }
        const preview = document.querySelector('#dc_avatar_preview .dc-avatar');
        if (preview) {
            const nameVal = document.getElementById('dc_member_name')?.value || '?';
            preview.innerHTML = escapeHtml(nameVal.charAt(0));
        }
        // Remove the clear button
        document.getElementById('dc_avatar_clear')?.remove();
    });

    // ── AI Refine Personality ──
    const refineBtn = document.getElementById('dc_member_refine_btn');
    const refineLoading = document.getElementById('dc_refine_loading');
    const refineResult = document.getElementById('dc_refine_result');
    const refineTextarea = document.getElementById('dc_refine_textarea');
    const refineAccept = document.getElementById('dc_refine_accept');
    const refineRetry = document.getElementById('dc_refine_retry');
    const personalityInput = document.getElementById('dc_member_personality');

    async function doRefine() {
        const rawText = personalityInput?.value?.trim();
        if (!rawText) {
            if (typeof toastr !== 'undefined') toastr.warning('请先在性格描述框内输入一些原始设定信息。');
            return;
        }

        refineBtn.style.display = 'none';
        refineResult.style.display = 'none';
        refineLoading.style.display = 'flex';

        try {
            const systemPrompt = `${getCoreFoundationPrompt()}

你是一个游戏角色设定精炼专家。你需要将玩家长篇大论的角色描述，精炼为极简短的 Discord 群聊人设摘要。

提炼指导原则：
1. 提取核心身份与背景设定
2. 提取关键说话方式、口癖、语气
3. 提取标志性性格特征
4. 完全忽略无意义的信息，如：具体血型、准确身高体重、普通的瞳色发色描写、流水账经历
5. 结果必须保持在 200 字符以内（1-2句短语即可）

输出格式：直接输出精炼后的纯文本，没有任何额外的格式标记、Markdown 或引号包裹。
示例：
原文："小红是O型血，身高165，长得很可爱眼睛很大。她总是很害羞，平时喜欢说'那个...'。她暗恋大明很久了。"
精炼："性格害羞可爱，经常说'那个...'，暗恋大明。"
`;

            const userPrompt = `请精炼以下角色描述：\n\n${rawText.substring(0, 3000)}`;

            const result = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 100 });

            refineTextarea.value = result.trim();
            refineLoading.style.display = 'none';
            refineResult.style.display = 'flex';
        } catch (e) {
            console.error('[Discord Refine] Failed:', e);
            if (typeof toastr !== 'undefined') toastr.error('生成失败: ' + e.message);
            refineLoading.style.display = 'none';
            refineBtn.style.display = 'flex';
        }
    }

    refineBtn?.addEventListener('click', (e) => { e.preventDefault(); doRefine(); });
    refineRetry?.addEventListener('click', (e) => { e.preventDefault(); doRefine(); });

    refineAccept?.addEventListener('click', (e) => {
        e.preventDefault();
        if (personalityInput && refineTextarea) {
            personalityInput.value = refineTextarea.value;
            refineResult.style.display = 'none';
            refineBtn.style.display = 'flex';
            if (typeof toastr !== 'undefined') toastr.success('已应用精炼人设');
        }
    });

    // ── Save ──
    document.getElementById('dc_member_save')?.addEventListener('click', () => {
        const nameVal = document.getElementById('dc_member_name')?.value?.trim();
        if (!nameVal) {
            if (typeof toastr !== 'undefined') toastr.warning('请输入成员名字');
            return;
        }

        const bioVal = document.getElementById('dc_member_bio')?.value?.trim() || '';
        const personalityVal = document.getElementById('dc_member_personality')?.value?.trim() || '';

        // Collect selected roles
        const roleCheckboxes = document.querySelectorAll('#dc_member_roles input[type="checkbox"]');
        const selectedRoles = [];
        roleCheckboxes.forEach(cb => { if (cb.checked) selectedRoles.push(cb.value); });

        if (memberId) {
            // ── Edit mode ──
            const updates = {
                bio: bioVal,
                avatarColor: currentColor,
                avatar: currentAvatar,
                roles: selectedRoles,
            };
            // Only update name/personality for non-protagonist and non-user
            const existing = loadMembers().find(m => m.id === memberId);
            if (!existing?.isProtagonist && !existing?.isUser) {
                updates.name = nameVal;
                updates.personality = personalityVal;
            }

            // If user updated their bio, inject temp prompt
            if (existing?.isUser && existing.bio !== bioVal && bioVal) {
                setTempBioUpdate(`【系统状态更新】${existing.name || '用户'} 刚刚在社区内更新了 Ta 的个人状态/签名：“${bioVal}”。你作为 ${existing.name || '用户'} 的恋人或熟人可以顺其自然地留意到或顺理成章地调侃一下这个新状态，但不需要生硬地刻意提起。`);
            }

            updateMember(memberId, updates);
            console.log(`${LOG} Updated member: ${memberId}`);
        } else {
            // ── Create mode ──
            const newMember = {
                id: generateId('member'),
                name: nameVal,
                avatar: currentAvatar,
                avatarColor: currentColor,
                bio: bioVal,
                personality: personalityVal,
                roles: selectedRoles,
                isProtagonist: false,
                isUser: false,
                source: 'manual',
                createdAt: new Date().toISOString(),
            };
            addMember(newMember);
            console.log(`${LOG} Created member: ${newMember.id} (${nameVal})`);
        }

        if (typeof toastr !== 'undefined') {
            toastr.success(memberId ? '成员已更新' : '成员已添加');
        }
        _renderMemberList();
    });

    // ── Delete ──
    document.getElementById('dc_member_delete')?.addEventListener('click', () => {
        if (!confirm('确定要删除这个成员吗？')) return;
        if (removeMember(memberId)) {
            if (typeof toastr !== 'undefined') toastr.success('成员已删除');
            _renderMemberList();
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════
// LLM Member Generation
// ═══════════════════════════════════════════════════════════════════════

async function _handleLLMGenerate() {
    const page = document.getElementById('dc_members_page');
    if (!page) return;

    // Show loading in the actions area
    const actionsEl = document.querySelector('.dc-members-actions');
    if (actionsEl) {
        actionsEl.innerHTML = `
            <div class="dc-init-loading" style="padding:16px;">
                <div class="dc-init-spinner" style="width:28px;height:28px;"></div>
                <div style="font-size:13px;color:var(--dc-text-secondary);">正在生成社区成员...</div>
            </div>
        `;
    }

    try {
        const result = await _generateMembersWithLLM();
        if (result && result.length > 0) {
            _showGeneratedMembersPreview(result);
        } else {
            if (typeof toastr !== 'undefined') toastr.warning('鬼面没有生成任何成员');
            _renderMemberList();
        }
    } catch (e) {
        console.error(`${LOG} LLM member generation failed:`, e);
        if (typeof toastr !== 'undefined') toastr.error(`生成失败: ${e.message}`);
        _renderMemberList();
    }
}

async function _generateMembersWithLLM() {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '角色';
    const userName = getPhoneUserName();
    const charDesc = charInfo?.description || '';
    const worldBookText = await getPhoneWorldBookContext();
    const existingMembers = loadMembers();
    const existingNames = existingMembers.map(m => m.name);

    const hasWorldInfo = !!(charDesc || worldBookText);

    const systemPrompt = `${getCoreFoundationPrompt()}

你需要根据角色信息和世界观设定，为这个 Discord 社区生成新的 NPC 成员。

要求：
1. 生成的成员应该是角色世界中的相关人物（来自同一作品/世界观的配角/NPC）
2. 每个成员的 personality 字段保持简洁：1-2 句话概括说话风格和性格特点
3. 名字不能和已有成员重复
4. 生成 3-5 个新成员
5. 使用世界观中的语言/风格
6. 【核心红线】如果背景设定里没有合适的原始角色，则以强壮聪明的原创女性角色为主，绝对禁止代入常规的父权视角或生成典型男性化形象（如称兄道弟的“老哥”、“哥们”等）。

${!hasWorldInfo ? '⚠️ 注意：当前没有可用的世界设定信息，请根据角色名和你的创意进行合理创作。' : ''}

已有成员：${existingNames.join(', ')}

输出严格的 JSON 数组格式（不要 markdown 代码块）：
[
  {
    "name": "成员名",
    "bio": "简短的个性签名或当前状态",
    "personality": "1-2句性格和说话风格描述",
    "suggestedRole": "建议的身份组名（可选）"
  }
]`;

    let userPrompt = `请为以下角色的社区生成新成员：\n\n`;
    userPrompt += `角色名: ${charName}\n`;
    if (charDesc) userPrompt += `角色设定:\n${charDesc.substring(0, 2000)}\n\n`;
    if (worldBookText) userPrompt += `世界观:\n${worldBookText.substring(0, 3000)}\n\n`;
    if (!hasWorldInfo) userPrompt += `（没有找到角色设定和世界书信息，请发挥创意生成。）\n\n`;
    userPrompt += `请生成 JSON 数组。`;

    console.log(`${LOG} Generating members with LLM...`);
    const rawResponse = await callPhoneLLM(systemPrompt, userPrompt, { maxTokens: 2000 });

    try {
        const cleaned = cleanLlmJson(rawResponse);
        const parsed = JSON.parse(cleaned);
        console.log(`${LOG} LLM generated ${parsed.length} members`);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.error(`${LOG} Failed to parse LLM member response:`, e);
        return [];
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Generated Members Preview (confirm/skip/edit)
// ═══════════════════════════════════════════════════════════════════════

function _showGeneratedMembersPreview(generatedMembers) {
    const roles = loadRoles();
    const memberRoleId = roles.find(r => r.name === '成员')?.id || roles[roles.length - 1]?.id || '';

    const avatarColors = ['#57f287', '#fee75c', '#ed4245', '#eb459e', '#1abc9c', '#e67e22', '#9b59b6', '#3498db'];

    const previewItems = generatedMembers.map((m, i) => {
        const color = avatarColors[i % avatarColors.length];
        const initial = (m.name || '?').charAt(0);

        // Find matching role
        let roleId = memberRoleId;
        if (m.suggestedRole) {
            const found = roles.find(r => r.name === m.suggestedRole);
            if (found) roleId = found.id;
        }

        return `
            <div class="dc-generated-member" data-index="${i}" data-role-id="${roleId}" data-color="${color}">
                <div class="dc-generated-member-check">
                    <input type="checkbox" id="dc_gen_check_${i}" checked />
                </div>
                <div class="dc-avatar" style="background:${color}">${escapeHtml(initial)}</div>
                <div class="dc-generated-member-info">
                    <div class="dc-generated-member-name">${escapeHtml(m.name)}</div>
                    <div class="dc-generated-member-bio">${escapeHtml(m.bio || '')}</div>
                    <div class="dc-generated-member-personality">${escapeHtml(m.personality || '')}</div>
                </div>
            </div>
        `;
    }).join('');

    const html = `
        <div class="dc-server-page dc-fade-in" id="dc_generated_preview">
            <div class="dc-form-scroll">
                <div class="dc-generated-header">
                    <i class="ph ph-sparkle" style="color:var(--dc-brand);"></i>
                    <span>鬼面生成了 ${generatedMembers.length} 位成员</span>
                </div>
                <div class="dc-generated-subtitle">取消勾选跳过不想添加的成员</div>
                <div class="dc-generated-list">
                    ${previewItems}
                </div>
                <div class="dc-form-actions">
                    <button class="dc-btn dc-btn-primary dc-btn-full" id="dc_gen_confirm">
                        <i class="ph ph-check"></i> 添加选中的成员
                    </button>
                    <button class="dc-btn dc-btn-secondary dc-btn-full" id="dc_gen_cancel">
                        取消
                    </button>
                </div>
            </div>
        </div>
    `;

    const titleHtml = `<span style="font-weight:600;">确认新成员</span>`;

    openAppInViewport(titleHtml, html, () => {
        // Confirm
        document.getElementById('dc_gen_confirm')?.addEventListener('click', () => {
            const items = document.querySelectorAll('.dc-generated-member');
            let addedCount = 0;
            items.forEach((el, i) => {
                const checkbox = document.getElementById(`dc_gen_check_${i}`);
                if (!checkbox?.checked) return;

                const m = generatedMembers[i];
                const roleId = el.dataset.roleId;
                const color = el.dataset.color;

                addMember({
                    id: generateId('member'),
                    name: m.name || `成员${i + 1}`,
                    avatar: null,
                    avatarColor: color,
                    bio: m.bio || '',
                    personality: m.personality || '',
                    roles: roleId ? [roleId] : [],
                    isProtagonist: false,
                    isUser: false,
                    source: 'llm',
                    createdAt: new Date().toISOString(),
                });
                addedCount++;
            });

            if (typeof toastr !== 'undefined') {
                toastr.success(`已添加 ${addedCount} 位新成员`);
            }
            _renderMemberList();
        });

        // Cancel
        document.getElementById('dc_gen_cancel')?.addEventListener('click', () => {
            _renderMemberList();
        });

        // Back → return to member list
        const backHandler = (e) => {
            e.preventDefault();
            window.removeEventListener('phone-app-back', backHandler);
            _renderMemberList();
        };
        window.addEventListener('phone-app-back', backHandler);
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function _randomAvatarColor() {
    const palette = ['#57f287', '#fee75c', '#ed4245', '#eb459e', '#1abc9c', '#e67e22', '#9b59b6', '#3498db'];
    return palette[Math.floor(Math.random() * palette.length)];
}

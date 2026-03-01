// backup.js — 总结后角色卡+聊天记录自动备份模块
// 功能：本地下载 PNG/JSON/JSONL + 通过 GhostFace Moments 服务器发送邮件
import { getContext, extension_settings } from '../../../../extensions.js';
import { this_chid, characters, getRequestHeaders, saveSettingsDebounced } from '../../../../../script.js';
import { getSettings } from './moments/state.js';

// 使用全局 logger（如果可用），否则回退到 console
const logger = {
    info: (...args) => (window.logger?.info || console.log).call(console, ...args),
    warn: (...args) => (window.logger?.warn || console.warn).call(console, ...args),
    error: (...args) => (window.logger?.error || console.error).call(console, ...args),
    debug: (...args) => (window.logger?.debug || console.debug).call(console, ...args),
};

const MODULE_NAME = 'the_ghost_face';

/**
 * 获取 GhostFace Moments 服务器的邮件发送 URL 和认证头
 * @returns {{ url: string, headers: object }}
 */
function getMomentsEmailEndpoint() {
    const settings = getSettings();
    if (!settings.backendUrl || !settings.secretToken) {
        throw new Error('朋友圈服务器未配置。请先在朋友圈设置中配置服务器地址和密钥。');
    }
    let baseUrl = settings.backendUrl.trim();
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    return {
        url: `${baseUrl}/api/backup/send-email`,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.secretToken}`,
        },
    };
}

// ── SMTP 预设 ────────────────────────────────────────────────────────

const SMTP_PRESETS = {
    qq: { host: 'smtp.qq.com', port: 465, secure: true, helpUrl: 'https://service.mail.qq.com/detail/0/75' },
    gmail: { host: 'smtp.gmail.com', port: 465, secure: true, helpUrl: 'https://myaccount.google.com/apppasswords' },
    '163': { host: 'smtp.163.com', port: 465, secure: true, helpUrl: 'https://qiye.163.com/help/af988e.html' },
    outlook: { host: 'smtp-mail.outlook.com', port: 587, secure: false, helpUrl: 'https://support.microsoft.com/zh-cn/account-billing/如何获取和使用应用密码-5896ed9b-4263-e681-128a-a6f2979a7944' },
};

/** 根据已保存的 host 反推 provider key，找不到返回 'custom' */
function detectProvider(host) {
    if (!host) return 'qq';
    for (const [key, preset] of Object.entries(SMTP_PRESETS)) {
        if (preset.host === host) return key;
    }
    return 'custom';
}

// ── 配置 ────────────────────────────────────────────────────────────

export const STORAGE_KEY_BACKUP = `${MODULE_NAME}_backupConfig_v1`;

export let backupConfig = {
    enabled: false,          // 总结后自动备份开关
    downloadLocal: true,     // 本地下载
    sendEmail: false,        // 邮件发送
    backupFormat: 'both',    // 'png' | 'json' | 'both'
    smtpProvider: 'qq',      // 邮箱服务商 preset key
    smtp: {
        host: 'smtp.qq.com', // SMTP 服务器
        port: 465,           // 端口
        secure: true,        // 使用 SSL
        user: '',            // SMTP 用户名(邮箱)
        pass: '',            // SMTP 密码/授权码
        to: '',              // 接收邮箱
    },
};

// ── 设置持久化 ──────────────────────────────────────────────────────

export function saveBackupSettings() {
    try {
        // localStorage 快速缓存
        try {
            localStorage.setItem(STORAGE_KEY_BACKUP, JSON.stringify(backupConfig));
        } catch (e) {
            console.warn('📦 localStorage 保存备份设置失败:', e?.message || e);
        }

        // SillyTavern 扩展设置（跨环境持久化）
        if (typeof extension_settings !== 'undefined') {
            extension_settings[MODULE_NAME] = extension_settings[MODULE_NAME] || {};
            extension_settings[MODULE_NAME].backupConfig = { ...backupConfig, smtp: { ...backupConfig.smtp } };
            if (typeof saveSettingsDebounced === 'function') {
                saveSettingsDebounced();
            }
        }

        logger.info('📦 备份设置已保存');
    } catch (error) {
        logger.error('📦 保存备份设置失败:', error);
    }
}

export function loadBackupSettings() {
    try {
        let loaded = false;

        // 1) 优先从 localStorage 读取
        try {
            const saved = localStorage.getItem(STORAGE_KEY_BACKUP);
            if (saved) {
                const parsed = JSON.parse(saved);
                backupConfig = { ...backupConfig, ...parsed, smtp: { ...backupConfig.smtp, ...(parsed.smtp || {}) } };
                loaded = true;
            }
        } catch (e) {
            console.warn('📦 读取 localStorage 备份设置失败:', e?.message || e);
        }

        // 2) 回退到扩展设置
        if (!loaded && typeof extension_settings !== 'undefined') {
            const ext = extension_settings[MODULE_NAME] || {};
            if (ext.backupConfig) {
                backupConfig = { ...backupConfig, ...ext.backupConfig, smtp: { ...backupConfig.smtp, ...(ext.backupConfig?.smtp || {}) } };
                loaded = true;
            }
        }

        logger.info('📦 备份设置已加载', { enabled: backupConfig.enabled, downloadLocal: backupConfig.downloadLocal, sendEmail: backupConfig.sendEmail });
    } catch (error) {
        logger.error('📦 加载备份设置失败:', error);
    }
}

// ── 角色卡导出 ──────────────────────────────────────────────────────

/**
 * 从 SillyTavern 后端导出当前角色卡
 * @param {'png'|'json'} format
 * @returns {Promise<{blob: Blob, filename: string}>}
 */
async function exportCharacterCard(format) {
    const context = getContext();
    if (!context || this_chid === undefined || this_chid === null) {
        throw new Error('没有选中任何角色');
    }

    const avatar = characters[this_chid]?.avatar;
    if (!avatar) {
        throw new Error('找不到当前角色的头像文件');
    }

    const response = await fetch('/api/characters/export', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            avatar_url: avatar,
            format: format,
        }),
    });

    if (!response.ok) {
        throw new Error(`导出角色卡失败: HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const charName = characters[this_chid]?.name || 'character';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = format === 'png' ? 'png' : 'json';
    const filename = `${charName}_backup_${timestamp}.${ext}`;

    return { blob, filename };
}

/**
 * 使用 SillyTavern 原生 API 导出当前聊天记录 (JSONL)
 * @returns {Promise<{blob: Blob, filename: string}>}
 */
async function exportChatHistory() {
    const context = getContext();
    if (!context || this_chid === undefined || this_chid === null) {
        throw new Error('没有选中任何角色');
    }

    const avatar = characters[this_chid]?.avatar;
    if (!avatar) {
        throw new Error('找不到当前角色的头像文件');
    }

    // characters[this_chid].chat 是当前聊天文件名（不含 .jsonl 后缀）
    const chatFileName = characters[this_chid]?.chat;
    if (!chatFileName) {
        throw new Error('找不到当前聊天文件名');
    }

    const charName = characters[this_chid]?.name || 'character';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const exportFilename = `${charName}_chat_${timestamp}.jsonl`;

    const response = await fetch('/api/chats/export', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            is_group: false,
            avatar_url: avatar,
            file: `${chatFileName}.jsonl`,
            exportfilename: exportFilename,
            format: 'jsonl',
        }),
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(`导出聊天记录失败: HTTP ${response.status} - ${errData.message || ''}`);
    }

    const data = await response.json();
    // data.result 是导出的文件内容字符串
    const blob = new Blob([data.result], { type: 'application/octet-stream' });
    return { blob, filename: exportFilename };
}

/**
 * 触发浏览器下载
 */
function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

// ── 本地下载 ────────────────────────────────────────────────────────

async function downloadBackupLocal() {
    const formats = [];
    if (backupConfig.backupFormat === 'png' || backupConfig.backupFormat === 'both') {
        formats.push('png');
    }
    if (backupConfig.backupFormat === 'json' || backupConfig.backupFormat === 'both') {
        formats.push('json');
    }

    // 角色卡下载
    for (const format of formats) {
        try {
            const { blob, filename } = await exportCharacterCard(format);
            triggerDownload(blob, filename);
            logger.info(`📦 本地下载完成: ${filename}`);
        } catch (error) {
            logger.error(`📦 下载 ${format} 失败:`, error);
            toastr.error(`备份下载失败 (${format}): ${error.message}`);
        }
    }

    // 聊天记录下载
    try {
        const { blob, filename } = await exportChatHistory();
        triggerDownload(blob, filename);
        logger.info(`📦 聊天记录下载完成: ${filename}`);
    } catch (error) {
        logger.error('📦 下载聊天记录失败:', error);
        toastr.error(`聊天记录下载失败: ${error.message}`);
    }
}

// ── 邮件发送 ────────────────────────────────────────────────────────

async function sendBackupEmail() {
    const smtp = backupConfig.smtp;
    if (!smtp.host || !smtp.user || !smtp.pass || !smtp.to) {
        toastr.warning('📧 邮件配置不完整，跳过邮件发送');
        return;
    }

    // 收集附件
    const attachments = [];
    const formats = [];
    if (backupConfig.backupFormat === 'png' || backupConfig.backupFormat === 'both') formats.push('png');
    if (backupConfig.backupFormat === 'json' || backupConfig.backupFormat === 'both') formats.push('json');

    for (const format of formats) {
        try {
            const { blob, filename } = await exportCharacterCard(format);
            // 转为 base64 以便通过 JSON 传输
            const arrayBuffer = await blob.arrayBuffer();
            const base64 = btoa(
                new Uint8Array(arrayBuffer)
                    .reduce((data, byte) => data + String.fromCharCode(byte), '')
            );
            attachments.push({
                filename,
                content: base64,
                encoding: 'base64',
                contentType: format === 'png' ? 'image/png' : 'application/json',
            });
        } catch (error) {
            logger.error(`📧 准备附件 ${format} 失败:`, error);
        }
    }

    // 聊天记录附件
    try {
        const { blob, filename } = await exportChatHistory();
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = btoa(
            new Uint8Array(arrayBuffer)
                .reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        attachments.push({
            filename,
            content: base64,
            encoding: 'base64',
            contentType: 'application/octet-stream',
        });
    } catch (error) {
        logger.error('📧 准备聊天记录附件失败:', error);
    }

    if (attachments.length === 0) {
        toastr.error('📧 没有可发送的附件');
        return;
    }

    const charName = characters[this_chid]?.name || '角色';
    const timestamp = new Date().toLocaleString('zh-CN');

    try {
        // 通过 GhostFace Moments 服务器发送邮件
        const { url, headers } = getMomentsEmailEndpoint();
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                smtp: {
                    host: smtp.host,
                    port: smtp.port,
                    secure: smtp.secure,
                    user: smtp.user,
                    pass: smtp.pass,
                },
                to: smtp.to,
                subject: `【鬼面备份】${charName} - ${timestamp}`,
                text: `你好！\n\n这是鬼面自动备份的角色卡和聊天记录：${charName}\n备份时间：${timestamp}\n\n附件包含角色卡的 ${formats.join(' 和 ')} 格式备份及聊天记录 (JSONL)。\n\n—— 鬼面 👻`,
                attachments,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`邮件发送失败: HTTP ${response.status} - ${errText}`);
        }

        logger.info('📧 备份邮件发送成功');
        toastr.success('📧 备份邮件已发送！');
    } catch (error) {
        logger.error('📧 邮件发送失败:', error);
        toastr.error('📧 邮件发送失败: ' + error.message);
    }
}

// ── 主入口 ──────────────────────────────────────────────────────────

/**
 * 总结完成后的备份处理入口
 * 由 core.js 的 stealthSummarize() 在成功路径调用
 */
export async function handlePostSummaryBackup() {
    if (!backupConfig.enabled) {
        logger.info('📦 自动备份未开启（备份开关为关闭状态），跳过备份');
        return;
    }

    logger.info('📦 总结完成，开始自动备份...', {
        downloadLocal: backupConfig.downloadLocal,
        sendEmail: backupConfig.sendEmail,
        backupFormat: backupConfig.backupFormat,
    });
    toastr.info('📦 鬼面正在备份角色卡和聊天记录...', null, { timeOut: 3000 });

    try {
        // 本地下载
        if (backupConfig.downloadLocal) {
            await downloadBackupLocal();
        } else {
            logger.info('📦 本地下载未勾选，跳过');
        }

        // 邮件发送
        if (backupConfig.sendEmail) {
            await sendBackupEmail();
        } else {
            logger.info('📦 邮件发送未勾选，跳过');
        }

        if (backupConfig.downloadLocal || backupConfig.sendEmail) {
            toastr.success('📦 角色卡和聊天记录备份完成！');
        } else {
            logger.warn('📦 本地下载和邮件发送都未开启，备份无实际操作');
            toastr.warning('📦 备份已开启但未选择任何备份方式（本地下载/邮件都未勾选）');
        }
    } catch (error) {
        logger.error('📦 备份过程出错:', error);
        toastr.error('📦 备份失败: ' + error.message);
    }
}

// ── UI 配置更新 ─────────────────────────────────────────────────────

export function updateBackupConfigUI() {
    const enabledCheckbox = document.getElementById('ghost_backup_enabled');
    const downloadCheckbox = document.getElementById('ghost_backup_download');
    const emailCheckbox = document.getElementById('ghost_backup_email');
    const formatSelect = document.getElementById('ghost_backup_format');
    const providerSelect = document.getElementById('ghost_backup_smtp_provider');
    const smtpHost = document.getElementById('ghost_backup_smtp_host');
    const smtpPort = document.getElementById('ghost_backup_smtp_port');
    const smtpSecure = document.getElementById('ghost_backup_smtp_secure');
    const smtpUser = document.getElementById('ghost_backup_smtp_user');
    const smtpPass = document.getElementById('ghost_backup_smtp_pass');
    const smtpTo = document.getElementById('ghost_backup_smtp_to');
    const emailConfigArea = document.getElementById('ghost_backup_email_config');
    const backupSettingsCard = document.getElementById('ghost_backup_settings_card');
    const customFields = document.getElementById('ghost_backup_smtp_custom_fields');

    if (enabledCheckbox) enabledCheckbox.checked = backupConfig.enabled;
    if (downloadCheckbox) downloadCheckbox.checked = backupConfig.downloadLocal;
    if (emailCheckbox) emailCheckbox.checked = backupConfig.sendEmail;
    if (formatSelect) formatSelect.value = backupConfig.backupFormat;

    // 同步 provider 下拉框
    const provider = backupConfig.smtpProvider || detectProvider(backupConfig.smtp.host);
    if (providerSelect) providerSelect.value = provider;

    // 自定义模式显示 host/port/SSL 输入
    if (customFields) {
        customFields.style.display = provider === 'custom' ? 'block' : 'none';
    }

    // 同步授权码帮助链接
    const helpLink = document.getElementById('ghost_backup_smtp_help_link');
    const helpContainer = document.getElementById('ghost_backup_smtp_help');
    if (helpLink && helpContainer) {
        const preset = SMTP_PRESETS[provider];
        if (preset && preset.helpUrl) {
            helpLink.href = preset.helpUrl;
            helpContainer.style.display = 'block';
        } else {
            helpContainer.style.display = 'none';
        }
    }

    if (smtpHost) smtpHost.value = backupConfig.smtp.host;
    if (smtpPort) smtpPort.value = backupConfig.smtp.port;
    if (smtpSecure) smtpSecure.checked = backupConfig.smtp.secure;
    if (smtpUser) smtpUser.value = backupConfig.smtp.user;
    if (smtpPass) smtpPass.value = backupConfig.smtp.pass;
    if (smtpTo) smtpTo.value = backupConfig.smtp.to;

    // 根据启用状态控制备份设置卡片的展开/收起
    if (backupSettingsCard) {
        backupSettingsCard.style.display = backupConfig.enabled ? 'block' : 'none';
    }

    if (emailConfigArea) {
        emailConfigArea.style.display = backupConfig.sendEmail ? 'block' : 'none';
    }
}

export function setupBackupEvents() {
    const enabledCheckbox = document.getElementById('ghost_backup_enabled');
    const downloadCheckbox = document.getElementById('ghost_backup_download');
    const emailCheckbox = document.getElementById('ghost_backup_email');
    const formatSelect = document.getElementById('ghost_backup_format');
    const saveBtn = document.getElementById('ghost_backup_save');
    const testBtn = document.getElementById('ghost_backup_test_email');
    const emailConfigArea = document.getElementById('ghost_backup_email_config');
    const backupSettingsCard = document.getElementById('ghost_backup_settings_card');

    if (enabledCheckbox) {
        enabledCheckbox.addEventListener('change', (e) => {
            backupConfig.enabled = e.target.checked;
            // 控制备份设置卡片的展开/收起
            if (backupSettingsCard) {
                backupSettingsCard.style.display = backupConfig.enabled ? 'block' : 'none';
            }
            saveBackupSettings();
            toastr.info(backupConfig.enabled ? '📦 已开启自动备份' : '📦 已关闭自动备份');
        });
    }

    if (downloadCheckbox) {
        downloadCheckbox.addEventListener('change', (e) => {
            backupConfig.downloadLocal = e.target.checked;
            saveBackupSettings();
        });
    }

    if (emailCheckbox) {
        emailCheckbox.addEventListener('change', (e) => {
            backupConfig.sendEmail = e.target.checked;
            if (emailConfigArea) {
                emailConfigArea.style.display = backupConfig.sendEmail ? 'block' : 'none';
            }
            saveBackupSettings();
        });
    }

    if (formatSelect) {
        formatSelect.addEventListener('change', (e) => {
            backupConfig.backupFormat = e.target.value;
            saveBackupSettings();
        });
    }

    // 服务商下拉框切换
    const providerSelect = document.getElementById('ghost_backup_smtp_provider');
    const customFields = document.getElementById('ghost_backup_smtp_custom_fields');
    if (providerSelect) {
        providerSelect.addEventListener('change', (e) => {
            const key = e.target.value;
            backupConfig.smtpProvider = key;
            if (customFields) {
                customFields.style.display = key === 'custom' ? 'block' : 'none';
            }
            // 预设自动填充 + 帮助链接
            const helpLink = document.getElementById('ghost_backup_smtp_help_link');
            const helpContainer = document.getElementById('ghost_backup_smtp_help');
            if (SMTP_PRESETS[key]) {
                const preset = SMTP_PRESETS[key];
                backupConfig.smtp.host = preset.host;
                backupConfig.smtp.port = preset.port;
                backupConfig.smtp.secure = preset.secure;
                if (helpLink && helpContainer) {
                    helpLink.href = preset.helpUrl;
                    helpContainer.style.display = 'block';
                }
            } else {
                if (helpContainer) helpContainer.style.display = 'none';
            }
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const provider = backupConfig.smtpProvider || 'qq';
            // 预设模式：从 preset 读取 host/port/secure
            if (SMTP_PRESETS[provider]) {
                const preset = SMTP_PRESETS[provider];
                backupConfig.smtp.host = preset.host;
                backupConfig.smtp.port = preset.port;
                backupConfig.smtp.secure = preset.secure;
            } else {
                // 自定义模式：从输入框读取
                const smtpHost = document.getElementById('ghost_backup_smtp_host');
                const smtpPort = document.getElementById('ghost_backup_smtp_port');
                const smtpSecure = document.getElementById('ghost_backup_smtp_secure');
                if (smtpHost) backupConfig.smtp.host = smtpHost.value.trim();
                if (smtpPort) backupConfig.smtp.port = parseInt(smtpPort.value) || 465;
                if (smtpSecure) backupConfig.smtp.secure = smtpSecure.checked;
            }

            const smtpUser = document.getElementById('ghost_backup_smtp_user');
            const smtpPass = document.getElementById('ghost_backup_smtp_pass');
            const smtpTo = document.getElementById('ghost_backup_smtp_to');
            if (smtpUser) backupConfig.smtp.user = smtpUser.value.trim();
            if (smtpPass) backupConfig.smtp.pass = smtpPass.value.trim();
            if (smtpTo) backupConfig.smtp.to = smtpTo.value.trim();

            saveBackupSettings();
            toastr.success('📦 邮箱配置已保存！');
        });
    }

    if (testBtn) {
        testBtn.addEventListener('click', async () => {
            // 先保存当前输入
            saveBtn?.click();

            if (!backupConfig.smtp.host || !backupConfig.smtp.user || !backupConfig.smtp.pass || !backupConfig.smtp.to) {
                toastr.warning('请先完整填写邮箱配置');
                return;
            }

            testBtn.disabled = true;
            testBtn.textContent = '发送中...';

            try {
                const { url, headers } = getMomentsEmailEndpoint();
                const response = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        smtp: backupConfig.smtp,
                        to: backupConfig.smtp.to,
                        subject: '【鬼面备份】测试邮件 👻',
                        text: '如果你收到这封邮件，说明邮箱配置成功啦！\n\n—— 鬼面 👻',
                        attachments: [],
                    }),
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(errText);
                }

                toastr.success('📧 测试邮件发送成功！请检查收件箱');
            } catch (error) {
                toastr.error('📧 测试邮件失败: ' + error.message);
            } finally {
                testBtn.disabled = false;
                testBtn.textContent = '发送测试邮件';
            }
        });
    }

    logger.info('📦 备份事件监听器已设置完成');
}

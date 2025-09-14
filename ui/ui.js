// ui.js
import { getContext, extension_settings, } from '../../../../extensions.js';
import { chat_metadata, getMaxContextSize, generateRaw, streamingProcessor, main_api, system_message_types, saveSettingsDebounced, getRequestHeaders, saveChatDebounced, chat, this_chid, characters, reloadCurrentChat, } from '../../../../../script.js';
import { createWorldInfoEntry, deleteWIOriginalDataValue, deleteWorldInfoEntry, importWorldInfo, loadWorldInfo, saveWorldInfo, world_info } from '../../../../world-info.js';
import { eventSource, event_types } from '../../../../../script.js';
import { download, debounce, initScrollHeight, resetScrollHeight, parseJsonFile, extractDataFromPng, getFileBuffer, getCharaFilename, getSortableDelay, escapeRegex, PAGINATION_TEMPLATE, navigation_option, waitUntilCondition, isTrueBoolean, setValueByPath, flashHighlight, select2ModifyOptions, getSelect2OptionId, dynamicSelect2DataViaAjax, highlightRegex, select2ChoiceClickSubscribe, isFalseBoolean, getSanitizedFilename, checkOverwriteExistingData, getStringHash, parseStringArray, cancelDebounce, findChar, onlyUnique, equalsIgnoreCaseAndAccents } from '../../../../utils.js';

import * as summarizer from '../modules/summarizer.js';
import * as core from '../modules/core.js';
import * as utils from '../modules/utils.js';


const MODULE_NAME = 'the_ghost_face';

export const AUTO_TRIGGER_THRESHOLD = 10;

// 控制面板创建函数
export async function createGhostControlPanel() {
    const existingPanel = document.getElementById(PANEL_ID);
    if (existingPanel) existingPanel.remove();

    try {
        // 先算扩展目录
        const module_dir = window.get_extension_directory ?
            window.get_extension_directory() :
            get_extension_directory();

        // 再加载 HTML（注意在 ui/ 目录）
        const response = await fetch(`${module_dir}/ui/ghostpanel.html`);

        if (!response.ok) {
            throw new Error(`HTML加载失败: ${response.status}`);
        }

        const html = await response.text();
        document.body.insertAdjacentHTML('beforeend', html);

        applyThemeToDocument(currentTheme);

        // 🔧 重要：设置系统初始化状态（移到这里）
        if (typeof utils !== 'undefined' && utils.setSystemInitialized) {
            utils.setSystemInitialized(true);
        }

    } catch (error) {
        console.error("❌ [鬼面] 创建控制面板失败:", error);
        throw error;
    }
}

// 加载CSS
export async function loadGhostStyles() {
    const module_dir = window.get_extension_directory ?
        window.get_extension_directory() :
        get_extension_directory();

    // 避免重复加载
    if (document.querySelector('#ghost-face-styles')) {
        return true;
    }

    const link = document.createElement('link');
    link.id = 'ghost-face-styles';
    link.rel = 'stylesheet';
    link.href = `${module_dir}/ghostpanel.css`;

    return new Promise((resolve, reject) => {
        link.onload = () => {
            resolve(true);
        };
        link.onerror = () => {
            reject(false);
        };
        document.head.appendChild(link);
    });
}

// 更新主题
export function updatePanelTheme(themeName) {
    if (!THEME_CONFIGS[themeName]) return;
    currentTheme = themeName;
    applyThemeToDocument(themeName);
    const themeSelect = document.getElementById(`${PANEL_ID}_theme_select`);
    if (themeSelect) {
        themeSelect.value = themeName;
    }
    // 更新状态指示器（如果需要动态颜色）
    updateAutoStatus();
}

export function applyThemeToDocument(themeName) {
    if (!THEME_CONFIGS[themeName]) return;
    document.documentElement.setAttribute('data-ghost-theme', themeName);
    const panel = document.getElementById('the_ghost_face_control_panel');
    if (panel) panel.setAttribute('data-ghost-theme', themeName);
}


// 更新自动状态 
export function updateAutoStatus() {
    const statusDot = document.getElementById(`${PANEL_ID}_status`);
    const statusText = document.getElementById(`${PANEL_ID}_status_text`);
    const toggleButton = document.getElementById(`${PANEL_ID}_toggle_auto`);

    // 通过CSS类控制样式
    if (statusDot) {
        statusDot.className = autoTriggerEnabled ? 'status-enabled' : 'status-disabled';
    }

    if (toggleButton) {
        if (autoTriggerEnabled) {
            toggleButton.classList.remove('auto-disabled');
        } else {
            toggleButton.classList.add('auto-disabled');
        }
        // 如果使用CSS content，就不需要设置textContent
        // toggleButton.textContent = ''; // CSS会自动处理
    }

    // 只有动态文字内容需要在JS中设置
    if (statusText) {
        statusText.textContent = autoTriggerEnabled ? '自动尾随中' : '手动模式';
        statusText.className = autoTriggerEnabled ? 'status-enabled' : 'status-disabled';
    }
}

// 切换主题
export function changeTheme(themeName) {
    if (!THEME_CONFIGS[themeName]) return;

    const oldTheme = currentTheme;
    currentTheme = themeName;

    extension_settings.the_ghost_face = extension_settings.the_ghost_face || {};
    extension_settings.the_ghost_face.theme = themeName;
    saveSettingsDebounced();

    document.documentElement.setAttribute('data-ghost-theme', themeName);
    document.getElementById('the_ghost_face_control_panel')?.setAttribute('data-ghost-theme', themeName);

    const themeSelect = document.getElementById('the_ghost_face_control_panel_theme_select');
    if (themeSelect) themeSelect.value = themeName;

    // 🎯 记录主题切换
    logger.success(`🎨 主题已切换: ${oldTheme} → ${themeName}`);
}

// 加载用户设置
export function loadUserSettings() {
    const settings = extension_settings.the_ghost_face || {};
    userThreshold = settings.threshold || 4;
    userInterval = settings.interval || 30;
    keepMessagesCount = settings.keepMessages || 2;
    autoTriggerEnabled = settings.autoEnabled !== undefined ? settings.autoEnabled : false;

    const autoBtn = document.getElementById(`${PANEL_ID}_toggle_auto`);
    if (autoBtn) {
        autoBtn.dataset.autoEnabled = autoTriggerEnabled;
        autoBtn.textContent = `🐕 自动${autoTriggerEnabled ? 'ON' : 'OFF'}`;
    }
    // 更新输入框显示
    const thresholdInput = document.getElementById(`${PANEL_ID}_threshold_input`);
    const intervalInput = document.getElementById(`${PANEL_ID}_interval_input`);
    const keepMessagesInput = document.getElementById(`${PANEL_ID}_keep_messages_input`);


    if (thresholdInput) thresholdInput.value = userThreshold;
    if (intervalInput) intervalInput.value = userInterval;
    if (keepMessagesInput) keepMessagesInput.value = keepMessagesCount;


    // 更新显示
    updateThresholdDisplay();
    updateAutoStatus();

    currentTheme = settings.theme || 'cyberpunk';
    updatePanelTheme(currentTheme); // 确保主题被应用
    loadCustomApiSettings();
    // 🆕 更新UI状态
    const useCustomApiCheckbox = document.getElementById('the_ghost_face_control_panel_use_custom_api_checkbox');
    const apiConfigDiv = document.getElementById('the_ghost_face_control_panel_custom_api_config');
    const urlInput = document.getElementById('the_ghost_face_control_panel_custom_api_url');
    const keyInput = document.getElementById('the_ghost_face_control_panel_custom_api_key');
    const modelSelect = document.getElementById('the_ghost_face_control_panel_custom_api_model');

    if (useCustomApiCheckbox) {
        useCustomApiCheckbox.checked = useCustomApi;
    }

    if (apiConfigDiv) {
        apiConfigDiv.style.display = useCustomApi ? 'block' : 'none';
    }

    if (urlInput) urlInput.value = customApiConfig.url;
    if (keyInput) keyInput.value = customApiConfig.apiKey;
    if (modelSelect && customApiConfig.model) {
        modelSelect.innerHTML = `<option value="${customApiConfig.model}">${customApiConfig.model} (已保存)</option>`;
    }

    updateApiStatusDisplay();
}

// 保存用户设置
export function saveUserSettings() {
    extension_settings.the_ghost_face = extension_settings.the_ghost_face || {};
    extension_settings.the_ghost_face.threshold = userThreshold;
    extension_settings.the_ghost_face.interval = userInterval;
    extension_settings.the_ghost_face.keepMessages = keepMessagesCount;
    extension_settings.the_ghost_face.autoEnabled = autoTriggerEnabled;
    saveSettingsDebounced();
}

// 更新面板的动态数据
export function updatePanelWithCurrentData() {
    // 更新主题
    const themeSelect = document.getElementById(`${PANEL_ID}_theme_select`);
    if (themeSelect) {
        themeSelect.value = currentTheme;
    }

    // 更新状态
    updateAutoStatus();
}

// 更新阈值
export function updateThresholdDisplay() {
    const thresholdDisplay = document.getElementById(`${PANEL_ID}_threshold_display`);
    if (thresholdDisplay) {
        thresholdDisplay.textContent = userThreshold;
    }
}

export function toggleSettingsMenu() {
    const settingsArea = document.getElementById(`${PANEL_ID}_settings_area`);
    const settingsBtn = document.getElementById('the_ghost_face_control_panel_settings_toggle');

    if (!settingsArea || !settingsBtn) return;

    // 直接切换类名
    const isExpanded = settingsBtn.classList.contains('active');

    if (isExpanded) {
        settingsArea.style.display = 'none';
        settingsBtn.classList.remove('active');
        settingsBtn.innerHTML = '⚙️ 设置菜单';
    } else {
        settingsArea.style.display = 'block';
        settingsBtn.classList.add('active');
        settingsBtn.innerHTML = '⚙️ 收起设置';
    }
}

//清空日志功能的更新
export function clearLogContent() {
    const content = document.getElementById(`${PANEL_ID}_log_content`);
    if (!content) {
        logger.warn('⚠️ 日志内容区域未找到，无法清空');
        return;
    }

    // 🎯 添加清除动画
    content.classList.add('clearing');

    setTimeout(() => {
        // 🎯 恢复到占位符状态
        content.innerHTML = `
            <div class="log-placeholder">
                <span class="placeholder-icon">👻</span>
                <span class="placeholder-text">等待下一个受害者</span>
            </div>
        `;
        content.classList.remove('clearing');

        logger.info('📋 日志已清空');
    }, 500);
}

// 设置面板事件
let _bigSummaryRangeBound = false;
export function setupPanelEvents() {
    // ===== 主要功能按钮 =====

    // 🐕 自动开关按钮
    const autoBtn = document.getElementById('the_ghost_face_control_panel_toggle_auto');
    if (autoBtn) {
        autoBtn.addEventListener('click', toggleAutoMode);
    }

    // ⚙️ 鬼面功能按钮
    const settingsBtn = document.getElementById('the_ghost_face_control_panel_settings_toggle');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', toggleSettingsMenu);
    }

    // ===== 总结功能按钮 =====

    // 📝 指定范围总结按钮
    const manualRangeBtn = document.getElementById('the_ghost_face_control_panel_manual_summary_range');
    if (manualRangeBtn) {
        manualRangeBtn.addEventListener('click', handleManualRangeSummary);
    }

    // 🚀 自动分段总结按钮
    const autoChunkBtn = document.getElementById('the_ghost_face_control_panel_auto_chunk_summary');
    if (autoChunkBtn) {
        autoChunkBtn.addEventListener('click', handleAutoChunkSummary);
    }

    // ===== 输入框事件 =====

    // 🎯 消息阈值输入框
    const thresholdInput = document.getElementById('the_ghost_face_control_panel_threshold_input');
    if (thresholdInput) {
        thresholdInput.addEventListener('change', (e) => {
            const newValue = parseInt(e.target.value) || 10;
            if (newValue < 10 || newValue > 100) {
                toastr.warning('消息阈值应在10-100之间');
                e.target.value = userThreshold;
                return;
            }
            userThreshold = newValue;
            saveUserSettings();
            updateThresholdDisplay();
            logger.info(`🎯 阈值已更新为: ${userThreshold}`);
        });
    }

    // ⏰ 检测间隔输入框
    const intervalInput = document.getElementById('the_ghost_face_control_panel_interval_input');
    if (intervalInput) {
        intervalInput.addEventListener('change', (e) => {
            const newValue = parseInt(e.target.value) || 5;
            if (newValue < 1 || newValue > 60) {
                toastr.warning('检测间隔应在1-60分钟之间');
                e.target.value = userInterval;
                return;
            }
            userInterval = newValue;
            saveUserSettings();
            logger.info(`⏰ 检测间隔已更新为: ${userInterval}分钟`);
        });
    }

    // 📝 手动范围输入框 - 智能自动填充
    const manualStartInput = document.getElementById('the_ghost_face_control_panel_manual_start');
    const manualEndInput = document.getElementById('the_ghost_face_control_panel_manual_end');

    if (manualStartInput && manualEndInput) {
        // 起始楼层改变时，自动获取总消息数并填充结束楼层
        manualStartInput.addEventListener('input', async () => {
            const startValue = parseInt(manualStartInput.value);
            if (startValue && !manualEndInput.value) {
                try {
                    const context = await getContext();
                    const messages = getMessageArray(context);
                    manualEndInput.value = messages.length;
                    logger.debug(`📝 自动填充结束楼层: ${messages.length}`);
                } catch (error) {
                    logger.warn('📝 无法自动填充结束楼层:', error);
                }
            }
        });

        // 输入验证
        manualStartInput.addEventListener('change', (e) => {
            const value = parseInt(e.target.value);
            if (value < 1) {
                e.target.value = 1;
                toastr.warning('起始楼层不能小于1');
            }
        });

        manualEndInput.addEventListener('change', (e) => {
            const startValue = parseInt(manualStartInput.value) || 1;
            const endValue = parseInt(e.target.value);
            if (endValue < startValue) {
                e.target.value = startValue;
                toastr.warning('结束楼层不能小于起始楼层');
            }
        });
        setupCustomApiEvents();
    }

    // 🤖 分段总结输入框
    const chunkSizeInput = document.getElementById('the_ghost_face_control_panel_chunk_size');
    const keepMessagesInput = document.getElementById('the_ghost_face_control_panel_keep_messages');

    if (chunkSizeInput) {
        chunkSizeInput.addEventListener('change', (e) => {
            const value = parseInt(e.target.value);
            if (value < 2 || value > 10) {
                toastr.warning('每段楼层数应在2-10之间');
                e.target.value = 4;
            }
        });
    }

    if (keepMessagesInput) {
        keepMessagesInput.addEventListener('change', (e) => {
            const value = parseInt(e.target.value);
            if (value < 1 || value > 10) {
                toastr.warning('保留楼层数应在1-10之间');
                e.target.value = 2;
            }
        });
    }
    if (!_bigSummaryRangeBound) {
        _bigSummaryRangeBound = true;

        // ui.js
        const $btn = document.getElementById('the_ghost_face_control_panel_big_summary_range');
        if ($btn) {
            $btn.addEventListener('click', async () => {
                const startVal = parseInt(document.getElementById('the_ghost_face_control_panel_manual_start')?.value || '1', 10);
                const endRaw = document.getElementById('the_ghost_face_control_panel_manual_end')?.value;
                const endVal = endRaw ? parseInt(endRaw, 10) : null;

                $btn.disabled = true; $btn.classList.add('is-busy');
                try {
                    const result = await summarizer.handleLargeSummary({
                        startIndex: startVal - 1,
                        endIndex: endVal != null ? endVal - 1 : null,
                    });
                    toastr.success(`大总结完成：${result?.id || '已写入世界书'}`);
                    if (typeof updateWorldBookDisplay === 'function') await updateWorldBookDisplay();
                } catch (e) {
                    toastr.error(`大总结失败：${e?.message || e}`);
                } finally {
                    $btn.classList.remove('is-busy'); $btn.disabled = false;
                }
            }, { passive: true });
        }

    }

    // ===== 主题和设置相关 =====

    // 🎨 主题选择下拉框
    const themeSelect = document.getElementById('the_ghost_face_control_panel_theme_select');
    if (themeSelect) {
        themeSelect.addEventListener('change', (e) => {
            changeTheme(e.target.value);
            logger.info(`🎨 主题已切换为: ${e.target.value}`);
        });
    }

    // 📋 清空日志按钮
    const clearLogBtn = document.getElementById('the_ghost_face_control_panel_clear_log');
    if (clearLogBtn) {
        clearLogBtn.addEventListener('click', () => {
            // 🎯 调用专门的清空函数，而不是直接操作content
            clearLogContent();
        });
    }

    // 点击外部关闭面板
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('the_ghost_face_control_panel_content');
        if (panel && !panel.contains(e.target) && isPanelOpen) {
            closePanel();
        }
    });
}

//主题切换处理函数
export function handleThemeToggle() {
    const themes = Object.keys(THEME_CONFIGS);
    const currentIndex = themes.indexOf(currentTheme);
    const nextIndex = (currentIndex + 1) % themes.length;
    const nextTheme = themes[nextIndex];

    changeTheme(nextTheme);

    // 更新下拉框显示
    const themeSelect = document.getElementById('the_ghost_face_control_panel_theme_select');
    if (themeSelect) {
        themeSelect.value = nextTheme;
    }

    toastr.info(`🎨 主题已切换为: ${THEME_CONFIGS[nextTheme].name}`);
    logger.info(`🎨 主题已切换为: ${nextTheme}`);
}

// 切换自动模式
export function toggleAutoMode() {
    autoTriggerEnabled = !autoTriggerEnabled;
    saveUserSettings();
    // 更新按钮状态
    const autoBtn = document.getElementById('the_ghost_face_control_panel_toggle_auto');
    if (autoBtn) {
        autoBtn.dataset.autoEnabled = autoTriggerEnabled;
        autoBtn.textContent = `🐕 自动${autoTriggerEnabled ? 'ON' : 'OFF'}`;
    }

    // 更新所有状态显示
    updateStatusDisplay();
    updateAutoStatus(); // 如果有状态指示器

    // 调试输出
    logger.info(`自动总结功能已${autoTriggerEnabled ? '开启' : '关闭'}`);
}

// 更新状态显示
export function updateStatusDisplay() {
    const statusContainer = document.getElementById(`${PANEL_ID}_status_text`);
    if (statusContainer) {
        statusContainer.textContent = autoTriggerEnabled ? '自动尾随中' : '手动模式';
    }
}

// 更新消息计数
export async function updateMessageCount() {
    try {
        const context = await getContext();
        const messages = getMessageArray(context);

        // 只更新数字，样式通过CSS
        const messageCountElement = document.getElementById(`${PANEL_ID}_message_count`);
        if (messageCountElement) {
            messageCountElement.textContent = messages.length;

            // 可选：根据消息数量添加状态类
            messageCountElement.className = messages.length > AUTO_TRIGGER_THRESHOLD ? 'count-high' : 'count-normal';
        }
    } catch (error) {
        logger.warn('📊 无法更新消息计数:', error);
    }
}

// 初始化时加载保存的主题
export function loadSavedTheme() {
    const saved = JSON.parse(localStorage.getItem('ghost_face_settings'));
    if (saved?.theme) {
        currentTheme = saved.theme;
    }
}

// 检查面板是否准备就绪
export function isPanelReady() {
    const content = document.getElementById(`${PANEL_ID}_log_content`);
    return content !== null && content.classList !== undefined;
}

// UI控制变量
export let isPanelOpen = false;
export const PANEL_ID = `${MODULE_NAME}_control_panel`;
export const MAX_LOG_ENTRIES = 100;

// 初始化标志
export let systemInitialized = false;

// 实时更新选择的世界书
export let worldSelectListenerAttached = false;
export let worldSelectChangeHandler = null;
export let worldSelectObserver = null;

export function setupWorldBookListener() {
    // 全局单例旗标（跨模块/热重载也能记住）
    if (window.GF_worldSelectListenerAttached) return;

    const tryBind = () => {
        const worldSelect = document.querySelector('#world_editor_select');
        if (!worldSelect) return false;

        // 若已存在旧的 handler，先解绑（防重复）
        if (worldSelectChangeHandler) {
            worldSelect.removeEventListener('change', worldSelectChangeHandler);
        }

        worldSelectChangeHandler = () => {
            // 去抖：短时间多次 change 只触发一次
            if (window.GF_chatChangeDebouncing) return;
            window.GF_chatChangeDebouncing = true;
            setTimeout(() => (window.GF_chatChangeDebouncing = false), 300);

            if (typeof core.handleChatChange === 'function') {
                core.handleChatChange();
            }
        };

        worldSelect.addEventListener('change', worldSelectChangeHandler, { passive: true });
        worldSelectListenerAttached = true;
        window.GF_worldSelectListenerAttached = true;

        // 绑定成功就停止观察
        if (worldSelectObserver) {
            worldSelectObserver.disconnect();
            worldSelectObserver = null;
        }
        return true;
    };

    // 先尝试一次
    if (tryBind()) return;

    // 没找到就用 MutationObserver（更稳），不要 setInterval
    worldSelectObserver = new MutationObserver(() => {
        if (tryBind()) {
            // 成功后 observer 会在 tryBind 里断开
        }
    });
    worldSelectObserver.observe(document.body, { childList: true, subtree: true });
}

// 更新世界书显示函数
export async function updateWorldBookDisplay() {
    const displayElement = document.getElementById('the_ghost_face_control_panel_worldbook_display');

    try {
        // 🎯 第1步：获取世界书名称
        let worldBookName = null;

        // 优先使用自动检测的绑定世界书
        worldBookName = await utils.findActiveWorldBook();

        // 如果自动检测失败，回退到手动检测
        if (!worldBookName) {
            const worldSelect = document.querySelector('#world_editor_select');
            if (worldSelect && worldSelect.value) {
                worldBookName = worldSelect.selectedOptions[0].textContent || '未知世界书';
            }
        }

        // 🎯 第2步：获取角色名称（使用你原来的成功方法）
        let characterName = '未知角色';

        try {
            // 方法1：使用ST的角色信息（最可靠）
            if (typeof this_chid !== 'undefined' && characters && characters[this_chid]) {
                characterName = characters[this_chid].name || 'Unknown';
                console.log(`📚 使用角色信息获取: ${characterName}`);
            }
            // 方法2：使用chat_metadata
            else if (typeof chat_metadata !== 'undefined' && chat_metadata.file_name) {
                characterName = chat_metadata.file_name.replace(/\.jsonl$/, '').replace(/\.json$/, '');
                console.log(`📚 使用chat_metadata获取: ${characterName}`);
            }
            // 方法3：从chat数组生成描述
            else if (Array.isArray(chat) && chat.length > 0) {
                characterName = `聊天_${chat.length}条消息`;
                console.log(`📚 使用消息数量生成: ${characterName}`);
            }
            // 方法4：从DOM元素获取
            else {
                const chatNameElement = document.querySelector('#chat_filename') ||
                    document.querySelector('[data-chat-name]') ||
                    document.querySelector('.chat-name') ||
                    document.querySelector('#character_name') ||
                    document.querySelector('.character-name');

                if (chatNameElement) {
                    const rawName = chatNameElement.textContent || chatNameElement.dataset.chatName;
                    if (rawName && rawName.trim()) {
                        characterName = rawName.replace(/\.jsonl$/, '').replace(/\.json$/, '').trim();
                        console.log(`📚 从DOM获取: ${characterName}`);
                    }
                }
            }
        } catch (e) {
            console.warn('📚 获取角色名称失败，使用备用方案:', e);
            // 最后的备用方案：使用时间生成
            characterName = `聊天_${new Date().getHours()}${new Date().getMinutes()}`;
        }

        // 🎯 第3步：更新显示
        if (!worldBookName) {
            const warnMsg = `📚 状态：当前角色"${characterName}"未绑定世界书`;
            logger.warn(warnMsg);
            if (displayElement) {
                displayElement.innerHTML = `⚠️ 未绑定世界书 | 对象: <strong>${characterName}</strong>`;
                displayElement.className = 'status-disabled';
            }
        } else {
            const infoString = `📚 世界书: ${worldBookName} | ❤对象: ${characterName}`;
            logger.info(infoString);
            if (displayElement) {
                displayElement.innerHTML = `<span>📚</span> 锁定: <strong>${worldBookName}</strong> | ❤对象: <strong>${characterName}</strong>`;
                displayElement.className = 'status-enabled';
            }
        }

    } catch (error) {
        console.error('📚 更新世界书显示失败:', error);
        if (displayElement) {
            displayElement.innerHTML = '❌ 获取信息失败';
            displayElement.className = 'status-disabled';
        }
    }
}
// 主题配置
export const THEME_CONFIGS = {
    ocean: { name: '深海叹息' },
    cyberpunk: { name: '赛博朋克' },
    gothic: { name: '哥特暗黑' },
    scifi: { name: '科技空梦' },
    military: { name: '战术迷彩' },
    cosmic: { name: '无尽星辰' },
    emerald: { name: '翡翠森林' },
    abyss: { name: '深渊凝望' },
    thepig: { name: '猪猪来咯' }
};

// 当前主题
export let currentTheme = 'cyberpunk';

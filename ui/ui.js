// ui.js
import { getContext, extension_settings, } from '../../../../extensions.js';
import { chat_metadata, getMaxContextSize, generateRaw, streamingProcessor, main_api, system_message_types, saveSettingsDebounced, getRequestHeaders, saveChatDebounced, chat, this_chid, characters, reloadCurrentChat, } from '../../../../../script.js';
import { createWorldInfoEntry, deleteWIOriginalDataValue, deleteWorldInfoEntry, importWorldInfo, loadWorldInfo, saveWorldInfo, world_info } from '../../../../world-info.js';
import { eventSource, event_types } from '../../../../../script.js';
import { download, debounce, initScrollHeight, resetScrollHeight, parseJsonFile, extractDataFromPng, getFileBuffer, getCharaFilename, getSortableDelay, escapeRegex, PAGINATION_TEMPLATE, navigation_option, waitUntilCondition, isTrueBoolean, setValueByPath, flashHighlight, select2ModifyOptions, getSelect2OptionId, dynamicSelect2DataViaAjax, highlightRegex, select2ChoiceClickSubscribe, isFalseBoolean, getSanitizedFilename, checkOverwriteExistingData, getStringHash, parseStringArray, cancelDebounce, findChar, onlyUnique, equalsIgnoreCaseAndAccents } from '../../../../utils.js';

import * as summarizer from '../modules/summarizer.js';
import * as core from '../modules/core.js';
import * as utils from '../modules/utils.js';
import * as api from '../modules/api.js';
import * as gf_chat from '../modules/chat.js';
import * as backup from '../modules/backup.js';

import { ghostFacePanelTemplate } from './panelTemplate.js';
import { openMomentsPanel, initMomentsUI } from './moments/momentsUI.js';
import { setupWorldbookManagerEvents, renderWorldbookManagerPanel } from './worldbookManagerUI.js';

export { initMomentsUI };


const MODULE_NAME = 'the_ghost_face';

export const AUTO_TRIGGER_THRESHOLD = 500; // Token threshold for color change

// 控制面板创建函数
export async function createGhostControlPanel() {
    const existingPanel = document.getElementById(PANEL_ID);
    if (existingPanel) existingPanel.remove();

    try {
        const hostCandidates = [
            document.getElementById('ghostface_drawer_content'),
            document.getElementById('ghostface_extension_panel_host'),
        ];
        let host = hostCandidates.find(Boolean);

        if (!host) {
            host = document.getElementById('ghostface_panel_mount');
        }

        if (!host) {
            host = document.createElement('div');
            host.id = 'ghostface_panel_mount';
            document.body.appendChild(host);
        }

        const placeholder = host.querySelector('.gf-drawer-loader');
        if (placeholder) placeholder.remove();

        host.innerHTML = ghostFacePanelTemplate;


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




// 更新自动状态 
export function updateAutoStatus() {
    const statusDot = document.getElementById(`${PANEL_ID}_status`);
    const statusText = document.getElementById(`${PANEL_ID}_status_text`);
    const toggleButton = document.getElementById(`${PANEL_ID}_toggle_auto`);

    // 通过CSS类控制样式
    if (statusDot) {
        statusDot.className = core.autoTriggerEnabled ? 'status-enabled' : 'status-disabled';
    }

    if (toggleButton) {
        if (core.autoTriggerEnabled) {
            toggleButton.classList.remove('auto-disabled');
        } else {
            toggleButton.classList.add('auto-disabled');
        }
        toggleButton.dataset.autoEnabled = core.autoTriggerEnabled;
        toggleButton.textContent = `自动${core.autoTriggerEnabled ? 'ON' : 'OFF'}`;
    }

    // 只有动态文字内容需要在JS中设置
    if (statusText) {
        statusText.textContent = core.autoTriggerEnabled ? '自动尾随中' : '手动模式';
        statusText.className = core.autoTriggerEnabled ? 'status-enabled' : 'status-disabled';
    }
}



// 加载用户设置
export function loadUserSettings() {
    const settings = extension_settings.the_ghost_face || {};
    // Default token threshold higher (10000) than message threshold (4)
    core.setUserTokenThreshold(settings.tokenThreshold || 10000);
    core.setUserInterval(settings.interval !== undefined ? settings.interval : 30);

    core.setAutoTriggerEnabled(settings.autoEnabled !== undefined ? settings.autoEnabled : false);

    const thresholdInput = document.getElementById('the_ghost_face_token_threshold');
    if (thresholdInput) thresholdInput.value = core.userTokenThreshold / 10000;

    const intervalInput = document.getElementById('the_ghost_face_control_panel_interval_input');
    if (intervalInput) intervalInput.value = core.userInterval;



    const chunkSizeInput = document.getElementById('the_ghost_face_control_panel_chunk_size');
    if (chunkSizeInput && settings.chunkSize) chunkSizeInput.value = settings.chunkSize;


    // ✅ 读取当前角色的自定义世界书设置
    const customWbContainer = document.getElementById('the_ghost_face_custom_wb_container');
    const customWbSelect = document.getElementById('the_ghost_face_custom_wb_select');
    if (customWbContainer && customWbSelect) {

        // Ensure options are populated
        populateCustomWorldBookSelect();

        // Load saved selection for current character if exists
        const currentChid = utils.getCurrentChid();
        if (currentChid && settings.customWbMap && settings.customWbMap[currentChid]) {
            customWbSelect.value = settings.customWbMap[currentChid];
        } else {
            customWbSelect.value = '';
        }

        // Need to remove previous listener if we bind it here, or just bind it once using a flag:
        if (!customWbSelect.dataset.listenerBound) {
            customWbSelect.addEventListener('change', (e) => {
                const currentChid = utils.getCurrentChid();
                if (!currentChid) {
                    toastr.warning('无法获取当前角色，无法保存世界书设置');
                    return;
                }

                extension_settings.the_ghost_face = extension_settings.the_ghost_face || {};
                extension_settings.the_ghost_face.customWbMap = extension_settings.the_ghost_face.customWbMap || {};

                if (e.target.value) {
                    extension_settings.the_ghost_face.customWbMap[currentChid] = e.target.value;
                    toastr.success(`已为当前角色指定世界书`);
                } else {
                    delete extension_settings.the_ghost_face.customWbMap[currentChid];
                    toastr.info('已清除当前角色的世界书指定');
                }

                saveSettingsDebounced();

                // Trigger update of the display
                if (typeof updateWorldBookDisplay === 'function') updateWorldBookDisplay();
            });
            customWbSelect.dataset.listenerBound = 'true';
        }
    }


    // 🙈 总结后自动隐藏 开关
    const autoHideCheckbox = document.getElementById('the_ghost_face_auto_hide_after_sum');
    if (autoHideCheckbox) {
        const autoHide = settings.autoHideAfterSum !== undefined ? settings.autoHideAfterSum : true;
        autoHideCheckbox.checked = autoHide;
        autoHideCheckbox.addEventListener('change', (e) => {
            extension_settings.the_ghost_face = extension_settings.the_ghost_face || {};
            extension_settings.the_ghost_face.autoHideAfterSum = e.target.checked;
            saveSettingsDebounced();
            toastr.info(`总结后自动隐藏已${e.target.checked ? '开启' : '关闭'}`);
        });
    }

    // 更新显示
    updateThresholdDisplay();
    updateAutoStatus();


    api.loadCustomApiSettings();
    // 🆕 更新UI状态
    const useCustomApiCheckbox = document.getElementById('the_ghost_face_control_panel_use_custom_api_checkbox');
    const apiConfigDiv = document.getElementById('the_ghost_face_control_panel_custom_api_config');
    const urlInput = document.getElementById('the_ghost_face_control_panel_custom_api_url');
    const keyInput = document.getElementById('the_ghost_face_control_panel_custom_api_key');
    const modelSelect = document.getElementById('the_ghost_face_control_panel_custom_api_model');

    if (useCustomApiCheckbox) {
        useCustomApiCheckbox.checked = api.useCustomApi;
    }

    if (apiConfigDiv) {
        apiConfigDiv.style.display = api.useCustomApi ? 'block' : 'none';
    }

    if (urlInput) urlInput.value = api.customApiConfig.url;
    if (keyInput) keyInput.value = api.customApiConfig.apiKey;
    if (modelSelect && api.customApiConfig.model) {
        modelSelect.innerHTML = `<option value="${api.customApiConfig.model}">${api.customApiConfig.model} (已保存)</option>`;
    }


    api.updateApiStatusDisplay();

    // 📦 备份设置加载
    backup.loadBackupSettings();
    backup.updateBackupConfigUI();
}

// 保存用户设置
export function saveUserSettings() {
    extension_settings.the_ghost_face = extension_settings.the_ghost_face || {};
    extension_settings.the_ghost_face.tokenThreshold = core.userTokenThreshold;
    extension_settings.the_ghost_face.interval = core.userInterval;

    extension_settings.the_ghost_face.autoEnabled = core.autoTriggerEnabled;
    const chunkSizeInput = document.getElementById('the_ghost_face_control_panel_chunk_size');
    if (chunkSizeInput) {
        extension_settings.the_ghost_face.chunkSize = parseInt(chunkSizeInput.value) || 4;
    }
    saveSettingsDebounced();
}

// 更新面板的动态数据
export function updatePanelWithCurrentData() {
    // 更新状态
    updateAutoStatus();
}

// 更新阈值显示
function updateThresholdDisplay() {
    const display = document.getElementById(`${PANEL_ID}_threshold_display`);
    if (display) {
        display.textContent = core.userTokenThreshold;
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
        settingsBtn.innerHTML = '设置菜单';
    } else {
        settingsArea.style.display = 'block';
        settingsBtn.classList.add('active');
        settingsBtn.innerHTML = '收起设置';
    }
}

//清空日志功能的更新
export function clearLogContent() {
    const content = document.getElementById(`${PANEL_ID}_log_content`);
    if (!content) return;

    content.innerHTML = '<div class="log-line log-placeholder">👻 等待下一个受害者...</div>';
}

export function populateCustomWorldBookSelect() {
    const customSelect = document.getElementById('the_ghost_face_custom_wb_select');
    const stSelect = document.querySelector('#world_editor_select');
    if (!customSelect || !stSelect) return;

    // 清除现有选项
    customSelect.innerHTML = '<option value="">未选择</option>';

    // 从 SillyTavern 的世界书选择器复制选项
    Array.from(stSelect.options).forEach(opt => {
        if (opt.value) { // 跳过空/默认选项
            const newOpt = document.createElement('option');
            newOpt.value = opt.value;
            newOpt.textContent = opt.textContent;
            customSelect.appendChild(newOpt);
        }
    });

    // 尝试读取当前角色的设定值
    const currentChid = utils.getCurrentChid();
    let targetValue = '';

    if (currentChid && extension_settings?.the_ghost_face?.customWbMap?.[currentChid]) {
        targetValue = extension_settings.the_ghost_face.customWbMap[currentChid];
    }

    if (targetValue) {
        // 确保新列表中存在该值
        const exists = Array.from(customSelect.options).some(opt => opt.value === targetValue);
        if (exists) {
            customSelect.value = targetValue;
        } else {
            customSelect.value = '';
        }
    } else {
        customSelect.value = '';
    }
}

// 设置面板事件
let _bigSummaryRangeBound = false;
export function setupPanelEvents() {
    // ===== 主要功能按钮 =====

    // 初始化自定义世界书选择器选项
    populateCustomWorldBookSelect();

    // 自动开关按钮
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

    // 🚀 自动分段总结按钮
    const autoChunkBtn = document.getElementById('the_ghost_face_control_panel_auto_chunk_summary');
    if (autoChunkBtn) {
        autoChunkBtn.addEventListener('click', handleAutoChunkSummary);
    }

    // 🙈 隐藏范围按钮
    const hideRangeBtn = document.getElementById('the_ghost_face_control_panel_hide_range');
    if (hideRangeBtn) {
        hideRangeBtn.addEventListener('click', async () => {
            const startInput = document.getElementById('the_ghost_face_control_panel_manual_start');
            const endInput = document.getElementById('the_ghost_face_control_panel_manual_end');
            const startVal = parseInt(startInput?.value) || 1;
            const endVal = parseInt(endInput?.value);

            if (!endVal || endVal < startVal) {
                toastr.warning('请输入有效的起始和结束楼层');
                return;
            }

            hideRangeBtn.disabled = true;
            hideRangeBtn.classList.add('is-busy');
            try {
                await core.hideMessagesRange(startVal - 1, endVal - 1);
                //toastr.success(`🙈 已隐藏第${startVal}-${endVal}楼`);
            } catch (err) {
                toastr.error(`隐藏失败: ${err.message}`);
            } finally {
                hideRangeBtn.disabled = false;
                hideRangeBtn.classList.remove('is-busy');
            }
        });
    }

    // ===== 输入框事件 =====

    // 4. Token阈值 (Message Threshold -> Token Threshold)
    const thresholdInput = document.getElementById('the_ghost_face_token_threshold');
    if (thresholdInput) {
        thresholdInput.value = core.userTokenThreshold / 10000;
        // Check core.userTokenThreshold
        thresholdInput.addEventListener('change', (e) => {
            const input = e.target;
            const value = input.value;
            const newValue = parseFloat(value) || 1;
            if (newValue < 4 || newValue > 800) { // Adjusted range for token threshold in W
                toastr.warning('Token阈值应在4-800(万)之间');
                input.value = core.userTokenThreshold / 10000;
                return;
            }
            if (input.id === 'the_ghost_face_token_threshold') {
                const val = parseFloat(value);
                if (!isNaN(val) && val > 0) {
                    core.setUserTokenThreshold(Math.round(val * 10000));
                    updateThresholdDisplay();
                    saveUserSettings(); // Save settings after change
                    logger.info(`🎯 Token阈值已更新为: ${core.userTokenThreshold}`);
                }
            }
        });
    }

    // 消息阈值输入框
    const intervalInput = document.getElementById('the_ghost_face_control_panel_interval_input');
    if (intervalInput) {
        intervalInput.addEventListener('change', (e) => {
            const newValue = parseInt(e.target.value);
            if (isNaN(newValue) || newValue < 10 || newValue > 100) {
                toastr.warning('消息阈值应在10-100之间');
                e.target.value = core.userInterval;
                return;
            }
            core.setUserInterval(newValue);
            saveUserSettings();
            logger.info(`📨 消息阈值已更新为: ${core.userInterval} 条${newValue === 0 ? '（已禁用）' : ''}`);
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
    }

    // 🔧 API事件绑定（必须在 if 外面，避免因手动范围输入框不存在而跳过）
    api.setupCustomApiEvents();

    // 🤖 高楼层总结输入框
    const chunkSizeInput = document.getElementById('the_ghost_face_control_panel_chunk_size');

    if (chunkSizeInput) {
        chunkSizeInput.addEventListener('change', (e) => {
            const value = parseInt(e.target.value);
            if (value < 10 || value > 100) {
                toastr.warning('分段大小应在10-100楼/段之间');
                e.target.value = extension_settings?.the_ghost_face?.chunkSize || 50;
            } else {
                saveUserSettings();
            }
        });
    }

    if (!_bigSummaryRangeBound) {
        _bigSummaryRangeBound = true;

        // 三合一大总结按钮 — 委托给 handleManualRangeSummary（记忆碎片 → 时间线 → 大总结）
        const $btn = document.getElementById('the_ghost_face_control_panel_big_summary_range');
        if ($btn) {
            $btn.addEventListener('click', async () => {
                await summarizer.handleManualRangeSummary();
            }, { passive: true });
        }

    }

    // 📋 清空日志按钮
    const clearLogBtn = document.getElementById('the_ghost_face_control_panel_clear_log');
    if (clearLogBtn) {
        clearLogBtn.addEventListener('click', () => {
            // 🎯 调用专门的清空函数，而不是直接操作content
            clearLogContent();
        });
    }

    // (Removed: dead click-outside handler — closePanel() was undefined and isPanelOpen was never true)

    // 朋友圈按钮
    const momentsBtn = document.getElementById('the_ghost_face_moments_btn');
    if (momentsBtn) {
        momentsBtn.addEventListener('click', () => {
            momentsBtn.classList.add('active');
            openMomentsPanel();
        });

        // Watch for the overlay closing so we can remove .active
        const _watchOverlay = () => {
            const overlay = document.getElementById('moments_overlay');
            if (!overlay) {
                // Overlay not yet in DOM — retry once after panel mounts
                setTimeout(_watchOverlay, 500);
                return;
            }
            const obs = new MutationObserver(() => {
                if (!overlay.classList.contains('moments-visible')) {
                    momentsBtn.classList.remove('active');
                }
            });
            obs.observe(overlay, { attributes: true, attributeFilter: ['class'] });
        };
        _watchOverlay();
    }

    // 世界书管理按钮
    const wbTabBtn = document.getElementById('gf_tab_worldbook_manager');
    const wbPanel = document.getElementById('ghostface_worldbook_manager_panel');
    if (wbTabBtn && wbPanel) {
        wbTabBtn.addEventListener('click', () => {
            const isExpanded = wbTabBtn.classList.contains('active');
            if (isExpanded) {
                wbPanel.style.display = 'none';
                wbTabBtn.classList.remove('active');
            } else {
                wbPanel.style.display = 'block';
                wbTabBtn.classList.add('active');
                renderWorldbookManagerPanel();
            }
        });
    }

    // Binding logic related to the new worldbook UI component (refresh buttons etc.)
    setupWorldbookManagerEvents();


    // 💬 初始化迷你聊天窗口
    gf_chat.initChat();

    // 📦 备份事件绑定
    backup.setupBackupEvents();
}



// 切换自动模式
export function toggleAutoMode() {
    core.setAutoTriggerEnabled(!core.autoTriggerEnabled);
    saveUserSettings();
    // 更新按钮状态
    const autoBtn = document.getElementById('the_ghost_face_control_panel_toggle_auto');
    if (autoBtn) {
        autoBtn.dataset.autoEnabled = core.autoTriggerEnabled;
        autoBtn.textContent = `自动${core.autoTriggerEnabled ? 'ON' : 'OFF'}`;
    }

    // 更新所有状态显示
    updateStatusDisplay();
    updateAutoStatus(); // 如果有状态指示器

    // 调试输出
    logger.info(`自动总结功能已${core.autoTriggerEnabled ? '开启' : '关闭'}`);
}

// 更新状态显示
export function updateStatusDisplay() {
    const statusContainer = document.getElementById(`${PANEL_ID}_status_text`);
    if (statusContainer) {
        statusContainer.textContent = core.autoTriggerEnabled ? '自动尾随中' : '手动模式';
    }
}

// 更新Token计数
export async function updateMessageCount() {
    try {
        // Prefer the cached count from chat_completion_prompt_ready event (most accurate)
        let count = core.lastKnownTokenCount;

        // Fallback: if no prompt event has fired yet, estimate from chat messages
        if (count <= 0) {
            const context = await getContext();
            count = await core.getTokenCount(context);
        }

        // 只更新数字，样式通过CSS
        const messageCountElement = document.getElementById(`${PANEL_ID}_message_count`);
        if (messageCountElement) {
            messageCountElement.textContent = count;
            messageCountElement.className = count > core.userTokenThreshold ? 'count-high' : 'count-normal';
        }

        // Update visible message counter display
        const msgCounterEl = document.getElementById(`${PANEL_ID}_msg_counter`);
        if (msgCounterEl) {
            // Count actual visible (non-hidden) messages from the chat array
            const context = getContext();
            const messages = core.getMessageArray(context);
            const visibleCount = messages.filter(m => !m.is_hidden && !m.is_system).length;
            msgCounterEl.textContent = visibleCount;
        }

        // Update message threshold display
        const msgThresholdEl = document.getElementById(`${PANEL_ID}_msg_threshold_display`);
        if (msgThresholdEl) {
            msgThresholdEl.textContent = core.userInterval;
        }

        // Update token threshold display
        const tokenThresholdEl = document.getElementById(`${PANEL_ID}_threshold_display`);
        if (tokenThresholdEl) {
            tokenThresholdEl.textContent = core.userTokenThreshold;
        }
    } catch (error) {
        logger.warn('📊 无法更新Token计数:', error);
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

export let systemInitialized = false;

export let worldSelectListenerAttached = false;
export let worldSelectChangeHandler = null;
export let worldSelectObserver = null;

export function setupWorldBookListener() {
    if (window.GF_worldSelectListenerAttached) return;

    const tryBind = () => {
        const worldSelect = document.querySelector('#world_editor_select');
        if (!worldSelect) return false;

        if (worldSelectChangeHandler) {
            worldSelect.removeEventListener('change', worldSelectChangeHandler);
        }

        worldSelectChangeHandler = () => {
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

        if (worldSelectObserver) {
            worldSelectObserver.disconnect();
            worldSelectObserver = null;
        }
        return true;
    };

    if (tryBind()) return;

    worldSelectObserver = new MutationObserver(() => {
        if (tryBind()) {
        }
    });
    worldSelectObserver.observe(document.body, { childList: true, subtree: true });
}

// 更新世界书显示函数
export async function updateWorldBookDisplay() {
    const displayElement = document.getElementById('the_ghost_face_control_panel_worldbook_display');

    // Make sure the dropdown reflects the new character's selection
    populateCustomWorldBookSelect();

    try {
        let worldBookName = null;

        // Check for custom per-character world book
        const currentChid = utils.getCurrentChid();
        if (currentChid && extension_settings?.the_ghost_face?.customWbMap?.[currentChid]) {
            const customWbId = extension_settings.the_ghost_face.customWbMap[currentChid];
            const worldSelect = document.querySelector('#world_editor_select');
            if (worldSelect) {
                const option = Array.from(worldSelect.options).find(opt => opt.value === customWbId);
                if (option) {
                    worldBookName = option.textContent.trim();
                }
            }
        }

        if (!worldBookName) {
            const worldSelect = document.querySelector('#world_editor_select');
            if (worldSelect && worldSelect.value) {
                worldBookName = worldSelect.selectedOptions[0].textContent || '未知世界书';
            }
        }

        // ④ 获取角色名
        let characterName = '未知角色';
        try {
            const currentChid = utils.getCurrentChid();
            if (currentChid !== null && characters && characters[currentChid]) {
                characterName = characters[currentChid].name || 'Unknown';
            } else if (typeof chat_metadata !== 'undefined' && chat_metadata.file_name) {
                characterName = chat_metadata.file_name.replace(/\.jsonl$/, '').replace(/\.json$/, '');
            } else if (Array.isArray(chat) && chat.length > 0) {
                characterName = `聊天_${chat.length}条消息`;
            } else {
                const el = document.querySelector('#chat_filename,[data-chat-name],.chat-name,#character_name,.character-name');
                const raw = el?.textContent || el?.dataset?.chatName;
                if (raw && raw.trim()) {
                    characterName = raw.replace(/\.jsonl?$/, '').trim();
                }
            }
        } catch (e) {
            console.warn('获取角色名失败，使用兜底：', e);
            characterName = `聊天_${new Date().getHours()}${new Date().getMinutes()}`;
        }

        // ⑤ 渲染展示
        if (!worldBookName) {
            const msg = `📚 状态：当前角色"${characterName}"未绑定世界书`;
            logger.warn(msg);
            if (displayElement) {
                displayElement.innerHTML = `⚠️ 未绑定世界书 | 对象: <strong>${characterName}</strong>`;
                displayElement.className = 'status-disabled';
            }
        } else {
            const info = `📚 世界书: ${worldBookName} | ❤对象: ${characterName}`;
            logger.info(info);
            if (displayElement) {
                displayElement.innerHTML = `<span>📚</span> 当前: <strong>${worldBookName}</strong> | ❤对象: <strong>${characterName}</strong>`;
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



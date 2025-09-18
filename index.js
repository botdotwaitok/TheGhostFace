// TheGhostFace - v3.1
// 091325
// 机器人

import {getContext,extension_settings,} from '../../../extensions.js';
import {chat_metadata, getMaxContextSize, generateRaw,streamingProcessor,main_api,system_message_types,saveSettingsDebounced,getRequestHeaders,saveChatDebounced,chat,this_chid,characters,reloadCurrentChat,} from '../../../../script.js';
import { createWorldInfoEntry,deleteWIOriginalDataValue,deleteWorldInfoEntry,importWorldInfo,loadWorldInfo,saveWorldInfo,world_info} from '../../../world-info.js';
import { eventSource, event_types } from '../../../../script.js';
import { download, debounce, initScrollHeight, resetScrollHeight, parseJsonFile, extractDataFromPng, getFileBuffer, getCharaFilename, getSortableDelay, escapeRegex, PAGINATION_TEMPLATE, navigation_option, waitUntilCondition, isTrueBoolean, setValueByPath, flashHighlight, select2ModifyOptions, getSelect2OptionId, dynamicSelect2DataViaAjax, highlightRegex, select2ChoiceClickSubscribe, isFalseBoolean, getSanitizedFilename, checkOverwriteExistingData, getStringHash, parseStringArray, cancelDebounce, findChar, onlyUnique, equalsIgnoreCaseAndAccents } from '../../../utils.js';
import { createGhostFaceDrawer } from './ui/topbar.js';
import * as ui from './ui/ui.js';
import * as core from './modules/core.js';
import * as summarizer from './modules/summarizer.js';
import * as utils from './modules/utils.js';
import * as worldbook from './modules/worldbook.js';
import * as api from './modules/api.js';

// 模块配置
const MODULE_NAME = 'the_ghost_face';
const MODULE_NAME_FANCY = '鬼面';
const PROGRESS_BAR_ID = `${MODULE_NAME}_progress_bar`;

// 将所有需要的变量和函数暴露到全局 window 对象
function setupGlobalExports() {
    console.log('🔧 [鬼面] 开始设置全局导出...');
    
    try {
        // 基础配置
        window.MODULE_NAME = MODULE_NAME;
        window.PANEL_ID = ui.PANEL_ID;
        window.MAX_LOG_ENTRIES = ui.MAX_LOG_ENTRIES;
        
        // 主题相关
        window.THEME_CONFIGS = ui.THEME_CONFIGS;
        window.currentTheme = ui.currentTheme;
        
        // 状态变量
        window.systemInitialized = ui.systemInitialized;
        window.isPanelOpen = ui.isPanelOpen;
        window.lastMessageCount = core.lastMessageCount;
        window.autoTriggerEnabled = core.autoTriggerEnabled;
        window.isAutoSummarizing = core.isAutoSummarizing;
        window.userThreshold = core.userThreshold;
        window.userInterval = core.userInterval;
        window.keepMessagesCount = core.keepMessagesCount;
        
        
        // API相关
        window.customApiConfig = api.customApiConfig;
        window.useCustomApi = api.useCustomApi;
        window.setupCustomApiEvents = api.setupCustomApiEvents;
        window.loadCustomApiSettings = api.loadCustomApiSettings;
        window.saveCustomApiSettings = api.saveCustomApiSettings;
        window.clearCustomApiSettings = api.clearCustomApiSettings;
        window.updateApiStatusDisplay = api.updateApiStatusDisplay;
        window.loadApiModels = api.loadApiModels;
        window.callCustomOpenAI = api.callCustomOpenAI;
        
        // 工具函数
        window.logger = utils.logger;
        window.escapeHtml = utils.escapeHtml;
        window.logToUI = utils.logToUI;
        window.LOG_LEVEL = utils.LOG_LEVEL;
        
        // UI函数
        window.createGhostControlPanel = ui.createGhostControlPanel;
        window.loadGhostStyles = ui.loadGhostStyles;
        window.updatePanelTheme = ui.updatePanelTheme;
        window.applyThemeToDocument = ui.applyThemeToDocument;
        window.updateAutoStatus = ui.updateAutoStatus;
        window.changeTheme = ui.changeTheme;
        window.loadUserSettings = ui.loadUserSettings;
        window.saveUserSettings = ui.saveUserSettings;
        window.updatePanelWithCurrentData = ui.updatePanelWithCurrentData;
        window.updateThresholdDisplay = ui.updateThresholdDisplay;
        window.toggleSettingsMenu = ui.toggleSettingsMenu;
        window.clearLogContent = ui.clearLogContent;
        window.setupPanelEvents = ui.setupPanelEvents;
        window.togglePanel = ui.togglePanel;
        window.openPanel = ui.openPanel;
        window.closePanel = ui.closePanel;
        window.toggleAutoMode = ui.toggleAutoMode;
        window.updateStatusDisplay = ui.updateStatusDisplay;
        window.updateMessageCount = ui.updateMessageCount;
        window.loadSavedTheme = ui.loadSavedTheme;
        window.isPanelReady = ui.isPanelReady;
        window.getCurrentWorldBookInfo = ui.getCurrentWorldBookInfo;
        window.setupWorldBookListener = ui.setupWorldBookListener;
        window.updateWorldBookDisplay = ui.updateWorldBookDisplay;
        
        // 核心功能函数
        window.setupMessageListener = core.setupMessageListener;
        window.checkAutoTrigger = core.checkAutoTrigger;
        window.stealthSummarize = core.stealthSummarize;
        window.getMessageArray = core.getMessageArray;
        window.initializeGhostFace = core.initializeGhostFace;
        window.get_extension_directory = core.get_extension_directory;
        window.saveChat = core.saveChat;
        window.refreshChatDisplay = core.refreshChatDisplay;
        window.restoreHiddenStateOnStartup = core.restoreHiddenStateOnStartup;
        window.hideMessagesRange = core.hideMessagesRange;
        window.getCurrentChatIdentifier = core.getCurrentChatIdentifier;
        window.cleanChatName = core.cleanChatName;
        window.updateFloorTrackingEntry = core.updateFloorTrackingEntry;
        
        // 总结相关函数
        window.isContentSimilar = summarizer.isContentSimilar;
        window.generateSummary = summarizer.generateSummary;
        window.handleManualRangeSummary = summarizer.handleManualRangeSummary;
        window.handleAutoChunkSummary = summarizer.handleAutoChunkSummary;
        window.getGhostContextMessages = summarizer.getGhostContextMessages;
        window.parseMessageContent = summarizer.parseMessageContent;
        window.calculateSimilarity = summarizer.calculateSimilarity;
        window.getEditDistance = summarizer.getEditDistance;
        window.isSemanticMatch = summarizer.isSemanticMatch;
        window.calculateStringSimilarity = summarizer.calculateStringSimilarity;
        window.hasMultilingualSemanticSimilarity = summarizer.hasMultilingualSemanticSimilarity;
        window.markMessagesSummarized = summarizer.markMessagesSummarized;
        window.parseModelOutput = summarizer.parseModelOutput;
        
        // 世界书相关函数
        window.getExistingWorldBookContext = worldbook.getExistingWorldBookContext;
        window.PREDEFINED_CATEGORIES = worldbook.PREDEFINED_CATEGORIES;
        window.createOrUpdateGhostSummaryEntry = worldbook.createOrUpdateGhostSummaryEntry;
        window.manageGhostSummaryEntries = worldbook.manageGhostSummaryEntries;
        window.saveToWorldBook = worldbook.saveToWorldBook;
        window.getMaxSummarizedFloorFromWorldBook = worldbook.getMaxSummarizedFloorFromWorldBook;
        window.GHOST_SUMMARY_PREFIX = worldbook.GHOST_SUMMARY_PREFIX;
        window.GHOST_TRACKING_COMMENT = worldbook.GHOST_TRACKING_COMMENT;
        
        console.log('✅ [鬼面] 全局函数导出完成');
        return true;
    } catch (error) {
        console.error('❌ [鬼面] 全局导出失败:', error);
        return false;
    }
}

// 防止旧悬浮面板被打开
const __openPanel_orig = window.openPanel; 
window.openPanel = (...args) => {
  const inDrawer = document.querySelector('#ghostface_drawer_content #the_ghost_face_control_panel');
  if (inDrawer) {
    console.log('[鬼面] 抽屉模式下忽略旧悬浮 openPanel');
    return;
  }
  return __openPanel_orig?.(...args);
};


// 确保事件系统可用的函数
function ensureEventSystem() {
    try {
        // 检查是否有ST的事件系统
        if (typeof eventSource !== 'undefined' && eventSource.on) {
            window.eventOn = eventSource.on.bind(eventSource);
            window.eventOff = eventSource.off ? eventSource.off.bind(eventSource) : null;
            window.eventEmit = eventSource.emit ? eventSource.emit.bind(eventSource) : null;
            console.log('🔧 [鬼面] ST事件系统已绑定');
            return true;
        }
        
        // 检查tavern_events
        if (typeof window.tavern_events === 'undefined') {
            // 创建基础的事件枚举
            window.tavern_events = {
                MESSAGE_SENT: 'message_sent',
                MESSAGE_RECEIVED: 'message_received', 
                GENERATION_ENDED: 'generation_ended',
                STREAM_TOKEN_RECEIVED: 'stream_token_received',
                MESSAGE_SWIPED: 'message_swiped',
                MESSAGE_DELETED: 'message_deleted',
                CHAT_CHANGED: 'chat_changed'
            };
            console.log('🔧 [鬼面] 创建了基础事件枚举');
        }
        
        return true;
    } catch (error) {
        console.error('❌ [鬼面] 事件系统设置失败:', error);
        return false;
    }
}

// 主初始化函数
async function initializeGhostFace() {
    if (window.ghostFaceInitialized) {
        console.log('🔄 [鬼面] 已初始化，跳过重复初始化');
        return;
    }
    
    console.log('🚀 [鬼面] 开始初始化...');
    
    try {
        // 第1步：设置全局导出
        const exportSuccess = setupGlobalExports();
        if (!exportSuccess) {
            throw new Error('全局导出设置失败');
        }
        
        // 第2步：确保事件系统
        const eventSuccess = ensureEventSystem();
        if (!eventSuccess) {
            throw new Error('事件系统设置失败');
        }
        
        // 第3步：加载API设置
        if (typeof api.loadCustomApiSettings === 'function') {
            api.loadCustomApiSettings();
            console.log('🤖 [鬼面] API设置已加载');
        }
        
        // 第4步：初始化核心系统
        if (typeof core.initializeGhostFace === 'function') {
            await core.initializeGhostFace();
            console.log('🧠 [鬼面] 核心系统初始化完成');
        } else {
            throw new Error('核心初始化函数不可用');
        }
        
        // 标记为已初始化
        window.ghostFaceInitialized = true;
        
        console.log('✅ [鬼面] 初始化成功完成！');
        
        // 显示成功通知（如果toastr可用）
        if (typeof toastr !== 'undefined') {
            toastr.success('🎭 鬼面已就位！');
        }
        
    } catch (error) {
        console.error('❌ [鬼面] 初始化失败:', error);
        window.ghostFaceInitialized = false;
        
        // 显示错误通知（如果toastr可用）
        if (typeof toastr !== 'undefined') {
            toastr.error('鬼面初始化失败: ' + error.message);
        }
    }
}

await createGhostFaceDrawer();

async function ensureProperStartup() {
    console.log('🎯 [鬼面] 确保正确启动...');
    
    // 等待ST完全加载
    let retryCount = 0;
    const maxRetries = 10;
    
    while (retryCount < maxRetries) {
        try {
            // 检查ST核心是否可用
            if (typeof getContext === 'function') {
                console.log('✅ [鬼面] ST核心已就绪，开始初始化');
                await initializeGhostFace();
                return;
            }
        } catch (error) {
            console.log(`🔄 [鬼面] ST未就绪，重试 ${retryCount + 1}/${maxRetries}`);
        }
        
        retryCount++;
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.error('❌ [鬼面] ST加载超时，强制尝试初始化');
    await initializeGhostFace();
}

// 启动逻辑
if (typeof window !== 'undefined') {
    if (!window.ghostFaceModuleLoaded) {
        window.ghostFaceModuleLoaded = true;
        
        console.log('🌟 [鬼面] 模块加载开始...');
        
        if (document.readyState === 'loading') {
            // DOM还在加载，等待完成
            document.addEventListener('DOMContentLoaded', () => {
                console.log('📄 [鬼面] DOM加载完成');
                setTimeout(ensureProperStartup, 1000);
            });
        } else {
            // DOM已加载完成
            console.log('📄 [鬼面] DOM已就绪');
            setTimeout(ensureProperStartup, 1000);
        }
    } else {
        console.log('🔄 [鬼面] 模块已加载，跳过重复加载');
    }
}

// 导出必要的内容给ST
export { MODULE_NAME };


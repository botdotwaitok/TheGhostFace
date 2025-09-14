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

/*!
 * GhostFace 一键自检模块 v1.0
 * 单文件：自动注入按钮 + 样式 + 报告弹窗；支持一键修复 & 重检
 * 使用：在你的插件脚本之后引入本文件即可，无需改 HTML
 */
(function () {
  'use strict';

  // ========================= 配置区 =========================
  // 支持的抽屉容器（按优先级匹配，环境不同 ID 可能不同）
  const GF_DRAWER_SELECTORS = [
    '#ghostface_drawer_content',
    '#amily2_drawer_content',
    '#st_topbar_drawer_content'
  ];

  // 顶栏开关按钮的候选选择器
  const GF_TOGGLE_SELECTORS = [
    '[data-ghostface-drawer-toggle]',
    '#ghostface_drawer_toggle',
    '[data-topbar-toggle]'
  ];

  // Debug 按钮默认文案
  const DEBUG_BUTTON_TEXT = '🛠 自检';

  // ======================= 样式注入（仅自检用） =======================
  const STYLE_ID = 'gf-debug-style';
  const CSS_TEXT = `
  /* ===== GhostFace Debug Overlay ===== */
  #gf-debug-overlay {
    position: fixed; inset: 0; z-index: 2147483647;
    background: rgba(0,0,0,.35);
    display: grid; place-items: center;
  }
  #gf-debug-overlay .gfdbg-card {
    width: min(92vw, 860px);
    max-height: 82vh;
    background: #fff; border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.25);
    display: flex; flex-direction: column; overflow: hidden;
    font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
  }
  #gf-debug-overlay .gfdbg-head {
    padding: 12px 16px; font-weight: 700; border-bottom: 1px solid #eee; background: #f8f8f8;
  }
  #gf-debug-overlay .gfdbg-pre {
    margin: 0; padding: 12px 16px; overflow: auto; white-space: pre-wrap; word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    flex: 1; background:#fff;
  }
  #gf-debug-overlay .gfdbg-actions {
    display: flex; gap: 8px; justify-content: flex-end; padding: 10px 14px; border-top:1px solid #eee; background:#fafafa;
  }
  #gf-debug-overlay .gfdbg-actions button {
    padding: 6px 12px; border-radius: 8px; border:1px solid #aaa; background:#ffffff; cursor:pointer;
  }
  #gf-debug-overlay .gfdbg-actions button:hover { filter: brightness(0.97); }

  /* 悬浮自检按钮（默认会插入到面板标题或抽屉内，没有则挂 body 右下角） */
  #gf-debug-btn {
    position: absolute;
    right: 8px; top: 8px;
    z-index: 2147483646;
    padding: 6px 10px; border-radius: 10px; border:1px solid #888; cursor:pointer;
    background: rgba(0,0,0,.06); backdrop-filter:saturate(1.2) blur(2px); font-size: 12px;
  }
  /* 如果挂在 body，就固定在右下角 */
  body>#gf-debug-btn.gf-fixed {
    position: fixed !important;
    right: 12px !important; bottom: 12px !important; top: auto !important;
  }
  `;

  function injectStyleOnce() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS_TEXT;
    document.head.appendChild(style);
  }

  // ======================== 工具函数 ========================
  function getDrawerEl() {
    for (const sel of GF_DRAWER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return { el, sel };
    }
    return { el: null, sel: null };
  }

  function getToggleBtn() {
    for (const sel of GF_TOGGLE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return { el, sel };
    }
    return { el: null, sel: null };
  }

  function mountIntoDrawer() {
    const panel = document.getElementById('the_ghost_face_control_panel');
    const { el: drawer } = getDrawerEl();
    if (!panel || !drawer) return false;
    if (!drawer.contains(panel)) drawer.appendChild(panel);
    panel.classList.add('gf-mounted');
    panel.style.pointerEvents = 'auto';
    return true;
  }

  function ensureButtonContainer() {
    // 优先放在面板头部或抽屉内；都没有就放 body
    return (
      document.querySelector('#the_ghost_face_control_panel .gf-header') ||
      document.querySelector('#ghostface_drawer_content') ||
      document.querySelector('#amily2_drawer_content') ||
      document.querySelector('#st_topbar_drawer_content') ||
      document.body
    );
  }

  function elementCenter(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.floor((r.left + r.right) / 2), y: Math.floor((r.top + r.bottom) / 2) };
  }

  // ======================== 自检主流程 ========================
  async function runSelfCheck({ autoFix = false } = {}) {
    const panel = document.getElementById('the_ghost_face_control_panel');
    const content = document.getElementById('the_ghost_face_control_panel_content');
    const { el: drawer, sel: drawerSel } = getDrawerEl();
    const { el: toggleBtn, sel: toggleSel } = getToggleBtn();

    const panelCS = panel ? getComputedStyle(panel) : null;
    const drawerCS = drawer ? getComputedStyle(drawer) : null;

    // 开关按钮是否被遮挡
    let overlayInfo = null;
    if (toggleBtn) {
      const c = elementCenter(toggleBtn);
      const topEl = document.elementFromPoint(c.x, c.y);
      if (topEl && topEl !== toggleBtn && !toggleBtn.contains(topEl)) {
        overlayInfo = { coveringTag: topEl.tagName, coveringClasses: (topEl.className || '').toString() };
      }
    }

    const actions = [];

    // 规则 1：挂载状态 + 基本可见性
    if (panel) {
      const isMounted = panel.classList.contains('gf-mounted') || (drawer && drawer.contains(panel));
      const actuallyHidden = panelCS && (panelCS.display === 'none' || panelCS.visibility === 'hidden' || +panelCS.opacity === 0);

      if (autoFix && !isMounted && drawer) {
        mountIntoDrawer();
        actions.push('已将面板挂入抽屉并加 .gf-mounted');
      }
      if (autoFix && (panelCS?.position === 'fixed' || panelCS?.position === 'absolute')) {
        // 挂到抽屉时改为流式布局，便于抽屉测量高度
        panel.style.position = 'static';
        actions.push('已将面板 position 调整为 static');
      }
      if (autoFix && actuallyHidden) {
        panel.style.display = 'block';
        panel.style.visibility = 'visible';
        panel.style.opacity = '1';
        actions.push('已强制显示面板（block/visible/opacity=1）');
      }
      if (autoFix && panelCS?.pointerEvents === 'none') {
        panel.style.pointerEvents = 'auto';
        actions.push('已将面板 pointer-events 设为 auto');
      }
    }

    // 规则 2：展开抽屉（优先走按钮）
    if (drawer) {
      const collapsed = drawerCS?.display === 'none' ||
        (drawer.style.maxHeight && parseFloat(drawer.style.maxHeight) < 10);

      if (autoFix && collapsed) {
        if (toggleBtn) {
          toggleBtn.click();
          actions.push(`已通过按钮(${toggleSel})尝试展开抽屉`);
        } else {
          drawer.style.display = 'block';
          drawer.style.maxHeight = drawer.scrollHeight + 'px';
          actions.push('未找到按钮：直接将抽屉 display=block & max-height=内容高度');
        }
      }
    }

    // 规则 3：细长一条（展开高度异常）
    let thinLine = false;
    if (panel) {
      const h = panel.getBoundingClientRect().height;
      const sh = panel.scrollHeight;
      if (h > 0 && h < 40 && sh > 200) thinLine = true;
      if (autoFix && thinLine) {
        panel.style.height = 'auto';
        panel.style.overflow = 'visible';
        actions.push('检测到“细长一条”：已将面板 height=auto、overflow=visible');
      }
    }

    // 规则 4：缓存提示
    const cacheHint = '建议清缓存或使用无痕模式以确保最新 CSS/JS：?v=' +
      new Date().toISOString().slice(0, 10).replace(/-/g, '');

    const report = {
      time: new Date().toISOString(),
      ua: navigator.userAgent,
      dpr: window.devicePixelRatio,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      drawerCandidates: GF_DRAWER_SELECTORS.map(s => [s, !!document.querySelector(s)]),
      drawerInUse: drawerSel || '(未找到)',
      panel: {
        exists: !!panel,
        mounted: !!(panel && (panel.classList.contains('gf-mounted') || (drawer && drawer.contains(panel)))),
        display: panelCS?.display,
        position: panelCS?.position,
        pointerEvents: panelCS?.pointerEvents,
        height: panel ? Math.round(panel.getBoundingClientRect().height) : null,
        scrollHeight: panel?.scrollHeight ?? null,
        thinLineDetected: thinLine
      },
      drawer: {
        exists: !!drawer,
        display: drawerCS?.display,
        maxHeight: drawer?.style?.maxHeight || '',
        scrollHeight: drawer?.scrollHeight || null
      },
      toggleButton: {
        exists: !!toggleBtn,
        selectorUsed: toggleBtn ? toggleSel : '(none)'
      },
      overlayOnToggle: overlayInfo,
      actions,
      cacheHint
    };

    try { console.table ? console.table(report.panel) : console.log(report); } catch (e) {}

    return report;
  }

  // ======================== 报告弹窗 ========================
  function showReport(report) {
    injectStyleOnce();

    // 容器
    let wrap = document.getElementById('gf-debug-overlay');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'gf-debug-overlay';
      wrap.innerHTML = `
        <div class="gfdbg-card" role="dialog" aria-modal="true" aria-label="GhostFace 自检报告">
          <div class="gfdbg-head">GhostFace 自检报告</div>
          <pre class="gfdbg-pre" id="gfdbg-pre"></pre>
          <div class="gfdbg-actions">
            <button id="gfdbg-copy">复制报告</button>
            <button id="gfdbg-download">下载JSON</button>
            <button id="gfdbg-fix">一键修复并重检</button>
            <button id="gfdbg-close">关闭</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);

      wrap.querySelector('#gfdbg-close').onclick = () => wrap.remove();
      wrap.querySelector('#gfdbg-copy').onclick = async () => {
        const txt = wrap.querySelector('#gfdbg-pre').textContent;
        try { await navigator.clipboard.writeText(txt); alert('已复制到剪贴板'); } catch (e) { }
      };
      wrap.querySelector('#gfdbg-download').onclick = () => {
        const blob = new Blob([wrap.querySelector('#gfdbg-pre').textContent], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ghostface-selfcheck-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      };
      wrap.querySelector('#gfdbg-fix').onclick = async () => {
        const fixed = await runSelfCheck({ autoFix: true });
        showReport(fixed); // 刷新报告
      };
    }
    wrap.querySelector('#gfdbg-pre').textContent = JSON.stringify(report, null, 2);
  }

  // ======================== 安装悬浮按钮 ========================
  function installDebugButton() {
    injectStyleOnce();
    if (document.getElementById('gf-debug-btn')) return;

    const container = ensureButtonContainer();
    const btn = document.createElement('button');
    btn.id = 'gf-debug-btn';
    btn.textContent = DEBUG_BUTTON_TEXT;

    if (container === document.body) btn.classList.add('gf-fixed');
    btn.addEventListener('click', async () => {
      const report = await runSelfCheck({ autoFix: false });
      showReport(report);
    });

    container.appendChild(btn);
  }

  // ======================== 启动时序处理 ========================
  // 某些环境加载慢，这里做重试直到元素出现或超时
  function waitForReadyAndInstall(maxTries = 30, interval = 300) {
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      const panel = document.getElementById('the_ghost_face_control_panel');
      const drawer = getDrawerEl().el;
      if (panel || drawer || tries >= maxTries) {
        clearInterval(timer);
        installDebugButton();
      }
    }, interval);
  }

  // 对外暴露一个简易 API（可选）
  window.GhostFaceDebug = {
    run: async (autoFix = false) => {
      const report = await runSelfCheck({ autoFix });
      showReport(report);
      return report;
    },
    mountIntoDrawer,
    installButton: installDebugButton
  };

  // 自动安装（DOMContentLoaded 后 + 重试）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => waitForReadyAndInstall());
  } else {
    waitForReadyAndInstall();
  }
})();

// 导出必要的内容给ST
export { MODULE_NAME };



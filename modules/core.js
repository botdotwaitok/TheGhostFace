// core.js
import { getContext, extension_settings, } from '../../../../extensions.js';
import { chat_metadata, getMaxContextSize, generateRaw, streamingProcessor, main_api, system_message_types, saveSettingsDebounced, getRequestHeaders, saveChatDebounced, chat, this_chid, characters, reloadCurrentChat, } from '../../../../../script.js';
import { createWorldInfoEntry, deleteWIOriginalDataValue, deleteWorldInfoEntry, importWorldInfo, loadWorldInfo, saveWorldInfo, world_info } from '../../../../world-info.js';
import { eventSource, event_types } from '../../../../../script.js';
import { download, debounce, initScrollHeight, resetScrollHeight, parseJsonFile, extractDataFromPng, getFileBuffer, getCharaFilename, getSortableDelay, escapeRegex, PAGINATION_TEMPLATE, navigation_option, waitUntilCondition, isTrueBoolean, setValueByPath, flashHighlight, select2ModifyOptions, getSelect2OptionId, dynamicSelect2DataViaAjax, highlightRegex, select2ChoiceClickSubscribe, isFalseBoolean, getSanitizedFilename, checkOverwriteExistingData, getStringHash, parseStringArray, cancelDebounce, findChar, onlyUnique, equalsIgnoreCaseAndAccents } from '../../../../utils.js';

import * as ui from '../ui/ui.js';
import * as utils from './utils.js';
import * as summarizer from './summarizer.js';
import { getMaxSummarizedFloorFromWorldBook, GHOST_TRACKING_COMMENT } from './worldbook.js';
import * as timeline from './timeline.js';



let systemInitialized = false;

// ═══════════════════════════════════════════════════════════════════════
// Progress Bar Helpers
// ═══════════════════════════════════════════════════════════════════════

let _hideProgressTimer = null; // Track pending hide so showProgress can cancel it

export function showProgress(text = '准备中...') {
    if (_hideProgressTimer) {
        clearTimeout(_hideProgressTimer);
        _hideProgressTimer = null;
    }
    const section = document.getElementById('the_ghost_face_progress');
    const fill = document.getElementById('the_ghost_face_progress_fill');
    const label = document.getElementById('the_ghost_face_progress_text');
    if (section) section.style.display = 'block';
    if (fill) fill.style.width = '0%';
    if (label) label.textContent = text;
}

export function updateProgress(percent, text) {
    const fill = document.getElementById('the_ghost_face_progress_fill');
    const label = document.getElementById('the_ghost_face_progress_text');
    if (fill) fill.style.width = `${Math.min(100, percent)}%`;
    if (label && text) label.textContent = text;
}

export function hideProgress(delay = 1500) {
    if (_hideProgressTimer) {
        clearTimeout(_hideProgressTimer);
    }
    _hideProgressTimer = setTimeout(() => {
        const section = document.getElementById('the_ghost_face_progress');
        if (section) section.style.display = 'none';
        _hideProgressTimer = null;
    }, delay);
}

// 消息监听器部分开始👇

// 消息监听器设置
export function setupMessageListener() {
    if (window.ghostFaceListenersAttached) {
        logger.warn('🔧 消息监听器已绑定，跳过重复绑定');
        return;
    }

    if (typeof eventSource !== 'undefined' && eventSource.on && typeof event_types !== 'undefined') {
        eventSource.on(event_types.CHAT_CHANGED, handleChatChange);
        let debounceTimer = null;
        const handleNewMessageDebounced = (eventName) => {
            clearMessageCountCache();
            if (eventName === 'MESSAGE_RECEIVED' || eventName === 'MESSAGE_SENT') {
                messagesSinceLastSummary++;
            }
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                if (isAutoSummarizing) {
                    return;
                }

                const now = Date.now();
                if (window.lastAutoTriggerCheck && (now - window.lastAutoTriggerCheck) < 5000) {
                    return;
                }
                window.lastAutoTriggerCheck = now;

                try {
                    await checkAutoTrigger();
                } catch (error) {
                    logger.error('自动触发检查失败:', error);
                }
            }, 4000);
        };

        const messageEventKeys = [
            'MESSAGE_SENT',
            'MESSAGE_RECEIVED',
            'GENERATION_ENDED',
            'STREAM_TOKEN_RECEIVED',
            'MESSAGE_SWIPED',
            'MESSAGE_DELETED'
        ];

        let attachedEvents = 0;
        messageEventKeys.forEach(key => {
            if (event_types[key]) {
                eventSource.on(event_types[key], () => handleNewMessageDebounced(key));
                attachedEvents++;
            } else {
                logger.warn(`⚠️ 事件不存在: ${key}`);
            }
        });

        // logger.info(`🔧 成功绑定 ${attachedEvents} 个消息事件监听器`);

        // 4. 备用轮询（频率较低）
        if (window._ghostFacePollingInterval) clearInterval(window._ghostFacePollingInterval);
        window._ghostFacePollingInterval = setInterval(() => {
            // logger.debug('⏰ 备用轮询检查...');
            if (!isAutoSummarizing) {
                checkAutoTrigger().catch(error => {
                    logger.error('⏰ 备用轮询检查失败:', error);
                });
            }
        }, 60000);

    } else {
        // 降级方案：使用DOM事件监听

        const observer = new MutationObserver((mutations) => {
            for (let mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (let node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE &&
                            (node.classList?.contains('mes') ||
                                node.querySelector?.('.mes'))) {
                            setTimeout(checkAutoTrigger, 2000);
                            break;
                        }
                    }
                }
            }
        });

        const chatContainer = document.querySelector('#chat') ||
            document.querySelector('.chat') ||
            document.body;

        if (chatContainer) {
            observer.observe(chatContainer, {
                childList: true,
                subtree: true
            });
        }

        if (window._ghostFaceFallbackInterval) clearInterval(window._ghostFaceFallbackInterval);
        window._ghostFaceFallbackInterval = setInterval(checkAutoTrigger, 15000);
    }

    // 🆕 Hook chat_completion_prompt_ready for accurate token counting (like pig.js)
    // This is registered OUTSIDE the if/else because eventSource is always available via import.
    eventSource.on('chat_completion_prompt_ready', (data) => {
        try {
            const count = countTokensFromPromptData(data);
            lastKnownTokenCount = count;
            //logger.info(`🎯 Token count updated from prompt event: ${count}`);
            // Update the UI display
            if (typeof ui.updateMessageCount === 'function') {
                ui.updateMessageCount();
            }
            // 🆕 Re-check auto trigger with the fresh token count
            if (autoTriggerEnabled && !isAutoSummarizing) {
                setTimeout(() => checkAutoTrigger().catch(() => { }), 1500);
            }
        } catch (e) {
            logger.error('🎯 Token count from prompt event failed:', e);
        }
    });

    // 🆕 标记监听器已绑定
    window.ghostFaceListenersAttached = true;

}

// =====================================================================
// Auto-trigger helper: executes summarization pipeline (small > big > hide)
// Extracted to avoid duplicating this block in checkAutoTrigger.
// =====================================================================
async function executeAutoSummarization(triggerReason) {
    isAutoSummarizing = true;
    try {
        toastr.info(`👻 ${triggerReason}`, null, {
            timeOut: 3000,
            closeButton: true,
            progressBar: true,
        });
    } catch (_) { }

    try {
        // 记忆碎片
        const smallResult = await stealthSummarize(false, true);
        logger.info(' 自动记忆碎片完成');

        // 仅当记忆碎片写入了内容时，再进行时间线 + 大总结 + 隐藏
        if (smallResult && (smallResult.created > 0 || smallResult.updated > 0)) {
            const total = await getCachedMessageCount();
            let start = (await getMaxSummarizedFloorFromWorldBook()) + 1;
            if (!Number.isFinite(start) || start < 0) start = 0;
            let end = Math.max(-1, total - 1 - KEEP_MESSAGES);

            if (end >= start) {
                // 📅 时间线追加
                try {
                    const msgs = await summarizer.getGhostContextMessages(false, start, end);
                    if (msgs && msgs.length > 0) {
                        await timeline.appendToTimeline(msgs);
                        logger.info('📅 自动时间线更新完成');
                    }
                } catch (e) {
                    logger.warn('📅 自动时间线更新失败，继续大总结', e);
                }

                let bigOk = false;
                // Bridge progress bar: stealthSummarize hid it, re-show for big summary
                showProgress('📜 准备大总结...');
                try {
                    await summarizer.handleLargeSummary({ startIndex: start, endIndex: end });
                    bigOk = true;
                    logger.info(`📚 自动大总结完成：${start + 1}-${end + 1} 楼`);
                } catch (e) {
                    logger.warn('📚 自动大总结失败：跳过隐藏', e);
                }

                if (bigOk) {
                    const shouldHide = extension_settings.the_ghost_face?.autoHideAfterSum !== false;
                    if (shouldHide) {
                        try {
                            await hideMessagesRange(start, end);
                        } catch (e) {
                            logger.error('自动隐藏失败:', e);
                        }
                    } else {
                        logger.info('用户设置不自动隐藏，跳过隐藏步骤');
                    }
                }
            } else {
                logger.debug('📚 自动大总结与隐藏跳过：计算到的范围为空');
            }
        } else {
            logger.debug('📚 记忆碎片未写入新内容，跳过本轮大总结与隐藏');
        }
    } catch (error) {
        logger.error(' 自动总结失败:', error);
    } finally {
        isAutoSummarizing = false;
        // Reset both counters after summarization
        accumulatedNewTokens = 0;
        messagesSinceLastSummary = 0;
    }
}

// =====================================================================
// 自动触发检测函数 - OR-based dual condition (inspired by official ST Summarize)
//   Condition 1: accumulated tokens >= userTokenThreshold  (0 = disabled)
//   Condition 2: messages since last summary >= userInterval (0 = disabled)
//   Either condition met -> trigger summarization.
// =====================================================================
export async function checkAutoTrigger() {
    if (!autoTriggerEnabled || isAutoSummarizing) {
        return;
    }

    if (window.isCheckingAutoTrigger) {
        return;
    }
    window.isCheckingAutoTrigger = true;

    try {
        const context = await getContext();
        const currentCount = await getTokenCount(context);

        // 首次初始化
        if (lastTokenCount === 0) {
            lastTokenCount = currentCount;
            accumulatedNewTokens = currentCount;
        } else {
            // 累计自上次检查以来的新Token数
            const newTokenCount = Math.max(0, currentCount - lastTokenCount);
            accumulatedNewTokens += newTokenCount;
        }

        // console.log(`[鬼面] 自动检查: tokens=${accumulatedNewTokens}/${userTokenThreshold}, msgs=${messagesSinceLastSummary}/${userInterval}`);

        // --- OR-based condition check ---
        let conditionSatisfied = false;
        let triggerReason = '';

        // Condition 1: Token threshold (0 = disabled)
        if (userTokenThreshold > 0 && accumulatedNewTokens >= userTokenThreshold) {
            conditionSatisfied = true;
            triggerReason = `鬼面检测到 ${accumulatedNewTokens} Token（阈值 ${userTokenThreshold}）`;
        }

        // Condition 2: Message count (0 = disabled)
        if (userInterval > 0 && messagesSinceLastSummary >= userInterval) {
            conditionSatisfied = true;
            triggerReason = triggerReason
                ? triggerReason + ` + ${messagesSinceLastSummary} 条消息`
                : `鬼面检测到 ${messagesSinceLastSummary} 条新消息（阈值 ${userInterval}）`;
        }

        if (conditionSatisfied) {
            logger.info(`🎯 自动触发条件满足: ${triggerReason}`);
            await executeAutoSummarization(triggerReason);
        }

        // 更新上次检查计数
        lastTokenCount = currentCount;

    } catch (error) {
        logger.error(' 自动触发检测失败:', error);
    } finally {
        window.isCheckingAutoTrigger = false;
    }
}

// 消息监听器部分结束👆

// 自动触发相关变量
export let lastTokenCount = 0;
export let autoTriggerEnabled = false;
export const AUTO_TRIGGER_THRESHOLD = 500;
export let isAutoSummarizing = false;

export let userTokenThreshold = 100000; // Default 100000 tokens
export let userInterval = 10;           // Default 10 messages (0 = disabled)
const KEEP_MESSAGES = 4;

// 新Token累计计数（自上次总结以来）
export let accumulatedNewTokens = 0;

// Messages since last auto-summary (for OR-based trigger)
export let messagesSinceLastSummary = 0;

// Last known token count from chat_completion_prompt_ready event
export let lastKnownTokenCount = 0;

// State setters to sync from UI
export function setAutoTriggerEnabled(v) {
    autoTriggerEnabled = !!v;
    if (autoTriggerEnabled) {
        // Reset all counters when enabling
        lastTokenCount = 0;
        accumulatedNewTokens = 0;
        messagesSinceLastSummary = 0;

        // 立即触发一次检查
        Promise.resolve().then(() => checkAutoTrigger()).catch(() => { });
    } else {
        // 关闭时重置累计
        accumulatedNewTokens = 0;
        messagesSinceLastSummary = 0;
    }
}



export function setUserTokenThreshold(n) {
    const val = Number(n);
    userTokenThreshold = Number.isFinite(val) ? val : 100000;
}

export function setUserInterval(n) {
    const val = Number(n);
    userInterval = Number.isFinite(val) ? val : 10;
}



// 主要总结函数
export async function stealthSummarize(isInitial = false, isAutoTriggered = false, startIndex = null, endIndex = null) {
    const triggerType = isAutoTriggered ? '自动触发' :
        (startIndex !== null ? '手动范围' : '手动触发');

    showProgress(`👻 开始${triggerType}总结...`);

    const notificationText = isAutoTriggered ?
        " 鬼面尾随中..." :
        (startIndex !== null ? `👻 鬼面总结第${startIndex + 1}-${endIndex + 1}楼...` : "👻 鬼面尾随中...");

    const notification = toastr.info(notificationText, null, {
        timeOut: 5000,
        closeButton: true,
        progressBar: true,
        hideDuration: 0,
        positionClass: "toast-top-center"
    });

    try {
        const activeBook = await utils.findActiveWorldBook();
        updateProgress(15, '第1步: 收集消息...');

        const messages = await getGhostContextMessages(isInitial, startIndex, endIndex);

        if (!messages || messages.length === 0) {
            updateProgress(100, '⚠️ 没有找到可总结的消息');
            hideProgress();
            const warningText = triggerType === '自动触发' ?
                "自动总结：没有找到可总结的消息" :
                "没有找到可总结的消息，鬼面愤怒拔线了...";
            toastr.warning(warningText);
            return null;
        }

        updateProgress(30, `第2步: 记录中 (${messages.length}条消息)...`);

        const summaryContent = await generateSummary(messages);

        if (!summaryContent || !Array.isArray(summaryContent) || summaryContent.length === 0) {
            updateProgress(100, '没有新信息需要记录');
            hideProgress();
            const infoText = triggerType === '自动触发' ?
                "没有新信息，跳过总结" :
                "没有新信息，鬼面很满意现有记录";
            toastr.info(infoText);
            return null;
        }

        updateProgress(60, '第3步: 保存到世界书...');
        const updateResult = await saveToWorldBook(summaryContent, startIndex, endIndex, isContentSimilar, isAutoTriggered);

        // 第4步：根据用户设置决定是否隐藏
        if (startIndex !== null && endIndex !== null) {
            if (isAutoTriggered) {
                const autoHideCheckbox = document.getElementById('the_ghost_face_auto_hide_after_sum');
                // 修复：如果面板关闭找不到checkbox，读取实际的扩展设置而不是直接返回 true
                const shouldAutoHide = autoHideCheckbox ? autoHideCheckbox.checked : (extension_settings?.the_ghost_face?.autoHideAfterSum !== false);

                if (shouldAutoHide) {
                    updateProgress(80, `第4步: 隐藏第${startIndex + 1}-${endIndex + 1}楼...`);

                    await new Promise(resolve => setTimeout(resolve, 500));

                    const hideSuccess = await hideMessagesRange(startIndex, endIndex);

                    if (hideSuccess) {
                        // hidden ok
                    } else {
                        logger.warn(`[鬼面] 隐藏操作失败`);
                    }
                } else {
                    updateProgress(80, '第4步: 用户选择不自动隐藏');
                }
            } else {
                // 手动总结不自动隐藏消息
                updateProgress(80, '第4步: 手动提取碎片片段，跳过自动隐藏');
            }
        } else {
            // 不再对消息打 ghost_summarized 标记，避免影响后续取数
            updateProgress(80, '第4步: 已完成写入');
        }

        const successText = triggerType === '自动触发' ?
            `鬼面总结完成！${updateResult.created}个新条目，${updateResult.updated}个更新` :
            (startIndex !== null ?
                `👻 鬼面总结完成！第${startIndex + 1}-${endIndex + 1}楼已隐藏` :
                "👻 鬼面把新信息都记录好了！");
        updateProgress(100, `✅ 总结完成！`);
        hideProgress();
        toastr.success(successText);

        return updateResult;

    } catch (err) {
        updateProgress(100, `❌ 总结失败`);
        hideProgress();
        logger.error('[鬼面] 总结流程失败:', err);
        const errorText = triggerType === '自动触发' ?
            "总结失败: " + err.message :
            "尾随被看破: " + err.message;
        toastr.error(errorText);

    } finally {
        toastr.remove(notification);
    }
}

// 工具函数：统一获取消息数组
export function getMessageArray(source) {
    // console.log('🔍 [getMessageArray] 输入源:', source);
    // console.log('🔍 [getMessageArray] 源类型:', typeof source);

    // 方法1：检查标准的聊天数组属性
    if (source?.chat && Array.isArray(source.chat)) {
        // console.log('🔍 [getMessageArray] 使用 source.chat，长度:', source.chat.length);
        return source.chat;
    }

    if (source?.messages && Array.isArray(source.messages)) {
        // console.log('🔍 [getMessageArray] 使用 source.messages，长度:', source.messages.length);
        return source.messages;
    }

    // 方法2：如果source本身就是数组
    if (Array.isArray(source)) {
        // console.log('🔍 [getMessageArray] 源本身是数组，长度:', source.length);
        return source;
    }

    // 方法3：检查其他可能的属性
    if (source?.chatHistory && Array.isArray(source.chatHistory)) {
        // console.log('🔍 [getMessageArray] 使用 source.chatHistory，长度:', source.chatHistory.length);
        return source.chatHistory;
    }

    if (source?.history && Array.isArray(source.history)) {
        // console.log('🔍 [getMessageArray] 使用 source.history，长度:', source.history.length);
        return source.history;
    }

    // 方法4：安全地尝试从全局变量获取
    try {
        if (typeof window !== 'undefined' && window.chat && Array.isArray(window.chat)) {
            // console.log('🔍 [getMessageArray] 使用 window.chat，长度:', window.chat.length);
            return window.chat;
        }

        // 也尝试直接的 chat 变量（如果在作用域内）
        if (typeof chat !== 'undefined' && Array.isArray(chat)) {
            // console.log('🔍 [getMessageArray] 使用全局 chat 变量，长度:', chat.length);
            return chat;
        }
    } catch (e) {
        console.warn('🔍 [getMessageArray] 访问全局chat变量失败:', e.message);
    }

    // 方法5：从DOM获取
    try {
        const messageElements = document.querySelectorAll('.mes');
        if (messageElements.length > 0) {
            // console.log('🔍 [getMessageArray] 从DOM获取消息元素，长度:', messageElements.length);
            // 转换为简单的消息对象数组
            return Array.from(messageElements).map((el, index) => ({
                mes: el.querySelector('.mes_text')?.textContent || '',
                name: el.querySelector('.name_text')?.textContent || 'Unknown',
                is_system: el.classList.contains('is_system'),
                index: index
            }));
        }
    } catch (e) {
        console.warn('🔍 [getMessageArray] DOM查询失败:', e.message);
    }

    // 如果有封装对象，记录详细信息
    if (source && typeof source === 'object' && typeof source.generateQuietPrompt === 'function') {
        console.warn('🔍 [getMessageArray] getContext 返回封装对象，属性:', Object.keys(source));
        console.warn('🔍 [getMessageArray] 可能的消息相关属性:',
            Object.keys(source).filter(key =>
                key.toLowerCase().includes('chat') ||
                key.toLowerCase().includes('message') ||
                key.toLowerCase().includes('history')
            )
        );
    }

    console.warn('🔍 [getMessageArray] 无法从任何源获取消息数组');
    return [];
}

// 消息计数获取函数
export async function getCurrentMessageCount() {
    try {
        // console.log('📊 [getCurrentMessageCount] 开始获取消息计数...');

        const context = await getContext();
        const messages = getMessageArray(context);

        const count = messages ? messages.length : 0;
        // console.log('📊 [getCurrentMessageCount] 最终计数:', count);

        return count;

    } catch (error) {
        console.error('📊 [getCurrentMessageCount] 获取失败:', error);

        // 错误时的备用方案
        try {
            const fallbackMessages = getMessageArray(null);
            const fallbackCount = fallbackMessages ? fallbackMessages.length : 0;
            console.warn('📊 [getCurrentMessageCount] 使用备用方案，计数:', fallbackCount);
            return fallbackCount;
        } catch (fallbackError) {
            console.error('📊 [getCurrentMessageCount] 备用方案也失败:', fallbackError);
            return 0;
        }
    }
}

// 🆕 添加一个同步版本的快速计数（不需要await）
export function getMessageCountSync() {
    try {
        // 尝试从全局变量
        if (typeof window !== 'undefined' && window.chat && Array.isArray(window.chat)) {
            return window.chat.length;
        }

        if (typeof chat !== 'undefined' && Array.isArray(chat)) {
            return chat.length;
        }

        // 尝试从DOM
        const messageElements = document.querySelectorAll('.mes');
        return messageElements.length;

    } catch (error) {
        console.warn('📊 [getMessageCountSync] 同步获取失败:', error);
        return 0;
    }
}

// 🆕 添加一个带缓存的版本（避免频繁查询）
let messageCountCache = null;
let lastCacheTime = 0;
const CACHE_DURATION = 5000; // 5秒缓存

export async function getCachedMessageCount() {
    const now = Date.now();

    // 如果缓存还有效，直接返回
    if (messageCountCache !== null && (now - lastCacheTime) < CACHE_DURATION) {
        // console.log('📊 [getCachedMessageCount] 使用缓存:', messageCountCache);
        return messageCountCache;
    }

    // Fallback to real count if cache expired
    const count = await getCurrentMessageCount();
    messageCountCache = count;
    lastCacheTime = now;
    return count;
}

// 🆕 Count tokens from prompt data (ported from pig.js's countTokensFromData)
// This is called by the chat_completion_prompt_ready event handler
export function countTokensFromPromptData(rawData) {
    try {
        let fullPrompt = "";

        const stripBase64 = (text) => {
            if (typeof text !== 'string') return text;
            return text.replace(/data:[a-zA-Z0-9\-\.\/]+;base64,[A-Za-z0-9+/=\s]+/gi, "");
        };

        if (rawData && Array.isArray(rawData.chat)) {
            fullPrompt = rawData.chat.map(m => (typeof m === 'string') ? stripBase64(m) : stripBase64(m.content || "")).join("\n");
        } else if (rawData && Array.isArray(rawData.messages)) {
            fullPrompt = rawData.messages.map(m => (typeof m === 'string') ? stripBase64(m) : stripBase64(m.content || "")).join("\n");
        } else if (Array.isArray(rawData)) {
            fullPrompt = rawData.map(m => (typeof m === 'string') ? stripBase64(m) : stripBase64(m.content || "")).join("\n");
        } else if (typeof rawData === 'string') {
            fullPrompt = stripBase64(rawData);
        }

        if (!fullPrompt) return 0;

        // Use ST's precise tokenizer if available
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const context = SillyTavern.getContext();
            if (typeof context.getTokenCount === 'function') {
                return context.getTokenCount(fullPrompt);
            }
        }

        // Fallback: rough estimation
        return Math.floor(fullPrompt.length / 2.7);
    } catch (e) {
        console.error("❌ [countTokensFromPromptData] Error:", e);
        return 0;
    }
}

// 🆕 获取Token计数 — returns the cached count from the last prompt event,
// or falls back to estimating from chat messages (aligned with pig.js approach).
export async function getTokenCount(contextData) {
    // If we have a prompt-based count, prefer it (most accurate)
    if (lastKnownTokenCount > 0) {
        //logger.info(`🎯 [getTokenCount] 使用 prompt 事件缓存值: ${lastKnownTokenCount}`);
        return lastKnownTokenCount;
    }

    // Fallback: estimate from chat messages (matching pig.js's countTokensFromData logic)
    try {
        const messages = getMessageArray(contextData);
        //logger.info(`🎯 [getTokenCount] prompt缓存为0，走估算路径，消息数=${messages?.length || 0}`);
        let fullPrompt = "";

        const stripBase64 = (text) => {
            if (typeof text !== 'string') return text;
            return text.replace(/data:[a-zA-Z0-9\-\.\/]+;base64,[A-Za-z0-9+/=\s]+/gi, "");
        };

        if (messages && messages.length > 0) {
            // Match pig.js: prefer content field, then mes, then string form
            // Filter out hidden messages, as they don't count towards the active context length
            const visibleMessages = messages.filter(m => typeof m === 'string' || (!m.is_hidden && !m.is_system));
            fullPrompt = visibleMessages.map(m => {
                if (typeof m === 'string') return stripBase64(m);
                return stripBase64(m.content || m.mes || "");
            }).join("\n");
        }

        if (!fullPrompt) {
            //logger.warn('🎯 [getTokenCount] 无法获取消息文本，返回 0');
            return 0;
        }

        // Try imported getContext's tokenizer first (most reliable in extensions)
        try {
            const ctx = getContext();
            if (ctx && typeof ctx.getTokenCount === 'function') {
                const preciseCount = ctx.getTokenCount(fullPrompt);
                //logger.info(`🎯 [getTokenCount] 使用 getContext().getTokenCount 精确计数: ${preciseCount}`);
                return preciseCount;
            }
        } catch (_) { }

        // Try ST's precise tokenizer via global (matching pig.js approach)
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const ctx = SillyTavern.getContext();
            if (typeof ctx.getTokenCount === 'function') {
                const preciseCount = ctx.getTokenCount(fullPrompt);
                //logger.info(`🎯 [getTokenCount] 使用 SillyTavern.getContext().getTokenCount: ${preciseCount}`);
                return preciseCount;
            }
        }

        // Last resort: rough estimation (same ratio as pig.js)
        const estimated = Math.floor(fullPrompt.length / 2.7);
        //logger.info(`🎯 [getTokenCount] 使用粗略估算: ${estimated} (文本长度=${fullPrompt.length})`);
        return estimated;
    } catch (e) {
        console.error("❌ [getTokenCount] Error:", e);
        return 0;
    }
}



// 🆕 清除缓存的函数（在消息发生变化时调用）
export function clearMessageCountCache() {
    messageCountCache = null;
    lastCacheTime = 0;
    // console.log('📊 [clearMessageCountCache] 缓存已清除');
}

// 初始化函数
let _initPromise = null;
export async function initializeGhostFace() {
    if (window.ghostFaceInitialized) return true;
    if (_initPromise) return _initPromise;  // 并发调用复用同一个 Promise

    _initPromise = (async () => {
        // console.log('🚀 [鬼面] 开始初始化...');
        try {
            // 等待ST就绪
            // console.log('⏳ 等待ST核心系统就绪...');
            const isReady = await waitForSTReady();

            if (!isReady) {
                _initPromise = null; // 重置，允许下次重试
                console.log('[鬼面] ST未就绪（无角色），等待用户打开聊天...');

                // 监听 CHAT_CHANGED，用户打开聊天后自动初始化
                if (typeof eventSource !== 'undefined' && eventSource.on && !window._ghostFaceChatReadyListenerAdded) {
                    window._ghostFaceChatReadyListenerAdded = true;
                    const onChatReady = async () => {
                        if (window.ghostFaceInitialized) return;
                        console.log('[鬼面] 检测到聊天切换，尝试初始化...');
                        try {
                            await initializeGhostFace();
                        } catch (e) {
                            console.warn('[鬼面] 聊天切换后初始化失败:', e);
                        }
                        // 初始化成功后移除监听
                        if (window.ghostFaceInitialized && eventSource.removeListener) {
                            eventSource.removeListener(event_types.CHAT_CHANGED, onChatReady);
                            window._ghostFaceChatReadyListenerAdded = false;
                        }
                    };
                    eventSource.on(event_types.CHAT_CHANGED, onChatReady);
                }

                // 保留定时重试作为兜底
                setTimeout(() => {
                    if (!window.ghostFaceInitialized) {
                        initializeGhostFace();
                    }
                }, 5000);
                return;
            }
            // 基础初始化

            try {
                await createGhostControlPanel();
            } catch (panelErr) {
                console.error('❌ [鬼面] 控制面板创建失败:', panelErr);
                // 不要因为面板创建失败就中断整个初始化
            }
            setupMessageListener();
            setupWorldBookListener();

            if (typeof utils !== 'undefined' && utils.setSystemInitialized) {
                utils.setSystemInitialized(true);
            }

            // console.log('🌍 开始世界书初始化...');
            setTimeout(async () => {
                try { await smartWorldBookInit(); /* console.log('🌍 世界书初始化完成'); */ }
                catch (err) { console.warn('🌍 世界书初始化失败:', err); }
            }, 2000);

            setTimeout(() => {
                try {
                    setupPanelEvents();
                    loadUserSettings();
                    updatePanelWithCurrentData();
                    updateMessageCount();
                } catch (uiErr) {
                    console.error('❌ [鬼面] 面板事件/设置加载失败:', uiErr);
                }
            }, 300);

            window.ghostFaceInitialized = true;
            logger.success('👻 鬼面已就位！');
            return true;
        } catch (e) {
            window.ghostFaceInitialized = false;
            _initPromise = null; // ⚠️ 重置，允许下次重试
            throw e;
        }
    })();

    return _initPromise;
}

//扩展目录定位
export function get_extension_directory() {
    let index_path = new URL(import.meta.url).pathname;
    // 从modules文件夹返回上级目录
    let extension_path = index_path.substring(0, index_path.lastIndexOf('/'));
    // 如果在modules文件夹，需要返回上级
    if (extension_path.endsWith('/modules')) {
        extension_path = extension_path.substring(0, extension_path.lastIndexOf('/'));
    }
    return extension_path;
}

//保存聊天
export async function saveChat() {
    try {

        // 🎯 方法1：使用官方防抖保存
        if (typeof saveChatDebounced === 'function') {
            saveChatDebounced();

            // 等待防抖完成
            await new Promise(resolve => setTimeout(resolve, 1500));
            return true;
        }

        // 备用方案已移除：saveChatConditional 未被导入，永迎不会执行

        return false;

    } catch (error) {
        logger.error('🪼调用官方保存函数失败:', error);
        return false;
    }
}

// 安全的保存聊天函数
export async function refreshChatDisplay() {
    try {
        //logger.debug('🪼刷新聊天显示...');

        // 方法1：触发界面更新事件
        if (typeof eventSource !== 'undefined' && eventSource.emit) {
            eventSource.emit('chatChanged');
            //logger.debug('🪼触发了chatChanged事件');
        }

        // 方法2：调用ST的UI更新函数
        if (typeof window.SillyTavern?.ui?.updateChatScroll === 'function') {
            window.SillyTavern.ui.updateChatScroll();
            //logger.debug('🪼调用了ST UI更新');
        }

        // 方法3：手动同步DOM状态
        const context = await getContext();
        const messages = getMessageArray(context);

        // 更新所有消息元素的显示状态
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            const messageElement = document.querySelector(`.mes[mesid="${i}"]`);

            if (messageElement && msg) {
                const shouldHide = msg.is_system === true;

                messageElement.setAttribute('is_system', shouldHide.toString());

                if (shouldHide) {
                    messageElement.style.display = 'none';
                    messageElement.setAttribute('data-ghost-hidden', 'true');
                } else {
                    messageElement.style.display = '';
                    messageElement.removeAttribute('data-ghost-hidden');
                }
            }
        }

        //logger.debug('🪼聊天显示已刷新');

    } catch (error) {
        logger.error('🪼刷新聊天显示失败:', error);
    }
}

export async function restoreHiddenStateOnStartup() {
    const currentChid = utils.getCurrentChid();
    if (currentChid === undefined || currentChid === null) {
        return; // 如果没有角色，就直接结束，不往下执行
    }
    try {
        const context = await getContext();
        const messages = getMessageArray(context);

        if (messages.length === 0) {
            return;
        }

        // 获取已总结的最大楼层
        const maxSummarizedFloor = await getMaxSummarizedFloorFromWorldBook();

        let restoredHiddenCount = 0;
        let changesMade = false;

        for (let i = 0; i <= maxSummarizedFloor && i < messages.length; i++) {
            const msg = messages[i];
            if (!msg) continue;

            if (!msg.is_system) {
                // 需要隐藏但当前可见
                if (!msg.extra) msg.extra = {};
                msg.extra.ghost_original_is_system = msg.is_system || false;
                msg.extra.ghost_hidden = true;
                msg.is_system = true;
                restoredHiddenCount++;
                changesMade = true;
            }
        }

        if (changesMade) {
            //logger.info(`👻 恢复了 ${restoredHiddenCount} 条消息的隐藏状态`);
            const saveSuccess = await saveChat();

            if (saveSuccess) {
                //logger.info('👻 隐藏状态已保存');
            } else {
                //logger.warn('👻 隐藏状态保存可能失败');
            }

            // 刷新显示
            await refreshChatDisplay();

            toastr.info(`👻 已恢复 ${restoredHiddenCount} 条消息的隐藏状态`);
        }

    } catch (error) {
        logger.error('👻 恢复隐藏状态失败:', error);
    }
}

//自动隐藏楼层
export async function hideMessagesRange(startIndex, endIndex) {
    try {
        logger.info(`🪼开始隐藏第 ${startIndex + 1}-${endIndex + 1} 楼...`);

        const context = await getContext();
        const messages = getMessageArray(context);

        if (!messages || messages.length === 0) {
            logger.warn('🪼没有消息可隐藏');
            return false;
        }

        let hiddenCount = 0;
        let changesMade = false;

        // 修改消息数据
        for (let i = startIndex; i <= endIndex && i < messages.length; i++) {
            const msg = messages[i];
            if (!msg) continue;

            // 保存原始状态
            if (!msg.extra) msg.extra = {};
            if (typeof msg.extra.ghost_original_is_system === 'undefined') {
                msg.extra.ghost_original_is_system = msg.is_system || false;
            }

            // 设置为系统消息（隐藏）
            if (!msg.is_system) {
                msg.is_system = true;
                msg.extra.ghost_hidden = true;
                hiddenCount++;
                changesMade = true;

            }
        }

        if (changesMade) {
            //logger.debug('🪼开始调用官方保存函数...');
            const saveSuccess = await saveChat();

            if (saveSuccess) {
                logger.info(`🪼已隐藏 ${hiddenCount} 条消息 (第${startIndex + 1}-${endIndex + 1}楼)`);
                toastr.success(`🪼已隐藏第 ${startIndex + 1}-${endIndex + 1} 楼`);
            } else {
                //logger.warn(`🪼已隐藏 ${hiddenCount} 条消息，但保存可能失败`);
                //toastr.warning(`🪼已隐藏第 ${startIndex + 1}-${endIndex + 1} 楼，但保存状态未知`);
            }

            // 刷新界面显示
            await refreshChatDisplay();

            return true;
        }

        return false;

    } catch (error) {
        logger.error('🪼隐藏消息失败:', error);
        toastr.error('隐藏消息失败: ' + error.message);
        return false;
    }
}

//聊天唯一 ID 管理
export async function getCurrentChatIdentifier() {
    try {
        // 方法1：尝试使用SillyTavern API
        if (typeof getContext === 'function') {
            const context = await getContext();
            if (context?.chatName) {
                return cleanChatName(context.chatName);
            }
        }

        // 方法2：从URL或DOM获取
        const chatNameElement = document.querySelector('#chat_filename') ||
            document.querySelector('[data-chat-name]');
        if (chatNameElement) {
            const chatName = chatNameElement.textContent || chatNameElement.dataset.chatName;
            if (chatName) {
                return cleanChatName(chatName);
            }
        }

        // 方法3：从localStorage获取
        const savedChatName = localStorage.getItem('selected_chat');
        if (savedChatName) {
            return cleanChatName(savedChatName);
        }

        // 默认值
        return `unknown_chat_${Date.now()}`;

    } catch (error) {
        logger.error('获取聊天标识符失败:', error);
        return `fallback_chat_${Date.now()}`;
    }
}

// 清理聊天名称
export function cleanChatName(fileName) {
    if (!fileName || typeof fileName !== 'string') return 'unknown_chat_source';
    let cleanedName = fileName;
    if (fileName.includes('/') || fileName.includes('\\')) {
        const parts = fileName.split(/[\/\\]/);
        cleanedName = parts[parts.length - 1];
    }
    return cleanedName.replace(/\.jsonl$/, '').replace(/\.json$/, '');
}

// 记录楼层信息的函数
export async function updateFloorTrackingEntry(worldBookData, maxFloor, currentChatIdentifier) {
    try {
        let trackingEntry = null;

        // 查找现有的追踪条目
        Object.values(worldBookData.entries).forEach(entry => {
            if (entry.comment === GHOST_TRACKING_COMMENT) {
                trackingEntry = entry;
            }
        });

        const trackingContent = `聊天标识: ${currentChatIdentifier}\n最后总结楼层: ${maxFloor + 1}\n更新时间: ${new Date().toLocaleString()}\n状态: 已完成总结`;

        if (trackingEntry) {
            trackingEntry.content = trackingContent;
            logger.info(`👻 更新楼层追踪: 聊天${currentChatIdentifier}已总结到第${maxFloor + 1}楼`);
        } else {
            const newTrackingEntry = createWorldInfoEntry(null, worldBookData);
            Object.assign(newTrackingEntry, {
                comment: GHOST_TRACKING_COMMENT,
                content: trackingContent,
                key: ['楼层追踪', '鬼面状态', currentChatIdentifier],
                constant: true,
                selective: false,
                disable: false,
                order: 99999, // 很高的优先级
                excludeRecursion: true,
                preventRecursion: true
            });
            logger.info(`🆕 创建楼层追踪条目: 聊天${currentChatIdentifier}已总结到第${maxFloor + 1}楼`);
        }

    } catch (error) {
        logger.error('👻 更新楼层追踪失败:', error);
    }
}

//聊天切换时的总处理
export let _chatChangeInFlight = null;
export let _chatChangeLastRun = 0;
let _lastKnownChatId = null; // Track the chat ID to detect actual chat switches

export async function handleChatChange() {
    // ① 短时去抖：500ms 内重复调用直接忽略（按需调整）
    const now = Date.now();
    if (now - _chatChangeLastRun < 500) return;

    // ② 并发合并：同一时刻多次调用只执行一份
    if (_chatChangeInFlight) {
        try { await _chatChangeInFlight; } catch (_) { }
        return;
    }

    _chatChangeInFlight = (async () => {
        try {
            const isReady = await waitForSTReady();
            if (!isReady) {
                logger.warn('ST未完全就绪，跳过此次聊天切换处理');
                return;
            }

            // Detect whether this is a genuine chat switch or a spurious event
            const newChatId = await getCurrentChatIdentifier();
            const isActualSwitch = (_lastKnownChatId !== null && newChatId !== _lastKnownChatId);
            const isFirstLoad = (_lastKnownChatId === null);
            _lastKnownChatId = newChatId;

            if (isActualSwitch || isFirstLoad) {
                // Only reset counters on genuine chat switches / first load
                console.log(`[鬼面] 聊天切换: ${isFirstLoad ? '首次加载' : '切换到新聊天'} (${newChatId})`);
            } else {
                // Same chat — skip cooldown reset, preserve counters
                console.log(`[鬼面] CHAT_CHANGED 事件触发但聊天未变 (${newChatId})，跳过冷却重置`);
            }

            // console.log('🌍 聊天切换时自动管理世界书...');
            await autoManageWorldBook();

            // 等待世界书切换完成
            await new Promise(r => setTimeout(r, 1000));

            await ui.updateWorldBookDisplay();
            await restoreHiddenStateOnStartup();

            // Only reset token counters on actual chat switches
            if (isActualSwitch || isFirstLoad) {
                const context = await getContext();
                lastTokenCount = await getTokenCount(context);
                accumulatedNewTokens = 0;
                messagesSinceLastSummary = 0;
            }
        } catch (error) {
            logger.error('💥 聊天切换处理流程失败:', error);
        } finally {
            _chatChangeLastRun = Date.now();
            _chatChangeInFlight = null;
        }
    })();

    return _chatChangeInFlight;
}

// 等待ST加载完成
export async function waitForSTReady() {
    // console.log('⏳ 等待ST完全加载...');

    let attempts = 0;
    const maxAttempts = 30; // 最多等30秒

    while (attempts < maxAttempts) {
        try {
            const currentChid = utils.getCurrentChid();
            // 检查关键变量是否都可用
            if (currentChid !== null && currentChid !== undefined &&
                typeof characters !== 'undefined' &&
                typeof getContext === 'function') {

                // console.log('✅ ST核心变量已就绪');

                // 进一步检查是否有角色加载
                if (characters[currentChid]) {
                    // console.log(`✅ 角色已加载: ${characters[currentChid].name}`);
                    return true;
                } else {
                    // console.log('⏳ 等待角色加载...');
                }
            }
        } catch (error) {
            // console.log('⏳ ST还未完全就绪...');
        }

        attempts++;
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // console.log('⚠️ 等待ST就绪超时');
    return false;
}

// 自动世界书管理函数
export async function autoManageWorldBook() {
    try {
        // console.log('🌍 [自动世界书] 开始自动管理世界书...');

        // 第1步：获取角色绑定的世界书
        const boundWorldBook = await utils.findActiveWorldBook();

        if (!boundWorldBook) {
            // console.log('🌍 [自动世界书] 角色未绑定世界书，跳过自动管理');
            return false;
        }

        // console.log(`🌍 [自动世界书] 检测到绑定世界书: ${boundWorldBook}`);

        // 第2步：检查当前选中的世界书
        const worldSelect = document.querySelector('#world_editor_select');
        let currentSelectedBook = null;

        if (worldSelect && worldSelect.value) {
            currentSelectedBook = worldSelect.selectedOptions[0].textContent;
        }

        // 第3步：如果已经选中了正确的世界书，就不需要操作
        if (currentSelectedBook === boundWorldBook) {
            // console.log(`🌍 [自动世界书] 世界书已正确选中: ${boundWorldBook}`);
            return true;
        }

        // 第4步：自动选择正确的世界书
        // console.log(`🌍 [自动世界书] 当前选中: ${currentSelectedBook || '无'}, 需要切换到: ${boundWorldBook}`);

        const success = await autoSelectWorldBook(boundWorldBook, worldSelect);

        if (success) {
            // console.log(`🌍 [自动世界书] ✅ 成功自动选择世界书: ${boundWorldBook}`);
            // NOTE: Do NOT call ui.updateWorldBookDisplay() here — handleChatChange
            // already calls it after autoManageWorldBook returns, so a second call
            // would produce duplicate log lines and potentially stale data.

            return true;
        } else {
            console.warn(`🌍 [自动世界书] ❌ 无法自动选择世界书: ${boundWorldBook}`);
            return false;
        }

    } catch (error) {
        console.error('🌍 [自动世界书] 自动管理失败:', error);
        return false;
    }
}

// 🔧 自动选择世界书的核心函数
async function autoSelectWorldBook(targetWorldBook, worldSelect) {
    try {
        if (!worldSelect) {
            // 🆕 如果选择器不存在，尝试自动创建/等待
            // console.log('🌍 [自动选择] 世界书选择器不存在，尝试导航...');

            // 方法1：尝试点击世界书导航
            const worldInfoTab = document.querySelector('#WI_tab') ||
                document.querySelector('[data-tab="world_info"]') ||
                document.querySelector('a[href="#world_info"]');

            if (worldInfoTab) {
                // console.log('🌍 [自动选择] 点击世界书标签页...');
                worldInfoTab.click();

                // 等待页面加载
                await new Promise(resolve => setTimeout(resolve, 1000));

                // 重新获取选择器
                worldSelect = document.querySelector('#world_editor_select');
            }

            if (!worldSelect) {
                // console.log('🌍 [自动选择] 无法访问世界书选择器');
                return false;
            }
        }

        // 🎯 在选择器中查找目标世界书
        const options = Array.from(worldSelect.options);
        const targetOption = options.find(option =>
            option.textContent === targetWorldBook ||
            option.value === targetWorldBook
        );

        if (!targetOption) {
            // console.log(`🌍 [自动选择] 在选择器中未找到世界书: ${targetWorldBook}`);
            // console.log('🌍 [自动选择] 可用的世界书:', options.map(opt => opt.textContent));
            return false;
        }

        // 🎯 自动选择
        // console.log(`🌍 [自动选择] 找到目标选项，正在选择...`);
        worldSelect.value = targetOption.value;

        // 触发change事件
        const changeEvent = new Event('change', { bubbles: true });
        worldSelect.dispatchEvent(changeEvent);

        // 等待选择生效
        await new Promise(resolve => setTimeout(resolve, 500));

        // 验证是否选择成功
        const newSelected = worldSelect.selectedOptions[0]?.textContent;
        if (newSelected === targetWorldBook) {
            // console.log(`🌍 [自动选择] ✅ 选择成功: ${newSelected}`);
            return true;
        } else {
            // console.log(`🌍 [自动选择] ❌ 选择失败，当前选中: ${newSelected}`);
            return false;
        }

    } catch (error) {
        console.error('🌍 [自动选择] 选择世界书时出错:', error);
        return false;
    }
}

// 世界书初始化 - 在系统启动时调用
export async function smartWorldBookInit() {

    // 等待ST完全加载
    let retryCount = 0;
    const maxRetries = 10;

    while (retryCount < maxRetries) {
        // 检查基础条件
        const currentChid = utils.getCurrentChid();
        if (currentChid !== undefined && currentChid !== null &&
            typeof characters !== 'undefined' && characters[currentChid]) {


            const success = await autoManageWorldBook();

            if (success) {
                return true;
            } else {
                return false;
            }
        }

        retryCount++;
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return false;
}

// modules/phone/handbook/handbookBridge.js — Main Window Side Bridge Service
// Listens on BroadcastChannel('gf-handbook-bridge') and serves requests from
// the standalone handbook window (world book context, chat context, etc.).

import { getPhoneCharInfo, getPhoneUserName, getPhoneUserPersona, getPhoneWorldBookContext, getCoreFoundationPrompt, buildPhoneChatForWI } from '../phoneContext.js';
import { loadChatHistory } from '../chat/chatStorage.js';
import { getContext } from '../../../../../../extensions.js';
import { getRequestHeaders } from '../../../../../../../script.js';
import { customApiConfig, useMomentCustomApi } from '../../api.js';
import { getChatCompletionModel } from '../../../../../../openai.js';

const LOG = '[HandBook Bridge]';
const CHANNEL_NAME = 'gf-handbook-bridge';

let _channel = null;

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Initialize the bridge service on the main SillyTavern window.
 * Call once during plugin startup.
 */
export function initHandbookBridge() {
    if (_channel) return; // already initialized

    try {
        _channel = new BroadcastChannel(CHANNEL_NAME);
        _channel.onmessage = _handleMessage;
        console.log(`${LOG} Bridge initialized, listening on '${CHANNEL_NAME}'`);
    } catch (e) {
        console.warn(`${LOG} BroadcastChannel not available:`, e);
    }
}

/**
 * Push the init settings package to the standalone window.
 * Called when the handbook window is opened.
 */
export function pushInitPackage() {
    if (!_channel) {
        console.warn(`${LOG} Bridge not initialized, cannot push init package`);
        return;
    }

    const charInfo = getPhoneCharInfo();
    const userName = getPhoneUserName();
    const persona = getPhoneUserPersona();
    const foundationPrompt = getCoreFoundationPrompt();
    const stHeaders = getRequestHeaders();

    // Determine API credentials to pass
    const apiCredentials = _getApiCredentials();

    const payload = {
        charInfo: charInfo ? {
            name: charInfo.name,
            description: charInfo.description,
            avatar: charInfo.avatar,
        } : null,
        userName,
        persona,
        foundationPrompt,
        apiCredentials,
        stRequestHeaders: stHeaders,
    };

    _channel.postMessage({ type: 'init', payload });
    console.log(`${LOG} Init package pushed to handbook window`);
}

// ═══════════════════════════════════════════════════════════════════════
// Internal — Message Handler
// ═══════════════════════════════════════════════════════════════════════

async function _handleMessage(event) {
    const { id, method, args } = event.data || {};
    if (!id || !method) return; // Not an RPC request

    console.log(`${LOG} RPC request: ${method} (${id})`);

    let result = null;
    let error = null;

    try {
        switch (method) {
            case 'getWorldBookContext': {
                const phoneChatMessages = buildPhoneChatForWI(loadChatHistory());
                result = await getPhoneWorldBookContext(phoneChatMessages);
                break;
            }

            case 'getTodayChatContext': {
                result = _getTodayChatContext();
                break;
            }

            case 'getUpdatedCredentials': {
                result = _getApiCredentials();
                break;
            }

            default:
                error = `Unknown method: ${method}`;
                console.warn(`${LOG} ${error}`);
        }
    } catch (e) {
        error = e.message || String(e);
        console.error(`${LOG} RPC error for ${method}:`, e);
    }

    // Send response back
    if (_channel) {
        _channel.postMessage({ id, result, error });
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Internal — API Credentials
// ═══════════════════════════════════════════════════════════════════════

function _getApiCredentials() {
    // If custom API is enabled for phone modules, pass custom config
    if (useMomentCustomApi && customApiConfig?.url && customApiConfig?.model) {
        return {
            mode: 'custom',
            url: customApiConfig.url,
            apiKey: customApiConfig.apiKey || '',
            model: customApiConfig.model,
        };
    }

    // Otherwise, try to extract ST main API credentials
    try {
        const context = getContext();
        const oai = context.chatCompletionSettings;
        if (oai) {
            const chatCompletionSource = oai.chat_completion_source;
            const model = getChatCompletionModel(oai);

            // Build provider-specific extras
            const extras = {};
            if (oai.reverse_proxy) {
                extras.reverse_proxy = oai.reverse_proxy;
                extras.proxy_password = oai.proxy_password || '';
            }
            if (chatCompletionSource === 'custom') {
                extras.custom_url = oai.custom_url || '';
                extras.custom_include_body = oai.custom_include_body;
                extras.custom_exclude_body = oai.custom_exclude_body;
                extras.custom_include_headers = oai.custom_include_headers;
            }

            return {
                mode: 'st-proxy',
                stRequestHeaders: getRequestHeaders(),
                chatCompletionSource,
                model,
                ...extras,
            };
        }
    } catch (e) {
        console.warn(`${LOG} Failed to get ST API credentials:`, e);
    }

    return { mode: 'none' };
}

// ═══════════════════════════════════════════════════════════════════════
// Internal — Today Chat Context (copied from diaryGeneration.js pattern)
// ═══════════════════════════════════════════════════════════════════════

function _getTodayChatContext() {
    const charInfo = getPhoneCharInfo();
    const userName = getPhoneUserName();
    const charName = charInfo?.name || 'Character';
    const todayStr = new Date().toLocaleDateString('zh-CN');

    let sections = [];

    // Channel 1: ST Main Chat (today only)
    try {
        const context = getContext();
        const stChat = context.chat;
        if (stChat && Array.isArray(stChat)) {
            const todayMsgs = stChat.filter(msg => {
                if (!msg || !msg.mes || msg.mes.trim() === '' || msg.is_system) return false;
                if (!msg.send_date) return false;
                const msgDate = new Date(msg.send_date).toLocaleDateString('zh-CN');
                return msgDate === todayStr;
            });
            if (todayMsgs.length > 0) {
                const formatted = todayMsgs.slice(-10).map(msg => {
                    const role = msg.is_user ? userName : charName;
                    return `${role}: ${msg.mes.substring(0, 200)}`;
                }).join('\n');
                sections.push(`<main_rp>\n${formatted}\n</main_rp>`);
            }
        }
    } catch (e) {
        console.warn(`${LOG} getTodayChatContext: ST main chat read failed:`, e);
    }

    // Channel 2: Chat App (today only)
    try {
        const phoneChatHistory = loadChatHistory();
        if (phoneChatHistory && phoneChatHistory.length > 0) {
            const todayPhoneMsgs = phoneChatHistory.filter(msg => {
                if (!msg || !msg.content || !msg.timestamp) return false;
                const msgDate = new Date(msg.timestamp).toLocaleDateString('zh-CN');
                return msgDate === todayStr;
            });
            if (todayPhoneMsgs.length > 0) {
                const formatted = todayPhoneMsgs.slice(-15).map(msg => {
                    const role = msg.role === 'user' ? userName : charName;
                    return `${role}: ${msg.content.substring(0, 150)}`;
                }).join('\n');
                sections.push(`<phone_chat>\n${formatted}\n</phone_chat>`);
            }
        }
    } catch (e) {
        console.warn(`${LOG} getTodayChatContext: Chat App read failed:`, e);
    }

    if (sections.length === 0) return '';
    return '今天的互动记录:\n' + sections.join('\n');
}

// api.js
import { getContext, extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced, getRequestHeaders, getMaxContextSize } from '../../../../../script.js';
import { getChatCompletionModel } from '../../../../openai.js';
import { getTokenCountAsync } from '../../../../tokenizers.js';
import { dlog } from './utils.js';

// ─── Context size guard ───────────────────────────────────────────────
// Mirror ST's own "Mandatory prompts exceed the context size" behavior:
// before any LLM call hits the network we count the prompt with ST's
// model-aware tokenizer and compare against the ST-configured max context
// (minus reserved response length). Over-cap → toast.error + throw so the
// caller's existing try/catch shows the standard failure UI. We never
// silently truncate — phone / chat prompts are flat strings, not the
// layered prompt structure ST's main loop can shed entries from.
async function _assertPromptWithinContext(systemPrompt, userPrompt, maxTokens) {
    const combined = `${systemPrompt || ''}\n\n${userPrompt || ''}`;
    if (!combined.trim()) return;
    let promptTokens;
    try {
        promptTokens = await getTokenCountAsync(combined);
    } catch (e) {
        console.warn('[GhostFace.api] token count failed, skipping context guard:', e);
        return;
    }
    const maxContext = getMaxContextSize(maxTokens || undefined);
    if (!Number.isFinite(maxContext) || maxContext <= 0) return;
    if (promptTokens <= maxContext) return;
    const msg = `Prompt 超出上下文上限（${promptTokens} > ${maxContext} tokens），请缩短世界书 / 聊天历史，或在 ST 设置里调高 max context`;
    console.warn('[GhostFace.api]', msg);
    if (typeof toastr !== 'undefined') toastr.error(msg);
    const err = new Error(msg);
    err.code = 'CONTEXT_OVERFLOW';
    err.promptTokens = promptTokens;
    err.maxContext = maxContext;
    throw err;
}


// 定义模块名称常量
const MODULE_NAME = 'the_ghost_face';

export let customApiConfig = {
    url: '',
    apiKey: '',
    model: ''
};
export let useCustomApi = true; // 当前是否使用自定义API（默认启用外部API）
export let useMomentCustomApi = true; // 朋友圈独立API

// In-flight counter for callPhoneLLM. The ST backend-proxy path emits
// `chat_completion_prompt_ready` with our own small prompt, which would
// otherwise overwrite the panel's token cache. Listeners check this to skip
// those self-induced events.
export let phoneLLMInFlight = 0;
export const STORAGE_KEY_CUSTOM_API = `${MODULE_NAME}_customApiConfig_v1`;
export const STORAGE_KEY_USE_CUSTOM_API = `${MODULE_NAME}_useCustomApi_v1`;
export const STORAGE_KEY_USE_MOMENT_CUSTOM_API = `${MODULE_NAME}_useMomentCustomApi_v1`;

export function waitForUIElements(callback, maxAttempts = 10) {
    let attempts = 0;

    function check() {
        const checkbox = document.getElementById('the_ghost_face_control_panel_use_custom_api_checkbox');
        const urlInput = document.getElementById('the_ghost_face_control_panel_custom_api_url');

        if (checkbox && urlInput) {
            callback();
        } else if (attempts < maxAttempts) {
            attempts++;
            setTimeout(check, 500); // 每500ms检查一次
        } else {
            console.warn('等待UI元素超时，无法更新API配置界面');
        }
    }

    check();
}

export function updateApiConfigUI() {
    const checkbox = document.getElementById('the_ghost_face_control_panel_use_custom_api_checkbox');
    const urlInput = document.getElementById('the_ghost_face_control_panel_custom_api_url');
    const keyInput = document.getElementById('the_ghost_face_control_panel_custom_api_key');
    const modelSelect = document.getElementById('the_ghost_face_control_panel_custom_api_model');
    const configDiv = document.getElementById('the_ghost_face_control_panel_custom_api_config');

    if (checkbox) {
        checkbox.checked = useCustomApi;
    }

    const momentCheckbox = document.getElementById('the_ghost_face_control_panel_moment_custom_api_checkbox');
    if (momentCheckbox) {
        momentCheckbox.checked = useMomentCustomApi;
    }

    if (configDiv) {
        configDiv.style.display = (useCustomApi || useMomentCustomApi) ? 'block' : 'none';
    }

    // Sync provider dropdown with saved URL
    const providerSelect = document.getElementById('the_ghost_face_control_panel_custom_api_provider');
    if (providerSelect && urlInput) {
        const savedUrl = customApiConfig.url || '';
        // Check if saved URL matches a preset option
        const presetOption = Array.from(providerSelect.options).find(opt => opt.value && opt.value !== 'custom' && opt.value === savedUrl);
        if (presetOption) {
            providerSelect.value = savedUrl;
            urlInput.style.display = 'none';
            urlInput.value = savedUrl;
        } else if (savedUrl) {
            providerSelect.value = 'custom';
            urlInput.style.display = 'block';
            urlInput.value = savedUrl;
        } else {
            providerSelect.value = '';
            urlInput.style.display = 'none';
            urlInput.value = '';
        }
    } else if (urlInput) {
        urlInput.value = customApiConfig.url || '';
    }

    if (keyInput) {
        keyInput.value = customApiConfig.apiKey || '';
    }

    if (modelSelect && customApiConfig.model) {
        const existingOption = modelSelect.querySelector(`option[value="${customApiConfig.model}"]`);
        if (!existingOption) {
            const option = document.createElement('option');
            option.value = customApiConfig.model;
            option.textContent = customApiConfig.model;
            option.selected = true;
            modelSelect.appendChild(option);
        } else {
            modelSelect.value = customApiConfig.model;
        }
    }

    updateApiStatusDisplay();

    dlog('API配置UI已更新:', { useCustomApi, config: customApiConfig });
}

export function setupCustomApiEvents() {
    // API开关切换
    const useCustomApiCheckbox = document.getElementById('the_ghost_face_control_panel_use_custom_api_checkbox');
    const useMomentCustomApiCheckbox = document.getElementById('the_ghost_face_control_panel_moment_custom_api_checkbox');
    const apiConfigDiv = document.getElementById('the_ghost_face_control_panel_custom_api_config');

    if (useCustomApiCheckbox && apiConfigDiv) {
        useCustomApiCheckbox.addEventListener('change', (e) => {
            useCustomApi = e.target.checked;
            apiConfigDiv.style.display = (useCustomApi || useMomentCustomApi) ? 'block' : 'none';
            saveCustomApiSettings();
            updateApiStatusDisplay();

            // 🔧 使用全局logger
            if (typeof window.logger !== 'undefined') {
                window.logger.info('自定义API开关:', useCustomApi ? '已启用' : '已禁用');
            } else {
                dlog('自定义API开关:', useCustomApi ? '已启用' : '已禁用');
            }

            if (useCustomApi) {
                toastr.info('已启用自定义API，请配置相关信息');
            } else {
                toastr.info('🎯 已切换回SillyTavern默认API');
            }
        });
    }

    if (useMomentCustomApiCheckbox && apiConfigDiv) {
        useMomentCustomApiCheckbox.addEventListener('change', (e) => {
            useMomentCustomApi = e.target.checked;
            apiConfigDiv.style.display = (useCustomApi || useMomentCustomApi) ? 'block' : 'none';
            saveCustomApiSettings();
            updateApiStatusDisplay();

            if (typeof window.logger !== 'undefined') {
                window.logger.info('朋友圈独立API开关:', useMomentCustomApi ? '已启用' : '已禁用');
            } else {
                dlog('朋友圈独立API开关:', useMomentCustomApi ? '已启用' : '已禁用');
            }
        });
    }

    // API提供商下拉选择
    const providerSelect = document.getElementById('the_ghost_face_control_panel_custom_api_provider');
    const urlInput_provider = document.getElementById('the_ghost_face_control_panel_custom_api_url');
    if (providerSelect && urlInput_provider) {
        providerSelect.addEventListener('change', (e) => {
            const value = e.target.value;
            if (value === 'custom') {
                // Show custom input, let user type
                urlInput_provider.style.display = 'block';
                urlInput_provider.focus();
            } else if (value) {
                // Preset provider selected
                urlInput_provider.style.display = 'none';
                urlInput_provider.value = value;
                customApiConfig.url = value;
                saveCustomApiSettings();
                updateApiStatusDisplay();
            } else {
                // "请选择提供商" placeholder
                urlInput_provider.style.display = 'none';
                urlInput_provider.value = '';
                customApiConfig.url = '';
                saveCustomApiSettings();
                updateApiStatusDisplay();
            }
        });
    }

    // 保存API配置
    const saveButton = document.getElementById('the_ghost_face_control_panel_save_api_config');
    if (saveButton) {
        saveButton.addEventListener('click', () => {
            const urlInput = document.getElementById('the_ghost_face_control_panel_custom_api_url');
            const keyInput = document.getElementById('the_ghost_face_control_panel_custom_api_key');
            const modelSelect = document.getElementById('the_ghost_face_control_panel_custom_api_model');

            if (urlInput && keyInput && modelSelect) {
                customApiConfig.url = urlInput.value.trim();
                customApiConfig.apiKey = keyInput.value.trim();
                customApiConfig.model = modelSelect.value;

                if (!customApiConfig.url) {
                    toastr.warning('请输入API URL');
                    urlInput.focus();
                    return;
                }

                saveCustomApiSettings();
                toastr.success('🎉 API配置已保存！');

                // 使用全局logger
                if (typeof window.logger !== 'undefined') {
                    window.logger.info('API配置已保存:', { url: customApiConfig.url, model: customApiConfig.model });
                } else {
                    dlog('API配置已保存:', { url: customApiConfig.url, model: customApiConfig.model });
                }
            }
        });
    }

    // 清除API配置
    const clearButton = document.getElementById('the_ghost_face_control_panel_clear_api_config');
    if (clearButton) {
        clearButton.addEventListener('click', () => {
            if (confirm('确定要清除所有API配置吗？')) {
                clearCustomApiSettings();
            }
        });
    }

    // 加载模型列表
    const loadModelsButton = document.getElementById('the_ghost_face_control_panel_load_models_button');
    if (loadModelsButton) {
        loadModelsButton.addEventListener('click', loadApiModels);
    }

    // 监听输入框变化，自动保存
    const urlInput = document.getElementById('the_ghost_face_control_panel_custom_api_url');
    const keyInput = document.getElementById('the_ghost_face_control_panel_custom_api_key');
    const modelSelect = document.getElementById('the_ghost_face_control_panel_custom_api_model');

    if (urlInput) {
        urlInput.addEventListener('blur', () => {
            customApiConfig.url = urlInput.value.trim();
            saveCustomApiSettings();
        });
    }

    if (keyInput) {
        keyInput.addEventListener('blur', () => {
            customApiConfig.apiKey = keyInput.value.trim();
            saveCustomApiSettings();
        });
    }

    if (modelSelect) {
        modelSelect.addEventListener('change', () => {
            customApiConfig.model = modelSelect.value;
            saveCustomApiSettings();
            updateApiStatusDisplay();
        });
    }

    dlog('API事件监听器已设置完成');
}

// 保存自定义 API 设置
export function saveCustomApiSettings() {
    try {
        // 本地缓存（可能被移动端清理，但优先快）
        try {
            localStorage.setItem(STORAGE_KEY_CUSTOM_API, JSON.stringify(customApiConfig || {}));
            localStorage.setItem(STORAGE_KEY_USE_CUSTOM_API, useCustomApi ? 'true' : 'false');
            localStorage.setItem(STORAGE_KEY_USE_MOMENT_CUSTOM_API, useMomentCustomApi ? 'true' : 'false');
        } catch (e) {
            console.warn('localStorage 保存失败，继续使用扩展设置备份:', e?.message || e);
        }

        // SillyTavern 扩展设置（更可靠，跨环境持久化）
        if (typeof extension_settings !== 'undefined') {
            extension_settings[MODULE_NAME] = extension_settings[MODULE_NAME] || {};
            extension_settings[MODULE_NAME].customApiConfig = { ...customApiConfig };
            extension_settings[MODULE_NAME].useCustomApi = !!useCustomApi;
            extension_settings[MODULE_NAME].useMomentCustomApi = !!useMomentCustomApi;
            if (typeof saveSettingsDebounced === 'function') {
                saveSettingsDebounced();
            }
        }

        if (typeof window.logger !== 'undefined') {
            window.logger.info('自定义API设置已保存', { useCustomApi, config: { ...customApiConfig, apiKey: customApiConfig.apiKey ? '***' : '' } });
        } else {
            dlog('自定义API设置已保存', { useCustomApi, config: { ...customApiConfig, apiKey: customApiConfig.apiKey ? '***' : '' } });
        }
    } catch (error) {
        if (typeof window.logger !== 'undefined') {
            window.logger.error('保存自定义API设置失败:', error);
        } else {
            console.error('保存自定义API设置失败:', error);
        }
    }
}

// 添加API配置管理函数：
export function loadCustomApiSettings() {
    try {
        let loaded = false;
        // 1) 优先从 localStorage 读取
        try {
            const savedConfig = localStorage.getItem(STORAGE_KEY_CUSTOM_API);
            if (savedConfig) {
                const parsedConfig = JSON.parse(savedConfig);
                customApiConfig = { ...customApiConfig, ...parsedConfig };
                dlog('从localStorage加载的配置:', parsedConfig);
                loaded = true;
            }

            const savedUseCustom = localStorage.getItem(STORAGE_KEY_USE_CUSTOM_API);
            if (savedUseCustom !== null) {
                useCustomApi = savedUseCustom === 'true';
                dlog('从localStorage加载的开关状态:', useCustomApi);
            }

            const savedMomentUseCustom = localStorage.getItem(STORAGE_KEY_USE_MOMENT_CUSTOM_API);
            if (savedMomentUseCustom !== null) {
                useMomentCustomApi = savedMomentUseCustom === 'true';
            }
        } catch (e) {
            console.warn('读取 localStorage 失败，尝试扩展设置备份:', e?.message || e);
        }

        // 2) 若本地无数据，则回退到扩展设置
        if (!loaded && typeof extension_settings !== 'undefined') {
            const ext = extension_settings[MODULE_NAME] || {};
            if (ext.customApiConfig) {
                customApiConfig = { ...customApiConfig, ...ext.customApiConfig };
                dlog('从扩展设置加载的配置:', ext.customApiConfig);
                loaded = true;
            }
            if (typeof ext.useCustomApi === 'boolean') {
                useCustomApi = !!ext.useCustomApi;
                dlog('从扩展设置加载的开关状态:', useCustomApi);
            }
            if (typeof ext.useMomentCustomApi === 'boolean') {
                useMomentCustomApi = !!ext.useMomentCustomApi;
            }
        }

        waitForUIElements(updateApiConfigUI);

        if (useCustomApi || useMomentCustomApi) {
            if (typeof window.logger !== 'undefined') {
                window.logger.info('自定义API设置已加载');
            } else {
                dlog('自定义API设置已加载');
            }
        }

    } catch (error) {
        if (typeof window.logger !== 'undefined') {
            window.logger.error('加载自定义API设置失败:', error);
        } else {
            console.error('加载自定义API设置失败:', error);
        }
    }
}

export function clearCustomApiSettings() {
    customApiConfig = { url: '', apiKey: '', model: '' };
    useCustomApi = false;
    useMomentCustomApi = false;

    try {
        localStorage.removeItem(STORAGE_KEY_CUSTOM_API);
        localStorage.removeItem(STORAGE_KEY_USE_CUSTOM_API);
        localStorage.removeItem(STORAGE_KEY_USE_MOMENT_CUSTOM_API);

        if (typeof extension_settings !== 'undefined' && extension_settings[MODULE_NAME]) {
            delete extension_settings[MODULE_NAME].customApiConfig;
            delete extension_settings[MODULE_NAME].useCustomApi;
            delete extension_settings[MODULE_NAME].useMomentCustomApi;
            if (typeof saveSettingsDebounced === 'function') {
                saveSettingsDebounced();
            }
        }

        updateApiConfigUI();

        toastr.info('🗑️ 自定义API设置已清除');

    } catch (error) {
        if (typeof window.logger !== 'undefined') {
            window.logger.error('清除自定义API设置失败:', error);
        } else {
            console.error('清除自定义API设置失败:', error);
        }
    }
}

export function updateApiStatusDisplay() {
    const statusElement = document.getElementById('the_ghost_face_control_panel_api_status');
    if (!statusElement) return;

    if (!useCustomApi && !useMomentCustomApi) {
        statusElement.innerHTML = '<span style="color: #888;">💭 使用SillyTavern默认API</span>';
        return;
    }

    if (customApiConfig.url && customApiConfig.model) {
        statusElement.innerHTML = '<span style="color: #4caf50;">✅ 已配置可用</span>';
    } else if (customApiConfig.url) {
        statusElement.innerHTML = '<span style="color: #ff9800;">⚠️ 请选择模型</span>';
    } else {
        statusElement.innerHTML = '<span style="color: #f44336;">❌ 请配置URL</span>';
    }
}

// 添加模型加载函数：
export async function loadApiModels() {
    const urlInput = document.getElementById('the_ghost_face_control_panel_custom_api_url');
    const keyInput = document.getElementById('the_ghost_face_control_panel_custom_api_key');
    const modelSelect = document.getElementById('the_ghost_face_control_panel_custom_api_model');
    const statusElement = document.getElementById('the_ghost_face_control_panel_api_status');
    const loadButton = document.getElementById('the_ghost_face_control_panel_load_models_button');

    if (!urlInput || !modelSelect) return;

    const apiUrl = urlInput.value.trim();
    const apiKey = keyInput?.value?.trim() || '';

    if (!apiUrl) {
        toastr.warning('请先输入API基础URL');
        urlInput.focus();
        return;
    }

    // 禁用按钮，显示加载状态
    if (loadButton) {
        loadButton.disabled = true;
        loadButton.textContent = '⏳ 加载中';
    }

    let modelsUrl = apiUrl;
    if (!modelsUrl.endsWith('/')) modelsUrl += '/';

    // 兼容不同API提供商
    if (modelsUrl.includes('generativelanguage.googleapis.com')) {
        if (!modelsUrl.endsWith('models')) modelsUrl += 'models';
    } else {
        if (modelsUrl.endsWith('/v1/')) modelsUrl += 'models';
        else if (!modelsUrl.endsWith('models')) modelsUrl += 'v1/models';
    }

    if (statusElement) statusElement.innerHTML = '<span style="color: #61afef;">正在加载模型...</span>';

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(modelsUrl, {
            method: 'GET',
            headers: headers,
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (typeof window.logger !== 'undefined') {
            window.logger.debug('成功获取模型数据');
        } else {
            console.debug('成功获取模型数据');
        }

        modelSelect.innerHTML = '';
        let modelsFound = false;

        // 解析不同格式的模型数据
        if (data && data.data && Array.isArray(data.data)) {
            // OpenAI格式
            data.data.forEach(model => {
                if (model.id) {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.textContent = model.id;
                    modelSelect.appendChild(option);
                    modelsFound = true;
                }
            });
        } else if (data && Array.isArray(data)) {
            // 简单数组格式
            data.forEach(model => {
                const modelId = typeof model === 'string' ? model : model.id;
                if (modelId) {
                    const option = document.createElement('option');
                    option.value = modelId;
                    option.textContent = modelId;
                    modelSelect.appendChild(option);
                    modelsFound = true;
                }
            });
        }

        if (modelsFound) {
            // 如果之前保存过模型，自动选中
            if (customApiConfig.model) {
                modelSelect.value = customApiConfig.model;
            } else {
                const defaultOption = document.createElement('option');
                defaultOption.value = '';
                defaultOption.textContent = '请选择模型';
                defaultOption.selected = true;
                modelSelect.insertBefore(defaultOption, modelSelect.firstChild);
            }

            toastr.success('🎉 模型列表加载成功！');

            if (typeof window.logger !== 'undefined') {
                window.logger.info('成功加载模型:', data.data?.length || data.length);
            } else {
                dlog('成功加载模型:', data.data?.length || data.length);
            }

        } else {
            modelSelect.innerHTML = '<option value="">未找到可用模型</option>';
            toastr.warning('未找到可用的模型');
        }

    } catch (error) {
        if (typeof window.logger !== 'undefined') {
            window.logger.error('加载模型失败:', error);
        } else {
            console.error('加载模型失败:', error);
        }

        modelSelect.innerHTML = '<option value="">加载失败</option>';
        toastr.error('模型加载失败: ' + error.message);

    } finally {
        // 恢复按钮状态
        if (loadButton) {
            loadButton.disabled = false;
            loadButton.textContent = '加载';
        }
        updateApiStatusDisplay();
    }
}

// 自定义API调用函数：
// maxTokens 参数允许调用方指定更大的上限（大总结需要 8000+）
// images 参数接受 base64 data URL 数组，用于多模态请求（图片发给模型看）
export async function callCustomOpenAI(systemPrompt, userPrompt, { maxTokens = null, images = null, signal = null } = {}) {
    if (!customApiConfig.url || !customApiConfig.model) {
        throw new Error('自定义API配置不完整');
    }

    await _assertPromptWithinContext(systemPrompt, userPrompt, maxTokens);

    let apiUrl = customApiConfig.url;
    if (!apiUrl.endsWith('/')) apiUrl += '/';

    if (apiUrl.includes('generativelanguage.googleapis.com')) {
        if (!apiUrl.endsWith('chat/completions')) apiUrl += 'chat/completions';
    } else {
        if (apiUrl.endsWith('/v1/')) apiUrl += 'chat/completions';
        else if (!apiUrl.includes('/chat/completions')) apiUrl += 'v1/chat/completions';
    }

    const headers = { 'Content-Type': 'application/json' };
    if (customApiConfig.apiKey) {
        headers['Authorization'] = `Bearer ${customApiConfig.apiKey}`;
    }

    // 构建消息列表 — 过滤掉空的 system prompt（部分API不接受空系统消息）
    const messages = [];
    if (systemPrompt && systemPrompt.trim()) {
        messages.push({ role: 'system', content: systemPrompt });
    }

    // ── 多模态支持：当有图片时，将 user content 转为 content array ──
    if (images && images.length > 0) {
        const contentParts = [];
        // 文本部分
        if (userPrompt && userPrompt.trim()) {
            contentParts.push({ type: 'text', text: userPrompt });
        }
        // 图片部分
        for (const imgDataUrl of images) {
            contentParts.push({
                type: 'image_url',
                image_url: { url: imgDataUrl },
            });
        }
        messages.push({ role: 'user', content: contentParts });
    } else {
        messages.push({ role: 'user', content: userPrompt });
    }

    const requestBody = {
        model: customApiConfig.model,
        messages,
        temperature: 0.7,
        top_p: 1,
        stream: false
    };
    // Gemini's OpenAI-compat endpoint rejects unknown fields (top_k → 400).
    // Claude rejects top_k whenever extended thinking is on (detect by model name,
    // since users may route through proxies whose URL does not contain "anthropic").
    // Other OpenAI-compat providers either accept it or silently ignore it.
    const isGemini = apiUrl.includes('generativelanguage.googleapis.com');
    const isClaude = /claude/i.test(customApiConfig.model || '');
    if (!isGemini && !isClaude) {
        requestBody.top_k = 63;
    }
    if (maxTokens) {
        requestBody.max_tokens = maxTokens;
    }

    if (typeof window.logger !== 'undefined') {
        window.logger.debug('已调用自定义API', images?.length ? `(附带${images.length}张图片)` : '');
    } else {
        console.debug('已调用自定义API', images?.length ? `(附带${images.length}张图片)` : '');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort('timeout'), 120_000); // 120s timeout（大 prompt 需要更多时间）
    // Forward an external cancellation signal (stop button) to the fetch controller
    const onExternalAbort = () => controller.abort('external');
    if (signal) {
        if (signal.aborted) controller.abort('external');
        else signal.addEventListener('abort', onExternalAbort, { once: true });
    }
    let response;
    try {
        response = await fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        });
    } catch (err) {
        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener('abort', onExternalAbort);
        if (err.name === 'AbortError') {
            if (signal?.aborted) {
                const cancelErr = new Error('已取消生成');
                cancelErr.code = 'USER_CANCELLED';
                throw cancelErr;
            }
            throw new Error('API请求超时 (120秒)');
        }
        throw err;
    }
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onExternalAbort);

    if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`API请求失败: ${response.status} ${response.statusText}\n${errorText}`);
        error.status = response.status;
        throw error;
    }

    const data = await response.json();

    if (data.choices && data.choices[0] && data.choices[0].message) {
        const msg = data.choices[0].message;
        const content = msg.content ?? msg.reasoning_content ?? null;

        if (content == null) {
            console.error('API返回的 message 中 content 为空，完整 message:', JSON.stringify(msg));
            console.error('finish_reason:', data.choices[0].finish_reason);
            const error = new Error(
                `API返回的 message.content 为空 (finish_reason=${data.choices[0].finish_reason || 'unknown'})`
            );
            error.code = 'CONTENT_EMPTY_LENGTH';
            throw error;
        }
        return content.trim();
    } else {
        console.error('API响应格式异常，完整 data:', JSON.stringify(data).substring(0, 500));
        throw new Error('API响应格式异常');
    }
}

/**
 * Unified LLM call for phone module apps.
 * Routes to custom API or ST main LLM based on the `useMomentCustomApi` toggle.
 * All phone apps (chat, diary, etc.) should use this instead of `callCustomOpenAI` directly.
 *
 * @param {string} systemPrompt - System prompt
 * @param {string} userPrompt - User prompt
 * @param {{ maxTokens?: number, images?: string[] }} options
 * @returns {Promise<string>} LLM response text
 */
export async function callPhoneLLM(systemPrompt, userPrompt, { maxTokens = null, images = null, signal = null } = {}) {
    const MAX_RETRIES = 3;
    const BASE_DELAY = 1000; // 1s → 2s → 4s

    const isCancelled = () => !!signal?.aborted;
    const makeCancelError = () => {
        const e = new Error('已取消生成');
        e.code = 'USER_CANCELLED';
        return e;
    };

    phoneLLMInFlight++;
    try {
        let lastError;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            if (isCancelled()) throw makeCancelError();
            try {
                if (useMomentCustomApi && customApiConfig?.url && customApiConfig?.model) {
                    // ─── Custom API path (手机端独立开关 useMomentCustomApi) ───
                    if (attempt === 1) dlog('📱 [Phone LLM] 使用自定义API');
                    return await callCustomOpenAI(systemPrompt, userPrompt, { maxTokens, images, signal });
                }

                // ─── ST Main LLM path — chat-completion via ST backend proxy ───
                // Bypasses ST's frontend cleanUpMessage → getRegexedString cleanup,
                // so user-configured AI_OUTPUT regex scripts cannot strip our
                // structured-JSON replies.
                if (attempt === 1) dlog('📱 [Phone LLM] 使用ST后端代理');
                return await _callSTBackendChat(systemPrompt, userPrompt, { images, maxTokens, signal });

            } catch (err) {
                lastError = err;

                // User cancellation — don't retry, propagate immediately
                if (err?.code === 'USER_CANCELLED' || isCancelled()) {
                    throw makeCancelError();
                }

                // Empty content / length cutoff — retrying just burns quota, fail fast
                if (err?.code === 'CONTENT_EMPTY_LENGTH') {
                    console.error(`📱 [Phone LLM] 内容为空 / 被截断，不重试:`, err.message);
                    throw err;
                }

                // Don't retry 4xx client errors (bad API key, malformed request, etc.)
                // Trust err.status only — message regex matched random 3-digit substrings ("context limit 4000")
                const status = err?.status;
                if (status >= 400 && status < 500) {
                    console.error(`📱 [Phone LLM] 4xx 客户端错误，不重试:`, err.message);
                    throw err;
                }

                if (attempt >= MAX_RETRIES) {
                    console.error(`📱 [Phone LLM] ❌ ${MAX_RETRIES}次重试全部失败`);
                    throw err;
                }

                const delay = BASE_DELAY * Math.pow(2, attempt - 1);
                console.warn(`📱 [Phone LLM] ⚠️ 第${attempt}次调用失败 (${err.message})，${delay / 1000}秒后重试...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
        throw lastError;
    } finally {
        phoneLLMInFlight--;
    }
}

/**
 * Send a chat-completion request via ST's backend proxy. Replaces the old
 * generateRaw path: same API-key injection and provider routing (Gemini,
 * OpenAI, Claude, etc.), but skips ST's frontend cleanUpMessage pass — so
 * user-configured AI_OUTPUT regex scripts cannot strip the LLM reply (which
 * was deleting the structured-JSON reply when the user had aggressive regex
 * rules like <think>…</think> removers). Images is optional; pass an array
 * of base64 data URLs to enable the multimodal payload shape.
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {{ images?: string[]|null, maxTokens?: number|null, signal?: AbortSignal|null }} [options]
 * @returns {Promise<string>}
 */
async function _callSTBackendChat(systemPrompt, userPrompt, { images = null, maxTokens = null, signal = null } = {}) {
    const context = getContext();
    const oai = context.chatCompletionSettings;
    if (!oai) {
        throw new Error('无法获取ST的API设置 (chatCompletionSettings)');
    }

    const chatCompletionSource = oai.chat_completion_source;
    const model = getChatCompletionModel(oai);
    if (!model) {
        throw new Error('无法确定当前ST模型，请确保已在SillyTavern中选择了模型');
    }

    const hasImages = Array.isArray(images) && images.length > 0;
    dlog('📱 [Phone LLM] ST后端代理配置:', { source: chatCompletionSource, model, multimodal: hasImages });

    // Resolve ST extended macros ({{datetime}}, {{random}}, {{getvar::x}}, …)
    // before sending. The phone prompt builder already replaces {{user}} /
    // {{char}}, but character-card text pulled into the prompt may still
    // contain other macros that only ST knows how to expand.
    const subst = (t) => {
        if (!t || typeof context.substituteParams !== 'function') return t;
        try { return context.substituteParams(t); } catch { return t; }
    };
    const resolvedSystem = subst(systemPrompt);
    const resolvedUser = subst(userPrompt);

    // Count on the resolved text — macros like {{datetime}} / {{getvar::x}}
    // are what actually ship to the model, so the guard should see them too.
    await _assertPromptWithinContext(resolvedSystem, resolvedUser, maxTokens);

    // ── 构建 messages 数组 ──
    const messages = [];
    if (resolvedSystem && resolvedSystem.trim()) {
        messages.push({ role: 'system', content: resolvedSystem });
    }

    if (hasImages) {
        // Multimodal: user message is an array of text+image parts.
        const contentParts = [];
        if (resolvedUser && resolvedUser.trim()) {
            contentParts.push({ type: 'text', text: resolvedUser });
        }
        for (const imgDataUrl of images) {
            contentParts.push({
                type: 'image_url',
                image_url: { url: imgDataUrl },
            });
        }
        messages.push({ role: 'user', content: contentParts });
    } else {
        // Pure text: keep the standard string-content shape.
        messages.push({ role: 'user', content: resolvedUser ?? '' });
    }

    // Claude (direct source OR via a local proxy that exposes Claude under
    // chat_completion_source="custom") needs special handling for extended thinking.
    const isClaudeRequest = chatCompletionSource === 'claude' || /claude/i.test(model);
    const isClaudeThinking = isClaudeRequest && /thinking/i.test(model);

    // Claude thinking requires max_tokens > thinking.budget_tokens. The proxy
    // assigns budget_tokens automatically (commonly ~5k–10k), so a 4k cap
    // makes Claude reject the request. Floor max_tokens at 16k for thinking
    // models so the budget always fits underneath.
    const requestedMaxTokens = maxTokens || oai.openai_max_tokens || 4000;
    const effectiveMaxTokens = isClaudeThinking ? Math.max(requestedMaxTokens, 16000) : requestedMaxTokens;

    // ── 构建请求体（模仿 ST 的 sendOpenAIRequest） ──
    const generateData = {
        type: 'quiet',
        messages,
        model,
        temperature: Number(oai.temp_openai) || 0.7,
        top_p: Number(oai.top_p_openai ?? 1.0),
        max_tokens: effectiveMaxTokens,
        stream: false,
        chat_completion_source: chatCompletionSource,
    };

    // top_k only when user explicitly set > 0 — ST default 0 means "disabled"
    // and OpenAI rejects the param entirely. Claude additionally rejects top_k
    // whenever extended thinking is enabled, and the user's ST `top_k_openai`
    // is a single global value that doesn't know about Claude's constraint —
    // so skip the param for Claude entirely.
    const topK = Number(oai.top_k_openai);
    if (Number.isFinite(topK) && topK > 0 && !isClaudeRequest) {
        generateData.top_k = topK;
    }

    // 添加 provider 特定字段
    if (oai.reverse_proxy) {
        generateData.reverse_proxy = oai.reverse_proxy;
        generateData.proxy_password = oai.proxy_password || '';
    }
    if (chatCompletionSource === 'custom') {
        generateData.custom_url = oai.custom_url || '';
        generateData.custom_include_body = oai.custom_include_body;
        generateData.custom_exclude_body = oai.custom_exclude_body;
        generateData.custom_include_headers = oai.custom_include_headers;
    }

    // ── 发送到 ST 后端代理 ──
    let response;
    try {
        response = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(generateData),
            signal,
        });
    } catch (err) {
        if (err.name === 'AbortError' && signal?.aborted) {
            const cancelErr = new Error('已取消生成');
            cancelErr.code = 'USER_CANCELLED';
            throw cancelErr;
        }
        throw err;
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ST后端代理请求失败: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const data = await response.json();

    // ── 解析响应（兼容不同 provider 的返回格式） ──
    // OpenAI / Custom / most providers
    if (data.choices?.[0]?.message?.content) {
        return data.choices[0].message.content.trim();
    }
    // Gemini / Makersuite
    if (data.candidates?.[0]?.content?.parts) {
        const textParts = data.candidates[0].content.parts
            .filter(p => p.text && !p.thought)
            .map(p => p.text);
        if (textParts.length > 0) return textParts.join('').trim();
    }
    // Claude
    if (data.content?.[0]?.text) {
        return data.content[0].text.trim();
    }
    // Fallback: try reasoning_content
    if (data.choices?.[0]?.message?.reasoning_content) {
        return data.choices[0].message.reasoning_content.trim();
    }

    console.error('📱 [Phone LLM] ST后端代理响应格式异常:', JSON.stringify(data).substring(0, 500));
    throw new Error('ST后端代理响应格式异常');
}

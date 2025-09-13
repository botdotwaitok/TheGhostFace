// api.js
import {getContext,extension_settings,} from '../../../../extensions.js';
import {chat_metadata, getMaxContextSize, generateRaw,streamingProcessor,main_api,system_message_types,saveSettingsDebounced,getRequestHeaders,saveChatDebounced,chat,this_chid,characters,reloadCurrentChat,} from '../../../../../script.js';
import { createWorldInfoEntry,deleteWIOriginalDataValue,deleteWorldInfoEntry,importWorldInfo,loadWorldInfo,saveWorldInfo,world_info} from '../../../../world-info.js';
import { eventSource, event_types } from '../../../../../script.js';
import * as ui from '../ui/ui.js';
import * as utils from './utils.js';


// 定义模块名称常量
const MODULE_NAME = 'the_ghost_face';

//自定义API部分👇
export let customApiConfig = { 
    url: '', 
    apiKey: '', 
    model: '',
    enabled: false  // 🆕 是否启用自定义API
};
export let useCustomApi = false; // 当前是否使用自定义API
export const STORAGE_KEY_CUSTOM_API = `${MODULE_NAME}_customApiConfig_v1`;
export const STORAGE_KEY_USE_CUSTOM_API = `${MODULE_NAME}_useCustomApi_v1`;

// 🔧 修复：等待UI就绪后再更新界面
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
            console.warn('🤖 等待UI元素超时，无法更新API配置界面');
        }
    }
    
    check();
}

// 🔧 修复：更新UI界面的函数
export function updateApiConfigUI() {
    const checkbox = document.getElementById('the_ghost_face_control_panel_use_custom_api_checkbox');
    const urlInput = document.getElementById('the_ghost_face_control_panel_custom_api_url');
    const keyInput = document.getElementById('the_ghost_face_control_panel_custom_api_key');
    const modelSelect = document.getElementById('the_ghost_face_control_panel_custom_api_model');
    const configDiv = document.getElementById('the_ghost_face_control_panel_custom_api_config');
    
    if (checkbox) {
        checkbox.checked = useCustomApi;
    }
    
    if (configDiv) {
        configDiv.style.display = useCustomApi ? 'block' : 'none';
    }
    
    if (urlInput) {
        urlInput.value = customApiConfig.url || '';
    }
    
    if (keyInput) {
        keyInput.value = customApiConfig.apiKey || '';
    }
    
    if (modelSelect && customApiConfig.model) {
        // 如果有保存的模型，先创建一个选项
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
    
    console.log('🤖 API配置UI已更新:', { useCustomApi, config: customApiConfig });
}

// 自定义API事件处理函数：
export function setupCustomApiEvents() {
    // API开关切换
    const useCustomApiCheckbox = document.getElementById('the_ghost_face_control_panel_use_custom_api_checkbox');
    const apiConfigDiv = document.getElementById('the_ghost_face_control_panel_custom_api_config');
    
    if (useCustomApiCheckbox && apiConfigDiv) {
        useCustomApiCheckbox.addEventListener('change', (e) => {
            useCustomApi = e.target.checked;
            apiConfigDiv.style.display = useCustomApi ? 'block' : 'none';
            saveCustomApiSettings();
            updateApiStatusDisplay();
            
            // 🔧 使用全局logger
            if (typeof window.logger !== 'undefined') {
                window.logger.info('🤖 自定义API开关:', useCustomApi ? '已启用' : '已禁用');
            } else {
                console.log('🤖 自定义API开关:', useCustomApi ? '已启用' : '已禁用');
            }
            
            if (useCustomApi) {
                toastr.info('🤖 已启用自定义API，请配置相关信息');
            } else {
                toastr.info('🎯 已切换回SillyTavern默认API');
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
                
                // 🔧 使用全局logger
                if (typeof window.logger !== 'undefined') {
                    window.logger.info('🤖 API配置已保存:', { url: customApiConfig.url, model: customApiConfig.model });
                } else {
                    console.log('🤖 API配置已保存:', { url: customApiConfig.url, model: customApiConfig.model });
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
    
    // 🆕 监听输入框变化，自动保存
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
    
    console.log('🤖 API事件监听器已设置完成');
}

// 添加API配置管理函数：
export function loadCustomApiSettings() {
    try {
        const savedConfig = localStorage.getItem(STORAGE_KEY_CUSTOM_API);
        if (savedConfig) {
            const parsedConfig = JSON.parse(savedConfig);
            customApiConfig = { ...customApiConfig, ...parsedConfig };
            console.log('🤖 从localStorage加载的配置:', parsedConfig);
        }
        
        const savedUseCustom = localStorage.getItem(STORAGE_KEY_USE_CUSTOM_API);
        if (savedUseCustom !== null) {
            useCustomApi = savedUseCustom === 'true';
            console.log('🤖 从localStorage加载的开关状态:', useCustomApi);
        }
        
        // 🆕 等待UI就绪后更新界面
        waitForUIElements(updateApiConfigUI);
        
        // 🔧 使用全局logger
        if (typeof window.logger !== 'undefined') {
            window.logger.info('🤖 自定义API设置已加载', { useCustomApi, config: customApiConfig });
        } else {
            console.log('🤖 自定义API设置已加载', { useCustomApi, config: customApiConfig });
        }
        
    } catch (error) {
        // 🔧 使用全局logger
        if (typeof window.logger !== 'undefined') {
            window.logger.error('🤖 加载自定义API设置失败:', error);
        } else {
            console.error('🤖 加载自定义API设置失败:', error);
        }
    }
}

export function clearCustomApiSettings() {
    customApiConfig = { url: '', apiKey: '', model: '', enabled: false };
    useCustomApi = false;
    
    try {
        localStorage.removeItem(STORAGE_KEY_CUSTOM_API);
        localStorage.removeItem(STORAGE_KEY_USE_CUSTOM_API);
        
        // 🆕 也清除扩展设置中的备份
        if (typeof extension_settings !== 'undefined' && extension_settings[MODULE_NAME]) {
            delete extension_settings[MODULE_NAME].customApiConfig;
            delete extension_settings[MODULE_NAME].useCustomApi;
            if (typeof saveSettingsDebounced === 'function') {
                saveSettingsDebounced();
            }
        }
        
        // 更新UI
        updateApiConfigUI();
        
        toastr.info('🗑️ 自定义API设置已清除');
        
    } catch (error) {
        // 🔧 使用全局logger
        if (typeof window.logger !== 'undefined') {
            window.logger.error('🤖 清除自定义API设置失败:', error);
        } else {
            console.error('🤖 清除自定义API设置失败:', error);
        }
    }
}

export function updateApiStatusDisplay() {
    const statusElement = document.getElementById('the_ghost_face_control_panel_api_status');
    if (!statusElement) return;
    
    if (!useCustomApi) {
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
    const apiKey = keyInput.value.trim();
    
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
    
    statusElement.innerHTML = '<span style="color: #61afef;">🔄 正在加载模型...</span>';
    
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        
        const response = await fetch(modelsUrl, { 
            method: 'GET', 
            headers: headers,
            timeout: 10000  // 10秒超时
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // 🔧 使用全局logger
        if (typeof window.logger !== 'undefined') {
            window.logger.debug('🤖 获取到的模型数据:', data);
        } else {
            console.debug('🤖 获取到的模型数据:', data);
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
            
            // 🔧 使用全局logger
            if (typeof window.logger !== 'undefined') {
                window.logger.info('🤖 成功加载模型:', data.data?.length || data.length);
            } else {
                console.log('🤖 成功加载模型:', data.data?.length || data.length);
            }
            
        } else {
            modelSelect.innerHTML = '<option value="">未找到可用模型</option>';
            toastr.warning('未找到可用的模型');
        }
        
    } catch (error) {
        // 🔧 使用全局logger
        if (typeof window.logger !== 'undefined') {
            window.logger.error('🤖 加载模型失败:', error);
        } else {
            console.error('🤖 加载模型失败:', error);
        }
        
        modelSelect.innerHTML = '<option value="">加载失败</option>';
        toastr.error('模型加载失败: ' + error.message);
        
    } finally {
        // 恢复按钮状态
        if (loadButton) {
            loadButton.disabled = false;
            loadButton.textContent = '🔄 加载';
        }
        updateApiStatusDisplay();
    }
}

// 自定义API调用函数：
export async function callCustomOpenAI(systemPrompt, userPrompt) {
    if (!customApiConfig.url || !customApiConfig.model) {
        throw new Error('自定义API配置不完整');
    }
    
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
    
    const requestBody = {
        model: customApiConfig.model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 2000,
        stream: false
    };
    
    // 🔧 使用全局logger
    if (typeof window.logger !== 'undefined') {
        window.logger.debug('🤖 调用自定义API:', { url: apiUrl, model: customApiConfig.model });
    } else {
        console.debug('🤖 调用自定义API:', { url: apiUrl, model: customApiConfig.model });
    }
    
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API请求失败: ${response.status} ${response.statusText}\n${errorText}`);
    }
    
    const data = await response.json();
    
    if (data.choices && data.choices[0] && data.choices[0].message) {
        return data.choices[0].message.content.trim();
    } else {
        throw new Error('API响应格式异常');
    }
}
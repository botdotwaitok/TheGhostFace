// Generated from ui/ghostpanel.html to enable instant inline rendering without network fetches.
// Keep this template in sync with the legacy layout to preserve DOM ids consumed by other modules.
export const ghostFacePanelTemplate = String.raw`
<div id="the_ghost_face_control_panel">
    <!-- 控制面板 -->
    <div id="the_ghost_face_control_panel_content" class="ghost-theme-responsive">

        <!-- 头部 -->
        <div id="the_ghost_face_control_panel_header">
            <h3 style="margin: 0; -size: 18px; -weight: 600;">
                👻 鬼面控制台
            </h3>

        </div>

        <!-- 可滚动的主体内容 -->
        <div class="ghost-panel-body">

            <div class="ghost-main-actions-vertical">
                <!-- 自动开关按钮 -->
                <button id="the_ghost_face_control_panel_toggle_auto" class="ghost-button ghost-auto-toggle"
                    data-auto-enabled="false">
                    自动OFF
                </button>

                <!-- 设置菜单按钮 -->
                <button id="the_ghost_face_control_panel_settings_toggle" class="ghost-button ghost-panel-toggle">
                    设置菜单
                </button>

                <!-- 朋友圈按钮 -->
                <button id="the_ghost_face_moments_btn" class="ghost-button ghost-panel-toggle">
                    朋友圈
                </button>

                <!-- 世界书管理按钮 -->
                <button id="gf_tab_worldbook_manager" class="ghost-button ghost-panel-toggle">
                    世界书管理
                </button>
            </div>
            
            <!-- 世界书管理面板 -->
            <div id="ghostface_worldbook_manager_panel" style="display: none; margin-bottom: 20px;">
                <div class="ghost-settings-card" id="ghostface_worldbook_manager_content">
                </div>
            </div>


            <!-- 可折叠的设置区域 -->
            <div id="the_ghost_face_control_panel_settings_area" style="display: none; margin-bottom: 20px;">

                <div class="ghost-toggle-group">
                    <div id="the_ghost_face_custom_wb_container" style="margin-top: 5px; margin-bottom: 10px; padding-left: 5px;">
                        <label style="color: #aaa; font-size: 13px; margin-bottom: 4px; display: block;">
                            为当前角色指定世界书
                        </label>
                        <select id="the_ghost_face_custom_wb_select" class="ghost-select" style="font-size: 13px; padding: 6px 8px; width: 100%;">
                            <option value="">未选择</option>
                        </select>
                    </div>
                    <label class="ghost-toggle-row" for="the_ghost_face_auto_hide_after_sum">
                        <span class="ghost-toggle-label">总结后自动隐藏楼层</span>
                        <div class="ghost-toggle-switch">
                            <input type="checkbox" id="the_ghost_face_auto_hide_after_sum" checked>
                            <span class="ghost-toggle-slider"></span>
                        </div>
                    </label>
                    <label class="ghost-toggle-row" for="ghost_backup_enabled">
                        <span class="ghost-toggle-label">总结后自动备份</span>
                        <div class="ghost-toggle-switch">
                            <input type="checkbox" id="ghost_backup_enabled">
                            <span class="ghost-toggle-slider"></span>
                        </div>
                    </label>
                    <label class="ghost-toggle-row" for="the_ghost_face_control_panel_use_custom_api_checkbox">
                        <span class="ghost-toggle-label">鬼面自定义API</span>
                        <div class="ghost-toggle-switch">
                            <input type="checkbox" id="the_ghost_face_control_panel_use_custom_api_checkbox">
                            <span class="ghost-toggle-slider"></span>
                        </div>
                    </label>
                    <label class="ghost-toggle-row" for="the_ghost_face_control_panel_moment_custom_api_checkbox">
                        <span class="ghost-toggle-label">朋友圈自定义API</span>
                        <div class="ghost-toggle-switch">
                            <input type="checkbox" id="the_ghost_face_control_panel_moment_custom_api_checkbox">
                            <span class="ghost-toggle-slider"></span>
                        </div>
                    </label>
                    <label class="ghost-toggle-row" for="the_ghost_face_control_panel_show_float_bubble_checkbox">
                        <span class="ghost-toggle-label">显示朋友圈悬浮泡泡</span>
                        <div class="ghost-toggle-switch">
                            <input type="checkbox" id="the_ghost_face_control_panel_show_float_bubble_checkbox" checked>
                            <span class="ghost-toggle-slider"></span>
                        </div>
                    </label>
                </div>
                <!-- 触发设置 -->
                <div style="margin-bottom: 15px;">
                    <label style="color: #ccc; font-size: 12px; margin-bottom: 8px; display: block;">
                        触发设置
                    </label>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                        <div>
                            <label style="color: #aaa; font-size: 12px;">Token阈值(万)</label>
                            <input id="the_ghost_face_token_threshold" type="number" min="4" max="800" step="0.1"
                                value="800" class="ghost-input">
                        </div>
                        <div>
                            <label style="color: #aaa; font-size: 12px;">消息阈值(条)</label>
                            <input id="the_ghost_face_control_panel_interval_input" type="number" min="0" max="250"
                                value="50" class="ghost-input">
                        </div>
                    </div>
                </div>


                <!-- 指定范围总结 -->
                <div style="margin-bottom: 15px;">
                    <label style="color: #ccc; font-size: 12px; margin-bottom: 8px; display: block;">
                        指定范围总结
                    </label>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                        <div>
                            <label style="color: #aaa; font-size: 12px;">起始楼层</label>
                            <input id="the_ghost_face_control_panel_manual_start" type="number" min="1" value="1"
                                class="ghost-input" placeholder="开始">
                        </div>
                        <div>
                            <label style="color: #aaa; font-size: 12px;">结束楼层</label>
                            <input id="the_ghost_face_control_panel_manual_end" type="number" min="1" value=""
                                class="ghost-input" placeholder="结束">
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-top: 10px;">
                        <button id="the_ghost_face_control_panel_big_summary_range" class="ghost-button ghost-primary">
                            开始大总结
                        </button>
                        <button id="the_ghost_face_control_panel_hide_range" class="ghost-button">
                            隐藏所选楼层
                        </button>
                    </div>


                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-bottom: 20px;">
                    <div>
                        <label style="color: #aaa; font-size: 12px;">分段大小(楼/段)</label>
                        <input id="the_ghost_face_control_panel_chunk_size" type="number" min="10" max="100" value="50"
                            class="ghost-input">
                    </div>
                    <div style="display: flex; align-items: flex-end;">
                        <button id="the_ghost_face_control_panel_auto_chunk_summary" class="ghost-button" style="width: 100%;">
                            高楼层总结
                        </button>
                    </div>
                </div>

                <!-- 自定义 API 配置 -->
                <div class="ghost-settings-card">
                    <div style="margin-bottom: 10px;">
                        <div style="font-size: 12px; color: #ccc;">自定义 API 配置</div>
                    </div>
                    <div id="the_ghost_face_control_panel_custom_api_config" style="display: block;">
                        <div style="margin-bottom: 8px;">
                            <label style="color: #aaa; font-size: 12px; margin-bottom: 3px; display: block;">
                                API基础URL
                            </label>
                            <input id="the_ghost_face_control_panel_custom_api_url" type="text"
                                placeholder="https://api.openai.com/v1" class="ghost-input"
                                style="font-size: 10px; padding: 6px 8px;">
                        </div>

                        <!-- API密钥 -->
                        <div style="margin-bottom: 8px;">
                            <label style="color: #aaa; font-size: 12px; margin-bottom: 3px; display: block;">
                                API密钥
                            </label>
                            <input id="the_ghost_face_control_panel_custom_api_key" type="password" placeholder="sk-..."
                                class="ghost-input" style="font-size: 10px; padding: 6px 8px;">
                        </div>

                        <!-- 模型选择 -->
                        <div style="margin-bottom: 8px;">
                            <label style="color: #aaa; font-size: 12px; margin-bottom: 3px; display: block;">
                                模型
                            </label>
                            <div style="display: grid; grid-template-columns: 1fr auto; gap: 6px;">
                                <select id="the_ghost_face_control_panel_custom_api_model" class="ghost-select"
                                    style="font-size: 10px; padding: 4px 6px;">
                                    <option value="">请先加载模型</option>
                                </select>
                                <button id="the_ghost_face_control_panel_load_models_button" class="ghost-button"
                                    style="padding: 4px 8px; min-height: 26px; font-size: 12px; white-space: nowrap;">
                                    加载
                                </button>
                            </div>
                        </div>

                        <!-- API状态 -->
                        <div style="margin-bottom: 8px;">
                            <div id="the_ghost_face_control_panel_api_status"
                                style="font-size: 12px; color: #000000; padding: 4px 6px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                                当前状态: 未配置
                            </div>
                        </div>

                        <!-- 保存/清除按钮 -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                            <button id="the_ghost_face_control_panel_save_api_config" class="ghost-button"
                                style="font-size: 12px; min-height: 26px; padding: 4px 6px;">
                                保存
                            </button>
                            <button id="the_ghost_face_control_panel_clear_api_config" class="ghost-button"
                                style="font-size: 12px; min-height: 26px; padding: 4px 6px;">
                                清除
                            </button>
                        </div>

                    </div>
                </div>

                <!-- 📦 备份设置 -->
                <div class="ghost-settings-card" id="ghost_backup_settings_card" style="display: none;">
                    <div style="margin-bottom: 10px;">
                        <div style="font-size: 12px; color: #ccc;">备份详细设置</div>
                    </div>

                    <div class="ghost-toggle-group">
                        <label class="ghost-toggle-row" for="ghost_backup_download">
                            <span class="ghost-toggle-label">下载到本地</span>
                            <div class="ghost-toggle-switch">
                                <input type="checkbox" id="ghost_backup_download" checked>
                                <span class="ghost-toggle-slider"></span>
                            </div>
                        </label>
                        <label class="ghost-toggle-row" for="ghost_backup_email">
                            <span class="ghost-toggle-label">发送到邮箱</span>
                            <div class="ghost-toggle-switch">
                                <input type="checkbox" id="ghost_backup_email">
                                <span class="ghost-toggle-slider"></span>
                            </div>
                        </label>
                    </div>

                    <!-- 备份格式 -->
                    <div style="margin-top: 8px; margin-bottom: 8px;">
                        <label style="color: #aaa; font-size: 12px; margin-bottom: 3px; display: block;">备份格式</label>
                        <select id="ghost_backup_format" class="ghost-select" style="font-size: 12px; padding: 4px 8px; width: 100%;">
                            <option value="both">PNG + JSON (推荐)</option>
                            <option value="png">仅 PNG</option>
                            <option value="json">仅 JSON</option>
                        </select>
                    </div>

                    <!-- 邮箱 SMTP 配置（折叠） -->
                    <div id="ghost_backup_email_config" style="display: none;">
                        <div style="margin-bottom: 6px;">
                            <label style="color: #aaa; font-size: 11px;">邮箱服务商</label>
                            <select id="ghost_backup_smtp_provider" class="ghost-select" style="font-size: 11px; padding: 4px 6px; width: 100%;">
                                <option value="qq">QQ 邮箱</option>
                                <option value="gmail">Gmail</option>
                                <option value="163">163 邮箱</option>
                                <option value="outlook">Outlook / Hotmail</option>
                                <option value="custom">自定义</option>
                            </select>
                        </div>

                        <div id="ghost_backup_smtp_custom_fields" style="display: none; margin-bottom: 6px;">
                            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 6px; margin-bottom: 6px;">
                                <div>
                                    <label style="color: #aaa; font-size: 11px;">SMTP 服务器</label>
                                    <input id="ghost_backup_smtp_host" type="text" placeholder="smtp.example.com" class="ghost-input" style="font-size: 11px; padding: 4px 6px;">
                                </div>
                                <div>
                                    <label style="color: #aaa; font-size: 11px;">端口</label>
                                    <input id="ghost_backup_smtp_port" type="number" value="465" class="ghost-input" style="font-size: 11px; padding: 4px 6px;">
                                </div>
                            </div>
                            <div class="ghost-toggle-group">
                                <label class="ghost-toggle-row" for="ghost_backup_smtp_secure" style="padding: 4px 0;">
                                    <span class="ghost-toggle-label" style="font-size: 11px;">使用 SSL 加密</span>
                                    <div class="ghost-toggle-switch">
                                        <input type="checkbox" id="ghost_backup_smtp_secure" checked>
                                        <span class="ghost-toggle-slider"></span>
                                    </div>
                                </label>
                            </div>
                        </div>
                        <div id="ghost_backup_smtp_help" style="margin-bottom: 6px;">
                            <a id="ghost_backup_smtp_help_link" href="#" target="_blank" rel="noopener noreferrer"
                               style="font-size: 10px; color: #7b9fdb; text-decoration: none; display: inline-block;">
                                📖 如何获取授权码？点击查看教程
                            </a>
                        </div>
                        <div style="font-size: 10px; color: #666; margin-bottom: 6px;">
                            💡 密码请使用邮箱的「授权码」而非登录密码
                        </div>

                        <div style="margin-bottom: 6px;">
                            <label style="color: #aaa; font-size: 11px;">发件邮箱</label>
                            <input id="ghost_backup_smtp_user" type="text" placeholder="your@qq.com" class="ghost-input" style="font-size: 11px; padding: 4px 6px;">
                        </div>

                        <div style="margin-bottom: 6px;">
                            <label style="color: #aaa; font-size: 11px;">授权码/密码</label>
                            <input id="ghost_backup_smtp_pass" type="password" placeholder="邮箱授权码" class="ghost-input" style="font-size: 11px; padding: 4px 6px;">
                        </div>

                        <div style="margin-bottom: 8px;">
                            <label style="color: #aaa; font-size: 11px;">收件邮箱</label>
                            <input id="ghost_backup_smtp_to" type="text" placeholder="backup@example.com" class="ghost-input" style="font-size: 11px; padding: 4px 6px;">
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                            <button id="ghost_backup_save" class="ghost-button" style="font-size: 12px; min-height: 26px; padding: 4px 6px;">
                                保存邮箱配置
                            </button>
                            <button id="ghost_backup_test_email" class="ghost-button" style="font-size: 12px; min-height: 26px; padding: 4px 6px;">
                                发送测试邮件
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 状态信息 -->
            <div class="ghost-status-card">
                <div class="ghost-status-info">
                    <div>Token数: <span id="the_ghost_face_control_panel_message_count">0</span></div>
                    <div>可见消息数: <span id="the_ghost_face_control_panel_msg_counter">0</span></div>
                    <div>当前状态: <span id="the_ghost_face_control_panel_status_text">自动尾随中</span></div>
                </div>
            </div>

            <!-- Mini Chat Section -->
            <div class="ghost-chat-section">
                <button id="the_ghost_face_chat_toggle" class="ghost-button ghost-chat-toggle">
                    和鬼面媎对话
                </button>
                <div id="the_ghost_face_chat_area" class="ghost-chat-area" style="display: none;">
                    <div id="the_ghost_face_chat_messages" class="ghost-chat-messages">
                        <div class="ghost-chat-welcome">来吧宝贝，有什么是媎可以帮忙的？</div>
                    </div>
                    <div class="ghost-chat-input-bar">
                        <input id="the_ghost_face_chat_input" type="text" class="ghost-input ghost-chat-input"
                            placeholder="输入指令或问题..." />
                        <button id="the_ghost_face_chat_send" class="ghost-button ghost-primary ghost-chat-send-btn">
                            发送
                        </button>
                    </div>
                </div>
            </div>

            <!-- 日志区域 -->
            <div class="ghost-log-section">
                <div class="ghost-log-header">
                    <span class="ghost-log-title">受害者的详细行程</span>
                    <button id="the_ghost_face_control_panel_clear_log" class="ghost-button ghost-primary">清空</button>
                </div>
                <div id="the_ghost_face_progress" class="ghost-progress-section" style="display: none;">
                    <div class="ghost-progress-track">
                        <div id="the_ghost_face_progress_fill" class="ghost-progress-fill" style="width: 0%"></div>
                    </div>
                    <div id="the_ghost_face_progress_text" class="ghost-progress-text">准备中...</div>
                </div>

                <!-- Login/Register Modal -->
                <div id="ghost_auth_modal" class="ghost-modal-backdrop">
                    <div class="ghost-modal-container">
                        <div class="ghost-modal-header">
                            <div class="ghost-modal-title">账号登录</div>
                            <button id="ghost_auth_close" class="ghost-modal-close">×</button>
                        </div>

                        <div class="ghost-auth-tabs">
                            <button class="ghost-auth-tab active" data-tab="login">登录</button>
                            <button class="ghost-auth-tab" data-tab="register">注册</button>
                        </div>

                        <div id="ghost_auth_error" class="ghost-error-message"></div>

                        <!-- Login Form -->
                        <div id="ghost_login_form" class="ghost-auth-form">
                            <div class="ghost-form-group" style="margin-bottom: 0;">
                                <label class="ghost-form-label">用户名</label>
                                <input type="text" id="ghost_login_username" class="ghost-input" placeholder="输入用户名">
                            </div>
                            <div class="ghost-form-group" style="margin-bottom: 0;">
                                <label class="ghost-form-label">密码</label>
                                <input type="password" id="ghost_login_password" class="ghost-input" placeholder="输入密码">
                            </div>
                        </div>

                        <!-- Register Form -->
                        <div id="ghost_register_form" class="ghost-auth-form" style="display: none;">
                            <div class="ghost-form-group" style="margin-bottom: 0;">
                                <label class="ghost-form-label">用户名 (ID)</label>
                                <input type="text" id="ghost_reg_username" class="ghost-input"
                                    placeholder="设置唯一ID (英文/数字)">
                            </div>
                            <div class="ghost-form-group" style="margin-bottom: 0;">
                                <label class="ghost-form-label">昵称 (显示名)</label>
                                <input type="text" id="ghost_reg_displayname" class="ghost-input" placeholder="别人看到的名称">
                            </div>
                            <div class="ghost-form-group" style="margin-bottom: 0;">
                                <label class="ghost-form-label">密码</label>
                                <input type="password" id="ghost_reg_password" class="ghost-input" placeholder="设置密码">
                            </div>
                        </div>

                        <div class="ghost-modal-footer">
                            <button id="ghost_auth_submit" class="ghost-button ghost-primary" style="width: 100%;">
                                登录
                            </button>
                        </div>
                    </div>
                </div>
                <div id="the_ghost_face_control_panel_log_content">
                </div>
            </div>
        </div>
    </div>
</div>
`;

// ui/momentsPanel.js — HTML template for the 朋友圈 full-screen overlay
export const momentsPanelTemplate = String.raw`
<div id="moments_overlay" class="moments-overlay">
    <div class="moments-container">

        <!-- ═══ Header Bar ═══ -->
        <div class="moments-header">
            <div class="moments-header-left">
                <span class="moments-title">朋友圈</span>
                <span class="moments-subtitle">Moments</span>
            </div>
            <div class="moments-header-right">

                <button id="moments_messages_btn" class="moments-icon-btn" title="消息">
                    <i class="fa-solid fa-bell"></i>
                </button>
                <button id="moments_settings_btn" class="moments-icon-btn" title="设置">
                    <i class="fa-solid fa-gear"></i>
                </button>
                <button id="moments_friends_btn" class="moments-icon-btn" title="好友">
                    <i class="fa-solid fa-user-group"></i>
                </button>
                <button id="moments_refresh_btn" class="moments-icon-btn" title="刷新">
                    <i class="fa-solid fa-rotate"></i>
                </button>
                <button id="moments_close_btn" class="moments-icon-btn moments-close-btn" title="关闭">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>

        <!-- ═══ Settings Panel (collapsible) ═══ -->
        <div id="moments_settings_panel" class="moments-settings-panel" style="display:none;">
            <div class="moments-settings-card">
                <div class="moments-settings-title">⚙️ 连接设置</div>
                <div id="moments_auth_container" class="moments-auth-container">
                    <!-- Dynamic Content: Login Form OR User Profile -->
                </div>
                <div class="moments-setting-row">
                    <label>后端地址 (Backend URL)</label>
                    <input id="moments_backend_url" type="text" class="moments-input"
                           placeholder="https://your-server.com:3421" />
                </div>
                <div class="moments-setting-row">
                    <label>密钥 (Secret Token)</label>
                    <input id="moments_secret_token" type="password" class="moments-input"
                           placeholder="your-secret-token" />
                </div>
                <div class="moments-setting-row">
                    <label>你的ID（复制给好友）</label>
                    <div class="moments-id-row">
                        <input id="moments_user_id" type="text" class="moments-input moments-id-input" readonly />
                        <button id="moments_copy_id_btn" class="moments-small-btn" title="复制">
                            <i class="fa-solid fa-copy"></i>
                        </button>
                    </div>
                </div>

                <div class="moments-settings-title" style="margin-top:16px;">网名设置</div>
                <div class="moments-setting-row">
                    <label>你的网名</label>
                    <input id="moments_custom_user_name" type="text" class="moments-input"
                           placeholder="留空则显示用户名" />
                </div>
                <div class="moments-setting-row">
                    <label>当前角色网名</label>
                    <input id="moments_custom_char_name" type="text" class="moments-input"
                           placeholder="留空则显示角色原名" />
                </div>

                <div class="moments-settings-title" style="margin-top:16px;">自动化设置</div>
                <div class="moments-setting-row">
                    <label>发帖概率</label>
                    <div class="moments-slider-row">
                        <input id="moments_auto_post_chance" type="range" min="0" max="100" step="5"
                               class="moments-slider" />
                        <span id="moments_auto_post_chance_val" class="moments-slider-val">80%</span>
                    </div>
                </div>
                <div class="moments-setting-row">
                    <label>评论概率</label>
                    <div class="moments-slider-row">
                        <input id="moments_auto_comment_chance" type="range" min="0" max="100" step="5"
                               class="moments-slider" />
                        <span id="moments_auto_comment_chance_val" class="moments-slider-val">30%</span>
                    </div>
                </div>
                <div class="moments-setting-row">
                    <label>点赞概率</label>
                    <div class="moments-slider-row">
                        <input id="moments_auto_like_chance" type="range" min="0" max="100" step="5"
                               class="moments-slider" />
                        <span id="moments_auto_like_chance_val" class="moments-slider-val">80%</span>
                    </div>
                </div>

                <div class="moments-settings-actions">
                    <button id="moments_save_settings_btn" class="moments-btn moments-btn-primary">
                        保存设置
                    </button>
                    <button id="moments_toggle_enable_btn" class="moments-btn moments-btn-toggle">
                        启用朋友圈
                    </button>
                </div>
            </div>
        </div>

        <!-- ═══ Friends Panel (collapsible) ═══ -->
        <div id="moments_friends_panel" class="moments-friends-panel" style="display:none;">
            <div class="moments-settings-card">
                <div class="moments-settings-title">好友管理</div>
                <div class="moments-setting-row">
                    <label>添加好友 (输入对方ID)</label>
                    <div class="moments-id-row">
                        <input id="moments_add_friend_id" type="text" class="moments-input"
                               placeholder="好友的UUID" />
                        <button id="moments_add_friend_btn" class="moments-small-btn moments-btn-primary" title="添加">
                            <i class="fa-solid fa-plus"></i>
                        </button>
                    </div>
                </div>
                <div id="moments_friends_list" class="moments-friends-list">
                    <div class="moments-empty-state">暂无好友，输入对方ID添加</div>
                </div>
            </div>
        </div>

        <!-- ═══ Messages Panel (hidden by default) ═══ -->
        <div id="moments_messages_panel" class="moments-settings-panel" style="display:none; position:absolute; top:50px; left:0; right:0; bottom:0; padding:10px; background:var(--SmartThemeBlurTintColor); backdrop-filter:blur(var(--SmartThemeBlurStrength, 20px)); z-index:100; overflow-y:auto; box-sizing:border-box;">
            <div class="moments-settings-card" style="min-height:90%;">
                <div class="moments-settings-title" style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center;">
                        <button id="moments_messages_back_btn" class="moments-icon-btn" title="返回" style="margin-right:10px;"><i class="fa-solid fa-arrow-left"></i></button>
                        <span>消息通知</span>
                    </div>
                    <button id="moments_messages_clear_btn" class="moments-small-btn" style="opacity:0.7;">清空</button>
                </div>
                <div id="moments_messages_list" style="margin-top: 15px;">
                    <!-- Messages will be rendered here -->
                </div>
            </div>
        </div>

        <!-- ═══ Scrollable Content Area ═══ -->
        <div class="moments-content-scrollable">
            <!-- ═══ Compose Area ═══ -->
            <div class="moments-compose">
                <div class="moments-compose-avatar">
                    <img id="moments_compose_avatar_img" src="" style="display:none; width: 100%; height: 100%; object-fit: cover; border-radius: 5px;" />
                    <i id="moments_compose_avatar_placeholder" class="fa-solid fa-user"></i>
                </div>
                <div class="moments-compose-content-wrapper" style="flex: 1;">
                    <div class="moments-compose-input-wrapper">
                        <textarea id="moments_compose_text" class="moments-compose-input"
                                   placeholder="写点什么..." rows="2"></textarea>
                    </div>
                    
                    <div class="moments-compose-actions" style="margin-top: 8px; display: flex; justify-content: flex-end; align-items: center;">
                        <button id="moments_post_btn" class="moments-btn moments-btn-primary moments-post-btn">
                            发布
                        </button>
                    </div>
                </div>
            </div>

            <!-- ═══ Unread Banner Container ═══ -->
            <div id="moments_unread_banner_container"></div>

            <!-- ═══ Feed ═══ -->
            <div id="moments_feed" class="moments-feed">
                <div class="moments-empty-state">
                    <div class="moments-empty-icon">📱</div>
                    <div>还没有动态</div>
                    <div class="moments-empty-hint">配置后端连接并启用朋友圈开始使用</div>
                </div>
            </div>
        </div>

    </div>
</div>
`;

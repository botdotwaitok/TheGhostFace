// ui/momentsPanel.js — HTML template for the 朋友圈 full-screen overlay
export const momentsPanelTemplate = String.raw`
<div id="moments_overlay" class="moments-overlay">
    <div class="moments-container">

        <!-- ═══ Header Bar ═══ -->
        <div class="moments-header">
            <div class="moments-header-left">
                <button id="moments_back_btn" class="moments-icon-btn moments-back-btn" title="返回手机">
                    <i class="fa-solid fa-chevron-left"></i>
                    <span>返回</span>
                </button>
            </div>
            <div class="moments-header-right">

                <button id="moments_camera_btn" class="moments-icon-btn" title="发动态">
                    <i class="fa-solid fa-camera"></i>
                </button>

                <button id="moments_messages_btn" class="moments-icon-btn" title="消息">
                    <i class="fa-solid fa-bell"></i>
                </button>

                <button id="moments_refresh_btn" class="moments-icon-btn" title="刷新">
                    <i class="fa-solid fa-rotate"></i>
                </button>
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

            <!-- ═══ Cover Area ═══ -->
            <div class="moments-cover-container">
                <div class="moments-cover-image" id="moments_cover_image" title="点击更换背景图"></div>
                <input type="file" id="moments_cover_upload" accept="image/*" style="display:none;" />
                <div class="moments-user-info-section">
                    <span class="moments-user-nickname" id="moments_user_nickname"></span>
                    <div class="moments-user-avatar">
                        <img id="moments_user_avatar_img_cover" src="" style="display:none;" />
                        <i id="moments_user_avatar_placeholder_cover" class="fa-solid fa-user"></i>
                    </div>
                </div>
            </div>

            <!-- ═══ Compose Area ═══ -->
            <div id="moments_compose_section" class="moments-compose" style="display: none;">
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
                    <div class="moments-empty-icon"><i class="ph ph-device-mobile"></i></div>
                    <div>还没有动态</div>
                    <div class="moments-empty-hint">配置后端连接并启用朋友圈开始使用</div>
                </div>
            </div>

            <!-- ═══ Profile Page (hidden by default) ═══ -->
            <div id="moments_profile_page" class="moments-profile-page" style="display:none;">
                <!-- Dynamically populated by momentsUI.js openProfilePage() -->
            </div>
        </div>

    </div>
</div>
`;

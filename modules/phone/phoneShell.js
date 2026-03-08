// ui/phone/phoneShell.js — HTML template for the GF Phone overlay
// Mimics an iPhone home screen with app icons and status bar.

export const phonePanelTemplate = String.raw`
<div id="phone_overlay" class="phone-overlay">
    <div class="phone-container">

        <!-- ═══ Wallpaper ═══ -->
        <div class="phone-wallpaper"></div>

        <!-- ═══ Notification Banner (iOS-style drop-down) ═══ -->
        <div class="phone-notification-banner" id="phone_notification_banner"></div>

        <!-- ═══ Status Bar ═══ -->
        <div class="phone-status-bar">
            <div class="phone-status-left">
                <span class="phone-status-time" id="phone_status_time">3:43</span>
                <i class="fa-solid fa-bell-slash phone-status-silent"></i>
            </div>
            <div class="phone-status-right">
                <div class="phone-signal-icon">
                    <div class="signal-bar full"></div>
                    <div class="signal-bar full"></div>
                    <div class="signal-bar empty"></div>
                    <div class="signal-bar empty"></div>
                </div>
                <i class="fa-solid fa-wifi phone-wifi-icon"></i>
                <div class="phone-battery-icon">
                    <span class="phone-battery-percentage">97</span>
                </div>
            </div>
        </div>

        <!-- ═══ Home Screen ═══ -->
        <div class="phone-home-screen" id="phone_home_screen">

            <!-- ═══ Widgets ═══ -->
            <div class="phone-widgets">
                <div class="phone-widget-container">
                    <div class="phone-widget weather-widget">
                        <div>
                            <div class="weather-location">The Fog</div>
                            <div class="weather-temp">33&deg;</div>
                        </div>
                        <div class="weather-footer">
                            <i class="fa-solid fa-cloud-sun weather-icon"></i>
                            <div class="weather-desc">Partly Cloudy<br>H:34&deg; L:26&deg;</div>
                        </div>
                    </div>
                    <div class="phone-widget-label">Weather</div>
                </div>
                
                <div class="phone-widget-container">
                    <div class="phone-widget calendar-widget">
                        <div>
                            <div class="calendar-day-name">TUESDAY</div>
                            <div class="calendar-date-number">11</div>
                        </div>
                        <div class="calendar-events">No events today</div>
                    </div>
                    <div class="phone-widget-label">Calendar</div>
                </div>
            </div>

            <!-- App Grid (populated dynamically) -->
            <div class="phone-app-grid" id="phone_app_grid">
                <!-- Apps will be injected here by phoneController -->
            </div>

        </div>


        <!-- ═══ App Viewport (for in-phone app rendering — reserved for future) ═══ -->
        <div class="phone-app-viewport" id="phone_app_viewport">
            <div class="phone-app-viewport-header">
                <button class="phone-app-back-btn" id="phone_app_back_btn" style="min-width: 60px;">
                    <i class="fa-solid fa-chevron-left"></i>
                    <span>返回</span>
                </button>
                <div class="phone-app-viewport-title" id="phone_app_viewport_title"></div>
                <div id="phone_app_viewport_actions" style="min-width: 60px; display: flex; justify-content: flex-end; align-items: center;"></div>
            </div>
            <div class="phone-app-viewport-body" id="phone_app_viewport_body">
            </div>
        </div>

    </div>
</div>
`;

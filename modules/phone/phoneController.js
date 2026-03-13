// ui/phone/phoneController.js — Lifecycle controller for the GF Phone
// Manages opening/closing the phone, registering apps, and rendering the home screen.

import { phonePanelTemplate } from './phoneShell.js';
import { escapeHtml } from './utils/helpers.js';
import { openMomentsPanel } from './moments/momentsUI.js';
import { showToast } from './moments/momentsUI.js';
import { getUnreadNotifications, getFeedCache } from './moments/moments.js';
import { openSettingsApp, applySavedAppearance } from './settings/settingsApp.js';
import { openFriendsApp } from './friends/friendsApp.js';
import { openDiaryApp } from './diary/diaryApp.js';
import { openChatApp } from './chat/chatApp.js';
import { openShopApp } from './shop/shopApp.js';

import { openTarotApp } from './tarot/tarotApp.js';
import { openTreeApp } from './tree/treeApp.js';
import { openConsoleApp, isConsoleEnabled } from './console/consoleApp.js';
import { openCalendarApp } from './calendar/calendarApp.js';

// ─── State ───
let phoneMounted = false;
const registeredApps = [];   // { id, name, icon, color, glow, onOpen, badge?, comingSoon?, dock? }

// ─── CSS Injection ───
(function loadPhoneStyles() {
    const scriptUrl = import.meta.url;
    const baseDir = scriptUrl.substring(0, scriptUrl.lastIndexOf('/'));
    // Phone shell CSS
    if (!document.getElementById('gf-phone-styles')) {
        const link = document.createElement('link');
        link.id = 'gf-phone-styles';
        link.rel = 'stylesheet';
        link.href = `${baseDir}/phone.css`;
        document.head.appendChild(link);
    }
    // Diary CSS
    if (!document.getElementById('gf-diary-styles')) {
        const link2 = document.createElement('link');
        link2.id = 'gf-diary-styles';
        link2.rel = 'stylesheet';
        link2.href = `${baseDir}/diary/diary.css`;
        document.head.appendChild(link2);
    }
    // Diary Themes CSS
    if (!document.getElementById('gf-diary-themes-styles')) {
        const link2b = document.createElement('link');
        link2b.id = 'gf-diary-themes-styles';
        link2b.rel = 'stylesheet';
        link2b.href = `${baseDir}/diary/diaryThemes.css`;
        document.head.appendChild(link2b);
    }
    // Chat CSS
    if (!document.getElementById('gf-chat-styles')) {
        const link3 = document.createElement('link');
        link3.id = 'gf-chat-styles';
        link3.rel = 'stylesheet';
        link3.href = `${baseDir}/chat/chat.css`;
        document.head.appendChild(link3);
    }
    // Shop CSS
    if (!document.getElementById('gf-shop-styles')) {
        const link4 = document.createElement('link');
        link4.id = 'gf-shop-styles';
        link4.rel = 'stylesheet';
        link4.href = `${baseDir}/shop/shop.css`;
        document.head.appendChild(link4);
    }

    // Tarot CSS
    if (!document.getElementById('gf-tarot-styles')) {
        const link6 = document.createElement('link');
        link6.id = 'gf-tarot-styles';
        link6.rel = 'stylesheet';
        link6.href = `${baseDir}/tarot/tarot.css`;
        document.head.appendChild(link6);
    }

    // Tree CSS
    if (!document.getElementById('gf-tree-styles')) {
        const link7 = document.createElement('link');
        link7.id = 'gf-tree-styles';
        link7.rel = 'stylesheet';
        link7.href = `${baseDir}/tree/tree.css`;
        document.head.appendChild(link7);
    }
    // Console CSS
    if (!document.getElementById('gf-console-styles')) {
        const link8 = document.createElement('link');
        link8.id = 'gf-console-styles';
        link8.rel = 'stylesheet';
        link8.href = `${baseDir}/console/console.css`;
        document.head.appendChild(link8);
    }
    // Calendar CSS
    if (!document.getElementById('gf-calendar-styles')) {
        const link9 = document.createElement('link');
        link9.id = 'gf-calendar-styles';
        link9.rel = 'stylesheet';
        link9.href = `${baseDir}/calendar/calendar.css`;
        document.head.appendChild(link9);
    }
})();

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Register an app to appear on the phone home screen.
 * @param {Object} config
 * @param {string} config.id          — unique identifier
 * @param {string} config.name        — display name (Chinese OK)
 * @param {string} config.icon        — FontAwesome class, e.g. 'fa-solid fa-camera-retro'
 * @param {string} config.color       — background gradient/color for the icon
 * @param {string} [config.glow]      — optional glow color on hover
 * @param {Function} [config.onOpen]  — callback when user taps the app
 * @param {number} [config.badge]     — optional notification badge count
 * @param {boolean} [config.comingSoon] — if true, show lock overlay
 * @param {boolean} [config.dock]     — if true, also show in dock
 */
export function registerApp(config) {
    // Avoid duplicates
    if (registeredApps.find(a => a.id === config.id)) return;
    registeredApps.push(config);
    // If already mounted, re-render
    if (phoneMounted) renderApps();
}

/** Open the phone overlay */
export function openPhone() {
    if (!phoneMounted) mountPhone();

    updateStatusBar();
    updateGreeting();
    renderApps();
    applySavedAppearance();

    // Hide floating icon while phone is open
    const floatingIcon = document.getElementById('phone_floating_icon');
    if (floatingIcon) floatingIcon.style.setProperty('display', 'none', 'important');

    const overlay = document.getElementById('phone_overlay');
    if (overlay) {
        requestAnimationFrame(() => overlay.classList.add('phone-visible'));
    }
}

/** Close the phone overlay */
export function closePhone() {
    const overlay = document.getElementById('phone_overlay');
    if (overlay) overlay.classList.remove('phone-visible');

    // Show floating icon again after phone closes
    const floatingIcon = document.getElementById('phone_floating_icon');
    if (floatingIcon) floatingIcon.style.setProperty('display', 'flex', 'important');
}

/** Update a specific app's badge count */
export function updateAppBadge(appId, count) {
    const app = registeredApps.find(a => a.id === appId);
    if (app) {
        app.badge = count;
        if (phoneMounted) renderApps();
    }
}

/**
 * Initialize the phone module — register all built-in apps.
 * Call this once during plugin startup.
 */
export function initPhone() {
    // ── 朋友圈 (Moments) ──
    registerApp({
        id: 'moments',
        name: '朋友圈',
        icon: 'fa-solid fa-camera',
        color: '#fd5949', // Instagram-like vibrant gradient (now flat)
        glow: 'rgba(214, 36, 159, 0.4)',
        dock: false,
        onOpen: () => {
            // Close phone first, then open moments overlay (full-screen)
            closePhone();
            setTimeout(() => {
                openMomentsPanel();
                // Re-hide the floating icon — closePhone() showed it, but Moments is still "in phone"
                const floatingIcon = document.getElementById('phone_floating_icon');
                if (floatingIcon) floatingIcon.style.setProperty('display', 'none', 'important');
            }, 150);
        },
    });

    // ── 好友 (Friends) ──
    registerApp({
        id: 'friends',
        name: '好友',
        icon: 'fa-solid fa-user-group',
        color: '#5ec1fa', // iOS Mail/Contacts blue (now flat)
        glow: 'rgba(21, 123, 245, 0.4)',
        dock: false,
        onOpen: () => openFriendsApp(),
    });

    // ── 商城 (Shop) ──
    registerApp({
        id: 'shop',
        name: '商城',
        icon: 'fa-solid fa-store',
        color: '#ffe05f', // iOS Yellow (now flat)
        glow: 'rgba(251, 190, 8, 0.4)',
        onOpen: () => openShopApp(),
    });



    // ── 日记本 (Diary) ──
    registerApp({
        id: 'diary',
        name: '日记本',
        icon: 'fa-solid fa-book',
        color: '#ff7e5f', // Warm pink/orange (now flat)
        glow: 'rgba(246, 56, 100, 0.4)',
        onOpen: () => openDiaryApp(),
    });

    // ── 聊天 (Chat) ──
    registerApp({
        id: 'chat',
        name: '聊天',
        icon: 'fa-solid fa-comment', // using comment for bubble
        color: '#65d552', // iOS iMessage vibrant green (now flat)
        glow: 'rgba(59, 193, 52, 0.4)',
        onOpen: () => openChatApp(),
    });

    // ── 设置 (Settings) ──
    registerApp({
        id: 'settings',
        name: '设置',
        icon: 'fa-solid fa-gear',
        color: '#a3a3a8', // iOS Settings metallic grey (now flat)
        glow: 'rgba(131, 131, 136, 0.4)',
        onOpen: () => openSettingsApp(),
    });

    // ── 占卜 (Tarot) ──
    registerApp({
        id: 'tarot',
        name: '占卜',
        icon: 'fa-solid fa-hat-wizard',
        color: '#7c3aed',
        glow: 'rgba(124, 58, 237, 0.4)',
        onOpen: () => openTarotApp(),
    });

    // ── 树树 (Tree) ──
    registerApp({
        id: 'tree',
        name: '树树',
        icon: 'fa-solid fa-tree',
        color: '#2d936c',
        glow: 'rgba(45, 147, 108, 0.4)',
        onOpen: () => openTreeApp(),
    });

    // ── 日历 (Calendar) ──
    registerApp({
        id: 'calendar',
        name: '日历',
        icon: 'fa-solid fa-calendar-days',
        color: '#ff6b6b',
        glow: 'rgba(255, 107, 107, 0.4)',
        onOpen: () => openCalendarApp(),
    });

    // ── Console (调试) — always visible, but requires enable in Settings to function ──
    registerApp({
        id: 'console',
        name: 'Console',
        icon: 'fa-solid fa-terminal',
        color: '#1e1e1e',
        glow: 'rgba(0, 210, 255, 0.3)',
        onOpen: () => openConsoleApp(),
    });

    // ── Notification Bridge — sync moments notifications to phone UI ──
    _initNotificationBridge();
}

// ═══════════════════════════════════════════════════════════════════════
// Internal — Mount & Render
// ═══════════════════════════════════════════════════════════════════════

function mountPhone() {
    if (phoneMounted) return;
    document.body.insertAdjacentHTML('beforeend', phonePanelTemplate);
    phoneMounted = true;

    // Close the phone by tapping the time indicator
    const timeEl = document.getElementById('phone_status_time');
    if (timeEl) {
        timeEl.title = "关闭手机";
        timeEl.addEventListener('click', closePhone);
    }

    // Back button in app viewport (for future in-phone apps)
    document.getElementById('phone_app_back_btn')?.addEventListener('click', () => {
        // Allow the current app to intercept the back action (e.g., closing an internal overlay)
        const event = new CustomEvent('phone-app-back', { cancelable: true });
        const canGoBack = window.dispatchEvent(event);
        
        if (canGoBack) {
            const viewport = document.getElementById('phone_app_viewport');
            if (viewport) viewport.classList.remove('app-active');
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════
// In-Phone App Viewport (shared by sub-apps)
// ═══════════════════════════════════════════════════════════════════════

export function openAppInViewport(title, htmlContent, afterMount, actionsHtml = '') {
    const viewport = document.getElementById('phone_app_viewport');
    const body = document.getElementById('phone_app_viewport_body');
    const titleEl = document.getElementById('phone_app_viewport_title');
    const actionsEl = document.getElementById('phone_app_viewport_actions');
    if (!viewport || !body) return;

    if (titleEl) titleEl.innerHTML = title; // using innerHTML to support custom layout (e.g. Chat UI)
    if (actionsEl) actionsEl.innerHTML = actionsHtml;
    
    body.innerHTML = htmlContent;
    viewport.classList.add('app-active');

    if (typeof afterMount === 'function') {
        requestAnimationFrame(() => afterMount());
    }
}

function renderApps() {
    const grid = document.getElementById('phone_app_grid');
    if (!grid) return;

    grid.innerHTML = registeredApps.map(app => renderAppIcon(app)).join('');

    // Bind click events
    document.querySelectorAll('.phone-app-item[data-app-id]').forEach(el => {
        el.addEventListener('click', () => {
            const appId = el.dataset.appId;
            const app = registeredApps.find(a => a.id === appId);
            if (!app) return;

            if (app.comingSoon) {
                showPhoneToast('即将上线，敬请期待 🚀');
                return;
            }

            if (typeof app.onOpen === 'function') {
                app.onOpen();
            }
        });
    });
}

function renderAppIcon(app) {
    const badgeHtml = (app.badge && app.badge > 0)
        ? `<span class="phone-app-badge">${app.badge > 99 ? '99+' : app.badge}</span>`
        : '';

    const comingSoonClass = app.comingSoon ? 'coming-soon' : '';
    const glowStyle = app.glow ? `--app-glow: ${app.glow};` : '';

    return `
        <div class="phone-app-item" data-app-id="${app.id}">
            <div class="phone-app-icon ${comingSoonClass}"
                 style="background: ${app.color}; ${glowStyle}">
                <i class="${app.icon}"></i>
                ${badgeHtml}
            </div>
            <span class="phone-app-name">${escapeHtml(app.name)}</span>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════════════════
// Internal — Status Bar & Greeting
// ═══════════════════════════════════════════════════════════════════════

function updateStatusBar() {
    const timeEl = document.getElementById('phone_status_time');
    if (timeEl) {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        timeEl.textContent = `${hh}:${mm}`;
    }
}

function updateGreeting() {
    // Deprecated for iOS 18 Widgets UI
}

// ═══════════════════════════════════════════════════════════════════════
// Floating Phone Icon (replaces moments floating bubble)
// ═══════════════════════════════════════════════════════════════════════

export function renderPhoneFloatingIcon(show = true) {
    // Remove old moments floating icon if present
    const oldIcon = document.getElementById('moments_floating_icon');
    if (oldIcon) oldIcon.style.setProperty('display', 'none', 'important');

    let icon = document.getElementById('phone_floating_icon');

    if (!icon) {
        icon = document.createElement('div');
        icon.id = 'phone_floating_icon';
        icon.className = 'phone-floating-icon';
        icon.title = '打开手机';
        icon.innerHTML = `
            <i class="fa-solid fa-mobile-screen-button"></i>
            <span id="phone_floating_badge" class="phone-floating-badge" style="display:none;"></span>
        `;
        document.body.appendChild(icon);

        // ── Drag Logic (similar to moments bubble) ──
        let isDragging = false;
        let hasMoved = false;
        let startX, startY, initialLeft, initialTop;

        const onPointerDown = (e) => {
            if (e.target.closest('.phone-floating-badge')) return;
            isDragging = true;
            hasMoved = false;
            if (e.type === 'touchstart') {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
            } else {
                startX = e.clientX;
                startY = e.clientY;
                e.preventDefault();
            }
            const rect = icon.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            document.addEventListener('mousemove', onPointerMove, { passive: false });
            document.addEventListener('touchmove', onPointerMove, { passive: false });
            document.addEventListener('mouseup', onPointerUp);
            document.addEventListener('touchend', onPointerUp);
        };

        const onPointerMove = (e) => {
            if (!isDragging) return;
            let cx, cy;
            if (e.type === 'touchmove') { cx = e.touches[0].clientX; cy = e.touches[0].clientY; }
            else { cx = e.clientX; cy = e.clientY; e.preventDefault(); }
            const dx = cx - startX, dy = cy - startY;
            if (!hasMoved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) hasMoved = true;
            if (hasMoved) {
                if (e.cancelable) e.preventDefault();
                let nl = Math.max(0, Math.min(initialLeft + dx, window.innerWidth - icon.offsetWidth));
                let nt = Math.max(0, Math.min(initialTop + dy, window.innerHeight - icon.offsetHeight));
                icon.style.left = `${nl}px`;
                icon.style.top = `${nt}px`;
                icon.style.right = 'auto';
                icon.style.bottom = 'auto';
                icon.style.transform = 'none';
            }
        };

        const onPointerUp = () => {
            isDragging = false;
            document.removeEventListener('mousemove', onPointerMove);
            document.removeEventListener('touchmove', onPointerMove);
            document.removeEventListener('mouseup', onPointerUp);
            document.removeEventListener('touchend', onPointerUp);
            if (hasMoved) setTimeout(() => hasMoved = false, 50);
        };

        icon.addEventListener('mousedown', onPointerDown);
        icon.addEventListener('touchstart', onPointerDown, { passive: false });

        icon.addEventListener('click', (e) => {
            if (hasMoved) { e.preventDefault(); e.stopPropagation(); return; }
            openPhone();
        });
    }

    if (show) {
        icon.style.setProperty('display', 'flex', 'important');
    } else {
        icon.style.setProperty('display', 'none', 'important');
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

// escapeHtml is now imported from './utils/helpers.js'

function showPhoneToast(msg) {
    // Try to use toastr if available, otherwise console
    if (typeof toastr !== 'undefined' && toastr.info) {
        toastr.info(msg);
    } else {
        console.log('[GF Phone]', msg);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Notification Bridge — 朋友圈通知 → 手机 UI
// ═══════════════════════════════════════════════════════════════════════

let _lastNotifCount = 0; // Track to detect NEW notifications
let _notifDismissTimer = null;
let _knownPendingPostIds = new Set(); // Track known pending posts to detect new ones

function _initNotificationBridge() {
    // Sync badge on initial load
    _updateFloatingBadge();

    // Seed known pending posts so initial load doesn't spam banners
    _seedKnownPendingPosts();

    // Listen for all notification changes (comments/replies)
    window.addEventListener('moments-notifications-updated', (e) => {
        const unread = getUnreadNotifications();
        const newCount = unread.length;

        // Update floating icon badge
        _updateFloatingBadge();

        // Show banner only for genuinely NEW notifications (count increased)
        if (newCount > _lastNotifCount && unread.length > 0) {
            const latest = unread[0]; // Most recent notification
            _showNotificationBanner(latest);
        }

        _lastNotifCount = newCount;
    });

    // Listen for feed updates to detect new pending (draft) posts from the character
    window.addEventListener('moments-feed-updated', (e) => {
        const posts = e.detail?.posts;
        if (!Array.isArray(posts)) return;

        const pendingPosts = posts.filter(p => p.pendingUpload);
        for (const post of pendingPosts) {
            if (!_knownPendingPostIds.has(post.id)) {
                _knownPendingPostIds.add(post.id);
                // New pending post detected — show banner!
                _showPendingPostBanner(post);
                break; // Only show one banner at a time
            }
        }
    });
}

/**
 * Update the floating phone icon's red badge with unread count.
 */
function _updateFloatingBadge() {
    const badge = document.getElementById('phone_floating_badge');
    if (!badge) return;

    const unread = getUnreadNotifications();
    if (unread.length > 0) {
        badge.textContent = unread.length > 99 ? '99+' : unread.length;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

/**
 * Show an iOS-style notification banner at the top of the phone.
 * Auto-dismisses after 3.5 seconds. Clicking opens Moments.
 */
function _showNotificationBanner(notification) {
    const container = document.getElementById('phone_notification_banner');
    if (!container) return;

    // Clear any existing banner
    if (_notifDismissTimer) {
        clearTimeout(_notifDismissTimer);
        _notifDismissTimer = null;
    }

    const actionText = notification.type === 'reply' ? '回复了你' : '评论了你的动态';
    const authorName = escapeHtml(notification.authorName || '某人');
    const contentPreview = escapeHtml(
        (notification.content || '').substring(0, 50)
    );
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    container.innerHTML = `
        <div class="phone-notif-toast" id="phone_notif_toast">
            <div class="phone-notif-icon">
                <i class="fa-solid fa-camera"></i>
            </div>
            <div class="phone-notif-body">
                <div class="phone-notif-app">朋友圈</div>
                <div class="phone-notif-title">${authorName} ${actionText}</div>
                <div class="phone-notif-text">${contentPreview}</div>
            </div>
            <div class="phone-notif-time">${timeStr}</div>
        </div>
    `;

    const toast = document.getElementById('phone_notif_toast');
    if (!toast) return;

    // Slide in
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toast.classList.add('notif-visible');
        });
    });

    // Click → dismiss and open moments
    toast.addEventListener('click', () => {
        _dismissNotificationBanner();
        // Close phone, then open moments
        closePhone();
        setTimeout(() => {
            openMomentsPanel();
            // Re-hide floating icon while moments is open
            const floatingIcon = document.getElementById('phone_floating_icon');
            if (floatingIcon) floatingIcon.style.setProperty('display', 'none', 'important');
        }, 150);
    });

    // Auto-dismiss after 3.5s
    _notifDismissTimer = setTimeout(() => {
        _dismissNotificationBanner();
    }, 3500);
}

function _dismissNotificationBanner() {
    const toast = document.getElementById('phone_notif_toast');
    if (!toast) return;

    toast.classList.remove('notif-visible');
    toast.classList.add('notif-exit');

    setTimeout(() => {
        const container = document.getElementById('phone_notification_banner');
        if (container) container.innerHTML = '';
    }, 350);

    if (_notifDismissTimer) {
        clearTimeout(_notifDismissTimer);
        _notifDismissTimer = null;
    }
}

/**
 * Seed known pending post IDs from current feed cache,
 * so that posts already present on init don't trigger false banners.
 */
function _seedKnownPendingPosts() {
    try {
        const posts = getFeedCache();
        if (Array.isArray(posts)) {
            posts.filter(p => p.pendingUpload).forEach(p => _knownPendingPostIds.add(p.id));
        }
    } catch { /* feed may not be loaded yet, that's OK */ }
}

/**
 * Show a notification banner for a character's auto-generated pending post.
 */
function _showPendingPostBanner(post) {
    const container = document.getElementById('phone_notification_banner');
    if (!container) return;

    // Clear any existing banner
    if (_notifDismissTimer) {
        clearTimeout(_notifDismissTimer);
        _notifDismissTimer = null;
    }

    const authorName = escapeHtml(post.authorName || '角色');
    const contentPreview = escapeHtml(
        (post.content || '').substring(0, 50)
    );
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    container.innerHTML = `
        <div class="phone-notif-toast" id="phone_notif_toast">
            <div class="phone-notif-icon">
                <i class="fa-solid fa-camera"></i>
            </div>
            <div class="phone-notif-body">
                <div class="phone-notif-app">朋友圈</div>
                <div class="phone-notif-title">📸 ${authorName} 发布了一条新动态</div>
                <div class="phone-notif-text">${contentPreview}</div>
            </div>
            <div class="phone-notif-time">${timeStr}</div>
        </div>
    `;

    const toast = document.getElementById('phone_notif_toast');
    if (!toast) return;

    // Slide in
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toast.classList.add('notif-visible');
        });
    });

    // Click → dismiss and open moments
    toast.addEventListener('click', () => {
        _dismissNotificationBanner();
        closePhone();
        setTimeout(() => {
            openMomentsPanel();
            const floatingIcon = document.getElementById('phone_floating_icon');
            if (floatingIcon) floatingIcon.style.setProperty('display', 'none', 'important');
        }, 150);
    });

    // Auto-dismiss after 4s (slightly longer for post previews)
    _notifDismissTimer = setTimeout(() => {
        _dismissNotificationBanner();
    }, 4000);
}

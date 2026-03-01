// ui/momentsUI.js — UI controller for the 朋友圈 (Moments) panel
// Handles rendering, event binding, and DOM interactions.

import { momentsPanelTemplate } from './momentsPanel.js';
import * as moments from '../../modules/moments/moments.js';

// Load moments-specific CSS
(function loadMomentsStyles() {
    if (document.getElementById('moments-module-styles')) return;
    const link = document.createElement('link');
    link.id = 'moments-module-styles';
    link.rel = 'stylesheet';
    // Derive path relative to this module
    const scriptUrl = import.meta.url;
    const baseDir = scriptUrl.substring(0, scriptUrl.lastIndexOf('/'));
    link.href = `${baseDir}/moments.css`;
    document.head.appendChild(link);
})();

let panelMounted = false;
let currentPage = 1;
const POSTS_PER_PAGE = 10;

// ═══════════════════════════════════════════════════════════════════════
// Panel Lifecycle
// ═══════════════════════════════════════════════════════════════════════

export function openMomentsPanel() {
    if (panelMounted) {
        document.getElementById('moments_overlay')?.classList.add('moments-visible');
        refreshFeedUI();
        return;
    }

    // Insert template into DOM
    document.body.insertAdjacentHTML('beforeend', momentsPanelTemplate);
    panelMounted = true;

    // Populate settings fields from stored values
    populateSettings();

    // Bind all event handlers
    bindEvents();

    // Show with animation
    requestAnimationFrame(() => {
        document.getElementById('moments_overlay')?.classList.add('moments-visible');
    });

    // Check login status
    checkLoginStatus();

    // Load feed
    refreshFeedUI();
}

export function initMomentsUI() {
    const s = moments.getSettings();
    const floatBubbleCheckbox = document.getElementById('the_ghost_face_control_panel_show_float_bubble_checkbox');
    if (floatBubbleCheckbox) {
        floatBubbleCheckbox.checked = s.showFloatingIcon !== false;

        floatBubbleCheckbox.addEventListener('change', (e) => {
            moments.updateSettings({ showFloatingIcon: e.target.checked });
            renderFloatingIcon();
        });
    }

    renderFloatingIcon();
}

export function closeMomentsPanel() {
    const overlay = document.getElementById('moments_overlay');
    if (!overlay) return;
    overlay.classList.remove('moments-visible');
    // Don't remove from DOM — keep state for quick re-open
}

// ═══════════════════════════════════════════════════════════════════════
// Settings UI
// ═══════════════════════════════════════════════════════════════════════

function populateSettings() {
    const s = moments.getSettings();

    setVal('moments_backend_url', s.backendUrl || '');
    setVal('moments_secret_token', s.secretToken || '');
    setVal('moments_user_id', s.userId || '');
    setVal('moments_custom_user_name', s.customUserName || '');
    setVal('moments_custom_char_name', s.customCharName || '');

    setSlider('moments_auto_post_chance', Math.round(s.autoPostChance * 100));
    setSlider('moments_auto_comment_chance', Math.round(s.autoCommentChance * 100));
    setSlider('moments_auto_like_chance', Math.round((s.autoLikeChance ?? 0.8) * 100));

    updateToggleBtn(s.enabled);

    // Load avatar preview
    updateAvatarPreview(s.avatarUrl);
}

function saveSettingsFromUI() {
    const backendUrl = getVal('moments_backend_url');
    const secretToken = getVal('moments_secret_token');
    const customUserName = getVal('moments_custom_user_name');
    const customCharName = getVal('moments_custom_char_name');

    // We only need to save the other fields here.
    const autoPostChance = parseInt(getVal('moments_auto_post_chance')) / 100;
    const autoCommentChance = parseInt(getVal('moments_auto_comment_chance')) / 100;
    const autoLikeChance = parseInt(getVal('moments_auto_like_chance')) / 100;

    moments.updateSettings({
        backendUrl,
        secretToken,
        customUserName,
        customCharName,
        autoPostChance,
        autoCommentChance,
        autoLikeChance,
    });

    // Sync displayName / avatarUrl changes to the DB
    if (moments.getSettings().enabled && moments.getSettings().backendUrl) {
        moments.registerUser().catch(e => console.warn('Failed to sync user profile:', e));
    }

    showToast('设置已保存 ✅');
}

function toggleEnable() {
    const s = moments.getSettings();
    const newState = !s.enabled;
    moments.updateSettings({ enabled: newState });
    updateToggleBtn(newState);

    if (newState) {
        moments.registerUser().catch(e => console.warn('Register failed:', e));
        moments.startSync();
        showToast('朋友圈已启用 🎉');
    } else {
        moments.stopSync();
        showToast('朋友圈已停用');
    }

    // Update World Info state based on new enabled status
    moments.updateMomentsWorldInfo();
}

function updateToggleBtn(enabled) {
    const btn = document.getElementById('moments_toggle_enable_btn');
    if (!btn) return;
    btn.textContent = enabled ? '已启用 - 点击停用' : '启用朋友圈';
    btn.classList.toggle('moments-btn-enabled', enabled);
}

export function renderFloatingIcon() {
    let icon = document.getElementById('moments_floating_icon');
    const s = moments.getSettings();

    if (!icon) {
        icon = document.createElement('div');
        icon.id = 'moments_floating_icon';
        icon.className = 'moments-floating-icon';
        icon.title = '打开朋友圈';
        icon.innerHTML = '<span id="moments_floating_unread_badge" class="moments-floating-badge" style="display:none; z-index: 11;"></span>';

        document.body.appendChild(icon);

        // Restore saved position if available
        if (s.floatingIconLeft !== undefined && s.floatingIconTop !== undefined) {
            let rLeft = parseInt(s.floatingIconLeft);
            let rTop = parseInt(s.floatingIconTop);
            const iconSize = window.innerWidth <= 768 ? 70 : 80;

            // Constrain restored coordinates so it never spawns off-screen
            rLeft = Math.max(0, Math.min(rLeft || 0, window.innerWidth - iconSize));
            rTop = Math.max(0, Math.min(rTop || 0, window.innerHeight - iconSize));

            icon.style.setProperty('left', `${rLeft}px`);
            icon.style.setProperty('top', `${rTop}px`);
            icon.style.setProperty('right', 'auto');
            icon.style.setProperty('bottom', 'auto');
            icon.style.setProperty('transform', 'none');
        }

        // --- Drag Logic ---
        let isDragging = false;
        let hasMoved = false;
        let startX, startY;
        let initialLeft, initialTop;

        const onPointerDown = (e) => {
            if (e.target.closest('.moments-floating-badge')) return; // ignore if clicking badge
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

            let currentX, currentY;
            if (e.type === 'touchmove') {
                currentX = e.touches[0].clientX;
                currentY = e.touches[0].clientY;
            } else {
                currentX = e.clientX;
                currentY = e.clientY;
                e.preventDefault();
            }

            const dx = currentX - startX;
            const dy = currentY - startY;

            // Threshold to start moving
            if (!hasMoved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
                hasMoved = true;
            }

            if (hasMoved) {
                if (e.cancelable) e.preventDefault(); // prevent scrolling

                let newLeft = initialLeft + dx;
                let newTop = initialTop + dy;

                // Keep within screen bounds
                newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - icon.offsetWidth));
                newTop = Math.max(0, Math.min(newTop, window.innerHeight - icon.offsetHeight));

                icon.style.setProperty('left', `${newLeft}px`);
                icon.style.setProperty('top', `${newTop}px`);
                icon.style.setProperty('right', 'auto');
                icon.style.setProperty('bottom', 'auto');
                icon.style.setProperty('transform', 'none');
            }
        };

        const onPointerUp = (e) => {
            isDragging = false;
            document.removeEventListener('mousemove', onPointerMove);
            document.removeEventListener('touchmove', onPointerMove);
            document.removeEventListener('mouseup', onPointerUp);
            document.removeEventListener('touchend', onPointerUp);

            if (hasMoved) {
                // Prevent immediate click event
                setTimeout(() => hasMoved = false, 50);
                // Save to settings
                moments.updateSettings({
                    floatingIconLeft: icon.style.left,
                    floatingIconTop: icon.style.top
                });
            }
        };

        icon.addEventListener('mousedown', onPointerDown);
        icon.addEventListener('touchstart', onPointerDown, { passive: false });

        icon.addEventListener('click', (e) => {
            if (hasMoved) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            openMomentsPanel();
        });
    }

    if (s.showFloatingIcon === false) {
        icon.style.setProperty('display', 'none', 'important');
    } else {
        icon.style.setProperty('display', 'flex', 'important');
        updateFloatingUnreadBadge();
    }
}

function updateFloatingUnreadBadge() {
    const badge = document.getElementById('moments_floating_unread_badge');
    if (!badge) return;

    const unreadCount = moments.getUnreadNotifications().length;
    if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Friends UI
// ═══════════════════════════════════════════════════════════════════════

async function loadFriendsUI() {
    const listEl = document.getElementById('moments_friends_list');
    if (!listEl) return;

    try {
        const result = await moments.listFriends();
        if (!result.ok || result.friends.length === 0) {
            listEl.innerHTML = '<div class="moments-empty-state">暂无好友</div>';
            return;
        }

        listEl.innerHTML = result.friends.map(f => `
            <div class="moments-friend-item" data-friend-id="${f.id}">
                <div class="moments-friend-avatar">
                    ${f.avatarUrl ? `<img src="${f.avatarUrl}" />` : '<i class="fa-solid fa-user"></i>'}
                </div>
                <div class="moments-friend-info">
                    <div class="moments-friend-name">${escapeHtml(f.displayName)}</div>
                    <div class="moments-friend-id">${f.id.substring(0, 8)}...</div>
                </div>
                <button class="moments-friend-remove moments-small-btn" data-remove-id="${f.id}" title="删除好友">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `).join('');

        // Bind remove buttons
        listEl.querySelectorAll('.moments-friend-remove').forEach(btn => {
            btn.addEventListener('click', async () => {
                const fid = btn.dataset.removeId;
                if (confirm(`确定删除好友?`)) {
                    try {
                        await moments.removeFriend(fid);
                        showToast('好友已删除');
                        loadFriendsUI();
                    } catch (e) {
                        showToast('删除失败: ' + e.message);
                    }
                }
            });
        });
    } catch (e) {
        listEl.innerHTML = `<div class="moments-empty-state">加载失败: ${e.message}</div>`;
    }
}

async function addFriendFromUI() {
    const input = document.getElementById('moments_add_friend_id');
    const friendId = input?.value?.trim();
    if (!friendId) return showToast('请输入好友ID');

    try {
        await moments.addFriend(friendId);
        input.value = '';
        showToast('好友已添加 🎉');
        loadFriendsUI();
    } catch (e) {
        showToast('添加失败: ' + e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Feed Rendering
// ═══════════════════════════════════════════════════════════════════════

export async function refreshFeedUI(force = false) {
    currentPage = 1; // Reset to page 1 on implicit/explicit refresh
    // Always render from local cache first — works even without backend
    renderFeed(moments.getFeedCache());
    renderUnreadBanner();

    // Then try to sync from backend if it is configured and enabled
    const s = moments.getSettings();
    if (s.enabled && s.backendUrl && s.secretToken) {
        try {
            await moments.syncFeed(force);
            renderFeed(moments.getFeedCache());
            renderUnreadBanner();
        } catch (e) {
            console.warn('[MomentsUI] sync failed:', e);
        }
    }
}

export function getUIDisplayName(originalName) {
    if (!originalName) return originalName;
    const s = moments.getSettings();
    const charInfo = moments.getCharacterInfo();
    const realCharName = charInfo ? charInfo.name : null;
    const realUserName = moments.getUserName();

    if (s.customCharName && realCharName && originalName === realCharName) {
        return s.customCharName;
    }
    // For user, it could be their ST name or their GhostFace displayName
    if (s.customUserName && (originalName === realUserName || originalName === s.displayName)) {
        return s.customUserName;
    }
    return originalName;
}

function renderFeed(posts) {
    const feedEl = document.getElementById('moments_feed');
    if (!feedEl) return;

    if (!posts || posts.length === 0) {
        feedEl.innerHTML = `
            <div class="moments-empty-state">
                <div class="moments-empty-icon">🥺</div>
                <div>还没有动态</div>
                <div class="moments-empty-hint">现在这里啥也没有！不如去打黎明杀机！</div>
            </div>
        `;
        return;
    }

    const paginatedPosts = posts.slice(0, currentPage * POSTS_PER_PAGE);

    feedEl.innerHTML = paginatedPosts.map(post => renderPostCard(post)).join('');

    if (posts.length > currentPage * POSTS_PER_PAGE) {
        feedEl.innerHTML += `
            <div style="text-align:center; padding: 15px 0 100px 0;">
                <button id="moments_load_more_btn" class="moments-btn moments-btn-primary">下一页 (Load More)</button>
            </div>
        `;

        // Use timeout to ensure button is in DOM before appending event listener, 
        // normally we would do document delegation or bind after innerHTML insertion. 
        setTimeout(() => {
            const loadMoreBtn = document.getElementById('moments_load_more_btn');
            if (loadMoreBtn) {
                loadMoreBtn.addEventListener('click', () => {
                    currentPage++;
                    renderFeed(posts);
                });
            }
        }, 0);
    }

    // Bind post interaction events
    feedEl.querySelectorAll('.moments-like-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const postId = btn.dataset.postId;
            try {
                const result = await moments.toggleLike(postId);
                btn.classList.toggle('moments-liked', result.liked);
                const countEl = btn.querySelector('.moments-like-count');
                if (countEl) {
                    let count = parseInt(countEl.textContent) || 0;
                    count += result.liked ? 1 : -1;
                    countEl.textContent = count > 0 ? count : '';
                }
            } catch (e) { console.warn('Like failed:', e); }
        });
    });

    feedEl.querySelectorAll('.moments-comment-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const postId = btn.dataset.postId;
            const section = feedEl.querySelector(`.moments-comment-section[data-post-id="${postId}"]`);
            if (section) {
                section.style.display = section.style.display === 'none' ? 'block' : 'none';
                if (section.style.display === 'block') loadCommentsForPost(postId);
            }
        });
    });

    feedEl.querySelectorAll('.moments-comment-send').forEach(btn => {
        btn.addEventListener('click', async () => {
            const postId = btn.dataset.postId;
            const input = feedEl.querySelector(`.moments-comment-input[data-post-id="${postId}"]`);
            const text = input?.value?.trim();
            if (!text) return;

            const replyToId = input.dataset.replyToId || null;
            const replyToName = input.dataset.replyToName || null;

            try {
                const s = moments.getSettings();
                await moments.addComment(postId, text, s.customUserName || s.displayName, replyToId, replyToName, s.avatarUrl);
                input.value = '';
                // Clear the cache since it was successfully sent
                localStorage.removeItem(`moments_draft_comment_${postId}`);
                // clear reply state
                delete input.dataset.replyToId;
                delete input.dataset.replyToName;
                input.placeholder = '写评论...';

                loadCommentsForPost(postId);
                showToast('评论已发送');
            } catch (e) {
                showToast('评论失败: ' + e.message);
            }
        });
    });



    // Bind delete button
    feedEl.querySelectorAll('.moments-post-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            const postId = btn.dataset.postId;
            if (confirm('确定要删除这条动态吗?')) {
                try {
                    await moments.deletePost(postId);
                    showToast('已删除 ✅');
                } catch (e) {
                    showToast('删除失败: ' + e.message);
                }
            }
        });
    });

    // Bind publish button
    feedEl.querySelectorAll('.moments-post-publish').forEach(btn => {
        btn.addEventListener('click', async () => {
            const postId = btn.dataset.postId;
            const btnEl = btn;
            const originalIcon = btnEl.innerHTML;
            btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; // Spinner
            btnEl.disabled = true;

            try {
                await moments.publishPost(postId);
                showToast('发布成功! ✅');
            } catch (e) {
                showToast('发布失败: ' + e.message);
                btnEl.innerHTML = originalIcon;
                btnEl.disabled = false;
            }
        });
    });
}

function parseMediaTags(text) {
    if (!text) return '';

    // Define icons for each media type
    const mediaTypes = {
        '图片': { icon: 'fa-image', class: 'media-image' },
        '视频': { icon: 'fa-video', class: 'media-video' },
        '音乐': { icon: 'fa-music', class: 'media-music' },
        '新闻': { icon: 'fa-newspaper', class: 'media-news' }
    };

    let parsedText = text;

    for (const [tag, props] of Object.entries(mediaTypes)) {
        const regex = new RegExp(`&lt;${tag}&gt;([\\s\\S]*?)&lt;\\/${tag}&gt;`, 'gi');
        parsedText = parsedText.replace(regex, (match, content) => {
            return `
                <div class="moments-media-card ${props.class}">
                    <div class="moments-media-icon"><i class="fa-solid ${props.icon}"></i></div>
                    <div class="moments-media-content">${content}</div>
                </div>
            `;
        });
    }

    return parsedText;
}

function renderPostCard(post) {
    const timeStr = formatTime(post.createdAt);

    const avatarContent = getAvatarHtml(post.authorId, post.authorName, post.authorAvatar, 40);

    // Show delete button if it's my post or a draft
    const s = moments.getSettings();
    const isMyPost = post.authorId === s.userId;
    const canDelete = isMyPost || post.pendingUpload;
    const deleteBtn = canDelete
        ? `<button class="moments-post-delete" data-post-id="${post.id}" title="删除"><i class="fa-solid fa-trash"></i></button>`
        : '';

    // Show publish button if it's a draft
    const publishBtn = post.pendingUpload
        ? `<button class="moments-post-publish" data-post-id="${post.id}" title="发布到云端"><i class="fa-solid fa-paper-plane"></i></button>`
        : '';

    const draftBadge = post.pendingUpload
        ? `<span class="moments-post-badge draft" style="background:var(--smart-theme-color, #daa520);color:#fff;padding:2px 6px;border-radius:4px;font-size:0.8em;margin-left:8px;">待发布</span>`
        : '';

    return `
        <div class="moments-post-card ${post.pendingUpload ? 'moments-post-draft' : ''}" data-post-id="${post.id}">
            <div class="moments-post-avatar">${avatarContent}</div>
            <div class="moments-post-body">
                <div class="moments-post-header">
                    <span class="moments-post-author">
                        ${escapeHtml(getUIDisplayName(post.authorName) || 'Anonymous')}
                        ${post.authorUsername ? `<span class="moments-post-username" style="opacity:0.7;font-size:0.9em;margin-left:4px;">(@${escapeHtml(post.authorUsername)})</span>` : ''}
                    </span>
                    ${draftBadge}
                </div>
                <div class="moments-post-content">
                    ${parseMediaTags(escapeHtml(post.content))}
                    ${post.imageUrl ? `<div class="moments-post-image"><img src="${post.imageUrl}" onclick="window.open(this.src, '_blank')" /></div>` : ''}
                </div>
                <div class="moments-post-footer">
                    <span class="moments-post-time">${timeStr}</span>
                    <div class="moments-post-actions">
                        ${publishBtn}
                        ${deleteBtn}
                        <button class="moments-like-btn ${post.likedByMe ? 'moments-liked' : ''}"
                                data-post-id="${post.id}">
                            <i class="fa-${post.likedByMe ? 'solid' : 'regular'} fa-heart"></i>
                            <span class="moments-like-count">${post.likeCount || ''}</span>
                        </button>
                        <button class="moments-comment-toggle" data-post-id="${post.id}">
                            <i class="fa-regular fa-comment"></i>
                            <span>${post.commentCount || ''}</span>
                        </button>
                    </div>
                </div>
                <div class="moments-comment-section" data-post-id="${post.id}" style="display:none;">
                    <div class="moments-comments-list" data-post-id="${post.id}"></div>
                    <div class="moments-comment-compose">
                        <input class="moments-comment-input moments-input" data-post-id="${post.id}"
                               placeholder="写评论..." value="${escapeHtml(localStorage.getItem('moments_draft_comment_' + post.id) || '')}" />
                        <button class="moments-comment-send moments-small-btn" data-post-id="${post.id}">
                            <i class="fa-solid fa-paper-plane"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function loadCommentsForPost(postId) {
    const listEl = document.querySelector(`.moments-comments-list[data-post-id="${postId}"]`);
    if (!listEl) return;

    let displayComments = [];

    // Try backend first
    if (moments.getSettings().backendUrl && moments.getSettings().secretToken) {
        try {
            const result = await moments.getComments(postId);
            if (result.ok && result.comments.length > 0) {
                displayComments = result.comments;
            }
        } catch (e) {
            // Backend unavailable — fall through to local
        }
    }

    if (displayComments.length === 0) {
        // Fall back to locally-stored comments in feedCache
        const feed = moments.getFeedCache();
        const localPost = feed.find(p => p.id === postId);
        displayComments = localPost?.comments || [];
    }

    if (displayComments.length === 0) {
        listEl.innerHTML = '<div class="moments-no-comments">暂无评论</div>';
        return;
    }

    const s = moments.getSettings();
    const feed = moments.getFeedCache();
    const parentPost = feed.find(p => p.id === postId);
    const amIPostOwner = parentPost && parentPost.authorId === s.userId;

    listEl.innerHTML = displayComments.map(c => {
        const replyToUIDisplay = c.replyToName ? getUIDisplayName(c.replyToName) : '';
        const authorUIDisplay = getUIDisplayName(c.authorName);
        const replyPrefix = replyToUIDisplay ? `回复 <b>${escapeHtml(replyToUIDisplay)}</b>: ` : '';
        // User can delete if they own the comment or if they own the post. And my user ID is s.userId, but there might be missing conditions on how characters comment. Actually, characters commenting locally typically use `guest` or my user ID, but the original JS doesn't have a distinct ID for my character except maybe `s.displayName`. Let's check:
        // By default comments from my character might use guest/userId if local. Let's allow deletion if comment `authorId` matches my `s.userId` OR my `s.displayName` (when it's locally generated main LLM).
        const amICommentOwner = c.authorId === s.userId || c.authorName === s.displayName;
        const canDelete = amIPostOwner || amICommentOwner;
        const deleteBtn = canDelete ? `<button class="moments-comment-delete" data-comment-id="${c.id}" title="删除评论" style="background: none; border: none; font-size: 11px; cursor: pointer; color: var(--SmartThemeEmColor); margin-left: auto; opacity: 0.6;"><i class="fa-solid fa-trash"></i></button>` : '';

        return `
            <div class="moments-comment-item" data-comment-id="${c.id}" data-author-name="${escapeHtml(c.authorName)}" data-author-id="${c.authorId}" style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                    <span class="moments-comment-author">
                        ${escapeHtml(authorUIDisplay)}
                        ${c.authorUsername ? `<span class="moments-comment-username" style="opacity:0.7;font-size:0.9em;margin-left:4px;">(@${escapeHtml(c.authorUsername)})</span>` : ''}
                    </span>
                    <span class="moments-comment-text">${replyPrefix}${parseMediaTags(escapeHtml(c.content))}</span>
                </div>
                ${deleteBtn}
            </div>
        `;
    }).join('');

    // Bind click to reply (only trigger reply if not clicking delete)
    listEl.querySelectorAll('.moments-comment-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.moments-comment-delete')) return; // Ignore clicks on delete button
            const input = document.querySelector(`.moments-comment-input[data-post-id="${postId}"]`);
            if (input) {
                const authorName = item.dataset.authorName;
                const commentId = item.dataset.commentId;
                const authorUIDisplay = getUIDisplayName(authorName);
                input.dataset.replyToId = commentId;
                input.dataset.replyToName = authorName; // Keep original
                input.placeholder = `回复 ${authorUIDisplay}...`;
                input.focus();
            }
        });
    });

    // Bind delete comment
    listEl.querySelectorAll('.moments-comment-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation(); // prevent reply triggered
            const commentId = btn.dataset.commentId;
            if (confirm('确定删除该评论吗?')) {
                try {
                    await moments.deleteComment(postId, commentId);
                    showToast('评论已删除');
                    loadCommentsForPost(postId); // Refresh comment list
                } catch (e) {
                    showToast('删除评论失败: ' + e.message);
                }
            }
        });
    });

    // Allow cancelling reply by clicking input when empty
    const parentInput = document.querySelector(`.moments-comment-input[data-post-id="${postId}"]`);
    if (parentInput) {
        parentInput.addEventListener('click', () => {
            if (parentInput.value.trim() === '' && parentInput.dataset.replyToId) {
                delete parentInput.dataset.replyToId;
                delete parentInput.dataset.replyToName;
                parentInput.placeholder = '写评论...';
            }
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Compose / Manual Post
// ═══════════════════════════════════════════════════════════════════════

async function manualPost() {
    const textarea = document.getElementById('moments_compose_text');
    const text = textarea?.value?.trim();

    if (!text) return showToast('请输入内容');

    try {
        const s = moments.getSettings();
        // createPost will handle image upload if needed
        await moments.createPost(text, s.customUserName || s.displayName, s.avatarUrl, null);
        textarea.value = '';
        localStorage.removeItem('moments_draft_post');
        showToast('已发布 ✅');
        refreshFeedUI();
    } catch (e) {
        showToast('发布失败: ' + e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Event Binding
// ═══════════════════════════════════════════════════════════════════════

function bindEvents() {
    // Restore compose text from cache
    const composeTextarea = document.getElementById('moments_compose_text');
    if (composeTextarea) {
        const cachedPost = localStorage.getItem('moments_draft_post');
        if (cachedPost) composeTextarea.value = cachedPost;

        composeTextarea.addEventListener('input', (e) => {
            localStorage.setItem('moments_draft_post', e.target.value);
        });
    }

    // Bind event delegation for comment inputs to save drafts
    const feedContainer = document.getElementById('moments_feed');
    if (feedContainer) {
        feedContainer.addEventListener('input', (e) => {
            if (e.target.classList.contains('moments-comment-input')) {
                const postId = e.target.dataset.postId;
                if (postId) {
                    localStorage.setItem(`moments_draft_comment_${postId}`, e.target.value);
                }
            }
        });
    }

    // Close
    onClick('moments_close_btn', closeMomentsPanel);

    // Settings toggle
    onClick('moments_settings_btn', () => {
        togglePanel('moments_settings_panel');
        hidePanel('moments_friends_panel');
        hidePanel('moments_messages_panel');
    });

    // Messages toggle (Bell button)
    onClick('moments_messages_btn', () => {
        togglePanel('moments_messages_panel');
        hidePanel('moments_settings_panel');
        hidePanel('moments_friends_panel');
        if (document.getElementById('moments_messages_panel')?.style.display !== 'none') {
            renderMessagesPage();
        }
    });

    // Friends toggle
    onClick('moments_friends_btn', () => {
        togglePanel('moments_friends_panel');
        hidePanel('moments_settings_panel');
        hidePanel('moments_messages_panel');
        loadFriendsUI();
    });

    // Messages Page Back
    onClick('moments_messages_back_btn', () => {
        hidePanel('moments_messages_panel');
    });

    // Messages Page Clear
    onClick('moments_messages_clear_btn', () => {
        if (confirm('确定清空所有消息记录吗？')) {
            moments.clearNotifications();
            renderMessagesPage();
            renderUnreadBanner();
        }
    });

    // Refresh
    onClick('moments_refresh_btn', () => {
        const btn = document.getElementById('moments_refresh_btn');
        btn?.querySelector('i')?.classList.add('fa-spin');
        refreshFeedUI(true).finally(() => {
            setTimeout(() => btn?.querySelector('i')?.classList.remove('fa-spin'), 500);
        });
    });

    // Save settings
    onClick('moments_save_settings_btn', saveSettingsFromUI);

    // Toggle enable
    onClick('moments_toggle_enable_btn', toggleEnable);

    // Copy ID
    onClick('moments_copy_id_btn', () => {
        const id = getVal('moments_user_id');
        navigator.clipboard?.writeText(id).then(() => showToast('ID已复制 📋'));
    });

    // Add friend
    onClick('moments_add_friend_btn', addFriendFromUI);

    // Post
    onClick('moments_post_btn', manualPost);

    // Slider value display
    bindSlider('moments_auto_post_chance', 'moments_auto_post_chance_val');
    bindSlider('moments_auto_comment_chance', 'moments_auto_comment_chance_val');
    bindSlider('moments_auto_like_chance', 'moments_auto_like_chance_val');

    // Close on overlay backdrop click
    document.getElementById('moments_overlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'moments_overlay') closeMomentsPanel();
    });

    // Listen for feed updates from sync engine
    window.addEventListener('moments-feed-updated', (e) => {
        const overlay = document.getElementById('moments_overlay');
        if (overlay?.classList.contains('moments-visible')) {
            // Save state of open comment sections, input texts, scroll position, and focus
            const feedEl = document.getElementById('moments_feed');
            const scrollContainer = document.querySelector('.moments-content-scrollable');
            const state = {};
            let scrollPos = 0;

            if (scrollContainer) scrollPos = scrollContainer.scrollTop;

            if (feedEl) {
                feedEl.querySelectorAll('.moments-comment-section').forEach(sec => {
                    const postId = sec.dataset.postId;
                    const input = sec.querySelector('.moments-comment-input');
                    const hasText = input && input.value.trim() !== '';
                    const isFocused = document.activeElement === input;
                    const isOpen = sec.style.display === 'block';

                    if (isOpen || hasText || isFocused) {
                        state[postId] = {
                            isOpen: isOpen,
                            text: input ? input.value : '',
                            replyToId: input ? input.dataset.replyToId : null,
                            replyToName: input ? input.dataset.replyToName : null,
                            placeholder: input ? input.placeholder : '',
                            isFocused: isFocused
                        };
                    }
                });
            }

            renderFeed(e.detail.posts);
            renderUnreadBanner();

            // Restore state
            if (feedEl) {
                Object.keys(state).forEach(postId => {
                    const s = state[postId];
                    const sec = feedEl.querySelector(`.moments-comment-section[data-post-id="${postId}"]`);
                    const input = feedEl.querySelector(`.moments-comment-input[data-post-id="${postId}"]`);

                    if (sec && s.isOpen) {
                        sec.style.display = 'block';
                        loadCommentsForPost(postId);
                    }
                    if (input) {
                        input.value = s.text;
                        if (s.replyToId) input.dataset.replyToId = s.replyToId;
                        if (s.replyToName) input.dataset.replyToName = s.replyToName;
                        if (s.placeholder) input.placeholder = s.placeholder;
                        if (s.isFocused) {
                            input.focus();
                            // Move cursor to end
                            const len = input.value.length;
                            input.setSelectionRange(len, len);
                        }
                    }
                });
            }

            if (scrollContainer) {
                // Restore scroll on next tick to allow DOM to settle
                setTimeout(() => {
                    scrollContainer.scrollTop = scrollPos;
                }, 0);
            }
        }
    });

    // Listen for notification updates
    window.addEventListener('moments-notifications-updated', (e) => {
        updateFloatingUnreadBadge();
        const overlay = document.getElementById('moments_overlay');
        if (overlay?.classList.contains('moments-visible')) {
            renderUnreadBanner();
        }
    });

    // Listen for sync stop events (e.g. circuit breaker)
    window.addEventListener('moments-sync-stopped', (e) => {
        const { reason } = e.detail;
        if (reason === 'connection_failure') {
            showToast('⚠️ 连接失败次数过多，已自动停止同步');
            // Update UI to reflect disabled state
            moments.updateSettings({ enabled: false });
            updateToggleBtn(false);
        }
    });

    // Ctrl+Enter to post
    document.getElementById('moments_compose_text')?.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            manualPost();
        }
    });

    // ── Auth Events ─────────────────────────────────────────────────────
}

// ═══════════════════════════════════════════════════════════════════════
// Messages Page (List view)
// ═══════════════════════════════════════════════════════════════════════

function renderMessagesPage() {
    const listEl = document.getElementById('moments_messages_list');
    if (!listEl) return;

    // Mark as read when entering page
    moments.markNotificationsRead();
    // Update banner immediately to hide red dot/banner
    renderUnreadBanner();

    const notifications = moments.getSettings().notifications || [];
    if (notifications.length === 0) {
        listEl.innerHTML = '<div class="moments-empty-state">暂无消息记录</div>';
        return;
    }

    listEl.innerHTML = notifications.map(n => {
        let actionText = n.type === 'reply' ? '回复了你' : '评论了你的动态';
        const avatarContent = getAvatarHtml(n.authorId, n.authorName, n.authorAvatar, 40);

        const timeString = new Date(n.createdAt).toLocaleString();

        return `
            <div class="moments-message-item" data-post-id="${n.postId}" style="display:flex; padding: 12px; border-bottom: 1px solid var(--SmartThemeBorderColor); cursor:pointer; align-items: flex-start; transition: background 0.2s;">
                <div class="moments-message-avatar" style="margin-right:12px; flex-shrink: 0;">
                    ${avatarContent}
                </div>
                <div class="moments-message-content" style="flex:1;">
                    <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                        <span style="font-weight:bold; color:var(--SmartThemeBodyText);">${escapeHtml(getUIDisplayName(n.authorName))}</span>
                        <span style="font-size:0.8em; opacity:0.6;">${timeString}</span>
                    </div>
                    <div style="font-size:0.9em; opacity:0.8; margin-bottom:4px;">${actionText}</div>
                    <div style="font-size:0.95em; word-break: break-all;">${escapeHtml(n.content)}</div>
                </div>
            </div>
        `;
    }).join('');

    // Bind clicks to go to post
    listEl.querySelectorAll('.moments-message-item').forEach(item => {
        item.addEventListener('click', () => {
            hidePanel('moments_messages_panel');
            const postId = item.dataset.postId;
            scrollToPost(postId);
        });

        // Hover effect inline since it's dynamic
        item.addEventListener('mouseenter', () => item.style.backgroundColor = 'var(--SmartThemeQuoteColor)');
        item.addEventListener('mouseleave', () => item.style.backgroundColor = '');
    });
}

function scrollToPost(postId) {
    const postEl = document.querySelector(`.moments-post-card[data-post-id="${postId}"]`);
    if (postEl) {
        const scrollContainer = document.querySelector('.moments-content-scrollable');
        if (scrollContainer) {
            const postRect = postEl.getBoundingClientRect();
            const containerRect = scrollContainer.getBoundingClientRect();
            scrollContainer.scrollTop += (postRect.top - containerRect.top) - (containerRect.height / 3);
        }

        // Flash animation
        postEl.style.transition = 'background-color 0.5s';
        postEl.style.backgroundColor = 'var(--SmartThemeQuoteColor, rgba(200, 200, 200, 0.2))';
        setTimeout(() => {
            postEl.style.backgroundColor = '';
            setTimeout(() => {
                postEl.style.transition = '';
            }, 500);
        }, 1500);
    } else {
        showToast('找不到该动态或已被删除');
    }
}
// ═══════════════════════════════════════════════════════════════════════
// Unread Banner
// ═══════════════════════════════════════════════════════════════════════

function renderUnreadBanner() {
    const bannerContainer = document.getElementById('moments_unread_banner_container');
    const bellBtn = document.getElementById('moments_messages_btn');

    const unread = moments.getUnreadNotifications() || [];

    // Handle the red dot on the bell icon
    if (bellBtn) {
        let dot = bellBtn.querySelector('.moments-red-dot');
        if (unread.length > 0) {
            if (!dot) {
                dot = document.createElement('div');
                dot.className = 'moments-red-dot';
                dot.style.position = 'absolute';
                dot.style.top = '4px';
                dot.style.right = '4px';
                dot.style.width = '8px';
                dot.style.height = '8px';
                dot.style.backgroundColor = 'var(--ghost-error, red)';
                dot.style.borderRadius = '50%';
                bellBtn.style.position = 'relative';
                bellBtn.appendChild(dot);
            }
        } else {
            if (dot) dot.remove();
        }
    }

    if (!bannerContainer) return;

    if (!unread || unread.length === 0) {
        bannerContainer.innerHTML = '';
        bannerContainer.style.display = 'none';
        return;
    }

    const latest = unread[0];
    const avatarContent = getAvatarHtml(latest.authorId, latest.authorName, latest.authorAvatar, 32);

    bannerContainer.style.display = 'block';


    bannerContainer.innerHTML = `
        <div class="moments-unread-banner" data-post-id="${latest.postId}" style="display: flex; align-items: center; justify-content: center; background: var(--Black4a); color: var(--White); padding: 8px 16px; margin: 10px auto 20px auto; border-radius: 10px; cursor: pointer; width: max-content; box-shadow: 0 2px 5px rgba(0,0,0,0.2); transition: background 0.2s;">
            <div class="moments-unread-avatar" style="margin-right: 10px; display: flex;">${avatarContent}</div>
            <div class="moments-unread-text" style="font-weight: bold;">${unread.length} 条新消息</div>
        </div>
    `;

    // Bind click event
    const banner = bannerContainer.querySelector('.moments-unread-banner');
    if (banner) {
        banner.addEventListener('click', () => {
            hidePanel('moments_settings_panel');
            hidePanel('moments_friends_panel');

            // To prevent grey screen issue (assuming the main panel is hidden or scrolling is weird), 
            // make sure we just show the new panel on top of the main feed.
            const panel = document.getElementById('moments_messages_panel');
            if (panel) {
                panel.style.display = 'block';
                panel.style.zIndex = '1000'; // Ensure it's above other elements
            }
            // Now call the function that was throwing the error
            try {
                renderMessagesPage();
            } catch (err) {
                console.error('Error rendering messages page:', err);
                showToast('无法加载消息列表');
            }
        });
    }
}
// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

async function checkLoginStatus() {
    await moments.getUserInfo(); // Verifies token validity
    updateProfileUI();
}

function updateProfileUI() {
    const container = document.getElementById('moments_auth_container');
    if (!container) return;

    const s = moments.getSettings();

    if (s.authToken) {
        // Logged In View
        container.innerHTML = `
            <div class="moments-profile-card">
                <div class="moments-profile-info">
                    <div class="moments-profile-avatar" id="moments_profile_avatar_wrapper" style="cursor: pointer; position: relative;" title="更换头像">
                        ${s.avatarUrl ? `<img src="${s.avatarUrl}" />` : '<div class="moments-avatar-placeholder" style="width:100%; height:100%;">' + (s.displayName || 'U')[0] + '</div>'}
                        <input type="file" id="moments_profile_avatar_input" accept="image/*" style="display:none;" />
                    </div>
                    <div class="moments-profile-text">
                        <div class="moments-profile-name" id="moments_profile_name_display" style="cursor: pointer;" title="修改名称">
                            ${escapeHtml(s.displayName || 'User')} <i class="fa-solid fa-pen-to-square" style="font-size: 0.8em; opacity: 0.6; margin-left: 4px;"></i>
                        </div>
                        <div class="moments-profile-id">@${s.username}</div>
                    </div>
                </div>
                <button id="moments_logout_btn" class="moments-small-btn" title="退出登录">
                    <i class="fa-solid fa-right-from-bracket"></i>
                </button>
            </div>
        `;

        // Bind Edit Name Event
        const nameEl = document.getElementById('moments_profile_name_display');
        if (nameEl) {
            nameEl.addEventListener('click', async () => {
                const currentName = s.displayName || '';
                const newName = prompt('请输入新的显示名称:', currentName);
                if (newName !== null && newName.trim() !== '' && newName.trim() !== currentName) {
                    const trimmedName = newName.trim();
                    moments.updateSettings({ displayName: trimmedName });

                    if (s.enabled && s.backendUrl) {
                        try {
                            await moments.registerUser();
                            showToast('名称已更新 ✅');
                            updateProfileUI(); // Re-render to show updated name
                        } catch (e) {
                            console.warn('Failed to sync new name:', e);
                            showToast('名称同步失败');
                        }
                    } else {
                        showToast('名称本地已更新（未连接服务器）');
                        updateProfileUI();
                    }
                }
            });
        }

        // Bind Avatar Upload Event
        const avatarWrapper = document.getElementById('moments_profile_avatar_wrapper');
        const avatarInput = document.getElementById('moments_profile_avatar_input');
        if (avatarWrapper && avatarInput) {
            avatarWrapper.addEventListener('click', (e) => {
                if (e.target !== avatarInput) {
                    avatarInput.click();
                }
            });

            avatarInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                if (file.size > 2 * 1024 * 1024) { // 2MB limit
                    showToast('头像图片太大 (最大 2MB)');
                    e.target.value = '';
                    return;
                }

                const reader = new FileReader();
                reader.onload = async (evt) => {
                    const base64 = evt.target.result;
                    moments.updateSettings({ avatarUrl: base64 });

                    if (s.enabled && s.backendUrl) {
                        try {
                            await moments.registerUser();
                            showToast('头像已同步更新 ✅');
                        } catch (e) {
                            console.warn('Failed to sync avatar:', e);
                            showToast('头像同步失败');
                        }
                    } else {
                        showToast('头像本地已更新（未连接服务器）');
                    }
                    updateProfileUI(); // Re-render to show new avatar instantly
                };
                reader.readAsDataURL(file);
            });
        }

        // Bind Logout
        document.getElementById('moments_logout_btn')?.addEventListener('click', () => {
            if (confirm('确定退出登录?')) {
                moments.logout();
                updateProfileUI(); // Re-render
                showToast('已退出登录');
            }
        });
    } else {
        // Not Logged In - Show Auth Form
        renderAuthForm(container, 'login');
    }
}

function renderAuthForm(container, mode = 'login') {
    const isLogin = mode === 'login';
    container.innerHTML = `
                <div class="moments-auth-switch">
            <button class="moments-auth-tab ${isLogin ? 'active' : ''}" data-mode="login">登录</button>
            <button class="moments-auth-tab ${!isLogin ? 'active' : ''}" data-mode="register">注册</button>
        </div>
                <div class="moments-auth-form">
                    ${!isLogin ? `
            <div class="moments-form-group">
                <input type="text" id="moments_auth_username" class="moments-input" placeholder="用户名 (ID)">
            </div>
            <div class="moments-form-group">
                <input type="text" id="moments_auth_displayname" class="moments-input" placeholder="显示名称">
            </div>
            ` : `
            <div class="moments-form-group">
                <input type="text" id="moments_auth_username" class="moments-input" placeholder="用户名">
            </div>
            `}
                    <div class="moments-form-group">
                        <input type="password" id="moments_auth_password" class="moments-input" placeholder="密码">
                    </div>
                    <div id="moments_auth_error" class="moments-error-msg"></div>
                    <button id="moments_auth_submit" class="moments-btn moments-btn-primary" style="width:100%">
                        ${isLogin ? '登录' : '注册'}
                    </button>
                </div>
            `;

    // Bind Tabs
    container.querySelectorAll('.moments-auth-tab').forEach(btn => {
        btn.addEventListener('click', () => renderAuthForm(container, btn.dataset.mode));
    });

    // Bind Submit
    document.getElementById('moments_auth_submit')?.addEventListener('click', async () => {
        const btn = document.getElementById('moments_auth_submit');
        const errEl = document.getElementById('moments_auth_error');
        const u = document.getElementById('moments_auth_username')?.value?.trim();
        const p = document.getElementById('moments_auth_password')?.value?.trim();
        const n = document.getElementById('moments_auth_displayname')?.value?.trim();

        if (errEl) errEl.textContent = '';
        if (!u || !p) return errEl.textContent = '请输入用户名和密码';
        if (!isLogin && !n) return errEl.textContent = '请输入显示名称';

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

        try {
            if (isLogin) {
                await moments.login(u, p);
                showToast('登录成功! 🎉');
            } else {
                if (!moments.getSettings().backendUrl) throw new Error('请先配置后端 URL');
                await moments.register(u, p, n);
                showToast('注册成功! 🎉');
            }
            updateProfileUI(); // Switch to profile view
            refreshFeedUI();
        } catch (e) {
            if (errEl) errEl.textContent = e.message;
            btn.disabled = false;
            btn.textContent = isLogin ? '登录' : '注册';
        }
    });
}

function onClick(id, handler) {
    document.getElementById(id)?.addEventListener('click', handler);
}

function togglePanel(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function hidePanel(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}

function getVal(id) {
    return document.getElementById(id)?.value || '';
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function setSlider(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
    const valEl = document.getElementById(id + '_val');
    if (valEl) valEl.textContent = val + '%';
}

function bindSlider(sliderId, valId) {
    const slider = document.getElementById(sliderId);
    const valEl = document.getElementById(valId);
    if (slider && valEl) {
        slider.addEventListener('input', () => {
            valEl.textContent = slider.value + '%';
        });
    }
}

function formatTime(isoStr) {
    try {
        const d = new Date(isoStr + 'Z'); // SQLite stores UTC without Z
        const now = new Date();
        const diffMs = now - d;
        const diffMin = Math.floor(diffMs / 60000);
        const diffHr = Math.floor(diffMs / 3600000);

        if (diffMin < 1) return '刚刚';
        if (diffMin < 60) return `${diffMin} 分钟前`;
        if (diffHr < 24) return `${diffHr} 小时前`;

        const month = d.getMonth() + 1;
        const day = d.getDate();
        const hour = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        return `${month}月${day}日 ${hour}:${min} `;
    } catch {
        return isoStr;
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function showToast(msg) {
    // Create a simple toast notification
    let container = document.getElementById('moments_toast_container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'moments_toast_container';
        container.className = 'moments-toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'moments-toast';
    toast.textContent = msg;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('moments-toast-show'));

    setTimeout(() => {
        toast.classList.remove('moments-toast-show');
        toast.classList.add('moments-toast-hide');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

function updateAvatarPreview(url) {
    const composeImg = document.getElementById('moments_compose_avatar_img');
    const composePlaceholder = document.getElementById('moments_compose_avatar_placeholder');

    if (url) {
        if (composeImg) {
            composeImg.src = url;
            composeImg.style.display = 'block';
        }
        if (composePlaceholder) composePlaceholder.style.display = 'none';
    } else {
        if (composeImg) {
            composeImg.src = '';
            composeImg.style.display = 'none';
        }
        if (composePlaceholder) {
            composePlaceholder.style.display = 'inline-block';
        }
    }
}
/**
 * Centralized helper to render an avatar (img or placeholder).
 * Handles:
 * 1. URL Resolution (character folder fallback)
 * 2. Cached Avatar loading (IndexedDB)
 * 3. Placeholder generation
 * 4. Async Profile fetching if avatar is missing
 */
export function getAvatarHtml(authorId, authorName, avatarSrc, sizePx = 40) {
    let finalSrc = avatarSrc;
    let isCached = false;
    let cacheId = '';

    if (finalSrc && finalSrc.startsWith('cache:')) {
        isCached = true;
        cacheId = finalSrc.substring(6);
        finalSrc = '';
    } else if (finalSrc && !finalSrc.startsWith('http') && !finalSrc.startsWith('data:') && !finalSrc.startsWith('/')) {
        finalSrc = `characters/${finalSrc}`;
    }

    const uniqueId = `av_${authorId}_${Math.random().toString(36).substring(2, 7)}`;
    const style = `width: ${sizePx}px; height: ${sizePx}px; border-radius: 4px; object-fit: cover; flex-shrink: 0;`;

    // 1. Initial Content
    let html = '';
    if (finalSrc) {
        html = `<img id="${uniqueId}" src="${finalSrc}" class="moments-avatar-img" style="${style}" onerror="this.onerror=null;this.src='img/five.png';" />`;
    } else {
        html = `<div id="${uniqueId}" class="moments-avatar-placeholder" style="${style} display: flex; align-items: center; justify-content: center; background: var(--SmartThemeQuoteColor); font-weight: bold; font-size: ${sizePx * 0.4}px;">${isCached ? '' : (authorName || 'A')[0]}</div>`;
    }

    // 2. Post-render logic
    setTimeout(async () => {
        const el = document.getElementById(uniqueId);
        if (!el) return;

        // A. Load from cache
        if (isCached) {
            try {
                const base64 = await moments.avatarCache.get(cacheId);
                if (base64) {
                    updateElementToImg(el, base64, style);
                    return; // Done
                }
            } catch (e) { console.warn('Cache load failed:', e); }
        }

        // B. If still no avatar, try fetching user profile from server
        const s = moments.getSettings();
        if (!finalSrc && authorId && authorId !== 'guest' && authorId !== 'local_user' && s.enabled && s.backendUrl) {
            try {
                const result = await moments.getUserProfile(authorId);
                if (result?.ok && result.user?.avatarUrl) {
                    // Only fallback to user's profile avatar if the comment was actually made by the user, not their character
                    if (!authorName || result.user.displayName === authorName || result.user.username === authorName) {
                        updateElementToImg(el, result.user.avatarUrl, style);
                    }
                }
            } catch (e) { /* silent fail */ }
        }
    }, 0);

    return html;
}

function updateElementToImg(el, src, style) {
    if (el.tagName === 'DIV') {
        const img = document.createElement('img');
        img.id = el.id;
        img.src = src;
        img.className = 'moments-avatar-img';
        img.setAttribute('style', style);
        img.onerror = () => { img.src = 'img/five.png'; };
        el.replaceWith(img);
    } else {
        el.src = src;
    }
}

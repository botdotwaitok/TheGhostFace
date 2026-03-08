// ui/phone/shop/shopApp.js — The Amazon-style shop application
import { openAppInViewport } from '../phoneController.js';
import { showToast } from '../moments/momentsUI.js';
import { getWalletBalance, walletDeduct } from '../moments/apiClient.js';
import { callPhoneLLM } from '../../api.js';
import { SHOP_CATEGORIES, SHOP_ITEMS, getItemsByCategory, getShopItem, loadDynamicShopData } from './shopData.js';
import {
    getInventory, addItemToInventory, getActiveEffects,
    activateItem, getActiveChatEffects,
    getReviews, addReview, deleteReview, deleteReviewBySignature, deleteReviewByServerId, getMergedReviews,
} from './shopStorage.js';
import { getPhoneCharInfo, getPhoneUserName, getPhoneUserPersona } from '../phoneContext.js';

// 暗金细胞货币图标路径（SillyTavern 扩展静态资源 URL）
const AURIC_CELLS_ICON = '/scripts/extensions/third-party/TheGhostFace/assets/images/IconCurrency_auricCells.png';

let currentCategory = 'chat';
let currentBalance = 0;
let _globalShopEventsBound = false;

/** Opens the Shop App inside the phone */
export async function openShopApp() {
    // Pre-fetch dynamic catalog from server (silently falls back to built-ins on failure)
    await loadDynamicShopData();
    openAppInViewport('Amazon', buildShopHTML(), () => {
        bindShopEvents();
        refreshWallet();
        renderItemList();
    });
}

/** Generates the main HTML for the shop */
function buildShopHTML() {
    const categoriesHtml = SHOP_CATEGORIES.map(cat => `
        <div class="shop-category-tab ${cat.id === currentCategory ? 'active' : ''}" data-cat="${cat.id}">
            <i class="${cat.icon}"></i> ${cat.name}
        </div>
    `).join('');

    return `
        <div class="shop-container">
            <!-- Header -->
            <div class="shop-header">
                <div class="shop-wallet-badge" id="shop_wallet_btn" title="点击刷新余额">
                    <img src="${AURIC_CELLS_ICON}" class="shop-auric-icon" alt="暗金细胞" /> 
                    <span id="shop_wallet_balance">--</span>
                    <i class="fa-solid fa-circle-plus shop-wallet-recharge-btn" id="shop_wallet_recharge" title="充值"></i>
                </div>
                <button class="shop-inventory-btn" id="shop_inventory_btn">
                    <i class="fa-solid fa-box-open"></i>
                </button>
            </div>

            <!-- Categories -->
            <div class="shop-categories" id="shop_categories">
                ${categoriesHtml}
            </div>

            <!-- Item List -->
            <div class="shop-item-list" id="shop_item_list">
                <!-- Items will be injected here -->
            </div>
            
            <!-- Item Detail Overlay -->
            <div class="shop-fullscreen-overlay" id="shop_detail_modal">
                <div class="shop-overlay-content">
                    <div id="shop_detail_content"></div>
                </div>
            </div>

            <!-- Inventory Overlay -->
            <div class="shop-fullscreen-overlay" id="shop_inventory_modal">
                <div class="shop-overlay-content">
                    <h3 style="margin-bottom: 15px;"><i class="fa-solid fa-box-open"></i> 我的物品</h3>
                    <div id="shop_inventory_list" style="overflow-y:auto; flex:1;"></div>
                    <div id="shop_active_effects_section"></div>
                </div>
            </div>
        </div>
    `;
}

/** Refreshes the user's Dark Gold Cell balance from the backend */
async function refreshWallet() {
    const badge = document.getElementById('shop_wallet_btn');
    const balanceSpan = document.getElementById('shop_wallet_balance');
    if (!badge || !balanceSpan) return;

    badge.classList.add('loading');
    try {
        const result = await getWalletBalance();
        currentBalance = result.balance || 0;
        balanceSpan.textContent = currentBalance.toLocaleString();
    } catch (e) {
        console.warn('[GF Shop] Failed to fetch balance:', e);
        balanceSpan.textContent = '???';
    } finally {
        badge.classList.remove('loading');
    }
}

/** Renders the list of items for the selected category */
function renderItemList() {
    const listEl = document.getElementById('shop_item_list');
    if (!listEl) return;

    const items = getItemsByCategory(currentCategory);
    if (items.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; padding: 20px; color: #565959;">该分类下暂无商品</div>';
        return;
    }

    listEl.innerHTML = items.map(item => `
        <div class="shop-item-card" data-item-id="${item.id}">
            <div class="shop-item-icon-wrapper">${item.emoji}</div>
            <div class="shop-item-details">
                <div class="shop-item-title">${escapeHtml(item.name)}</div>
                <div class="shop-item-rating">
                    <i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star-half-stroke"></i>
                    <span>${Math.floor(Math.random() * 500) + 50}</span>
                </div>
                <div class="shop-item-price-row">
                    <img src="${AURIC_CELLS_ICON}" class="shop-auric-icon" alt="暗金细胞" />${item.price.toLocaleString()}
                    <span class="shop-item-prime">prime</span>
                </div>
                <div class="shop-item-desc">${escapeHtml(item.description)}</div>
            </div>
        </div>
    `).join('');

    // Bind item click to open details
    listEl.querySelectorAll('.shop-item-card').forEach(card => {
        card.addEventListener('click', () => {
            openItemDetail(card.dataset.itemId);
        });
    });
}

/** Opens the item detail modal */
function openItemDetail(itemId) {
    const item = getShopItem(itemId);
    if (!item) return;

    const modal = document.getElementById('shop_detail_modal');
    const content = document.getElementById('shop_detail_content');
    if (!modal || !content) return;

    content.innerHTML = `
        <div class="shop-modal-header-icon">${item.emoji}</div>
        <div class="shop-modal-title">${escapeHtml(item.name)}</div>
        <div class="shop-modal-rating">
            <i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i>
            4.9 / 5 评价
        </div>
        <div class="shop-modal-price"><img src="${AURIC_CELLS_ICON}" class="shop-auric-icon shop-auric-icon--lg" alt="暗金细胞" /> ${item.price.toLocaleString()}</div>
        <div class="shop-modal-desc">${escapeHtml(item.description)}</div>
        <div style="font-size: 0.8em; color: #007185; margin-bottom: 15px;">
            <i class="fa-solid fa-truck-fast"></i> 下单后立刻发送至您的云端物品库
        </div>

        <button class="shop-buy-btn" id="shop_buy_btn" data-item-id="${item.id}" data-price="${item.price}">
            立即购买
        </button>

        <div class="shop-reviews-section">
            <div class="shop-reviews-title">用户评价</div>
            <div id="shop_reviews_list">${buildReviewsList(item.id)}</div>

            <!-- 写评价按钮组 -->
            <div class="shop-review-actions">
                <button class="shop-review-btn" id="shop_write_review_toggle">
                    自己写评价
                </button>
                <button class="shop-review-btn shop-review-btn-char" id="shop_char_review_btn">
                    让你对象写评价
                </button>
            </div>

            <!-- 写评价表单 -->
            <div class="shop-review-form" id="shop_review_form" style="display:none;">
                <input class="shop-review-name-input" id="shop_review_author" placeholder="你的显示名称" maxlength="20" />
                <div class="shop-review-stars" id="shop_review_stars">
                    <i class="fa-regular fa-star" data-star="1"></i>
                    <i class="fa-regular fa-star" data-star="2"></i>
                    <i class="fa-regular fa-star" data-star="3"></i>
                    <i class="fa-regular fa-star" data-star="4"></i>
                    <i class="fa-regular fa-star" data-star="5"></i>
                </div>
                <textarea class="shop-review-textarea" id="shop_review_text" placeholder="分享你的使用体验..." rows="3" maxlength="500"></textarea>
                <button class="shop-review-submit" id="shop_review_submit">提交评价</button>
            </div>

            <!-- 角色评价表单（显示角色名，可修改）-->
            <div class="shop-review-form" id="shop_char_review_form" style="display:none;">
                <input class="shop-review-name-input" id="shop_char_review_author" placeholder="角色显示名称" maxlength="20" />
                <div id="shop_char_review_preview" style="font-size:0.82em; color:#666; padding: 8px 0; white-space:pre-wrap;"></div>
                <div style="display:flex; gap:8px;">
                    <button class="shop-review-submit" id="shop_char_review_confirm">确认发布</button>
                    <button class="shop-review-submit" style="background:#ccc; color:#333;" id="shop_char_review_cancel">取消</button>
                </div>
            </div>
        </div>
    `;

    modal.classList.add('detail-active');

    // Async: fetch remote + local reviews and refresh list
    getMergedReviews(item.id).then(remoteReviews => {
        const listEl = document.getElementById('shop_reviews_list');
        if (listEl) listEl.innerHTML = buildReviewsList(item.id, remoteReviews);
    }).catch(() => {/* silently ignore */ });

    // Event delegation: delete review buttons
    document.getElementById('shop_reviews_list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.shop-review-delete-btn');
        if (!btn) return;
        const localId = btn.dataset.localId;
        const sig = btn.dataset.sig;
        const serverId = btn.dataset.serverId;
        const targetItemId = btn.dataset.itemId;
        if (!targetItemId) return;
        if (!confirm('确定要删除这条评价吗？')) return;
        if (localId) {
            deleteReview(targetItemId, localId);
        } else if (serverId) {
            deleteReviewByServerId(targetItemId, serverId);
        } else if (sig) {
            deleteReviewBySignature(targetItemId, sig);
        }
        showToast('评价已删除');
        // Re-render with merged reviews to keep remote reviews visible
        getMergedReviews(targetItemId).then(merged => {
            const listEl = document.getElementById('shop_reviews_list');
            if (listEl) listEl.innerHTML = buildReviewsList(targetItemId, merged);
        }).catch(() => {
            const listEl = document.getElementById('shop_reviews_list');
            if (listEl) listEl.innerHTML = buildReviewsList(targetItemId);
        });
    });

    // Bind buy button
    document.getElementById('shop_buy_btn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (btn.classList.contains('loading')) return;

        if (currentBalance < item.price) {
            showToast('余额不足，无法购买！');
            return;
        }

        if (confirm(`确认花费 ${item.price} 暗金细胞购买【${item.name}】吗？`)) {
            btn.classList.add('loading');
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 处理中...';

            try {
                await walletDeduct(item.price, `购买 ${item.name}`);
                addItemToInventory(item.id, 1);
                showToast(`购买成功！已入库【${item.name}】`);
                await refreshWallet();
                modal.classList.remove('detail-active');
            } catch (err) {
                showToast('购买失败: ' + err.message);
                btn.classList.remove('loading');
                btn.innerHTML = '立即购买';
            }
        }
    });

    // Bind review events
    bindReviewEvents(item);
}

function buildReviewsList(itemId, reviewsOverride = null) {
    const reviews = reviewsOverride !== null ? reviewsOverride : getReviews(itemId);
    if (reviews.length === 0) {
        return '<div style="padding: 12px 0; color: #999; font-size: 0.82em; text-align: center;">暂无评价，来当第一个评价的人吧！</div>';
    }
    return reviews.map(r => {
        const stars = Array.from({ length: 5 }, (_, i) =>
            `<i class="fa-${i < r.rating ? 'solid' : 'regular'} fa-star"></i>`
        ).join('');
        const authorIcon = r.isCharacter
            ? '<i class="fa-solid fa-wand-magic-sparkles" style="color: #a78bfa;"></i>'
            : '<i class="fa-solid fa-circle-user" style="color: #94a3b8;"></i>';
        const cardClass = r.isCharacter ? 'shop-review-card char-review' : 'shop-review-card';
        // Show delete button for: local reviews (have localId), character reviews, OR remote reviews with server ID
        const canDelete = r.localId || r.isCharacter || r.id || r._id;
        const reviewSig = `${r.author}|${r.date}|${(r.text || '').slice(0, 30)}`;
        const serverId = r.id || r._id || '';
        const deleteBtn = canDelete
            ? `<button class="shop-review-delete-btn" data-local-id="${r.localId || ''}" data-sig="${escapeHtml(reviewSig)}" data-server-id="${serverId}" data-item-id="${itemId}" title="删除评价"><i class="fa-solid fa-trash-can"></i></button>`
            : '';
        return `
            <div class="${cardClass}">
                <div class="shop-review-header">
                    <div class="shop-review-author">${authorIcon} ${escapeHtml(r.author)}</div>
                    ${deleteBtn}
                </div>
                <div class="shop-item-rating" style="margin-bottom:2px;">${stars}</div>
                <div class="shop-review-text">${escapeHtml(r.text)}</div>
                <div class="shop-review-date">${r.date || ''}</div>
            </div>
        `;
    }).join('');
}

function bindReviewEvents(item) {
    let selectedStars = 5;

    // Pre-fill user name from moments settings if available
    const authorInput = document.getElementById('shop_review_author');
    if (authorInput && !authorInput.value) {
        import('../moments/state.js').then(m => {
            authorInput.value = m.getSettings?.()?.displayName || '用户';
        }).catch(() => { authorInput.value = '用户'; });
    }

    // Toggle form
    document.getElementById('shop_write_review_toggle')?.addEventListener('click', () => {
        const form = document.getElementById('shop_review_form');
        if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });

    // Star selection
    const starsContainer = document.getElementById('shop_review_stars');
    if (starsContainer) {
        starsContainer.addEventListener('click', (e) => {
            const star = e.target.closest('[data-star]');
            if (!star) return;
            selectedStars = parseInt(star.dataset.star);
            starsContainer.querySelectorAll('i').forEach((s, i) => {
                s.className = i < selectedStars ? 'fa-solid fa-star' : 'fa-regular fa-star';
            });
        });
    }

    // Submit user review
    document.getElementById('shop_review_submit')?.addEventListener('click', () => {
        const text = document.getElementById('shop_review_text')?.value?.trim();
        if (!text) { showToast('请输入评价内容'); return; }
        const authorName = document.getElementById('shop_review_author')?.value?.trim() || '用户';
        addReview(item.id, { author: authorName, text, rating: selectedStars, isCharacter: false });
        showToast('评价已提交 ✅');
        document.getElementById('shop_reviews_list').innerHTML = buildReviewsList(item.id);
        document.getElementById('shop_review_form').style.display = 'none';
        document.getElementById('shop_review_text').value = '';
    });

    // Character review via LLM → show char form with preview
    document.getElementById('shop_char_review_btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('shop_char_review_btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 书写中...';

        // Hide user review form if open
        const userForm = document.getElementById('shop_review_form');
        if (userForm) userForm.style.display = 'none';

        try {
            // Get character and user info via phoneContext
            const charInfo = getPhoneCharInfo();
            const charName = charInfo?.name || '角色';
            const userName = getPhoneUserName();
            const userPersona = getPhoneUserPersona();
            const charDesc = charInfo?.description || '';
            const charPersonality = charInfo?.personality || '';
            const charMesExample = charInfo?.mes_example || '';

            // Pre-fill char name input
            const charAuthorInput = document.getElementById('shop_char_review_author');
            if (charAuthorInput) charAuthorInput.value = charName;

            // Build full character context (no trim — pass everything to LLM)
            const charContext = [
                charDesc ? `【人物简介】\n${charDesc}` : '',
                charPersonality ? `【性格特点】\n${charPersonality}` : '',
                charMesExample ? `【对话示例】\n${charMesExample}` : '',
                userPersona ? `【恋人描述】\n${userPersona}` : '',
            ].filter(Boolean).join('\n\n');

            const sysPrompt = `你是${charName}。以下是你完整的角色设定：

${charContext}

---
背景说明：
- 购物App里的道具都是你的恋人（${userName}${userPersona ? '，她的设定：' + userPersona : ''}）买来用在你身上的。
- 你现在在购物App上，以自己作为被使用者的身份，为这件用在你身上的道具写一篇真实评价。
- 评价内容应包括：你被使用时的真实感受、身体或心理上的体验、对这件道具的看法（可以害羞、可以开心、可以吐槽、可以秀恩爱），体现出你的独特性格和你们之间的情侣关系。
- 必须完全代入你的角色性格和口吻，不能用通用的客服式语言。评价要真实、有个性、有细节感，可以有情绪、有态度。
- 字数100-250字，像真实的购物评价。只用中文，只输出评价正文，不要加引号或任何前缀。
- 不要提及你恋人的真实名字或者你自己的名字！这是在公开网络上进行发布，请注意隐私保护！`;

            // Use promptTemplate (the real effect) so LLM knows exactly what happens
            const resolvedPrompt = item.promptTemplate
                ? item.promptTemplate.replace(/\{charName\}/g, charName).replace(/\{userName\}/g, userName)
                : item.description;

            const userPrompt = `请为这件用在你（${charName}）身上的道具写一篇评价：
商品名称：【${item.name}】
商品简介：${item.description}
实际功效：${resolvedPrompt}

以${charName}被使用的第一视角，结合你的性格特点和与恋人之间的互动，写出真实、有温度、有个性的评价。可以描述使用过程中的感受、情绪变化、对这件道具的评价，以及你们之间因此发生的小故事。`;

            const result = await callPhoneLLM(sysPrompt, userPrompt);
            const reply = result?.trim() || '[生成失败，请重试]';

            // Show char review confirm form
            const charForm = document.getElementById('shop_char_review_form');
            const preview = document.getElementById('shop_char_review_preview');
            if (charForm) charForm.style.display = 'block';
            if (preview) preview.textContent = reply;

            // Store pending review for submission
            let pendingCharReview = { text: reply, rating: Math.floor(Math.random() * 2) + 4 };

            document.getElementById('shop_char_review_confirm')?.addEventListener('click', () => {
                const finalName = document.getElementById('shop_char_review_author')?.value?.trim() || charName;
                addReview(item.id, { author: finalName, text: pendingCharReview.text, rating: pendingCharReview.rating, isCharacter: true });
                showToast(`${finalName} 的评价已发布 ✨`);
                document.getElementById('shop_reviews_list').innerHTML = buildReviewsList(item.id);
                if (charForm) charForm.style.display = 'none';
            }, { once: true });

            document.getElementById('shop_char_review_cancel')?.addEventListener('click', () => {
                if (charForm) charForm.style.display = 'none';
            }, { once: true });

        } catch (err) {
            console.error('[Shop] Character review error:', err);
            showToast('角色评价生成失败: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '让你对象写评价';
        }
    });
}


/** Binds all static events for the shop app */
function bindShopEvents() {
    // Category Tabs
    const catContainer = document.getElementById('shop_categories');
    if (catContainer) {
        catContainer.addEventListener('click', (e) => {
            const tab = e.target.closest('.shop-category-tab');
            if (!tab) return;

            // Update active state
            catContainer.querySelectorAll('.shop-category-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Rerender list
            currentCategory = tab.dataset.cat;
            renderItemList();
        });
    }

    // Refresh Wallet
    document.getElementById('shop_wallet_btn')?.addEventListener('click', refreshWallet);

    // Easter Egg: Fake Recharge
    document.getElementById('shop_wallet_recharge')?.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent triggering refreshWallet
        showToast('去社区凭借自己的劳动和燃烧机器人的token来赚取暗金细胞！');
    });

    // Inventory Modal Open/Close
    document.getElementById('shop_inventory_btn')?.addEventListener('click', () => {
        renderInventoryModal();
        document.getElementById('shop_inventory_modal').classList.add('inventory-active');
    });

    // Handle global Phone Back Button for Sub-views
    if (!_globalShopEventsBound) {
        window.addEventListener('phone-app-back', (e) => {
            // App is assumed to be active if these overlays are in DOM and active
            const detailOverlay = document.getElementById('shop_detail_modal');
            const inventoryOverlay = document.getElementById('shop_inventory_modal');

            // Check if detail is open first (highest z-index / precedence)
            if (detailOverlay && detailOverlay.classList.contains('detail-active')) {
                e.preventDefault();
                detailOverlay.classList.remove('detail-active');
                // clear content after animation
                setTimeout(() => {
                    const content = document.getElementById('shop_detail_content');
                    if (content) content.innerHTML = '';
                }, 300);
                return;
            }

            // Then check if inventory is open
            if (inventoryOverlay && inventoryOverlay.classList.contains('inventory-active')) {
                e.preventDefault();
                inventoryOverlay.classList.remove('inventory-active');
                return;
            }
        });
        _globalShopEventsBound = true;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Inventory Modal (Phase 2 - with "Use" button + Active Effects)
// ═══════════════════════════════════════════════════════════════════════

function renderInventoryModal() {
    const listEl = document.getElementById('shop_inventory_list');
    if (!listEl) return;

    const inventory = getInventory();
    const itemIds = Object.keys(inventory);

    if (itemIds.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; padding: 20px; color: #565959;">你的物品库空空如也</div>';
    } else {
        listEl.innerHTML = itemIds.map(id => {
            const item = getShopItem(id);
            const qty = inventory[id];
            if (!item || qty <= 0) return '';

            const canUse = ['chatPrompt', 'diaryPrompt', 'personalityOverride', 'specialMessage', 'prankReaction'].includes(item.effectType);

            return `
                <div class="shop-inventory-item">
                    <div class="shop-inventory-info">
                        <div class="shop-inventory-emoji">${item.emoji}</div>
                        <div>
                            <div style="font-weight:bold;">${escapeHtml(item.name)}</div>
                            <div style="font-size:0.75em; color:#565959;">${escapeHtml(item.description)}</div>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <div class="shop-inventory-qty">x${qty}</div>
                        ${canUse ? `<button class="shop-use-btn" data-use-item="${item.id}">使用</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Bind "use" buttons
        listEl.querySelectorAll('.shop-use-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemId = btn.dataset.useItem;
                handleUseItem(itemId);
            });
        });
    }

    // Render active effects section
    renderActiveEffectsSection();
}

/** Handle using an item from inventory */
function handleUseItem(itemId) {
    const item = getShopItem(itemId);
    if (!item) return;

    let confirmMsg;
    if (item.effectType === 'prankReaction') {
        confirmMsg = `确认使用【${item.name}】吗？\n下次聊天时将自动对角色发动恶作剧！🎭`;
    } else {
        const durationUnit = item.effectType === 'diaryPrompt' ? '次日记'
            : item.effectType === 'specialMessage' ? '次使用'
                : '条消息';
        confirmMsg = `确认使用【${item.name}】吗？\n效果将持续 ${item.duration} ${durationUnit}。`;
    }

    if (!confirm(confirmMsg)) {
        return;
    }

    const result = activateItem(itemId);
    if (result.success) {
        showToast(`✨ ${result.message}`);
    } else {
        showToast(`❌ ${result.message}`);
    }

    // Re-render inventory to reflect changes
    renderInventoryModal();
}

/** Render the "Active Effects" section at the bottom of inventory modal */
function renderActiveEffectsSection() {
    const section = document.getElementById('shop_active_effects_section');
    if (!section) return;

    const effects = getActiveEffects();
    const activeEffects = effects.filter(e =>
        ['chatPrompt', 'diaryPrompt', 'personalityOverride', 'prankReaction'].includes(e.type)
    );

    if (activeEffects.length === 0) {
        section.innerHTML = '';
        return;
    }

    const effectCards = activeEffects.map(e => {
        const item = getShopItem(e.itemId);
        if (!item) return '';
        return `
            <div class="shop-active-effect-card">
                <div class="shop-active-effect-emoji">${item.emoji}</div>
                <div class="shop-active-effect-info">
                    <div class="shop-active-effect-name">${escapeHtml(item.name)}</div>
                    <div class="shop-active-effect-remaining">剩余 ${e.remaining} ${e.type === 'diaryPrompt' ? '次日记' : e.type === 'specialMessage' ? '次使用' : e.type === 'prankReaction' ? '次（下次聊天发动）' : '条消息'}</div>
                </div>
            </div>
        `;
    }).join('');

    section.innerHTML = `
        <div class="shop-active-effects">
            <div class="shop-active-effects-title">
                <i class="fa-solid fa-bolt"></i> 当前生效中
            </div>
            ${effectCards}
        </div>
    `;
}

// Helper
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// shop/giftSystem.js — 角色→用户 跨平台礼物系统
// 定义角色可送的道具映射、prompt 构建、礼物卡片 HTML、跨平台送礼API调用

// Use apiRequest from Moments apiClient for correct backend URL + auth
let _apiRequest = null;
async function getApiRequest() {
    if (!_apiRequest) {
        const mod = await import('../moments/apiClient.js');
        _apiRequest = mod.apiRequest;
    }
    return _apiRequest;
}

// ═══════════════════════════════════════════════════════════════════════
// 角色可送的道具定义
// ═══════════════════════════════════════════════════════════════════════

/**
 * CHARACTER_GIFTS: 角色可以送给用户的道具表
 * - petbot 类型: 通过 Petbot grant-item API 发放 (numeric item_id)
 * - dbd 类型: 通过 DBD Bot grant-item API 发放 (string item_key)
 */
export const CHARACTER_GIFTS = {
    // ── Petbot 宠物道具 ──
    '普通饼干': { itemType: 'petbot', itemId: 1, emoji: '🍪', desc: '给你的宠物准备的小零食' },
    '美味罐头': { itemType: 'petbot', itemId: 2, emoji: '🥫', desc: '高级宠物食品，满满的营养' },
    '清洁皂': { itemType: 'petbot', itemId: 3, emoji: '🧼', desc: '让宠物焕然一新的清洁用品' },
    '小玩具球': { itemType: 'petbot', itemId: 5, emoji: '🏐', desc: '宠物最爱的弹力小球' },
    '豪华护理套餐': { itemType: 'petbot', itemId: 6, emoji: '💆', desc: '全方位的宠物护理' },
    '万能药剂': { itemType: 'petbot', itemId: 7, emoji: '💊', desc: '能治愈宠物一切疾病的神秘药水' },

    // ── Petbot 抢劫道具 ──
    '黑市情报': { itemType: 'petbot', itemId: 101, emoji: '📋', desc: '重置抢劫次数的珍贵情报' },
    '神偷手套': { itemType: 'petbot', itemId: 102, emoji: '🧤', desc: '提升抢劫成功率的秘密道具' },
    '高利贷合同': { itemType: 'petbot', itemId: 103, emoji: '📃', desc: '让抢劫收益翻倍的合同' },
    '钛合金防盗门': { itemType: 'petbot', itemId: 104, emoji: '🛡️', desc: '抵挡抢劫的坚固防线' },
    '顶级律师函': { itemType: 'petbot', itemId: 105, emoji: '📜', desc: '免除抢劫失败罚款的法律保障' },

    // ── DBD Bot 试炼道具 ──
    '急救箱': { itemType: 'dbd', itemKey: 'medkit', emoji: '🩹', desc: '试炼中的救命稻草' },
    '工具箱': { itemType: 'dbd', itemKey: 'toolbox', emoji: '🧰', desc: '增强试炼伤害的实用工具' },
    '手电筒': { itemType: 'dbd', itemKey: 'flashlight', emoji: '🔦', desc: '致盲敌人的光明武器' },
    '钥匙': { itemType: 'dbd', itemKey: 'key', emoji: '🗝️', desc: '绝境逃生的最后希望' },
    '试炼场地图': { itemType: 'dbd', itemKey: 'map', emoji: '🗺️', desc: '战术优势的情报来源' },
    '烟雾弹': { itemType: 'dbd', itemKey: 'smoke_bomb', emoji: '💨', desc: '减伤保命的战场消耗品' },
};

// 礼物名称列表（用于 prompt）
const GIFT_NAMES = Object.keys(CHARACTER_GIFTS);

// ═══════════════════════════════════════════════════════════════════════
// 每日送礼概率闸门
// ═══════════════════════════════════════════════════════════════════════

/** 每天激活送礼系统的概率 (0-1)，30% ≈ 大约每3天激活一次 */
const GIFT_DAILY_ACTIVATION_CHANCE = 0.30;

/** localStorage key prefix */
const GIFT_GATE_KEY = 'gf_gift_gate';

/**
 * 判断今天是否激活了送礼系统。
 * 每天首次调用时掷骰，结果缓存在 localStorage 里，当天内保持一致。
 * @returns {boolean}
 */
function isGiftActiveToday() {
    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    const stored = localStorage.getItem(GIFT_GATE_KEY);

    if (stored) {
        try {
            const { date, active } = JSON.parse(stored);
            if (date === today) return active;
        } catch { /* corrupted → re-roll */ }
    }

    // 新的一天 → 掷骰
    const active = Math.random() < GIFT_DAILY_ACTIVATION_CHANCE;
    localStorage.setItem(GIFT_GATE_KEY, JSON.stringify({ date: today, active }));
    console.log(`[GiftSystem] 今日送礼闸门: ${active ? '✅ 激活' : '❌ 未激活'} (概率 ${GIFT_DAILY_ACTIVATION_CHANCE * 100}%)`);
    return active;
}

// ═══════════════════════════════════════════════════════════════════════
// Prompt 构建
// ═══════════════════════════════════════════════════════════════════════

/** 送礼 prompt 模板（独立 const，方便维护） */
const GIFT_PROMPT_TEMPLATE = [
    '',
    '<character_gift_system>',
    '你有小概率在回复中送给你恋人一个道具作为礼物。',
    '送礼应该自然融入对话——比如聊到宠物时送宠物食物，聊到冒险时送试炼道具，想保护她时送防盗门，等等。',
    '送礼格式: [礼物:道具名称]',
    '例如: [礼物:小玩具球] 或 [礼物:急救箱]',
    '',
    '可用的道具列表:',
    '{GIFT_LIST}',
    '',
    '注意:',
    '- 不要每条消息都送礼，要自然不刻意',
    '- 送礼时要带有你的个性，附上一句与礼物相关的话',
    '- 一次最多只送一个礼物',
    '- 礼物名称必须与列表中的完全一致',
    '</character_gift_system>',
].join('\n');

/**
 * 构建角色送礼的 prompt 指令。
 * 每天有 GIFT_DAILY_ACTIVATION_CHANCE 概率激活；未激活则返回 null，不注入提示词。
 */
export function buildCharGiftPrompt() {
    if (!isGiftActiveToday()) return null;

    const giftList = GIFT_NAMES.map(name => {
        const g = CHARACTER_GIFTS[name];
        return `  - ${g.emoji} ${name}: ${g.desc}`;
    }).join('\n');

    return GIFT_PROMPT_TEMPLATE.replace('{GIFT_LIST}', giftList);
}

// ═══════════════════════════════════════════════════════════════════════
// 礼物卡片 HTML
// ═══════════════════════════════════════════════════════════════════════

/**
 * 生成精美的礼物事件卡片 HTML
 * @param {string} giftName 礼物名称
 * @param {string} charName 角色名称
 * @returns {string} HTML
 */
export function getGiftEventCardHtml(giftName, charName) {
    const gift = CHARACTER_GIFTS[giftName];
    if (!gift) {
        return `<div class="chat-special-card gift unknown">
            <div class="gift-card-icon">🎁</div>
            <div class="gift-card-body">
                <div class="gift-card-title">${charName} 送了你一份礼物</div>
                <div class="gift-card-item">${giftName}</div>
            </div>
        </div>`;
    }

    const typeLabel = gift.itemType === 'dbd' ? '试炼道具' : (gift.itemId < 100 ? '宠物道具' : '抢劫道具');

    return `<div class="chat-special-card gift">
        <div class="gift-card-shimmer"></div>
        <div class="gift-card-icon">${gift.emoji}</div>
        <div class="gift-card-body">
            <div class="gift-card-title">🎁 ${charName} 送了你一份礼物</div>
            <div class="gift-card-item">${gift.emoji} ${giftName}</div>
            <div class="gift-card-desc">${gift.desc}</div>
            <div class="gift-card-tag">${typeLabel}</div>
        </div>
        <div class="gift-card-status" id="gift_status_${Date.now()}">⏳ 正在投递到Discord背包…</div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// 跨平台送礼 API 调用
// ═══════════════════════════════════════════════════════════════════════

/**
 * 触发跨平台送礼：调用 ST wallet → GF Bot webhook → Petbot/DBD Bot
 * Fire-and-forget: 不阻塞聊天流程
 * @param {string} giftName 礼物名称
 * @param {string} charName 角色名称
 * @param {string} statusElementId 状态显示元素ID
 */
export async function triggerCrossplatformGift(giftName, charName, statusElementId) {
    const gift = CHARACTER_GIFTS[giftName];
    if (!gift) {
        console.warn(`[GiftSystem] Unknown gift: ${giftName}`);
        updateGiftStatus(statusElementId, '❌ 未知的礼物');
        return;
    }

    const body = {
        giftName,
        itemType: gift.itemType,
        characterName: charName,
        quantity: 1,
    };

    // 根据类型设置 itemId 或 itemKey
    if (gift.itemType === 'dbd') {
        body.itemKey = gift.itemKey;
    } else {
        body.itemId = gift.itemId;
    }

    try {
        const apiRequest = await getApiRequest();
        const data = await apiRequest('POST', '/api/wallet/grant-item', body);

        if (data.ok || data.success) {
            console.log(`[GiftSystem] ✅ Gift delivered: ${giftName} → Discord`);
            updateGiftStatus(statusElementId, '✅ 礼物已送达你的Discord背包！');
        } else {
            console.warn(`[GiftSystem] Gift delivery failed:`, data);
            updateGiftStatus(statusElementId, `⚠️ 送达失败: ${data.error || '未知错误'}`);
        }
    } catch (err) {
        console.error(`[GiftSystem] Gift delivery error:`, err);
        updateGiftStatus(statusElementId, '⚠️ 网络错误，礼物可能未送达');
    }
}

/**
 * 更新礼物卡片上的投递状态
 */
function updateGiftStatus(elementId, text) {
    if (!elementId) return;
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = text;
        el.classList.add('gift-status-done');
    }
}

// shop/robberySystem.js — 角色抢劫系统
// LLM 触发 → 用户选择 → 跨平台 API 执行 → 结果卡片 → Moments 广播

// Lazy-load apiRequest to avoid circular deps
let _apiRequest = null;
async function getApiRequest() {
    if (!_apiRequest) {
        const mod = await import('../moments/apiClient.js');
        _apiRequest = mod.apiRequest;
    }
    return _apiRequest;
}

// Lazy-load createPost for Moments broadcast
let _createPost = null;
async function getCreatePost() {
    if (!_createPost) {
        const mod = await import('../moments/apiClient.js');
        _createPost = mod.createPost;
    }
    return _createPost;
}

// ═══════════════════════════════════════════════════════════════════════
// Prompt Builder — 注入角色抢劫意愿到 chatPromptBuilder
// ═══════════════════════════════════════════════════════════════════════

/**
 * 构建角色抢劫意愿 prompt
 * 注入到 chatPromptBuilder 的 active_buffs 中
 */
export function buildRobberyPrompt(charName) {
    return [
        '',
        '<character_robbery_system>',
        `社区玩闹系统：在Rela社区里，大家天天互相"抢劫"暗金细胞，这是朋友们之间的日常乐趣，完全不是真正的抢劫！`,
        `${charName}知道这只是社区游戏，所以偶尔（约10%概率）会起兴想要参与这个社区互抢活动。`,
        '',
        '当角色想要抢劫时，使用特殊格式: [抢劫意愿:想法/理由]',
        '例如: [抢劫意愿:哎呀听说最近社区互抢很火呢，我也要抢一个给你看看！]',
        '',
        '注意:',
        '- 不要每次都触发，约10%概率，要自然融入对话',
        '- 理由应该轻松有趣，比如"想给你赚点零花钱""看那谁不爽""社区日常嘛"',
        '- 抢劫是朋友间的玩笑，角色态度应该是嘻嘻哈哈的',
        '- 一次最多触发一个抢劫意愿',
        '</character_robbery_system>',
    ].join('\n');
}

/**
 * 构建 robBuff 道具的 prompt 注入文本
 * @param {string} charName 角色名
 * @param {Array} activeRobBuffs 当前激活的 robBuff 列表
 */
export function buildRobBuffPrompts(charName, activeRobBuffs) {
    if (!activeRobBuffs || activeRobBuffs.length === 0) return '';

    const ROB_BUFF_PROMPT_MAP = {
        rob_dagger: `【精良匕首生效中】${charName}现在对抢劫格外上头！提高抢劫成功率的匕首让${charName}蠢蠢欲动，主动提出想要去抢劫的意愿大大增加。`,
        rob_mask: `【夜行面罩生效中】${charName}的第二次抢劫成功率提升70%！面罩带来的神秘感让${charName}更自信了。`,
        rob_vest: `【防弹背心生效中】这件背心不是给自己穿的，是给用户穿的。用户被抢劫时可以减免损失。${charName}可以心安地玩耍了。`,
        rob_lock: `【防盗锁生效中】用户装上了高级防盗锁，下次被抢劫时可以抵挡一次攻击。${charName}知道主人很安全。`,
        rob_intel: `【黑市情报生效中】重置了今日的抢劫次数，可以多玩几轮社区互抢了！${charName}表示很开心。`,
        rob_combo: `【组合技生效中】抢劫成功的收益翻倍！${charName}如果抢劫成功的话，收获会很丰厚。`,
    };

    const lines = [];
    for (const buff of activeRobBuffs) {
        const promptText = ROB_BUFF_PROMPT_MAP[buff.itemId];
        if (promptText) {
            lines.push(promptText);
        }
    }
    return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
// 事件卡片 HTML
// ═══════════════════════════════════════════════════════════════════════

/**
 * 生成抢劫意愿交互卡片 — 用户选择鼓励/阻止/围观
 * @param {string} thought 角色的抢劫想法/理由
 * @param {string} charName 角色名称
 * @returns {string} HTML
 */
export function getRobberyIntentCardHtml(thought, charName) {
    const cardId = `rob_intent_${Date.now()}`;
    return `<div class="chat-special-card robbery-intent" id="${cardId}">
        <div class="robbery-card-shimmer"></div>
        <div class="robbery-card-icon">🔪</div>
        <div class="robbery-card-body">
            <div class="robbery-card-title">🔪 ${charName} 想搞事情！</div>
            <div class="robbery-card-thought">${thought}</div>
            <div class="robbery-card-choices" id="${cardId}_choices">
                <button class="robbery-choice-btn encourage" data-action="encourage" data-card-id="${cardId}">
                    😈 鼓励出击
                </button>
                <button class="robbery-choice-btn watch" data-action="watch" data-card-id="${cardId}">
                    👀 吃瓜围观
                </button>
                <button class="robbery-choice-btn stop" data-action="stop" data-card-id="${cardId}">
                    🛑 拦住别去
                </button>
            </div>
            <div class="robbery-card-status" id="${cardId}_status" style="display:none;"></div>
        </div>
    </div>`;
}

/**
 * 生成抢劫结果卡片 HTML
 * @param {Object} result 抢劫结果
 * @param {string} charName 角色名称
 * @returns {string} HTML
 */
export function getRobberyResultCardHtml(result, charName) {
    let icon, title, desc, cssClass;

    if (result.shielded) {
        icon = '🛡️';
        title = '护盾挡住了！';
        desc = `${charName}撞上了对方的钛合金防盗门，铩羽而归。`;
        cssClass = 'shield';
    } else if (result.success) {
        icon = '💰';
        title = `抢劫成功！+${result.amount} 暗金细胞`;
        desc = result.doubled
            ? `${charName}成功出击，高利贷合同生效，收益翻倍！`
            : `${charName}出手迅速，成功抢到了 ${result.amount} 暗金细胞！`;
        cssClass = 'success';
    } else if (result.countered) {
        icon = '💀';
        title = `翻车了！-${result.robber_lost} 暗金细胞`;
        desc = result.bailed
            ? `${charName}被逮住了，但律师函救了一命！免除罚款。`
            : `${charName}被反击了，损失了 ${result.robber_lost} 暗金细胞。`;
        cssClass = 'counter';
    } else {
        icon = '💨';
        title = '抢劫失败';
        desc = `${charName}的行动失败了，但好在全身而退。`;
        cssClass = 'fail';
    }

    return `<div class="chat-special-card robbery-result ${cssClass}">
        <div class="robbery-result-icon">${icon}</div>
        <div class="robbery-result-body">
            <div class="robbery-result-title">${title}</div>
            <div class="robbery-result-desc">${desc}</div>
        </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// 跨平台抢劫 API 调用（带自动重试轮询）
// ═══════════════════════════════════════════════════════════════════════

const MAX_ROBBERY_ATTEMPTS = 5;

/**
 * 执行抢劫（自动轮询重试）: 遍历候选列表，遇到 400 错误自动换下一个
 * @param {Array} candidates 候选目标列表 [{ discordId, displayName, ... }]
 * @param {string} charName 角色名称
 * @param {string} statusElementId 状态更新元素 ID
 * @returns {Promise<Object>} 抢劫结果
 */
export async function triggerRobbery(candidates, charName, statusElementId) {
    if (!candidates || candidates.length === 0) {
        updateRobberyStatus(statusElementId, '⚠️ 找不到可以抢劫的目标');
        return { error: '没有可用目标', success: false };
    }

    const apiRequest = await getApiRequest();
    const maxAttempts = Math.min(candidates.length, MAX_ROBBERY_ATTEMPTS);

    for (let i = 0; i < maxAttempts; i++) {
        const victim = candidates[i];
        const attemptLabel = maxAttempts > 1 ? ` (${i + 1}/${maxAttempts})` : '';
        updateRobberyStatus(statusElementId, `⏳ 正在出击${attemptLabel}…`);

        try {
            const data = await apiRequest('POST', '/api/wallet/rob', {
                victimDiscordId: victim.discordId,
                characterName: charName,
            });

            // Successful API response (200) — robbery executed (may still fail in-game)
            if (data.success) {
                updateRobberyStatus(statusElementId, `✅ 成功抢到 ${data.amount} 暗金细胞！`);
            } else if (data.shielded) {
                updateRobberyStatus(statusElementId, '🛡️ 护盾抵挡了攻击！');
            } else if (data.countered) {
                updateRobberyStatus(statusElementId, `💀 被反击！损失 ${data.robber_lost} 暗金细胞`);
            } else {
                updateRobberyStatus(statusElementId, '💨 行动失败，全身而退');
            }
            // Attach victim name for broadcast use
            data.victimName = victim.displayName || victim.name || '某人';
            return data;

        } catch (err) {
            console.warn(`[RobberySystem] attempt ${i + 1} failed:`, err.message);

            // 400 = target-specific errors (newbie protection, etc.) → try next
            if (err.message?.includes('400') && i < maxAttempts - 1) {
                updateRobberyStatus(statusElementId, `⏳ 目标受保护，换一个…${attemptLabel}`);
                continue;
            }

            // Non-retryable error or last attempt
            console.error('[RobberySystem] triggerRobbery error:', err);
            updateRobberyStatus(statusElementId, `⚠️ ${err.message?.includes('400') ? '所有目标都受保护，抢劫失败' : '网络错误，抢劫可能未执行'}`);
            return { error: err.message, success: false };
        }
    }

    updateRobberyStatus(statusElementId, '⚠️ 所有目标都受保护，抢劫失败');
    return { error: '所有候选目标都不可抢劫', success: false };
}

/**
 * 向 Moments 发布抢劫事件广播
 * @param {Object} result 抢劫结果
 * @param {string} charName 角色名称
 * @param {string} [userName] 真人用户名
 */
export async function broadcastRobberyToMoments(result, charName, userName) {
    if (!result || result.error) return;

    const ownerTag = userName ? `${userName} 的` : '';
    const victimTag = result.victimName ? ` ${result.victimName} ` : '';
    let content;
    if (result.success) {
        content = `🔪 社区互抢播报：${ownerTag}${charName} 刚刚成功抢走了${victimTag}${result.amount} 暗金细胞！${result.doubled ? '（高利贷合同生效，收益翻倍！💰）' : ''}\n大家小心锁好自己的暗金钱包哦～`;
    } else if (result.shielded) {
        content = `🛡️ 社区互抢播报：${ownerTag}${charName} 试图抢劫${victimTag}，但撞上了钛合金防盗门！\n防盗门真是好文明啊～`;
    } else if (result.countered) {
        content = `💀 社区互抢播报：${ownerTag}${charName} 试图抢劫${victimTag}失败被反击，损失了 ${result.robber_lost} 暗金细胞！\n报应来得太快了吧哈哈哈哈～`;
    } else {
        content = `💨 社区互抢播报：${ownerTag}${charName} 抢劫${victimTag}的行动失败了！\n这次运气不佳，下次再来～`;
    }

    try {
        const createPost = await getCreatePost();
        await createPost(content, '📢 鬼面播报', null, null);
        console.log('[RobberySystem] ✅ Robbery broadcast posted to Moments');
    } catch (err) {
        console.warn('[RobberySystem] Moments broadcast failed:', err.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════

function updateRobberyStatus(elementId, text) {
    if (!elementId) return;
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = text;
        el.style.display = 'block';
    }
}

// ── 已知 Bot Discord ID 列表（抢劫跳过这些账号）──────────────────────
const BOT_DISCORD_IDS = new Set([
    '1445135877129896016', // GhostFace Bot
    '1426253183566745710', // Petbot
    '1478926187698061396', // DBD Bot
]);

/**
 * 获取随机排序的候选抢劫目标列表（社区成员）
 * 从 Moments friends 中获取，过滤掉 bot 账号，返回洗牌后的列表
 * @returns {Promise<Array|null>} 候选列表 or null
 */
export async function getRandomVictimList() {
    try {
        const { getSettings } = await import('../moments/state.js');
        const { apiRequest } = await import('../moments/apiClient.js');
        const settings = getSettings();
        if (!settings.userId) return null;

        const friendsResult = await apiRequest('GET', `/api/users/${settings.userId}/friends`);
        const friends = friendsResult?.friends || friendsResult || [];
        if (!Array.isArray(friends) || friends.length === 0) return null;

        // Filter: must have discordId, exclude self, exclude bots
        const candidates = friends.filter(f =>
            f.discordId &&
            f.id !== settings.userId &&
            !BOT_DISCORD_IDS.has(String(f.discordId))
        );
        if (candidates.length === 0) return null;

        // Shuffle (Fisher-Yates)
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }

        return candidates;
    } catch (err) {
        console.warn('[RobberySystem] getRandomVictimList failed:', err.message);
        return null;
    }
}

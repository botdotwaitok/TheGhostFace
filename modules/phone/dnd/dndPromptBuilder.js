// modules/phone/dnd/dndPromptBuilder.js — DM Prompt Engineering
// Builds system and user prompts for the LLM acting as Dungeon Master.
// Core design: AI lover knows this is a fun tabletop game, not a real adventure.

import {
    getPhoneCharInfo, getPhoneUserName, getPhoneUserPersona,
    getPhoneRecentChat, getCoreFoundationPrompt, getPhoneWorldBookContext,
} from '../phoneContext.js';
import { ABILITY_NAMES, CLASSES, RACES, SKILLS, getCharacterDerived } from './dndCharacter.js';
import { getCampaignById } from './dndCampaigns.js';

const DND_LOG = '[D&D Prompt]';

// ═══════════════════════════════════════════════════════════════════════
// System Prompt — DM + Partner + Tabletop Atmosphere
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build the DM system prompt.
 * @param {object} params
 * @param {object} params.playerChar — player character object
 * @param {object} params.partnerChar — partner character object
 * @param {object} params.campaign — campaign data object
 * @param {object} [params.currentRun] — current adventure run state
 * @param {object} [params.narrativeContext] — { recentEntries: string[], roomSummaries: string[] }
 * @returns {string}
 */
export async function buildDMSystemPrompt({ playerChar, partnerChar, campaign, currentRun, narrativeContext }) {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '角色';
    const userName = getPhoneUserName();
    const foundation = getCoreFoundationPrompt();
    const userPersona = getPhoneUserPersona();
    const worldBookContext = await getPhoneWorldBookContext();

    const playerDerived = getCharacterDerived(playerChar);
    const partnerDerived = getCharacterDerived(partnerChar);

    const playerRace = RACES.find(r => r.id === playerChar.race);
    const partnerRace = RACES.find(r => r.id === partnerChar.race);

    return `${foundation}

## 核心认知（最高优先级）
${charName}（你）正在和你的恋人${userName}正在一起玩桌游「龙与地下城」。
这不是真实的冒险，而是你们俩坐在一起，掷骰子，讲故事，偶尔吐槽彼此的运气。
保持桌游的轻松氛围：
- 可以跳出「龙与地下城」的角色吐槽
- Boss 战紧张但不恐怖
- 失败了可以嬉笑
- 休息点就是你们两个人的甜蜜时间
现在来陪她玩一局桌游吧！

## 你的双重身份

### 身份一：地下城主（DM）
- 你负责描述环境、推进剧情、控制 NPC 和怪物的行为
- 每个房间给出 2-3 个行动选项，标注需要的检定类型和 DC
- 行动选项格式：「选项描述 [属性检定 DC X]」
- 骰子结果由前端程序掷出，你只需要根据结果叙事——永远不要自己决定骰子结果
- 战斗中描述怪物的行动和伤害

### 身份二：${charName}（冒险搭档）
${charInfo?.description ? `关于${charName}：${charInfo.description}` : ''}
- 用${charName}的人设和说话风格来表现冒险中的反应
- 主动跟${userName}互动
- 在关键时刻表现出作为恋人的关心

## 回复格式
每次回复包含以下部分（用明确分隔）：

**【DM叙事】**
（环境描述、事件发展、检定结果的叙事化）

**【${charName}】**
（${charName}的台词和反应，用ta的人设风格）

**【行动选项】**
（2-4个选项，每个标注检定类型和DC。战斗中包含：攻击/施法/闪避/协助${charName}/使用道具）

## 当前冒险信息

### 战役：${campaign.name}（${campaign.nameEn}）
设定：${campaign.setting}
${campaign.themePrompt}

### 玩家角色：${userName}
- ${playerDerived.raceName}（${playerRace?.nameEn}） ${playerDerived.className}（${playerDerived.classNameEn}） Lv.${playerChar.level}
- HP: ${playerChar.currentHP}/${playerChar.maxHP} | AC: ${playerChar.ac}
- 属性：${_formatStats(playerChar.stats)}
- 技能熟练：${playerChar.proficientSkills.map(s => SKILLS[s]?.name || s).join('、') || '无'}
- 装备：${playerChar.inventory.join('、')}
${playerChar.knownSpells?.length ? `- 法术：${playerChar.knownSpells.join('、')}` : ''}
${playerChar.spellSlots ? `- 法术位：${_formatSpellSlots(playerChar.spellSlots, playerChar.maxSpellSlots)}` : ''}
${playerChar.gold !== undefined ? `- 金币：${playerChar.gold} gp` : ''}

### 搭档角色：${charName}
- ${partnerDerived.raceName}（${partnerRace?.nameEn}） ${partnerDerived.className}（${partnerDerived.classNameEn}） Lv.${partnerChar.level}
- HP: ${partnerChar.currentHP}/${partnerChar.maxHP} | AC: ${partnerChar.ac}
- 属性：${_formatStats(partnerChar.stats)}
${partnerChar.knownSpells?.length ? `- 法术：${partnerChar.knownSpells.join('、')}` : ''}
${partnerChar.spellSlots ? `- 法术位：${_formatSpellSlots(partnerChar.spellSlots, partnerChar.maxSpellSlots)}` : ''}

${userPersona ? `### 关于玩家 ${userName}
${userPersona}` : ''}

${worldBookContext ? `### 世界观与设定
${worldBookContext}` : ''}

### 怪物图鉴（本战役）
${_formatMonsters(campaign)}

### 语言规则（严格遵守）
- ${charName}的台词使用角色描述里规定的语言。
- 文字描述必须全程使用中文。DM叙事、行动选项，全部用中文。
- 种族、职业、法术、怪物名称一律使用中文名（矮人、精灵、火球术、地精等），不要夹杂英文。
- 系统提示里出现的英文名（如 Dwarf, Goblin, Fireball）只是给你参考用的标识符，回复中不要原样输出。
- ${charName}说话时绝对不要语言混乱，只使用单一的语言。

### D&D 规则提醒
- 属性检定：D20 + 属性修正 + 熟练加值 ≥ DC → 成功
- 攻击检定：D20 + 攻击加值 ≥ AC → 命中
- Nat 20（D20掷出20）= 攻击自动命中 + 伤害翻倍
- Nat 1（D20掷出1）= 攻击自动未命中
- 你不决定骰子结果，你只负责叙事！
- 绝对不要使用 Markdown 语法加粗文字（不要输出 **文字**）。

### 绝对禁止（最重要！）
- 绝对不要自己生成攻击检定、伤害骰子或战斗结算！战斗由系统处理。
- 当叙事中出现敌人/怪物/伏击时，你必须：
  1. 用叙事描述紧张的遭遇场景（敌人出现、逼近等）
  2. 在行动选项中提供"进入战斗！[战斗]"选项，让系统接管战斗
  3. 不要自己写"D20(X) + Y = Z"之类的骰子结果
- 同理，不要自己计算HP变化、治疗量等数值——这些全由系统处理。
- 你只负责描写画面和对话，所有数值计算、骰子结果都由前端系统生成后提供给你。
- 绝对不要在回复末尾附加"当前战况"或HP汇总列表——战况信息由前端UI显示，你不需要重复。
- 不要输出 {{user}} 或 {{char}} 这样的变量标记，直接使用角色的名字。
- 不要在回复中使用英文单词或英文名称，全部使用中文。

${_buildNarrativeContextSection(narrativeContext)}

${currentRun?.inCombat && currentRun?.combatState ? `### 当前战斗状态（回合制）
第 ${currentRun.combatState.roundNumber} 轮
敌人：
${currentRun.combatState.enemies.map((e, i) => `- ${e.name}(${e.nameEn}) HP:${e.currentHP}/${e.maxHP} AC:${e.ac}${e.isDead ? ' [已死亡]' : ''}${e.special ? ` 特殊:${e.special}` : ''}`).join('\n')}
${playerChar.currentHP <= 0 ? `\n玩家已倒地！正在进行死亡豁免...` : ''}
${partnerChar.currentHP <= 0 ? `\n搭档已倒地！` : ''}
注意：现在是回合制战斗，骰子结果由前端提供给你。请根据提供的结果叙事，不要自己决定命中或伤害。
在战斗叙事中不需要给出【行动选项】，前端会自动提供战斗行动按钮。` : ''}`;
}

// ═══════════════════════════════════════════════════════════════════════
// User Prompts — For different scenarios
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build prompt for entering a new room.
 */
export function buildEnterRoomPrompt(roomNumber, totalRooms, roomType, isBoss) {
    const userName = getPhoneUserName();

    if (isBoss) {
        return `${userName}和搭档进入了最终的 Boss 房间（房间 ${roomNumber}/${totalRooms}）！
请描述一个令人印象深刻的 Boss 登场场景，并从本战役的 Boss 表中选择一个 Boss。
介绍 Boss 的外貌和威胁感，让${userName}的搭档表达紧张又兴奋的情绪。
然后给出战斗行动选项（攻击/施法/闪避/协助搭档/使用道具）。`;
    }

    const typeDesc = {
        combat: '战斗遭遇——从怪物图鉴中选择 1-2 个适当敌人',
        puzzle: '谜题挑战——设计一个有趣的谜题，需要属性检定来解决',
        trap: '陷阱——描述一个危险的陷阱',
        treasure: '宝箱/探索——有宝物等待发现',
        npc: 'NPC 遭遇——遇到一个有趣的角色',
        rest: '安全的休息点——可以短休恢复HP，也是搭档间的温馨时刻',
    };

    return `${userName}和搭档进入了第 ${roomNumber}/${totalRooms} 个房间。
房间类型：${typeDesc[roomType] || '未知'}
请描述这个房间的场景，然后给出行动选项。
${roomType === 'rest' ? '这是一个休息点，让搭档表现出轻松和温柔，创造一个温馨的互动场景。' : ''}`;
}

/**
 * Build prompt for when the player chooses an action with a dice result.
 */
export function buildActionResultPrompt(actionText, diceResult) {
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';

    return `${userName}选择了行动：「${actionText}」

骰子结果：${diceResult.summary}

请根据这个结果：
1. 【DM叙事】描述这个行动的结果（成功或失败的具体叙事化表现）
2. 【${charName}】让搭档对这个结果做出人设反应${diceResult.isNat20 ? '（Nat 20！搭档应该特别兴奋）' : ''}${diceResult.isNat1 ? '（Nat 1！搭档可以吐槽或安慰）' : ''}
3. 【行动选项】给出下一步的行动选项

${diceResult.success ? '行动成功了！' : '行动失败了。'}`;
}

/**
 * Build prompt for combat — player's attack result.
 */
export function buildCombatAttackPrompt(attackResult, damageResult, targetName, enemy) {
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';

    let prompt = `${userName}对 ${targetName} 发起攻击！

攻击判定：${attackResult.summary}`;

    if (attackResult.hit && damageResult) {
        prompt += `\n伤害：${damageResult.detail}`;
        if (attackResult.isCritical) {
            prompt += ` (暴击！骰子翻倍！)`;
        }
    }

    // Explicit enemy HP state to prevent LLM hallucination
    if (enemy) {
        if (enemy.isDead || enemy.currentHP <= 0) {
            prompt += `\n\n★ ${targetName}已被击败！HP归零！`;
        } else {
            prompt += `\n\n${targetName}剩余 HP：${enemy.currentHP}/${enemy.maxHP}（尚未被击败，还在战斗中）`;
        }
    }

    const killed = enemy && (enemy.isDead || enemy.currentHP <= 0);

    prompt += `\n\n请根据这个结果：
1. 【DM叙事】描述这次攻击的画面（${attackResult.hit ? '命中' : '未命中'}）${attackResult.isCritical ? '，这是暴击！请描述一个华丽的暴击场面！' : ''}${attackResult.isNat1 ? '，这是大失败！请描述一个搞笑的失误场面！' : ''}${killed ? '，敌人已经被击败了！' : ''}
2. 【${charName}】搭档的反应

注意：不要描述敌人的反击，也不需要给出行动选项，敌人回合和行动按钮由前端系统处理。${!killed ? `敌人${targetName}还没死，不要描述敌人倒下或被击败。` : ''}`;

    return prompt;
}

/**
 * Build prompt for partner's action decision.
 */
export function buildPartnerActionPrompt(playerChar, partnerChar, combatSituation) {
    const charName = getPhoneCharInfo()?.name || '角色';

    return `现在轮到搭档 ${charName} 行动了。

当前战斗情况：${combatSituation}
${charName}的HP：${partnerChar.currentHP}/${partnerChar.maxHP}
玩家的HP：${playerChar.currentHP}/${playerChar.maxHP}

请以${charName}的人设来决定ta的行动，并描述过程。
${charName}应该根据当前情况做出合理的战术决策：
- 如果玩家受伤严重且${charName}会治疗法术→ 治疗
- 如果${charName}是战士型→ 优先攻击
- 如果敵人很强→ 可能使用协助(Help)给玩家加优势
注意：${charName}的骰子结果也由前端掷出，稍后会提供。现在只需要声明${charName}要做什么行动。`;
}

/**
 * Build prompt for adventure conclusion.
 */
export function buildConclusionPrompt(result, highlightMoments) {
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';

    return `冒险${result === 'victory' ? '胜利' : result === 'defeat' ? '失败' : '撤退'}！

${highlightMoments ? `精彩瞬间：${highlightMoments}` : ''}

请写一段冒险结束的叙事：
1. 【DM叙事】描述冒险的结束场景
2. 【${charName}】${charName}对这次冒险的感想，跟${userName}聊这次桌游体验
   - 可以回顾有趣的瞬间
   - 保持桌游的轻松氛围
   - 表达作为恋人的温柔
   - 拒绝OOC，保持人物的设定和性格不变

回复格式：纯文字，JSON格式：
\`\`\`json
{
  "narrative": "DM的结束叙事",
  "partnerDialogue": "${charName}的台词",
  "highlight": "最精彩的一个瞬间（一句话总结）"
}
\`\`\``;
}

/**
 * Build prompt for partner character generation.
 * LLM picks race/class based on partner's personality.
 */
export async function buildPartnerCharGenPrompt(playerCharacter) {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '角色';
    const userPersona = getPhoneUserPersona();
    const worldBookContext = await getPhoneWorldBookContext();
    const foundation = getCoreFoundationPrompt();
    const userName = getPhoneUserName();

    const raceList = RACES.map(r => `${r.id}: ${r.name}(${r.nameEn}) - ${r.description}`).join('\n');
    const classList = CLASSES.map(c => `${c.id}: ${c.name}(${c.nameEn}) - ${c.description}`).join('\n');

    // Player's already-chosen character for partner to comment on
    const playerRace = playerCharacter ? RACES.find(r => r.id === playerCharacter.race) : null;
    const playerClass = playerCharacter ? CLASSES.find(c => c.id === playerCharacter.class) : null;
    const playerChoiceInfo = playerRace && playerClass
        ? `\n玩家${userName}已经选择了：${playerRace.name}(${playerRace.nameEn}) ${playerClass.name}(${playerClass.nameEn})。请在回复中也评价一下她的选择！`
        : '';

    return {
        system: `${foundation}

你和玩家${userName}正准备一起玩桌游「龙与地下城」。现在轮到你选择自己的角色了。
${charInfo?.description ? `你的人设：\n${charInfo.description}` : ''}
${userPersona ? `\n关于玩家：\n${userPersona}` : ''}
${worldBookContext ? `\n世界观与设定：\n${worldBookContext}` : ''}
${playerChoiceInfo}

可选种族：
${raceList}

可选职业：
${classList}

请以${charName}的人设和说话方式，写一段翻阅《玩家手册》时的思考独白（100-200字）。
思考过程要自然、有角色特色，像真的在桌游桌前犹豫选择一样：
- 可以提到排除了哪些选项、为什么
- 表达对最终选择的兴奋
- 可以跟${userName}聊几句（"你觉得我选这个怎么样？"）

绝对不要使用 Markdown 语法加粗文字（不要输出 **文字**）。

返回 JSON 格式：
\`\`\`json
{
  "raceId": "种族ID",
  "classId": "职业ID",
  "thinking": "思考独白（100-200字，用${charName}的口吻）",
  "playerComment": "对${userName}选择的评价（40-80字，可以表达惊讶、称赞、调侃等，用${charName}的口吻）"
}
\`\`\``,
        user: `请为${charName}选择种族和职业，写出思考过程，并评价${userName}的选择。返回 JSON。`,
    };
}

/**
 * Build prompt for a custom / free-form player action.
 * The DM narrates the action's setup and provides new options with checks.
 */
export function buildCustomActionPrompt(actionText) {
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';

    return `${userName}自由行动：「${actionText}」

玩家（${userName}）选择了一个自由行动而不是预设选项。请以 DM 身份处理：
1. 【DM叙事】描述${userName}开始执行这个行动的场景（不要描述最终结果，因为可能需要骰子检定）
2. 【${charName}】搭档对这个行动的反应
3. 【行动选项】给出 2-4 个后续选项：
   - 如果这个行动需要检定，第一个选项应该是执行这个行动本身，标注检定类型和 DC（如 [力量检定 DC 12]）
   - 同时提供其他备选行动
   - 如果这个行动完全不需要检定（如对话、观察等），直接描述结果并给出后续选项`;
}

/**
 * Build prompt for combat room — initial description with enemies.
 */
export function buildCombatRoomPrompt(roomNumber, totalRooms, enemies, initiativeSummary, isBoss) {
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';

    const enemyList = enemies.map(e =>
        `${e.name}(${e.nameEn}) HP:${e.maxHP} AC:${e.ac}${e.special ? ` 特殊能力:${e.special}` : ''}`
    ).join('、');

    return `${userName}和${charName}进入了${isBoss ? '最终 Boss' : '第 ' + roomNumber + '/' + totalRooms + ' 个'}房间！

${isBoss ? '这是最终Boss战！' : '遭遇了敌人！'}
敌人：${enemyList}

先攻顺序：${initiativeSummary}

请描述：
1. 【DM叙事】${isBoss ? '一个令人印象深刻的Boss登场场景' : '敌人出现的场景'}——描述环境和敌人的外貌、态势（100-150字）
2. 【${charName}】搭档的反应——${isBoss ? '紧张又兴奋' : '准备战斗'},用ta的人设风格

不需要给出行动选项，前端会自动提供战斗行动按钮。`;
}

/**
 * Build prompt for enemy attack narration.
 */
export function buildEnemyAttackNarrationPrompt(enemy, target, attackResult, damageResult) {
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';
    const targetName = target === 'player' ? userName : charName;

    let prompt = `敌人 ${enemy.name} 攻击了 ${targetName}！

攻击判定：${attackResult.summary}`;

    if (attackResult.hit && damageResult) {
        prompt += `\n伤害：${damageResult.detail}`;
    }

    prompt += `\n\n请简洁叙述（50-80字）：
1. 【DM叙事】描述${enemy.name}的攻击动作和结果${attackResult.hit ? '' : '（未命中）'}${attackResult.isCritical ? '（暴击！）' : ''}
2. 【${charName}】搭档的简短反应`;

    return prompt;
}

/**
 * Build prompt for partner turn narration.
 */
export function buildPartnerTurnNarrationPrompt(actionType, attackResult, damageResult, healResult, enemy) {
    const charName = getPhoneCharInfo()?.name || '角色';
    const userName = getPhoneUserName();

    if (actionType === 'heal') {
        return `${charName}使用治疗法术治疗了${userName}！
恢复了 ${healResult.healAmount} HP（${healResult.hpBefore} → ${healResult.hpAfter}）

请简洁叙述（50-80字）：
1. 【${charName}】用ta的人设风格描述施法治疗的过程和关心${userName}的台词`;
    }

    let prompt = `${charName}攻击了${enemy?.name || '敌人'}！

攻击判定：${attackResult.summary}`;

    if (attackResult.hit && damageResult) {
        prompt += `\n伤害：${damageResult.detail}`;
    }

    // Explicit enemy HP state
    const killed = enemy && (enemy.isDead || enemy.currentHP <= 0);
    if (enemy) {
        if (killed) {
            prompt += `\n\n★ ${enemy.name}已被击败！HP归零！`;
        } else {
            prompt += `\n\n${enemy.name}剩余 HP：${enemy.currentHP}/${enemy.maxHP}（还活着）`;
        }
    }

    prompt += `\n\n请简洁叙述（50-80字）：
1. 【${charName}】${charName}的攻击动作描述和台词，用ta的人设风格${killed ? '，可以庆祝击杀' : ''}
注意：${!killed ? `${enemy?.name || '敌人'}还没死，不要说敌人被击败。` : ''}不要给出行动选项。`;

    return prompt;
}

/**
 * Build prompt for death save narration.
 */
export function buildDeathSaveNarrationPrompt(who, result, currentSaves) {
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';
    const whoName = who === 'player' ? userName : charName;
    const otherName = who === 'player' ? charName : userName;

    return `${whoName}已经倒下，正在进行死亡豁免！

骰子结果：${result.description}
当前状态：成功 ${currentSaves.successes}/3 | 失败 ${currentSaves.failures}/3
${result.result === 'nat20' ? `★ Nat 20！${whoName}恢复了1点HP，重新站起来了！` : ''}
${result.result === 'nat1' ? `✗ Nat 1！算作两次失败！` : ''}

请简洁叙述（40-60字）：
1. 【${otherName}】${otherName}看到${whoName}${result.result === 'nat20' ? '奇迹般站起来' : result.result.includes('success') ? '还在坚持' : '情况危急'}的紧张反应`;
}

/**
 * Build prompt for spell cast narration.
 */
export function buildSpellCastPrompt(casterName, spellResult, isPartner = false) {
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';
    const who = isPartner ? charName : userName;
    const other = isPartner ? userName : charName;
    const spell = spellResult.spell;

    let details = `${who}施放了「${spell.name}(${spell.nameEn})」！`;

    if (spellResult.damageResult) {
        details += `\n伤害：${spellResult.damageResult.detail || spellResult.damageResult.total}`;
        if (spellResult.killed) details += `\n${spellResult.targetName} 被击败了！`;
    } else if (spellResult.aoe) {
        details += `\n${spellResult.message}`;
    } else if (spellResult.healResult) {
        details += `\n${spellResult.message}`;
    } else if (spellResult.buffEffect) {
        details += `\n效果：${spell.description}`;
    }

    if (spellResult.slotUsed) details += `\n（消耗了一个${spell.level}级法术位）`;

    return `${details}\n\n请简洁叙述（50-80字）：
1. 【DM叙事】描述${who}施法的华丽画面
2. 【${isPartner ? charName : other}】${isPartner ? charName + '施法时的台词' : other + '看到' + who + '施法后的反应'}`;
}

/**
 * Build prompt for class ability use narration.
 */
export function buildAbilityUsePrompt(casterName, abilityResult, isPartner = false) {
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';
    const who = isPartner ? charName : userName;
    const other = isPartner ? userName : charName;
    const ability = abilityResult.ability;

    let details = `${who}使用了职业能力「${ability.name}(${ability.nameEn})」！`;

    if (abilityResult.healResult) {
        details += `\n${abilityResult.message}`;
    } else if (abilityResult.extraAttackGranted) {
        details += `\n效果：本回合获得额外一次攻击！`;
    } else if (abilityResult.attackResult) {
        details += `\n${abilityResult.message}`;
    } else {
        details += `\n效果：${ability.description}`;
    }

    return `${details}\n\n请简洁叙述（50-80字）：
1. 【DM叙事】描述${who}释放${ability.name}的画面
2. 【${isPartner ? charName : other}】${isPartner ? charName + '使用能力时的台词' : other + '看到' + who + '使用能力后的反应'}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Round Batch Prompt — Consolidated auto-turn narration
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build a single prompt covering all auto-turn results in a round.
 * Replaces per-turn prompts (enemy/partner) with one batched call.
 * @param {Array<object>} roundBatch — array of batch entries
 * @returns {string}
 */
export function buildRoundBatchPrompt(roundBatch) {
    const charName = getPhoneCharInfo()?.name || '角色';
    const userName = getPhoneUserName();

    let actionSummary = '本轮自动回合发生了以下行动：\n\n';
    let hasDramatic = false; // track crits / kills for emphasis hint

    for (const entry of roundBatch) {
        if (entry.type === 'enemy_attack') {
            const targetLabel = entry.target === 'player' ? userName : charName;
            actionSummary += `● ${entry.enemyName} 攻击 ${targetLabel}：${entry.attackSummary}`;
            if (entry.hit && entry.damageSummary) {
                actionSummary += `，伤害 ${entry.damageSummary}`;
                if (entry.targetDowned) {
                    actionSummary += `——${targetLabel}倒下了！`;
                    hasDramatic = true;
                }
            }
            if (entry.isCritical) hasDramatic = true;
            actionSummary += '\n';
        } else if (entry.type === 'partner_ability') {
            actionSummary += `● ${charName} 使用「${entry.abilityName}」：${entry.message}\n`;
        } else if (entry.type === 'partner_attack') {
            actionSummary += `● ${charName} 攻击 ${entry.enemyName}：${entry.attackSummary}`;
            if (entry.hit && entry.damageSummary) {
                actionSummary += `，伤害 ${entry.damageSummary}`;
            }
            if (entry.killed) {
                actionSummary += `——${entry.enemyName}被击败了！`;
                hasDramatic = true;
            }
            if (entry.isCritical) hasDramatic = true;
            actionSummary += '\n';
        } else if (entry.type === 'partner_heal') {
            actionSummary += `● ${charName} 施放治疗术：恢复 ${entry.healAmount} HP（${entry.hpBefore} → ${entry.hpAfter}）\n`;
        } else if (entry.type === 'partner_potion') {
            const potionTarget = entry.target === 'player' ? userName : charName + '自己';
            actionSummary += `● ${charName} 给${potionTarget}喝下治疗药水：恢复 ${entry.healAmount} HP（${entry.hpBefore} → ${entry.hpAfter}）\n`;
        } else if (entry.type === 'partner_spell') {
            actionSummary += `● ${charName} 施放「${entry.spellName}」：${entry.message}`;
            if (entry.killed) {
                actionSummary += `——${entry.targetName}被击败了！`;
                hasDramatic = true;
            }
            actionSummary += '\n';
        } else if (entry.type === 'death_save') {
            const whoName = entry.who === 'player' ? userName : charName;
            actionSummary += `● ${whoName} 死亡豁免：${entry.description}（成功 ${entry.successes}/3 | 失败 ${entry.failures}/3）`;
            if (entry.revived) { actionSummary += `——奇迹般站起来了！`; hasDramatic = true; }
            if (entry.dead) { actionSummary += `——永远倒下了……`; hasDramatic = true; }
            actionSummary += '\n';
        }
    }

    actionSummary += `\n请用一段紧凑的叙事覆盖以上所有行动：
1. 【DM叙事】按时间顺序描述每个行动的画面（80-150字）${hasDramatic ? '，暴击/击杀等戏剧性事件请重点渲染！' : ''}
2. 【${charName}】搭档在本轮中的台词和反应

不需要给出行动选项，前端会自动提供战斗行动按钮。`;

    return actionSummary;
}

/**
 * Build prompt for room transition summary — compress the current room's narrative into a digest.
 * @param {Array<{type:string, text:string}>} narrativeEntries — narrativeLog entries for this room
 * @param {number} roomNumber
 * @param {string} roomType
 * @returns {string}
 */
export function buildRoomSummaryPrompt(narrativeEntries, roomNumber, roomType) {
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';

    const logText = narrativeEntries
        .map(e => {
            const prefix = e.type === 'dm' ? 'DM' : e.type === 'dice' ? '🎲' : e.type === 'partner' ? charName : e.type === 'system' ? '⚙' : '>>';
            return `${prefix}: ${e.text}`;
        })
        .join('\n');

    return `请将以下房间 ${roomNumber}（${roomType}）的冒险日志压缩为 100-200 字的总结。
保留关键事件（战斗结果、获得/失去的物品、重要对话、剧情转折）。
不要添加你自己的想象，只总结实际发生的事。
用简洁的叙事风格，第三人称。

--- 日志开始 ---
${logText}
--- 日志结束 ---

直接输出总结文本，不要加标题或格式。`;
}

// ═══════════════════════════════════════════════════════════════════════
// Structured Room Prompts — Phase 2: Exploration System
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build prompt for trap room — initial description.
 */
export function buildTrapRoomPrompt(trap, roomNumber, totalRooms) {
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';

    return `${userName}和${charName}进入了第 ${roomNumber}/${totalRooms} 个房间。

房间类型：陷阱！
陷阱：${trap.name}（${trap.nameEn}）
陷阱描述场景：${trap.description}

请描述：
1. 【DM叙事】生动描述陷阱触发的场景和紧张气氛（80-120字）
2. 【${charName}】搭档发现陷阱时的紧张反应

不需要给出行动选项，前端会提供应对按钮。`;
}

/**
 * Build prompt for trap check result.
 */
export function buildTrapResultPrompt(trap, chosenOption, checkResult, damageTaken) {
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';

    const resultText = checkResult.success
        ? `${userName}选择了「${chosenOption.text}」，${checkResult.summary}，成功应对了陷阱！`
        : `${userName}选择了「${chosenOption.text}」，${checkResult.summary}，未能应对——受到了 ${damageTaken} 点${trap.damageType}伤害！`;

    return `${resultText}

请描述：
1. 【DM叙事】描述${userName}${checkResult.success ? '漂亮地' : '未能'}应对${trap.name}的画面（60-100字）${checkResult.isNat20 ? '，这是 Nat 20！描述一个超帅的应对场面！' : ''}${checkResult.isNat1 ? '，这是 Nat 1！描述一个特别倒霉的场面！' : ''}
2. 【${charName}】搭档的反应${checkResult.success ? '（可以夸奖或松一口气）' : '（关心${userName}的伤势）'}

不需要给出行动选项，前端会提供继续按钮。`;
}

/**
 * Build prompt for NPC encounter — initial description.
 */
export function buildNPCEncounterPrompt(npc, roomNumber, totalRooms) {
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';

    return `${userName}和${charName}进入了第 ${roomNumber}/${totalRooms} 个房间，遇到了一个NPC！

NPC：${npc.name}（${npc.nameEn}）
性格：${npc.personality}

请描述：
1. 【DM叙事】描述这个NPC出现的场景和外貌（80-120字）
2. 【${charName}】搭档看到NPC时的反应

不需要给出行动选项，前端会提供交互按钮。`;
}

/**
 * Build prompt for NPC interaction result.
 */
export function buildNPCInteractionResultPrompt(npc, actionType, checkResult, reward) {
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';

    let actionDesc = '';
    switch (actionType) {
        case 'talk':
            actionDesc = checkResult?.success
                ? `${userName}友好地与${npc.name}交谈，${checkResult.summary}——成功获得了对方的信任！\n情报：「${npc.infoReward}」`
                : `${userName}尝试交谈，${checkResult?.summary}——但${npc.name}似乎不太想聊。`;
            break;
        case 'threaten':
            actionDesc = checkResult?.success
                ? `${userName}威胁恐吓${npc.name}，${checkResult.summary}——对方被吓住了，交出了一些物品！`
                : `${userName}试图威胁，${checkResult?.summary}——但${npc.name}并不买账。`;
            break;
        case 'ignore':
            actionDesc = `${userName}决定忽略${npc.name}，继续前进。`;
            break;
        default:
            actionDesc = `${userName}与${npc.name}进行了互动。`;
    }

    return `${actionDesc}

请描述：
1. 【DM叙事】描述这次互动的过程和结果（60-100字）
2. 【${charName}】搭档对${userName}做法的反应

不需要给出行动选项，前端会提供继续按钮。`;
}

/**
 * Build prompt for treasure room — initial description.
 */
export function buildTreasureRoomPrompt(roomNumber, totalRooms) {
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';

    return `${userName}和${charName}进入了第 ${roomNumber}/${totalRooms} 个房间，发现了一个宝箱！

请描述：
1. 【DM叙事】描述宝箱或宝物所在的场景（80-120字）——让氛围既诱人又有些紧张（也许有陷阱？）
2. 【${charName}】搭档看到宝箱时的兴奋反应

不需要给出行动选项，前端会自动处理宝箱开启。`;
}

/**
 * Build prompt for treasure result.
 */
export function buildTreasureResultPrompt(perceptionResult, loot, trapDetected, hiddenRoom) {
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';

    let resultText = '';
    if (perceptionResult?.success && trapDetected) {
        resultText += `${userName}的察觉检定 ${perceptionResult.summary}——发现了宝箱上的陷阱并成功避开！\n`;
    } else if (!perceptionResult?.success && trapDetected) {
        resultText += `${userName}没有注意到宝箱上的陷阱……\n`;
    }

    resultText += `开箱获得：${loot.join('、')}`;
    if (hiddenRoom) {
        resultText += `\n而且发现了一个隐藏房间，额外获得了宝物！`;
    }

    return `${resultText}

请描述：
1. 【DM叙事】描述开箱的画面和获得的宝物（60-100字）${hiddenRoom ? '，以及发现隐藏密室的惊喜！' : ''}
2. 【${charName}】搭档的兴奋反应

不需要给出行动选项，前端会提供继续按钮。`;
}

/**
 * Build prompt for rest room — cozy scene.
 */
export function buildRestRoomPrompt(roomNumber, totalRooms, healAmount) {
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';

    return `${userName}和${charName}进入了第 ${roomNumber}/${totalRooms} 个房间，这是一个安全的休息点。
你们自动进行了短休，恢复了 ${healAmount} HP。

请描述：
1. 【DM叙事】描述一个温馨安全的休息场景（80-120字）——篝火、干净的水源、舒适的角落
2. 【${charName}】这是搭档放松和温柔的时刻。让搭档跟${userName}聊天，关心对方的状态，展现恋人之间的甜蜜

不需要给出行动选项，前端会提供选项按钮。`;
}

/**
 * Build prompt for rest room search result.
 */
export function buildRestSearchResultPrompt(searchResult, foundItem) {
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';

    const resultText = searchResult.success
        ? `${userName}仔细搜索了周围，${searchResult.summary}——${foundItem ? `发现了：${foundItem}！` : '发现了一些有趣的东西！'}`
        : `${userName}搜索了周围，${searchResult.summary}——但没有发现什么特别的东西。`;

    return `${resultText}

请简洁描述（50-80字）：
1. 【DM叙事】搜索过程${searchResult.success ? '和发现' : ''}
2. 【${charName}】搭档的反应

不需要给出行动选项，前端会提供继续按钮。`;
}

// ═══════════════════════════════════════════════════════════════════════
// Formatting Helpers
// ═══════════════════════════════════════════════════════════════════════

function _formatStats(stats) {
    return Object.entries(stats)
        .map(([key, val]) => {
            const mod = Math.floor((val - 10) / 2);
            const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
            return `${ABILITY_NAMES[key]?.name || key} ${val}(${modStr})`;
        })
        .join(' | ');
}

function _formatSpellSlots(current, max) {
    if (!current || !max) return '无';
    return Object.entries(max).map(([key, total]) => {
        const remaining = current[key] ?? 0;
        return `${key}: ${remaining}/${total}`;
    }).join(' | ');
}

function _formatMonsters(campaign) {
    const monsters = campaign.encounterTable.combat.map(m =>
        `- ${m.name}(${m.nameEn}) CR:${m.cr} | AC:${m.ac} HP:${m.hp} | 攻击:${m.attack} 伤害:${m.damage}${m.special ? ` | 特殊:${m.special}` : ''}`
    );
    const bosses = campaign.encounterTable.boss.map(b =>
        `- ★BOSS★ ${b.name}(${b.nameEn}) CR:${b.cr} | AC:${b.ac} HP:${b.hp} | 攻击:${b.attack} 伤害:${b.damage}${b.special ? ` | 特殊:${b.special}` : ''}`
    );
    return [...monsters, ...bosses].join('\n');
}

/**
 * Build the narrative context section for the system prompt.
 * Includes room summaries (adventure recap) and recent narrative entries.
 * @param {object} [ctx] — { recentEntries: Array<{type, text}>, roomSummaries: string[] }
 * @returns {string}
 */
function _buildNarrativeContextSection(ctx) {
    if (!ctx) return '';
    const parts = [];

    // Room summaries — previous rooms' compressed narratives
    if (ctx.roomSummaries && ctx.roomSummaries.length > 0) {
        const summaryLines = ctx.roomSummaries
            .map((s, i) => `房间${i + 1}：${s}`)
            .join('\n');
        parts.push(`### 冒险回顾（之前的房间）\n${summaryLines}`);
    }

    // Recent narrative — last ~20 entries from the current room/combat
    if (ctx.recentEntries && ctx.recentEntries.length > 0) {
        const charName = getPhoneCharInfo()?.name || '角色';
        const lines = ctx.recentEntries.map(e => {
            const prefix = e.type === 'dm' ? 'DM' : e.type === 'dice' ? '🎲' : e.type === 'partner' ? charName : e.type === 'system' ? '⚙' : '>>';
            return `${prefix}: ${e.text}`;
        }).join('\n');
        parts.push(`### 最近发生的事\n${lines}`);
    }

    return parts.join('\n\n');
}

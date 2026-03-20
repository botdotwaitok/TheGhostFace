// modules/phone/dnd/dndExploration.js — Structured Exploration Room Handlers
// Extracted from dndApp.js: Trap, NPC, Treasure, and Rest room flows.

import { getPhoneCharInfo, getPhoneUserName } from '../phoneContext.js';
import { callPhoneLLM } from '../../api.js';
import {
    loadDndData, saveDndData, getCurrentRun,
    appendNarrative, addLoot, getNarrativeContext,
} from './dndStorage.js';
import {
    ABILITY_NAMES, SKILLS, CLASSES,
    getItemInfo,
} from './dndCharacter.js';
import {
    abilityCheck, damageRoll, roll, abilityModifier,
} from './dndDice.js';
import {
    getCampaignById, pickRandomLoot,
    pickRandomTrap, pickRandomNPC,
} from './dndCampaigns.js';
import {
    buildDMSystemPrompt,
    buildTrapRoomPrompt, buildTrapResultPrompt,
    buildNPCEncounterPrompt, buildNPCInteractionResultPrompt,
    buildTreasureRoomPrompt, buildTreasureResultPrompt,
    buildRestRoomPrompt, buildRestSearchResultPrompt,
} from './dndPromptBuilder.js';
import {
    esc, setActions, refreshNarrative, refreshHPBars,
    isProcessing, setProcessing, showRerollButton,
} from './dndUI.js';

const DND_LOG = '[D&D]';

/**
 * Smart loot: auto-detect currency items and add gold directly,
 * otherwise add to inventory as usual.
 * @param {string} item — loot name from pickRandomLoot
 * @returns {{ isCurrency: boolean, goldAmount: number }}
 */
function _addLootSmart(item) {
    const info = getItemInfo(item);
    if (info.type === 'currency') {
        const goldAmount = info.effect?.gold || 0;
        if (goldAmount > 0) {
            const data = loadDndData();
            if (data.playerCharacter) {
                data.playerCharacter.gold = (data.playerCharacter.gold || 0) + goldAmount;
                saveDndData(data);
            }
            return { isCurrency: true, goldAmount };
        }
    }
    addLoot(item);
    return { isCurrency: false, goldAmount: 0 };
}

// ═══════════════════════════════════════════════════════════════════════
// Trap Room
// ═══════════════════════════════════════════════════════════════════════

/**
 * Handle TRAP room: pick trap → LLM intro → show response buttons → dice check → result.
 * @param {Function} processCombatNarration - parser for LLM combat narration
 * @param {Function} showContinueButtons - show next-room / finish buttons
 */
export async function handleTrapRoom(data, campaign, roomNumber, totalRooms, processCombatNarration, showContinueButtonsFn) {
    const trap = pickRandomTrap(campaign);
    appendNarrative('system', `陷阱：${trap.name}（${trap.nameEn}）`);

    setActions('<div class="dnd-loading"><i class="ph ph-warning"></i> 陷阱触发中...</div>');

    try {
        const systemPrompt = await buildDMSystemPrompt({
            playerChar: data.playerCharacter, partnerChar: data.partnerCharacter,
            campaign, currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
        });
        const userPrompt = buildTrapRoomPrompt(trap, roomNumber, totalRooms);
        const response = await callPhoneLLM(systemPrompt, userPrompt);
        processCombatNarration(response);
    } catch (err) {
        console.error(`${DND_LOG} Trap intro narration failed:`, err);
        appendNarrative('dm', trap.description);
    }

    refreshNarrative();

    // Show response option buttons
    const optionBtns = trap.options.map((opt, i) => {
        const abilityName = ABILITY_NAMES[opt.ability]?.name || opt.ability;
        return `<button class="dnd-action-btn dnd-trap-option" data-trap-idx="${i}">
            <i class="ph ${ABILITY_NAMES[opt.ability]?.icon || 'ph-dice-five'}"></i>
            <span>${esc(opt.text)}</span>
            <span class="dnd-action-check">${abilityName} DC${opt.dc}</span>
        </button>`;
    }).join('');

    setActions(`
        <div class="dnd-turn-indicator dnd-trap-indicator">
            <i class="ph ph-warning"></i> 选择应对方式
        </div>
        ${optionBtns}
    `);

    setProcessing(false);

    // Bind trap option clicks
    document.querySelectorAll('.dnd-trap-option').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (isProcessing()) return;
            setProcessing(true);
            const idx = parseInt(btn.dataset.trapIdx);
            const option = trap.options[idx];
            await _resolveTrapCheck(data, campaign, trap, option, processCombatNarration, showContinueButtonsFn);
        });
    });
}

async function _resolveTrapCheck(data, campaign, trap, chosenOption, processCombatNarration, showContinueButtonsFn) {
    const playerChar = data.playerCharacter;
    const score = playerChar.stats[chosenOption.ability] || 10;
    const profSkills = playerChar.proficientSkills || [];
    const proficient = profSkills.some(s => SKILLS[s]?.ability === chosenOption.ability);

    const checkResult = abilityCheck(score, proficient, playerChar.proficiencyBonus, chosenOption.dc);

    appendNarrative('dice', checkResult.summary);

    let damageTaken = 0;
    if (!checkResult.success) {
        const dmgResult = damageRoll(trap.damage);
        damageTaken = dmgResult.total;
        const hpBefore = playerChar.currentHP;
        playerChar.currentHP = Math.max(0, hpBefore - damageTaken);
        saveDndData(data);
        appendNarrative('dice', `受到 ${damageTaken} 点${trap.damageType}伤害 (${hpBefore} → ${playerChar.currentHP})`);
        refreshHPBars();
    } else {
        appendNarrative('system', '成功避开了陷阱！');
    }

    refreshNarrative();
    setActions('<div class="dnd-loading"><i class="ph ph-sparkle"></i> DM 正在描述...</div>');

    try {
        const freshData = loadDndData();
        const systemPrompt = await buildDMSystemPrompt({
            playerChar: freshData.playerCharacter, partnerChar: freshData.partnerCharacter,
            campaign, currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
        });
        const userPrompt = buildTrapResultPrompt(trap, chosenOption, checkResult, damageTaken);
        const response = await callPhoneLLM(systemPrompt, userPrompt);
        processCombatNarration(response);
    } catch (err) {
        console.error(`${DND_LOG} Trap result narration failed:`, err);
    }

    refreshNarrative();
    showContinueButtonsFn();
    setProcessing(false);
}

// ═══════════════════════════════════════════════════════════════════════
// NPC Room
// ═══════════════════════════════════════════════════════════════════════

export async function handleNPCRoom(data, campaign, roomNumber, totalRooms, processCombatNarration, showContinueButtonsFn) {
    const npc = pickRandomNPC(campaign);
    appendNarrative('system', `遭遇NPC：${npc.name}（${npc.nameEn}）`);

    setActions('<div class="dnd-loading"><i class="ph ph-chat-circle"></i> 遭遇NPC...</div>');

    try {
        const systemPrompt = await buildDMSystemPrompt({
            playerChar: data.playerCharacter, partnerChar: data.partnerCharacter,
            campaign, currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
        });
        const userPrompt = buildNPCEncounterPrompt(npc, roomNumber, totalRooms);
        const response = await callPhoneLLM(systemPrompt, userPrompt);
        processCombatNarration(response);
    } catch (err) {
        console.error(`${DND_LOG} NPC intro narration failed:`, err);
        appendNarrative('dm', `你们遇到了${npc.name}——${npc.personality}`);
    }

    refreshNarrative();

    const playerGold = data.playerCharacter?.gold || 0;
    const btnsHtml = `
        <div class="dnd-turn-indicator dnd-npc-indicator">
            <i class="ph ph-chat-circle"></i> 如何与${esc(npc.name)}互动？
        </div>
        <button class="dnd-action-btn dnd-npc-action" data-npc-action="talk">
            <i class="ph ph-chat-dots"></i>
            <span>友好交谈</span>
            <span class="dnd-action-check">魅力 DC10</span>
        </button>
        <button class="dnd-action-btn dnd-npc-action" data-npc-action="threaten">
            <i class="ph ph-warning-circle"></i>
            <span>威胁恐吓</span>
            <span class="dnd-action-check">魅力 DC14</span>
        </button>
        <button class="dnd-action-btn dnd-npc-action" data-npc-action="trade">
            <i class="ph ph-storefront"></i>
            <span>交易物品</span>
            <span class="dnd-action-check">${playerGold} gp</span>
        </button>
        <button class="dnd-action-btn dnd-npc-action" data-npc-action="ignore">
            <i class="ph ph-sign-out"></i>
            <span>忽略离开</span>
        </button>`;

    setActions(btnsHtml);
    setProcessing(false);

    document.querySelectorAll('.dnd-npc-action').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (isProcessing()) return;
            setProcessing(true);
            const action = btn.dataset.npcAction;

            if (action === 'trade') {
                setProcessing(false);
                _showNPCShop(data, campaign, npc, roomNumber, totalRooms, processCombatNarration, showContinueButtonsFn);
                return;
            }

            await _resolveNPCInteraction(data, campaign, npc, action, processCombatNarration, showContinueButtonsFn);
        });
    });
}

async function _resolveNPCInteraction(data, campaign, npc, actionType, processCombatNarration, showContinueButtonsFn) {
    const playerChar = data.playerCharacter;
    let checkResult = null;
    let reward = null;

    if (actionType === 'talk') {
        const score = playerChar.stats.CHA || 10;
        const proficient = playerChar.proficientSkills?.some(s => SKILLS[s]?.ability === 'CHA') || false;
        checkResult = abilityCheck(score, proficient, playerChar.proficiencyBonus, 10);
        appendNarrative('dice', `魅力检定：${checkResult.summary}`);

        if (checkResult.success) {
            reward = npc.infoReward;
            appendNarrative('system', `情报：${reward}`);
            if (npc.shopItems?.length > 0 && Math.random() < 0.3) {
                const giftItem = npc.shopItems[0].name;
                playerChar.inventory.push(giftItem);
                saveDndData(data);
                appendNarrative('system', `${npc.name}赠送了：${giftItem}`);
            }
        }
    } else if (actionType === 'threaten') {
        const score = playerChar.stats.CHA || 10;
        const proficient = playerChar.proficientSkills?.some(s => SKILLS[s]?.ability === 'CHA') || false;
        checkResult = abilityCheck(score, proficient, playerChar.proficiencyBonus, 14);
        appendNarrative('dice', `魅力检定（威胁）：${checkResult.summary}`);

        if (checkResult.success && npc.shopItems?.length > 0) {
            const stolenItem = npc.shopItems[Math.floor(Math.random() * npc.shopItems.length)].name;
            playerChar.inventory.push(stolenItem);
            saveDndData(data);
            appendNarrative('system', `获得：${stolenItem}`);
        }
    } else {
        appendNarrative('action', '>> 忽略NPC，继续前进');
    }

    refreshNarrative();
    setActions('<div class="dnd-loading"><i class="ph ph-sparkle"></i> DM 正在描述...</div>');

    try {
        const freshData = loadDndData();
        const systemPrompt = await buildDMSystemPrompt({
            playerChar: freshData.playerCharacter, partnerChar: freshData.partnerCharacter,
            campaign, currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
        });
        const userPrompt = buildNPCInteractionResultPrompt(npc, actionType, checkResult, reward);
        const response = await callPhoneLLM(systemPrompt, userPrompt);
        processCombatNarration(response);
    } catch (err) {
        console.error(`${DND_LOG} NPC interaction narration failed:`, err);
    }

    refreshNarrative();
    showContinueButtonsFn();
    setProcessing(false);
}

function _showNPCShop(data, campaign, npc, roomNumber, totalRooms, processCombatNarration, showContinueButtonsFn) {
    const playerChar = data.playerCharacter;
    const gold = playerChar?.gold || 0;

    const shopItems = (npc.shopItems || []).map(item => `
        <div class="dnd-shop-item ${gold < item.price ? 'disabled' : ''}" data-npc-shop="${esc(item.name)}" data-price="${item.price}">
            <i class="ph ph-package"></i>
            <div class="dnd-shop-item-info">
                <div class="dnd-shop-item-name">${esc(item.name)}</div>
            </div>
            <button class="dnd-shop-buy-btn" ${gold < item.price ? 'disabled' : ''} data-npc-shop="${esc(item.name)}" data-price="${item.price}">
                ${item.price} gp
            </button>
        </div>
    `).join('');

    const shopHtml = `
        <div class="dnd-turn-indicator dnd-npc-indicator">
            <i class="ph ph-storefront"></i> ${esc(npc.name)}的商品
            <span class="dnd-action-check"><i class="ph ph-coins"></i> ${gold} gp</span>
        </div>
        <div class="dnd-shop-list">${shopItems}</div>
        <button class="dnd-action-btn" id="dnd_npc_shop_done">
            <i class="ph ph-check"></i> 完成交易
        </button>`;

    setActions(shopHtml);

    document.querySelectorAll('.dnd-shop-buy-btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const itemName = btn.dataset.npcShop;
            const price = parseInt(btn.dataset.price);
            const freshData = loadDndData();
            const pc = freshData.playerCharacter;
            if (!pc || (pc.gold || 0) < price) return;

            pc.gold -= price;
            pc.inventory.push(itemName);
            saveDndData(freshData);
            appendNarrative('system', `购买了：${itemName}（-${price} gp）`);
            refreshNarrative();

            _showNPCShop(freshData, campaign, npc, roomNumber, totalRooms, processCombatNarration, showContinueButtonsFn);
        });
    });

    document.getElementById('dnd_npc_shop_done')?.addEventListener('click', async () => {
        if (isProcessing()) return;
        setProcessing(true);

        setActions('<div class="dnd-loading"><i class="ph ph-sparkle"></i> DM 正在描述...</div>');
        try {
            const freshData = loadDndData();
            const systemPrompt = await buildDMSystemPrompt({
                playerChar: freshData.playerCharacter, partnerChar: freshData.partnerCharacter,
                campaign, currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
            });
            const userPrompt = buildNPCInteractionResultPrompt(npc, 'trade', null, null);
            const response = await callPhoneLLM(systemPrompt, userPrompt);
            processCombatNarration(response);
        } catch (err) {
            console.error(`${DND_LOG} NPC trade narration failed:`, err);
        }

        refreshNarrative();
        showContinueButtonsFn();
        setProcessing(false);
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Treasure Room
// ═══════════════════════════════════════════════════════════════════════

export async function handleTreasureRoom(data, campaign, roomNumber, totalRooms, processCombatNarration, showContinueButtonsFn) {
    const playerChar = data.playerCharacter;

    setActions('<div class="dnd-loading"><i class="ph ph-treasure-chest"></i> 发现宝箱...</div>');

    try {
        const systemPrompt = await buildDMSystemPrompt({
            playerChar: data.playerCharacter, partnerChar: data.partnerCharacter,
            campaign, currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
        });
        const userPrompt = buildTreasureRoomPrompt(roomNumber, totalRooms);
        const response = await callPhoneLLM(systemPrompt, userPrompt);
        processCombatNarration(response);
    } catch (err) {
        console.error(`${DND_LOG} Treasure intro narration failed:`, err);
        appendNarrative('dm', '你们发现了一个古老的宝箱，上面布满了灰尘。');
    }

    refreshNarrative();

    // WIS perception check
    const wisScore = playerChar.stats.WIS || 10;
    const proficient = playerChar.proficientSkills?.includes('perception') || false;
    const perceptionResult = abilityCheck(wisScore, proficient, playerChar.proficiencyBonus, 12);
    appendNarrative('dice', `察觉检定：${perceptionResult.summary}`);

    const trapDetected = Math.random() < 0.4;
    let trapDamage = 0;
    if (trapDetected && !perceptionResult.success) {
        const dmg = damageRoll('1D4');
        trapDamage = dmg.total;
        const hpBefore = playerChar.currentHP;
        playerChar.currentHP = Math.max(0, hpBefore - trapDamage);
        saveDndData(data);
        appendNarrative('dice', `宝箱上有陷阱！受到 ${trapDamage} 点伤害 (${hpBefore} → ${playerChar.currentHP})`);
        refreshHPBars();
    } else if (trapDetected && perceptionResult.success) {
        appendNarrative('system', '发现了宝箱上的陷阱并成功避开！');
    }

    // Generate loot
    const lootCount = Math.random() < 0.4 ? 2 : 1;
    const loot = [];
    const lootMessages = [];
    for (let i = 0; i < lootCount; i++) {
        const item = pickRandomLoot(campaign);
        const result = _addLootSmart(item);
        if (result.isCurrency) {
            loot.push(`${result.goldAmount} gp`);
            lootMessages.push(`+${result.goldAmount} gp`);
        } else {
            loot.push(item);
            lootMessages.push(item);
        }
    }
    appendNarrative('system', `获得宝物：${lootMessages.join('、')}`);

    // INT check for hidden room
    const intScore = playerChar.stats.INT || 10;
    const intProficient = playerChar.proficientSkills?.includes('investigation') || false;
    const intResult = abilityCheck(intScore, intProficient, playerChar.proficiencyBonus, 14);
    appendNarrative('dice', `调查检定（隐藏房间）：${intResult.summary}`);

    let hiddenRoom = false;
    if (intResult.success) {
        hiddenRoom = true;
        const bonusItem = pickRandomLoot(campaign);
        const bonusResult = _addLootSmart(bonusItem);
        if (bonusResult.isCurrency) {
            loot.push(`${bonusResult.goldAmount} gp`);
            appendNarrative('system', `发现隐藏密室！额外获得：+${bonusResult.goldAmount} gp`);
        } else {
            loot.push(bonusItem);
            appendNarrative('system', `发现隐藏密室！额外获得：${bonusItem}`);
        }
        const freshData = loadDndData();
        freshData.playerCharacter.gold = (freshData.playerCharacter.gold || 0) + 30;
        saveDndData(freshData);
        appendNarrative('system', '找到了 30 gp！');
    }

    refreshNarrative();
    setActions('<div class="dnd-loading"><i class="ph ph-sparkle"></i> DM 正在描述...</div>');

    try {
        const freshData = loadDndData();
        const systemPrompt = await buildDMSystemPrompt({
            playerChar: freshData.playerCharacter, partnerChar: freshData.partnerCharacter,
            campaign, currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
        });
        const userPrompt = buildTreasureResultPrompt(perceptionResult, loot, trapDetected, hiddenRoom);
        const response = await callPhoneLLM(systemPrompt, userPrompt);
        processCombatNarration(response);
    } catch (err) {
        console.error(`${DND_LOG} Treasure result narration failed:`, err);
    }

    refreshNarrative();
    refreshHPBars();
    showContinueButtonsFn();
    setProcessing(false);
}

// ═══════════════════════════════════════════════════════════════════════
// Rest Room
// ═══════════════════════════════════════════════════════════════════════

/**
 * @param {Function} enterNextRoom - callback to enter the next room
 * @param {Function} endAdventure - callback to end the adventure
 */
export async function handleRestRoom(data, campaign, roomNumber, totalRooms, processCombatNarration, enterNextRoom, endAdventure) {
    const playerChar = data.playerCharacter;
    const partnerChar = data.partnerCharacter;

    const cls = CLASSES.find(c => c.id === playerChar.class);
    const hitDieSides = cls?.hitDie || 8;
    const conMod = abilityModifier(playerChar.stats.CON);
    let healAmount = 0;

    if (playerChar.hitDice?.remaining > 0) {
        healAmount = Math.max(1, roll(hitDieSides) + conMod);
        const hpBefore = playerChar.currentHP;
        playerChar.currentHP = Math.min(playerChar.currentHP + healAmount, playerChar.maxHP);
        playerChar.hitDice.remaining -= 1;
        appendNarrative('dice', `短休：D${hitDieSides}+${conMod} = 恢复 ${healAmount} HP (${hpBefore} → ${playerChar.currentHP})`);
    } else {
        appendNarrative('system', '没有剩余生命骰，但在安全之处休息了片刻');
    }

    if (partnerChar && partnerChar.currentHP < partnerChar.maxHP) {
        const partnerCls = CLASSES.find(c => c.id === partnerChar.class);
        const partnerDie = partnerCls?.hitDie || 8;
        const partnerConMod = abilityModifier(partnerChar.stats.CON);
        const partnerHeal = Math.max(1, roll(partnerDie) + partnerConMod);
        const partnerBefore = partnerChar.currentHP;
        partnerChar.currentHP = Math.min(partnerChar.currentHP + partnerHeal, partnerChar.maxHP);
        appendNarrative('dice', `搭档短休：恢复 ${partnerHeal} HP (${partnerBefore} → ${partnerChar.currentHP})`);
    }

    if (cls?.id === 'warlock' && playerChar.maxSpellSlots) {
        playerChar.spellSlots = { ...playerChar.maxSpellSlots };
        appendNarrative('system', '邪术师契约魔法：短休恢复全部法术位');
    }

    saveDndData(data);
    refreshHPBars();

    setActions('<div class="dnd-loading"><i class="ph ph-campfire"></i> 休息中...</div>');

    try {
        const systemPrompt = await buildDMSystemPrompt({
            playerChar: data.playerCharacter, partnerChar: data.partnerCharacter,
            campaign, currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
        });
        const userPrompt = buildRestRoomPrompt(roomNumber, totalRooms, healAmount);
        const response = await callPhoneLLM(systemPrompt, userPrompt);
        processCombatNarration(response);
    } catch (err) {
        console.error(`${DND_LOG} Rest room narration failed:`, err);
        appendNarrative('dm', '你们找到了一个安全的角落，篝火噼啪作响，短暂地放松了紧绷的神经。');
    }

    refreshNarrative();

    const run = getCurrentRun();
    const canContinue = run && run.currentRoom < run.totalRooms;

    setActions(`
        <div class="dnd-turn-indicator dnd-rest-indicator">
            <i class="ph ph-campfire"></i> 休息点
        </div>
        <button class="dnd-action-btn dnd-rest-action" data-rest-action="search">
            <i class="ph ph-magnifying-glass"></i>
            <span>搜索周围</span>
            <span class="dnd-action-check">感知 DC12</span>
        </button>
        ${canContinue ? `<button class="dnd-action-btn dnd-rest-action" data-rest-action="continue">
            <i class="ph ph-door-open"></i>
            <span>继续前进</span>
        </button>` : `<button class="dnd-action-btn dnd-rest-action" data-rest-action="finish">
            <i class="ph ph-trophy"></i>
            <span>完成冒险</span>
        </button>`}
    `);

    setProcessing(false);

    document.querySelectorAll('.dnd-rest-action').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (isProcessing()) return;
            const action = btn.dataset.restAction;

            if (action === 'continue') {
                enterNextRoom();
                return;
            }
            if (action === 'finish') {
                endAdventure('victory');
                return;
            }

            // Search
            setProcessing(true);
            await _resolveRestSearch(data, campaign, processCombatNarration, showContinueButtonsFromRest);
        });
    });

    function showContinueButtonsFromRest() {
        showContinueButtons(enterNextRoom, endAdventure);
    }
}

async function _resolveRestSearch(data, campaign, processCombatNarration, showContinueButtonsFn) {
    const playerChar = loadDndData().playerCharacter;
    const wisScore = playerChar.stats.WIS || 10;
    const proficient = playerChar.proficientSkills?.includes('perception') || false;

    const searchResult = abilityCheck(wisScore, proficient, playerChar.proficiencyBonus, 12);
    appendNarrative('dice', `搜索检定：${searchResult.summary}`);

    let foundItem = null;
    if (searchResult.success) {
        if (Math.random() < 0.6) {
            const rawItem = pickRandomLoot(campaign);
            const smartResult = _addLootSmart(rawItem);
            if (smartResult.isCurrency) {
                foundItem = `${smartResult.goldAmount} gp`;
                appendNarrative('system', `发现了：+${smartResult.goldAmount} gp`);
            } else {
                foundItem = rawItem;
                appendNarrative('system', `发现了：${rawItem}`);
            }
        } else {
            const goldFound = 10 + Math.floor(Math.random() * 30);
            const freshData = loadDndData();
            freshData.playerCharacter.gold = (freshData.playerCharacter.gold || 0) + goldFound;
            saveDndData(freshData);
            foundItem = `${goldFound} gp`;
            appendNarrative('system', `找到了 ${goldFound} gp！`);
        }
    } else {
        appendNarrative('system', '没有发现什么特别的东西。');
    }

    refreshNarrative();
    setActions('<div class="dnd-loading"><i class="ph ph-sparkle"></i> DM 正在描述...</div>');

    try {
        const freshData = loadDndData();
        const systemPrompt = await buildDMSystemPrompt({
            playerChar: freshData.playerCharacter, partnerChar: freshData.partnerCharacter,
            campaign, currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
        });
        const userPrompt = buildRestSearchResultPrompt(searchResult, foundItem);
        const response = await callPhoneLLM(systemPrompt, userPrompt);
        processCombatNarration(response);
    } catch (err) {
        console.error(`${DND_LOG} Rest search narration failed:`, err);
    }

    refreshNarrative();
    showContinueButtonsFn();
    setProcessing(false);
}

// ═══════════════════════════════════════════════════════════════════════
// Continue Buttons
// ═══════════════════════════════════════════════════════════════════════

/**
 * Show "continue to next room" or "finish adventure" buttons.
 */
export function showContinueButtons(enterNextRoom, endAdventure) {
    const run = getCurrentRun();
    if (run && run.currentRoom < run.totalRooms) {
        setActions(`<button class="dnd-action-btn" data-action="next_room" data-type="special">
            <i class="ph ph-door-open"></i> 前进到下一个房间</button>`);
        document.querySelector('.dnd-action-btn[data-action="next_room"]')?.addEventListener('click', () => {
            enterNextRoom();
        });
    } else {
        setActions(`<button class="dnd-action-btn" data-action="end" data-result="victory" data-type="special">
            <i class="ph ph-trophy"></i> 完成冒险</button>`);
        document.querySelector('.dnd-action-btn[data-action="end"]')?.addEventListener('click', () => {
            endAdventure('victory');
        });
    }
}

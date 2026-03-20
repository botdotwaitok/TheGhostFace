// modules/phone/dnd/dndCombatUI.js — Combat Turn Loop UI
// Extracted from dndApp.js: Player/enemy/partner turn handling, spell panel, divine smite, death saves.

import { getPhoneCharInfo, getPhoneUserName } from '../phoneContext.js';
import { callPhoneLLM } from '../../api.js';
import { pushPromptLog } from '../console/consoleApp.js';
import {
    loadDndData, saveDndData, getCurrentRun, updateCurrentRun,
    appendNarrative, setInCombat, addLoot,
    getCombatState, getNarrativeContext,
} from './dndStorage.js';
import {
    CLASSES, getCombatSpells,
    getAvailableAbilities, getAbilityUsesRemaining,
    getItemInfo,
} from './dndCharacter.js';
import {
    advanceTurn, getCurrentTurnInfo,
    processPlayerAttack, processEnemyAttack, processPartnerAttack,
    processPartnerHeal, decidePartnerAction, processDeathSave,
    processUseItem, isCombatOver,
    processPlayerSpell, processPartnerSpell, pickPartnerSpell,
    processClassAbility, processDivineSmite,
    processPartnerUsePotion,
} from './dndCombat.js';
import { getCampaignById, pickRandomLoot } from './dndCampaigns.js';
import {
    buildDMSystemPrompt,
    buildCombatAttackPrompt,
    buildSpellCastPrompt,
    buildAbilityUsePrompt,
    buildRoundBatchPrompt,
} from './dndPromptBuilder.js';
import {
    esc, setActions, refreshNarrative, refreshHPBars,
    isProcessing, setProcessing, showRerollButton,
    buildSpellSlotIndicator,
} from './dndUI.js';

const DND_LOG = '[D&D]';

// ═══════════════════════════════════════════════════════════════════════
// Combat Turn Loop
// ═══════════════════════════════════════════════════════════════════════

/**
 * Main combat turn loop. Dispatches turns by type.
 * Player turns wait for button click; enemy/partner turns run automatically.
 * @param {Function} endAdventure - callback for ending adventure on defeat
 * @param {Function} enterNextRoom - callback for next room after combat victory
 */
export async function runCombatTurnLoop(endAdventure, enterNextRoom) {
    const combatState = getCombatState();
    if (!combatState) return;

    // Safety: prevent infinite combat loops (max 50 rounds)
    if (combatState.roundNumber > 50) {
        appendNarrative('system', '—— 战斗持续太久，敌人撤退了！ ——');
        refreshNarrative();
        await _checkCombatEnd(combatState, 'victory', endAdventure, enterNextRoom);
        return;
    }

    const endCheck = isCombatOver(combatState);
    if (endCheck.over) {
        await _checkCombatEnd(combatState, endCheck.result, endAdventure, enterNextRoom);
        return;
    }

    // ── Phase 1: Process all auto-turns, collecting results into roundBatch ──
    const roundBatch = [];
    while (true) {
        const turnInfo = getCurrentTurnInfo(combatState);

        // Player turn (not downed) → stop and show action buttons
        if (turnInfo.type === 'player' && !combatState.playerDown) break;

        // Show turn banner
        appendNarrative('system', `—— 第 ${turnInfo.round} 轮 | ${turnInfo.label}的回合 ——`);
        refreshNarrative();
        refreshCombatPanel();

        // Process this auto-turn — returns batch entries or null
        const entries = await _processAutoTurn(combatState, turnInfo);
        if (entries) {
            for (const e of entries) roundBatch.push(e);
        }

        advanceTurn(combatState);

        // Check combat end after each auto-turn
        const midCheck = isCombatOver(combatState);
        if (midCheck.over) {
            // Narrate collected batch before ending combat
            if (roundBatch.length > 0) await _narrateRoundBatch(roundBatch);
            await _checkCombatEnd(combatState, midCheck.result, endAdventure, enterNextRoom);
            return;
        }
    }

    // ── Phase 2: Batched LLM narration for all auto-turns ──
    if (roundBatch.length > 0) {
        await _narrateRoundBatch(roundBatch);
    }

    // ── Phase 3: Show player action buttons ──
    const playerTurnInfo = getCurrentTurnInfo(combatState);
    appendNarrative('system', `—— 第 ${playerTurnInfo.round} 轮 | ${playerTurnInfo.label}的回合 ——`);
    refreshNarrative();
    refreshCombatPanel();
    _showPlayerCombatActions(combatState, endAdventure, enterNextRoom);
}

// ═══════════════════════════════════════════════════════════════════════
// Player Combat Actions
// ═══════════════════════════════════════════════════════════════════════

function _showPlayerCombatActions(combatState, endAdventure, enterNextRoom) {
    const data = loadDndData();
    const playerChar = data.playerCharacter;

    const aliveEnemies = combatState.enemies
        .map((e, i) => ({ ...e, idx: i }))
        .filter(e => !e.isDead);

    const enemyBtns = aliveEnemies.map(e => `
        <button class="dnd-action-btn dnd-combat-action" data-combat="attack" data-target="${e.idx}">
            <i class="ph ph-sword"></i>
            <span>攻击 ${esc(e.name)}</span>
            <span class="dnd-action-check">HP ${e.currentHP}/${e.maxHP}</span>
        </button>
    `).join('');

    // Class abilities (non-passive, non-on_hit)
    const abilities = getAvailableAbilities(playerChar)
        .filter(a => a.type !== 'passive' && a.type !== 'on_hit');
    const activeRage = combatState.activeBuffs?.player?.rage;
    const abilityBtns = abilities.map(a => {
        const remaining = getAbilityUsesRemaining(playerChar, a.id);
        const isRageActive = a.id === 'barbarian_rage' && activeRage;
        const disabled = remaining <= 0 || isRageActive;
        const statusText = isRageActive ? '已激活' : `${remaining}/${a.maxUses}`;
        const needsTarget = a.id === 'monk_flurry';
        return `
        <button class="dnd-action-btn dnd-combat-action dnd-ability-trigger ${disabled ? 'disabled' : ''}"
                data-combat="ability" data-ability="${a.id}"
                ${needsTarget && aliveEnemies.length > 0 ? `data-target="${aliveEnemies[0].idx}"` : ''}
                ${disabled ? 'disabled' : ''}>
            <i class="ph ${a.icon}"></i>
            <span>${esc(a.name)}</span>
            <span class="dnd-action-check">${statusText}</span>
        </button>`;
    }).join('');

    const potions = playerChar.inventory.filter(i => i.includes('药水'));
    const itemBtns = potions.map(item => `
        <button class="dnd-action-btn dnd-combat-action" data-combat="item" data-item="${esc(item)}">
            <i class="ph ph-flask"></i>
            <span>使用 ${esc(item)}</span>
        </button>
        <button class="dnd-action-btn dnd-combat-action dnd-partner-item" data-combat="item_partner" data-item="${esc(item)}">
            <i class="ph ph-hand-heart"></i>
            <span>给搭档使用 ${esc(item)}</span>
        </button>
    `).join('');

    let spellBtn = '';
    const combatSpells = getCombatSpells(playerChar);
    if (combatSpells.length > 0) {
        const castableCount = combatSpells.filter(s => s.canCast).length;
        spellBtn = `
        <button class="dnd-action-btn dnd-combat-action dnd-spell-trigger" data-combat="open_spells">
            <i class="ph ph-magic-wand"></i>
            <span>施放法术</span>
            <span class="dnd-action-check">${buildSpellSlotIndicator(playerChar)} (${castableCount}可用)</span>
        </button>`;
    }

    setActions(`
        <div class="dnd-turn-indicator">
            <i class="ph ph-user"></i> 你的回合 — 选择行动
            ${activeRage ? '<span class="dnd-rage-indicator"><i class="ph ph-fire"></i> 狂暴中</span>' : ''}
        </div>
        ${enemyBtns}
        ${abilityBtns}
        ${spellBtn}
        ${itemBtns}
    `);

    document.querySelectorAll('.dnd-combat-action').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (isProcessing()) return;
            const action = btn.dataset.combat;
            if (action === 'attack') {
                const targetIdx = parseInt(btn.dataset.target);
                await _handlePlayerCombatAction(targetIdx, endAdventure, enterNextRoom);
            } else if (action === 'ability') {
                const abilityId = btn.dataset.ability;
                const targetIdx = btn.dataset.target !== undefined ? parseInt(btn.dataset.target) : null;
                await _handlePlayerAbilityUse(abilityId, targetIdx, endAdventure, enterNextRoom);
            } else if (action === 'item') {
                const itemName = btn.dataset.item;
                await _handleUseItemInCombat(itemName, endAdventure, enterNextRoom, 'player');
            } else if (action === 'item_partner') {
                const itemName = btn.dataset.item;
                await _handleUseItemInCombat(itemName, endAdventure, enterNextRoom, 'partner');
            } else if (action === 'open_spells') {
                _showSpellPanel(combatState, aliveEnemies, endAdventure, enterNextRoom);
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Spell Panel
// ═══════════════════════════════════════════════════════════════════════

function _showSpellPanel(combatState, aliveEnemies, endAdventure, enterNextRoom) {
    const data = loadDndData();
    const combatSpells = getCombatSpells(data.playerCharacter);
    const char = data.playerCharacter;

    const spellCards = combatSpells.map(({ spell, canCast }) => {
        const needsTarget = spell.target === 'enemy' && aliveEnemies.length > 0;
        const targetCards = needsTarget && aliveEnemies.length > 1
            ? `<div class="dnd-spell-target-cards">
                ${aliveEnemies.map((e, i) => {
                    const hpPct = Math.max(0, Math.round((e.currentHP / e.maxHP) * 100));
                    const hpClass = hpPct <= 25 ? 'danger' : hpPct <= 50 ? 'warning' : '';
                    return `<div class="dnd-spell-target-chip ${i === 0 ? 'selected' : ''}" data-target="${e.idx}">
                        <div class="dnd-target-chip-name"><i class="ph ph-skull"></i> ${esc(e.name)}</div>
                        <div class="dnd-target-chip-hp-bar"><div class="dnd-target-chip-hp-fill ${hpClass}" style="width:${hpPct}%"></div></div>
                        <div class="dnd-target-chip-hp-text">${e.currentHP}/${e.maxHP}</div>
                    </div>`;
                }).join('')}
               </div>`
            : '';

        return `
        <div class="dnd-spell-card ${canCast ? '' : 'disabled'}" data-spell="${spell.id}">
            <div class="dnd-spell-card-header">
                <i class="ph ${spell.icon}"></i>
                <div class="dnd-spell-card-titles">
                    <div class="dnd-spell-card-name">${esc(spell.name)}</div>
                    <div class="dnd-spell-card-level">${spell.level === 0 ? '戏法' : `${spell.level}级法术`} · ${spell.type === 'damage' ? '伤害' : spell.type === 'heal' ? '治疗' : '增益'}</div>
                </div>
            </div>
            <div class="dnd-spell-card-desc">${esc(spell.description)}</div>
            ${spell.dice ? `<div class="dnd-spell-card-dice">${esc(spell.dice)}</div>` : ''}
            ${targetCards}
            <button class="dnd-spell-cast-btn" ${canCast ? '' : 'disabled'} data-spell="${spell.id}" data-default-target="${aliveEnemies[0]?.idx ?? ''}">
                ${canCast ? '施放' : '法术位不足'}
            </button>
        </div>`;
    }).join('');

    // Wrap in an overlay backdrop — tapping outside panel closes it safely
    const panelHtml = `
    <div class="dnd-spell-panel-overlay" id="dnd_spell_overlay">
        <div class="dnd-spell-panel" id="dnd_spell_panel">
            <div class="dnd-spell-panel-header">
                <span><i class="ph ph-magic-wand"></i> 法术列表</span>
                <span class="dnd-spell-slots-display">${buildSpellSlotIndicator(char)}</span>
                <button class="dnd-spell-panel-close" id="dnd_spell_close"><i class="ph ph-x"></i></button>
            </div>
            <div class="dnd-spell-panel-body">
                ${spellCards}
            </div>
        </div>
    </div>`;

    const actionsEl = document.getElementById('dnd_actions');
    if (actionsEl) actionsEl.insertAdjacentHTML('afterend', panelHtml);

    const _closePanel = () => {
        document.getElementById('dnd_spell_overlay')?.remove();
    };

    // Close button
    document.getElementById('dnd_spell_close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        _closePanel();
    });

    // Click on overlay backdrop → close (tap outside panel to dismiss)
    document.getElementById('dnd_spell_overlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'dnd_spell_overlay') {
            e.stopPropagation();
            _closePanel();
        }
    });

    // Prevent clicks inside panel from propagating to underlying elements
    document.getElementById('dnd_spell_panel')?.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Target card click → toggle selection within same spell card
    document.querySelectorAll('.dnd-spell-target-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            const container = chip.closest('.dnd-spell-target-cards');
            container.querySelectorAll('.dnd-spell-target-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
        });
    });

    document.querySelectorAll('.dnd-spell-cast-btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const spellId = btn.dataset.spell;
            const card = btn.closest('.dnd-spell-card');
            const selectedChip = card?.querySelector('.dnd-spell-target-chip.selected');
            const targetIdx = selectedChip ? parseInt(selectedChip.dataset.target) : (btn.dataset.defaultTarget !== '' ? parseInt(btn.dataset.defaultTarget) : null);
            _closePanel();
            await _handlePlayerSpellCast(spellId, targetIdx, endAdventure, enterNextRoom);
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Player Spell Cast
// ═══════════════════════════════════════════════════════════════════════

async function _handlePlayerSpellCast(spellId, targetIdx, endAdventure, enterNextRoom) {
    if (isProcessing()) return;
    setProcessing(true);

    const data = loadDndData();
    const combatState = getCombatState();
    if (!combatState) { setProcessing(false); return; }

    const result = processPlayerSpell(combatState, data.playerCharacter, spellId, targetIdx);
    if (!result.success) {
        appendNarrative('system', result.message);
        setProcessing(false);
        refreshNarrative();
        _showPlayerCombatActions(combatState, endAdventure, enterNextRoom);
        return;
    }

    appendNarrative('dice', result.message);
    if (result.killed) {
        appendNarrative('system', `${result.targetName} 被击败了！`);
    }

    setActions('<div class="dnd-loading"><i class="ph ph-magic-wand"></i> DM 正在描述...</div>');
    refreshNarrative();
    refreshCombatPanel();
    refreshHPBars();

    try {
        const freshData = loadDndData();
        const campaign = getCampaignById(freshData.currentRun?.campaignId);
        const systemPrompt = await buildDMSystemPrompt({
            playerChar: freshData.playerCharacter,
            partnerChar: freshData.partnerCharacter,
            campaign,
            currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
        });
        const userPrompt = buildSpellCastPrompt(getPhoneUserName(), result, false);
        try { pushPromptLog('D&D Spell', systemPrompt, userPrompt); } catch {}
        const response = await callPhoneLLM(systemPrompt, userPrompt);
        processCombatNarration(response);
    } catch (err) {
        console.error(`${DND_LOG} Spell narration failed:`, err);
    }

    advanceTurn(combatState);
    setProcessing(false);
    refreshNarrative();
    await runCombatTurnLoop(endAdventure, enterNextRoom);
}

// ═══════════════════════════════════════════════════════════════════════
// Player Attack
// ═══════════════════════════════════════════════════════════════════════

async function _handlePlayerCombatAction(targetIdx, endAdventure, enterNextRoom) {
    if (isProcessing()) return;
    setProcessing(true);

    const data = loadDndData();
    const combatState = getCombatState();
    if (!combatState) { setProcessing(false); return; }

    const result = processPlayerAttack(combatState, data.playerCharacter, targetIdx);
    if (!result) { setProcessing(false); return; }

    appendNarrative('dice', result.attackResult.summary);
    if (result.damageResult) {
        appendNarrative('dice', `伤害：${result.damageResult.detail}`);
    }
    if (result.killed) {
        appendNarrative('system', `${result.enemy.name} 被击败了！`);
    }

    refreshNarrative();
    refreshCombatPanel();
    refreshHPBars();

    // Divine Smite prompt
    if (result.canSmite && result.attackResult.hit && !result.killed) {
        setProcessing(false);
        _showDivineSmiteConfirm(combatState, targetIdx, result, endAdventure, enterNextRoom);
        return;
    }

    // ── Optimization: miss → fixed text, no LLM ──
    if (!result.attackResult.hit) {
        const missText = result.attackResult.isNat1
            ? `${getPhoneUserName()}的攻击严重失误……武器差点脱手！`
            : `${getPhoneUserName()}的攻击落空了。`;
        appendNarrative('dm', missText);
    } else {
        // Hit → instant LLM narration (Plan A: keep player attack feedback immediate)
        setActions('<div class="dnd-loading"><i class="ph ph-sword"></i> DM 正在描述...</div>');
        try {
            const freshData = loadDndData();
            const campaign = getCampaignById(freshData.currentRun?.campaignId);
            const systemPrompt = await buildDMSystemPrompt({
                playerChar: freshData.playerCharacter,
                partnerChar: freshData.partnerCharacter,
                campaign,
                currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
            });
            const userPrompt = buildCombatAttackPrompt(result.attackResult, result.damageResult, result.enemy.name, result.enemy);
            try { pushPromptLog('D&D Attack', systemPrompt, userPrompt); } catch {}
            const response = await callPhoneLLM(systemPrompt, userPrompt);
            processCombatNarration(response);
        } catch (err) {
            console.error(`${DND_LOG} Combat narration failed:`, err);
        }
    }

    // Action Surge
    if (combatState.actionSurgePending?.player) {
        combatState.actionSurgePending.player = false;
        updateCurrentRun({ combatState });
        setProcessing(false);
        refreshNarrative();
        appendNarrative('system', '动作如潮！额外行动！');
        _showPlayerCombatActions(combatState, endAdventure, enterNextRoom);
        return;
    }

    advanceTurn(combatState);
    setProcessing(false);
    refreshNarrative();
    await runCombatTurnLoop(endAdventure, enterNextRoom);
}

// ═══════════════════════════════════════════════════════════════════════
// Player Ability Use
// ═══════════════════════════════════════════════════════════════════════

async function _handlePlayerAbilityUse(abilityId, targetIdx, endAdventure, enterNextRoom) {
    if (isProcessing()) return;
    setProcessing(true);

    const data = loadDndData();
    const combatState = getCombatState();
    if (!combatState || !data.playerCharacter) { setProcessing(false); return; }

    const result = processClassAbility(combatState, data.playerCharacter, abilityId, targetIdx, 'player');

    if (!result.success) {
        appendNarrative('system', result.message);
        setProcessing(false);
        refreshNarrative();
        _showPlayerCombatActions(combatState, endAdventure, enterNextRoom);
        return;
    }

    appendNarrative('dice', result.message);
    if (result.healResult) {
        refreshHPBars();
    }
    if (result.killed) {
        appendNarrative('system', `${result.enemy.name} 被击败了！`);
    }
    refreshNarrative();
    refreshCombatPanel();
    refreshHPBars();

    setActions('<div class="dnd-loading"><i class="ph ph-sparkle"></i> DM 正在描述...</div>');

    try {
        const freshData = loadDndData();
        const campaign = getCampaignById(freshData.currentRun?.campaignId);
        const systemPrompt = await buildDMSystemPrompt({
            playerChar: freshData.playerCharacter,
            partnerChar: freshData.partnerCharacter,
            campaign,
            currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
        });
        const userPrompt = buildAbilityUsePrompt(getPhoneUserName(), result, false);
        try { pushPromptLog('D&D Ability', systemPrompt, userPrompt); } catch {}
        const response = await callPhoneLLM(systemPrompt, userPrompt);
        processCombatNarration(response);
    } catch (err) {
        console.error(`${DND_LOG} Ability narration failed:`, err);
    }

    // Action Surge: return to actions
    if (result.extraAttackGranted) {
        setProcessing(false);
        refreshNarrative();
        _showPlayerCombatActions(combatState, endAdventure, enterNextRoom);
        return;
    }

    // Toggle (Rage): don't consume turn
    if (result.ability?.type === 'toggle') {
        setProcessing(false);
        refreshNarrative();
        _showPlayerCombatActions(combatState, endAdventure, enterNextRoom);
        return;
    }

    advanceTurn(combatState);
    setProcessing(false);
    refreshNarrative();
    await runCombatTurnLoop(endAdventure, enterNextRoom);
}

// ═══════════════════════════════════════════════════════════════════════
// Divine Smite
// ═══════════════════════════════════════════════════════════════════════

function _showDivineSmiteConfirm(combatState, targetIdx, attackResult, endAdventure, enterNextRoom) {
    const data = loadDndData();
    const slotsText = buildSpellSlotIndicator(data.playerCharacter);

    setActions(`
        <div class="dnd-turn-indicator">
            <i class="ph ph-sun"></i> 命中！是否使用神圣打击？
        </div>
        <button class="dnd-action-btn dnd-combat-action dnd-ability-trigger" data-combat="smite_yes">
            <i class="ph ph-sun"></i>
            <span>神圣打击！ (+2D8光辉)</span>
            <span class="dnd-action-check">消耗法术位 ${slotsText}</span>
        </button>
        <button class="dnd-action-btn dnd-combat-action" data-combat="smite_no">
            <i class="ph ph-x"></i>
            <span>不使用</span>
        </button>
    `);

    document.querySelectorAll('.dnd-combat-action').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (isProcessing()) return;
            const action = btn.dataset.combat;
            if (action === 'smite_yes') {
                await _handleDivineSmiteConfirm(combatState, targetIdx, attackResult, endAdventure, enterNextRoom);
            } else {
                setProcessing(true);
                setActions('<div class="dnd-loading"><i class="ph ph-sword"></i> DM 正在描述...</div>');

                try {
                    const freshData = loadDndData();
                    const campaign = getCampaignById(freshData.currentRun?.campaignId);
                    const systemPrompt = await buildDMSystemPrompt({
                        playerChar: freshData.playerCharacter,
                        partnerChar: freshData.partnerCharacter,
                        campaign,
                        currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
                    });
                    const userPrompt = buildCombatAttackPrompt(attackResult.attackResult, attackResult.damageResult, attackResult.enemy.name, attackResult.enemy);
                    try { pushPromptLog('D&D Attack (no smite)', systemPrompt, userPrompt); } catch {}
                    const response = await callPhoneLLM(systemPrompt, userPrompt);
                    processCombatNarration(response);
                } catch (err) {
                    console.error(`${DND_LOG} Combat narration failed:`, err);
                }

                advanceTurn(combatState);
                setProcessing(false);
                refreshNarrative();
                await runCombatTurnLoop(endAdventure, enterNextRoom);
            }
        });
    });
}

async function _handleDivineSmiteConfirm(combatState, targetIdx, attackResult, endAdventure, enterNextRoom) {
    setProcessing(true);

    const data = loadDndData();
    const smiteResult = processDivineSmite(combatState, data.playerCharacter, targetIdx, 'player');

    if (smiteResult.success) {
        appendNarrative('dice', smiteResult.message);
        if (attackResult.damageResult) {
            attackResult.damageResult.total += smiteResult.smiteDamage.total;
            attackResult.damageResult.detail += ` +${smiteResult.smiteDamage.detail}(神圣打击)`;
        }
        if (smiteResult.killed) {
            appendNarrative('system', `${smiteResult.enemy.name} 被击败了！`);
        }
    }

    refreshNarrative();
    refreshCombatPanel();
    refreshHPBars();

    setActions('<div class="dnd-loading"><i class="ph ph-sword"></i> DM 正在描述...</div>');

    try {
        const freshData = loadDndData();
        const campaign = getCampaignById(freshData.currentRun?.campaignId);
        const systemPrompt = await buildDMSystemPrompt({
            playerChar: freshData.playerCharacter,
            partnerChar: freshData.partnerCharacter,
            campaign,
            currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
        });
        const userPrompt = buildCombatAttackPrompt(attackResult.attackResult, attackResult.damageResult, attackResult.enemy.name, attackResult.enemy);
        try { pushPromptLog('D&D Smite Attack', systemPrompt, userPrompt); } catch {}
        const response = await callPhoneLLM(systemPrompt, userPrompt);
        processCombatNarration(response);
    } catch (err) {
        console.error(`${DND_LOG} Combat narration failed:`, err);
    }

    advanceTurn(combatState);
    setProcessing(false);
    refreshNarrative();
    await runCombatTurnLoop(endAdventure, enterNextRoom);
}

// ═══════════════════════════════════════════════════════════════════════
// Auto-Turn Processing (Batch — no LLM per turn)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Process one auto-turn (enemy / downed-player / partner).
 * Returns an array of batch entries, or null if nothing happened.
 * Does NOT call LLM — results are collected into roundBatch.
 */
async function _processAutoTurn(combatState, turnInfo) {
    if (turnInfo.type === 'enemy') {
        return _processEnemyAutoTurn(combatState, turnInfo.enemyIndex);
    }

    if (turnInfo.type === 'partner') {
        if (combatState.partnerDown) {
            return _processDeathSaveForBatch('partner', combatState);
        }
        return _processPartnerAutoTurn(combatState);
    }

    if (turnInfo.type === 'player' && combatState.playerDown) {
        return _processDeathSaveForBatch('player', combatState);
    }

    return null;
}

/**
 * Process an enemy's attack for the batch.
 * Displays dice in narrative immediately, returns batch entry.
 */
function _processEnemyAutoTurn(combatState, enemyIdx) {
    const data = loadDndData();
    setActions(`<div class="dnd-loading"><i class="ph ph-skull"></i> ${combatState.enemies[enemyIdx]?.name || '敌人'} 正在行动...</div>`);

    const result = processEnemyAttack(combatState, enemyIdx, data.playerCharacter, data.partnerCharacter);
    if (!result) return null;

    const targetLabel = result.target === 'player' ? getPhoneUserName() : (getPhoneCharInfo()?.name || '搭档');
    appendNarrative('dice', `${result.enemy.name} → ${targetLabel}：${result.attackResult.summary}`);
    if (result.damageResult && result.attackResult.hit) {
        appendNarrative('dice', `伤害：${result.damageResult.detail} (HP ${result.hpBefore} → ${result.hpAfter})`);
    }
    if (result.hpAfter <= 0 && result.attackResult.hit) {
        appendNarrative('system', `${targetLabel} 倒下了！`);
    }

    refreshNarrative();
    refreshCombatPanel();
    refreshHPBars();

    return [{
        type: 'enemy_attack',
        enemyName: result.enemy.name,
        target: result.target,
        attackSummary: result.attackResult.summary,
        hit: result.attackResult.hit,
        isCritical: result.attackResult.isCritical,
        damageSummary: result.damageResult?.detail || null,
        targetDowned: result.hpAfter <= 0 && result.attackResult.hit,
    }];
}

/**
 * Process the partner's full turn for the batch.
 * Handles auto-abilities (Rage, Second Wind) + main action (attack/heal/spell).
 * All dice results are shown immediately; no LLM calls.
 */
function _processPartnerAutoTurn(combatState) {
    const data = loadDndData();
    const charName = getPhoneCharInfo()?.name || '搭档';
    setActions(`<div class="dnd-loading"><i class="ph ph-sparkle"></i> ${charName} 正在行动...</div>`);

    const partnerChar = data.partnerCharacter;
    const partnerAbilities = getAvailableAbilities(partnerChar);
    const batchEntries = [];

    // ── Auto-abilities ──

    // Barbarian: Auto-Rage on round 1
    if (partnerChar.class === 'barbarian' && combatState.roundNumber === 1 && !combatState.activeBuffs?.partner?.rage) {
        const rageAbility = partnerAbilities.find(a => a.id === 'barbarian_rage');
        if (rageAbility && getAbilityUsesRemaining(partnerChar, 'barbarian_rage') > 0) {
            const rageResult = processClassAbility(combatState, partnerChar, 'barbarian_rage', null, 'partner');
            if (rageResult.success) {
                appendNarrative('dice', `${charName} ${rageResult.message}`);
                refreshNarrative();
                batchEntries.push({
                    type: 'partner_ability',
                    abilityName: rageResult.ability.name,
                    message: rageResult.message,
                });
            }
        }
    }

    // Fighter: Second Wind when HP < 30%
    if (partnerChar.class === 'fighter') {
        const hpPercent = partnerChar.currentHP / partnerChar.maxHP;
        if (hpPercent < 0.3 && getAbilityUsesRemaining(partnerChar, 'fighter_second_wind') > 0) {
            const swResult = processClassAbility(combatState, partnerChar, 'fighter_second_wind', null, 'partner');
            if (swResult.success) {
                appendNarrative('dice', `${charName} ${swResult.message}`);
                refreshNarrative();
                refreshHPBars();
                batchEntries.push({
                    type: 'partner_ability',
                    abilityName: swResult.ability.name,
                    message: swResult.message,
                });
            }
        }
    }

    // ── Main action ──
    const action = decidePartnerAction(combatState, data.playerCharacter, data.partnerCharacter);

    if (action === 'use_potion_self') {
        const potionResult = processPartnerUsePotion(combatState, data.partnerCharacter, 'self', data.playerCharacter);
        if (potionResult.success) {
            appendNarrative('dice', `${charName} 喝下治疗药水：恢复 ${potionResult.healAmount} HP (${potionResult.hpBefore} → ${potionResult.hpAfter})`);
            batchEntries.push({
                type: 'partner_potion',
                target: 'self',
                healAmount: potionResult.healAmount,
                hpBefore: potionResult.hpBefore,
                hpAfter: potionResult.hpAfter,
            });
        } else {
            // Fallback to attack if no potions
            _partnerAttackForBatch(combatState, data, charName, batchEntries);
        }
    } else if (action === 'use_potion_on_player') {
        const playerName = getPhoneUserName();
        const potionResult = processPartnerUsePotion(combatState, data.partnerCharacter, 'player', data.playerCharacter);
        if (potionResult.success) {
            appendNarrative('dice', `${charName} 给 ${playerName} 喝下治疗药水：恢复 ${potionResult.healAmount} HP (${potionResult.hpBefore} → ${potionResult.hpAfter})`);
            batchEntries.push({
                type: 'partner_potion',
                target: 'player',
                healAmount: potionResult.healAmount,
                hpBefore: potionResult.hpBefore,
                hpAfter: potionResult.hpAfter,
            });
        } else {
            _partnerAttackForBatch(combatState, data, charName, batchEntries);
        }
    } else if (action === 'heal') {
        const healResult = processPartnerHeal(combatState, data.partnerCharacter, data.playerCharacter);
        appendNarrative('dice', `${charName} 施放治疗术：恢复 ${healResult.healAmount} HP (${healResult.hpBefore} → ${healResult.hpAfter})`);
        batchEntries.push({
            type: 'partner_heal',
            healAmount: healResult.healAmount,
            hpBefore: healResult.hpBefore,
            hpAfter: healResult.hpAfter,
        });
    } else if (action === 'cast_aoe' || action === 'cast_damage') {
        const pick = pickPartnerSpell(combatState, data.partnerCharacter, action);
        if (pick) {
            const spellResult = processPartnerSpell(combatState, data.partnerCharacter, pick.spellId, pick.targetIdx);
            if (spellResult.success) {
                appendNarrative('dice', `${charName} 施放「${spellResult.spell.name}」：${spellResult.message}`);
                if (spellResult.killed) {
                    appendNarrative('system', `${spellResult.targetName} 被${charName}击败了！`);
                }
                batchEntries.push({
                    type: 'partner_spell',
                    spellName: spellResult.spell.name,
                    message: spellResult.message,
                    killed: spellResult.killed,
                    targetName: spellResult.targetName,
                });
            } else {
                // Spell failed, fallback to attack
                _partnerAttackForBatch(combatState, data, charName, batchEntries);
            }
        } else {
            _partnerAttackForBatch(combatState, data, charName, batchEntries);
        }
    } else {
        _partnerAttackForBatch(combatState, data, charName, batchEntries);
    }

    refreshNarrative();
    refreshCombatPanel();
    refreshHPBars();

    return batchEntries.length > 0 ? batchEntries : null;
}

/** Helper: process partner attack and push batch entry. */
function _partnerAttackForBatch(combatState, data, charName, batchEntries) {
    const attackResult = processPartnerAttack(combatState, data.partnerCharacter);
    if (!attackResult) return;

    appendNarrative('dice', `${charName} 攻击 ${attackResult.enemy.name}：${attackResult.attackResult.summary}`);
    if (attackResult.damageResult) {
        appendNarrative('dice', `伤害：${attackResult.damageResult.detail}`);
    }
    if (attackResult.killed) {
        appendNarrative('system', `${attackResult.enemy.name} 被${charName}击败了！`);
    }

    batchEntries.push({
        type: 'partner_attack',
        enemyName: attackResult.enemy.name,
        attackSummary: attackResult.attackResult.summary,
        hit: attackResult.attackResult.hit,
        isCritical: attackResult.attackResult.isCritical,
        damageSummary: attackResult.damageResult?.detail || null,
        killed: attackResult.killed,
    });
}

/**
 * Process a death saving throw and return a batch entry (no LLM).
 */
function _processDeathSaveForBatch(who, combatState) {
    const whoName = who === 'player' ? getPhoneUserName() : (getPhoneCharInfo()?.name || '搭档');
    const result = processDeathSave(combatState, who);
    const saves = combatState.deathSaves[who];

    appendNarrative('dice', `${whoName} 死亡豁免：${result.result.description}`);
    appendNarrative('system', `成功 ${saves.successes}/3 | 失败 ${saves.failures}/3`);

    if (result.revived) {
        appendNarrative('system', `${whoName} 奇迹般地站了起来！`);
    } else if (result.stabilized) {
        appendNarrative('system', `${whoName} 稳定了！`);
    } else if (result.dead) {
        appendNarrative('system', `${whoName} 永远地倒下了……`);
    }

    refreshNarrative();
    refreshHPBars();

    return [{
        type: 'death_save',
        who,
        description: result.result.description,
        successes: saves.successes,
        failures: saves.failures,
        revived: result.revived,
        stabilized: result.stabilized,
        dead: result.dead,
    }];
}

// ═══════════════════════════════════════════════════════════════════════
// Batched LLM Narration
// ═══════════════════════════════════════════════════════════════════════

/**
 * Make a single LLM call to narrate all auto-turn results collected in roundBatch.
 */
async function _narrateRoundBatch(roundBatch) {
    setActions('<div class="dnd-loading"><i class="ph ph-book-open"></i> DM 正在描述本轮战斗...</div>');
    try {
        const data = loadDndData();
        const campaign = getCampaignById(data.currentRun?.campaignId);
        const systemPrompt = await buildDMSystemPrompt({
            playerChar: data.playerCharacter,
            partnerChar: data.partnerCharacter,
            campaign,
            currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
        });
        const userPrompt = buildRoundBatchPrompt(roundBatch);
        try { pushPromptLog('D&D Round Batch', systemPrompt, userPrompt); } catch {}
        const response = await callPhoneLLM(systemPrompt, userPrompt);
        processCombatNarration(response);
    } catch (err) {
        console.error(`${DND_LOG} Batch narration failed:`, err);
    }
    refreshNarrative();
}

// ═══════════════════════════════════════════════════════════════════════
// Combat End
// ═══════════════════════════════════════════════════════════════════════

async function _checkCombatEnd(combatState, result, endAdventure, enterNextRoom) {
    setInCombat(false);

    if (result === 'victory') {
        appendNarrative('system', '—— 战斗胜利！ ——');

        const data = loadDndData();
        const campaign = getCampaignById(data.currentRun?.campaignId);
        if (campaign) {
            const loot = pickRandomLoot(campaign);
            const lootInfo = getItemInfo(loot);
            if (lootInfo.type === 'currency') {
                const goldAmount = lootInfo.effect?.gold || 0;
                if (goldAmount > 0) {
                    const freshData = loadDndData();
                    if (freshData.playerCharacter) {
                        freshData.playerCharacter.gold = (freshData.playerCharacter.gold || 0) + goldAmount;
                        saveDndData(freshData);
                    }
                    appendNarrative('system', `获得战利品：+${goldAmount} gp`);
                } else {
                    addLoot(loot);
                    appendNarrative('system', `获得战利品：${loot}`);
                }
            } else {
                addLoot(loot);
                appendNarrative('system', `获得战利品：${loot}`);
            }
        }
    } else {
        appendNarrative('system', '—— 全队覆灭…… ——');
    }

    refreshNarrative();
    refreshCombatPanel();

    if (result === 'defeat') {
        endAdventure('defeat');
        return;
    }

    const run = getCurrentRun();
    if (run && run.currentRoom < run.totalRooms) {
        setActions(`<button class="dnd-action-btn" data-action="next_room" data-type="special">
            <i class="ph ph-door-open"></i> 前进到下一个房间</button>`);
        document.querySelector('.dnd-action-btn[data-action="next_room"]')?.addEventListener('click', () => enterNextRoom());
    } else {
        endAdventure('victory');
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Use Item in Combat
// ═══════════════════════════════════════════════════════════════════════

async function _handleUseItemInCombat(itemName, endAdventure, enterNextRoom, targetWho = 'player') {
    if (isProcessing()) return;
    setProcessing(true);

    const combatState = getCombatState();
    const data = loadDndData();
    if (!combatState || !data.playerCharacter) { setProcessing(false); return; }

    // Player uses item from their own inventory, healTarget determines who gets healed
    const result = processUseItem(combatState, 'player', itemName, data.playerCharacter, data.partnerCharacter, targetWho);

    if (result.success) {
        appendNarrative('dice', result.message);
        refreshHPBars();
        refreshNarrative();

        advanceTurn(combatState);
        setProcessing(false);
        await runCombatTurnLoop(endAdventure, enterNextRoom);
    } else {
        appendNarrative('system', result.message);
        setProcessing(false);
        refreshNarrative();
        _showPlayerCombatActions(combatState, endAdventure, enterNextRoom);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Combat Narration Parser
// ═══════════════════════════════════════════════════════════════════════

/**
 * Parse LLM response in combat context (no action option extraction).
 */
export function processCombatNarration(response) {
    if (!response) return;
    response = response.replace(/\*\*/g, '');

    // Same robust split pattern as _processLLMResponse
    const parts = response.split(/(?:【|(?:^|\n)\s*\[?)\s*(?=DM叙事|DM|行动选项|选项)/m);
    for (const part of parts) {
        const cleaned = part.replace(/[【】\[\]]/g, '').trim();
        if (!cleaned) continue;

        if (cleaned.startsWith('DM叙事') || cleaned.startsWith('DM')) {
            const text = cleaned.replace(/^DM叙事[：:]?\s*|^DM[：:]?\s*/, '').trim();
            if (text) appendNarrative('dm', text);
        } else if (cleaned.includes('行动选项') || cleaned.includes('选项')) {
            continue;
        } else {
            let text = cleaned;
            const charName = getPhoneCharInfo()?.name || '';
            const colonIdx = text.search(/[：:]/);
            if (colonIdx !== -1 && colonIdx < 20) {
                text = text.substring(colonIdx + 1).trim();
            } else if (charName && text.startsWith(charName)) {
                text = text.substring(charName.length).trim();
            }
            if (text) appendNarrative('partner', text);
        }
    }

    if (!response.match(/[【\[]/)) {
        appendNarrative('dm', response);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Combat UI Helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build combat panel HTML with enemy HP bars and turn indicator.
 */
export function buildCombatPanelHtml(combatState) {
    if (!combatState) return '';

    const turnInfo = getCurrentTurnInfo(combatState);

    const enemyRows = combatState.enemies.map((e, i) => {
        const hpPercent = Math.round((e.currentHP / e.maxHP) * 100);
        return `
            <div class="dnd-enemy-row ${e.isDead ? 'dead' : ''}" data-enemy-idx="${i}">
                <div class="dnd-enemy-info">
                    <span class="dnd-enemy-name"><i class="ph ph-skull"></i> ${esc(e.name)}</span>
                    <span class="dnd-enemy-hp-text">${e.currentHP}/${e.maxHP}</span>
                </div>
                <div class="dnd-enemy-hp-bar">
                    <div class="dnd-enemy-hp-fill ${hpPercent <= 25 ? 'danger' : hpPercent <= 50 ? 'warning' : ''}"
                         style="width:${hpPercent}%"></div>
                </div>
            </div>`;
    }).join('');

    return `
        <div class="dnd-combat-panel" id="dnd_combat_panel">
            <div class="dnd-turn-banner">
                <i class="ph ph-sword"></i> 第 ${combatState.roundNumber} 轮
            </div>
            ${enemyRows}
        </div>`;
}

/** Update (or create) the combat panel in DOM. */
export function refreshCombatPanel() {
    const combatState = getCombatState();
    let panel = document.getElementById('dnd_combat_panel');

    if (!combatState) {
        if (panel) panel.remove();
        return;
    }

    const html = buildCombatPanelHtml(combatState);

    if (panel) {
        panel.outerHTML = html;
    } else {
        const narrative = document.getElementById('dnd_narrative');
        if (narrative) {
            narrative.insertAdjacentHTML('beforebegin', html);
        }
    }
}

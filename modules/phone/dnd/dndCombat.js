// modules/phone/dnd/dndCombat.js — Turn-Based Combat State Machine
// Manages initiative, turn order, enemy HP tracking, death saves, and item usage.
// All dice rolls happen here (client-side). LLM only narrates.

import { roll, attackRoll, damageRoll, initiativeRoll, deathSavingThrow, abilityModifier } from './dndDice.js';
import {
    CLASSES, getCharacterDerived, consumeSpellSlot, SPELL_LIST, getCombatSpells, CLASS_SPELL_IDS,
    CLASS_ABILITIES, getAvailableAbilities, getAbilityUsesRemaining, consumeAbilityUse, getSneakAttackDice,
} from './dndCharacter.js';
import { pickRandomEnemy } from './dndCampaigns.js';
import { updateHP, loadDndData, saveDndData } from './dndStorage.js';

const DND_COMBAT_LOG = '[D&D Combat]';

// ═══════════════════════════════════════════════════════════════════════
// Initialize Combat
// ═══════════════════════════════════════════════════════════════════════

/**
 * Initialize a structured combat encounter.
 * @param {object} playerChar
 * @param {object} partnerChar
 * @param {object} campaign — campaign data (for picking enemies)
 * @param {boolean} isBoss — if true, pick from boss table
 * @returns {object} combatState
 */
export function initCombat(playerChar, partnerChar, campaign, isBoss = false) {
    const playerLevel = playerChar.level || 1;

    // Pick enemies
    const enemies = [];
    if (isBoss) {
        const bossTable = campaign.encounterTable.boss;
        const boss = bossTable[Math.floor(Math.random() * bossTable.length)];
        enemies.push(_createEnemy(boss));
    } else {
        // Enemy count scales with level: Lv.1-2 → always 1, Lv.3+ → 1-2
        const maxCount = playerLevel >= 3 ? 2 : 1;
        const count = maxCount === 1 ? 1 : (Math.random() < 0.5 ? 1 : 2);
        for (let i = 0; i < count; i++) {
            const enemy = pickRandomEnemy(campaign, playerLevel);
            enemies.push(_createEnemy(enemy));
        }
    }

    // Roll initiative for everyone
    const playerInit = initiativeRoll(playerChar.stats.DEX);
    const partnerInit = initiativeRoll(partnerChar.stats.DEX);
    const enemyInits = enemies.map((e, i) => ({
        id: `enemy_${i}`,
        init: roll(20) + (Math.floor((10 - 10) / 2)), // enemies use flat D20 (simplified)
    }));

    // Build unsorted turn entries
    const turnEntries = [
        { id: 'player', initiative: playerInit.total, label: '玩家' },
        { id: 'partner', initiative: partnerInit.total, label: '搭档' },
        ...enemyInits.map((e, i) => ({
            id: e.id,
            initiative: e.init,
            label: enemies[i].name,
        })),
    ];

    // Sort by initiative (highest first, ties broken randomly)
    turnEntries.sort((a, b) => b.initiative - a.initiative || (Math.random() - 0.5));

    const combatState = {
        enemies,
        turnOrder: turnEntries.map(t => t.id),
        turnLabels: Object.fromEntries(turnEntries.map(t => [t.id, t.label])),
        initiativeResults: Object.fromEntries(turnEntries.map(t => [t.id, t.initiative])),
        currentTurnIndex: 0,
        roundNumber: 1,
        playerDown: false,
        partnerDown: false,
        deathSaves: {
            player: { successes: 0, failures: 0 },
            partner: { successes: 0, failures: 0 },
        },
        // ── Class Ability State ──
        activeBuffs: { player: {}, partner: {} },       // toggle abilities (e.g. rage: true)
        turnAbilityUsed: { player: {}, partner: {} },   // per-turn abilities (e.g. sneak_attack: true)
        actionSurgePending: { player: false, partner: false }, // Action Surge extra attack flag
    };

    // Save to current run (single atomic write)
    const data = loadDndData();
    if (data.currentRun) {
        data.currentRun.inCombat = true;
        data.currentRun.combatState = combatState;
        saveDndData(data);
    }

    console.log(`${DND_COMBAT_LOG} Combat initialized:`, {
        enemies: enemies.map(e => `${e.name} HP:${e.currentHP}`),
        turnOrder: turnEntries.map(t => `${t.label}(${t.initiative})`),
    });

    return combatState;
}

function _createEnemy(template) {
    return {
        name: template.name,
        nameEn: template.nameEn,
        cr: template.cr,
        ac: template.ac,
        maxHP: template.hp,
        currentHP: template.hp,
        attack: template.attack,    // e.g. "+4"
        damage: template.damage,    // e.g. "1D6+2"
        special: template.special || '',
        isDead: false,
    };
}

// ═══════════════════════════════════════════════════════════════════════
// Turn Management
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get info about whose turn it currently is.
 * @param {object} combatState
 * @returns {{ id: string, type: 'player'|'partner'|'enemy', enemyIndex?: number, label: string, round: number }}
 */
export function getCurrentTurnInfo(combatState) {
    const id = combatState.turnOrder[combatState.currentTurnIndex];
    let type = 'enemy';
    let enemyIndex = -1;

    if (id === 'player') type = 'player';
    else if (id === 'partner') type = 'partner';
    else {
        const match = id.match(/^enemy_(\d+)$/);
        if (match) enemyIndex = parseInt(match[1]);
    }

    return {
        id,
        type,
        enemyIndex,
        label: combatState.turnLabels[id] || id,
        round: combatState.roundNumber,
    };
}

/**
 * Advance to the next turn. Skip dead enemies and downed allies.
 * @param {object} combatState
 * @returns {object} updated combatState
 */
export function advanceTurn(combatState) {
    // Reset per-turn ability flags for the current turn's entity
    const currentId = combatState.turnOrder[combatState.currentTurnIndex];
    if (currentId === 'player' || currentId === 'partner') {
        combatState.turnAbilityUsed[currentId] = {};
        combatState.actionSurgePending[currentId] = false;
    }

    let attempts = 0;
    const maxAttempts = combatState.turnOrder.length + 1;

    do {
        combatState.currentTurnIndex++;
        if (combatState.currentTurnIndex >= combatState.turnOrder.length) {
            combatState.currentTurnIndex = 0;
            combatState.roundNumber++;
        }
        attempts++;

        const info = getCurrentTurnInfo(combatState);

        // Skip dead enemies
        if (info.type === 'enemy' && info.enemyIndex >= 0) {
            if (combatState.enemies[info.enemyIndex]?.isDead) continue;
        }
        // Skip downed player (goes to death save instead)
        // Don't skip — death save IS their turn
        break;
    } while (attempts < maxAttempts);

    // Save (single atomic write)
    const data = loadDndData();
    if (data.currentRun) {
        data.currentRun.combatState = combatState;
        saveDndData(data);
    }
    return combatState;
}

// ═══════════════════════════════════════════════════════════════════════
// Player Attack
// ═══════════════════════════════════════════════════════════════════════

/**
 * Process the player's attack on an enemy.
 * @param {object} combatState
 * @param {object} playerChar
 * @param {number} targetIdx — index into combatState.enemies
 * @returns {{ attackResult, damageResult, enemy, killed }}
 */
export function processPlayerAttack(combatState, playerChar, targetIdx) {
    return _processAttackWithAbilities(combatState, playerChar, targetIdx, 'player');
}

/**
 * Internal: process an attack with class ability integration.
 * Handles Sneak Attack (passive), Rage bonus, and returns canSmite for Paladin.
 */
function _processAttackWithAbilities(combatState, attackerChar, targetIdx, who) {
    const enemy = combatState.enemies[targetIdx];
    if (!enemy || enemy.isDead) return null;

    const derived = getCharacterDerived(attackerChar);
    const atkResult = attackRoll(
        attackerChar.stats[derived.primaryAbility],
        attackerChar.proficiencyBonus,
        enemy.ac
    );

    let dmgResult = null;
    let killed = false;
    let sneakAttackDmg = null;
    let rageBonusApplied = false;
    let canSmite = false;

    if (atkResult.hit) {
        const cls = CLASSES.find(c => c.id === attackerChar.class);
        const dmgExpr = _getPlayerDamageExpr(attackerChar, cls);
        dmgResult = damageRoll(dmgExpr, atkResult.isCritical);

        // ── Rage damage bonus ──
        const buffs = combatState.activeBuffs?.[who] || {};
        if (buffs.rage) {
            const rageAbility = CLASS_ABILITIES.barbarian_rage;
            const bonus = rageAbility.effect.meleeDamageBonus;
            dmgResult.total += bonus;
            dmgResult.detail += ` +${bonus}(狂暴)`;
            rageBonusApplied = true;
        }

        // ── Rogue Sneak Attack (passive, once per turn) ──
        const turnUsed = combatState.turnAbilityUsed?.[who] || {};
        if (attackerChar.class === 'rogue' && !turnUsed.sneak_attack) {
            const sneakDice = getSneakAttackDice(attackerChar.level);
            const sneakRoll = damageRoll(sneakDice, atkResult.isCritical);
            dmgResult.total += sneakRoll.total;
            dmgResult.detail += ` +${sneakRoll.detail}(偷袭)`;
            sneakAttackDmg = sneakRoll;
            // Mark sneak attack as used this turn
            if (!combatState.turnAbilityUsed[who]) combatState.turnAbilityUsed[who] = {};
            combatState.turnAbilityUsed[who].sneak_attack = true;
        }

        // ── Paladin can smite after hit ──
        if (attackerChar.class === 'paladin' && attackerChar.level >= 2) {
            const slotsLeft = getAbilityUsesRemaining(attackerChar, 'paladin_smite');
            if (slotsLeft > 0) canSmite = true;
        }

        // Apply total damage to enemy
        enemy.currentHP = Math.max(0, enemy.currentHP - dmgResult.total);
        if (enemy.currentHP <= 0) {
            enemy.isDead = true;
            killed = true;
        }
    }

    // Save (single atomic write)
    const data = loadDndData();
    if (data.currentRun) {
        data.currentRun.combatState = combatState;
        saveDndData(data);
    }

    return {
        attackResult: atkResult, damageResult: dmgResult, enemy, killed,
        sneakAttackDmg, rageBonusApplied, canSmite,
    };
}

/**
 * Get a reasonable damage expression for the player based on class.
 */
function _getPlayerDamageExpr(playerChar, cls) {
    const primaryMod = abilityModifier(playerChar.stats[cls?.primaryAbility?.[0] || 'STR']);
    const modStr = primaryMod > 0 ? `+${primaryMod}` : '';

    // Simplified: weapon damage by class archetype
    if (['barbarian'].includes(cls?.id)) return `1D12${modStr}`;
    if (['fighter', 'paladin'].includes(cls?.id)) return `1D8${modStr}`;
    if (['ranger', 'rogue'].includes(cls?.id)) return `1D8${modStr}`;
    if (['monk'].includes(cls?.id)) return `1D6${modStr}`;
    if (['wizard', 'sorcerer', 'warlock'].includes(cls?.id)) return `1D10${modStr}`; // cantrip
    if (['cleric', 'druid'].includes(cls?.id)) return `1D8${modStr}`;
    if (['bard'].includes(cls?.id)) return `1D8${modStr}`;
    return `1D6${modStr}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Enemy Attack
// ═══════════════════════════════════════════════════════════════════════

/**
 * Process an enemy's attack on player or partner (random target, preferring non-downed).
 * @param {object} combatState
 * @param {number} enemyIdx
 * @param {object} playerChar
 * @param {object} partnerChar
 * @returns {{ attackResult, damageResult, target: 'player'|'partner', enemy, hpBefore, hpAfter }}
 */
export function processEnemyAttack(combatState, enemyIdx, playerChar, partnerChar) {
    const enemy = combatState.enemies[enemyIdx];
    if (!enemy || enemy.isDead) return null;

    // Choose target: prefer non-downed, random between player/partner
    let target;
    if (combatState.playerDown && !combatState.partnerDown) target = 'partner';
    else if (combatState.partnerDown && !combatState.playerDown) target = 'player';
    else if (combatState.playerDown && combatState.partnerDown) {
        // Both down — attack downed player (auto death save failure)
        target = 'player';
    } else {
        target = Math.random() < 0.5 ? 'player' : 'partner';
    }

    const targetChar = target === 'player' ? playerChar : partnerChar;
    const targetAC = targetChar.ac;

    // Parse enemy's attack bonus
    const atkBonus = parseInt(enemy.attack) || 0;

    // Roll attack
    const d20 = roll(20);
    const isNat20 = d20 === 20;
    const isNat1 = d20 === 1;
    const total = d20 + atkBonus;
    let hit;
    if (isNat20) hit = true;
    else if (isNat1) hit = false;
    else hit = total >= targetAC;

    const atkResult = {
        d20, bonus: atkBonus, total, targetAC, hit, isNat20, isNat1, isCritical: isNat20,
        summary: `D20(${d20}) + ${atkBonus} = ${total} ${hit ? '≥' : '<'} AC ${targetAC} → ${hit ? '命中' : '未命中'}${isNat20 ? ' ★暴击！' : ''}${isNat1 ? ' ✗大失败！' : ''}`,
    };

    let dmgResult = null;
    const hpBefore = targetChar.currentHP;
    let hpAfter = hpBefore;

    if (hit) {
        dmgResult = damageRoll(enemy.damage, isNat20);

        // If target is already downed, hit = auto death save failure
        const isTargetDown = target === 'player' ? combatState.playerDown : combatState.partnerDown;
        if (isTargetDown) {
            // An attack on a downed creature in melee = 2 death save failures  
            const saves = combatState.deathSaves[target];
            saves.failures = Math.min(3, saves.failures + (isNat20 ? 2 : 1));
        } else {
            // Normal damage
            hpAfter = Math.max(0, targetChar.currentHP - dmgResult.total);
            targetChar.currentHP = hpAfter;
            updateHP(target, hpAfter);

            // Check if downed
            if (hpAfter <= 0) {
                if (target === 'player') combatState.playerDown = true;
                else combatState.partnerDown = true;
            }
        }
    }

    // Save (single atomic write)
    const data = loadDndData();
    if (data.currentRun) {
        data.currentRun.combatState = combatState;
        saveDndData(data);
    }

    return {
        attackResult: atkResult,
        damageResult: dmgResult,
        target,
        enemy,
        hpBefore,
        hpAfter,
    };
}

// ═══════════════════════════════════════════════════════════════════════
// Partner Attack
// ═══════════════════════════════════════════════════════════════════════

/**
 * Process the partner's attack on an enemy.
 * @param {object} combatState
 * @param {object} partnerChar
 * @param {number} targetIdx — index of enemy to attack (auto-pick first alive if null)
 * @returns {{ attackResult, damageResult, enemy, killed, actionType }}
 */
export function processPartnerAttack(combatState, partnerChar, targetIdx = null) {
    // Auto-pick first alive enemy if no target specified
    if (targetIdx === null || targetIdx === undefined) {
        targetIdx = combatState.enemies.findIndex(e => !e.isDead);
    }
    // Use same ability-aware attack path as player
    const result = _processAttackWithAbilities(combatState, partnerChar, targetIdx, 'partner');
    if (result) result.actionType = 'attack';
    return result;
}

// ═══════════════════════════════════════════════════════════════════════
// Class Ability Processing
// ═══════════════════════════════════════════════════════════════════════

/**
 * Process an active class ability use.
 * Handles: toggle (Rage), instant (Second Wind, Action Surge, Flurry of Blows).
 * Does NOT handle passive (Sneak Attack) or on_hit (Divine Smite) — those are inline.
 *
 * @param {object} combatState
 * @param {object} casterChar — mutable character
 * @param {string} abilityId
 * @param {number|null} targetIdx — enemy index for offensive abilities
 * @param {'player'|'partner'} who
 * @returns {{ success, ability, message, healResult?, damageResult?, extraAttackGranted? }}
 */
export function processClassAbility(combatState, casterChar, abilityId, targetIdx, who) {
    const ability = CLASS_ABILITIES[abilityId];
    if (!ability) return { success: false, message: `未知能力: ${abilityId}` };

    // Check if can use
    const remaining = getAbilityUsesRemaining(casterChar, abilityId);
    if (remaining <= 0) return { success: false, message: `${ability.name}已用完` };

    // Consume use
    const consumed = consumeAbilityUse(casterChar, abilityId);
    if (!consumed) return { success: false, message: `无法使用${ability.name}` };

    const data = loadDndData();

    // ── Toggle: Rage ──
    if (ability.type === 'toggle') {
        if (!combatState.activeBuffs) combatState.activeBuffs = { player: {}, partner: {} };
        if (!combatState.activeBuffs[who]) combatState.activeBuffs[who] = {};
        combatState.activeBuffs[who].rage = true;

        // Save character ability uses + combatState (single atomic write)
        if (who === 'player') data.playerCharacter = casterChar;
        else data.partnerCharacter = casterChar;
        data.currentRun.combatState = combatState;
        saveDndData(data);

        return {
            success: true, ability,
            message: `${ability.name}！近战伤害+${ability.effect.meleeDamageBonus}，物理伤害抗性！`,
        };
    }

    // ── Instant: Second Wind (heal) ──
    if (abilityId === 'fighter_second_wind') {
        const healDice = ability.effect.heal;
        const healRoll = damageRoll(healDice).total;
        const levelBonus = ability.effect.healBonusLevel ? casterChar.level : 0;
        const healAmount = Math.max(1, healRoll + levelBonus);

        const hpBefore = casterChar.currentHP;
        const hpAfter = Math.min(casterChar.maxHP, hpBefore + healAmount);
        casterChar.currentHP = hpAfter;
        updateHP(who, hpAfter);

        // Revive if downed
        const wasDown = who === 'player' ? combatState.playerDown : combatState.partnerDown;
        if (wasDown && hpAfter > 0) {
            if (who === 'player') {
                combatState.playerDown = false;
                combatState.deathSaves.player = { successes: 0, failures: 0 };
            } else {
                combatState.partnerDown = false;
                combatState.deathSaves.partner = { successes: 0, failures: 0 };
            }
        }

        if (who === 'player') data.playerCharacter = casterChar;
        else data.partnerCharacter = casterChar;
        data.currentRun.combatState = combatState;
        saveDndData(data);

        return {
            success: true, ability,
            healResult: { healAmount, hpBefore, hpAfter },
            message: `${ability.name}：恢复 ${healAmount} HP (${hpBefore} → ${hpAfter})`,
        };
    }

    // ── Instant: Action Surge (extra attack this turn) ──
    if (abilityId === 'fighter_action_surge') {
        if (!combatState.actionSurgePending) combatState.actionSurgePending = { player: false, partner: false };
        combatState.actionSurgePending[who] = true;

        if (who === 'player') data.playerCharacter = casterChar;
        else data.partnerCharacter = casterChar;
        data.currentRun.combatState = combatState;
        saveDndData(data);

        return {
            success: true, ability, extraAttackGranted: true,
            message: `${ability.name}！获得额外一次攻击！`,
        };
    }

    // ── Instant: Flurry of Blows (extra unarmed strike) ──
    if (abilityId === 'monk_flurry') {
        const enemy = combatState.enemies[targetIdx];
        if (!enemy || enemy.isDead) return { success: false, message: '目标无效' };

        const derived = getCharacterDerived(casterChar);
        const atkResult = attackRoll(
            casterChar.stats[derived.primaryAbility],
            casterChar.proficiencyBonus,
            enemy.ac
        );

        let dmgResult = null;
        let killed = false;

        if (atkResult.hit) {
            dmgResult = damageRoll(ability.effect.extraUnarmed, atkResult.isCritical);
            // Add DEX or STR mod
            const dexMod = abilityModifier(casterChar.stats.DEX);
            dmgResult.total += Math.max(0, dexMod);
            dmgResult.detail += ` +${dexMod}(敏捷)`;

            enemy.currentHP = Math.max(0, enemy.currentHP - dmgResult.total);
            if (enemy.currentHP <= 0) {
                enemy.isDead = true;
                killed = true;
            }
        }

        if (who === 'player') data.playerCharacter = casterChar;
        else data.partnerCharacter = casterChar;
        data.currentRun.combatState = combatState;
        saveDndData(data);

        return {
            success: true, ability,
            attackResult: atkResult, damageResult: dmgResult, enemy, killed,
            message: atkResult.hit
                ? `${ability.name}！额外拳击命中，造成 ${dmgResult.total} 点伤害${killed ? '，击杀！' : ''}`
                : `${ability.name}！额外拳击 —— ${atkResult.summary}`,
        };
    }

    // Generic fallback
    if (who === 'player') data.playerCharacter = casterChar;
    else data.partnerCharacter = casterChar;
    data.currentRun.combatState = combatState;
    saveDndData(data);

    return { success: true, ability, message: `使用了${ability.name}` };
}

/**
 * Process Paladin Divine Smite after a successful hit.
 * Called separately when player confirms smite.
 * @param {object} combatState
 * @param {object} paladinChar — mutable
 * @param {number} targetIdx
 * @param {'player'|'partner'} who
 * @returns {{ success, smiteDamage, enemy, killed, message }}
 */
export function processDivineSmite(combatState, paladinChar, targetIdx, who) {
    const ability = CLASS_ABILITIES.paladin_smite;
    const consumed = consumeAbilityUse(paladinChar, 'paladin_smite');
    if (!consumed) return { success: false, message: '没有可用的法术位' };

    const enemy = combatState.enemies[targetIdx];
    if (!enemy || enemy.isDead) return { success: false, message: '目标无效' };

    const smiteRoll = damageRoll(ability.effect.bonusDice);

    enemy.currentHP = Math.max(0, enemy.currentHP - smiteRoll.total);
    const killed = enemy.currentHP <= 0;
    if (killed) enemy.isDead = true;

    const data = loadDndData();
    if (who === 'player') data.playerCharacter = paladinChar;
    else data.partnerCharacter = paladinChar;
    data.currentRun.combatState = combatState;
    saveDndData(data);

    return {
        success: true,
        smiteDamage: smiteRoll,
        enemy, killed,
        message: `神圣打击！额外 ${smiteRoll.total} 点光辉伤害${killed ? '，击杀！' : ''}`,
    };
}

/**
 * Partner heals player (for healer classes).
 * @param {object} combatState
 * @param {object} partnerChar
 * @param {object} playerChar
 * @returns {{ healAmount, hpBefore, hpAfter }}
 */
export function processPartnerHeal(combatState, partnerChar, playerChar) {
    // Healing: 1D8 + WIS modifier
    const wisMod = abilityModifier(partnerChar.stats.WIS);
    const healAmount = Math.max(1, roll(8) + wisMod);

    const hpBefore = playerChar.currentHP;
    const hpAfter = Math.min(playerChar.maxHP, hpBefore + healAmount);
    updateHP('player', hpAfter);

    // If player was downed and gets healed, they get back up
    if (combatState.playerDown && hpAfter > 0) {
        combatState.playerDown = false;
        combatState.deathSaves.player = { successes: 0, failures: 0 };
    }

    // Save combatState (single atomic write)
    const data = loadDndData();
    if (data.currentRun) {
        data.currentRun.combatState = combatState;
        saveDndData(data);
    }
    return { healAmount, hpBefore, hpAfter };
}

/**
 * Decide what the partner should do based on situation.
 * @param {object} combatState
 * @param {object} playerChar
 * @param {object} partnerChar
 * @returns {'attack'|'heal'|'use_potion_self'|'use_potion_on_player'|'cast_aoe'|'cast_damage'}
 */
export function decidePartnerAction(combatState, playerChar, partnerChar) {
    const cls = CLASSES.find(c => c.id === partnerChar.class);
    const canHeal = cls?.spellcaster && ['cleric', 'druid', 'paladin', 'bard', 'ranger'].includes(cls.id);
    const hasPotion = partnerChar.inventory?.some(i => i.includes('治疗药水'));

    // ── Self-preservation: partner drinks potion if own HP < 30% ──
    if (hasPotion && partnerChar.currentHP / partnerChar.maxHP < 0.3) {
        return 'use_potion_self';
    }

    // ── Spell healing (healer classes) ──
    if (canHeal) {
        if (combatState.playerDown) return 'heal';
        if (playerChar.currentHP / playerChar.maxHP < 0.3) return 'heal';
    }

    // ── Potion on player: non-healer with potions helps downed/low player ──
    if (!canHeal && hasPotion) {
        if (combatState.playerDown) return 'use_potion_on_player';
        if (playerChar.currentHP / playerChar.maxHP < 0.3) return 'use_potion_on_player';
    }

    // Consider casting a spell if partner has spell slots and combat spells
    if (cls?.spellcaster) {
        const combatSpells = getCombatSpells(partnerChar);
        const castable = combatSpells.filter(s => s.canCast && s.spell.type === 'damage' && s.spell.level > 0);
        const aliveEnemies = combatState.enemies.filter(e => !e.isDead);

        // Prefer AoE spell if multiple enemies alive
        if (aliveEnemies.length >= 2 && castable.some(s => s.spell.target === 'all_enemies')) {
            return 'cast_aoe';
        }
        // ~40% chance to cast a single-target damage spell when available
        if (castable.length > 0 && Math.random() < 0.4) {
            return 'cast_damage';
        }
    }

    return 'attack';
}

// ═══════════════════════════════════════════════════════════════════════
// Death Saving Throws
// ═══════════════════════════════════════════════════════════════════════

/**
 * Process a death saving throw for player or partner.
 * @param {object} combatState
 * @param {'player'|'partner'} who
 * @returns {{ result: object, stabilized: boolean, dead: boolean, revived: boolean }}
 */
export function processDeathSave(combatState, who) {
    const saves = combatState.deathSaves[who];
    const result = deathSavingThrow();

    let stabilized = false;
    let dead = false;
    let revived = false;

    if (result.result === 'nat20') {
        // Regain 1 HP, conscious again!
        updateHP(who, 1);
        if (who === 'player') combatState.playerDown = false;
        else combatState.partnerDown = false;
        saves.successes = 0;
        saves.failures = 0;
        revived = true;
    } else if (result.result === 'nat1') {
        saves.failures = Math.min(3, saves.failures + 2);
    } else if (result.result === 'success') {
        saves.successes++;
    } else {
        saves.failures++;
    }

    if (saves.successes >= 3) stabilized = true;
    if (saves.failures >= 3) dead = true;

    // Save combatState (single atomic write)
    const data = loadDndData();
    if (data.currentRun) {
        data.currentRun.combatState = combatState;
        saveDndData(data);
    }
    return { result, stabilized, dead, revived };
}

// ═══════════════════════════════════════════════════════════════════════
// Item Usage
// ═══════════════════════════════════════════════════════════════════════

/**
 * Use an item during combat (e.g. healing potion).
 * @param {object} combatState
 * @param {'player'|'partner'} who — who uses the item (from whose inventory)
 * @param {string} itemName
 * @param {object} playerChar
 * @param {object} partnerChar
 * @param {'player'|'partner'|null} healTarget — who receives the healing (null = same as `who`)
 * @returns {{ success: boolean, healAmount?: number, hpBefore?: number, hpAfter?: number, healTarget?: string, message: string }}
 */
export function processUseItem(combatState, who, itemName, playerChar, partnerChar, healTarget = null) {
    const data = loadDndData();
    const char = who === 'player' ? data.playerCharacter : data.partnerCharacter;
    if (!char) return { success: false, message: '角色不存在' };

    const idx = char.inventory.indexOf(itemName);
    if (idx === -1) return { success: false, message: '背包中没有这个物品' };

    // Determine who receives the healing (default: self)
    const actualTarget = healTarget || who;
    const targetChar = actualTarget === 'player' ? data.playerCharacter : data.partnerCharacter;

    // Identify item effect
    if (itemName.includes('治疗药水') || itemName.includes('Healing Potion')) {
        // Standard healing potion: 2D4+2
        // Greater healing potion: 4D4+4
        const isGreater = itemName.includes('高等');
        const healRoll = isGreater ? (roll(4) + roll(4) + roll(4) + roll(4) + 4) : (roll(4) + roll(4) + 2);
        const hpBefore = targetChar.currentHP;
        const hpAfter = Math.min(targetChar.maxHP, hpBefore + healRoll);

        // Remove item from inventory (from user's bag)
        char.inventory.splice(idx, 1);
        // Apply healing to target
        targetChar.currentHP = hpAfter;
        saveDndData(data);

        // If target was downed and healed, revive
        const wasDown = actualTarget === 'player' ? combatState.playerDown : combatState.partnerDown;
        if (wasDown && hpAfter > 0) {
            if (actualTarget === 'player') {
                combatState.playerDown = false;
                combatState.deathSaves.player = { successes: 0, failures: 0 };
            } else {
                combatState.partnerDown = false;
                combatState.deathSaves.partner = { successes: 0, failures: 0 };
            }
            data.currentRun.combatState = combatState;
            saveDndData(data);
        }

        const targetLabel = actualTarget !== who
            ? (actualTarget === 'player' ? '玩家' : '搭档')
            : '';
        const targetSuffix = targetLabel ? `（${targetLabel}）` : '';

        return {
            success: true,
            healAmount: healRoll,
            hpBefore,
            hpAfter,
            healTarget: actualTarget,
            message: `${isGreater ? '高等' : ''}治疗药水${targetSuffix}：恢复 ${healRoll} HP (${hpBefore} → ${hpAfter})`,
        };
    }

    return { success: false, message: `不知道怎么使用「${itemName}」` };
}

/**
 * Partner auto-uses a healing potion from their own inventory.
 * @param {object} combatState
 * @param {object} partnerChar — mutable
 * @param {'self'|'player'} target — heal self or player
 * @param {object} [playerChar] — needed when target is 'player'
 * @returns {{ success, potionName, healAmount, hpBefore, hpAfter, targetWho }}
 */
export function processPartnerUsePotion(combatState, partnerChar, target, playerChar) {
    // Find best potion (prefer 高等 first)
    let potionIdx = partnerChar.inventory?.findIndex(i => i.includes('高等治疗药水'));
    if (potionIdx === undefined || potionIdx === -1) {
        potionIdx = partnerChar.inventory?.findIndex(i => i.includes('治疗药水'));
    }
    if (potionIdx === undefined || potionIdx === -1) {
        return { success: false, message: '背包中没有治疗药水' };
    }

    const potionName = partnerChar.inventory[potionIdx];
    const healTarget = target === 'player' ? 'player' : 'partner';

    return processUseItem(combatState, 'partner', potionName, playerChar, partnerChar, healTarget);
}

// ═══════════════════════════════════════════════════════════════════════
// Combat Status Checks
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check if combat is over.
 * @param {object} combatState
 * @returns {{ over: boolean, result?: 'victory'|'defeat' }}
 */
export function isCombatOver(combatState) {
    // All enemies dead
    const allDead = combatState.enemies.every(e => e.isDead);
    if (allDead) return { over: true, result: 'victory' };

    // Check for party wipe (death save failures)
    const playerDead = combatState.deathSaves.player.failures >= 3;
    const partnerDead = combatState.deathSaves.partner.failures >= 3;
    if (playerDead && partnerDead) return { over: true, result: 'defeat' };

    // Both downed but not dead yet — combat continues (death saves happen)
    return { over: false };
}

/**
 * Get a text summary of current combat state for LLM context.
 * @param {object} combatState
 * @param {object} playerChar
 * @param {object} partnerChar
 * @returns {string}
 */
export function getCombatSummary(combatState, playerChar, partnerChar) {
    const lines = [];
    lines.push(`[回合制战斗 — 第 ${combatState.roundNumber} 轮]`);

    const currentTurn = getCurrentTurnInfo(combatState);
    lines.push(`当前回合：${currentTurn.label}`);

    lines.push(`玩家 HP: ${playerChar.currentHP}/${playerChar.maxHP}${combatState.playerDown ? ' [倒地]' : ''}`);
    lines.push(`搭档 HP: ${partnerChar.currentHP}/${partnerChar.maxHP}${combatState.partnerDown ? ' [倒地]' : ''}`);

    for (let i = 0; i < combatState.enemies.length; i++) {
        const e = combatState.enemies[i];
        lines.push(`敌人${i + 1} ${e.name}: HP ${e.currentHP}/${e.maxHP} AC ${e.ac}${e.isDead ? ' [已死亡]' : ''}`);
    }

    return lines.join('\n');
}

/**
 * Build initiative summary text for display.
 * @param {object} combatState
 * @returns {string}
 */
export function getInitiativeSummary(combatState) {
    return combatState.turnOrder.map(id => {
        const label = combatState.turnLabels[id] || id;
        const init = combatState.initiativeResults[id];
        return `${label}(${init})`;
    }).join(' → ');
}

// ═══════════════════════════════════════════════════════════════════════
// Spell Casting
// ═══════════════════════════════════════════════════════════════════════

/**
 * Process a spell cast by the player.
 * @param {object} combatState
 * @param {object} playerChar — mutable
 * @param {string} spellId — ID from SPELL_LIST
 * @param {number|null} targetIdx — enemy index (for damage spells) or null
 * @returns {{ success, spell, damageResult?, healResult?, targetName?, slotUsed }}
 */
export function processPlayerSpell(combatState, playerChar, spellId, targetIdx) {
    return _processSpellCast(combatState, playerChar, spellId, targetIdx, 'player');
}

/**
 * Process a spell cast by the partner.
 */
export function processPartnerSpell(combatState, partnerChar, spellId, targetIdx) {
    return _processSpellCast(combatState, partnerChar, spellId, targetIdx, 'partner');
}

/**
 * Pick a spell for the partner to cast based on action type.
 * @param {object} combatState
 * @param {object} partnerChar
 * @param {'cast_aoe'|'cast_damage'} actionType
 * @returns {{ spellId: string, targetIdx: number|null }|null}
 */
export function pickPartnerSpell(combatState, partnerChar, actionType) {
    const combatSpells = getCombatSpells(partnerChar);
    const castable = combatSpells.filter(s => s.canCast && s.spell.type === 'damage' && s.spell.level > 0);
    if (castable.length === 0) return null;

    if (actionType === 'cast_aoe') {
        const aoe = castable.find(s => s.spell.target === 'all_enemies');
        if (aoe) return { spellId: aoe.spell.id, targetIdx: null };
    }

    // Pick highest-level castable damage spell
    castable.sort((a, b) => b.spell.level - a.spell.level);
    const pick = castable[0];
    const targetIdx = combatState.enemies.findIndex(e => !e.isDead);
    return { spellId: pick.spell.id, targetIdx: targetIdx >= 0 ? targetIdx : null };
}

/**
 * Internal: Process a spell cast by anyone.
 */
function _processSpellCast(combatState, caster, spellId, targetIdx, who) {
    const spell = SPELL_LIST[spellId];
    if (!spell) return { success: false, message: `未知法术: ${spellId}` };

    // Consume spell slot (cantrips are free)
    if (spell.level > 0) {
        const consumed = consumeSpellSlot(caster, spell.level);
        if (!consumed) return { success: false, message: `没有可用的${spell.level}级法术位` };
    }

    const data = loadDndData();
    const cls = CLASSES.find(c => c.id === caster.class);
    const spellMod = cls?.spellAbility ? abilityModifier(caster.stats[cls.spellAbility]) : 0;

    // ── DAMAGE SPELL ──
    if (spell.type === 'damage') {
        if (spell.target === 'all_enemies') {
            // AoE: damage all alive enemies
            let totalDmg = 0;
            const results = [];
            for (const enemy of combatState.enemies) {
                if (enemy.isDead) continue;
                let dmg = 0;
                if (spell.dice && spell.dice !== '0') {
                    const dmgResult = damageRoll(spell.dice);
                    dmg = dmgResult.total;
                }
                if (spell.useCasterMod) dmg += Math.max(0, spellMod);
                enemy.currentHP = Math.max(0, enemy.currentHP - dmg);
                if (enemy.currentHP <= 0) enemy.isDead = true;
                totalDmg += dmg;
                results.push({ name: enemy.name, dmg, killed: enemy.isDead });
            }
            // Save state (single atomic write)
            if (who === 'player') data.playerCharacter = caster;
            else data.partnerCharacter = caster;
            data.currentRun.combatState = combatState;
            saveDndData(data);

            return {
                success: true, spell, slotUsed: spell.level > 0,
                aoe: true, results, totalDmg,
                message: `${spell.name}！对所有敌人造成总共 ${totalDmg} 点伤害`,
            };
        } else {
            // Single target
            const enemy = combatState.enemies[targetIdx];
            if (!enemy || enemy.isDead) return { success: false, message: '目标无效' };

            let dmg = 0;
            let dmgDetail = '';
            if (spell.autoHit) {
                // Auto-hit (e.g. Magic Missile)
                const dmgResult = damageRoll(spell.dice);
                dmg = dmgResult.total;
                dmgDetail = dmgResult.detail;
            } else if (spell.multiHit) {
                // Multiple rays (e.g. Scorching Ray)
                let total = 0;
                const hits = [];
                for (let i = 0; i < spell.multiHit; i++) {
                    const atkResult = attackRoll(caster.stats[cls?.spellAbility || 'INT'], caster.proficiencyBonus, enemy.ac);
                    if (atkResult.hit) {
                        const r = damageRoll(spell.dice, atkResult.isCritical);
                        total += r.total;
                        hits.push(`命中(${r.total})`);
                    } else {
                        hits.push('未命中');
                    }
                }
                dmg = total;
                dmgDetail = hits.join(', ');
            } else {
                // Normal spell attack or save
                const dmgResult = damageRoll(spell.dice);
                dmg = dmgResult.total;
                dmgDetail = dmgResult.detail;
            }
            if (spell.useCasterMod) dmg += Math.max(0, spellMod);

            enemy.currentHP = Math.max(0, enemy.currentHP - dmg);
            const killed = enemy.currentHP <= 0;
            if (killed) enemy.isDead = true;

            if (who === 'player') data.playerCharacter = caster;
            else data.partnerCharacter = caster;
            data.currentRun.combatState = combatState;
            saveDndData(data);

            return {
                success: true, spell, slotUsed: spell.level > 0,
                damageResult: { total: dmg, detail: dmgDetail },
                enemy, killed, targetName: enemy.name,
                message: `${spell.name}对${enemy.name}造成 ${dmg} 点伤害${killed ? '，击杀！' : ''}`,
            };
        }
    }

    // ── HEAL SPELL ──
    if (spell.type === 'heal') {
        const targetChar = who === 'player' ? data.playerCharacter : data.partnerCharacter;
        // Paladin Lay on Hands: level * 5
        let healAmount;
        if (spell.specialHeal) {
            healAmount = caster.level * 5;
        } else {
            const healRoll = spell.dice && spell.dice !== '0' ? damageRoll(spell.dice).total : 0;
            healAmount = healRoll + (spell.useCasterMod ? Math.max(0, spellMod) : 0);
        }
        healAmount = Math.max(1, healAmount);

        // Heal the other person: player heals partner, partner heals player
        const healWho = who === 'player' ? 'partner' : 'player';
        const charToHeal = healWho === 'player' ? data.playerCharacter : data.partnerCharacter;
        const hpBefore = charToHeal.currentHP;
        const hpAfter = Math.min(charToHeal.maxHP, hpBefore + healAmount);
        charToHeal.currentHP = hpAfter;

        // If downed and healed, revive
        const isDown = healWho === 'player' ? combatState.playerDown : combatState.partnerDown;
        if (isDown && hpAfter > 0) {
            if (healWho === 'player') {
                combatState.playerDown = false;
                combatState.deathSaves.player = { successes: 0, failures: 0 };
            } else {
                combatState.partnerDown = false;
                combatState.deathSaves.partner = { successes: 0, failures: 0 };
            }
        }

        if (who === 'player') data.playerCharacter = caster;
        else data.partnerCharacter = caster;
        data.currentRun.combatState = combatState;
        saveDndData(data);

        return {
            success: true, spell, slotUsed: spell.level > 0,
            healResult: { healAmount, hpBefore, hpAfter },
            message: `${spell.name}：恢复 ${healAmount} HP (${hpBefore} → ${hpAfter})`,
        };
    }

    // ── BUFF SPELL ──
    if (spell.type === 'buff') {
        if (who === 'player') data.playerCharacter = caster;
        else data.partnerCharacter = caster;
        data.currentRun.combatState = combatState;
        saveDndData(data);

        return {
            success: true, spell, slotUsed: spell.level > 0,
            buffEffect: spell.buffEffect || null,
            message: `${spell.name}：${spell.description}`,
        };
    }

    return { success: false, message: '未知法术类型' };
}

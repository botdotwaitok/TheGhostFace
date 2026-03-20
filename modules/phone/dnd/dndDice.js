// modules/phone/dnd/dndDice.js — D&D 5e Dice Engine
// All dice rolls are computed client-side for fairness.
// LLM receives results and narrates — it never decides dice outcomes.

const DND_DICE_LOG = '[D&D Dice]';

// ═══════════════════════════════════════════════════════════════════════
// Core Roll
// ═══════════════════════════════════════════════════════════════════════

/**
 * Roll a single die with the given number of sides.
 * @param {number} sides — e.g. 20 for D20
 * @returns {number} result in [1, sides]
 */
export function roll(sides) {
    return Math.floor(Math.random() * sides) + 1;
}

/**
 * Roll multiple dice and return individual results + total.
 * @param {number} count — number of dice
 * @param {number} sides — sides per die
 * @returns {{ rolls: number[], total: number }}
 */
export function rollMultiple(count, sides) {
    const rolls = [];
    for (let i = 0; i < count; i++) {
        rolls.push(roll(sides));
    }
    return { rolls, total: rolls.reduce((a, b) => a + b, 0) };
}

// ═══════════════════════════════════════════════════════════════════════
// D20 with Advantage / Disadvantage
// ═══════════════════════════════════════════════════════════════════════

/**
 * Roll D20 with advantage (roll 2, take higher).
 * @returns {{ roll1: number, roll2: number, result: number }}
 */
export function rollWithAdvantage() {
    const roll1 = roll(20);
    const roll2 = roll(20);
    return { roll1, roll2, result: Math.max(roll1, roll2) };
}

/**
 * Roll D20 with disadvantage (roll 2, take lower).
 * @returns {{ roll1: number, roll2: number, result: number }}
 */
export function rollWithDisadvantage() {
    const roll1 = roll(20);
    const roll2 = roll(20);
    return { roll1, roll2, result: Math.min(roll1, roll2) };
}

// ═══════════════════════════════════════════════════════════════════════
// D&D 5e Checks
// ═══════════════════════════════════════════════════════════════════════

/**
 * Calculate ability modifier from an ability score.
 * D&D 5e formula: floor((score - 10) / 2)
 * @param {number} score — ability score (e.g. 16)
 * @returns {number} modifier (e.g. +3)
 */
export function abilityModifier(score) {
    return Math.floor((score - 10) / 2);
}

/**
 * Perform an ability check (D20 + mod + optional proficiency).
 * @param {number} abilityScore — the relevant ability score
 * @param {boolean} proficient — whether the character is proficient
 * @param {number} profBonus — proficiency bonus (typically +2 to +6)
 * @param {number} dc — difficulty class
 * @param {'normal'|'advantage'|'disadvantage'} mode
 * @returns {object} detailed result
 */
export function abilityCheck(abilityScore, proficient, profBonus, dc, mode = 'normal') {
    const mod = abilityModifier(abilityScore);
    const bonus = mod + (proficient ? profBonus : 0);

    let d20Result, rollDetail;
    if (mode === 'advantage') {
        const adv = rollWithAdvantage();
        d20Result = adv.result;
        rollDetail = `D20(${adv.roll1}, ${adv.roll2})取高=${d20Result}`;
    } else if (mode === 'disadvantage') {
        const dis = rollWithDisadvantage();
        d20Result = dis.result;
        rollDetail = `D20(${dis.roll1}, ${dis.roll2})取低=${d20Result}`;
    } else {
        d20Result = roll(20);
        rollDetail = `D20(${d20Result})`;
    }

    const total = d20Result + bonus;
    const success = total >= dc;
    const isNat20 = d20Result === 20;
    const isNat1 = d20Result === 1;

    return {
        d20: d20Result,
        modifier: mod,
        proficient,
        profBonus: proficient ? profBonus : 0,
        bonus,
        total,
        dc,
        success,
        isNat20,
        isNat1,
        rollDetail,
        summary: `${rollDetail} + 修正(${bonus >= 0 ? '+' : ''}${bonus}) = ${total} ${success ? '≥' : '<'} DC ${dc} → ${success ? '成功' : '失败'}${isNat20 ? ' ★大成功！' : ''}${isNat1 ? ' ✗大失败！' : ''}`,
    };
}

/**
 * Perform an attack roll.
 * @param {number} abilityScore — STR or DEX
 * @param {number} profBonus — proficiency bonus
 * @param {number} targetAC — target's armor class
 * @param {'normal'|'advantage'|'disadvantage'} mode
 * @returns {object} detailed result
 */
export function attackRoll(abilityScore, profBonus, targetAC, mode = 'normal') {
    const mod = abilityModifier(abilityScore);
    const bonus = mod + profBonus;

    let d20Result, rollDetail;
    if (mode === 'advantage') {
        const adv = rollWithAdvantage();
        d20Result = adv.result;
        rollDetail = `D20(${adv.roll1}, ${adv.roll2})取高=${d20Result}`;
    } else if (mode === 'disadvantage') {
        const dis = rollWithDisadvantage();
        d20Result = dis.result;
        rollDetail = `D20(${dis.roll1}, ${dis.roll2})取低=${d20Result}`;
    } else {
        d20Result = roll(20);
        rollDetail = `D20(${d20Result})`;
    }

    const isNat20 = d20Result === 20;
    const isNat1 = d20Result === 1;

    // Nat 20 = auto hit, Nat 1 = auto miss (D&D 5e attack rules)
    let hit;
    if (isNat20) hit = true;
    else if (isNat1) hit = false;
    else hit = (d20Result + bonus) >= targetAC;

    const total = d20Result + bonus;

    return {
        d20: d20Result,
        modifier: mod,
        profBonus,
        bonus,
        total,
        targetAC,
        hit,
        isNat20,
        isNat1,
        isCritical: isNat20,
        rollDetail,
        summary: `${rollDetail} + 攻击加值(${bonus >= 0 ? '+' : ''}${bonus}) = ${total} ${hit ? '≥' : '<'} AC ${targetAC} → ${hit ? '命中' : '未命中'}${isNat20 ? ' ★暴击！' : ''}${isNat1 ? ' ✗大失败！' : ''}`,
    };
}

/**
 * Roll initiative (D20 + DEX modifier).
 * @param {number} dexScore — dexterity score
 * @returns {{ d20: number, modifier: number, total: number }}
 */
export function initiativeRoll(dexScore) {
    const mod = abilityModifier(dexScore);
    const d20 = roll(20);
    return { d20, modifier: mod, total: d20 + mod };
}

// ═══════════════════════════════════════════════════════════════════════
// Damage Rolls — Parse expressions like "2D6+3", "1D8", "3D4+2"
// ═══════════════════════════════════════════════════════════════════════

/**
 * Parse and roll a dice expression (e.g. "2D6+3", "1D8", "4D6").
 * @param {string} expr — dice expression
 * @param {boolean} critical — if true, double the dice count (D&D 5e crit)
 * @returns {{ expr: string, rolls: number[], bonus: number, total: number, detail: string }}
 */
export function damageRoll(expr, critical = false) {
    const match = expr.toUpperCase().match(/^(\d+)D(\d+)(?:\+(\d+))?$/);
    if (!match) {
        console.warn(`${DND_DICE_LOG} Invalid dice expression: ${expr}`);
        return { expr, rolls: [], bonus: 0, total: 0, detail: `无效表达式: ${expr}` };
    }

    let count = parseInt(match[1]);
    const sides = parseInt(match[2]);
    const bonus = match[3] ? parseInt(match[3]) : 0;

    // Critical hit: double dice count (D&D 5e rule)
    if (critical) count *= 2;

    const { rolls, total: diceTotal } = rollMultiple(count, sides);
    const total = diceTotal + bonus;

    const rollStr = rolls.map(r => `[${r}]`).join('');
    const bonusStr = bonus > 0 ? `+${bonus}` : '';
    const critLabel = critical ? '(暴击!)' : '';

    return {
        expr: critical ? `${count}D${sides}${bonusStr} ${critLabel}` : expr,
        rolls,
        bonus,
        total,
        detail: `${rollStr}${bonusStr} = ${total}${critical ? ' (暴击翻倍骰!)' : ''}`,
    };
}

// ═══════════════════════════════════════════════════════════════════════
// Saving Throw
// ═══════════════════════════════════════════════════════════════════════

/**
 * Perform a saving throw.
 * @param {number} abilityScore — the relevant ability score
 * @param {boolean} proficient — saving throw proficiency
 * @param {number} profBonus — proficiency bonus
 * @param {number} dc — difficulty class
 * @param {'normal'|'advantage'|'disadvantage'} mode
 * @returns {object} same shape as abilityCheck result
 */
export function savingThrow(abilityScore, proficient, profBonus, dc, mode = 'normal') {
    // Same mechanics as ability check
    return abilityCheck(abilityScore, proficient, profBonus, dc, mode);
}

// ═══════════════════════════════════════════════════════════════════════
// 4D6 Drop Lowest — For character creation
// ═══════════════════════════════════════════════════════════════════════

/**
 * Roll 4D6, drop the lowest — standard D&D ability score generation.
 * @returns {{ rolls: number[], dropped: number, total: number }}
 */
export function roll4D6DropLowest() {
    const { rolls } = rollMultiple(4, 6);
    const sorted = [...rolls].sort((a, b) => a - b);
    const dropped = sorted[0];
    const kept = sorted.slice(1);
    return {
        rolls,
        dropped,
        total: kept.reduce((a, b) => a + b, 0),
    };
}

/**
 * Generate a full set of 6 ability scores using 4D6-drop-lowest.
 * @returns {Array<{ rolls: number[], dropped: number, total: number }>}
 */
export function generateAbilityScores() {
    return Array.from({ length: 6 }, () => roll4D6DropLowest());
}

/** Standard array for those who don't want to roll */
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

// ═══════════════════════════════════════════════════════════════════════
// Death Saving Throws
// ═══════════════════════════════════════════════════════════════════════

/**
 * Roll a death saving throw (D&D 5e).
 * - Nat 20: regain 1 HP (conscious!)
 * - Nat 1: counts as 2 failures
 * - 10+: success
 * - <10: failure
 * @returns {{ d20: number, result: 'nat20'|'nat1'|'success'|'failure', description: string }}
 */
export function deathSavingThrow() {
    const d20 = roll(20);
    if (d20 === 20) return { d20, result: 'nat20', description: '★ Nat 20！恢复1点HP，重新站起来了！' };
    if (d20 === 1) return { d20, result: 'nat1', description: '✗ Nat 1！算作两次失败……' };
    if (d20 >= 10) return { d20, result: 'success', description: `D20(${d20}) ≥ 10 → 豁免成功` };
    return { d20, result: 'failure', description: `D20(${d20}) < 10 → 豁免失败` };
}

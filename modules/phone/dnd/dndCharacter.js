// modules/phone/dnd/dndCharacter.js — D&D 5e Character System
// Races, Classes, Ability Scores, and character creation logic.

import { abilityModifier, roll, STANDARD_ARRAY } from './dndDice.js';

// ═══════════════════════════════════════════════════════════════════════
// Races (D&D 5e PHB)
// ═══════════════════════════════════════════════════════════════════════

export const RACES = [
    {
        id: 'human', name: '人类', nameEn: 'Human', icon: 'ph-user',
        bonuses: { STR: 1, DEX: 1, CON: 1, INT: 1, WIS: 1, CHA: 1 },
        traits: ['额外语言', '额外技能熟练'],
        description: '适应力极强的种族，所有属性均匀提升。',
    },
    {
        id: 'elf', name: '精灵', nameEn: 'Elf', icon: 'ph-leaf',
        bonuses: { DEX: 2 },
        traits: ['黑暗视觉', '锐感官(察觉熟练)', '妖精血统(免魅惑睡眠)', '出神(4小时代替睡眠)'],
        description: '优雅而长寿的种族，敏捷超群，天生抗魅惑。',
    },
    {
        id: 'dwarf', name: '矮人', nameEn: 'Dwarf', icon: 'ph-hammer',
        bonuses: { CON: 2 },
        traits: ['黑暗视觉', '矮人韧性(毒素抗性)', '石工知识'],
        description: '坚韧如石的种族，体质卓越，天生抗毒。',
    },
    {
        id: 'halfling', name: '半身人', nameEn: 'Halfling', icon: 'ph-footprints',
        bonuses: { DEX: 2 },
        traits: ['幸运(Nat 1可重掷)', '勇敢(恐惧豁免优势)', '灵活(可穿过大型生物)'],
        description: '小而勇敢的种族，运气极佳，Nat 1 可以重掷！',
    },
    {
        id: 'dragonborn', name: '龙裔', nameEn: 'Dragonborn', icon: 'ph-fire',
        bonuses: { STR: 2, CHA: 1 },
        traits: ['龙息武器(选择元素类型)', '伤害抗性(对应元素)'],
        description: '拥有龙族血脉的战士，可以喷射龙息。',
    },
    {
        id: 'tiefling', name: '提夫林', nameEn: 'Tiefling', icon: 'ph-fire',
        bonuses: { CHA: 2, INT: 1 },
        traits: ['黑暗视觉', '火焰抗性', '地狱魔法(奇术/地狱咒斥/黑暗术)'],
        description: '流淌着魔鬼血液的种族，魅力超群，天生抗火。',
    },
    {
        id: 'half-elf', name: '半精灵', nameEn: 'Half-Elf', icon: 'ph-star-four',
        bonuses: { CHA: 2 }, // + 2 others chosen by player
        bonusChoices: 2, // player picks 2 abilities to get +1
        traits: ['黑暗视觉', '妖精血统', '技能多才(额外2个技能熟练)'],
        description: '兼具人类与精灵优点，魅力出众，可自选两项属性+1。',
    },
    {
        id: 'half-orc', name: '半兽人', nameEn: 'Half-Orc', icon: 'ph-sword',
        bonuses: { STR: 2, CON: 1 },
        traits: ['黑暗视觉', '坚韧不屈(HP归零时保留1HP,1次/长休)', '野蛮攻击(近战暴击额外1骰)'],
        description: '力量与体质俱佳的战士，被击倒时可以硬撑一次。',
    },
    {
        id: 'gnome', name: '侏儒', nameEn: 'Gnome', icon: 'ph-lightbulb',
        bonuses: { INT: 2 },
        traits: ['黑暗视觉', '侏儒狡黠(智力/感知/魅力豁免vs魔法获得优势)'],
        description: '聪慧好奇的小种族，天生抗魔法。',
    },
];

// ═══════════════════════════════════════════════════════════════════════
// Classes (D&D 5e PHB)
// ═══════════════════════════════════════════════════════════════════════

export const CLASSES = [
    {
        id: 'fighter', name: '战士', nameEn: 'Fighter', icon: 'ph-shield',
        hitDie: 10, primaryAbility: ['STR', 'DEX'],
        saveProficiencies: ['STR', 'CON'],
        armorProf: '所有护甲 + 盾牌',
        skillChoices: { count: 2, from: ['acrobatics', 'animal_handling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'] },
        features: ['格斗风格', '回复力(1次/短休恢复1D10+等级HP)', '动作如潮(Lv2)'],
        description: '近战或远程的战斗专家，多次攻击、格斗风格、坚韧耐久。',
        suggestedStats: ['STR', 'CON', 'DEX', 'WIS', 'CHA', 'INT'],
    },
    {
        id: 'ranger', name: '游侠', nameEn: 'Ranger', icon: 'ph-compass',
        hitDie: 10, primaryAbility: ['DEX', 'WIS'],
        saveProficiencies: ['STR', 'DEX'],
        armorProf: '轻甲 + 中甲 + 盾牌',
        skillChoices: { count: 3, from: ['animal_handling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'] },
        features: ['宿敌', '自然探索者', '猎人印记(Lv2)'],
        description: '荒野中的追踪者，擅长远程攻击和自然探索。',
        suggestedStats: ['DEX', 'WIS', 'CON', 'STR', 'INT', 'CHA'],
        spellcaster: true, spellAbility: 'WIS', spellSlots: { 2: { '1st': 2 }, 3: { '1st': 3 } },
    },
    {
        id: 'rogue', name: '盗贼', nameEn: 'Rogue', icon: 'ph-mask-happy',
        hitDie: 8, primaryAbility: ['DEX'],
        saveProficiencies: ['DEX', 'INT'],
        armorProf: '轻甲',
        skillChoices: { count: 4, from: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleight_of_hand', 'stealth'] },
        features: ['偷袭(1D6额外伤害,每级+1D6)', '盗贼暗语', '灵巧闪避(Lv2)'],
        description: '潜行和技巧的大师，偷袭伤害极高。',
        suggestedStats: ['DEX', 'CON', 'WIS', 'CHA', 'INT', 'STR'],
    },
    {
        id: 'wizard', name: '法师', nameEn: 'Wizard', icon: 'ph-magic-wand',
        hitDie: 6, primaryAbility: ['INT'],
        saveProficiencies: ['INT', 'WIS'],
        armorProf: '无',
        skillChoices: { count: 2, from: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'] },
        features: ['法术书', '奥术恢复(短休恢复法术位)', '庞大法术列表'],
        description: '学识渊博的奥术施法者，法术种类最多。',
        suggestedStats: ['INT', 'CON', 'DEX', 'WIS', 'CHA', 'STR'],
        spellcaster: true, spellAbility: 'INT', spellSlots: { 1: { '1st': 2 }, 2: { '1st': 3 }, 3: { '1st': 4, '2nd': 2 } },
    },
    {
        id: 'cleric', name: '牧师', nameEn: 'Cleric', icon: 'ph-cross',
        hitDie: 8, primaryAbility: ['WIS'],
        saveProficiencies: ['WIS', 'CHA'],
        armorProf: '轻甲 + 中甲 + 盾牌',
        skillChoices: { count: 2, from: ['history', 'insight', 'medicine', 'persuasion', 'religion'] },
        features: ['神圣领域', '引导神力', '治疗法术'],
        description: '神圣的信仰者，团队治疗和支援的核心。',
        suggestedStats: ['WIS', 'CON', 'STR', 'CHA', 'DEX', 'INT'],
        spellcaster: true, spellAbility: 'WIS', spellSlots: { 1: { '1st': 2 }, 2: { '1st': 3 }, 3: { '1st': 4, '2nd': 2 } },
    },
    {
        id: 'sorcerer', name: '术士', nameEn: 'Sorcerer', icon: 'ph-lightning',
        hitDie: 6, primaryAbility: ['CHA'],
        saveProficiencies: ['CON', 'CHA'],
        armorProf: '无',
        skillChoices: { count: 2, from: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'] },
        features: ['魔法起源', '超魔法(法术增强)', '天生法力(魔法点)'],
        description: '天赋型施法者，能增强法术效果。',
        suggestedStats: ['CHA', 'CON', 'DEX', 'WIS', 'INT', 'STR'],
        spellcaster: true, spellAbility: 'CHA', spellSlots: { 1: { '1st': 2 }, 2: { '1st': 3 }, 3: { '1st': 4, '2nd': 2 } },
    },
    {
        id: 'bard', name: '吟游诗人', nameEn: 'Bard', icon: 'ph-music-notes',
        hitDie: 8, primaryAbility: ['CHA'],
        saveProficiencies: ['DEX', 'CHA'],
        armorProf: '轻甲',
        skillChoices: { count: 3, from: ['any'] }, // Bards can pick any 3
        features: ['激励骰(D6)', '万金油(半熟练加值)', '诗人学识'],
        description: '万金油型角色，擅长社交和音乐魔法。',
        suggestedStats: ['CHA', 'DEX', 'CON', 'WIS', 'INT', 'STR'],
        spellcaster: true, spellAbility: 'CHA', spellSlots: { 1: { '1st': 2 }, 2: { '1st': 3 }, 3: { '1st': 4, '2nd': 2 } },
    },
    {
        id: 'barbarian', name: '蛮族', nameEn: 'Barbarian', icon: 'ph-axe',
        hitDie: 12, primaryAbility: ['STR'],
        saveProficiencies: ['STR', 'CON'],
        armorProf: '轻甲 + 中甲 + 盾牌',
        skillChoices: { count: 2, from: ['animal_handling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'] },
        features: ['狂暴(+2伤害,抗性)', '无甲防御(10+DEX+CON)', '莽撞攻击(Lv2)'],
        description: '狂暴的战士，伤害最高，生命值最高。',
        suggestedStats: ['STR', 'CON', 'DEX', 'WIS', 'CHA', 'INT'],
    },
    {
        id: 'paladin', name: '圣武士', nameEn: 'Paladin', icon: 'ph-shield-star',
        hitDie: 10, primaryAbility: ['STR', 'CHA'],
        saveProficiencies: ['WIS', 'CHA'],
        armorProf: '所有护甲 + 盾牌',
        skillChoices: { count: 2, from: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'] },
        features: ['圣疗术(治疗池)', '神圣打击(额外光辉伤害)', '神圣誓言(Lv3)'],
        description: '神圣战士，攻防兼备，可治疗可输出。',
        suggestedStats: ['STR', 'CHA', 'CON', 'WIS', 'DEX', 'INT'],
        spellcaster: true, spellAbility: 'CHA', spellSlots: { 2: { '1st': 2 }, 3: { '1st': 3 } },
    },
    {
        id: 'druid', name: '德鲁伊', nameEn: 'Druid', icon: 'ph-tree',
        hitDie: 8, primaryAbility: ['WIS'],
        saveProficiencies: ['INT', 'WIS'],
        armorProf: '轻甲 + 中甲 + 盾牌(非金属)',
        skillChoices: { count: 2, from: ['arcana', 'animal_handling', 'insight', 'medicine', 'nature', 'perception', 'religion', 'survival'] },
        features: ['荒野变形(Lv2)', '自然法术', '德鲁伊语'],
        description: '自然之力的守护者，可变形为野兽作战。',
        suggestedStats: ['WIS', 'CON', 'DEX', 'INT', 'CHA', 'STR'],
        spellcaster: true, spellAbility: 'WIS', spellSlots: { 1: { '1st': 2 }, 2: { '1st': 3 }, 3: { '1st': 4, '2nd': 2 } },
    },
    {
        id: 'warlock', name: '邪术师', nameEn: 'Warlock', icon: 'ph-eye',
        hitDie: 8, primaryAbility: ['CHA'],
        saveProficiencies: ['WIS', 'CHA'],
        armorProf: '轻甲',
        skillChoices: { count: 2, from: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'] },
        features: ['契约魔法(短休恢复法术位)', '魔能爆(远程戏法)', '契约恩赐(Lv3)'],
        description: '与异界实体签订契约的施法者，短休恢复法术位。',
        suggestedStats: ['CHA', 'CON', 'DEX', 'WIS', 'INT', 'STR'],
        spellcaster: true, spellAbility: 'CHA', spellSlots: { 1: { '1st': 1 }, 2: { '1st': 2 }, 3: { '2nd': 2 } },
    },
    {
        id: 'monk', name: '武僧', nameEn: 'Monk', icon: 'ph-hand-fist',
        hitDie: 8, primaryAbility: ['DEX', 'WIS'],
        saveProficiencies: ['STR', 'DEX'],
        armorProf: '无',
        skillChoices: { count: 2, from: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'] },
        features: ['气(Ki点)', '无甲防御(10+DEX+WIS)', '疾风连击', '偏转飞射物'],
        description: '以气为力的格斗家，速度和灵活无人能敌。',
        suggestedStats: ['DEX', 'WIS', 'CON', 'STR', 'CHA', 'INT'],
    },
];

// ═══════════════════════════════════════════════════════════════════════
// Skills (D&D 5e)
// ═══════════════════════════════════════════════════════════════════════

export const SKILLS = {
    athletics:      { name: '运动', nameEn: 'Athletics', ability: 'STR' },
    acrobatics:     { name: '体操', nameEn: 'Acrobatics', ability: 'DEX' },
    sleight_of_hand:{ name: '巧手', nameEn: 'Sleight of Hand', ability: 'DEX' },
    stealth:        { name: '潜行', nameEn: 'Stealth', ability: 'DEX' },
    arcana:         { name: '奥秘', nameEn: 'Arcana', ability: 'INT' },
    history:        { name: '历史', nameEn: 'History', ability: 'INT' },
    investigation:  { name: '调查', nameEn: 'Investigation', ability: 'INT' },
    nature:         { name: '自然', nameEn: 'Nature', ability: 'INT' },
    religion:       { name: '宗教', nameEn: 'Religion', ability: 'INT' },
    animal_handling:{ name: '驯兽', nameEn: 'Animal Handling', ability: 'WIS' },
    insight:        { name: '洞察', nameEn: 'Insight', ability: 'WIS' },
    medicine:       { name: '医学', nameEn: 'Medicine', ability: 'WIS' },
    perception:     { name: '察觉', nameEn: 'Perception', ability: 'WIS' },
    survival:       { name: '生存', nameEn: 'Survival', ability: 'WIS' },
    deception:      { name: '欺瞒', nameEn: 'Deception', ability: 'CHA' },
    intimidation:   { name: '威吓', nameEn: 'Intimidation', ability: 'CHA' },
    performance:    { name: '表演', nameEn: 'Performance', ability: 'CHA' },
    persuasion:     { name: '游说', nameEn: 'Persuasion', ability: 'CHA' },
};

// ═══════════════════════════════════════════════════════════════════════
// Ability Names
// ═══════════════════════════════════════════════════════════════════════

export const ABILITY_NAMES = {
    STR: { name: '力量', nameEn: 'Strength', icon: 'ph-barbell' },
    DEX: { name: '敏捷', nameEn: 'Dexterity', icon: 'ph-wind' },
    CON: { name: '体质', nameEn: 'Constitution', icon: 'ph-heart' },
    INT: { name: '智力', nameEn: 'Intelligence', icon: 'ph-book-open' },
    WIS: { name: '感知', nameEn: 'Wisdom', icon: 'ph-eye' },
    CHA: { name: '魅力', nameEn: 'Charisma', icon: 'ph-sparkle' },
};

export const ABILITY_ORDER = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

// ═══════════════════════════════════════════════════════════════════════
// Proficiency Bonus by level (D&D 5e)
// ═══════════════════════════════════════════════════════════════════════

export function getProficiencyBonus(level) {
    if (level <= 4) return 2;
    if (level <= 8) return 3;
    if (level <= 12) return 4;
    if (level <= 16) return 5;
    return 6;
}

// ═══════════════════════════════════════════════════════════════════════
// Character Creation & Computation
// ═══════════════════════════════════════════════════════════════════════

/**
 * Create a new character from player choices.
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.raceId
 * @param {string} params.classId
 * @param {object} params.baseStats — { STR: 15, DEX: 14, ... } before racial bonuses
 * @param {string[]} params.proficientSkills — skill IDs
 * @param {string[]} [params.halfElfBonuses] — for half-elf: 2 abilities to get +1
 * @returns {object} complete character object
 */
export function createCharacter({ name, raceId, classId, baseStats, proficientSkills, halfElfBonuses = [] }) {
    const race = RACES.find(r => r.id === raceId);
    const cls = CLASSES.find(c => c.id === classId);
    if (!race || !cls) throw new Error(`Invalid race "${raceId}" or class "${classId}"`);

    // Apply racial bonuses
    const stats = { ...baseStats };
    for (const [ability, bonus] of Object.entries(race.bonuses)) {
        stats[ability] = (stats[ability] || 10) + bonus;
    }
    // Half-elf bonus choices
    if (race.bonusChoices && halfElfBonuses.length > 0) {
        for (const ability of halfElfBonuses.slice(0, race.bonusChoices)) {
            if (ability !== 'CHA') { // CHA already included in base bonuses
                stats[ability] = (stats[ability] || 10) + 1;
            }
        }
    }

    const level = 1;
    const profBonus = getProficiencyBonus(level);
    const conMod = abilityModifier(stats.CON);
    const dexMod = abilityModifier(stats.DEX);

    // HP = hit die max at level 1 + CON modifier
    const maxHP = cls.hitDie + conMod;

    // AC calculation
    let ac;
    if (cls.id === 'barbarian') {
        // Barbarian unarmored defense: 10 + DEX + CON
        ac = 10 + dexMod + conMod;
    } else if (cls.id === 'monk') {
        // Monk unarmored defense: 10 + DEX + WIS
        ac = 10 + dexMod + abilityModifier(stats.WIS);
    } else if (['fighter', 'paladin'].includes(cls.id)) {
        // Chain mail (AC 16, no DEX)
        ac = 16;
    } else if (['cleric', 'druid', 'ranger'].includes(cls.id)) {
        // Scale mail (AC 14 + DEX max 2)
        ac = 14 + Math.min(dexMod, 2);
    } else {
        // Leather armor (AC 11 + DEX)
        ac = 11 + dexMod;
    }

    // Spell DC and spell slots (if caster)
    let spellDC = null;
    let spellSlots = null;
    if (cls.spellcaster) {
        const spellMod = abilityModifier(stats[cls.spellAbility]);
        spellDC = 8 + spellMod + profBonus;
        spellSlots = cls.spellSlots?.[level] ? { ...cls.spellSlots[level] } : {};
    }

    return {
        name,
        race: raceId,
        class: classId,
        level,
        xp: 0,
        gold: 15,  // starting gold
        stats,
        proficiencyBonus: profBonus,
        ac,
        maxHP: Math.max(maxHP, 1), // minimum 1 HP
        currentHP: Math.max(maxHP, 1),
        hitDice: { type: `D${cls.hitDie}`, total: 1, remaining: 1 },
        proficientSkills: proficientSkills || [],
        proficientSaves: cls.saveProficiencies || [],
        inventory: getStartingEquipment(cls.id),
        spellDC,
        spellSlots,
        maxSpellSlots: spellSlots ? { ...spellSlots } : null,
        spellAbility: cls.spellAbility || null,
        knownSpells: getStartingSpells(cls.id),
        deathSaves: { successes: 0, failures: 0 },
        abilityUses: {},  // tracks per-ability usage counts (reset on rest)
    };
}

/**
 * Get derived stats for display.
 */
export function getCharacterDerived(character) {
    if (!character) {
        return {
            className: '???', classNameEn: '???',
            raceName: '???', raceNameEn: '???',
            profBonus: 2, attackBonus: 0, primaryAbility: 'STR',
            modifiers: Object.fromEntries(ABILITY_ORDER.map(a => [a, 0])),
        };
    }
    const cls = CLASSES.find(c => c.id === character.class);
    const race = RACES.find(r => r.id === character.race);
    const profBonus = getProficiencyBonus(character.level);

    // Attack bonus (use primary ability)
    const primaryAbility = cls?.primaryAbility?.[0] || 'STR';
    const attackMod = abilityModifier(character.stats[primaryAbility]);
    const attackBonus = attackMod + profBonus;

    return {
        className: cls?.name || '???',
        classNameEn: cls?.nameEn || '???',
        raceName: race?.name || '???',
        raceNameEn: race?.nameEn || '???',
        profBonus,
        attackBonus,
        primaryAbility,
        modifiers: Object.fromEntries(
            ABILITY_ORDER.map(a => [a, abilityModifier(character.stats[a])])
        ),
    };
}

// ═══════════════════════════════════════════════════════════════════════
// Starting Equipment (simplified)
// ═══════════════════════════════════════════════════════════════════════

function getStartingEquipment(classId) {
    const kits = {
        fighter:    ['长剑', '盾牌', '锁子甲', '轻弩+20弩矢', '探索者背包', '治疗药水x1'],
        ranger:     ['长弓+20箭矢', '双短剑', '鳞甲', '探索者背包', '治疗药水x1'],
        rogue:      ['短剑', '短弓+20箭矢', '皮甲', '盗贼工具', '探索者背包', '治疗药水x1'],
        wizard:     ['法杖', '法术书', '成分包', '学者背包', '治疗药水x1'],
        cleric:     ['钉锤', '鳞甲', '盾牌', '圣物', '祭司背包', '治疗药水x1'],
        sorcerer:   ['轻弩+20弩矢', '成分包', '探索者背包', '匕首x2', '治疗药水x1'],
        bard:       ['细剑', '皮甲', '匕首', '乐器', '外交背包', '治疗药水x1'],
        barbarian:  ['巨斧', '标枪x4', '探索者背包', '治疗药水x1'],
        paladin:    ['长剑', '盾牌', '锁子甲', '圣物', '祭司背包', '标枪x5', '治疗药水x1'],
        druid:      ['木盾', '弯刀', '皮甲', '探索者背包', '德鲁伊法器', '治疗药水x1'],
        warlock:    ['轻弩+20弩矢', '成分包', '皮甲', '学者背包', '匕首x2', '治疗药水x1'],
        monk:       ['短剑', '飞镖x10', '探索者背包', '治疗药水x1'],
    };
    return kits[classId] || ['探索者背包', '治疗药水x1'];
}

// ═══════════════════════════════════════════════════════════════════════
// Starting Spells (simplified, just a few for flavor)
// ═══════════════════════════════════════════════════════════════════════

function getStartingSpells(classId) {
    const spells = {
        wizard:   ['魔法飞弹', '盾法术', '鉴定术'],
        cleric:   ['治疗创伤', '圣焰', '祝福术'],
        sorcerer: ['魔法飞弹', '火焰箭', '法师护甲'],
        bard:     ['治疗创伤', '嘲讽', '魅惑人类'],
        ranger:   ['猎人印记', '治疗创伤'],
        paladin:  ['圣疗术', '神圣打击', '命令术'],
        druid:    ['治疗创伤', '纠缠术', '月火术'],
        warlock:  ['魔能爆', '妖火', '地狱咒斥'],
    };
    return spells[classId] || [];
}

// ═══════════════════════════════════════════════════════════════════════
// Spell List (Simplified D&D 5e)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Simplified spell data.
 * type: 'damage' | 'heal' | 'buff'
 * dice: damage/heal expression    target: 'enemy' | 'ally' | 'self' | 'all_enemies'
 * level: 0 = cantrip (no slot), 1 = 1st-level slot, 2 = 2nd-level slot
 */
export const SPELL_LIST = {
    // ── Wizard ──
    magic_missile:   { id: 'magic_missile',   name: '魔法飞弹', nameEn: 'Magic Missile', level: 1, type: 'damage', dice: '3D4+3', target: 'enemy', icon: 'ph-shooting-star', description: '三枚力场飞弹自动命中，无需检定', autoHit: true },
    shield_spell:    { id: 'shield_spell',     name: '盾法术', nameEn: 'Shield', level: 1, type: 'buff', dice: '', target: 'self', icon: 'ph-shield-plus', description: 'AC+5持续到下回合', buffEffect: { stat: 'ac', bonus: 5, duration: 1 } },
    burning_hands:   { id: 'burning_hands',    name: '燃烧之手', nameEn: 'Burning Hands', level: 1, type: 'damage', dice: '3D6', target: 'all_enemies', icon: 'ph-fire', description: '锥形火焰灼烧前方所有敌人', saveDC: true, saveAbility: 'DEX' },
    scorching_ray:   { id: 'scorching_ray',    name: '灼热射线', nameEn: 'Scorching Ray', level: 2, type: 'damage', dice: '2D6', target: 'enemy', icon: 'ph-fire', description: '射出三道火焰射线', multiHit: 3 },
    identify:        { id: 'identify',          name: '鉴定术', nameEn: 'Identify', level: 1, type: 'buff', dice: '', target: 'self', icon: 'ph-magnifying-glass', description: '鉴定魔法物品（非战斗用）' },

    // ── Cleric ──
    cure_wounds:     { id: 'cure_wounds',       name: '治疗创伤', nameEn: 'Cure Wounds', level: 1, type: 'heal', dice: '1D8', target: 'ally', icon: 'ph-heart', description: '触碰治疗，恢复1D8+感知修正HP', useCasterMod: 'WIS' },
    sacred_flame:    { id: 'sacred_flame',      name: '圣焰', nameEn: 'Sacred Flame', level: 0, type: 'damage', dice: '1D8', target: 'enemy', icon: 'ph-sun', description: '神圣火焰从天而降（戏法，无需法术位）', saveDC: true, saveAbility: 'DEX' },
    bless:           { id: 'bless',             name: '祝福术', nameEn: 'Bless', level: 1, type: 'buff', dice: '', target: 'ally', icon: 'ph-sparkle', description: '攻击和豁免+1D4，持续整场战斗', buffEffect: { stat: 'attack', bonus: 2, duration: 99 } },
    spiritual_weapon:{ id: 'spiritual_weapon',  name: '灵体武器', nameEn: 'Spiritual Weapon', level: 2, type: 'damage', dice: '1D8', target: 'enemy', icon: 'ph-sword', description: '召唤灵体武器攻击敌人', useCasterMod: 'WIS' },
    healing_word:    { id: 'healing_word',      name: '治疗之语', nameEn: 'Healing Word', level: 1, type: 'heal', dice: '1D4', target: 'ally', icon: 'ph-heart', description: '远程治疗，恢复1D4+感知修正HP', useCasterMod: 'WIS' },

    // ── Sorcerer ──
    fire_bolt:       { id: 'fire_bolt',         name: '火焰箭', nameEn: 'Fire Bolt', level: 0, type: 'damage', dice: '1D10', target: 'enemy', icon: 'ph-fire', description: '远程火焰攻击（戏法，无需法术位）' },
    mage_armor:      { id: 'mage_armor',        name: '法师护甲', nameEn: 'Mage Armor', level: 1, type: 'buff', dice: '', target: 'self', icon: 'ph-shield', description: 'AC变为13+DEX修正', buffEffect: { stat: 'ac', bonus: 3, duration: 99 } },
    thunderwave:     { id: 'thunderwave',       name: '雷鸣波', nameEn: 'Thunderwave', level: 1, type: 'damage', dice: '2D8', target: 'all_enemies', icon: 'ph-lightning', description: '雷鸣冲击波击退并伤害附近敌人', saveDC: true, saveAbility: 'CON' },

    // ── Bard ──
    vicious_mockery: { id: 'vicious_mockery',   name: '嘲讽', nameEn: 'Vicious Mockery', level: 0, type: 'damage', dice: '1D4', target: 'enemy', icon: 'ph-megaphone', description: '用恶毒言语伤害敌人（戏法）', saveDC: true, saveAbility: 'WIS' },
    charm_person:    { id: 'charm_person',      name: '魅惑人类', nameEn: 'Charm Person', level: 1, type: 'buff', dice: '', target: 'enemy', icon: 'ph-heart', description: '魅惑一个人形生物（非战斗用）' },
    dissonant_whispers:{ id: 'dissonant_whispers', name: '不谐低语', nameEn: 'Dissonant Whispers', level: 1, type: 'damage', dice: '3D6', target: 'enemy', icon: 'ph-speaker-high', description: '低语使敌人痛苦并恐惧逃跑', saveDC: true, saveAbility: 'WIS' },

    // ── Ranger ──
    hunters_mark:    { id: 'hunters_mark',      name: '猎人印记', nameEn: "Hunter's Mark", level: 1, type: 'buff', dice: '', target: 'self', icon: 'ph-crosshair', description: '标记目标，对其攻击额外+1D6', buffEffect: { stat: 'damage', bonus: 3, duration: 99 } },
    ensnaring_strike: { id: 'ensnaring_strike',  name: '纠缠打击', nameEn: 'Ensnaring Strike', level: 1, type: 'damage', dice: '1D6', target: 'enemy', icon: 'ph-tree', description: '藤蔓缠绕束缚敌人' },

    // ── Paladin ──
    divine_smite:    { id: 'divine_smite',      name: '神圣打击', nameEn: 'Divine Smite', level: 1, type: 'damage', dice: '2D8', target: 'enemy', icon: 'ph-sun', description: '武器附加神圣光辉伤害' },
    lay_on_hands:    { id: 'lay_on_hands',      name: '圣疗术', nameEn: 'Lay on Hands', level: 0, type: 'heal', dice: '0', target: 'ally', icon: 'ph-hand-heart', description: '治疗池：等级×5的治疗量', specialHeal: true },
    command:         { id: 'command',           name: '命令术', nameEn: 'Command', level: 1, type: 'buff', dice: '', target: 'enemy', icon: 'ph-megaphone', description: '命令敌人执行一个单词的指令（跪下/逃跑）', saveDC: true, saveAbility: 'WIS' },

    // ── Druid ──
    entangle:        { id: 'entangle',          name: '纠缠术', nameEn: 'Entangle', level: 1, type: 'damage', dice: '0', target: 'all_enemies', icon: 'ph-tree', description: '藤蔓缠绕束缚区域内敌人', saveDC: true, saveAbility: 'STR' },
    moonbeam:        { id: 'moonbeam',          name: '月火术', nameEn: 'Moonbeam', level: 2, type: 'damage', dice: '2D10', target: 'enemy', icon: 'ph-moon', description: '月光柱灼烧目标' },
    healing_word_d:  { id: 'healing_word_d',    name: '治疗之语', nameEn: 'Healing Word', level: 1, type: 'heal', dice: '1D4', target: 'ally', icon: 'ph-heart', description: '远程治疗', useCasterMod: 'WIS' },

    // ── Warlock ──
    eldritch_blast:  { id: 'eldritch_blast',    name: '魔能爆', nameEn: 'Eldritch Blast', level: 0, type: 'damage', dice: '1D10', target: 'enemy', icon: 'ph-lightning', description: '力场光束攻击（戏法）' },
    hex:             { id: 'hex',               name: '妖火', nameEn: 'Hex', level: 1, type: 'buff', dice: '', target: 'self', icon: 'ph-eye', description: '诅咒目标，攻击额外+1D6', buffEffect: { stat: 'damage', bonus: 3, duration: 99 } },
    hellish_rebuke:  { id: 'hellish_rebuke',    name: '地狱咒斥', nameEn: 'Hellish Rebuke', level: 1, type: 'damage', dice: '2D10', target: 'enemy', icon: 'ph-fire', description: '被攻击时以地狱之火反击' },
};

/**
 * Map classId → array of spell IDs that class can learn/know.
 */
export const CLASS_SPELL_IDS = {
    wizard:   ['magic_missile', 'shield_spell', 'burning_hands', 'scorching_ray', 'identify'],
    cleric:   ['cure_wounds', 'sacred_flame', 'bless', 'spiritual_weapon', 'healing_word'],
    sorcerer: ['fire_bolt', 'magic_missile', 'mage_armor', 'thunderwave', 'scorching_ray'],
    bard:     ['cure_wounds', 'vicious_mockery', 'charm_person', 'dissonant_whispers', 'healing_word'],
    ranger:   ['cure_wounds', 'hunters_mark', 'ensnaring_strike'],
    paladin:  ['divine_smite', 'lay_on_hands', 'command', 'cure_wounds'],
    druid:    ['cure_wounds', 'entangle', 'moonbeam', 'healing_word_d'],
    warlock:  ['eldritch_blast', 'hex', 'hellish_rebuke'],
};

/**
 * "Prepared caster" classes — must choose which spells to prepare before adventure.
 * Others are "known casters" — all their spells are always available.
 */
export const PREPARED_CASTER_IDS = ['wizard', 'cleric', 'druid', 'paladin'];

// ═══════════════════════════════════════════════════════════════════════
// Class Abilities — Active / Passive abilities per class
// ═══════════════════════════════════════════════════════════════════════

/**
 * CLASS_ABILITIES — Per-class mechanical abilities.
 *
 * type:
 *   'toggle'   — persistent state (e.g. Rage), lasts whole combat
 *   'instant'  — one-shot effect (e.g. Second Wind heal)
 *   'passive'  — auto-triggered, no button (e.g. Sneak Attack)
 *   'on_hit'   — triggered after a successful hit (e.g. Divine Smite)
 *
 * resource:
 *   'longRest'  — resets on long rest
 *   'shortRest' — resets on short rest
 *   'perTurn'   — resets every turn
 *   'ki'        — ki points (resets on short rest)
 *   'spellSlot' — consumes a spell slot
 */
export const CLASS_ABILITIES = {
    barbarian_rage: {
        id: 'barbarian_rage', classId: 'barbarian',
        name: '狂暴', nameEn: 'Rage', icon: 'ph-fire',
        type: 'toggle',
        resource: 'longRest',
        maxUses: 2,
        minLevel: 1,
        effect: {
            meleeDamageBonus: 2,
            resistPhysical: true,
            duration: 'combat',
        },
        description: '近战伤害+2，物理伤害抗性，持续整场战斗',
    },
    fighter_second_wind: {
        id: 'fighter_second_wind', classId: 'fighter',
        name: '回复力', nameEn: 'Second Wind', icon: 'ph-heart-half',
        type: 'instant',
        resource: 'shortRest',
        maxUses: 1,
        minLevel: 1,
        effect: { heal: '1D10', healBonusLevel: true },
        description: '恢复 1D10+等级 HP',
    },
    fighter_action_surge: {
        id: 'fighter_action_surge', classId: 'fighter',
        name: '动作如潮', nameEn: 'Action Surge', icon: 'ph-lightning',
        type: 'instant',
        resource: 'shortRest',
        maxUses: 1,
        minLevel: 2,
        effect: { extraAttack: true },
        description: '本回合获得额外一次攻击',
    },
    rogue_sneak_attack: {
        id: 'rogue_sneak_attack', classId: 'rogue',
        name: '偷袭', nameEn: 'Sneak Attack', icon: 'ph-knife',
        type: 'passive',
        resource: 'perTurn',
        maxUses: 1,
        minLevel: 1,
        effect: { bonusDice: '1D6', scalePerLevel: true },
        description: '每回合首次命中额外 1D6 伤害 (每2级+1D6)',
    },
    monk_flurry: {
        id: 'monk_flurry', classId: 'monk',
        name: '疾风连击', nameEn: 'Flurry of Blows', icon: 'ph-hand-fist',
        type: 'instant',
        resource: 'ki',
        maxUses: 2,
        minLevel: 1,
        effect: { extraUnarmed: '1D4' },
        description: '消耗1气点，额外一次 1D4 徒手攻击',
    },
    paladin_smite: {
        id: 'paladin_smite', classId: 'paladin',
        name: '神圣打击', nameEn: 'Divine Smite', icon: 'ph-sun',
        type: 'on_hit',
        resource: 'spellSlot',
        maxUses: 99,
        minLevel: 2,
        effect: { bonusDice: '2D8', damageType: 'radiant' },
        description: '消耗法术位，近战额外 2D8 光辉伤害',
    },
};

/**
 * Get all abilities available to a character (by class + level).
 * Excludes abilities whose minLevel exceeds the character's level.
 * @param {object} character
 * @returns {object[]} array of ability definitions from CLASS_ABILITIES
 */
export function getAvailableAbilities(character) {
    if (!character) return [];
    return Object.values(CLASS_ABILITIES).filter(
        a => a.classId === character.class && character.level >= a.minLevel
    );
}

/**
 * Get remaining uses of a specific ability.
 * @param {object} character
 * @param {string} abilityId
 * @returns {number}
 */
export function getAbilityUsesRemaining(character, abilityId) {
    const ability = CLASS_ABILITIES[abilityId];
    if (!ability) return 0;
    // Spell slot abilities are limited by slot availability, not a counter
    if (ability.resource === 'spellSlot') {
        if (!character.spellSlots) return 0;
        return Object.values(character.spellSlots).reduce((sum, v) => sum + v, 0);
    }
    const uses = character.abilityUses || {};
    const used = uses[abilityId] || 0;
    return Math.max(0, ability.maxUses - used);
}

/**
 * Consume one use of an ability. Returns true if successful.
 * @param {object} character — mutable
 * @param {string} abilityId
 * @returns {boolean}
 */
export function consumeAbilityUse(character, abilityId) {
    const ability = CLASS_ABILITIES[abilityId];
    if (!ability) return false;

    // Spell slot resource → consume the lowest available slot
    if (ability.resource === 'spellSlot') {
        const slotKeys = ['1st', '2nd', '3rd'];
        for (const key of slotKeys) {
            if (character.spellSlots?.[key] > 0) {
                character.spellSlots[key]--;
                return true;
            }
        }
        return false; // no slots left
    }

    if (!character.abilityUses) character.abilityUses = {};
    const used = character.abilityUses[abilityId] || 0;
    if (used >= ability.maxUses) return false;
    character.abilityUses[abilityId] = used + 1;
    return true;
}

/**
 * Reset ability uses for a given rest type.
 * @param {object} character — mutable
 * @param {'shortRest'|'longRest'} restType
 */
export function resetAbilityUses(character, restType) {
    if (!character.abilityUses) character.abilityUses = {};
    for (const ability of Object.values(CLASS_ABILITIES)) {
        if (ability.classId !== character.class) continue;
        if (restType === 'longRest') {
            // Long rest resets everything
            character.abilityUses[ability.id] = 0;
        } else if (restType === 'shortRest') {
            // Short rest resets shortRest + ki abilities
            if (ability.resource === 'shortRest' || ability.resource === 'ki') {
                character.abilityUses[ability.id] = 0;
            }
        }
    }
}

/**
 * Get the Sneak Attack dice expression for a Rogue at a given level.
 * D&D 5e: 1D6 at level 1, +1D6 every 2 levels (1→1D6, 3→2D6, 5→3D6, etc.)
 * @param {number} level
 * @returns {string} dice expression like "2D6"
 */
export function getSneakAttackDice(level) {
    const diceCount = Math.ceil(level / 2);
    return `${diceCount}D6`;
}

// ═══════════════════════════════════════════════════════════════════════
// Level Up
// ═══════════════════════════════════════════════════════════════════════

/** D&D 5e XP thresholds by level (level → XP needed for NEXT level). */
const XP_TABLE = {
    1: 300,
    2: 900,
    3: 2700,
    4: 6500,
    5: 14000,
    6: 23000,
    7: 34000,
    8: 48000,
    9: 64000,
    10: 85000,
};

/** Get XP required to reach the next level. */
export function getXpForNextLevel(level) {
    return XP_TABLE[level] || 99999;
}

/** Check if a character has enough XP to level up. */
export function canLevelUp(character) {
    if (!character) return false;
    const needed = getXpForNextLevel(character.level);
    return (character.xp || 0) >= needed;
}

/**
 * Level up a character.
 * @param {object} character — mutable character object
 * @returns {{ hpGain: number, newMaxHP: number, newLevel: number, newProfBonus: number, slotChanges: object|null }}
 */
export function levelUp(character) {
    const cls = CLASSES.find(c => c.id === character.class);
    if (!cls) return null;

    const oldLevel = character.level;
    const newLevel = oldLevel + 1;
    character.level = newLevel;

    // ── HP growth: roll hit die + CON mod (min 1) ──
    const conMod = abilityModifier(character.stats.CON);
    const hpRoll = roll(cls.hitDie);
    const hpGain = Math.max(1, hpRoll + conMod);
    character.maxHP += hpGain;
    character.currentHP += hpGain; // heal on level up

    // ── Hit dice total ──
    if (character.hitDice) {
        character.hitDice.total = newLevel;
        character.hitDice.remaining = newLevel; // full restore on level up
    }

    // ── Proficiency bonus ──
    character.proficiencyBonus = getProficiencyBonus(newLevel);

    // ── AC recalculation ──
    const dexMod = abilityModifier(character.stats.DEX);
    if (cls.id === 'barbarian') {
        character.ac = 10 + dexMod + conMod;
    } else if (cls.id === 'monk') {
        character.ac = 10 + dexMod + abilityModifier(character.stats.WIS);
    }
    // Armored classes keep their AC (equipment-based)

    // ── Spell slots ──
    let slotChanges = null;
    if (cls.spellcaster && cls.spellSlots?.[newLevel]) {
        const newSlots = { ...cls.spellSlots[newLevel] };
        character.spellSlots = { ...newSlots };
        character.maxSpellSlots = { ...newSlots };
        slotChanges = newSlots;
    }

    // ── Spell DC recalculation ──
    if (cls.spellcaster && cls.spellAbility) {
        const spellMod = abilityModifier(character.stats[cls.spellAbility]);
        character.spellDC = 8 + spellMod + character.proficiencyBonus;
    }

    // ── Reset death saves ──
    character.deathSaves = { successes: 0, failures: 0 };

    return {
        hpGain,
        hpRoll,
        newMaxHP: character.maxHP,
        newLevel,
        newProfBonus: character.proficiencyBonus,
        slotChanges,
    };
}

// ═══════════════════════════════════════════════════════════════════════
// Spell Preparation & Availability
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get the number of spells a prepared caster can prepare.
 * D&D 5e: ability modifier + level (minimum 1).
 */
export function getPreparedSpellCount(character) {
    const cls = CLASSES.find(c => c.id === character.class);
    if (!cls?.spellcaster) return 0;
    if (!PREPARED_CASTER_IDS.includes(cls.id)) return 0; // known casters don't prepare
    const mod = abilityModifier(character.stats[cls.spellAbility] || 10);
    return Math.max(1, mod + character.level);
}

/**
 * Is this class a "prepared caster"?
 */
export function isPreparedCaster(classId) {
    return PREPARED_CASTER_IDS.includes(classId);
}

/**
 * Get all spells available to a character (by class).
 * For known casters: returns knownSpells mapped to SPELL_LIST entries.
 * For prepared casters: returns ALL class spells (player picks which to prepare).
 * @returns {object[]} array of spell data objects from SPELL_LIST
 */
export function getClassSpells(character) {
    const cls = CLASSES.find(c => c.id === character.class);
    if (!cls?.spellcaster) return [];
    const spellIds = CLASS_SPELL_IDS[cls.id] || [];
    return spellIds.map(id => SPELL_LIST[id]).filter(Boolean);
}

/**
 * Get spells currently usable in combat.
 * - Known casters: all known spells
 * - Prepared casters: only prepared spells (from character.preparedSpells)
 * Cantrips (level 0) are always available.
 * @returns {object[]} array of { spell, canCast, slotLevel }
 */
export function getCombatSpells(character) {
    const cls = CLASSES.find(c => c.id === character.class);
    if (!cls?.spellcaster) return [];

    const allClassSpells = getClassSpells(character);
    const prepared = character.preparedSpells || [];
    const isPrepared = PREPARED_CASTER_IDS.includes(cls.id);

    return allClassSpells
        .filter(spell => {
            // Cantrips always available
            if (spell.level === 0) return true;
            // Known casters: all class spells available
            if (!isPrepared) return true;
            // Prepared casters: only prepared spells
            return prepared.includes(spell.id);
        })
        .map(spell => {
            const slotKey = spell.level === 0 ? null : _slotKeyForLevel(spell.level);
            const hasSlot = spell.level === 0 || (character.spellSlots?.[slotKey] > 0);
            return { spell, canCast: hasSlot, slotKey };
        });
}

/** Map spell level number to slot key string. */
function _slotKeyForLevel(level) {
    const keys = { 1: '1st', 2: '2nd', 3: '3rd' };
    return keys[level] || `${level}th`;
}

/** Consume a spell slot. Returns true if successful. */
export function consumeSpellSlot(character, spellLevel) {
    if (spellLevel === 0) return true; // cantrips are free
    const key = _slotKeyForLevel(spellLevel);
    if (!character.spellSlots || !character.spellSlots[key] || character.spellSlots[key] <= 0) {
        return false;
    }
    character.spellSlots[key]--;
    return true;
}

// ═══════════════════════════════════════════════════════════════════════
// Shop Categories & Items
// ═══════════════════════════════════════════════════════════════════════

export const SHOP_CATEGORIES = [
    { id: 'all',     name: '全部',  icon: 'ph-squares-four' },
    { id: 'potion',  name: '药水',  icon: 'ph-flask' },
    { id: 'weapon',  name: '武器',  icon: 'ph-sword' },
    { id: 'armor',   name: '防具',  icon: 'ph-shield' },
    { id: 'scroll',  name: '卷轴',  icon: 'ph-scroll' },
    { id: 'supply',  name: '补给',  icon: 'ph-package' },
    { id: 'trinket', name: '饰品',  icon: 'ph-diamond' },
];

export const SHOP_ITEMS = [
    // ── 药水 (potion) ──
    { id: 'healing_potion',      name: '治疗药水',       nameEn: 'Healing Potion',           price: 50,   icon: 'ph-flask',          category: 'potion', description: '恢复 2D4+2 HP' },
    { id: 'greater_healing',     name: '高等治疗药水',   nameEn: 'Greater Healing Potion',   price: 150,  icon: 'ph-flask',          category: 'potion', description: '恢复 4D4+4 HP' },
    { id: 'antidote',            name: '解毒药剂',       nameEn: 'Antidote',                 price: 30,   icon: 'ph-drop',           category: 'potion', description: '解除中毒状态' },
    { id: 'strength_potion',     name: '力量药水',       nameEn: 'Potion of Strength',       price: 75,   icon: 'ph-flask',          category: 'potion', description: '下次战斗近战伤害+2' },
    { id: 'invisibility_potion', name: '隐身药水',       nameEn: 'Potion of Invisibility',   price: 100,  icon: 'ph-flask',          category: 'potion', description: '下次战斗首回合获得隐身' },
    { id: 'fire_resist_potion',  name: '抗火药剂',       nameEn: 'Potion of Fire Resistance',price: 50,   icon: 'ph-drop',           category: 'potion', description: '火焰伤害减半' },
    { id: 'giant_str_potion',    name: '巨人力量药水',   nameEn: 'Potion of Giant Strength', price: 300,  icon: 'ph-flask',          category: 'potion', description: '力量临时变为21' },

    // ── 武器 (weapon) ──
    { id: 'silver_dagger',       name: '银匕首',         nameEn: 'Silver Dagger',            price: 25,   icon: 'ph-knife',          category: 'weapon', description: '对狼人/变形生物有效' },
    { id: 'fine_longsword',      name: '精制长剑',       nameEn: 'Fine Longsword',           price: 200,  icon: 'ph-sword',          category: 'weapon', description: '精工铸造，攻击+1' },
    { id: 'fine_longbow',        name: '精制长弓',       nameEn: 'Fine Longbow',             price: 200,  icon: 'ph-arrow-up-right', category: 'weapon', description: '精工制作，远程攻击+1' },
    { id: 'throwing_axe',        name: '回旋飞斧',       nameEn: 'Throwing Axe',             price: 50,   icon: 'ph-axe',            category: 'weapon', description: '投掷武器，可远程攻击' },
    { id: 'poison_dagger',       name: '淬毒匕首',       nameEn: 'Poisoned Dagger',          price: 80,   icon: 'ph-knife',          category: 'weapon', description: '额外 1D4 毒素伤害' },

    // ── 防具 (armor) ──
    { id: 'wooden_shield',       name: '木盾',           nameEn: 'Wooden Shield',            price: 10,   icon: 'ph-shield',         category: 'armor',  description: 'AC+2' },
    { id: 'fine_scale_mail',     name: '精制鳞甲',       nameEn: 'Fine Scale Mail',          price: 400,  icon: 'ph-shield',         category: 'armor',  description: '精工铸造的鳞甲，AC+1' },
    { id: 'cloak_of_resistance', name: '抗性披风',       nameEn: 'Cloak of Resistance',      price: 150,  icon: 'ph-coat-hanger',    category: 'armor',  description: '豁免检定+1' },
    { id: 'ring_of_vitality',    name: '生命之戒',       nameEn: 'Ring of Vitality',         price: 250,  icon: 'ph-ring',           category: 'armor',  description: '最大 HP+5' },

    // ── 卷轴 (scroll) ──
    { id: 'scroll_cure',         name: '卷轴：治疗创伤', nameEn: 'Scroll: Cure Wounds',      price: 50,   icon: 'ph-scroll',         category: 'scroll', description: '恢复 1D8+3 HP' },
    { id: 'scroll_fireball',     name: '卷轴：火球术',   nameEn: 'Scroll: Fireball',         price: 150,  icon: 'ph-scroll',         category: 'scroll', description: '全体敌人 8D6 火焰伤害' },
    { id: 'scroll_lightning',    name: '卷轴：闪电箭',   nameEn: 'Scroll: Lightning Bolt',   price: 120,  icon: 'ph-scroll',         category: 'scroll', description: '直线 8D6 闪电伤害' },
    { id: 'scroll_bless',        name: '卷轴：祝福术',   nameEn: 'Scroll: Bless',            price: 60,   icon: 'ph-scroll',         category: 'scroll', description: '攻击和豁免+1D4' },
    { id: 'scroll_teleport',     name: '卷轴：传送术',   nameEn: 'Scroll: Teleport',         price: 300,  icon: 'ph-scroll',         category: 'scroll', description: '直接传送到下一房间' },

    // ── 补给 (supply) ──
    { id: 'arrows_20',           name: '箭矢×20',       nameEn: 'Arrows (20)',              price: 10,   icon: 'ph-arrow-up-right', category: 'supply', description: '20支箭矢' },
    { id: 'bolts_20',            name: '弩矢×20',       nameEn: 'Bolts (20)',               price: 10,   icon: 'ph-arrow-up-right', category: 'supply', description: '20支弩矢' },
    { id: 'torch_5',             name: '火把×5',        nameEn: 'Torches (5)',              price: 5,    icon: 'ph-flame',          category: 'supply', description: '照明用火把' },
    { id: 'rope_50',             name: '绳索(50尺)',    nameEn: 'Rope (50 ft)',             price: 10,   icon: 'ph-lasso',          category: 'supply', description: '攀爬、捆绑用' },
    { id: 'trap_kit',            name: '陷阱工具包',     nameEn: 'Trap Kit',                 price: 25,   icon: 'ph-wrench',         category: 'supply', description: '拆除和设置陷阱' },
    { id: 'iron_spikes',         name: '铁钉×10',       nameEn: 'Iron Spikes (10)',         price: 5,    icon: 'ph-push-pin',       category: 'supply', description: '固定绳索或卡住门' },

    // ── 饰品 (trinket) ──
    { id: 'holy_water',          name: '圣水',           nameEn: 'Holy Water',               price: 25,   icon: 'ph-drop',           category: 'trinket', description: '对不死/邪魔 2D6 光辉伤害' },
    { id: 'lucky_coin',          name: '幸运币',         nameEn: 'Lucky Coin',               price: 15,   icon: 'ph-coin',           category: 'trinket', description: '下次检定可重掷一次' },
    { id: 'warding_charm',       name: '驱邪圣符',       nameEn: 'Warding Charm',            price: 50,   icon: 'ph-shield-star',    category: 'trinket', description: '下次战斗 AC+1' },
    { id: 'adventurer_kit',      name: '冒险者补给包',   nameEn: 'Adventurer Kit',           price: 15,   icon: 'ph-backpack',       category: 'trinket', description: '补充背包中的基本物资' },
];

/**
 * Get the inventory item name for a shop item purchase.
 */
export function getShopItemName(shopItemId) {
    const item = SHOP_ITEMS.find(i => i.id === shopItemId);
    if (!item) return null;
    // Map shopItem IDs to inventory string names
    const nameMap = {
        healing_potion:       '治疗药水x1',
        greater_healing:      '高等治疗药水x1',
        antidote:             '解毒药剂',
        strength_potion:      '力量药水',
        invisibility_potion:  '隐身药水',
        fire_resist_potion:   '抗火药剂',
        giant_str_potion:     '巨人力量药水',
        silver_dagger:        '银匕首',
        fine_longsword:       '精制长剑',
        fine_longbow:         '精制长弓',
        throwing_axe:         '回旋飞斧',
        poison_dagger:        '淬毒匕首',
        wooden_shield:        '木盾',
        fine_scale_mail:      '精制鳞甲',
        cloak_of_resistance:  '抗性披风',
        ring_of_vitality:     '生命之戒',
        scroll_cure:          '卷轴：治疗创伤',
        scroll_fireball:      '卷轴：火球术',
        scroll_lightning:     '卷轴：闪电箭',
        scroll_bless:         '卷轴：祝福术',
        scroll_teleport:      '卷轴：传送术',
        arrows_20:            '箭矢x20',
        bolts_20:             '弩矢x20',
        torch_5:              '火把x5',
        rope_50:              '绳索(50尺)',
        trap_kit:             '陷阱工具包',
        iron_spikes:          '铁钉x10',
        holy_water:           '圣水',
        lucky_coin:           '幸运币',
        warding_charm:        '驱邪圣符',
        adventurer_kit:       '冒险者补给包',
    };
    return nameMap[shopItemId] || item.name;
}

// ═══════════════════════════════════════════════════════════════════════
// Item Registry — Pattern-based item classification & effects
// ═══════════════════════════════════════════════════════════════════════

/**
 * Each rule: { pattern, type, usable, consumed, icon, label, effect }
 * First matching rule wins. Order matters (specific before generic).
 *
 * type:     healing | currency | equipment | scroll | consumable | ammo | utility | quest
 * effect:   type-specific data
 *   healing  → { dice, bonus }
 *   currency → { gold }   (parsed from name when possible)
 *   equipment→ { stat, bonus }  (stat: 'ac' | 'attack')
 *   scroll   → { spellId, dice, description }
 *   consumable→{ description }
 */
const ITEM_REGISTRY = [
    // ── Healing ──
    { pattern: /巨人力量药水/,     type: 'healing', usable: true, consumed: true, icon: 'ph-flask',          category: 'potion', label: '使用', effect: { dice: '0', bonus: 0, description: '力量临时变为21' } },
    { pattern: /高等治疗药水/,     type: 'healing', usable: true, consumed: true, icon: 'ph-flask',          category: 'potion', label: '使用', effect: { dice: '4D4', bonus: 4 } },
    { pattern: /治疗药水/,         type: 'healing', usable: true, consumed: true, icon: 'ph-flask',          category: 'potion', label: '使用', effect: { dice: '2D4', bonus: 2 } },
    { pattern: /力量药水/,         type: 'consumable', usable: true, consumed: true, icon: 'ph-flask',       category: 'potion', label: '使用', effect: { stat: 'damage', bonus: 2, duration: 'combat', description: '下次战斗近战伤害+2' } },
    { pattern: /隐身药水/,         type: 'consumable', usable: true, consumed: true, icon: 'ph-flask',       category: 'potion', label: '使用', effect: { description: '下次战斗首回合获得隐身效果' } },
    { pattern: /抗火药剂/,         type: 'consumable', usable: true, consumed: true, icon: 'ph-drop',        category: 'potion', label: '使用', effect: { description: '火焰伤害减半' } },
    { pattern: /解毒药剂/,         type: 'consumable', usable: true, consumed: true, icon: 'ph-drop',        category: 'potion', label: '使用', effect: { description: '解除中毒状态' } },

    // ── Currency / Valuables ──
    { pattern: /(\d+)\s*gp/,       type: 'currency', usable: true, consumed: true, icon: 'ph-coins',         category: 'trinket', label: '兑换', effect: { gold: 0 } },  // gold parsed dynamically
    { pattern: /金币[x×]?(\d+)/,   type: 'currency', usable: true, consumed: true, icon: 'ph-coins',         category: 'trinket', label: '兑换', effect: { gold: 0 } },
    { pattern: /灵魂币[x×]?(\d+)/, type: 'currency', usable: true, consumed: true, icon: 'ph-coin',          category: 'trinket', label: '兑换', effect: { gold: 0 } },
    { pattern: /宝石/,             type: 'currency', usable: true, consumed: true, icon: 'ph-diamond',        category: 'trinket', label: '兑换', effect: { gold: 25 } },

    // ── Equipment — shop weapons (kept after use) ──
    { pattern: /精制长剑/,         type: 'equipment', usable: true, consumed: false, icon: 'ph-sword',        category: 'weapon', label: '装备', effect: { stat: 'attack', bonus: 1, desc: '攻击+1' } },
    { pattern: /精制长弓/,         type: 'equipment', usable: true, consumed: false, icon: 'ph-arrow-up-right', category: 'weapon', label: '装备', effect: { stat: 'attack', bonus: 1, desc: '远程攻击+1' } },
    { pattern: /淬毒匕首/,         type: 'equipment', usable: true, consumed: false, icon: 'ph-knife',        category: 'weapon', label: '装备', effect: { stat: 'attack', bonus: 0, desc: '额外1D4毒素伤害' } },
    { pattern: /回旋飞斧/,         type: 'equipment', usable: true, consumed: false, icon: 'ph-axe',          category: 'weapon', label: '装备', effect: { stat: 'attack', bonus: 0, desc: '可投掷的近战武器' } },
    { pattern: /银匕首/,           type: 'equipment', usable: true, consumed: false, icon: 'ph-knife',        category: 'weapon', label: '装备', effect: { stat: 'attack', bonus: 0, desc: '对狼人/变形生物有效' } },

    // ── Equipment — loot weapons ──
    { pattern: /\+1\s*长剑/,       type: 'equipment', usable: true, consumed: false, icon: 'ph-sword',        category: 'weapon', label: '装备', effect: { stat: 'attack', bonus: 1, desc: '攻击+1' } },
    { pattern: /太阳之剑/,         type: 'equipment', usable: true, consumed: false, icon: 'ph-sun',          category: 'weapon', label: '装备', effect: { stat: 'attack', bonus: 2, desc: '攻击+2，对不死生物额外光辉伤害' } },
    { pattern: /地狱钢铁武器/,     type: 'equipment', usable: true, consumed: false, icon: 'ph-sword',        category: 'weapon', label: '装备', effect: { stat: 'attack', bonus: 1, desc: '攻击+1，对天界生物额外伤害' } },

    // ── Equipment — armor ──
    { pattern: /木盾/,             type: 'equipment', usable: true, consumed: false, icon: 'ph-shield',       category: 'armor', label: '装备', effect: { stat: 'ac', bonus: 2, desc: 'AC+2' } },
    { pattern: /精制鳞甲/,         type: 'equipment', usable: true, consumed: false, icon: 'ph-shield',       category: 'armor', label: '装备', effect: { stat: 'ac', bonus: 1, desc: 'AC+1' } },
    { pattern: /抗性披风/,         type: 'equipment', usable: true, consumed: false, icon: 'ph-coat-hanger',  category: 'armor', label: '装备', effect: { stat: 'ac', bonus: 0, desc: '豁免检定+1' } },
    { pattern: /生命之戒/,         type: 'equipment', usable: true, consumed: false, icon: 'ph-ring',         category: 'armor', label: '装备', effect: { stat: 'hp', bonus: 5, desc: '最大HP+5' } },
    { pattern: /隐形斗篷/,         type: 'equipment', usable: true, consumed: false, icon: 'ph-eye-slash',    category: 'armor', label: '装备', effect: { stat: 'ac', bonus: 1, desc: 'AC+1，潜行检定优势' } },
    { pattern: /鳞甲/,             type: 'equipment', usable: true, consumed: false, icon: 'ph-shield',       category: 'armor', label: '装备', effect: { stat: 'ac', bonus: 2, desc: 'AC+2' } },

    // ── Scrolls (one-time spell) ──
    { pattern: /卷轴[：:](.+)/,    type: 'scroll', usable: true, consumed: true, icon: 'ph-scroll',          category: 'scroll', label: '使用', effect: { dice: '3D4+3', description: '释放卷轴中的法术' } },

    // ── Consumables with specific effects ──
    { pattern: /圣水/,             type: 'consumable', usable: true, consumed: true, icon: 'ph-drop',         category: 'trinket', label: '使用', effect: { dice: '2D6', description: '对不死/邪魔造成2D6光辉伤害' } },
    { pattern: /银弩矢/,           type: 'consumable', usable: true, consumed: true, icon: 'ph-arrow-up-right', category: 'supply', label: '装备', effect: { description: '装备银弩矢，对狼人等变形生物有效' } },
    { pattern: /幸运币/,           type: 'consumable', usable: true, consumed: true, icon: 'ph-coin',         category: 'trinket', label: '使用', effect: { description: '下次检定可重掷一次' } },
    { pattern: /驱邪圣符/,         type: 'consumable', usable: true, consumed: true, icon: 'ph-shield-star', category: 'trinket', label: '使用', effect: { stat: 'ac', bonus: 1, duration: 'combat', description: '下次战斗AC+1' } },
    { pattern: /冒险者补给包/,     type: 'consumable', usable: true, consumed: true, icon: 'ph-backpack',    category: 'trinket', label: '使用', effect: { description: '补充背包中的基本物资' } },

    // ── Ammo / Supplies ──
    { pattern: /箭矢/,             type: 'ammo', usable: false, consumed: false, icon: 'ph-arrow-up-right',   category: 'supply', label: '' },
    { pattern: /弩矢/,             type: 'ammo', usable: false, consumed: false, icon: 'ph-arrow-up-right',   category: 'supply', label: '' },
    { pattern: /火把/,             type: 'utility', usable: true, consumed: true, icon: 'ph-flame',           category: 'supply', label: '使用', effect: { description: '点燃火把照亮周围' } },
    { pattern: /绳索/,             type: 'utility', usable: true, consumed: true, icon: 'ph-lasso',           category: 'supply', label: '使用', effect: { description: '使用绳索攀爬或捆绑' } },
    { pattern: /陷阱工具包/,       type: 'utility', usable: true, consumed: true, icon: 'ph-wrench',         category: 'supply', label: '使用', effect: { description: '使用工具拆除或设置陷阱' } },
    { pattern: /铁钉/,             type: 'utility', usable: true, consumed: true, icon: 'ph-push-pin',       category: 'supply', label: '使用', effect: { description: '用铁钉固定绳索或卡住门' } },

    // ── Protective trinkets (consumable buffs from loot) ──
    { pattern: /圣符文/,           type: 'consumable', usable: true, consumed: true, icon: 'ph-shield-star',  category: 'trinket', label: '使用', effect: { stat: 'ac', bonus: 1, duration: 'combat', description: '神圣符文：下次战斗AC+1' } },
    { pattern: /护身符/,           type: 'consumable', usable: true, consumed: true, icon: 'ph-shield-star',  category: 'trinket', label: '使用', effect: { description: '护身符散发微光，抵御邪恶侵袭' } },
    { pattern: /天界护符/,         type: 'consumable', usable: true, consumed: true, icon: 'ph-star',         category: 'trinket', label: '使用', effect: { stat: 'ac', bonus: 2, duration: 'combat', description: '天界护符：下次战斗AC+2' } },
    { pattern: /识破宝石/,         type: 'consumable', usable: true, consumed: true, icon: 'ph-eye',          category: 'trinket', label: '使用', effect: { description: '宝石闪耀，揭示隐藏的魔法和陷阱' } },

    // ── Quest / Flavor items (no use) ──
    { pattern: /碎片/,             type: 'quest', usable: false, consumed: false, icon: 'ph-map-trifold',     category: 'trinket', label: '' },
    { pattern: /零件/,             type: 'quest', usable: false, consumed: false, icon: 'ph-gear',            category: 'supply', label: '' },
];

/**
 * Look up item info by name. Returns the first matching registry entry,
 * enriched with any dynamically-parsed values (e.g. gold amount from name).
 * Falls back to a generic usable item if no rule matches.
 *
 * @param {string} itemName
 * @returns {{ type, usable, consumed, icon, label, effect, match, category }}
 */
export function getItemInfo(itemName) {
    for (const rule of ITEM_REGISTRY) {
        const m = itemName.match(rule.pattern);
        if (m) {
            const info = { ...rule, match: m };

            // Dynamic gold parsing for currency items
            if (rule.type === 'currency' && rule.effect.gold === 0) {
                // Try to extract number from the match or item name
                const numMatch = itemName.match(/(\d+)/);
                const amount = numMatch ? parseInt(numMatch[1]) : 10;

                // 灵魂币 → each coin worth 100 gp in Avernus
                if (/灵魂币/.test(itemName)) {
                    info.effect = { ...rule.effect, gold: amount * 100 };
                } else {
                    info.effect = { ...rule.effect, gold: amount };
                }
            }

            return info;
        }
    }

    // ── Fallback: generic item, usable via LLM narration ──
    // Starting equipment items (weapons/armor/packs) are not usable
    const isStartingGear = /长剑|短剑|长弓|短弓|弯刀|巨斧|细剑|法杖|钉锤|飞镖|标枪|匕首|盾牌|锁子甲|皮甲|法术书|成分包|圣物|背包|德鲁伊法器|盗贼工具|乐器/.test(itemName);
    if (isStartingGear) {
        return { type: 'gear', usable: false, consumed: false, icon: 'ph-sword', label: '', effect: null, match: null, category: 'weapon' };
    }

    return { type: 'misc', usable: true, consumed: true, icon: 'ph-package', label: '使用', effect: { description: '使用此物品' }, match: null, category: 'trinket' };
}

/**
 * Get the display category for an inventory item.
 * Maps ITEM_REGISTRY types to SHOP_CATEGORIES IDs.
 * @param {string} itemName
 * @returns {string} category ID (potion|weapon|armor|scroll|supply|trinket)
 */
export function getItemCategory(itemName) {
    const cleanName = itemName.startsWith('[已装备]') ? itemName.replace('[已装备] ', '') : itemName;
    const info = getItemInfo(cleanName);
    return info.category || 'trinket';
}


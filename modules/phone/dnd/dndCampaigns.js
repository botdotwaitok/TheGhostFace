// modules/phone/dnd/dndCampaigns.js — D&D 5e Campaign Data
// Classic D&D campaign settings with encounter tables, loot, and room structures.

// ═══════════════════════════════════════════════════════════════════════
// Campaign Definitions
// ═══════════════════════════════════════════════════════════════════════

export const CAMPAIGNS = [
    {
        id: 'lost_mine',
        name: '失落的矿坑',
        nameEn: 'Lost Mine of Phandelver',
        icon: 'ph-hammer',
        setting: '被遗忘的国度',
        description: '法汉达林矿坑的传说吸引了无数冒险者——但黑蜘蛛已经在那里等候多时……',
        levelRange: '1-5',
        recommendedLevel: 1,
        roomCount: 6,
        encounterTable: {
            combat: [
                { name: '大老鼠', nameEn: 'Giant Rat', cr: 0.125, minLevel: 1, ac: 12, hp: 5, attack: '+3', damage: '1D4+1', type: '穿刺' },
                { name: '哥布林', nameEn: 'Goblin', cr: 0.25, minLevel: 1, ac: 13, hp: 7, attack: '+4', damage: '1D6+2', type: '斩击' },
                { name: '狼', nameEn: 'Wolf', cr: 0.25, minLevel: 1, ac: 12, hp: 11, attack: '+4', damage: '1D6+2', type: '穿刺' },
                { name: '骷髅', nameEn: 'Skeleton', cr: 0.25, minLevel: 1, ac: 13, hp: 13, attack: '+4', damage: '1D6+2', type: '穿刺' },
                { name: '哥布林头目', nameEn: 'Goblin Boss', cr: 1, minLevel: 2, ac: 15, hp: 21, attack: '+4', damage: '1D8+2', type: '斩击' },
                { name: '臭虫熊', nameEn: 'Bugbear', cr: 1, minLevel: 3, ac: 14, hp: 27, attack: '+4', damage: '1D8+2', type: '穿刺' },
            ],
            boss: [
                { name: '黑蜘蛛·尼扎', nameEn: 'Nezznar the Black Spider', cr: 2, ac: 12, hp: 36, attack: '+4', damage: '1D6+2', type: '毒素', special: '蛛网术、暗影之触' },
            ],
            npc: [
                { name: '矮人矿工·冈达', nameEn: 'Gundren Rockseeker', icon: 'ph-hammer',
                  personality: '粗犷豪爽的矮人矿工，满脸络腮胡，说话嗓门大',
                  shopItems: [{ name: '治疗药水', price: 25 }, { name: '火把x5', price: 5 }],
                  infoReward: '听说前面有一间密室，里面藏着古矮人的宝物',
                },
                { name: '精灵游侠·席薇安', nameEn: 'Silvian', icon: 'ph-compass',
                  personality: '沉静优雅的精灵游侠，银色长发，目光如鹰',
                  shopItems: [{ name: '银箭x10', price: 20 }, { name: '治疗药水', price: 25 }],
                  infoReward: '前方的陷阱可以从左侧墙壁绕过',
                },
            ],
        },
        trapTable: [
            { name: '毒针机关', nameEn: 'Poison Needle Trap', damage: '1D4', damageType: '毒素', description: '一根涂了毒液的针从墙壁的裂缝中弹射而出',
              options: [ { text: '敏捷闪避', ability: 'DEX', dc: 12 }, { text: '力量硬扛', ability: 'CON', dc: 14 }, { text: '智力拆解', ability: 'INT', dc: 10 } ] },
            { name: '落石陷阱', nameEn: 'Falling Rocks', damage: '2D6', damageType: '钝击', description: '脚下的地板微微下沉，头顶传来碎裂声——石块开始坠落！',
              options: [ { text: '敏捷翻滚', ability: 'DEX', dc: 13 }, { text: '力量顶住', ability: 'STR', dc: 15 }, { text: '察觉弱点', ability: 'WIS', dc: 11 } ] },
            { name: '蛛网陷阱', nameEn: 'Web Trap', damage: '1D4', damageType: '毒素', description: '粘稠的蛛丝从天花板垂下，越挣扎缠得越紧',
              options: [ { text: '力量挣脱', ability: 'STR', dc: 12 }, { text: '巧手解开', ability: 'DEX', dc: 11 }, { text: '火焰烧断', ability: 'INT', dc: 10 } ] },
        ],
        lootTable: ['治疗药水', '+1 长剑', '卷轴：魔法飞弹', '50 gp', '鳞甲', '宝石(价值25gp)'],
        themePrompt: '矿坑地下城：阴暗潮湿的洞穴，滴水声回荡，哥布林的脚步声从远处传来。岩壁上偶尔闪烁着矿石的微光。',
    },
    {
        id: 'curse_of_strahd',
        name: '斯特拉德的诅咒',
        nameEn: 'Curse of Strahd',
        icon: 'ph-castle-turret',
        setting: '拉维尼亚',
        description: '恶灵的（划掉），迷雾将你吞噬，当你再次睁眼，巴洛维亚的惨白月光投下了古堡的阴影……',
        levelRange: '3-10',
        recommendedLevel: 3,
        roomCount: 7,
        encounterTable: {
            combat: [
                { name: '蝙蝠群', nameEn: 'Swarm of Bats', cr: 0.25, minLevel: 3, ac: 12, hp: 10, attack: '+4', damage: '1D6+2', type: '穿刺', special: '群体' },
                { name: '恐狼', nameEn: 'Dire Wolf', cr: 1, minLevel: 3, ac: 14, hp: 22, attack: '+5', damage: '1D8+3', type: '穿刺', special: '扑倒' },
                { name: '亡灵', nameEn: 'Wight', cr: 3, minLevel: 4, ac: 14, hp: 32, attack: '+4', damage: '1D8+2', type: '斩击', special: '生命汲取' },
                { name: '女巫', nameEn: 'Hag', cr: 3, minLevel: 5, ac: 15, hp: 42, attack: '+5', damage: '1D10+2', type: '斩击', special: '隐形术、可怕外貌' },
                { name: '吸血鬼衍体', nameEn: 'Vampire Spawn', cr: 5, minLevel: 6, ac: 15, hp: 55, attack: '+6', damage: '1D10+3', type: '钝击', special: '生命汲取' },
            ],
            boss: [
                { name: '斯特拉德·冯·扎洛维奇', nameEn: 'Strahd von Zarovich', cr: 5, ac: 14, hp: 75, attack: '+6', damage: '1D10+3', type: '钝击', special: '魅惑凝视、变形术' },
            ],
            npc: [
                { name: '维斯塔尼旅人·伊娃', nameEn: 'Madam Eva', icon: 'ph-crystal-ball',
                  personality: '神秘的维斯塔尼老妇人，用塔罗牌占卜命运',
                  shopItems: [{ name: '圣水', price: 25 }, { name: '维斯塔尼护身符', price: 50 }],
                  infoReward: '命运之轮指引你——古堡地下室藏着击败吸血鬼的关键',
                },
                { name: '伊莲娜·科利亚娜', nameEn: 'Ireena Kolyana', icon: 'ph-user',
                  personality: '坚强但被恐惧困扰的年轻贵族女性，斯特拉德一直在追踪她',
                  shopItems: [{ name: '治疗药水', price: 25 }],
                  infoReward: '古堡的侧门白天是不上锁的',
                },
            ],
        },
        trapTable: [
            { name: '摆锤刀刃', nameEn: 'Pendulum Blade', damage: '2D8', damageType: '斩击', description: '走廊中一把巨大的刀刃如钟摆般来回摆动',
              options: [ { text: '看准时机冲过', ability: 'DEX', dc: 14 }, { text: '强行挡住', ability: 'STR', dc: 16 }, { text: '找到机关关闭', ability: 'INT', dc: 12 } ] },
            { name: '幻影恐惧', nameEn: 'Phantasmal Terror', damage: '1D8', damageType: '心灵', description: '房间充满了令人窒息的黑雾，最恐惧的幻象浮现在眼前',
              options: [ { text: '意志抵抗', ability: 'WIS', dc: 13 }, { text: '理智分析', ability: 'INT', dc: 14 }, { text: '强行闯过', ability: 'CON', dc: 15 } ] },
            { name: '诅咒符文', nameEn: 'Curse Rune', damage: '2D6', damageType: '黑暗', description: '地板上的符文突然亮起暗红色光芒，黑暗能量开始侵蚀',
              options: [ { text: '奥术破解', ability: 'INT', dc: 13 }, { text: '信仰压制', ability: 'WIS', dc: 13 }, { text: '迅速跃开', ability: 'DEX', dc: 14 } ] },
        ],
        lootTable: ['太阳之剑', '圣水', '圣符文', '维斯塔尼护身符', '治疗药水', '银弩矢x10'],
        themePrompt: '哥特恐怖城堡：腐朽的丝绒帷幕在无风中微动，烛台上的火焰投射出扭曲的影子。远处传来管风琴的低沉旋律——是斯特拉德在演奏。',
    },
    {
        id: 'dragon_heist',
        name: '深水城屠龙记',
        nameEn: 'Waterdeep: Dragon Heist',
        icon: 'ph-buildings',
        setting: '被遗忘的国度',
        description: '深水城的繁华街道之下，50万金币的宝藏正等待着有勇气的冒险者……',
        levelRange: '1-5',
        recommendedLevel: 1,
        roomCount: 6,
        encounterTable: {
            combat: [
                { name: '城市老鼠', nameEn: 'City Rat', cr: 0.125, minLevel: 1, ac: 11, hp: 5, attack: '+3', damage: '1D4+1', type: '穿刺' },
                { name: '盗贼', nameEn: 'Bandit', cr: 0.125, minLevel: 1, ac: 12, hp: 11, attack: '+3', damage: '1D6+1', type: '斩击' },
                { name: '流氓', nameEn: 'Thug', cr: 0.5, minLevel: 1, ac: 11, hp: 16, attack: '+4', damage: '1D6+2', type: '钝击' },
                { name: '勘查巨人', nameEn: 'Intellect Devourer', cr: 2, minLevel: 3, ac: 12, hp: 21, attack: '+4', damage: '1D8+2', type: '心灵', special: '吞噬智力' },
                { name: '变形人', nameEn: 'Doppelganger', cr: 3, minLevel: 4, ac: 14, hp: 32, attack: '+6', damage: '1D8+3', type: '钝击', special: '变形、读心' },
            ],
            boss: [
                { name: '赞纳萨', nameEn: 'Xanathar', cr: 3, ac: 14, hp: 44, attack: '+5', damage: '1D8+2', type: '力场', special: '眼球射线' },
            ],
            npc: [
                { name: '沃罗·甘特格利姆', nameEn: 'Volo', icon: 'ph-book-open',
                  personality: '話多又浮夸的旅行作家，总是在推销自己的新书',
                  shopItems: [{ name: '沃罗的怪物指南', price: 15 }, { name: '藏宝图碎片', price: 30 }],
                  infoReward: '城下水道的第三个岔路口右转，会通向赞纳萨的秘密入口',
                },
                { name: '酒馆老板·达菲', nameEn: 'Durnan', icon: 'ph-beer-stein',
                  personality: '沉默寡言的退休冒险者，经营着整个深水城最有名的酒馆',
                  shopItems: [{ name: '治疗药水', price: 25 }, { name: '高等治疗药水', price: 75 }],
                  infoReward: '最近有不少人从下水道失踪了，都是在夜里',
                },
                { name: '灵猫·弗兰佐', nameEn: 'Floon', icon: 'ph-cat',
                  personality: '可爱的变形灵猫，偶尔变回人形说几句没头没尾的话',
                  shopItems: [{ name: '幸运币', price: 10 }],
                  infoReward: '喵——（它的眼睛盯着北边的墙壁看了很久）',
                },
            ],
        },
        trapTable: [
            { name: '地板机关', nameEn: 'Pressure Plate', damage: '1D6', damageType: '穿刺', description: '脚下的石板微微下沉，两侧墙壁射出了飞镖！',
              options: [ { text: '敏捷闪避', ability: 'DEX', dc: 12 }, { text: '盾牌格挡', ability: 'STR', dc: 13 }, { text: '提前发现并拆除', ability: 'INT', dc: 10 } ] },
            { name: '催眠气体', nameEn: 'Sleep Gas', damage: '1D4', damageType: '毒素', description: '铁门关闭，绿色的气体从天花板的小孔中喷出',
              options: [ { text: '屏住呼吸', ability: 'CON', dc: 13 }, { text: '找到通风口', ability: 'INT', dc: 11 }, { text: '强行破门', ability: 'STR', dc: 14 } ] },
            { name: '魔法警报', nameEn: 'Arcane Alarm', damage: '1D8', damageType: '力场', description: '你触碰到了一道隐形的魔法屏障，警报声刺耳响起！',
              options: [ { text: '奥术压制', ability: 'INT', dc: 12 }, { text: '迅速后退', ability: 'DEX', dc: 11 }, { text: '硬扛冲击', ability: 'CON', dc: 13 } ] },
        ],
        lootTable: ['识破宝石', '隐形斗篷', '深水城金币x100', '藏宝图碎片', '治疗药水x2'],
        themePrompt: '城市冒险：深水城的鹅卵石街巷，酒馆中弥漫着麦酒和烤肉的香气，暗巷里的阴影中似乎有人在跟踪你们。繁华背后暗流涌动。',
    },
    {
        id: 'descent_avernus',
        name: '坠入阿弗纳斯',
        nameEn: 'Descent into Avernus',
        icon: 'ph-fire',
        setting: '九层地狱',
        description: '博德之门沉入黑暗，通往地狱第一层阿弗纳斯的裂隙已经打开……',
        levelRange: '1-13',
        recommendedLevel: 1,
        roomCount: 7,
        encounterTable: {
            combat: [
                { name: '地狱蝇群', nameEn: 'Hell Fly Swarm', cr: 0.125, minLevel: 1, ac: 11, hp: 6, attack: '+3', damage: '1D4+1', type: '穿刺' },
                { name: '小恶魔', nameEn: 'Imp', cr: 0.5, minLevel: 1, ac: 13, hp: 10, attack: '+5', damage: '1D4+3', type: '穿刺', special: '隐形' },
                { name: '棘刺恶魔', nameEn: 'Spined Devil', cr: 2, minLevel: 2, ac: 13, hp: 22, attack: '+4', damage: '1D6+2', type: '穿刺', special: '飞行、尾刺' },
                { name: '地狱犬', nameEn: 'Hell Hound', cr: 3, minLevel: 4, ac: 15, hp: 35, attack: '+5', damage: '1D8+3', type: '穿刺', special: '火焰吐息' },
                { name: '链魔鬼', nameEn: 'Chain Devil', cr: 5, minLevel: 6, ac: 16, hp: 50, attack: '+7', damage: '1D10+4', type: '斩击', special: '活化锁链' },
            ],
            boss: [
                { name: '扎瑞尔', nameEn: 'Zariel', cr: 6, ac: 15, hp: 80, attack: '+7', damage: '2D6+3', type: '斩击', special: '堕落大天使、火焰光环' },
            ],
            npc: [
                { name: '堕落天使·露露', nameEn: 'Lulu', icon: 'ph-angel',
                  personality: '失忆的金色小象，曾是天使的坐骑，善良但记忆混乱',
                  shopItems: [{ name: '天界护符', price: 50 }, { name: '治疗药水', price: 25 }],
                  infoReward: '我记得……扎瑞尔的剑，就在那座燃烧的大教堂里！',
                },
                { name: '地狱骑士·乌尔德', nameEn: 'Ulder Ravengard', icon: 'ph-shield-star',
                  personality: '严肃正直的骑士团长，被困在地狱中寻找出路',
                  shopItems: [{ name: '地狱钢铁武器', price: 60 }, { name: '高等治疗药水', price: 75 }],
                  infoReward: '不要走那条熔岩河旁的路——那里有链魔鬼巡逻',
                },
            ],
        },
        trapTable: [
            { name: '熔岩喷涌', nameEn: 'Lava Geyser', damage: '2D8', damageType: '火焰', description: '地面裂开，炽热的熔岩如间歇泉般喷涌而出！',
              options: [ { text: '敏捷翻滚', ability: 'DEX', dc: 14 }, { text: '抗火体质', ability: 'CON', dc: 15 }, { text: '预判喷发点', ability: 'WIS', dc: 12 } ] },
            { name: '灵魂吸取', nameEn: 'Soul Siphon', damage: '2D6', damageType: '黑暗', description: '一个恶魔符文在脚下亮起，你感到灵魂正在被吸走',
              options: [ { text: '意志抵抗', ability: 'WIS', dc: 14 }, { text: '奥术反制', ability: 'INT', dc: 13 }, { text: '强行冲出', ability: 'STR', dc: 15 } ] },
            { name: '地狱锁链', nameEn: 'Infernal Chains', damage: '1D8', damageType: '穿刺', description: '从地面伸出的灼热锁链缠绕住了你的双腿！',
              options: [ { text: '力量挣脱', ability: 'STR', dc: 13 }, { text: '巧妙脱身', ability: 'DEX', dc: 12 }, { text: '弱点分析', ability: 'INT', dc: 11 } ] },
        ],
        lootTable: ['地狱钢铁武器', '灵魂币x5', '天界护符', '战争机器零件', '高等治疗药水'],
        themePrompt: '地狱第一层：赤红色的天空下，荒芜的大地布满裂缝，熔岩河流在远处蜿蜒。空气中弥漫着硫磺的气味，远方传来战争机器的轰鸣。',
    },
];

// ═══════════════════════════════════════════════════════════════════════
// Room / Event Types
// ═══════════════════════════════════════════════════════════════════════

export const ROOM_TYPES = [
    { id: 'combat', name: '战斗', icon: 'ph-sword', weight: 35 },
    { id: 'puzzle', name: '谜题', icon: 'ph-puzzle-piece', weight: 20 },
    { id: 'trap', name: '陷阱', icon: 'ph-warning', weight: 15 },
    { id: 'treasure', name: '宝箱', icon: 'ph-treasure-chest', weight: 10 },
    { id: 'npc', name: '遭遇NPC', icon: 'ph-chat-circle', weight: 10 },
    { id: 'rest', name: '休息点', icon: 'ph-campfire', weight: 10 },
];

/**
 * Pick a weighted-random room type.
 */
export function pickRandomRoomType() {
    const totalWeight = ROOM_TYPES.reduce((sum, t) => sum + t.weight, 0);
    let rand = Math.random() * totalWeight;
    for (const type of ROOM_TYPES) {
        rand -= type.weight;
        if (rand <= 0) return type.id;
    }
    return 'combat';
}

/**
 * Pick a random enemy from a campaign's combat encounter table, filtered by player level.
 * @param {object} campaign
 * @param {number} playerLevel — current player level for difficulty scaling
 */
export function pickRandomEnemy(campaign, playerLevel = 1) {
    const combatList = campaign.encounterTable.combat;
    // Filter to enemies the player's level qualifies for
    const eligible = combatList.filter(e => (e.minLevel || 1) <= playerLevel);
    // Fallback: if nothing eligible (shouldn't happen), pick weakest
    const pool = eligible.length > 0 ? eligible : [combatList[0]];
    return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Pick a random loot item from a campaign's loot table.
 */
export function pickRandomLoot(campaign) {
    return campaign.lootTable[Math.floor(Math.random() * campaign.lootTable.length)];
}

/**
 * Pick a random trap from a campaign's trap table.
 * @param {object} campaign
 * @returns {object} trap definition
 */
export function pickRandomTrap(campaign) {
    const traps = campaign.trapTable || [];
    if (traps.length === 0) {
        // Fallback generic trap
        return {
            name: '隐藏陷阱', nameEn: 'Hidden Trap', damage: '1D6', damageType: '穿刺',
            description: '你踩到了一个隐藏的机关！',
            options: [
                { text: '敏捷闪避', ability: 'DEX', dc: 12 },
                { text: '力量硬扛', ability: 'STR', dc: 14 },
                { text: '智力拆解', ability: 'INT', dc: 10 },
            ],
        };
    }
    return traps[Math.floor(Math.random() * traps.length)];
}

/**
 * Pick a random NPC from a campaign's NPC table.
 * @param {object} campaign
 * @returns {object} structured NPC definition
 */
export function pickRandomNPC(campaign) {
    const npcs = campaign.encounterTable?.npc || [];
    if (npcs.length === 0) {
        return {
            name: '神秘旅人', nameEn: 'Mysterious Traveler', icon: 'ph-user',
            personality: '一个沉默寡言的旅人，似乎知道一些事情',
            shopItems: [{ name: '治疗药水', price: 25 }],
            infoReward: '前方的路不太安全',
        };
    }
    return npcs[Math.floor(Math.random() * npcs.length)];
}

/**
 * Get campaign by ID.
 */
export function getCampaignById(id) {
    return CAMPAIGNS.find(c => c.id === id) || null;
}

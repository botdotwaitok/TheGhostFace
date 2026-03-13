// modules/phone/tarot/tarotData.js — 塔罗牌定义 & 抽牌工具
// 78 张完整塔罗牌：22 大阿尔卡纳 + 56 小阿尔卡纳

const TAROT_IMAGE_BASE = '/scripts/extensions/third-party/TheGhostFace/assets/images/tarot/';

/**
 * 22 张大阿尔卡纳定义
 * image 字段为文件名，完整 URL = TAROT_IMAGE_BASE + image
 */
export const MAJOR_ARCANA = [
    { id: 0,  name: '愚者',     nameEn: 'The Fool',            image: '00_the_fool.jpg',           upright: '新开始、冒险、自由、纯真', reversed: '鲁莽、冒失、犹豫不决' },
    { id: 1,  name: '魔术师',   nameEn: 'The Magician',         image: '01_the_magician.jpg',       upright: '创造力、意志力、自信、技巧', reversed: '欺骗、操控、缺乏方向' },
    { id: 2,  name: '女祭司',   nameEn: 'The High Priestess',   image: '02_the_high_priestess.jpg', upright: '直觉、潜意识、智慧、神秘', reversed: '隐藏的真相、表面化、忽视直觉' },
    { id: 3,  name: '女皇',     nameEn: 'The Empress',          image: '03_the_empress.jpg',        upright: '丰饶、母性、自然、滋养', reversed: '依赖、过度保护、创造力受阻' },
    { id: 4,  name: '皇帝',     nameEn: 'The Emperor',          image: '04_the_emperor.jpg',        upright: '权威、秩序、稳定、领导力', reversed: '专制、僵化、控制欲过强' },
    { id: 5,  name: '教皇',     nameEn: 'The Hierophant',       image: '05_the_hierophant.jpg',     upright: '传统、信仰、指导、conformity', reversed: '叛逆、打破常规、独立思考' },
    { id: 6,  name: '恋人',     nameEn: 'The Lovers',           image: '06_the_lovers.jpg',         upright: '爱情、和谐、选择、价值观', reversed: '失衡、不和谐、错误选择' },
    { id: 7,  name: '战车',     nameEn: 'The Chariot',          image: '07_the_chariot.jpg',        upright: '决心、胜利、意志力、行动', reversed: '失控、方向不明、攻击性' },
    { id: 8,  name: '力量',     nameEn: 'Strength',             image: '08_strength.jpg',           upright: '勇气、内在力量、耐心、慈悲', reversed: '自我怀疑、软弱、缺乏信心' },
    { id: 9,  name: '隐者',     nameEn: 'The Hermit',           image: '09_the_hermit.jpg',         upright: '内省、独处、智慧、寻找答案', reversed: '孤立、逃避、固执' },
    { id: 10, name: '命运之轮', nameEn: 'Wheel of Fortune',     image: '10_wheel_of_fortune.jpg',   upright: '转变、机遇、命运、好运', reversed: '厄运、抗拒变化、失控' },
    { id: 11, name: '正义',     nameEn: 'Justice',              image: '11_justice.jpg',            upright: '公正、真理、因果、平衡', reversed: '不公、偏见、逃避责任' },
    { id: 12, name: '倒吊人',   nameEn: 'The Hanged Man',       image: '12_the_hanged_man.jpg',     upright: '牺牲、等待、换个角度、放下', reversed: '拖延、无谓牺牲、自我束缚' },
    { id: 13, name: '死神',     nameEn: 'Death',                image: '13_death.jpg',              upright: '结束、转变、重生、告别过去', reversed: '抗拒改变、停滞不前、恐惧' },
    { id: 14, name: '节制',     nameEn: 'Temperance',           image: '14_temperance.jpg',         upright: '平衡、耐心、中庸、治愈', reversed: '失衡、过度、缺乏耐心' },
    { id: 15, name: '恶魔',     nameEn: 'The Devil',            image: '15_the_devil.jpg',          upright: '束缚、执念、物欲、阴暗面', reversed: '解脱、释放、重获自由' },
    { id: 16, name: '塔',       nameEn: 'The Tower',            image: '16_the_tower.jpg',          upright: '突变、毁灭、觉醒、真相揭露', reversed: '逃避灾难、恐惧改变、延迟' },
    { id: 17, name: '星星',     nameEn: 'The Star',             image: '17_the_star.jpg',           upright: '希望、灵感、宁静、恩典', reversed: '失望、缺乏信心、怀疑' },
    { id: 18, name: '月亮',     nameEn: 'The Moon',             image: '18_the_moon.jpg',           upright: '幻象、潜意识、恐惧、直觉', reversed: '释放恐惧、真相大白、清明' },
    { id: 19, name: '太阳',     nameEn: 'The Sun',              image: '19_the_sun.jpg',            upright: '快乐、成功、活力、光明', reversed: '短暂的快乐、过度乐观' },
    { id: 20, name: '审判',     nameEn: 'Judgement',            image: '20_judgement.jpg',          upright: '觉醒、反省、重生、召唤', reversed: '自我怀疑、逃避审视、拒绝改变' },
    { id: 21, name: '世界',     nameEn: 'The World',            image: '21_the_world.jpg',          upright: '完成、圆满、旅程终点、成就', reversed: '未完成、缺少closure、延迟' },
];

// ═══════════════════════════════════════════════════════════════════════
// 56 张小阿尔卡纳 (Minor Arcana)
// ═══════════════════════════════════════════════════════════════════════

/** 🪄 权杖 (Wands) — 火元素：行动、激情、创造力 */
export const WANDS = [
    { id: 'w01', name: '权杖王牌',   nameEn: 'Ace of Wands',    image: 'wands_01_ace.jpg',    upright: '灵感、新机遇、创造力爆发、潜力', reversed: '延迟、缺乏方向、错失机会' },
    { id: 'w02', name: '权杖二',     nameEn: 'Two of Wands',    image: 'wands_02.jpg',        upright: '计划、决策、展望未来、勇气', reversed: '恐惧未知、犹豫不决、缺乏规划' },
    { id: 'w03', name: '权杖三',     nameEn: 'Three of Wands',  image: 'wands_03.jpg',        upright: '远见、拓展、进步、领导力', reversed: '眼高手低、挫折、计划受阻' },
    { id: 'w04', name: '权杖四',     nameEn: 'Four of Wands',   image: 'wands_04.jpg',        upright: '庆祝、和谐、归属感、里程碑', reversed: '不安定、缺乏归属、过渡期' },
    { id: 'w05', name: '权杖五',     nameEn: 'Five of Wands',   image: 'wands_05.jpg',        upright: '竞争、冲突、挑战、多元观点', reversed: '逃避冲突、内心矛盾、妥协' },
    { id: 'w06', name: '权杖六',     nameEn: 'Six of Wands',    image: 'wands_06.jpg',        upright: '胜利、认可、自信、公众赞誉', reversed: '自负、名不副实、害怕失败' },
    { id: 'w07', name: '权杖七',     nameEn: 'Seven of Wands',  image: 'wands_07.jpg',        upright: '坚守立场、勇气、坚持、防御', reversed: '退缩、不堪重负、放弃' },
    { id: 'w08', name: '权杖八',     nameEn: 'Eight of Wands',  image: 'wands_08.jpg',        upright: '快速发展、行动力、消息到来、势头', reversed: '延迟、受阻、匆忙行事' },
    { id: 'w09', name: '权杖九',     nameEn: 'Nine of Wands',   image: 'wands_09.jpg',        upright: '坚韧、毅力、最后的考验、防备', reversed: '疲惫、固执、过度防御' },
    { id: 'w10', name: '权杖十',     nameEn: 'Ten of Wands',    image: 'wands_10.jpg',        upright: '重担、责任、压力、即将完成', reversed: '放下包袱、学会委托、释放压力' },
    { id: 'w11', name: '权杖侍从',   nameEn: 'Page of Wands',   image: 'wands_11_page.jpg',   upright: '探索、热情、好奇心、新消息', reversed: '幼稚、缺乏方向、三分钟热度' },
    { id: 'w12', name: '权杖骑士',   nameEn: 'Knight of Wands',  image: 'wands_12_knight.jpg', upright: '冒险、冲劲、魅力、追求激情', reversed: '冲动、鲁莽、注意力分散' },
    { id: 'w13', name: '权杖王后',   nameEn: 'Queen of Wands',   image: 'wands_13_queen.jpg',  upright: '自信、独立、温暖、社交魅力', reversed: '嫉妒、自私、控制欲' },
    { id: 'w14', name: '权杖国王',   nameEn: 'King of Wands',    image: 'wands_14_king.jpg',   upright: '领袖气质、远见、果断、企业家精神', reversed: '专横、冲动、期望过高' },
];

/** 🏆 圣杯 (Cups) — 水元素：情感、关系、直觉 */
export const CUPS = [
    { id: 'c01', name: '圣杯王牌',   nameEn: 'Ace of Cups',     image: 'cups_01_ace.jpg',     upright: '新感情、爱的开始、情感充沛、灵性', reversed: '情感封闭、空虚、被压抑的感情' },
    { id: 'c02', name: '圣杯二',     nameEn: 'Two of Cups',     image: 'cups_02.jpg',         upright: '连结、伙伴关系、互相吸引、和谐', reversed: '失衡的关系、分离、误解' },
    { id: 'c03', name: '圣杯三',     nameEn: 'Three of Cups',   image: 'cups_03.jpg',         upright: '友谊、庆祝、社交、创意合作', reversed: '过度沉溺、八卦、社交疲惫' },
    { id: 'c04', name: '圣杯四',     nameEn: 'Four of Cups',    image: 'cups_04.jpg',         upright: '冥想、重新审视、不满足、内省', reversed: '觉醒、接受新机会、走出困境' },
    { id: 'c05', name: '圣杯五',     nameEn: 'Five of Cups',    image: 'cups_05.jpg',         upright: '失落、悲伤、遗憾、专注于失去', reversed: '释怀、接受、向前看' },
    { id: 'c06', name: '圣杯六',     nameEn: 'Six of Cups',     image: 'cups_06.jpg',         upright: '怀旧、童年回忆、纯真、重逢', reversed: '活在过去、不切实际、成长' },
    { id: 'c07', name: '圣杯七',     nameEn: 'Seven of Cups',   image: 'cups_07.jpg',         upright: '幻想、选择、白日梦、诱惑', reversed: '看清现实、做出选择、聚焦' },
    { id: 'c08', name: '圣杯八',     nameEn: 'Eight of Cups',   image: 'cups_08.jpg',         upright: '离开、放下、寻找更深意义、转身', reversed: '逃避、恐惧改变、漫无目的' },
    { id: 'c09', name: '圣杯九',     nameEn: 'Nine of Cups',    image: 'cups_09.jpg',         upright: '愿望成真、满足、幸福、感恩', reversed: '贪婪、不满足、物质主义' },
    { id: 'c10', name: '圣杯十',     nameEn: 'Ten of Cups',     image: 'cups_10.jpg',         upright: '家庭幸福、情感圆满、和睦、天伦之乐', reversed: '家庭矛盾、期望落空、价值观冲突' },
    { id: 'c11', name: '圣杯侍从',   nameEn: 'Page of Cups',    image: 'cups_11_page.jpg',    upright: '创意灵感、直觉信息、温柔、浪漫', reversed: '情绪化、幼稚、不切实际的梦' },
    { id: 'c12', name: '圣杯骑士',   nameEn: 'Knight of Cups',   image: 'cups_12_knight.jpg',  upright: '浪漫、魅力、理想主义、追求美', reversed: '情绪波动、不切实际、嫉妒' },
    { id: 'c13', name: '圣杯王后',   nameEn: 'Queen of Cups',    image: 'cups_13_queen.jpg',   upright: '共情、关怀、直觉力、情感智慧', reversed: '情感依赖、过度敏感、殉道者' },
    { id: 'c14', name: '圣杯国王',   nameEn: 'King of Cups',     image: 'cups_14_king.jpg',    upright: '情感成熟、平衡、慷慨、外交', reversed: '情绪压抑、冷漠、操控' },
];

/** ⚔️ 宝剑 (Swords) — 风元素：思维、沟通、真相 */
export const SWORDS = [
    { id: 's01', name: '宝剑王牌',   nameEn: 'Ace of Swords',   image: 'swords_01_ace.jpg',   upright: '清晰、突破、真相、新想法', reversed: '混乱、误解、思维受阻' },
    { id: 's02', name: '宝剑二',     nameEn: 'Two of Swords',   image: 'swords_02.jpg',       upright: '抉择困难、僵局、逃避、需要平衡', reversed: '信息过载、优柔寡断、焦虑' },
    { id: 's03', name: '宝剑三',     nameEn: 'Three of Swords',  image: 'swords_03.jpg',       upright: '心碎、悲伤、痛苦、背叛', reversed: '愈合、释放痛苦、原谅' },
    { id: 's04', name: '宝剑四',     nameEn: 'Four of Swords',   image: 'swords_04.jpg',       upright: '休息、恢复、冥想、退一步', reversed: '不安、倦怠、被迫行动' },
    { id: 's05', name: '宝剑五',     nameEn: 'Five of Swords',   image: 'swords_05.jpg',       upright: '冲突、输赢、自私、不择手段', reversed: '和解、认输、放下争执' },
    { id: 's06', name: '宝剑六',     nameEn: 'Six of Swords',    image: 'swords_06.jpg',       upright: '过渡、离开困境、前进、疗愈之旅', reversed: '滞留、未解决的问题、抗拒改变' },
    { id: 's07', name: '宝剑七',     nameEn: 'Seven of Swords',  image: 'swords_07.jpg',       upright: '策略、隐秘行动、独立、狡猾', reversed: '被揭穿、自欺欺人、坦诚' },
    { id: 's08', name: '宝剑八',     nameEn: 'Eight of Swords',  image: 'swords_08.jpg',       upright: '自我束缚、受困、无力感、限制性思维', reversed: '自我解放、新视角、重获力量' },
    { id: 's09', name: '宝剑九',     nameEn: 'Nine of Swords',   image: 'swords_09.jpg',       upright: '焦虑、噩梦、恐惧、过度思虑', reversed: '释放恐惧、希望、走出黑暗' },
    { id: 's10', name: '宝剑十',     nameEn: 'Ten of Swords',    image: 'swords_10.jpg',       upright: '终结、触底、痛苦的结局、新的黎明', reversed: '复苏、最坏已过、不愿放手' },
    { id: 's11', name: '宝剑侍从',   nameEn: 'Page of Swords',   image: 'swords_11_page.jpg',  upright: '好奇心、求知欲、新观点、警觉', reversed: '八卦、冷嘲热讽、缺乏计划' },
    { id: 's12', name: '宝剑骑士',   nameEn: 'Knight of Swords',  image: 'swords_12_knight.jpg', upright: '果断、敏锐、直言不讳、快速行动', reversed: '冲动、不顾后果、言语伤人' },
    { id: 's13', name: '宝剑王后',   nameEn: 'Queen of Swords',   image: 'swords_13_queen.jpg',  upright: '独立思考、洞察力、直率、理性', reversed: '冷酷、过于苛刻、封闭情感' },
    { id: 's14', name: '宝剑国王',   nameEn: 'King of Swords',    image: 'swords_14_king.jpg',   upright: '权威、理智、公正、清晰思维', reversed: '滥用权力、独裁、冷酷无情' },
];

/** 🪙 星币 (Pentacles) — 土元素：物质、健康、实际事务 */
export const PENTACLES = [
    { id: 'p01', name: '星币王牌',   nameEn: 'Ace of Pentacles',  image: 'pentacles_01_ace.jpg',   upright: '新财运、机遇、物质基础、丰盛', reversed: '错失机会、计划不周、财务问题' },
    { id: 'p02', name: '星币二',     nameEn: 'Two of Pentacles',  image: 'pentacles_02.jpg',       upright: '平衡、灵活、优先排序、适应', reversed: '失衡、分身乏术、财务混乱' },
    { id: 'p03', name: '星币三',     nameEn: 'Three of Pentacles', image: 'pentacles_03.jpg',       upright: '团队合作、技艺、学习、建设', reversed: '缺乏合作、平庸、不被认可' },
    { id: 'p04', name: '星币四',     nameEn: 'Four of Pentacles',  image: 'pentacles_04.jpg',       upright: '安全感、守护、稳定、控制', reversed: '吝啬、执着、害怕失去' },
    { id: 'p05', name: '星币五',     nameEn: 'Five of Pentacles',  image: 'pentacles_05.jpg',       upright: '困难、匮乏、孤立、经济困境', reversed: '恢复、寻求帮助、精神富足' },
    { id: 'p06', name: '星币六',     nameEn: 'Six of Pentacles',   image: 'pentacles_06.jpg',       upright: '慷慨、分享、施与受、公平交换', reversed: '不公平、施舍感、附条件的给予' },
    { id: 'p07', name: '星币七',     nameEn: 'Seven of Pentacles', image: 'pentacles_07.jpg',       upright: '耐心等待、评估成果、长期投资、反思', reversed: '急于求成、回报不足、浪费精力' },
    { id: 'p08', name: '星币八',     nameEn: 'Eight of Pentacles', image: 'pentacles_08.jpg',       upright: '勤奋、专注、技能精进、工匠精神', reversed: '敷衍了事、缺乏热情、完美主义' },
    { id: 'p09', name: '星币九',     nameEn: 'Nine of Pentacles',  image: 'pentacles_09.jpg',       upright: '自给自足、优雅、成就、独立', reversed: '过度工作、物质依赖、虚荣' },
    { id: 'p10', name: '星币十',     nameEn: 'Ten of Pentacles',   image: 'pentacles_10.jpg',       upright: '传承、家族财富、长久稳定、遗产', reversed: '家族纷争、财务不稳、短视' },
    { id: 'p11', name: '星币侍从',   nameEn: 'Page of Pentacles',  image: 'pentacles_11_page.jpg',  upright: '学习、新技能、脚踏实地、机遇', reversed: '缺乏远见、懒散、不切实际' },
    { id: 'p12', name: '星币骑士',   nameEn: 'Knight of Pentacles', image: 'pentacles_12_knight.jpg', upright: '踏实、负责、坚持不懈、可靠', reversed: '固执、过于保守、乏味' },
    { id: 'p13', name: '星币王后',   nameEn: 'Queen of Pentacles',  image: 'pentacles_13_queen.jpg',  upright: '务实、滋养、理财有方、温馨', reversed: '过度牺牲、工作狂、忽视自我' },
    { id: 'p14', name: '星币国王',   nameEn: 'King of Pentacles',   image: 'pentacles_14_king.jpg',   upright: '财富、成功、稳重、商业头脑', reversed: '贪婪、物质主义、刻板' },
];

/**
 * 完整 78 张塔罗牌
 */
export const FULL_DECK = [...MAJOR_ARCANA, ...WANDS, ...CUPS, ...SWORDS, ...PENTACLES];

/**
 * 三牌阵位置名称
 */
export const SPREAD_POSITIONS = ['过去', '现在', '未来'];

/**
 * 随机抽取 n 张牌（不重复），每张自动随机正位/逆位。
 * 从完整 78 张牌中抽取。
 * @param {number} n - 抽几张（默认 3）
 * @returns {Array<{ card: object, isReversed: boolean, position: string }>}
 */
export function drawCards(n = 3) {
    const pool = [...FULL_DECK];
    const result = [];

    for (let i = 0; i < n && pool.length > 0; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        const card = pool.splice(idx, 1)[0];
        result.push({
            card,
            isReversed: Math.random() < 0.35,   // ~35% 概率逆位
            position: SPREAD_POSITIONS[i] || `位置${i + 1}`,
        });
    }

    return result;
}

/**
 * 获取牌面图片完整 URL
 * @param {string} imageFilename
 * @returns {string}
 */
export function getCardImageUrl(imageFilename) {
    return TAROT_IMAGE_BASE + imageFilename;
}

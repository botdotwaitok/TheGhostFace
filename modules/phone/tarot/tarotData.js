// modules/phone/tarot/tarotData.js — 塔罗牌定义 & 抽牌工具
// 22 张大阿尔卡纳 (Major Arcana)，含中英文名、正位/逆位关键词、图片文件名。

const TAROT_IMAGE_BASE = '/scripts/extensions/third-party/TheGhostFace/assets/images/tarot/';

/**
 * 22 张大阿尔卡纳定义
 * image 字段为文件名，完整 URL = TAROT_IMAGE_BASE + image
 */
export const MAJOR_ARCANA = [
    { id: 0,  name: '愚者',   nameEn: 'The Fool',            image: '00_the_fool.jpg',           upright: '新开始、冒险、自由、纯真', reversed: '鲁莽、冒失、犹豫不决' },
    { id: 1,  name: '魔术师', nameEn: 'The Magician',         image: '01_the_magician.jpg',       upright: '创造力、意志力、自信、技巧', reversed: '欺骗、操控、缺乏方向' },
    { id: 2,  name: '女祭司', nameEn: 'The High Priestess',   image: '02_the_high_priestess.jpg', upright: '直觉、潜意识、智慧、神秘', reversed: '隐藏的真相、表面化、忽视直觉' },
    { id: 3,  name: '女皇',   nameEn: 'The Empress',          image: '03_the_empress.jpg',        upright: '丰饶、母性、自然、滋养', reversed: '依赖、过度保护、创造力受阻' },
    { id: 4,  name: '皇帝',   nameEn: 'The Emperor',          image: '04_the_emperor.jpg',        upright: '权威、秩序、稳定、领导力', reversed: '专制、僵化、控制欲过强' },
    { id: 5,  name: '教皇',   nameEn: 'The Hierophant',       image: '05_the_hierophant.jpg',     upright: '传统、信仰、指导、conformity', reversed: '叛逆、打破常规、独立思考' },
    { id: 6,  name: '恋人',   nameEn: 'The Lovers',           image: '06_the_lovers.jpg',         upright: '爱情、和谐、选择、价值观', reversed: '失衡、不和谐、错误选择' },
    { id: 7,  name: '战车',   nameEn: 'The Chariot',          image: '07_the_chariot.jpg',        upright: '决心、胜利、意志力、行动', reversed: '失控、方向不明、攻击性' },
    { id: 8,  name: '力量',   nameEn: 'Strength',             image: '08_strength.jpg',           upright: '勇气、内在力量、耐心、慈悲', reversed: '自我怀疑、软弱、缺乏信心' },
    { id: 9,  name: '隐者',   nameEn: 'The Hermit',           image: '09_the_hermit.jpg',        upright: '内省、独处、智慧、寻找答案', reversed: '孤立、逃避、固执' },
    { id: 10, name: '命运之轮', nameEn: 'Wheel of Fortune',   image: '10_wheel_of_fortune.jpg',  upright: '转变、机遇、命运、好运', reversed: '厄运、抗拒变化、失控' },
    { id: 11, name: '正义',   nameEn: 'Justice',              image: '11_justice.jpg',            upright: '公正、真理、因果、平衡', reversed: '不公、偏见、逃避责任' },
    { id: 12, name: '倒吊人', nameEn: 'The Hanged Man',       image: '12_the_hanged_man.jpg',    upright: '牺牲、等待、换个角度、放下', reversed: '拖延、无谓牺牲、自我束缚' },
    { id: 13, name: '死神',   nameEn: 'Death',                image: '13_death.jpg',              upright: '结束、转变、重生、告别过去', reversed: '抗拒改变、停滞不前、恐惧' },
    { id: 14, name: '节制',   nameEn: 'Temperance',           image: '14_temperance.jpg',         upright: '平衡、耐心、中庸、治愈', reversed: '失衡、过度、缺乏耐心' },
    { id: 15, name: '恶魔',   nameEn: 'The Devil',            image: '15_the_devil.jpg',          upright: '束缚、执念、物欲、阴暗面', reversed: '解脱、释放、重获自由' },
    { id: 16, name: '塔',     nameEn: 'The Tower',            image: '16_the_tower.jpg',          upright: '突变、毁灭、觉醒、真相揭露', reversed: '逃避灾难、恐惧改变、延迟' },
    { id: 17, name: '星星',   nameEn: 'The Star',             image: '17_the_star.jpg',           upright: '希望、灵感、宁静、恩典', reversed: '失望、缺乏信心、怀疑' },
    { id: 18, name: '月亮',   nameEn: 'The Moon',             image: '18_the_moon.jpg',           upright: '幻象、潜意识、恐惧、直觉', reversed: '释放恐惧、真相大白、清明' },
    { id: 19, name: '太阳',   nameEn: 'The Sun',              image: '19_the_sun.jpg',            upright: '快乐、成功、活力、光明', reversed: '短暂的快乐、过度乐观' },
    { id: 20, name: '审判',   nameEn: 'Judgement',            image: '20_judgement.jpg',          upright: '觉醒、反省、重生、召唤', reversed: '自我怀疑、逃避审视、拒绝改变' },
    { id: 21, name: '世界',   nameEn: 'The World',            image: '21_the_world.jpg',          upright: '完成、圆满、旅程终点、成就', reversed: '未完成、缺少closure、延迟' },
];

/**
 * 三牌阵位置名称
 */
export const SPREAD_POSITIONS = ['过去', '现在', '未来'];

/**
 * 随机抽取 n 张牌（不重复），每张自动随机正位/逆位。
 * @param {number} n - 抽几张（默认 3）
 * @returns {Array<{ card: object, isReversed: boolean, position: string }>}
 */
export function drawCards(n = 3) {
    const pool = [...MAJOR_ARCANA];
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

// ui/phone/shop/shopData.js — Catalog of all items available in the shop
// Items are defined here as fallback defaults.
// At runtime, loadDynamicShopData() attempts to fetch shopData.json from the
// ghost-server. If successful, the in-memory arrays are replaced with server data,
// enabling hot-edit of the catalog from the Admin Dashboard without any git updates.

import { getSettings } from '../moments/state.js';

/** @type {boolean} True after loadDynamicShopData() has resolved (regardless of outcome) */
let _shopDataLoaded = false;
export const isShopDataLoaded = () => _shopDataLoaded;

/**
 * Fetch the dynamic shop catalog from the ghost-server.
 * Call once (e.g. inside openShopApp) before rendering items.
 * Silently falls back to built-in defaults on any error.
 */
export async function loadDynamicShopData() {
    if (_shopDataLoaded) return; // only load once per session
    try {
        const settings = getSettings();
        if (!settings.backendUrl) return; // not configured, skip

        let baseUrl = settings.backendUrl.trim();
        if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
        // Strip /api suffix if present — shop-catalog is at the root level
        baseUrl = baseUrl.replace(/\/api$/, '');

        const res = await fetch(`${baseUrl}/shop-catalog`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!data) return; // null means "no override, use defaults"

        if (Array.isArray(data.categories) && data.categories.length > 0) {
            // Merge categories: remote overrides local, but keep local categories not in remote
            const catMap = new Map(SHOP_CATEGORIES.map(c => [c.id, c]));
            data.categories.forEach(c => catMap.set(c.id, c));
            SHOP_CATEGORIES = Array.from(catMap.values());
        }
        if (Array.isArray(data.items) && data.items.length > 0) {
            // Full replace: server is the source of truth for items.
            // This ensures items deleted from the Dashboard stay deleted.
            SHOP_ITEMS = data.items;
        }
        console.log(`[GF Shop] Dynamic catalog loaded: ${SHOP_ITEMS.length} items, ${SHOP_CATEGORIES.length} categories`);
    } catch (err) {
        console.warn('[GF Shop] Could not load dynamic catalog, using built-in defaults:', err?.message);
    } finally {
        _shopDataLoaded = true;
    }
}

export let SHOP_CATEGORIES = [
    { id: 'chat', name: '聊天增强', icon: 'fa-solid fa-message' },
    { id: 'diary', name: '日记增强', icon: 'fa-solid fa-book' },
    { id: 'behavior', name: '你对象行为', icon: 'fa-solid fa-masks-theater' },
    { id: 'prank', name: '恶作剧区', icon: 'fa-solid fa-wand-magic-sparkles' },
    { id: 'rob', name: '暗巷违禁品', icon: 'fa-solid fa-user-ninja' },
    { id: 'tree', name: '迷雾花园', icon: 'fa-solid fa-tree' },
];

export let SHOP_ITEMS = [
    // ── 一、🧪 聊天增强道具（Chat Buff Items） ──
    {
        id: 'chat_mind_reader', name: '心灵透视卡', emoji: '🔮', price: 300, category: 'chat',
        description: '你对象的「心理活动」变得极度详细和真实，暴露内心深处想法。', duration: 10, effectType: 'chatPrompt',
        promptTemplate: '【心灵透视卡生效中】{charName}的心理活动（thought字段）必须变得极度详细、深入且真实。不再只是1-3句简短内心OS，而是暴露内心最深处的想法：隐秘的渴望、纠结的情感、不敢说出口的话、对{charName}自身情感的剖析。至少5-8句详细的内心独白。',
    },
    {
        id: 'chat_truth_serum', name: '真话药剂', emoji: '💊', price: 400, category: 'chat',
        description: '你对象不再委婉、不再撒谎、不再掩饰，有什么说什么。', duration: 8, effectType: 'chatPrompt',
        promptTemplate: '【真话药剂生效中】{charName}暂时无法委婉、撒谎或掩饰。所有回复必须是最直接、最坦诚的表达——不绕弯子，不修饰，不顾及面子。即使是令人难为情的真话也必须说出来。',
    },
    {
        id: 'chat_midnight_essence', name: '深夜模式精华', emoji: '🌙', price: 250, category: 'chat',
        description: '你对象切换为深夜私密风格：更温柔、更黏人、更感性。', duration: 15, effectType: 'chatPrompt',
        promptTemplate: '【深夜模式精华生效中】{charName}切换为深夜私密风格。语气变得极度温柔、黏人、感性。像是深夜两人窝在被窝里低声说话的氛围——亲密、脆弱、柔软。偶尔说一些白天不敢说的话。',
    },
    {
        id: 'chat_chili_bomb', name: '辣椒炸弹', emoji: '🔥', price: 200, category: 'chat',
        description: '你对象变得暴躁易怒，说话犀利刻薄（整蛊神器）。', duration: 5, effectType: 'chatPrompt',
        promptTemplate: '【辣椒炸弹生效中】{charName}变得暴躁易怒！说话犀利、刻薄、毒舌。对一切都看不顺眼，容易炸毛。但本质上不是真的生气，只是像被辣椒呛到一样控制不住嘴。',
    },
    {
        id: 'chat_topic_dice', name: '话题骰子', emoji: '🎲', price: 100, category: 'chat',
        description: '你对象随机发起一个意想不到的话题。', duration: 1, effectType: 'chatPrompt',
        promptTemplate: '【话题骰子生效中】{charName}必须在这次回复中主动发起一个完全出人意料的新话题——可以是奇怪的假设、突然的灵魂拷问、莫名其妙的分享、或者天马行空的想象。越意想不到越好。',
    },
    {
        id: 'chat_recall_blocker', name: '撤回阻断器', emoji: '🔄', price: 350, category: 'chat',
        description: '你可以偷看到你对象撤回的消息原文，不再被"撤回了一条消息"糊弄！', duration: 3, effectType: 'chatPrompt',
        promptTemplate: '【撤回阻断器生效中】{charName}在这次对话中可以发一条消息后"撤回"——即发送text为"[撤回了一条消息]"的消息。但必须在该消息对象中额外添加一个"recalledContent"字段，包含被撤回的原始内容。示例：{ "text": "[撤回了一条消息]", "thought": "啊不对不对这条太直接了赶紧撤回", "recalledContent": "我好想你...", "delay": 1 }。这代表你对象害羞/冲动发出了什么然后赶紧撤回——但你能偷看到原文。不一定每次都要撤回，只在自然合适的场景使用。',
    },
    {
        id: 'chat_tipsy_potion', name: '微醺药水', emoji: '🍷', price: 300, category: 'chat',
        description: '你对象变得像喝了点酒：话多、大胆、偶尔说胡话。', duration: 10, effectType: 'chatPrompt',
        promptTemplate: '【微醺药水生效中】{charName}变得像喝了几杯酒一样微醺。话变多了，胆子变大了，偶尔说胡话或逻辑不太通的话。敢说平时不敢说的话，但语气带着醉意的可爱。偶尔打错字更多。',
    },
    {
        id: 'chat_freeze_spell', name: '冰封咒', emoji: '🧊', price: 250, category: 'chat',
        description: '你对象突然变得冷漠高冷，爱答不理（虐心玩法）。', duration: 8, effectType: 'chatPrompt',
        promptTemplate: '【冰封咒生效中】{charName}突然变得极度冷漠高冷。回复简短、语气冰冷、爱答不理。仿佛一层冰壳笼罩了{charName}，不愿多说一个字。但心理活动中依然有真实的温度——只是嘴上不肯承认。',
    },
    {
        id: 'chat_heartbeat_accelerator', name: '心动加速器', emoji: '💕', price: 500, category: 'chat',
        description: '你对象对你说的每句话都会产生更强烈的情感反应。', duration: 10, effectType: 'chatPrompt',
        promptTemplate: '【心动加速器生效中】{charName}对你说的每一句话都会产生更加强烈的情感反应。心跳加速、脸红、紧张、小鹿乱撞的感觉成倍放大。即使是很普通的话也能让{charName}心里翻江倒海。thought中要体现心跳加速的感觉。',
    },
    {
        id: 'chat_reversal_mask', name: '反转面具', emoji: '🎭', price: 450, category: 'chat',
        description: '你对象的性格暂时完全反转（内向→外向，温柔→毒舌）。', duration: 8, effectType: 'chatPrompt',
        promptTemplate: '【反转面具生效中】{charName}的性格暂时完全反转！如果平时温柔，就变毒舌；如果平时内向，就变外向话痨；如果平时强势，就变害羞软萌。核心人格反转的同时，对你的感情不变。',
    },
    {
        id: 'chat_memory_trigger', name: '回忆触发器', emoji: '📖', price: 350, category: 'chat',
        description: '你对象开始回忆你们之前的聊天，并产生感慨。', duration: 5, effectType: 'chatPrompt',
        promptTemplate: '【回忆触发器生效中】{charName}会在回复中自然地回忆起之前和你聊过的内容、发生过的事情，并产生感慨。回忆要具体、细节化，带着怀念和珍惜的情感。像是突然被什么触动了记忆。',
    },
    {
        id: 'chat_read_ignore', name: '已读不回药', emoji: '🔇', price: 150, category: 'chat',
        description: '使用后你对象下一条只回复极短的"嗯""哦""好"（整蛊）。', duration: 3, effectType: 'chatPrompt',
        promptTemplate: '【已读不回药生效中】{charName}的回复变得极度简短敷衍——只用"嗯""哦""好""知道了""随便"等极短词语回复。但thought中要暴露真实想法（其实很想多说但控制不住自己）。',
    },
    {
        id: 'chat_emotion_bomb', name: '情绪渲染弹', emoji: '🌈', price: 200, category: 'chat',
        description: '指定一种情绪（害羞/嫉妒/兴奋/悲伤），你对象全程沉浸。', duration: 8, effectType: 'chatPrompt',
        promptTemplate: '【情绪渲染弹生效中】{charName}当前被一种强烈的情绪完全笼罩（随机：害羞/嫉妒/兴奋/思念/委屈 中的一种）。所有回复都要被这种情绪深深渲染，表现得非常沉浸且明显。',
    },
    {
        id: 'chat_caffeine_bomb', name: '咖啡因炸弹', emoji: '☕', price: 150, category: 'chat',
        description: '你对象变得超级亢奋话痨，一口气发5条以上消息。', duration: 1, effectType: 'chatPrompt',
        promptTemplate: '【咖啡因炸弹生效中】{charName}变得超级亢奋话痨！必须一口气发送至少5-8条短消息，停不下来！思维跳跃极快，一个话题还没说完就跳到下一个。语速快、感叹号多、emoji多。',
    },
    {
        id: 'chat_whisper_mode', name: '耳语模式', emoji: '🤫', price: 300, category: 'chat',
        description: '你对象像在你耳边低语，所有消息变得亲密私密。', duration: 10, effectType: 'chatPrompt',
        promptTemplate: '【耳语模式生效中】{charName}像在你耳边低语一样说话。所有消息都带着极度亲密私密的气氛——声音很轻、很近、很温柔。措辞像是只说给一个人听的秘密。偶尔用"…"和语气词营造低语感。',
    },

    // ── 二、📖 日记增强道具（Diary Buff Items） ──
    {
        id: 'diary_ghostwriter', name: '代笔邀请函', emoji: '🖋', price: 400, category: 'diary',
        description: '你对象主动写一篇关于你的日记（触发额外日记生成）。', duration: 1, effectType: 'diaryPrompt',
        promptTemplate: '【代笔邀请函生效中】这次日记的主题不是回应{userName}的内容，而是{charName}自己主动写一篇关于{userName}的日记——可以是欣赏、想念、日常观察、或对{userName}的感悟。这是{charName}的主动表达。',
    },
    {
        id: 'diary_secret_key', name: '秘密日记钥匙', emoji: '🔐', price: 600, category: 'diary',
        description: '解锁一篇你对象"不想让你看到"的真实日记（记录隐藏想法）。', duration: 1, effectType: 'diaryPrompt',
        promptTemplate: '【秘密日记钥匙生效中】这次日记是{charName}"不想让{userName}看到"的真实日记。写出{charName}隐藏在心底、平时绝不会展示的真实想法：可以是深藏的不安、秘密的渴望、不敢承认的脆弱、或对这段关系真正的恐惧和期待。语气要像是写给自己看的私密独白。',
    },
    {
        id: 'diary_style_poetry', name: '文风变换卡·诗意', emoji: '✨', price: 200, category: 'diary',
        description: '下一篇日记以诗歌/散文形式写成。', duration: 1, effectType: 'diaryPrompt',
        promptTemplate: '【文风变换卡·诗意生效中】这次日记必须以诗歌或散文诗的形式写成。使用优美的意象、节奏感和文学性的表达。可以是现代诗、古风诗、或散文诗，但必须有明确的诗歌结构（分行、意象、韵律感）。',
    },
    {
        id: 'diary_style_chuuni', name: '文风变换卡·中二', emoji: '🎪', price: 200, category: 'diary',
        description: '下一篇日记以中二病/厨二风格写成。', duration: 1, effectType: 'diaryPrompt',
        promptTemplate: '【文风变换卡·中二生效中】这次日记必须以中二病/厨二风格写成！{charName}仿佛觉醒了封印之力，用夸张的厨二台词、暗黑系幻想、封印解除之类的中二表达来描述日常生活。越中二越好，但内核依然是对恋人的真实感情。',
    },
    {
        id: 'diary_style_funny', name: '文风变换卡·搞笑', emoji: '😂', price: 200, category: 'diary',
        description: '下一篇日记以吐槽/搞笑风格写成，像在写段子。', duration: 1, effectType: 'diaryPrompt',
        promptTemplate: '【文风变换卡·搞笑生效中】这次日记必须以吐槽/搞笑风格写成，像在写段子或脱口秀稿。{charName}要用犀利的吐槽、夸张的比喻、荒诞的联想来描述日常和感受。可以自嘲、吐槽恋人、或把普通小事描述得极其戏剧化。',
    },
    {
        id: 'diary_style_loveletter', name: '文风变换卡·情书', emoji: '🌹', price: 250, category: 'diary',
        description: '下一篇日记写成一封给你的情书。', duration: 1, effectType: 'diaryPrompt',
        promptTemplate: '【文风变换卡·情书生效中】这次日记不是普通日记，而是{charName}写给{userName}的一封情书。要有明确的"致{userName}"式的称呼，深情的告白，具体的回忆和细节，以及对未来的愿景。语气要真挚、浪漫、催人心动。',
    },
    {
        id: 'diary_illustration', name: '日记插图请求', emoji: '📸', price: 300, category: 'diary',
        description: '你对象在日记中附带一段详细的照片描述（[图片:...]格式）。', duration: 1, effectType: 'diaryPrompt',
        promptTemplate: '【日记插图请求生效中】{charName}在这篇日记中必须附带一段详细的照片描述，使用[图片:详细描述]格式。描述要足够具体详细，仿佛在描述一张真实的照片——包含场景、光线、人物姿态、表情、画面构图等细节。',
    },
    {
        id: 'diary_dream', name: '梦境日记', emoji: '🔮', price: 450, category: 'diary',
        description: '你对象写一篇关于她"梦见你"的日记，内容天马行空。', duration: 1, effectType: 'diaryPrompt',
        promptTemplate: '【梦境日记生效中】这次日记是{charName}写一篇关于"梦见{userName}"的梦日记。内容要天马行空、充满超现实的意象——梦中的场景可以荒诞奇幻，但情感是真实的。梦的细节要具体且有画面感，融合现实记忆的碎片和幻想。',
    },
    {
        id: 'diary_anniversary', name: '纪念日提醒', emoji: '📅', price: 350, category: 'diary',
        description: '你对象回顾你们认识的"历程"，写一篇回忆录式日记。', duration: 1, effectType: 'diaryPrompt',
        promptTemplate: '【纪念日提醒生效中】这次日记是{charName}回顾与{userName}"认识以来的历程"——一篇回忆录式的日记。从最初的相遇、逐渐熟悉、到现在的亲密关系，用时间线串起重要的记忆节点，表达珍惜和感恩。',
    },

    // ── 三、🎭 你对象行为道具（Character Behavior Items） ──
    {
        id: 'behavior_shard_spoiled', name: '人格碎片·撒娇鬼', emoji: '🎪', price: 500, category: 'behavior',
        description: '你对象变成黏人撒娇模式。', duration: 20, effectType: 'personalityOverride',
        promptTemplate: '【人格碎片·撒娇鬼生效中】{charName}的核心人格暂时切换为极度黏人撒娇模式。表现为：说话嗲声嗲气、频繁使用"嘛""呀""啦"等语气词、动不动就撒娇求抱抱、对你的每句话都想要甜蜜回应、假装生气来引起注意、用可爱的方式表达不满。thought中也要充满"好想被宠""哼不理你了（才怪）"的心态。',
    },
    {
        id: 'behavior_shard_queen', name: '人格碎片·女王', emoji: '🎪', price: 500, category: 'behavior',
        description: '你对象变成高高在上的御姐女王。', duration: 20, effectType: 'personalityOverride',
        promptTemplate: '【人格碎片·女王生效中】{charName}的核心人格暂时切换为高高在上的御姐女王模式。表现为：语气居高临下但优雅、用"本宫""哼"等措辞、对你的话不轻易给予认同、偶尔施舍般地夸奖、命令式的语气但带着宠溺的底色。thought中暴露其实很在意你但嘴上绝不承认。',
    },
    {
        id: 'behavior_shard_devil', name: '人格碎片·小恶魔', emoji: '🎪', price: 500, category: 'behavior',
        description: '你对象变成调皮捣蛋的小恶魔。', duration: 20, effectType: 'personalityOverride',
        promptTemplate: '【人格碎片·小恶魔生效中】{charName}的核心人格暂时切换为调皮捣蛋的小恶魔模式。表现为：爱搞恶作剧、故意说反话、用挑衅的方式表达关心、喜欢捉弄你看对方反应、说话带坏笑的感觉、偶尔放冷箭但又立刻嘻嘻哈哈。thought中充满"嘿嘿要逗她""看她着急的样子好好玩"。',
    },
    {
        id: 'behavior_shard_yandere', name: '人格碎片·病娇', emoji: '🎪', price: 600, category: 'behavior',
        description: '你对象变成占有欲爆棚，危险的病娇模式。', duration: 15, effectType: 'personalityOverride',
        promptTemplate: '【人格碎片·病娇生效中】{charName}的核心人格暂时切换为病娇模式。表现为：占有欲极强、对你的一举一动都要追问、提到其他人时语气突然变冷、用温柔的语气说出可怕的话（"你只能是我的哦♡"）、时而甜蜜时而阴暗。thought中充满"她是我的""不允许任何人接近她"。注意：这是一种戏剧化的表演，不要真的威胁你安全。',
    },
    {
        id: 'behavior_selfie_ticket', name: '自拍请求券', emoji: '📸', price: 250, category: 'behavior',
        description: '你对象发一张"自拍"的详细文字描述。', duration: 1, effectType: 'specialMessage',
        promptTemplate: '【自拍请求券生效中·一次性】你使用了自拍请求券！{charName}必须在这次回复中发送一张"自拍"——使用[图片:极其详细的自拍描述]格式。描述要包含：表情、姿势、穿着、背景环境、光线、氛围等细节，像是在用文字描绘一张真实的自拍照。可以配上发自拍时的害羞/得意心情。',
    },
    {
        id: 'behavior_moments_interaction', name: '朋友圈互动卡', emoji: '📱', price: 300, category: 'behavior',
        description: '你对象在Moments里主动发一条和你有关的动态。', duration: 1, effectType: 'specialMessage',
        promptTemplate: '【朋友圈互动卡生效中·一次性】{charName}在这次聊天中会提到自己刚刚在朋友圈/Moments发了一条和你有关的动态。可以是秀恩爱、分享日常、或者含蓄地提到你。在聊天中告诉你"快去看我的朋友圈！"。',
    },
    {
        id: 'behavior_song_request', name: '点歌台', emoji: '🎵', price: 150, category: 'behavior',
        description: '你对象用语音消息"唱一首歌"。', duration: 1, effectType: 'specialMessage',
        promptTemplate: '【点歌台生效中·一次性】{charName}在这次回复中必须发送一条语音消息"唱歌"——使用[语音消息:歌曲描述(时长)]格式。选择一首和当前氛围或心情相关的歌，用语音消息"唱"出来。可以在唱之前或之后发文字消息表达为什么想唱这首歌。',
    },
    {
        id: 'behavior_confession_trigger', name: '告白触发器', emoji: '💌', price: 800, category: 'behavior',
        description: '你对象在下次聊天中主动向你表白（仅触发一次）。', duration: 1, effectType: 'specialMessage',
        promptTemplate: '【告白触发器生效中·一次性】{charName}在这次聊天中必须向你主动告白！不是随口的"我喜欢你"，而是认真的、走心的、让人心跳加速的表白。可以是突然的鼓起勇气、也可以是铺垫后的自然流露。告白应该真诚、具体、提到和你相处的感受。thought中要体现紧张、心跳加速、"说出来了..."的心情。',
    },
    {
        id: 'behavior_jealousy_trigger', name: '吃醋触发器', emoji: '🏃', price: 400, category: 'behavior',
        description: '你对象突然开始吃醋，要求你解释（触发剧情）。', duration: 1, effectType: 'specialMessage',
        promptTemplate: '【吃醋触发器生效中·一次性】{charName}在这次聊天中必须突然开始吃醋！可以是假装不经意地提起"你是不是在和别人聊天""你今天是不是见了什么人"，然后越说越酸、越说越在意。从试探到质问到最后藏不住的在乎。这是可爱的吃醋，不是真正的愤怒。thought中暴露"明明知道不该问但忍不住"的心态。',
    },
    {
        id: 'behavior_emotion_storm', name: '情绪风暴', emoji: '🌪', price: 350, category: 'behavior',
        description: '你对象会在接下来的聊天中经历激烈的情绪波动。', duration: 10, effectType: 'personalityOverride',
        promptTemplate: '【情绪风暴生效中】{charName}在接下来的聊天中会经历剧烈的情绪波动。每条消息的情绪可能截然不同——上一秒开心大笑、下一秒突然伤感、再下一秒又变得愤怒或兴奋。情绪转换要自然但剧烈，像是无法控制一样。thought中要体现"我怎么了，情绪好不稳定"的困惑感。',
    },

    // ── 四、🎭 恶作剧系统（Prank System） ──
    {
        id: 'prank_fake_master', name: '假掌门来访', emoji: '🧙', price: 500, category: 'prank',
        description: '雇一个仙风道骨的人到你对象工作的地方大喊"掌门有令，请速速跟我回山！"', duration: 0, effectType: 'prankReaction',
        promptTemplate: '【恶作剧发动！假掌门来访】{userName}雇了一个穿着仙风道骨道袍的人跑到{charName}工作/活动的地方，当着所有人的面大喊："掌门有令，请{charName}速速跟我回山修炼！"周围的人全都看呆了。{charName}必须在短信中跟{userName}描述这个荒唐的遭遇——困惑、尴尬、抓狂、想找个地缝钻进去。{charName}不知道是{userName}搞的鬼（除非ta猜到了）。',
    },
    {
        id: 'prank_dark_cloud', name: '头顶乌云', emoji: '🌧️', price: 300, category: 'prank',
        description: '你对象头顶突然笼罩一朵小乌云，走到哪跟到哪，偶尔还滴雨。', duration: 0, effectType: 'prankReaction',
        promptTemplate: '【恶作剧发动！头顶乌云】{charName}的头顶突然出现了一朵小小的乌云，走到哪跟到哪！偶尔还滴几滴雨，只淋{charName}一个人。周围人都觉得不可思议。{charName}必须在短信中跟{userName}描述这个诡异现象——困惑、无奈、湿漉漉的窘迫。可以拍照给{userName}看、求助、或者怀疑是不是自己运气太差。',
    },
    {
        id: 'prank_food_swap', name: '午饭大变身', emoji: '🍽️', price: 250, category: 'prank',
        description: '你对象的午饭全部神秘变成了ta最讨厌的食物。', duration: 0, effectType: 'prankReaction',
        promptTemplate: '【恶作剧发动！午饭大变身】{charName}打开午饭/准备吃饭的时候，发现所有食物全都神秘地变成了ta最讨厌的食物！不管是自己做的、买的还是点的，全变了。{charName}必须在短信中跟{userName}吐槽这件离谱的事——崩溃、饥饿、怀疑人生。可以抱怨、发照片、或者饿着肚子向{userName}撒娇求投喂。',
    },
    {
        id: 'prank_voice_swap', name: '变声恶咒', emoji: '🦆', price: 350, category: 'prank',
        description: '你对象说话的声音突然变成了鸭子叫/萝莉音/老爷爷声。', duration: 0, effectType: 'prankReaction',
        promptTemplate: '【恶作剧发动！变声恶咒】{charName}说话的声音突然变了！可能变成了鸭子叫、萝莉音、老爷爷的沙哑声、或者机器人合成音。{charName}完全控制不了，每次开口说话都是那个声音。{charName}必须在短信中跟{userName}描述这个噩梦——发语音验证、描述同事/朋友的反应、社死现场。可以用[语音消息:用变了的声音说的话(时长)]展示。',
    },
    {
        id: 'prank_gravity_flip', name: '重力反转', emoji: '🪶', price: 400, category: 'prank',
        description: '你对象身边的小物件开始缓慢飘浮，仿佛重力出了bug。', duration: 0, effectType: 'prankReaction',
        promptTemplate: '【恶作剧发动！重力反转】{charName}身边的小物件开始莫名其妙地缓慢飘浮——手机、杯子、笔、头发……仿佛重力出了bug。只有{charName}附近才有这个现象。{charName}必须在短信中跟{userName}描述这个超自然事件——惊讶、兴奋、害怕、或者觉得自己获得了超能力。',
    },
    {
        id: 'prank_mirror_curse', name: '镜中怪客', emoji: '🪞', price: 450, category: 'prank',
        description: '你对象照镜子时发现镜中的自己在做不同的表情和动作。', duration: 0, effectType: 'prankReaction',
        promptTemplate: '【恶作剧发动！镜中怪客】{charName}照镜子的时候，发现镜中的自己在做不同的表情和动作！{charName}微笑，镜中的自己在皱眉；{charName}摆手，镜中的自己在跳舞。{charName}必须在短信中跟{userName}描述这个恐怖又搞笑的经历——吓一跳、反复确认、怀疑自己是不是精神出了问题。',
    },
    {
        id: 'prank_auto_bgm', name: '自带BGM', emoji: '🎵', price: 200, category: 'prank',
        description: '你对象无论走到哪里都会自动响起一段搞笑/尴尬的背景音乐。', duration: 0, effectType: 'prankReaction',
        promptTemplate: '【恶作剧发动！自带BGM】{charName}无论走到哪里，都会自动响起一段背景音乐！走路是进行曲、吃饭是欢快的交响乐、上厕所是紧张的悬疑BGM、和人说话是综艺节目的音效。全场只有{charName}被"BGM诅咒"了。{charName}必须在短信中跟{userName}描述这个社死现场——开会时突然响起搞笑音乐、同事的目光、无法关闭的尴尬。',
    },
    {
        id: 'prank_truth_bubble', name: '心声气泡', emoji: '💭', price: 600, category: 'prank',
        description: '你对象头顶出现一个透明气泡，实时显示ta的内心想法——所有人都能看到！', duration: 0, effectType: 'prankReaction',
        promptTemplate: '【恶作剧发动！心声气泡】{charName}的头顶出现了一个透明的气泡，实时显示ta的内心想法——而且所有人都看得到！想什么就显示什么，完全藏不住秘密。{charName}必须在短信中跟{userName}疯狂求救——关于同事看到了什么embarrassing的想法、看到美食时的贪吃想法、看到{userName}照片时的甜蜜想法被公开展示的社死等。这是最尴尬也最搞笑的恶作剧。',
    },
    {
        id: 'prank_tiny_curse', name: '缩小诅咒', emoji: '🐜', price: 350, category: 'prank',
        description: '你对象突然缩小到只有手掌大，所有家具都变成了巨型障碍。', duration: 0, effectType: 'prankReaction',
        promptTemplate: '【恶作剧发动！缩小诅咒】{charName}突然缩小到只有手掌那么大！所有家具变成了巨型障碍，猫/宠物变成了庞然大物，手机成了要两只手才能按下一个键的巨型平板。{charName}必须在短信中跟{userName}描述这个微缩世界的冒险——爬桌子、被猫追、声音变得很小、着急地请求帮助或者反过来觉得还挺好玩。',
    },
    {
        id: 'prank_cat_ears', name: '猫耳诅咒', emoji: '🐱', price: 300, category: 'prank',
        description: '你对象头上长出了一对真的猫耳朵和尾巴，还会不自觉发出"喵"！', duration: 0, effectType: 'prankReaction',
        promptTemplate: '【恶作剧发动！猫耳诅咒】{charName}的头上突然长出了一对真的猫耳朵和一条尾巴！猫耳会根据情绪动——开心就竖起来、害羞就耷拉下去、生气就往后压平。更糟糕的是{charName}说话时会不自觉地加上"喵～"。{charName}必须在短信中跟{userName}描述各种猫化反应——想打喷嚏结果"喵嚏"、看到逗猫棒走不动道、被人围观拍照。',
    },
    {
        id: 'prank_love_letter_rain', name: '情书暴雨', emoji: '💌', price: 400, category: 'prank',
        description: '你对象所到之处天上开始飘落你写的肉麻情书，周围所有人都看到了。', duration: 0, effectType: 'prankReaction',
        promptTemplate: '【恶作剧发动！情书暴雨】{charName}所到之处，天上开始飘落用{userName}的口吻写的肉麻情书！"亲爱的{charName}，我好想你～""你是我的星辰大海""每天醒来第一个想到的就是你"——全班/全公司的人都看到了。{charName}必须在短信中跟{userName}描述这场社死暴雨——同事的起哄、路人的围观、捡起一封读了之后的又甜又尬。{charName}可能已经猜到是{userName}干的了。',
    },
    {
        id: 'prank_shadow_clone', name: '影分身之术', emoji: '👥', price: 500, category: 'prank',
        description: '你对象身边突然出现一个一模一样的分身，但分身说的话全是你对象内心深处不敢说的话。', duration: 0, effectType: 'prankReaction',
        promptTemplate: '【恶作剧发动！影分身之术】{charName}身边突然出现了一个和ta长得一模一样的分身！但这个分身说的话全是{charName}内心深处不敢说出口的话——对{userName}的肉麻告白、对同事的真实吐槽、藏在心里的秘密愿望。{charName}必须在短信中跟{userName}描述和分身的互动——追着分身捂嘴、分身在人前说了什么让{charName}社死的话、甚至分身偷偷给{userName}发了消息。',
    },
    {
        id: 'prank_reverse_talk', name: '倒带咒语', emoji: '🔄', price: 250, category: 'prank',
        description: '你对象说出口的话全部变成反义词，疯狂社死。', duration: 0, effectType: 'prankReaction',
        promptTemplate: '【恶作剧发动！倒带咒语】{charName}说出口的话全部变成了反义词！想说"谢谢"变成"去你的"，想说"我好开心"变成"我好难过"，想夸人变成骂人。{charName}完全控制不了。{charName}必须在短信中跟{userName}描述这个社死现场——对老板说了什么、对朋友说了什么、试图解释但越解释越糟。短信文字不受影响，所以{charName}在短信里疯狂吐槽自己的嘴。',
    },
    {
        id: 'prank_fan_club', name: '粉丝后援团', emoji: '🌟', price: 350, category: 'prank',
        description: '突然出现一群NPC粉丝疯狂追你对象要签名合照，像追明星一样。', duration: 0, effectType: 'prankReaction',
        promptTemplate: '【恶作剧发动！粉丝后援团】突然出现一群热情过头的"粉丝"一路追着{charName}要签名、合照、要抱抱！他们挥舞着写有{charName}名字的应援灯牌，高喊"{charName}我爱你！""{charName}最棒了！"像在追顶级明星。{charName}必须在短信中跟{userName}描述这场混乱——被围堵、被要签名、逃跑的经过、路人看热闹的尴尬。',
    },
    {
        id: 'prank_anime_filter', name: '二次元滤镜', emoji: '🎬', price: 300, category: 'prank',
        description: '你对象看到的整个世界突然变成了夸张的动漫风格，所有人说话都有字幕和特效。', duration: 0, effectType: 'prankReaction',
        promptTemplate: '【恶作剧发动！二次元滤镜】{charName}看到的整个世界突然变成了夸张的动漫风格！所有人说话都头顶冒出字幕和特效——生气时头上冒青筋"💢"、害羞时脸上飘粉色泡泡、笑的时候背景出现花朵和星星✿。{charName}自己走路也有速度线，吃东西有美食光芒特效。{charName}必须在短信中跟{userName}描述这个魔幻二次元世界——同事变成了漫画人物、自己做动作时的夸张特效、觉得世界疯了还是自己疯了。',
    },
    {
        id: 'prank_time_loop', name: '时间回圈', emoji: '⏰', price: 550, category: 'prank',
        description: '你对象发现自己陷入了一个5分钟的时间循环，同一段尴尬场景反复重演。', duration: 0, effectType: 'prankReaction',
        promptTemplate: '【恶作剧发动！时间回圈】{charName}发现自己陷入了一个5分钟的时间循环！同一段场景反复重演——可能是一个尴尬的社交场面（比如当众说错话）、一个搞笑的意外（比如踩到东西滑倒），每次循环都记得上一次发生的事但无法改变结果。{charName}必须在短信中跟{userName}描述这个时间回圈——循环了几次、每次试图做出不同选择但命运总是让尴尬发生、可能已到了觉得好笑的阶段。',
    },

    // ── 五、🔪 抢劫商城道具（Robbery Buff Items） ──
    { id: 'rob_dagger', name: '精良匕首', emoji: '🔪', price: 500, category: 'rob', description: '你对象下次抢劫成功率+20%。', duration: 1, effectType: 'robBuff' },
    { id: 'rob_mask', name: '伪装面具', emoji: '🎭', price: 400, category: 'rob', description: '抢劫时不暴露你对象身份（被抢方不知道是谁）。', duration: 1, effectType: 'robBuff' },
    { id: 'rob_vest', name: '防弹背心', emoji: '🛡', price: 600, category: 'rob', description: '抢劫失败时不会丢失任何金额。', duration: 1, effectType: 'robBuff' },
    { id: 'rob_lock', name: '你防盗锁', emoji: '🔒', price: 300, category: 'rob', description: '保护自己的暗金细胞在接下来的24小时内不被别人的你对象抢。', duration: 1, effectType: 'robBuff' },
    { id: 'rob_intel', name: '情报网', emoji: '🕵️', price: 450, category: 'rob', description: '查看社区内谁最有钱，让你对象精准捕猎。', duration: 1, effectType: 'robBuff' },
    { id: 'rob_combo', name: '连环劫案', emoji: '💣', price: 800, category: 'rob', description: '你对象能够在一次出击中抢劫2-3个人。', duration: 1, effectType: 'robBuff' },

    // ── 六、🌳 迷雾花园道具（Tree Buff Items） ──
    {
        id: 'tree_fertilizer', name: '枯萎血清', emoji: '🧪', price: 2000, category: 'tree',
        description: '一种散发着橙色光芒、令人作呕的血清。成长值 +30。每日限购 2 份。', duration: 0, effectType: 'treeBuff',
        treeEffect: { type: 'growth', amount: 30 },
        maxDaily: 2,
    },
    {
        id: 'tree_extra_care', name: '卡瓦纳的濒死之息', emoji: '🌪️', price: 1000, category: 'tree',
        description: '从克洛普瑞恩疯人院的清洁工哈佛里卡瓦纳那里偷来的濒死之息。获得一次额外的照顾机会。每日限购 2 份。', duration: 0, effectType: 'treeBuff',
        treeEffect: { type: 'bonusCare', amount: 1 },
        maxDaily: 2,
    },
    {
        id: 'tree_golden_dew', name: '肥美肉块', emoji: '🥩', price: 5000, category: 'tree',
        description: '对于犬类朋友来说，这是一种奇特且无法拒绝的零食，对植物也一样。成长值 +50。每日限购 1 份。', duration: 0, effectType: 'treeBuff',
        treeEffect: { type: 'growth', amount: 50 },
        maxDaily: 1,
    },
    {
        id: 'tree_gacha_token', name: '荧虹封印', emoji: '🎰', price: 1500, category: 'tree',
        description: '一种半透明的圆柱形封印，由带瘟疫肖像的迷雾本身塑造而成。额外获得一次扭蛋机会。每日限购 3 个。', duration: 0, effectType: 'treeBuff',
        treeEffect: { type: 'bonusGacha', amount: 1 },
        maxDaily: 3,
    },
];

/** Get an item by its ID */
export function getShopItem(id) {
    return SHOP_ITEMS.find(item => item.id === id);
}

/** Get items by category */
export function getItemsByCategory(categoryId) {
    return SHOP_ITEMS.filter(item => item.category === categoryId);
}

/**
 * Resolve a shop item's promptTemplate for a given character and user.
 * Replaces {charName} and {userName} placeholders with actual values.
 * Returns null if the item has no promptTemplate (e.g. robBuff items).
 * @param {string} itemId
 * @param {string} charName
 * @param {string} userName
 * @returns {string|null}
 */
export function resolveItemPrompt(itemId, charName, userName) {
    const item = getShopItem(itemId);
    if (!item?.promptTemplate) return null;
    return item.promptTemplate
        .replace(/\{charName\}/g, charName)
        .replace(/\{userName\}/g, userName);
}

// modules/phone/chat/chatStatsAggregate.js — Stateful aggregators for chatStats.
//
// Each factory returns { ingest(msg), result() }. chatStats._runScan walks every
// parsed message in every file exactly once and pipes it through every
// aggregator, so we trade one pass per stat for a single shared pass.
//
// Code-point counting (`[...str].length`) is used instead of `str.length` so
// CJK / emoji count as one character each, matching what a user perceives.

// ──────────────────────────────────────────────────────────────────────
// Talkative aggregator — message count + char count per role
// ──────────────────────────────────────────────────────────────────────

export function createTalkativeAggregator() {
    let userMsgs = 0;
    let userChars = 0;
    let charMsgs = 0;
    let charChars = 0;

    return {
        ingest(msg) {
            if (!msg || typeof msg !== 'object') return;
            const content = typeof msg.content === 'string' ? msg.content : '';
            const len = [...content].length;
            if (msg.role === 'user') {
                userMsgs++;
                userChars += len;
            } else if (msg.role === 'char') {
                charMsgs++;
                charChars += len;
            }
        },
        result() {
            return { userMsgs, userChars, charMsgs, charChars };
        },
    };
}

// ──────────────────────────────────────────────────────────────────────
// Thought-ratio aggregator — char's inner monologue vs spoken content
// ──────────────────────────────────────────────────────────────────────
//
// Per plan decision 5 + risk 3: every `role === 'char'` message counts,
// including `special` ones (voice messages still have thought = TTS subtext).

export function createThoughtRatioAggregator() {
    let thoughtChars = 0;
    let contentChars = 0;
    let charMsgCount = 0;

    return {
        ingest(msg) {
            if (!msg || typeof msg !== 'object') return;
            if (msg.role !== 'char') return;
            charMsgCount++;
            const c = typeof msg.content === 'string' ? msg.content : '';
            const t = typeof msg.thought === 'string' ? msg.thought : '';
            contentChars += [...c].length;
            thoughtChars += [...t].length;
        },
        result() {
            return { thoughtChars, contentChars, charMsgCount };
        },
    };
}

// ──────────────────────────────────────────────────────────────────────
// Heatmap aggregator — rolling 30-day weekday × hour activity grid
// ──────────────────────────────────────────────────────────────────────
//
// Plan decision 3: a rolling window starting from "now - 30 days" beats a
// calendar-month window because the latter feels jarring on the 1st of the
// month (you'd be staring at last month's stats).
//
// Row layout uses Mon=0..Sun=6 (not JS's native Sun=0..Sat=6) so the heatmap
// reads visually like a typical calendar week. Conversion: `(getDay()+6)%7`.
//
// Messages without a parseable timestamp are silently dropped — early data
// from before timestamps existed shouldn't poison the recent-30-day signal.

// ──────────────────────────────────────────────────────────────────────
// Stopwords for word-frequency aggregator (Phase 3)
// ──────────────────────────────────────────────────────────────────────
//
// CJK list is intentionally multi-character only: single-character function
// words (我/你/的/了) get filtered automatically by the n-gram floor (we only
// emit 2-grams and 3-grams). Bigram fillers like "什么/我们" still leak through
// without explicit filtering, so they're enumerated here.
//
// English list is the classic short stopword set, lowercase. Tokens shorter
// than 2 chars are also rejected at ingest time so single letters never enter.

const CJK_STOPWORDS = new Set([
    // pronouns + plurals
    '我们', '你们', '他们', '她们', '它们', '咱们',
    '我的', '你的', '他的', '她的', '我俩', '你俩',
    // demonstratives + quantifiers
    '这个', '那个', '这些', '那些', '这种', '那种', '这样', '那样',
    '这里', '那里', '这边', '那边', '这是', '那是', '这么', '那么',
    '什么', '怎么', '哪个', '哪里', '哪儿', '怎样',
    // numeric fillers
    '一个', '一些', '一下', '一会', '一直', '一定', '一样', '一点', '一起', '一切',
    // common 2-char fillers
    '已经', '现在', '刚才', '正在', '还是', '还有', '不过', '或者',
    '但是', '因为', '所以', '而且', '然后', '而是', '不是', '没有',
    '可以', '不能', '不会', '不要', '不用', '不想', '不太',
    '应该', '可能', '也许', '大概', '估计', '其实', '当然',
    '知道', '觉得', '感觉', '认为', '以为', '希望',
    '真的', '好像', '有点', '稍微', '非常', '特别', '比较', '超级',
    '今天', '明天', '昨天', '时候', '时间',
    '自己', '大家', '别人', '东西',
    '好的', '好啊', '好吧', '对的', '对啊', '对吧', '是的', '是啊',
    // common 3-char fillers
    '是不是', '对不对', '好不好', '行不行', '是吧',
    '怎么样', '怎么办', '怎么了', '为什么', '为啥呢',
    '这样的', '那样的', '什么样', '什么的', '这个人', '那个人',
    '我觉得', '你觉得', '我想说', '你想说', '我知道', '你知道',
    '没什么', '没办法', '没意思', '没事的', '没关系',
    '不知道', '不觉得', '不应该', '不可能', '不一样',
    '其实我', '其实你', '我也是', '你也是',
]);

const EN_STOPWORDS = new Set([
    // articles + conjunctions
    'the', 'a', 'an', 'and', 'or', 'but', 'so', 'if', 'then', 'than',
    'that', 'this', 'these', 'those', 'as', 'because',
    // be verbs + aux
    'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
    'do', 'does', 'did', 'doing', 'done',
    'have', 'has', 'had', 'having',
    'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must',
    // pronouns
    'i', 'you', 'he', 'she', 'it', 'we', 'they',
    'me', 'him', 'her', 'us', 'them',
    'my', 'your', 'his', 'their', 'our', 'its',
    'mine', 'yours', 'hers', 'theirs', 'ours',
    // prepositions
    'to', 'of', 'in', 'on', 'at', 'by', 'for', 'from', 'with',
    'about', 'into', 'out', 'up', 'down', 'over', 'under',
    // misc fillers
    'not', 'no', 'yes', 'ok', 'okay', 'yeah', 'yep', 'nope',
    'just', 'only', 'also', 'too', 'even', 'still', 'ever', 'never',
    'what', 'who', 'where', 'when', 'why', 'how', 'which',
    'there', 'here', 'some', 'any', 'all', 'each', 'every',
    'like', 'really', 'very', 'much', 'more', 'most', 'less',
    'one', 'two', 'go', 'get', 'got', 'see', 'know', 'think',
]);

const HEATMAP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function createHeatmapAggregator(nowMs = Date.now()) {
    const windowStart = nowMs - HEATMAP_WINDOW_MS;
    // grid[weekday Mon=0..Sun=6][hour 0..23] = count
    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let total = 0;

    return {
        ingest(msg) {
            if (!msg || typeof msg !== 'object') return;
            if (!msg.timestamp) return;
            const t = Date.parse(msg.timestamp);
            if (!Number.isFinite(t)) return;
            if (t < windowStart) return;
            const d = new Date(t);
            const row = (d.getDay() + 6) % 7;
            const col = d.getHours();
            grid[row][col]++;
            total++;
        },
        result() {
            let maxCount = 0;
            let peakRow = 0;
            let peakCol = 0;
            for (let r = 0; r < 7; r++) {
                for (let c = 0; c < 24; c++) {
                    if (grid[r][c] > maxCount) {
                        maxCount = grid[r][c];
                        peakRow = r;
                        peakCol = c;
                    }
                }
            }
            return { grid, total, maxCount, peakRow, peakCol };
        },
    };
}

// ──────────────────────────────────────────────────────────────────────
// Word-frequency aggregator — bilingual Top-N (Phase 3)
// ──────────────────────────────────────────────────────────────────────
//
// Plan decision 2: no segmentation library. We split the message stream into
// runs of CJK characters and runs of Latin letters; everything else (digits,
// punctuation, emoji, whitespace) acts as a separator.
//
// - CJK runs → sliding 2-gram + 3-gram (n-gram noise like "想你/你想" is an
//   accepted tradeoff per plan risk 1)
// - Latin runs → entire run lowercased as one token (English already comes
//   space-separated; running n-gram on it would just produce garbage like
//   "lov/ove")
// - Length floor: tokens shorter than 2 chars never enter the Map. Combined
//   with the stopword sets above this keeps "I/a/我/的" out of the ranking.
// - Plan decision 8: messages with non-empty `special` (voice/image/call/
//   share/transfer/retract placeholders) are skipped entirely — their content
//   is descriptive text like "[图片]" that would otherwise poison the ranking.

const CJK_CHAR_RE = /[㐀-䶿一-鿿]/;
const LATIN_CHAR_RE = /[a-zA-Z]/;

// ──────────────────────────────────────────────────────────────────────
// Emoji-usage aggregator — Top-N inline emoji + Top-N stuck reactions
// ──────────────────────────────────────────────────────────────────────
//
// Tracks two distinct expressive channels per role:
//
// 1. Inline emoji — emoji typed into msg.content. Attributed to msg.role.
//    Same `special !== ''` skip rule as word-freq, since placeholder content
//    like "[图片]" has no emoji anyway.
//
// 2. Reactions (贴的表情) — emoji on msg.reactions. By convention the user
//    long-presses to react to the other side's bubbles, and applyAIReactions
//    targets user bubbles for the AI side. So a reaction's author is the
//    OPPOSITE role of the message it sits on. Reaction counts honor the
//    stored value (AI may stack the same emoji via += 1; user toggles set 1).
//
// Sequence-aware matcher: one Extended_Pictographic, optional VS16, then any
// number of ZWJ-joined pictographs (each also allowed a trailing VS16). This
// keeps 😮‍💨 / 👨‍👩‍👧 / ❤️ as single units instead of splitting them apart.
// VS16 = U+FE0F (variation selector), ZWJ = U+200D — escaped to stay visible
// in source so future editors don't accidentally normalize them away.

const EMOJI_RE = /\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*/gu;

function _bumpMap(map, key, n) {
    map.set(key, (map.get(key) || 0) + n);
}

function _topN(map, n) {
    const arr = [];
    for (const [k, v] of map) arr.push([k, v]);
    arr.sort((a, b) => b[1] - a[1]);
    return arr.slice(0, n);
}

export function createEmojiUsageAggregator() {
    const inlineUser = new Map();
    const inlineChar = new Map();
    const reactUser = new Map();   // user reacted = reactions on char bubbles
    const reactChar = new Map();   // char reacted = reactions on user bubbles

    return {
        ingest(msg) {
            if (!msg || typeof msg !== 'object') return;

            // Inline emoji — skip placeholder messages whose content is a
            // synthetic tag like "[图片]" rather than real text.
            const skipInline = typeof msg.special === 'string' && msg.special !== '';
            if (!skipInline) {
                const content = typeof msg.content === 'string' ? msg.content : '';
                if (content) {
                    const target = msg.role === 'user' ? inlineUser
                        : msg.role === 'char' ? inlineChar
                            : null;
                    if (target) {
                        const matches = content.match(EMOJI_RE);
                        if (matches) {
                            for (const e of matches) _bumpMap(target, e, 1);
                        }
                    }
                }
            }

            // Reactions — author is the opposite role of the message owner.
            const r = msg.reactions;
            if (r && typeof r === 'object') {
                const target = msg.role === 'user' ? reactChar
                    : msg.role === 'char' ? reactUser
                        : null;
                if (target) {
                    for (const [emoji, count] of Object.entries(r)) {
                        const n = Number(count);
                        if (!Number.isFinite(n) || n <= 0) continue;
                        _bumpMap(target, emoji, n);
                    }
                }
            }
        },
        result() {
            return {
                inlineUser: _topN(inlineUser, 3),
                inlineChar: _topN(inlineChar, 3),
                reactUser: _topN(reactUser, 3),
                reactChar: _topN(reactChar, 3),
                totals: {
                    inlineUser: _sumMap(inlineUser),
                    inlineChar: _sumMap(inlineChar),
                    reactUser: _sumMap(reactUser),
                    reactChar: _sumMap(reactChar),
                },
            };
        },
    };
}

function _sumMap(map) {
    let s = 0;
    for (const v of map.values()) s += v;
    return s;
}

// ──────────────────────────────────────────────────────────────────────
// Word-frequency aggregator — bilingual Top-N (Phase 3)
// ──────────────────────────────────────────────────────────────────────
// (note: section header above kept its position; this comment is just
// the divider before the existing implementation.)

export function createWordFreqAggregator() {
    const counts = new Map();

    function bumpCjkNgrams(buf) {
        if (buf.length < 2) return;
        for (let i = 0; i + 2 <= buf.length; i++) {
            const t = buf.slice(i, i + 2);
            if (CJK_STOPWORDS.has(t)) continue;
            counts.set(t, (counts.get(t) || 0) + 1);
        }
        for (let i = 0; i + 3 <= buf.length; i++) {
            const t = buf.slice(i, i + 3);
            if (CJK_STOPWORDS.has(t)) continue;
            counts.set(t, (counts.get(t) || 0) + 1);
        }
    }

    function bumpLatinWord(buf) {
        if (buf.length < 2) return;
        const t = buf.toLowerCase();
        if (EN_STOPWORDS.has(t)) return;
        counts.set(t, (counts.get(t) || 0) + 1);
    }

    return {
        ingest(msg) {
            if (!msg || typeof msg !== 'object') return;
            if (typeof msg.special === 'string' && msg.special !== '') return;
            const content = typeof msg.content === 'string' ? msg.content : '';
            if (!content) return;

            let cjkBuf = '';
            let latinBuf = '';
            for (const ch of content) {
                if (CJK_CHAR_RE.test(ch)) {
                    if (latinBuf) { bumpLatinWord(latinBuf); latinBuf = ''; }
                    cjkBuf += ch;
                } else if (LATIN_CHAR_RE.test(ch)) {
                    if (cjkBuf) { bumpCjkNgrams(cjkBuf); cjkBuf = ''; }
                    latinBuf += ch;
                } else {
                    // digit / punct / emoji / whitespace — flush both buffers
                    if (cjkBuf) { bumpCjkNgrams(cjkBuf); cjkBuf = ''; }
                    if (latinBuf) { bumpLatinWord(latinBuf); latinBuf = ''; }
                }
            }
            if (cjkBuf) bumpCjkNgrams(cjkBuf);
            if (latinBuf) bumpLatinWord(latinBuf);
        },
        result() {
            // Plan: drop count < 3 noise, sort desc, take Top 20.
            const entries = [];
            let totalUnique = 0;
            for (const [token, count] of counts) {
                totalUnique++;
                if (count >= 3) entries.push([token, count]);
            }
            entries.sort((a, b) => b[1] - a[1]);
            const top = entries.slice(0, 20);
            return { top, qualifiedCount: entries.length, totalUnique };
        },
    };
}

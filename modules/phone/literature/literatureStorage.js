// modules/phone/literature/literatureStorage.js — 文学 App 数据持久化
// Storage:
//   chat_metadata  → 写作数据 + 阅读元数据（跨设备同步）
//   localStorage   → 用户导入书籍全文（体积过大，不适合 chat_metadata）

import { getContext, saveMetadataDebounced } from '../../../../../../extensions.js';
import { chat_metadata } from '../../../../../../../script.js';

// chat_metadata keys
const META_KEY_WRITING = 'gf_literature_writing';
const META_KEY_READING = 'gf_literature_reading';
const META_KEY_PREFS = 'gf_literaturePreferences';

// localStorage keys (book content only)
const BOOK_CONTENT_PREFIX = 'gf_lit_book_';

// Legacy localStorage keys (for migration)
const LEGACY_PREFIX = 'the_ghost_face_literature_v1_';

// ═══════════════════════════════════════════════════════════════════════
// Shared Helpers
// ═══════════════════════════════════════════════════════════════════════

/** Save data to chat_metadata + trigger debounced persist */
function _saveToMeta(key, data) {
    try {
        if (chat_metadata) {
            chat_metadata[key] = data;
            saveMetadataDebounced();
        }
    } catch (e) {
        console.warn(`[文学] _saveToMeta(${key}) failed:`, e);
    }
}

/** Build legacy localStorage key for migration */
function _legacyKey(suffix = '') {
    try {
        const context = getContext();
        const charId = context.characterId;
        const charKey = charId != null ? `char_${charId}` : 'global_fallback';
        return `${LEGACY_PREFIX}${charKey}${suffix}`;
    } catch {
        return `${LEGACY_PREFIX}global_fallback${suffix}`;
    }
}

// --- Book content (localStorage, browser-local) ---

function _saveBookContent(bookId, chapters) {
    try {
        localStorage.setItem(BOOK_CONTENT_PREFIX + bookId, JSON.stringify(chapters));
    } catch (e) {
        console.warn('[文学] _saveBookContent failed:', e);
    }
}

function _loadBookContent(bookId) {
    try {
        const raw = localStorage.getItem(BOOK_CONTENT_PREFIX + bookId);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function _removeBookContent(bookId) {
    try {
        localStorage.removeItem(BOOK_CONTENT_PREFIX + bookId);
    } catch { /* noop */ }
}

// ═══════════════════════════════════════════════════════════════════════
// Writing Data (角色的写作平台数据)
// ═══════════════════════════════════════════════════════════════════════

function _emptyWritingData() {
    return {
        authorProfile: {
            penName: '',        // LLM 生成的笔名
            bio: '',            // 作者简介
            totalWords: 0,
            signedWorks: [],    // 已签约作品 ID 列表
            initialized: false, // 是否已完成初始化（首次生成）
        },
        works: [],
        // works[]: {
        //   id: 'work_xxx',
        //   title: '',
        //   type: 'serial' | 'short' | 'essay' | 'prose',
        //   genre: '',
        //   status: 'ongoing' | 'completed' | 'hiatus',
        //   signed: false,
        //   signedAt: null,           // 签约时间
        //   contractTier: 0,          // 签约等级 (0=未签, 1=普通, 2=精品, 3=大神)
        //   rating: 0,               // 评分 (0~10)
        //   ratingCount: 0,          // 评分人数
        //   favorites: 0,            // 收藏数
        //   readers: 0,              // 读者数（累计）
        //   outline: null,           // 全书大纲（LLM-only, UI 不展示）
        //   // outline: {
        //   //   totalPlannedChapters: 15,
        //   //   endingDirection: '结局走向',
        //   //   chapterPlans: [ { chapterNum: 1, plan: '...' }, ... ]
        //   // }
        //   chapters: [],
        //   comments: [],
        //   createdAt: '',
        //   lastUpdatedAt: '',
        // }
        // chapters[]: { id, title, content, wordCount, summary, createdAt }
        //   summary: LLM-only 隐藏摘要（50-100字），催更时作为前文 context 传入
        // comments[]: { id, author, content, rating, isReader, createdAt, authorReply }
    };
}

export function loadWritingData() {
    // Primary: chat_metadata
    try {
        const data = chat_metadata?.[META_KEY_WRITING];
        if (data && data.authorProfile) return data;
    } catch { /* fall through */ }

    // Fallback: migrate from legacy localStorage
    try {
        const raw = localStorage.getItem(_legacyKey('_writing'));
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.authorProfile) {
                _saveToMeta(META_KEY_WRITING, parsed);
                console.log('[文学] 写作数据已从 localStorage 迁移到 chat_metadata');
                return parsed;
            }
        }
    } catch (e) {
        console.warn('[文学] loadWritingData migration failed:', e);
    }
    return _emptyWritingData();
}

export function saveWritingData(data) {
    _saveToMeta(META_KEY_WRITING, data);
}

/** Reset all writing data for the current character (used by regenerate) */
export function resetWritingData() {
    const empty = _emptyWritingData();
    saveWritingData(empty);
    return empty;
}

// ═══════════════════════════════════════════════════════════════════════
// Reading Data (用户的阅读数据)
// ═══════════════════════════════════════════════════════════════════════

function _emptyReadingData() {
    return {
        userBooks: [],
        // userBooks[]: {
        //   id: 'book_xxx',
        //   title: '',
        //   author: '',
        //   summary: '',           // 用户手动输入的书籍简介（帮助 LLM 理解冷门书）
        //   chapters: [{ title, content }],
        //   progress: { chapterIdx: 0, scrollPos: 0 },
        //   notes: {},  // keyed by pageKey (e.g. 'p_3'): { user: '...', char: '...' }
        //   addedAt: ''
        // }
        charBookshelf: [],
        // charBookshelf[]: {
        //   title: '',
        //   author: '',
        //   genre: '',
        //   charNote: '',           // 角色对这本书的笔记
        //   generated: false,       // 是否已经生成过详细笔记
        //   detailedNote: '',       // 详细读书笔记（lazy-loaded）
        //   sourcesSearched: false, // 是否已完成多源搜索
        //   sources: [],            // 电子书源搜索结果
        //   // sources[]: {
        //   //   type: 'gutenberg' | 'openLibrary' | 'googleBooks',
        //   //   id: '',
        //   //   title: '',
        //   //   author: '',
        //   //   downloadUrl: null,    // 直接下载 URL（仅 Gutenberg）
        //   //   previewUrl: '',       // 预览/借阅外链
        //   //   coverUrl: null,       // 封面图 URL
        //   //   canImport: false,     // 是否可一键导入（有纯文本下载）
        //   // }
        // }
        charBookshelfGenerated: false,  // 是否已生成过角色书架
    };
}

export function loadReadingData() {
    // Primary: chat_metadata (metadata only, book content loaded from localStorage)
    try {
        const metaData = chat_metadata?.[META_KEY_READING];
        if (metaData && Array.isArray(metaData.userBooks)) {
            // Rehydrate: load book chapters from localStorage
            for (const book of metaData.userBooks) {
                if (!book.chapters || book.chapters.length === 0) {
                    book.chapters = _loadBookContent(book.id);
                }
            }
            return metaData;
        }
    } catch { /* fall through */ }

    // Fallback: migrate from legacy localStorage
    try {
        const raw = localStorage.getItem(_legacyKey('_reading'));
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.userBooks)) {
                // Split: save book content to localStorage, metadata to chat_metadata
                for (const book of parsed.userBooks) {
                    if (book.chapters && book.chapters.length > 0) {
                        _saveBookContent(book.id, book.chapters);
                    }
                }
                _saveReadingMeta(parsed);
                console.log('[文学] 阅读数据已从 localStorage 迁移到 chat_metadata');
                return parsed;
            }
        }
    } catch (e) {
        console.warn('[文学] loadReadingData migration failed:', e);
    }
    return _emptyReadingData();
}

export function saveReadingData(data) {
    // Save book content to localStorage (large data)
    for (const book of (data.userBooks || [])) {
        if (book.chapters && book.chapters.length > 0) {
            _saveBookContent(book.id, book.chapters);
        }
    }
    // Save metadata (without chapters) to chat_metadata
    _saveReadingMeta(data);
}

/** Save reading metadata to chat_metadata, stripping book content */
function _saveReadingMeta(data) {
    const metaCopy = JSON.parse(JSON.stringify(data));
    for (const book of (metaCopy.userBooks || [])) {
        delete book.chapters; // Strip content, keep everything else
    }
    _saveToMeta(META_KEY_READING, metaCopy);
}

// ═══════════════════════════════════════════════════════════════════════
// Writing — Work Helpers
// ═══════════════════════════════════════════════════════════════════════

let _idCounter = 0;

function _genId(prefix) {
    _idCounter++;
    return `${prefix}_${Date.now()}_${_idCounter}`;
}

export function createWork(data, workInfo) {
    const work = {
        id: _genId('work'),
        title: workInfo.title || '无题',
        type: workInfo.type || 'serial',
        genre: workInfo.genre || '未分类',
        status: 'ongoing',
        signed: false,
        signedAt: null,
        contractTier: 0,
        rating: workInfo.initialRating || 0,
        ratingCount: workInfo.initialRatingCount || 0,
        favorites: workInfo.initialFavorites || 0,
        readers: workInfo.initialReaders || 0,
        outline: workInfo.outline || null,  // LLM-only 全书大纲
        chapters: [],
        comments: [],
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
    };
    data.works.push(work);
    saveWritingData(data);
    return work;
}

export function addChapter(data, workId, chapterInfo) {
    const work = data.works.find(w => w.id === workId);
    if (!work) return null;

    const chapter = {
        id: _genId('ch'),
        title: chapterInfo.title || `第${work.chapters.length + 1}章`,
        content: chapterInfo.content || '',
        wordCount: (chapterInfo.content || '').length,
        summary: chapterInfo.summary || '',  // LLM-only 隐藏摘要
        createdAt: new Date().toISOString(),
    };
    work.chapters.push(chapter);
    work.lastUpdatedAt = chapter.createdAt;

    // Update total words
    data.authorProfile.totalWords += chapter.wordCount;

    saveWritingData(data);
    return chapter;
}

export function addComment(data, workId, commentInfo) {
    const work = data.works.find(w => w.id === workId);
    if (!work) return null;

    const comment = {
        id: _genId('cmt'),
        author: commentInfo.author || '匿名读者',
        content: commentInfo.content || '',
        rating: commentInfo.rating || null,
        isReader: commentInfo.isReader !== false,
        createdAt: new Date().toISOString(),
        authorReply: commentInfo.authorReply || null,
    };
    work.comments.push(comment);
    saveWritingData(data);
    return comment;
}

export function setCommentReply(data, workId, commentId, replyText) {
    const work = data.works.find(w => w.id === workId);
    if (!work) return;
    const comment = work.comments.find(c => c.id === commentId);
    if (!comment) return;
    comment.authorReply = replyText;
    saveWritingData(data);
}

export function updateWorkStats(data, workId, stats) {
    const work = data.works.find(w => w.id === workId);
    if (!work) return;

    if (stats.rating != null) work.rating = stats.rating;
    if (stats.ratingCount != null) work.ratingCount = stats.ratingCount;
    if (stats.favorites != null) work.favorites = stats.favorites;
    if (stats.readers != null) work.readers = stats.readers;
    if (stats.status) work.status = stats.status;
    saveWritingData(data);
}

export function signWork(data, workId, tier) {
    const work = data.works.find(w => w.id === workId);
    if (!work) return;

    work.signed = true;
    work.signedAt = new Date().toISOString();
    work.contractTier = tier || 1;

    if (!data.authorProfile.signedWorks.includes(workId)) {
        data.authorProfile.signedWorks.push(workId);
    }
    saveWritingData(data);
}

/** Calculate auric cell reward per chapter based on contract tier + work quality */
export function getChapterReward(work) {
    if (!work.signed) return 0;

    const baseReward = 100;
    const tierMultiplier = [0, 1, 1.5, 2.5]; // tier 0/1/2/3
    const { avg } = computeWorkRating(work);
    const qualityBonus = Math.floor(avg * 5); // 0~50 bonus from rating

    return Math.floor(baseReward * (tierMultiplier[work.contractTier] || 1) + qualityBonus);
}

/**
 * Compute rating stats from actual comments (no fabrication).
 * @param {Object} work
 * @returns {{ avg: number, count: number }}
 */
export function computeWorkRating(work) {
    const rated = (work.comments || []).filter(c => c.rating != null);
    if (rated.length === 0) return { avg: 0, count: 0 };
    const sum = rated.reduce((s, c) => s + c.rating, 0);
    return { avg: parseFloat((sum / rated.length).toFixed(1)), count: rated.length };
}

export function getWork(data, workId) {
    return data.works.find(w => w.id === workId) || null;
}

export function getAllWorks(data) {
    return data.works || [];
}

// ═══════════════════════════════════════════════════════════════════════
// Reading — Book Helpers
// ═══════════════════════════════════════════════════════════════════════

export function addBook(data, bookInfo) {
    const book = {
        id: _genId('book'),
        title: bookInfo.title || '未知书名',
        author: bookInfo.author || '未知作者',
        chapters: bookInfo.chapters || [],
        progress: { chapterIdx: 0, scrollPos: 0 },
        notes: {},
        addedAt: new Date().toISOString(),
    };
    data.userBooks.push(book);
    saveReadingData(data);
    return book;
}

export function updateBookProgress(data, bookId, progress) {
    const book = data.userBooks.find(b => b.id === bookId);
    if (!book) return;
    book.progress = { ...book.progress, ...progress };
    saveReadingData(data);
}

export function addBookNote(data, bookId, chapterIdx, noteType, content) {
    const book = data.userBooks.find(b => b.id === bookId);
    if (!book) return;
    if (!book.notes[chapterIdx]) book.notes[chapterIdx] = {};
    book.notes[chapterIdx][noteType] = content; // noteType: 'user' | 'char'
    saveReadingData(data);
}

export function removeBook(data, bookId) {
    _removeBookContent(bookId); // Clean localStorage book content
    data.userBooks = data.userBooks.filter(b => b.id !== bookId);
    saveReadingData(data);
}

export function updateBookSummary(data, bookId, summary) {
    const book = data.userBooks.find(b => b.id === bookId);
    if (!book) return;
    book.summary = summary;
    saveReadingData(data);
}

// ═══════════════════════════════════════════════════════════════════════
// Preferences (chat_metadata)
// ═══════════════════════════════════════════════════════════════════════

export function loadPreferences() {
    try {
        return chat_metadata?.[META_KEY_PREFS] || null;
    } catch {
        return null;
    }
}

export function savePreferences(prefs) {
    try {
        if (chat_metadata) {
            chat_metadata[META_KEY_PREFS] = prefs;
            saveMetadataDebounced();
        }
    } catch (e) {
        console.warn('[文学] savePreferences failed:', e);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Work Type Labels
// ═══════════════════════════════════════════════════════════════════════

export const WORK_TYPES = {
    serial: '连载小说',
    short: '短篇小说',
    essay: '散文',
    prose: '随笔',
};

export const CONTRACT_TIERS = {
    0: { label: '未签约', color: '#999', icon: 'ph-file-text' },
    1: { label: '签约作者', color: '#e6a817', icon: 'ph-seal-check' },
    2: { label: '精品作者', color: '#ff6b35', icon: 'ph-crown-simple' },
    3: { label: '大神作者', color: '#c850c0', icon: 'ph-crown' },
};

// ═══════════════════════════════════════════════════════════════════════
// Character Bookshelf Helpers (角色独立书架)
// ═══════════════════════════════════════════════════════════════════════

export function setCharBookshelf(data, books) {
    data.charBookshelf = books;
    data.charBookshelfGenerated = true;
    saveReadingData(data);
}

export function appendCharBookshelf(data, books) {
    if (!data.charBookshelf) data.charBookshelf = [];
    data.charBookshelf = data.charBookshelf.concat(books);
    data.charBookshelfGenerated = true;
    saveReadingData(data);
}

export function setCharBookNote(data, bookIdx, note) {
    if (!data.charBookshelf || !data.charBookshelf[bookIdx]) return;
    data.charBookshelf[bookIdx].detailedNote = note;
    data.charBookshelf[bookIdx].generated = true;
    saveReadingData(data);
}

export function markCharBookshelfGenerated(data) {
    data.charBookshelfGenerated = true;
    saveReadingData(data);
}

// modules/phone/literature/literatureStorage.js — 文学 App 数据持久化
// Storage: localStorage (per-character, large data), chat_metadata (preferences).

import { getContext, saveMetadataDebounced } from '../../../../../../extensions.js';
import { chat_metadata } from '../../../../../../../script.js';

const MODULE_NAME = 'the_ghost_face';
const STORAGE_KEY_PREFIX = `${MODULE_NAME}_literature_v1_`;
const META_KEY_PREFS = 'gf_literaturePreferences';

// ═══════════════════════════════════════════════════════════════════════
// Character ID Helper
// ═══════════════════════════════════════════════════════════════════════

function _getCharKey() {
    try {
        const context = getContext();
        const charId = context.characterId;
        return charId != null ? `char_${charId}` : 'global_fallback';
    } catch {
        return 'global_fallback';
    }
}

function _storageKey(suffix = '') {
    return `${STORAGE_KEY_PREFIX}${_getCharKey()}${suffix}`;
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
        //   chapters: [],
        //   comments: [],
        //   createdAt: '',
        //   lastUpdatedAt: '',
        // }
        // chapters[]: { id, title, content, wordCount, createdAt }
        // comments[]: { id, author, content, rating, isReader, createdAt, authorReply }
    };
}

export function loadWritingData() {
    try {
        const raw = localStorage.getItem(_storageKey('_writing'));
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.authorProfile) return parsed;
        }
    } catch (e) {
        console.warn('[文学] loadWritingData failed:', e);
    }
    return _emptyWritingData();
}

export function saveWritingData(data) {
    try {
        localStorage.setItem(_storageKey('_writing'), JSON.stringify(data));
    } catch (e) {
        console.warn('[文学] saveWritingData failed:', e);
    }
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
        //   chapters: [{ title, content }],
        //   progress: { chapterIdx: 0, scrollPos: 0 },
        //   notes: {},  // keyed by chapterIdx: { user: '...', char: '...' }
        //   addedAt: ''
        // }
        charBookshelf: [],
        // charBookshelf[]: {
        //   title: '',
        //   author: '',
        //   genre: '',
        //   charNote: '',      // 角色对这本书的笔记
        //   gutenbergId: null, // 如果在 Project Gutenberg 上找到
        //   generated: false   // 是否已经生成过详细笔记
        // }
        charBookshelfGenerated: false,  // 是否已生成过角色书架
    };
}

export function loadReadingData() {
    try {
        const raw = localStorage.getItem(_storageKey('_reading'));
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.userBooks)) return parsed;
        }
    } catch (e) {
        console.warn('[文学] loadReadingData failed:', e);
    }
    return _emptyReadingData();
}

export function saveReadingData(data) {
    try {
        localStorage.setItem(_storageKey('_reading'), JSON.stringify(data));
    } catch (e) {
        console.warn('[文学] saveReadingData failed:', e);
    }
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
    const qualityBonus = Math.floor(work.rating * 5); // 0~50 bonus from rating

    return Math.floor(baseReward * (tierMultiplier[work.contractTier] || 1) + qualityBonus);
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
    data.userBooks = data.userBooks.filter(b => b.id !== bookId);
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
// Reading Data (用户书架 — 不分角色，用户共享)
// ═══════════════════════════════════════════════════════════════════════

const READING_STORAGE_KEY = `${MODULE_NAME}_reading_v1`;

function _emptyReadingData() {
    return {
        userBooks: [],
        // userBooks[]: {
        //   id: 'book_xxx',
        //   title: '',
        //   author: '',
        //   chapters: [{ title, content }],
        //   progress: { chapterIdx: 0 },
        //   addedAt: '',
        // }
    };
}

export function loadReadingData() {
    try {
        const raw = localStorage.getItem(READING_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.userBooks)) return parsed;
        }
    } catch (e) {
        console.warn('[文学] loadReadingData failed:', e);
    }
    return _emptyReadingData();
}

export function saveReadingData(data) {
    try {
        localStorage.setItem(READING_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('[文学] saveReadingData failed:', e);
    }
}

export function addBook(data, bookInfo) {
    const book = {
        id: `book_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: bookInfo.title || '未知书名',
        author: bookInfo.author || '未知作者',
        chapters: bookInfo.chapters || [],
        progress: { chapterIdx: 0 },
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

export function removeBook(data, bookId) {
    data.userBooks = data.userBooks.filter(b => b.id !== bookId);
    saveReadingData(data);
}

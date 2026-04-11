// modules/phone/literature/readingTab.js — 阅读 Tab UI + Logic
// User bookshelf: import .txt/.epub books, read chapters, track progress.

import { escapeHtml } from '../utils/helpers.js';
import { showToast } from '../moments/momentsUI.js';
import {
    loadReadingData, saveReadingData,
    addBook, updateBookProgress, removeBook,
} from './literatureStorage.js';

// ═══════════════════════════════════════════════════════════════════════
// Public: Render Reading Tab Content
// ═══════════════════════════════════════════════════════════════════════

export function renderReadingTab(container) {
    const data = loadReadingData();
    _renderBookshelf(container, data);
}

// ═══════════════════════════════════════════════════════════════════════
// Bookshelf View
// ═══════════════════════════════════════════════════════════════════════

function _renderBookshelf(container, data) {
    const books = data.userBooks || [];

    const booksHtml = books.length > 0 ? books.map(b => {
        const chCount = b.chapters.length;
        const progress = b.progress?.chapterIdx || 0;
        const percent = chCount > 0 ? Math.round((progress / chCount) * 100) : 0;

        return `
            <div class="lit-book-card" data-book-id="${b.id}">
                <div class="lit-book-cover">
                    <i class="ph-fill ph-book-open"></i>
                </div>
                <div class="lit-book-info">
                    <div class="lit-book-title">${escapeHtml(b.title)}</div>
                    <div class="lit-book-author">${escapeHtml(b.author)}</div>
                    <div class="lit-book-progress-row">
                        <div class="lit-book-progress-bar">
                            <div class="lit-book-progress-fill" style="width:${percent}%"></div>
                        </div>
                        <span class="lit-book-progress-text">${progress}/${chCount}章</span>
                    </div>
                </div>
                <button class="lit-book-delete-btn" data-book-id="${b.id}" title="删除">
                    <i class="ph ph-trash"></i>
                </button>
            </div>
        `;
    }).join('') : `
        <div class="lit-empty-shelf">
            <i class="ph ph-books"></i>
            <div class="lit-empty-shelf-text">书架空空如也</div>
            <div class="lit-empty-shelf-hint">点击下方按钮导入书籍</div>
        </div>
    `;

    container.innerHTML = `
        <div class="lit-bookshelf">
            <div class="lit-shelf-list">
                ${booksHtml}
            </div>
            <div class="lit-import-bar">
                <button class="lit-import-btn" id="lit_import_btn">
                    <i class="ph ph-plus-circle"></i> 导入书籍
                </button>
                <span class="lit-import-hint">支持 .txt / .epub</span>
            </div>
            <input type="file" id="lit_file_input" accept=".txt,.epub" style="display:none" />
        </div>
    `;

    // Bind import
    document.getElementById('lit_import_btn')?.addEventListener('click', () => {
        document.getElementById('lit_file_input')?.click();
    });

    document.getElementById('lit_file_input')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        await _handleFileImport(container, file);
        e.target.value = ''; // Reset
    });

    // Bind book card clicks
    container.querySelectorAll('.lit-book-card').forEach(card => {
        card.addEventListener('click', (e) => {
            // Don't navigate if clicking delete
            if (e.target.closest('.lit-book-delete-btn')) return;
            const bookId = card.dataset.bookId;
            _openBookDetail(container, bookId);
        });
    });

    // Bind delete buttons
    container.querySelectorAll('.lit-book-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const bookId = btn.dataset.bookId;
            const data = loadReadingData();
            const book = data.userBooks.find(b => b.id === bookId);
            if (!book) return;
            if (!confirm(`确认删除《${book.title}》？`)) return;
            removeBook(data, bookId);
            showToast('已删除');
            _renderBookshelf(container, loadReadingData());
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// File Import (TXT + EPUB)
// ═══════════════════════════════════════════════════════════════════════

async function _handleFileImport(container, file) {
    const ext = file.name.split('.').pop().toLowerCase();

    showToast('正在导入……');

    try {
        let bookInfo;
        if (ext === 'txt') {
            bookInfo = await _parseTxt(file);
        } else if (ext === 'epub') {
            bookInfo = await _parseEpub(file);
        } else {
            showToast('不支持的格式，请使用 .txt 或 .epub');
            return;
        }

        if (!bookInfo || !bookInfo.chapters || bookInfo.chapters.length === 0) {
            showToast('解析失败：未找到任何内容');
            return;
        }

        const data = loadReadingData();
        addBook(data, bookInfo);

        showToast(`《${bookInfo.title}》导入成功！共 ${bookInfo.chapters.length} 章`);
        _renderBookshelf(container, loadReadingData());
    } catch (err) {
        console.error('[文学] Import failed:', err);
        showToast('导入失败：' + err.message);
    }
}

// ── TXT Parser ──

async function _parseTxt(file) {
    const text = await file.text();
    const title = file.name.replace(/\.txt$/i, '').trim() || '未知书名';
    const chapters = _splitIntoChapters(text);

    return {
        title,
        author: '未知作者',
        chapters,
    };
}

/**
 * Split plain text into chapters using common Chinese/English chapter heading patterns.
 * Falls back to splitting by fixed character count if no chapter headings found.
 */
function _splitIntoChapters(text) {
    // Common chapter heading patterns
    const chapterPatterns = [
        // Chinese: 第X章, 第X节, 第X回, 第X篇
        /^第[零一二三四五六七八九十百千万\d]+[章节回篇卷集部]\s*.*/gm,
        // English: Chapter X, CHAPTER X
        /^Chapter\s+\d+.*/gim,
        // Numbered: 1. Title, 01 Title
        /^\d{1,4}[.、\s].+/gm,
        // Separator lines: ===, ---, ***
        /^[=\-*]{3,}\s*$/gm,
    ];

    // Try each pattern
    for (const pattern of chapterPatterns) {
        const matches = [...text.matchAll(pattern)];
        if (matches.length >= 2) {
            return _splitByMatches(text, matches);
        }
    }

    // Fallback: split by fixed size (~3000 chars per chapter)
    return _splitBySize(text, 3000);
}

function _splitByMatches(text, matches) {
    const chapters = [];

    for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index;
        const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
        const chapterText = text.substring(start, end).trim();

        if (!chapterText) continue;

        // First line is the title
        const firstNewline = chapterText.indexOf('\n');
        const title = firstNewline > 0
            ? chapterText.substring(0, firstNewline).trim()
            : chapterText.substring(0, 50).trim();
        const content = firstNewline > 0
            ? chapterText.substring(firstNewline + 1).trim()
            : chapterText;

        chapters.push({ title, content });
    }

    // If there's content before the first match, add it as prologue
    const prologueText = text.substring(0, matches[0].index).trim();
    if (prologueText.length > 100) {
        chapters.unshift({ title: '前言', content: prologueText });
    }

    return chapters;
}

function _splitBySize(text, chunkSize) {
    const chapters = [];
    const lines = text.split('\n');
    let currentChunk = [];
    let currentLen = 0;
    let chapterNum = 1;

    for (const line of lines) {
        currentChunk.push(line);
        currentLen += line.length;

        if (currentLen >= chunkSize) {
            chapters.push({
                title: `第${chapterNum}节`,
                content: currentChunk.join('\n').trim(),
            });
            currentChunk = [];
            currentLen = 0;
            chapterNum++;
        }
    }

    if (currentChunk.length > 0) {
        chapters.push({
            title: `第${chapterNum}节`,
            content: currentChunk.join('\n').trim(),
        });
    }

    return chapters;
}

// ── EPUB Parser ──

async function _parseEpub(file) {
    // Dynamically load epub.js (ST has it bundled)
    if (!('ePub' in window)) {
        await import('../../../../../../../lib/jszip.min.js');
        await import('../../../../../../../lib/epub.min.js');
    }

    const arrayBuffer = await file.arrayBuffer();
    const book = ePub(arrayBuffer);
    await book.ready;

    // Get metadata
    const metadata = book.packaging?.metadata || {};
    const title = metadata.title || file.name.replace(/\.epub$/i, '').trim() || '未知书名';
    const author = metadata.creator || '未知作者';

    // Get TOC for chapter titles
    const toc = await book.loaded.navigation;
    const tocMap = new Map();
    if (toc?.toc) {
        for (const item of toc.toc) {
            const href = item.href?.split('#')[0]; // Remove fragment
            if (href) tocMap.set(href, item.label?.trim() || '');
        }
    }

    // Parse each spine section
    const chapters = [];
    const spineItems = [];
    book.spine.each(section => spineItems.push(section));

    for (const section of spineItems) {
        try {
            const doc = await book.load(section.href);
            if (!(doc instanceof Document) || !doc.body?.textContent?.trim()) continue;

            const content = doc.body.textContent.trim();
            if (content.length < 50) continue; // Skip tiny sections (like cover/TOC)

            // Try to get title from TOC, fallback to first heading or section href
            let chTitle = tocMap.get(section.href) || tocMap.get(section.href.split('/').pop());
            if (!chTitle) {
                const heading = doc.querySelector('h1, h2, h3, h4');
                chTitle = heading?.textContent?.trim() || `章节 ${chapters.length + 1}`;
            }

            chapters.push({ title: chTitle, content });
        } catch (e) {
            console.warn('[文学] EPUB section parse error:', section.href, e);
        }
    }

    return { title, author, chapters };
}

// ═══════════════════════════════════════════════════════════════════════
// Book Detail — Chapter List + Progress
// ═══════════════════════════════════════════════════════════════════════

function _openBookDetail(container, bookId) {
    const data = loadReadingData();
    const book = data.userBooks.find(b => b.id === bookId);
    if (!book) return;

    const currentIdx = book.progress?.chapterIdx || 0;

    const chaptersHtml = book.chapters.map((ch, i) => {
        const isRead = i < currentIdx;
        const isCurrent = i === currentIdx;
        return `
            <div class="lit-rd-chapter-item ${isCurrent ? 'current' : ''} ${isRead ? 'read' : ''}" data-ch-idx="${i}">
                <span class="lit-rd-chapter-num">${i + 1}</span>
                <span class="lit-rd-chapter-title">${escapeHtml(ch.title)}</span>
                ${isCurrent ? '<span class="lit-rd-chapter-badge">当前</span>' : ''}
                ${isRead ? '<i class="ph ph-check lit-rd-chapter-check"></i>' : ''}
            </div>
        `;
    }).join('');

    const percent = book.chapters.length > 0
        ? Math.round((currentIdx / book.chapters.length) * 100) : 0;

    container.innerHTML = `
        <div class="lit-book-detail">
            <div class="lit-rd-header">
                <button class="lit-back-btn" id="lit_rd_back"><i class="ph ph-caret-left"></i></button>
                <div class="lit-rd-header-info">
                    <div class="lit-rd-title">${escapeHtml(book.title)}</div>
                    <div class="lit-rd-author">${escapeHtml(book.author)}</div>
                </div>
            </div>

            <div class="lit-rd-progress-section">
                <div class="lit-rd-progress-bar-wrap">
                    <div class="lit-rd-progress-bar">
                        <div class="lit-rd-progress-fill" style="width:${percent}%"></div>
                    </div>
                    <span class="lit-rd-progress-text">${percent}% · ${currentIdx}/${book.chapters.length}章</span>
                </div>
                ${currentIdx > 0 ? `
                    <button class="lit-rd-continue-btn" id="lit_rd_continue">
                        <i class="ph ph-book-open-text"></i> 继续阅读
                    </button>
                ` : `
                    <button class="lit-rd-continue-btn" id="lit_rd_continue">
                        <i class="ph ph-book-open-text"></i> 开始阅读
                    </button>
                `}
            </div>

            <div class="lit-section-header"><span>目录</span></div>
            <div class="lit-rd-chapters-list">
                ${chaptersHtml}
            </div>
        </div>

        <!-- Reader Overlay -->
        <div class="lit-rd-reader-overlay" id="lit_rd_reader_overlay">
            <div class="lit-rd-reader-header">
                <button class="lit-back-btn" id="lit_rd_reader_close"><i class="ph ph-caret-left"></i></button>
                <div class="lit-rd-reader-title" id="lit_rd_reader_title"></div>
                <div class="lit-rd-reader-progress" id="lit_rd_reader_progress"></div>
            </div>
            <div class="lit-rd-reader-body" id="lit_rd_reader_body"></div>
        </div>
    `;

    _bindBookDetailEvents(container, book);
}

function _bindBookDetailEvents(container, book) {
    // Back
    document.getElementById('lit_rd_back')?.addEventListener('click', () => {
        _renderBookshelf(container, loadReadingData());
    });

    // Continue reading
    document.getElementById('lit_rd_continue')?.addEventListener('click', () => {
        const idx = book.progress?.chapterIdx || 0;
        _openReader(container, book, idx);
    });

    // Chapter clicks
    container.querySelectorAll('.lit-rd-chapter-item').forEach(item => {
        item.addEventListener('click', () => {
            const idx = parseInt(item.dataset.chIdx);
            _openReader(container, book, idx);
        });
    });

    // Reader close
    document.getElementById('lit_rd_reader_close')?.addEventListener('click', () => {
        document.getElementById('lit_rd_reader_overlay')?.classList.remove('active');
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Reader
// ═══════════════════════════════════════════════════════════════════════

function _openReader(container, book, chapterIdx) {
    const chapter = book.chapters[chapterIdx];
    if (!chapter) return;

    const overlay = document.getElementById('lit_rd_reader_overlay');
    const titleEl = document.getElementById('lit_rd_reader_title');
    const bodyEl = document.getElementById('lit_rd_reader_body');
    const progressEl = document.getElementById('lit_rd_reader_progress');

    if (!overlay || !titleEl || !bodyEl) return;

    titleEl.textContent = chapter.title;
    if (progressEl) {
        progressEl.textContent = `${chapterIdx + 1} / ${book.chapters.length}`;
    }

    // Format paragraphs
    const paragraphs = chapter.content.split(/\n+/).filter(p => p.trim());
    bodyEl.innerHTML = paragraphs.map(p =>
        `<p class="lit-reader-paragraph">${escapeHtml(p.trim())}</p>`
    ).join('');

    // Navigation
    const hasNext = chapterIdx < book.chapters.length - 1;
    const hasPrev = chapterIdx > 0;
    bodyEl.innerHTML += `
        <div class="lit-reader-nav">
            ${hasPrev ? `<button class="lit-reader-nav-btn" id="lit_rd_prev">上一章</button>` : '<span></span>'}
            <span class="lit-reader-progress">${chapterIdx + 1} / ${book.chapters.length}</span>
            ${hasNext ? `<button class="lit-reader-nav-btn" id="lit_rd_next">下一章</button>` : '<span></span>'}
        </div>
    `;

    overlay.classList.add('active');
    bodyEl.scrollTop = 0;

    // Update progress
    const data = loadReadingData();
    const freshBook = data.userBooks.find(b => b.id === book.id);
    if (freshBook) {
        const newProgress = Math.max(freshBook.progress?.chapterIdx || 0, chapterIdx + 1);
        updateBookProgress(data, book.id, { chapterIdx: newProgress });
    }

    // Nav buttons
    document.getElementById('lit_rd_prev')?.addEventListener('click', () => {
        _openReader(container, book, chapterIdx - 1);
    });
    document.getElementById('lit_rd_next')?.addEventListener('click', () => {
        _openReader(container, book, chapterIdx + 1);
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Back Button Integration
// ═══════════════════════════════════════════════════════════════════════

let _readingBackBound = false;

export function bindReadingBackButton() {
    if (_readingBackBound) return;

    window.addEventListener('phone-app-back', (e) => {
        // Reader overlay
        const readerOverlay = document.getElementById('lit_rd_reader_overlay');
        if (readerOverlay?.classList.contains('active')) {
            e.preventDefault();
            readerOverlay.classList.remove('active');
            return;
        }

        // Book detail → back to shelf
        const bookDetail = document.querySelector('.lit-book-detail');
        if (bookDetail) {
            e.preventDefault();
            const container = document.getElementById('lit_tab_reading');
            if (container) _renderBookshelf(container, loadReadingData());
            return;
        }
    });

    _readingBackBound = true;
}

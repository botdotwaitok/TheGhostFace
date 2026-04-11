// modules/phone/literature/readingTab.js — 阅读 Tab UI + Logic
// User bookshelf: import .txt/.epub books, read chapters, track progress.
// Character bookshelf: 10 AI-generated book picks + detailed reading notes.
// Co-reading: generate character's reactions to user-imported book chapters.

import { escapeHtml } from '../utils/helpers.js';
import { showToast } from '../moments/momentsUI.js';
import { getPhoneCharInfo } from '../phoneContext.js';
import {
    loadReadingData, saveReadingData,
    addBook, updateBookProgress, removeBook, addBookNote,
    updateBookSummary,
    setCharBookshelf, appendCharBookshelf, setCharBookNote,
} from './literatureStorage.js';
import {
    generateReadingNote, generateCharBookshelf, generateDetailedBookNote,
} from './literatureGeneration.js';

// ═══════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════

let _activeShelf = 'user'; // 'user' | 'char'

const CHARS_PER_PAGE = 1000; // 每页字数

// ═══════════════════════════════════════════════════════════════════════
// Public: Render Reading Tab Content
// ═══════════════════════════════════════════════════════════════════════

export function renderReadingTab(container) {
    const data = loadReadingData();
    _renderShelfView(container, data);
}

// ═══════════════════════════════════════════════════════════════════════
// Shelf View — Toggle between User / Character bookshelf
// ═══════════════════════════════════════════════════════════════════════

function _renderShelfView(container, data) {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || 'Ta';

    // Ensure app header is in generic tabs mode, not book detail title mode
    const appHeaderTabs = document.getElementById('lit_header_tabs');
    const appHeaderTitle = document.getElementById('lit_header_title');
    if (appHeaderTabs && appHeaderTitle) {
        appHeaderTabs.style.display = '';
        appHeaderTitle.style.display = 'none';
        appHeaderTitle.innerHTML = '';
    }

    container.innerHTML = `
        <div class="lit-bookshelf">
            <!-- Shelf Toggle -->
            <div class="lit-shelf-toggle">
                <button class="lit-shelf-toggle-btn ${_activeShelf === 'user' ? 'active' : ''}" data-shelf="user">
                    我的书架
                </button>
                <button class="lit-shelf-toggle-btn ${_activeShelf === 'char' ? 'active' : ''}" data-shelf="char">
                    ${escapeHtml(charName)}的书架
                </button>
            </div>

            <!-- Shelf Content -->
            <div class="lit-shelf-content" id="lit_shelf_content"></div>

            <!-- Import Bar (only for user shelf) -->
            <div class="lit-import-bar" id="lit_import_bar" style="display:${_activeShelf === 'user' ? '' : 'none'}">
                <button class="lit-import-btn" id="lit_import_btn">
                    <i class="ph ph-plus-circle"></i> 导入书籍
                </button>
                <span class="lit-import-hint">支持 .txt / .epub / .pdf</span>
            </div>
            <input type="file" id="lit_file_input" accept=".txt,.epub,.pdf" style="display:none" />
        </div>
    `;

    // Bind toggle
    container.querySelectorAll('.lit-shelf-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            _activeShelf = btn.dataset.shelf;
            _renderShelfView(container, loadReadingData());
        });
    });

    // Render active shelf
    const contentEl = document.getElementById('lit_shelf_content');
    if (!contentEl) return;

    if (_activeShelf === 'user') {
        _renderUserBooks(container, contentEl, data);
    } else {
        _renderCharBookshelf(container, contentEl, data);
    }

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
}

// ═══════════════════════════════════════════════════════════════════════
// User Bookshelf
// ═══════════════════════════════════════════════════════════════════════

function _renderUserBooks(container, contentEl, data) {
    const books = data.userBooks || [];

    if (books.length === 0) {
        contentEl.innerHTML = `
            <div class="lit-empty-shelf">
                <i class="ph ph-books"></i>
                <div class="lit-empty-shelf-text">书架空空如也</div>
                <div class="lit-empty-shelf-hint">点击下方按钮导入书籍</div>
            </div>
        `;
        return;
    }

    contentEl.innerHTML = books.map(b => {
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
    }).join('');

    // Bind book card clicks
    contentEl.querySelectorAll('.lit-book-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.lit-book-delete-btn')) return;
            const bookId = card.dataset.bookId;
            _openBookDetail(container, bookId);
        });
    });

    // Bind delete buttons
    contentEl.querySelectorAll('.lit-book-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const bookId = btn.dataset.bookId;
            const data = loadReadingData();
            const book = data.userBooks.find(b => b.id === bookId);
            if (!book) return;
            if (!confirm(`确认删除《${book.title}》？`)) return;
            removeBook(data, bookId);
            showToast('已删除');
            _renderShelfView(container, loadReadingData());
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Character Bookshelf
// ═══════════════════════════════════════════════════════════════════════

function _renderCharBookshelf(container, contentEl, data) {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || 'Ta';

    if (!data.charBookshelfGenerated || !data.charBookshelf || data.charBookshelf.length === 0) {
        // Not yet generated
        contentEl.innerHTML = `
            <div class="lit-empty-shelf">
                <i class="ph ph-detective"></i>
                <div class="lit-empty-shelf-text">偷看 ${escapeHtml(charName)} 的书架？</div>
                <div class="lit-empty-shelf-hint">看看 Ta 私下都在读什么书</div>
                <button class="lit-char-shelf-gen-btn" id="lit_gen_char_shelf">
                    <i class="ph ph-eye"></i> 偷看一眼
                </button>
            </div>
        `;

        document.getElementById('lit_gen_char_shelf')?.addEventListener('click', async () => {
            const btn = document.getElementById('lit_gen_char_shelf');
            if (!btn || btn.disabled) return;
            btn.disabled = true;
            btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 正在翻 Ta 的书架……';

            try {
                const books = await generateCharBookshelf();
                const freshData = loadReadingData();
                setCharBookshelf(freshData, books);

                showToast(`发现了 ${charName} 的 ${books.length} 本书！`);
                _renderShelfView(container, loadReadingData());

                // Silent multi-source search (progressive UI update)
                _searchAllSources(books, container);
            } catch (err) {
                console.error('[文学] Char bookshelf gen failed:', err);
                showToast('生成失败：' + err.message);
                btn.disabled = false;
                btn.innerHTML = '<i class="ph ph-eye"></i> 偷看一眼';
            }
        });
        return;
    }

    // Render character's books
    const books = data.charBookshelf;
    contentEl.innerHTML = `<div class="lit-char-shelf-list">${books.map((b, i) => {
        const sources = b.sources || [];
        const hasSearched = b.sourcesSearched;
        return `
        <div class="lit-char-book-card" data-book-idx="${i}">
            <div class="lit-char-book-header">
                <div class="lit-char-book-icon">
                    <i class="ph-fill ph-book-bookmark"></i>
                </div>
                <div class="lit-char-book-info">
                    <div class="lit-char-book-title">${escapeHtml(b.title)}</div>
                    <div class="lit-char-book-author">${escapeHtml(b.author)}</div>
                </div>
                <span class="lit-char-book-genre">${escapeHtml(b.genre)}</span>
            </div>
            <div class="lit-char-book-note">${escapeHtml(b.charNote)}</div>
            ${_renderSourcePanel(sources, i, hasSearched)}
            ${b.generated && b.detailedNote ? `
                <div class="lit-char-note-detail">${escapeHtml(b.detailedNote)}</div>
            ` : `
                <button class="lit-char-note-expand-btn" data-book-idx="${i}">
                    <i class="ph ph-article"></i> 看 Ta 的详细感想
                </button>
            `}
        </div>
    `;
    }).join('')}</div>`;

    // Bind expand buttons (lazy-load detailed note)
    contentEl.querySelectorAll('.lit-char-note-expand-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.bookIdx);
            if (btn.disabled) return;
            btn.disabled = true;
            btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 正在翻看感想……';

            try {
                const book = books[idx];
                const note = await generateDetailedBookNote(book);
                const freshData = loadReadingData();
                setCharBookNote(freshData, idx, note);

                // Replace button with note
                const card = btn.closest('.lit-char-book-card');
                if (card) {
                    btn.remove();
                    const noteEl = document.createElement('div');
                    noteEl.className = 'lit-char-note-detail';
                    noteEl.textContent = note;
                    card.appendChild(noteEl);
                }
            } catch (err) {
                console.error('[文学] Detailed note gen failed:', err);
                showToast('生成失败：' + err.message);
                btn.disabled = false;
                btn.innerHTML = '<i class="ph ph-article"></i> 看 Ta 的详细感想';
            }
        });
    });

    // Bind source import buttons (Gutenberg one-click import)
    contentEl.querySelectorAll('.lit-source-import-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const gutId = btn.dataset.sourceId;
            if (!gutId || btn.disabled) return;
            btn.disabled = true;
            btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 导入中';

            try {
                const bookInfo = await _downloadGutenbergBook(gutId);
                if (bookInfo) {
                    const freshData = loadReadingData();
                    addBook(freshData, bookInfo);
                    showToast(`《${bookInfo.title}》已加入你的书架！`);
                    btn.innerHTML = '<i class="ph ph-check"></i> 已导入';
                    btn.classList.add('done');
                } else {
                    showToast('下载失败，请稍后重试');
                    btn.disabled = false;
                    btn.innerHTML = '<i class="ph ph-download-simple"></i> 一键导入';
                }
            } catch (err) {
                console.error('[文学] Gutenberg import failed:', err);
                showToast('导入失败：' + err.message);
                btn.disabled = false;
                btn.innerHTML = '<i class="ph ph-download-simple"></i> 一键导入';
            }
        });
    });

    // Bind source preview links (Open Library, Google Books)
    contentEl.querySelectorAll('.lit-source-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.stopPropagation();
            const url = link.dataset.url;
            if (url) window.open(url, '_blank');
        });
    });

    // If sources not yet searched, trigger search now
    const needsSearch = books.some(b => !b.sourcesSearched);
    if (needsSearch) {
        _searchAllSources(books, container);
    }

    // Add "Load More" button at the end
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.className = 'lit-char-shelf-load-more';
    loadMoreBtn.id = 'lit_load_more_char_books';
    loadMoreBtn.innerHTML = ' 翻看更多书';
    contentEl.appendChild(loadMoreBtn);

    loadMoreBtn.addEventListener('click', async () => {
        if (loadMoreBtn.disabled) return;
        loadMoreBtn.disabled = true;
        loadMoreBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 正在寻找更多书……';

        try {
            const newBooks = await generateCharBookshelf(); // Usually returns 10 books
            const freshData = loadReadingData();
            appendCharBookshelf(freshData, newBooks);
            showToast(`又发现了 ${charName} 的 ${newBooks.length} 本书！`);
            _renderShelfView(container, loadReadingData());

            // Search sources for new books only
            _searchAllSources(freshData.charBookshelf.filter(b => !b.sourcesSearched), container);
        } catch (err) {
            console.error('[文学] Load more char bookshelf failed:', err);
            showToast('寻找失败：' + err.message);
            loadMoreBtn.disabled = false;
            loadMoreBtn.innerHTML = ' 翻看更多书';
        }
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
        } else if (ext === 'pdf') {
            bookInfo = await _parsePdf(file);
        } else {
            showToast('不支持的格式，请使用 .txt、.epub 或 .pdf');
            return;
        }

        if (!bookInfo || !bookInfo.chapters || bookInfo.chapters.length === 0) {
            showToast('解析失败：未找到任何内容');
            return;
        }

        const data = loadReadingData();
        addBook(data, bookInfo);

        showToast(`《${bookInfo.title}》导入成功！共 ${bookInfo.chapters.length} 章`);
        _renderShelfView(container, loadReadingData());
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

// ── PDF Parser ──

async function _parsePdf(file) {
    if (!('pdfjsLib' in window)) {
        await import('../../../../../../../lib/pdf.min.mjs');
        await import('../../../../../../../lib/pdf.worker.min.mjs');
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument(arrayBuffer).promise;

    // Extract text from all pages
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        // Join page items with a space to avoid words blending across layout bounds
        const text = textContent.items.map(item => item.str).join(' ');
        pages.push(text);
    }

    const fullText = pages.join('\n\n');
    const title = file.name.replace(/\.pdf$/i, '').trim() || '未知书名';
    // Use the existing TXT splitter logic since PDF text is unstructured layout output
    const chapters = _splitIntoChapters(fullText);

    return {
        title,
        author: '未知作者',
        chapters,
    };
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
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || 'Ta';

    const chaptersHtml = book.chapters.map((ch, i) => {
        const isRead = i < currentIdx;
        const isCurrent = i === currentIdx;
        const hasNote = book.notes?.[i]?.char;
        return `
            <div class="lit-rd-chapter-item ${isCurrent ? 'current' : ''} ${isRead ? 'read' : ''}" data-ch-idx="${i}">
                <span class="lit-rd-chapter-num">${i + 1}</span>
                <span class="lit-rd-chapter-title">${escapeHtml(ch.title)}</span>
                ${hasNote ? '<i class="ph-fill ph-chat-circle-text lit-rd-chapter-note-icon"></i>' : ''}
                ${isCurrent ? '<span class="lit-rd-chapter-badge">当前</span>' : ''}
                ${isRead ? '<i class="ph ph-check lit-rd-chapter-check"></i>' : ''}
            </div>
        `;
    }).join('');

    const percent = book.chapters.length > 0
        ? Math.round((currentIdx / book.chapters.length) * 100) : 0;

    container.innerHTML = `
        <div class="lit-book-detail" data-book-id="${bookId}">
            <div class="lit-rd-summary-section" id="lit_rd_summary_section">
                <div class="lit-rd-summary-label">
                    <i class="ph ph-info"></i>
                    <span>书籍简介（帮助你对象理解这本书）</span>
                </div>
                ${book.summary ? `
                    <div class="lit-rd-summary-text">${escapeHtml(book.summary)}</div>
                    <button class="lit-rd-note-edit-btn" id="lit_rd_summary_edit">
                        <i class="ph ph-pencil-simple"></i> 编辑
                    </button>
                ` : `
                    <textarea class="lit-rd-summary-input" id="lit_rd_book_summary"
                        placeholder="简要描述这本书的主题、背景或故事梗概……（可选）"
                        rows="2"></textarea>
                    <button class="lit-rd-summary-save-btn" id="lit_rd_summary_save">保存简介</button>
                `}
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

            <!-- Notes Navigation -->
            ${_renderNotesNav(book)}

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
                <button class="lit-rd-note-trigger" id="lit_rd_note_trigger" title="写感想">
                    <i class="ph ph-pencil-line"></i>
                </button>
            </div>
            <div class="lit-rd-reader-body" id="lit_rd_reader_body"></div>
            <!-- Note Panel Backdrop -->
            <div class="lit-rd-note-backdrop" id="lit_rd_note_backdrop"></div>

            <!-- Note Panel (slides up from bottom) -->
            <div class="lit-rd-note-panel" id="lit_rd_note_panel">
                <div class="lit-rd-note-panel-header">
                    <span>阅读笔记</span>
                    <button class="lit-rd-note-panel-close" id="lit_rd_note_panel_close">
                        <i class="ph ph-x"></i>
                    </button>
                </div>
                <div class="lit-rd-note-panel-body" id="lit_rd_note_panel_body"></div>
            </div>
        </div>
    `;

    // Update app header to show book title
    const appHeaderTabs = document.getElementById('lit_header_tabs');
    const appHeaderTitle = document.getElementById('lit_header_title');
    if (appHeaderTabs && appHeaderTitle) {
        appHeaderTabs.style.display = 'none';
        appHeaderTitle.style.display = '';
        appHeaderTitle.innerHTML = `<span style="font-size:1.05em">${escapeHtml(book.title)}</span> <span style="font-size:0.75em;color:#999;font-weight:400;margin-left:6px">${escapeHtml(book.author)}</span>`;
    }

    _bindBookDetailEvents(container, book);
}

// ── Paginate helpers ──

/**
 * Flatten all chapters into a single array of pages.
 * Each page = { content, chapterIdx, chapterTitle, pageInChapter, totalPagesInChapter }.
 */
function _paginateBook(book) {
    const pages = [];
    for (let ci = 0; ci < book.chapters.length; ci++) {
        const ch = book.chapters[ci];
        const text = ch.content || '';
        const chPages = _splitTextIntoPages(text);
        for (let pi = 0; pi < chPages.length; pi++) {
            pages.push({
                content: chPages[pi],
                chapterIdx: ci,
                chapterTitle: ch.title,
                pageInChapter: pi,
                totalPagesInChapter: chPages.length,
            });
        }
    }
    return pages;
}

function _splitTextIntoPages(text) {
    if (!text) return [''];
    const paragraphs = text.split(/\n+/).filter(p => p.trim());
    const pages = [];
    let currentPage = [];
    let currentLen = 0;

    for (const para of paragraphs) {
        if (currentLen + para.length > CHARS_PER_PAGE && currentPage.length > 0) {
            pages.push(currentPage.join('\n'));
            currentPage = [para];
            currentLen = para.length;
        } else {
            currentPage.push(para);
            currentLen += para.length;
        }
    }
    if (currentPage.length > 0) pages.push(currentPage.join('\n'));
    return pages.length > 0 ? pages : [''];
}

/** Find the first page index of a given chapter. */
function _chapterStartPage(pages, chapterIdx) {
    return pages.findIndex(p => p.chapterIdx === chapterIdx);
}

// ═════════════════════════════════════════════════════════════════════
// Notes Navigation (in book detail)
// ═════════════════════════════════════════════════════════════════════

function _renderNotesNav(book) {
    const notes = book.notes || {};
    const noteKeys = Object.keys(notes).filter(k => {
        const n = notes[k];
        return n && (n.user || n.char);
    });

    if (noteKeys.length === 0) return '';

    const pages = _paginateBook(book);
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || 'Ta';

    const items = noteKeys.map(key => {
        const pageIdx = parseInt(key.replace('p_', ''));
        const note = notes[key];
        const page = pages[pageIdx];
        const chTitle = page ? page.chapterTitle : '';
        const preview = note.user
            ? note.user.substring(0, 40) + (note.user.length > 40 ? '…' : '')
            : note.char.substring(0, 40) + (note.char.length > 40 ? '…' : '');
        const hasChar = !!note.char;

        return `
            <div class="lit-rd-notes-nav-item" data-page-idx="${pageIdx}">
                <div class="lit-rd-notes-nav-page">P${pageIdx + 1}</div>
                <div class="lit-rd-notes-nav-info">
                    <div class="lit-rd-notes-nav-ch">${escapeHtml(chTitle)}</div>
                    <div class="lit-rd-notes-nav-preview">${escapeHtml(preview)}</div>
                </div>
                <div class="lit-rd-notes-nav-icons">
                    ${note.user ? '<i class="ph-fill ph-user" title="我的笔记"></i>' : ''}
                    ${hasChar ? `<i class="ph-fill ph-chat-circle-text" title="${escapeHtml(charName)}的感想"></i>` : ''}
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="lit-rd-notes-nav-section">
            <div class="lit-section-header">
                <span><i class="ph ph-note-pencil"></i> 笔记导航</span>
                <span class="lit-rd-notes-count">${noteKeys.length} 条</span>
            </div>
            <div class="lit-rd-notes-nav-list">
                ${items}
            </div>
        </div>
    `;
}

// ═════════════════════════════════════════════════════════════════════
// Reader (per-page with note panel)
// ═════════════════════════════════════════════════════════════════════

function _openReader(container, book, pageIdx) {
    const pages = _paginateBook(book);
    if (pageIdx < 0 || pageIdx >= pages.length) return;

    const page = pages[pageIdx];
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || 'Ta';
    const pageKey = `p_${pageIdx}`;

    const overlay = document.getElementById('lit_rd_reader_overlay');
    const titleEl = document.getElementById('lit_rd_reader_title');
    const bodyEl = document.getElementById('lit_rd_reader_body');
    const progressEl = document.getElementById('lit_rd_reader_progress');

    if (!overlay || !titleEl || !bodyEl) return;

    // Header info
    titleEl.textContent = page.chapterTitle;
    if (progressEl) {
        progressEl.textContent = `${pageIdx + 1} / ${pages.length}`;
    }

    // Check if this page has notes already
    const freshData = loadReadingData();
    const freshBook = freshData.userBooks.find(b => b.id === book.id);
    const existingNote = freshBook?.notes?.[pageKey];
    const hasNotes = existingNote && (existingNote.user || existingNote.char);

    // Update note trigger indicator
    const noteTrigger = document.getElementById('lit_rd_note_trigger');
    if (noteTrigger) {
        noteTrigger.classList.toggle('has-note', !!hasNotes);
    }

    // Format paragraphs for this page
    const paragraphs = page.content.split(/\n+/).filter(p => p.trim());
    let bodyHtml = paragraphs.map(p =>
        `<p class="lit-reader-paragraph">${escapeHtml(p.trim())}</p>`
    ).join('');

    // Navigation
    const hasNext = pageIdx < pages.length - 1;
    const hasPrev = pageIdx > 0;
    bodyHtml += `
        <div class="lit-reader-nav">
            ${hasPrev ? `<button class="lit-reader-nav-btn" id="lit_rd_prev">上一页</button>` : '<span></span>'}
            <span class="lit-reader-progress">P${pageIdx + 1} / ${pages.length}</span>
            ${hasNext ? `<button class="lit-reader-nav-btn" id="lit_rd_next">下一页</button>` : '<span></span>'}
        </div>
    `;

    bodyEl.innerHTML = bodyHtml;
    overlay.classList.add('active');
    bodyEl.scrollTop = 0;

    // Close note panel if open
    document.getElementById('lit_rd_note_panel')?.classList.remove('active');
    document.getElementById('lit_rd_note_backdrop')?.classList.remove('active');

    // Update reading progress
    if (freshBook) {
        const newChapterProgress = Math.max(
            freshBook.progress?.chapterIdx || 0,
            page.chapterIdx + 1
        );
        updateBookProgress(freshData, book.id, { chapterIdx: newChapterProgress });
    }

    // ── Bind note trigger button ──
    const triggerBtn = document.getElementById('lit_rd_note_trigger');
    const notePanel = document.getElementById('lit_rd_note_panel');
    const notePanelBody = document.getElementById('lit_rd_note_panel_body');

    // Clone to remove old listeners
    if (triggerBtn) {
        const newTrigger = triggerBtn.cloneNode(true);
        triggerBtn.replaceWith(newTrigger);
        newTrigger.addEventListener('click', () => {
            _renderNotePanel(notePanelBody, book, pageIdx, pages.length, charName);
            notePanel?.classList.add('active');
            document.getElementById('lit_rd_note_backdrop')?.classList.add('active');
        });
    }

    // Close panel
    const closePanel = () => {
        notePanel?.classList.remove('active');
        document.getElementById('lit_rd_note_backdrop')?.classList.remove('active');
    };

    const panelCloseBtn = document.getElementById('lit_rd_note_panel_close');
    if (panelCloseBtn) {
        const newClose = panelCloseBtn.cloneNode(true);
        panelCloseBtn.replaceWith(newClose);
        newClose.addEventListener('click', closePanel);
    }

    // Backdrop click to close
    const backdrop = document.getElementById('lit_rd_note_backdrop');
    if (backdrop) {
        const newBackdrop = backdrop.cloneNode(true);
        backdrop.replaceWith(newBackdrop);
        newBackdrop.addEventListener('click', closePanel);
    }

    // Nav buttons
    document.getElementById('lit_rd_prev')?.addEventListener('click', () => {
        _openReader(container, book, pageIdx - 1);
    });
    document.getElementById('lit_rd_next')?.addEventListener('click', () => {
        _openReader(container, book, pageIdx + 1);
    });
}

// ═════════════════════════════════════════════════════════════════════
// Note Panel — User thought + Character response
// ═════════════════════════════════════════════════════════════════════

function _renderNotePanel(panelBody, book, pageIdx, totalPages, charName) {
    const pageKey = `p_${pageIdx}`;
    const freshData = loadReadingData();
    const freshBook = freshData.userBooks.find(b => b.id === book.id);
    const note = freshBook?.notes?.[pageKey] || {};

    let html = `
        <!-- User thought section -->
        <div class="lit-rd-note-user-section">
            <div class="lit-rd-note-label">
                <i class="ph-fill ph-user"></i> 我的感想
            </div>
            ${note.user ? `
                <div class="lit-rd-note-saved-text">${escapeHtml(note.user)}</div>
                <button class="lit-rd-note-edit-btn" id="lit_rd_note_edit">
                    <i class="ph ph-pencil-simple"></i> 编辑
                </button>
            ` : `
                <textarea class="lit-rd-note-textarea" id="lit_rd_note_input"
                    placeholder="读到这里有什么想法……" rows="3"></textarea>
                <button class="lit-rd-note-save-btn" id="lit_rd_note_save">
                    <i class="ph ph-floppy-disk"></i> 保存感想
                </button>
            `}
        </div>

        <div class="lit-rd-note-divider"></div>

        <!-- Character section -->
        <div class="lit-rd-note-char-section">
            <div class="lit-rd-note-label">
                <i class="ph-fill ph-chat-circle-text"></i> ${escapeHtml(charName)}的感想
            </div>
            ${note.char ? `
                <div class="lit-rd-note-char-content">${escapeHtml(note.char)}</div>
            ` : (note.user ? `
                <button class="lit-rd-note-ask-btn" id="lit_rd_note_ask">
                    <i class="ph ph-chat-circle-text"></i> 让 ${escapeHtml(charName)} 也说说
                </button>
            ` : `
                <div class="lit-rd-note-char-hint">先写下你的感想，再让 ${escapeHtml(charName)} 回应</div>
            `)}
        </div>
    `;

    panelBody.innerHTML = html;

    // ── Bind: save user thought ──
    document.getElementById('lit_rd_note_save')?.addEventListener('click', () => {
        const input = document.getElementById('lit_rd_note_input');
        const text = input?.value?.trim();
        if (!text) {
            showToast('写点什么再保存吧~');
            return;
        }
        const freshData2 = loadReadingData();
        addBookNote(freshData2, book.id, pageKey, 'user', text);
        showToast('感想已保存');

        // Update trigger icon
        document.getElementById('lit_rd_note_trigger')?.classList.add('has-note');

        // Re-render panel to show saved state + ask button
        _renderNotePanel(panelBody, book, pageIdx, totalPages, charName);
    });

    // ── Bind: edit user thought ──
    document.getElementById('lit_rd_note_edit')?.addEventListener('click', () => {
        const section = panelBody.querySelector('.lit-rd-note-user-section');
        if (!section) return;
        section.innerHTML = `
            <div class="lit-rd-note-label">
                <i class="ph-fill ph-user"></i> 我的感想
            </div>
            <textarea class="lit-rd-note-textarea" id="lit_rd_note_input"
                rows="3">${escapeHtml(note.user || '')}</textarea>
            <button class="lit-rd-note-save-btn" id="lit_rd_note_save_edit">
                <i class="ph ph-floppy-disk"></i> 保存修改
            </button>
        `;
        document.getElementById('lit_rd_note_save_edit')?.addEventListener('click', () => {
            const input = document.getElementById('lit_rd_note_input');
            const text = input?.value?.trim();
            if (!text) return;
            const freshData3 = loadReadingData();
            addBookNote(freshData3, book.id, pageKey, 'user', text);
            showToast('已更新');
            _renderNotePanel(panelBody, book, pageIdx, totalPages, charName);
        });
    });

    // ── Bind: ask character ──
    document.getElementById('lit_rd_note_ask')?.addEventListener('click', async () => {
        const btn = document.getElementById('lit_rd_note_ask');
        if (!btn || btn.disabled) return;
        btn.disabled = true;
        btn.innerHTML = `<i class="ph ph-spinner ph-spin"></i> ${escapeHtml(charName)}正在思考……`;

        try {
            const freshData4 = loadReadingData();
            const freshBook4 = freshData4.userBooks.find(b => b.id === book.id);
            const userThought = freshBook4?.notes?.[pageKey]?.user || '';

            const charNote = await generateReadingNote({
                bookTitle: book.title,
                bookAuthor: book.author,
                bookSummary: freshBook4?.summary || '',
                pageNum: pageIdx + 1,
                totalPages,
                userThought,
            });

            // Save character's note
            const freshData5 = loadReadingData();
            addBookNote(freshData5, book.id, pageKey, 'char', charNote);

            // Re-render panel
            _renderNotePanel(panelBody, book, pageIdx, totalPages, charName);
        } catch (err) {
            console.error('[\u6587\u5b66] Reading note gen failed:', err);
            showToast('生成失败\uff1a' + err.message);
            btn.disabled = false;
            btn.innerHTML = `<i class="ph ph-chat-circle-text"></i> 让 ${escapeHtml(charName)} 也说说`;
        }
    });
}

function _bindSummaryEditBtn(section, book) {
    const editBtn = section?.querySelector('#lit_rd_summary_edit');
    if (!editBtn) return;
    editBtn.addEventListener('click', () => {
        // Remove display elements
        section.querySelector('.lit-rd-summary-text')?.remove();
        editBtn.remove();
        // Create edit elements
        const textarea = document.createElement('textarea');
        textarea.className = 'lit-rd-summary-input';
        textarea.id = 'lit_rd_book_summary';
        textarea.placeholder = '简要描述这本书的主题、背景或故事梗概……（可选）';
        textarea.rows = 2;
        textarea.value = book.summary || '';
        section.appendChild(textarea);

        const saveBtn = document.createElement('button');
        saveBtn.className = 'lit-rd-summary-save-btn';
        saveBtn.id = 'lit_rd_summary_save';
        saveBtn.textContent = '保存简介';
        section.appendChild(saveBtn);

        textarea.focus();

        saveBtn.addEventListener('click', () => {
            const val = textarea.value.trim();
            if (!val) { showToast('写点什么再保存吧~'); return; }
            const freshData = loadReadingData();
            updateBookSummary(freshData, book.id, val);
            book.summary = val;
            showToast('简介已保存');
            // Switch back to display
            textarea.remove();
            saveBtn.remove();
            const textDiv = document.createElement('div');
            textDiv.className = 'lit-rd-summary-text';
            textDiv.textContent = val;
            section.appendChild(textDiv);
            const newEditBtn = document.createElement('button');
            newEditBtn.className = 'lit-rd-note-edit-btn';
            newEditBtn.id = 'lit_rd_summary_edit';
            newEditBtn.innerHTML = '<i class="ph ph-pencil-simple"></i> 编辑';
            section.appendChild(newEditBtn);
            _bindSummaryEditBtn(section, book);
        });
    });
}

function _bindBookDetailEvents(container, book) {


    // Save summary button
    document.getElementById('lit_rd_summary_save')?.addEventListener('click', () => {
        const summaryTextarea = document.getElementById('lit_rd_book_summary');
        const val = summaryTextarea?.value?.trim() || '';
        if (!val) { showToast('写点什么再保存吧~'); return; }
        const freshData = loadReadingData();
        updateBookSummary(freshData, book.id, val);
        book.summary = val; // update local ref
        showToast('简介已保存');
        // Switch to display mode
        const section = document.getElementById('lit_rd_summary_section');
        if (section) {
            section.querySelector('.lit-rd-summary-input')?.remove();
            section.querySelector('.lit-rd-summary-save-btn')?.remove();
            const textDiv = document.createElement('div');
            textDiv.className = 'lit-rd-summary-text';
            textDiv.textContent = val;
            section.appendChild(textDiv);
            const editBtn = document.createElement('button');
            editBtn.className = 'lit-rd-note-edit-btn';
            editBtn.id = 'lit_rd_summary_edit';
            editBtn.innerHTML = '<i class="ph ph-pencil-simple"></i> 编辑';
            section.appendChild(editBtn);
            _bindSummaryEditBtn(section, book);
        }
    });

    // Edit summary button (if already saved)
    _bindSummaryEditBtn(document.getElementById('lit_rd_summary_section'), book);

    // Continue reading (opens at last read page)
    document.getElementById('lit_rd_continue')?.addEventListener('click', () => {
        const pages = _paginateBook(book);
        const lastChapter = book.progress?.chapterIdx || 0;
        const pageIdx = Math.max(0, _chapterStartPage(pages, Math.min(lastChapter, book.chapters.length - 1)));
        _openReader(container, book, pageIdx);
    });

    // Chapter clicks (jump to first page of that chapter)
    container.querySelectorAll('.lit-rd-chapter-item').forEach(item => {
        item.addEventListener('click', () => {
            const chIdx = parseInt(item.dataset.chIdx);
            const pages = _paginateBook(book);
            const pageIdx = _chapterStartPage(pages, chIdx);
            if (pageIdx >= 0) _openReader(container, book, pageIdx);
        });
    });

    // Notes navigation clicks
    container.querySelectorAll('.lit-rd-notes-nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const pageIdx = parseInt(item.dataset.pageIdx);
            _openReader(container, book, pageIdx);
        });
    });

    // Reader close
    document.getElementById('lit_rd_reader_close')?.addEventListener('click', () => {
        document.getElementById('lit_rd_reader_overlay')?.classList.remove('active');
        // Refresh detail to update note icons
        _openBookDetail(container, book.id);
    });
}


// ═══════════════════════════════════════════════════════════════════════
// Source Panel Renderer
// ═══════════════════════════════════════════════════════════════════════

const SOURCE_META = {
    gutenberg: { label: 'Gutenberg', icon: 'ph-book-open-text', color: '#22c55e' },
    openLibrary: { label: 'Open Library', icon: 'ph-books', color: '#3b82f6' },
    googleBooks: { label: 'Google Books', icon: 'ph-google-logo', color: '#ea4335' },
};

function _renderSourcePanel(sources, bookIdx, hasSearched) {
    if (!hasSearched) {
        // Not yet searched — show nothing (search will run asynchronously)
        return '';
    }

    if (!sources || sources.length === 0) {
        return ''; // No sources found, show nothing
    }

    const rows = sources.map(s => {
        const meta = SOURCE_META[s.type] || { label: s.type, icon: 'ph-link', color: '#888' };

        if (s.canImport) {
            // Gutenberg — one-click import
            return `
                <div class="lit-source-row">
                    <i class="ph ${meta.icon} lit-source-icon" style="color:${meta.color}"></i>
                    <span class="lit-source-name">${meta.label}</span>
                    <button class="lit-source-import-btn" data-source-id="${s.id}" data-book-idx="${bookIdx}">
                        <i class="ph ph-download-simple"></i> 一键导入
                    </button>
                </div>
            `;
        } else if (s.previewUrl) {
            // External preview link
            return `
                <div class="lit-source-row">
                    <i class="ph ${meta.icon} lit-source-icon" style="color:${meta.color}"></i>
                    <span class="lit-source-name">${meta.label}</span>
                    <button class="lit-source-link" data-url="${escapeHtml(s.previewUrl)}">
                        查看 <i class="ph ph-arrow-square-out"></i>
                    </button>
                </div>
            `;
        }
        return '';
    }).filter(Boolean).join('');

    if (!rows) return '';

    return `
        <div class="lit-source-panel" data-book-idx="${bookIdx}">
            <div class="lit-source-panel-header">
                <i class="ph ph-globe-simple"></i> 电子书资源
            </div>
            ${rows}
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════════════════
// Multi-Source Search Engine
// ═══════════════════════════════════════════════════════════════════════

const GUTENBERG_API = 'https://gutendex.com/books';
const OPENLIBRARY_API = 'https://openlibrary.org/search.json';
const GOOGLE_BOOKS_API = 'https://www.googleapis.com/books/v1/volumes';

/**
 * Search all 3 sources in parallel for each book.
 * Results are saved progressively and the UI is refreshed.
 */
async function _searchAllSources(books, container) {
    console.log('[文学] Starting multi-source search for', books.length, 'books');

    // Run all 3 sources in parallel
    const searches = [
        _searchSourceForAll(books, 'gutenberg', _searchGutenberg),
        _searchSourceForAll(books, 'openLibrary', _searchOpenLibrary),
        _searchSourceForAll(books, 'googleBooks', _searchGoogleBooks),
    ];

    // Each source resolves independently → refresh UI on completion
    for (const search of searches) {
        search.then(() => {
            // Only refresh if we're still on the char shelf
            if (_activeShelf === 'char' && container) {
                const contentEl = document.getElementById('lit_shelf_content');
                if (contentEl) {
                    _renderCharBookshelf(container, contentEl, loadReadingData());
                }
            }
        }).catch(err => {
            console.warn('[文学] Source search batch error:', err);
        });
    }
}

/**
 * Run a single source searcher across all books, saving results progressively.
 */
async function _searchSourceForAll(books, sourceType, searchFn) {
    for (let i = 0; i < books.length; i++) {
        try {
            const result = await searchFn(books[i].title, books[i].author);
            if (result) {
                const freshData = loadReadingData();
                if (freshData.charBookshelf?.[i]) {
                    if (!freshData.charBookshelf[i].sources) {
                        freshData.charBookshelf[i].sources = [];
                    }
                    // Avoid duplicates
                    const exists = freshData.charBookshelf[i].sources.some(s => s.type === sourceType);
                    if (!exists) {
                        freshData.charBookshelf[i].sources.push(result);
                    }
                    freshData.charBookshelf[i].sourcesSearched = true;
                    saveReadingData(freshData);
                }
            } else {
                // Mark as searched even if not found
                const freshData = loadReadingData();
                if (freshData.charBookshelf?.[i]) {
                    freshData.charBookshelf[i].sourcesSearched = true;
                    saveReadingData(freshData);
                }
            }
        } catch (e) {
            console.warn(`[文学] ${sourceType} search failed for "${books[i].title}":`, e);
            // Mark as searched to avoid retry
            const freshData = loadReadingData();
            if (freshData.charBookshelf?.[i]) {
                freshData.charBookshelf[i].sourcesSearched = true;
                saveReadingData(freshData);
            }
        }
    }
}

// ── Gutenberg Search ──

async function _searchGutenberg(title, _author) {
    const query = encodeURIComponent(title);
    const resp = await fetch(`${GUTENBERG_API}?search=${query}`);
    if (!resp.ok) return null;

    const json = await resp.json();
    if (!json.results?.length) return null;

    const match = json.results[0];
    const textUrl = match.formats?.['text/plain; charset=utf-8']
        || match.formats?.['text/plain']
        || match.formats?.['text/plain; charset=us-ascii'];

    if (!textUrl) return null;

    return {
        type: 'gutenberg',
        id: String(match.id),
        title: match.title || title,
        author: match.authors?.map(a => a.name).join(', ') || '',
        downloadUrl: textUrl,
        previewUrl: `https://www.gutenberg.org/ebooks/${match.id}`,
        coverUrl: match.formats?.['image/jpeg'] || null,
        canImport: true,
    };
}

// ── Open Library Search ──

async function _searchOpenLibrary(title, author) {
    let q = title;
    if (author) q += ' ' + author;

    const params = new URLSearchParams({
        q,
        limit: '3',
        fields: 'key,title,author_name,cover_i,first_publish_year,edition_key,ebook_access',
    });

    const resp = await fetch(`${OPENLIBRARY_API}?${params}`);
    if (!resp.ok) return null;

    const json = await resp.json();
    if (!json.docs?.length) return null;

    const match = json.docs.find(d => d.ebook_access === 'borrowable' || d.ebook_access === 'public') || json.docs[0];
    const workKey = match.key; // e.g. "/works/OL12345W"
    const coverId = match.cover_i;

    return {
        type: 'openLibrary',
        id: workKey || '',
        title: match.title || title,
        author: match.author_name?.join(', ') || '',
        downloadUrl: null,
        previewUrl: `https://openlibrary.org${workKey}`,
        coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : null,
        canImport: false,
    };
}

// ── Google Books Search ──

async function _searchGoogleBooks(title, author) {
    let q = title;
    if (author) q += ' ' + author;

    const params = new URLSearchParams({
        q,
        maxResults: '3',
        filter: 'ebooks', // Only return true eBooks
        printType: 'books',
    });

    const resp = await fetch(`${GOOGLE_BOOKS_API}?${params}`);
    if (!resp.ok) return null;

    // Find the first item that actually has ebook saleability or epub/pdf download available
    const match = json.items.find(item => {
        const sale = item.saleInfo;
        const access = item.accessInfo;
        return (sale && sale.isEbook) || (access && (access.epub?.isAvailable || access.pdf?.isAvailable));
    }) || json.items[0];

    const vol = match.volumeInfo;
    const id = match.id;

    return {
        type: 'googleBooks',
        id: id || '',
        title: vol?.title || title,
        author: vol?.authors?.join(', ') || '',
        downloadUrl: null,
        previewUrl: vol?.previewLink || `https://books.google.com/books?id=${id}`,
        coverUrl: vol?.imageLinks?.thumbnail || null,
        canImport: false,
    };
}

// ═══════════════════════════════════════════════════════════════════════
// Gutenberg Download (one-click import)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Download a book from Project Gutenberg and parse into chapters.
 */
async function _downloadGutenbergBook(gutenbergId) {
    try {
        const metaResp = await fetch(`${GUTENBERG_API}/${gutenbergId}`);
        if (!metaResp.ok) return null;
        const meta = await metaResp.json();

        // Find plain text URL
        const textUrl = meta.formats?.['text/plain; charset=utf-8']
            || meta.formats?.['text/plain']
            || meta.formats?.['text/plain; charset=us-ascii'];

        if (!textUrl) {
            showToast('未找到纯文本版本');
            return null;
        }

        const textResp = await fetch(textUrl);
        if (!textResp.ok) return null;
        const text = await textResp.text();

        // Strip Gutenberg header/footer (between *** START and *** END markers)
        let cleanText = text;
        const startMarker = text.indexOf('*** START');
        const endMarker = text.indexOf('*** END');
        if (startMarker !== -1) {
            const afterStart = text.indexOf('\n', startMarker);
            cleanText = endMarker !== -1
                ? text.substring(afterStart + 1, endMarker).trim()
                : text.substring(afterStart + 1).trim();
        }

        const chapters = _splitIntoChapters(cleanText);
        const title = meta.title || '未知书名';
        const author = meta.authors?.map(a => a.name).join(', ') || '未知作者';

        return { title, author, chapters };
    } catch (e) {
        console.error('[文学] Gutenberg download error:', e);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Back Button Integration
// ═══════════════════════════════════════════════════════════════════════

let _readingBackBound = false;

export function bindReadingBackButton() {
    if (_readingBackBound) return;

    window.addEventListener('phone-app-back', (e) => {
        // Note panel (highest priority — close before reader)
        const notePanel = document.getElementById('lit_rd_note_panel');
        if (notePanel?.classList.contains('active')) {
            e.preventDefault();
            notePanel.classList.remove('active');
            document.getElementById('lit_rd_note_backdrop')?.classList.remove('active');
            return;
        }

        // Reader overlay
        const readerOverlay = document.getElementById('lit_rd_reader_overlay');
        if (readerOverlay?.classList.contains('active')) {
            e.preventDefault();
            readerOverlay.classList.remove('active');
            // Refresh detail to update note icons
            const bookDetail = document.querySelector('.lit-book-detail');
            if (bookDetail) {
                const container = document.getElementById('lit_tab_reading');
                const bookId = bookDetail.querySelector('[data-book-id]')?.dataset.bookId;
                if (container && bookId) {
                    _openBookDetail(container, bookId);
                }
            }
            return;
        }

        // Book detail → back to shelf
        const bookDetail = document.querySelector('.lit-book-detail');
        if (bookDetail) {
            e.preventDefault();
            const container = document.getElementById('lit_tab_reading');
            if (container) _renderShelfView(container, loadReadingData());
            return;
        }
    });

    _readingBackBound = true;
}

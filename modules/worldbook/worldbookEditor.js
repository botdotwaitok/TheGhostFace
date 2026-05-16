// modules/worldbook/worldbookEditor.js — Standalone window controller.
// Runs inside the editor popup. Talks to the main ST window through
// BroadcastChannel('gf-worldbook-bridge') using a tiny RPC client.

const LOG = '[WorldBook Editor]';
const CHANNEL_NAME = 'gf-worldbook-bridge';

// Position values map to SillyTavern's world_info_position enum in scripts/world-info.js.
// Historic note: pos 2/3 were mislabeled as Before/After EM in early versions of this
// editor. ST has always treated them as Before/After Author's Note; EM lives at 5/6.
const POSITION_LABELS = {
    0: '角色定义之前',
    1: '角色定义之后',
    2: '作者注释之前',
    3: '作者注释之后',
    4: '@深度',
    5: '示例消息前',
    6: '示例消息后',
    7: '锚点',
};

// Default template used when creating a brand-new entry (mirrors ST's newWorldInfoEntryTemplate
// for the subset MVP exposes). Anything not listed here will be filled by ST's createWorldInfoEntry.
const NEW_ENTRY_DEFAULTS = {
    key: [],
    comment: '',
    content: '',
    constant: false,
    disable: false,
    position: 0,
    order: 100,
    depth: 4,
};

// Separators we accept in the keys textarea: English/Chinese comma, semicolon, newline.
const KEY_SPLIT_RE = /[,，;；\n]+/;

const _channel = new BroadcastChannel(CHANNEL_NAME);
const _pending = new Map();
let _rpcSeq = 0;

// Local state mirror.
const state = {
    initPayload: null,
    selectedBook: null,
    bookCache: new Map(),
    bookFilter: '',
    bridgeStatus: 'idle',
    /** @type {null | {bookName: string, uid: number|null, isNew: boolean, entry: any}} */
    editing: null,
    saving: false,
    /** @type {'entries' | 'occupancy'} */
    view: 'entries',
    /** @type {null | {selectedBooks: Set<string>, data: any, loading: boolean, error: string|null, invalid: boolean}} */
    occupancy: null,
    bookGroupCollapsed: { active: false, inactive: false },
    sidebarCollapsed: false,
    /** @type {null | {query: string, hits: Array<any>, isLoading: boolean, progress: {loaded:number,total:number}}} */
    search: null,
    selectMode: false,
    /** @type {Set<number>} uids selected in the current book */
    selectedUids: new Set(),
    /** book name that selection is tied to; cleared on book/tab switch */
    selectionBook: null,
    /** guard against double-fire while a batch op is running */
    batchRunning: false,
    /** @type {'all' | 'active' | 'constant' | 'keyword' | 'disabled'} */
    entryFilter: 'all',
};

const FILTER_OPTIONS = [
    { key: 'all',      label: '全部' },
    { key: 'active',   label: '已激活' },
    { key: 'constant', label: '始终生效' },
    { key: 'keyword',  label: '关键词' },
    { key: 'disabled', label: '已停用' },
];

function _entryMatchesFilter(entry, filter) {
    switch (filter) {
        case 'active':   return !entry.disable;
        case 'constant': return !!entry.constant && !entry.disable;
        case 'keyword':  return !entry.constant && !entry.disable;
        case 'disabled': return !!entry.disable;
        case 'all':
        default:         return true;
    }
}

let _searchTimer = null;
let _searchSeq = 0;

_channel.onmessage = (event) => {
    const data = event.data || {};

    if (data.type === 'init') {
        state.initPayload = data.payload || {};
        console.log(`${LOG} Init received:`, state.initPayload);
        _renderBookList();
        _renderCharBadge();
        _setBridgeStatus('ok', 'bridge OK');
        // If the user is already on the occupancy tab when init arrives, refresh it.
        if (state.view === 'occupancy') {
            state.occupancy = null;
            _switchView('occupancy');
        }
        return;
    }

    if (data.id && _pending.has(data.id)) {
        const { resolve, reject } = _pending.get(data.id);
        _pending.delete(data.id);
        if (data.error) reject(new Error(data.error));
        else resolve(data.result);
    }
};

function rpc(method, args, timeoutMs = 10000) {
    const id = `wb-${Date.now()}-${++_rpcSeq}`;
    return new Promise((resolve, reject) => {
        _pending.set(id, { resolve, reject });
        _channel.postMessage({ id, method, args });

        setTimeout(() => {
            if (_pending.has(id)) {
                _pending.delete(id);
                reject(new Error(`RPC '${method}' timed out after ${timeoutMs}ms`));
            }
        }, timeoutMs);
    });
}

function _setBridgeStatus(level, label) {
    state.bridgeStatus = level;
    const dot = document.getElementById('wb-bridge-dot');
    const text = document.getElementById('wb-bridge-status');
    if (dot) {
        dot.classList.remove('ok', 'err');
        if (level === 'ok') dot.classList.add('ok');
        if (level === 'err') dot.classList.add('err');
    }
    if (text) text.textContent = label;
}

function _renderCharBadge() {
    const el = document.getElementById('wb-current-char');
    if (!el) return;
    const c = state.initPayload?.currentChar;
    if (!c) {
        el.innerHTML = '<i class="ph ph-user-circle-minus"></i> 未选中角色';
        return;
    }
    el.innerHTML = `<i class="ph ph-user-circle"></i> ${escapeHtml(c.name || '(未命名)')}`;
}

function _classifyBook(name) {
    const active = state.initPayload?.activeBooks || { global: [], character: [], charLore: [] };
    const tags = [];
    if (active.global?.includes(name)) tags.push({ key: 'global', label: '全局' });
    if (active.character?.includes(name)) tags.push({ key: 'character', label: '角色' });
    if (active.charLore?.includes(name)) tags.push({ key: 'charLore', label: 'charLore' });
    return tags;
}

function _renderBookList() {
    const list = document.getElementById('wb-book-list');
    if (!list) return;

    if (state.search) {
        _renderSearchResults(list);
        return;
    }

    const allNames = state.initPayload?.allBookNames || [];

    const active = [];
    const inactive = [];
    for (const name of allNames) {
        if (_classifyBook(name).length > 0) active.push(name);
        else inactive.push(name);
    }

    let html = '';
    html += _renderBookGroup('已激活', active, 'active');
    html += _renderBookGroup('全部', inactive, 'inactive');

    if (allNames.length === 0) {
        html = '<div class="wb-empty-mini">没有可用的世界书</div>';
    }

    list.innerHTML = html;

    list.querySelectorAll('.wb-book-item').forEach(el => {
        el.addEventListener('click', () => {
            const name = el.dataset.name;
            _selectBook(name);
        });
    });

    list.querySelectorAll('.wb-book-group-title').forEach(el => {
        el.addEventListener('click', () => {
            const kind = el.parentElement?.dataset.kind;
            if (kind !== 'active' && kind !== 'inactive') return;
            state.bookGroupCollapsed[kind] = !state.bookGroupCollapsed[kind];
            _renderBookList();
        });
    });

    _highlightSelectedBook();
}

function _scheduleGlobalSearch(value) {
    state.bookFilter = value;
    clearTimeout(_searchTimer);
    const trimmed = value.trim();
    if (!trimmed) {
        state.search = null;
        _renderBookList();
        return;
    }
    _searchTimer = setTimeout(() => _runGlobalSearch(trimmed), 220);
}

async function _runGlobalSearch(query) {
    const seq = ++_searchSeq;
    const allNames = state.initPayload?.allBookNames || [];
    state.search = {
        query,
        hits: [],
        isLoading: true,
        progress: { loaded: 0, total: allNames.length },
    };
    _collectSearchHits(query);
    _renderBookList();

    const toLoad = allNames.filter(n => !state.bookCache.has(n));
    state.search.progress.loaded = allNames.length - toLoad.length;

    if (toLoad.length === 0) {
        state.search.isLoading = false;
        _renderBookList();
        return;
    }

    const concurrency = 5;
    let cursor = 0;
    let pendingRender = false;
    const scheduleRender = () => {
        if (pendingRender) return;
        pendingRender = true;
        setTimeout(() => {
            pendingRender = false;
            if (_searchSeq !== seq) return;
            _collectSearchHits(query);
            _renderBookList();
        }, 60);
    };

    const workers = Array.from({ length: Math.min(concurrency, toLoad.length) }, () => (async () => {
        while (cursor < toLoad.length && _searchSeq === seq) {
            const name = toLoad[cursor++];
            try {
                const book = await rpc('loadBook', { name });
                if (book) state.bookCache.set(name, book);
            } catch (e) {
                console.warn(`${LOG} Search loadBook '${name}' failed:`, e);
            }
            if (_searchSeq !== seq) return;
            state.search.progress.loaded += 1;
            scheduleRender();
        }
    })());
    await Promise.all(workers);

    if (_searchSeq !== seq) return;
    state.search.isLoading = false;
    _collectSearchHits(query);
    _renderBookList();
}

const SNIPPET_CTX = 50;

function _collectSearchHits(query) {
    const q = query.toLowerCase();
    const allNames = state.initPayload?.allBookNames || [];
    const hits = [];
    for (const bookName of allNames) {
        if (bookName.toLowerCase().includes(q)) {
            hits.push({ kind: 'book', bookName });
        }
        const book = state.bookCache.get(bookName);
        if (!book || !book.entries) continue;
        for (const uidKey of Object.keys(book.entries)) {
            const e = book.entries[uidKey];
            if (!e) continue;
            const comment = String(e.comment || '');
            const content = String(e.content || '');
            const keys = Array.isArray(e.key) ? e.key.map(k => String(k)) : [];
            const fields = [];
            if (comment.toLowerCase().includes(q)) fields.push('comment');
            if (keys.some(k => k.toLowerCase().includes(q))) fields.push('keys');
            if (content.toLowerCase().includes(q)) fields.push('content');
            if (fields.length === 0) continue;

            let snippetSource = '';
            if (fields.includes('content')) snippetSource = content;
            else if (fields.includes('comment')) snippetSource = comment;
            else snippetSource = keys.find(k => k.toLowerCase().includes(q)) || keys.join(' / ');

            hits.push({
                kind: 'entry',
                bookName,
                uid: Number(e.uid ?? uidKey),
                comment,
                keys,
                fields,
                snippet: _makeSnippet(snippetSource, q),
            });
        }
    }
    if (state.search) state.search.hits = hits;
}

function _makeSnippet(text, q) {
    if (!text) return '';
    const lower = text.toLowerCase();
    const idx = lower.indexOf(q.toLowerCase());
    if (idx < 0) return text.length > 140 ? text.slice(0, 140) + '…' : text;
    const start = Math.max(0, idx - SNIPPET_CTX);
    const end = Math.min(text.length, idx + q.length + SNIPPET_CTX);
    return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

function _highlightText(text, q) {
    if (!q) return escapeHtml(text);
    const lower = text.toLowerCase();
    const qLower = q.toLowerCase();
    const parts = [];
    let i = 0;
    while (i < text.length) {
        const idx = lower.indexOf(qLower, i);
        if (idx < 0) {
            parts.push(escapeHtml(text.slice(i)));
            break;
        }
        if (idx > i) parts.push(escapeHtml(text.slice(i, idx)));
        parts.push(`<mark class="wb-hl">${escapeHtml(text.slice(idx, idx + q.length))}</mark>`);
        i = idx + q.length;
    }
    return parts.join('');
}

const SEARCH_FIELD_LABELS = { comment: '标题', keys: '关键词', content: '内容' };

function _renderSearchResults(list) {
    const s = state.search;
    if (!s) return;
    const q = s.query;
    const bookHits = s.hits.filter(h => h.kind === 'book');
    const entryHits = s.hits.filter(h => h.kind === 'entry');

    const progressText = s.isLoading
        ? `<div class="wb-search-progress"><i class="ph ph-spinner-gap"></i> 正在搜索 ${s.progress.loaded}/${s.progress.total} 本书…</div>`
        : '';

    let body = '';
    if (bookHits.length > 0) {
        body += `
            <div class="wb-search-group">
                <div class="wb-search-group-title">匹配的世界书 <span class="wb-count">${bookHits.length}</span></div>
                <div class="wb-search-group-body">
                    ${bookHits.map(h => {
                        const tags = _classifyBook(h.bookName);
                        const tagsHtml = tags.map(t => `<span class="wb-tag wb-tag-${t.key}">${t.label}</span>`).join('');
                        return `
                            <div class="wb-book-item" data-name="${escapeAttr(h.bookName)}">
                                <span class="wb-book-name" title="${escapeAttr(h.bookName)}">${_highlightText(h.bookName, q)}</span>
                                ${tagsHtml ? `<span class="wb-book-tags">${tagsHtml}</span>` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    if (entryHits.length > 0) {
        body += `
            <div class="wb-search-group">
                <div class="wb-search-group-title">匹配的条目 <span class="wb-count">${entryHits.length}</span></div>
                <div class="wb-search-group-body">
                    ${entryHits.map(h => {
                        const title = (h.comment || '').trim() || h.keys[0] || `UID ${h.uid}`;
                        const fieldTags = h.fields.map(f => `<span class="wb-search-field wb-search-field-${f}">${SEARCH_FIELD_LABELS[f] || f}</span>`).join('');
                        const tags = _classifyBook(h.bookName);
                        const bookTagsHtml = tags.map(t => `<span class="wb-tag wb-tag-${t.key}">${t.label}</span>`).join('');
                        return `
                            <div class="wb-search-hit" data-book="${escapeAttr(h.bookName)}" data-uid="${h.uid}" title="${escapeAttr(h.bookName + ' · UID ' + h.uid)}">
                                <div class="wb-search-hit-head">
                                    <span class="wb-search-hit-title">${_highlightText(title, q)}</span>
                                    <span class="wb-search-hit-fields">${fieldTags}</span>
                                </div>
                                <div class="wb-search-hit-book">
                                    <i class="ph ph-book"></i>
                                    <span>${_highlightText(h.bookName, q)}</span>
                                    ${bookTagsHtml}
                                </div>
                                ${h.snippet ? `<div class="wb-search-hit-snippet">${_highlightText(h.snippet, q)}</div>` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    if (bookHits.length === 0 && entryHits.length === 0 && !s.isLoading) {
        body = '<div class="wb-empty-mini">没有匹配项</div>';
    }

    list.innerHTML = progressText + body;

    list.querySelectorAll('.wb-book-item').forEach(el => {
        el.addEventListener('click', () => {
            const name = el.dataset.name;
            if (name) _selectBook(name);
        });
    });

    list.querySelectorAll('.wb-search-hit').forEach(el => {
        el.addEventListener('click', () => {
            const bookName = el.dataset.book;
            const uid = Number(el.dataset.uid);
            if (!bookName || !Number.isInteger(uid)) return;
            _openDrawerForEditByName(bookName, uid);
        });
    });
}

function _renderBookGroup(label, names, kind) {
    if (names.length === 0) return '';
    const collapsed = !!state.bookGroupCollapsed[kind];
    return `
        <div class="wb-book-group ${collapsed ? 'is-collapsed' : ''}" data-kind="${kind}">
            <div class="wb-book-group-title" role="button" aria-expanded="${!collapsed}">
                <i class="ph ph-caret-down wb-book-group-caret"></i>
                <span class="wb-book-group-label">${label}</span>
                <span class="wb-count">${names.length}</span>
            </div>
            <div class="wb-book-group-body">
                ${names.map(name => {
                    const tags = _classifyBook(name);
                    const tagsHtml = tags.map(t => `<span class="wb-tag wb-tag-${t.key}">${t.label}</span>`).join('');
                    return `
                        <div class="wb-book-item" data-name="${escapeAttr(name)}">
                            <span class="wb-book-name" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
                            ${tagsHtml ? `<span class="wb-book-tags">${tagsHtml}</span>` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function _highlightSelectedBook() {
    document.querySelectorAll('.wb-book-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.name === state.selectedBook);
    });
}

async function _selectBook(name) {
    if (!name) return;
    state.selectedBook = name;
    _highlightSelectedBook();

    const detail = document.getElementById('wb-detail');
    if (!detail) return;

    detail.innerHTML = `
        <div class="wb-detail-loading">
            <i class="ph ph-spinner-gap"></i> 加载 <strong>${escapeHtml(name)}</strong>...
        </div>
    `;

    let book = state.bookCache.get(name);
    if (!book) {
        try {
            book = await rpc('loadBook', { name });
            if (book) state.bookCache.set(name, book);
        } catch (e) {
            detail.innerHTML = `<div class="wb-detail-error">加载失败：${escapeHtml(e.message)}</div>`;
            return;
        }
    }

    if (!book || !book.entries) {
        detail.innerHTML = `<div class="wb-detail-empty">世界书 <strong>${escapeHtml(name)}</strong> 没有条目，或加载失败</div>`;
        return;
    }

    _renderEntries(name, book);
}

function _renderEntries(bookName, book) {
    const entries = Object.values(book.entries);
    entries.sort((a, b) => {
        const ap = a.position ?? 1;
        const bp = b.position ?? 1;
        if (ap !== bp) return ap - bp;
        const ao = a.order ?? 100;
        const bo = b.order ?? 100;
        return ao - bo;
    });

    const tags = _classifyBook(bookName);
    const tagsHtml = tags.map(t => `<span class="wb-tag wb-tag-${t.key}">${t.label}</span>`).join('');

    // If the selection was tied to a different book, drop it now.
    if (state.selectionBook && state.selectionBook !== bookName) {
        state.selectMode = false;
        state.selectedUids = new Set();
        state.selectionBook = null;
    }

    const isSelectMode = state.selectMode;
    const selCount = state.selectedUids.size;

    // Per-filter counts so chips can show "已激活 8" etc.
    const filterCounts = {};
    for (const opt of FILTER_OPTIONS) {
        filterCounts[opt.key] = entries.filter(e => _entryMatchesFilter(e, opt.key)).length;
    }
    const visibleEntries = entries.filter(e => _entryMatchesFilter(e, state.entryFilter));

    const chipsHtml = FILTER_OPTIONS.map(opt => `
        <button type="button"
                class="wb-filter-chip ${state.entryFilter === opt.key ? 'is-active' : ''}"
                data-filter="${opt.key}">
            ${opt.label}<span class="wb-filter-chip-count">${filterCounts[opt.key]}</span>
        </button>
    `).join('');

    let listHtml;
    if (entries.length === 0) {
        listHtml = '<div class="wb-detail-empty">这本世界书是空的</div>';
    } else if (visibleEntries.length === 0) {
        listHtml = '<div class="wb-detail-empty">当前筛选下没有匹配的条目</div>';
    } else {
        listHtml = visibleEntries.map(e => _renderEntryCard(e, isSelectMode, state.selectedUids.has(Number(e.uid)))).join('');
    }

    const detail = document.getElementById('wb-detail');
    detail.innerHTML = `
        <div class="wb-detail-header">
            <div class="wb-detail-header-row">
                <h2><i class="ph ph-book"></i> ${escapeHtml(bookName)}</h2>
                <div class="wb-detail-header-actions">
                    <button id="wb-select-toggle" class="wb-btn wb-btn-ghost ${isSelectMode ? 'is-active' : ''}" type="button">
                        <i class="ph ph-list-checks"></i> ${isSelectMode ? '退出选择' : '选择'}
                    </button>
                    <button id="wb-new-entry-btn" class="wb-btn wb-btn-primary" type="button">
                        <i class="ph ph-plus"></i> 新建条目
                    </button>
                </div>
            </div>
            <div class="wb-detail-meta">
                <span>${entries.length} 条目</span>
                ${tagsHtml}
            </div>
            <div class="wb-filter-chips">${chipsHtml}</div>
        </div>
        ${isSelectMode ? `
        <div class="wb-batch-bar" data-visible="${selCount > 0}">
            <span class="wb-batch-count">已选 <strong>${selCount}</strong> 条</span>
            <button class="wb-batch-link" type="button" data-batch-action="selectAll">全选</button>
            <button class="wb-batch-link" type="button" data-batch-action="invert">反选</button>
            <span class="wb-batch-divider" aria-hidden="true"></span>
            <span class="wb-batch-dropdown">
                <button class="wb-batch-link" type="button" data-batch-action="togglePopover" data-popover="mode">
                    <i class="ph ph-toggle-right"></i> 触发方式 <i class="ph ph-caret-down"></i>
                </button>
                <div class="wb-batch-popover" data-popover-name="mode">
                    <button type="button" data-batch-action="setMode" data-mode="constant">
                        <i class="ph ph-lightbulb-filament"></i> 始终生效
                    </button>
                    <button type="button" data-batch-action="setMode" data-mode="selective">
                        <i class="ph ph-key"></i> 关键词触发
                    </button>
                    <button type="button" data-batch-action="setMode" data-mode="disabled">
                        <i class="ph ph-prohibit"></i> 停用
                    </button>
                </div>
            </span>
            <span class="wb-batch-dropdown">
                <button class="wb-batch-link" type="button" data-batch-action="togglePopover" data-popover="copyTo">
                    <i class="ph ph-copy"></i> 复制到 <i class="ph ph-caret-down"></i>
                </button>
                <div class="wb-batch-popover wb-batch-popover-books" data-popover-name="copyTo">
                    ${(state.initPayload?.allBookNames || []).map(name => `
                        <button type="button" data-batch-action="copyTo" data-target-book="${escapeAttr(name)}"
                                title="${escapeAttr(name)}"${name === bookName ? ' data-is-self="true"' : ''}>
                            <i class="ph ph-book"></i>
                            <span class="wb-batch-book-label">${escapeHtml(name)}</span>
                            ${name === bookName ? '<span class="wb-batch-self-tag">当前</span>' : ''}
                        </button>
                    `).join('')}
                    ${(state.initPayload?.allBookNames || []).length === 0
                        ? '<div class="wb-batch-popover-empty">没有可用的世界书</div>' : ''}
                </div>
            </span>
            <span class="wb-batch-dropdown">
                <button class="wb-batch-link" type="button" data-batch-action="togglePopover" data-popover="moveTo">
                    <i class="ph ph-arrow-square-right"></i> 移动到 <i class="ph ph-caret-down"></i>
                </button>
                <div class="wb-batch-popover wb-batch-popover-books" data-popover-name="moveTo">
                    ${(state.initPayload?.allBookNames || []).filter(n => n !== bookName).map(name => `
                        <button type="button" data-batch-action="moveTo" data-target-book="${escapeAttr(name)}"
                                title="${escapeAttr(name)}">
                            <i class="ph ph-book"></i>
                            <span class="wb-batch-book-label">${escapeHtml(name)}</span>
                        </button>
                    `).join('')}
                    ${(state.initPayload?.allBookNames || []).filter(n => n !== bookName).length === 0
                        ? '<div class="wb-batch-popover-empty">没有其他世界书</div>' : ''}
                </div>
            </span>
            <button class="wb-batch-link is-danger" type="button" data-batch-action="delete">
                <i class="ph ph-trash"></i> 删除
            </button>
            <span class="wb-batch-spacer"></span>
            <button class="wb-batch-link is-warn" type="button" data-batch-action="cancel">取消</button>
        </div>
        ` : ''}
        <div class="wb-entry-list">${listHtml}</div>
    `;

    document.getElementById('wb-new-entry-btn')?.addEventListener('click', () => _openDrawerForCreate(bookName));
    document.getElementById('wb-select-toggle')?.addEventListener('click', _toggleSelectMode);

    detail.querySelectorAll('.wb-filter-chip').forEach(el => {
        el.addEventListener('click', () => {
            const key = el.getAttribute('data-filter');
            if (key && key !== state.entryFilter) {
                state.entryFilter = /** @type {any} */ (key);
                _refreshEntriesView();
            }
        });
    });

    // Batch select-all / invert operate on the *visible* list, not the whole book.
    detail.querySelectorAll('[data-batch-action]').forEach(el => {
        el.addEventListener('click', (ev) => {
            const action = el.getAttribute('data-batch-action');
            if (action === 'togglePopover') {
                ev.stopPropagation();
                _toggleBatchPopover(el);
                return;
            }
            _closeAllBatchPopovers();
            if (action === 'setMode') {
                const mode = el.getAttribute('data-mode');
                _handleBatchSetMode(mode, bookName);
                return;
            }
            if (action === 'copyTo') {
                const targetBook = el.getAttribute('data-target-book');
                if (targetBook) _handleBatchCopy(bookName, targetBook);
                return;
            }
            if (action === 'moveTo') {
                const targetBook = el.getAttribute('data-target-book');
                if (targetBook) _handleBatchMove(bookName, targetBook);
                return;
            }
            _handleBatchAction(action, visibleEntries, bookName);
        });
    });
    _ensurePopoverDocClick();

    detail.querySelectorAll('.wb-entry-card').forEach(el => {
        el.addEventListener('click', (ev) => {
            // Ignore clicks bubbling up from the inline edit button (it has its own handler).
            if (ev.target instanceof HTMLElement && ev.target.closest('[data-wb-stop]')) return;
            const uid = Number(el.getAttribute('data-uid'));
            if (!Number.isInteger(uid)) return;
            // In select mode the whole card toggles selection. preventDefault cancels the
            // native checkbox toggle so _toggleSelectUid is the single source of truth.
            if (state.selectMode) {
                ev.preventDefault();
                _toggleSelectUid(uid);
                return;
            }
            _openDrawerForEdit(bookName, uid);
        });
    });
}

function _renderEntryCard(entry, selectMode = false, isSelected = false) {
    const keys = Array.isArray(entry.key) ? entry.key : [];
    const keysHtml = keys.length > 0
        ? keys.map(k => `<span class="wb-key-chip">${escapeHtml(String(k))}</span>`).join('')
        : '<span class="wb-key-empty">(无关键词)</span>';

    const pos = entry.position ?? 1;
    const posLabel = POSITION_LABELS[pos] ?? `位置=${pos}`;
    const order = entry.order ?? 100;
    const depth = pos === 4 ? (entry.depth ?? 0) : null;

    const flags = [];
    if (entry.constant) flags.push('<span class="wb-flag wb-flag-constant">始终生效</span>');
    if (entry.disable) flags.push('<span class="wb-flag wb-flag-disabled">已停用</span>');

    const content = String(entry.content ?? '');
    const contentPreview = content.length > 240 ? content.slice(0, 240) + '...' : content;

    const title = entry.comment?.trim() || keys[0] || `UID ${entry.uid ?? '?'}`;

    const cardClasses = [
        'wb-entry-card',
        entry.disable ? 'is-disabled' : '',
        selectMode ? 'is-select-mode' : '',
        isSelected ? 'is-selected' : '',
    ].filter(Boolean).join(' ');

    const checkboxHtml = selectMode
        ? `<label class="wb-entry-checkbox" data-wb-select><input type="checkbox" ${isSelected ? 'checked' : ''} tabindex="-1" /></label>`
        : '';

    return `
        <article class="${cardClasses}" data-uid="${entry.uid ?? ''}">
            ${checkboxHtml}
            <header class="wb-entry-header">
                <div class="wb-entry-title">${escapeHtml(title)}</div>
                <div class="wb-entry-badges">
                    <span class="wb-badge">${posLabel}</span>
                    ${depth !== null ? `<span class="wb-badge">深度 ${depth}</span>` : ''}
                    <span class="wb-badge">顺序 ${order}</span>
                    ${flags.join('')}
                </div>
            </header>
            <div class="wb-entry-keys">${keysHtml}</div>
            <pre class="wb-entry-content">${escapeHtml(contentPreview) || '<span class="wb-key-empty">(空内容)</span>'}</pre>
        </article>
    `;
}

// ===== Batch selection =====

function _refreshEntriesView() {
    const name = state.selectedBook;
    if (!name) return;
    const book = state.bookCache.get(name);
    if (book) _renderEntries(name, book);
}

function _toggleSelectMode() {
    if (state.selectMode) {
        state.selectMode = false;
        state.selectedUids = new Set();
        state.selectionBook = null;
    } else {
        state.selectMode = true;
        state.selectedUids = new Set();
        state.selectionBook = state.selectedBook;
    }
    _refreshEntriesView();
}

function _toggleSelectUid(uid) {
    if (state.selectedUids.has(uid)) state.selectedUids.delete(uid);
    else state.selectedUids.add(uid);
    _updateCardSelectionUI(uid);
    _updateBatchBarCount();
}

function _updateCardSelectionUI(uid) {
    const card = document.querySelector(`.wb-entry-card[data-uid="${uid}"]`);
    if (!card) return;
    const isSelected = state.selectedUids.has(uid);
    card.classList.toggle('is-selected', isSelected);
    const cb = /** @type {HTMLInputElement|null} */ (card.querySelector('.wb-entry-checkbox input'));
    if (cb) cb.checked = isSelected;
}

function _updateBatchBarCount() {
    const bar = document.querySelector('.wb-batch-bar');
    if (!bar) return;
    const count = state.selectedUids.size;
    bar.setAttribute('data-visible', String(count > 0));
    const countEl = bar.querySelector('.wb-batch-count strong');
    if (countEl) countEl.textContent = String(count);
}

function _handleBatchAction(action, entries, bookName) {
    if (state.batchRunning) return;
    if (action === 'cancel') {
        state.selectMode = false;
        state.selectedUids = new Set();
        state.selectionBook = null;
        _refreshEntriesView();
        return;
    }
    if (action === 'selectAll') {
        for (const e of entries) {
            const uid = Number(e.uid);
            if (Number.isInteger(uid)) state.selectedUids.add(uid);
        }
        _refreshEntriesView();
        return;
    }
    if (action === 'invert') {
        const next = new Set();
        for (const e of entries) {
            const uid = Number(e.uid);
            if (!Number.isInteger(uid)) continue;
            if (!state.selectedUids.has(uid)) next.add(uid);
        }
        state.selectedUids = next;
        _refreshEntriesView();
        return;
    }
    if (action === 'delete') {
        _handleBatchDelete(bookName);
        return;
    }
}

async function _handleBatchDelete(bookName) {
    if (!bookName) return;
    const uids = [...state.selectedUids];
    if (uids.length === 0) return;

    const ok = window.confirm(`确认删除 ${uids.length} 条条目？该操作不可撤销。`);
    if (!ok) return;

    state.batchRunning = true;
    _setBatchBarBusy(true, '删除中...');

    const results = { ok: 0, fail: [] };
    for (const uid of uids) {
        try {
            await rpc('deleteEntry', { bookName, uid });
            results.ok++;
        } catch (err) {
            console.error(`${LOG} Batch delete uid=${uid} failed:`, err);
            results.fail.push({ uid, err });
        }
    }

    state.bookCache.delete(bookName);
    if (state.occupancy) state.occupancy.invalid = true;
    state.selectedUids = new Set();
    state.batchRunning = false;

    try {
        const book = await rpc('loadBook', { name: bookName });
        if (book) state.bookCache.set(bookName, book);
        if (book && book.entries) _renderEntries(bookName, book);
    } catch (e) {
        console.warn(`${LOG} Reload after batch delete failed:`, e);
        _refreshEntriesView();
    }

    if (results.fail.length === 0) {
        _showToast(`已删除 ${results.ok} 条`, 'success');
    } else if (results.ok === 0) {
        _showToast(`删除失败 ${results.fail.length} 条，详见控制台`, 'error');
    } else {
        _showToast(`已删除 ${results.ok} 条，失败 ${results.fail.length} 条，详见控制台`, 'warn');
    }
}

function _setBatchBarBusy(busy, label) {
    const bar = document.querySelector('.wb-batch-bar');
    if (!bar) return;
    bar.classList.toggle('is-busy', busy);
    bar.querySelectorAll('button[data-batch-action]').forEach(btn => {
        /** @type {HTMLButtonElement} */ (btn).disabled = busy;
    });
    if (busy && label) {
        const countEl = bar.querySelector('.wb-batch-count');
        if (countEl) countEl.setAttribute('data-busy-label', label);
    } else {
        const countEl = bar.querySelector('.wb-batch-count');
        if (countEl) countEl.removeAttribute('data-busy-label');
    }
}

const MODE_LABELS = {
    constant: '始终生效',
    selective: '关键词触发',
    disabled: '停用',
};

// ===== Batch copy — duplicate-name resolver =====

/**
 * Generate a unique `comment` within an existing set.
 * Empty comments are returned as-is (no dedup for blank names).
 * Format: base → base(1) → base(2) ...
 */
function _uniqueComment(base, existingComments) {
    if (!base) return base;
    if (!existingComments.has(base)) return base;
    let n = 1;
    while (existingComments.has(`${base}(${n})`)) n++;
    return `${base}(${n})`;
}

async function _handleBatchSetMode(mode, bookName) {
    if (!bookName) return;
    if (!MODE_LABELS[mode]) return;
    const uids = [...state.selectedUids];
    if (uids.length === 0) return;

    const updates = {
        constant: mode === 'constant',
        disable: mode === 'disabled',
    };
    const modeLabel = MODE_LABELS[mode];

    state.batchRunning = true;
    _setBatchBarBusy(true, '更新中...');

    const results = { ok: 0, fail: [] };
    for (const uid of uids) {
        try {
            await rpc('updateEntry', { bookName, uid, updates });
            results.ok++;
        } catch (err) {
            console.error(`${LOG} Batch setMode uid=${uid} failed:`, err);
            results.fail.push({ uid, err });
        }
    }

    state.bookCache.delete(bookName);
    if (state.occupancy) state.occupancy.invalid = true;
    state.batchRunning = false;

    try {
        const book = await rpc('loadBook', { name: bookName });
        if (book) state.bookCache.set(bookName, book);
        if (book && book.entries) _renderEntries(bookName, book);
    } catch (e) {
        console.warn(`${LOG} Reload after batch setMode failed:`, e);
        _refreshEntriesView();
    }

    _setBatchBarBusy(false);

    if (results.fail.length === 0) {
        _showToast(`已设为「${modeLabel}」${results.ok} 条`, 'success');
    } else if (results.ok === 0) {
        _showToast(`设置失败 ${results.fail.length} 条，详见控制台`, 'error');
    } else {
        _showToast(`已设为「${modeLabel}」${results.ok} 条，失败 ${results.fail.length} 条`, 'warn');
    }
}

// ===== Phase 4: Batch copy =====

async function _handleBatchCopy(sourceBook, targetBook) {
    if (!sourceBook || !targetBook) return;
    const uids = [...state.selectedUids];
    if (uids.length === 0) return;
    if (state.batchRunning) return;

    const isSameBook = sourceBook === targetBook;
    const actionLabel = isSameBook ? '同书复制' : `复制到「${targetBook}」`;

    state.batchRunning = true;
    _setBatchBarBusy(true, `${actionLabel}...`);

    // Build the existing-comments set for the target book (for uniqueComment).
    let targetComments = new Set();
    try {
        let targetBookData = state.bookCache.get(targetBook);
        if (!targetBookData) {
            targetBookData = await rpc('loadBook', { name: targetBook });
            if (targetBookData) state.bookCache.set(targetBook, targetBookData);
        }
        if (targetBookData?.entries) {
            for (const e of Object.values(targetBookData.entries)) {
                const c = (e.comment || '').trim();
                if (c) targetComments.add(c);
            }
        }
    } catch (e) {
        console.warn(`${LOG} Could not load target book '${targetBook}' for dedup:`, e);
    }

    const sourceBookData = state.bookCache.get(sourceBook);
    const results = { ok: 0, fail: [] };

    for (const uid of uids) {
        const entry = sourceBookData?.entries?.[uid];
        if (!entry) {
            results.fail.push({ uid, err: new Error('Entry not found in cache') });
            continue;
        }

        // Strip uid and build partial for createEntry.
        const partial = {};
        for (const key of Object.keys(entry)) {
            if (key === 'uid') continue;
            partial[key] = entry[key];
        }

        // Resolve duplicate comment (name).
        const originalComment = (partial.comment || '').trim();
        partial.comment = _uniqueComment(originalComment, targetComments);
        // Track the new name to prevent collision within the same batch.
        if (partial.comment) targetComments.add(partial.comment);

        try {
            await rpc('createEntry', { bookName: targetBook, partial });
            results.ok++;
        } catch (err) {
            console.error(`${LOG} Batch copy uid=${uid} to '${targetBook}' failed:`, err);
            results.fail.push({ uid, err });
        }
    }

    // Invalidate caches.
    state.bookCache.delete(targetBook);
    if (isSameBook) state.bookCache.delete(sourceBook);
    if (state.occupancy) state.occupancy.invalid = true;
    state.batchRunning = false;

    // Reload the current book view if same-book copy.
    if (isSameBook) {
        try {
            const book = await rpc('loadBook', { name: sourceBook });
            if (book) state.bookCache.set(sourceBook, book);
            if (book?.entries) _renderEntries(sourceBook, book);
        } catch (e) {
            console.warn(`${LOG} Reload after batch copy failed:`, e);
            _refreshEntriesView();
        }
    } else {
        // Stay on current book; just refresh to clear busy state.
        _refreshEntriesView();
    }

    if (results.fail.length === 0) {
        _showToast(
            isSameBook
                ? `已复制 ${results.ok} 条（同书）`
                : `已复制 ${results.ok} 条到「${targetBook}」`,
            'success',
        );
    } else if (results.ok === 0) {
        _showToast(`复制失败 ${results.fail.length} 条，详见控制台`, 'error');
    } else {
        _showToast(
            isSameBook
                ? `已复制 ${results.ok} 条，失败 ${results.fail.length} 条，详见控制台`
                : `已复制 ${results.ok} 条到「${targetBook}」，失败 ${results.fail.length} 条`,
            'warn',
        );
    }
}

// ===== Phase 5: Batch move (transactional copy + delete) =====

async function _handleBatchMove(sourceBook, targetBook) {
    if (!sourceBook || !targetBook || sourceBook === targetBook) return;
    const uids = [...state.selectedUids];
    if (uids.length === 0) return;
    if (state.batchRunning) return;

    const ok = window.confirm(
        `确认将 ${uids.length} 条条目从「${sourceBook}」移动到「${targetBook}」？\n` +
        `移动 = 复制到目标书 + 删除源书条目。`,
    );
    if (!ok) return;

    state.batchRunning = true;
    _setBatchBarBusy(true, `移动到「${targetBook}」...`);

    // Build existing-comments set for uniqueComment.
    let targetComments = new Set();
    try {
        let targetBookData = state.bookCache.get(targetBook);
        if (!targetBookData) {
            targetBookData = await rpc('loadBook', { name: targetBook });
            if (targetBookData) state.bookCache.set(targetBook, targetBookData);
        }
        if (targetBookData?.entries) {
            for (const e of Object.values(targetBookData.entries)) {
                const c = (e.comment || '').trim();
                if (c) targetComments.add(c);
            }
        }
    } catch (e) {
        console.warn(`${LOG} Could not load target book '${targetBook}' for dedup:`, e);
    }

    const sourceBookData = state.bookCache.get(sourceBook);

    // --- Phase A: copy entries to target book ---
    const createdInTarget = []; // { uid: number } — uids created in target book
    let phaseAFailed = false;
    let phaseAError = null;

    for (const uid of uids) {
        const entry = sourceBookData?.entries?.[uid];
        if (!entry) {
            phaseAFailed = true;
            phaseAError = new Error(`Entry uid=${uid} not found in source cache`);
            console.error(`${LOG} Batch move Phase A: entry uid=${uid} missing from cache`);
            break;
        }

        const partial = {};
        for (const key of Object.keys(entry)) {
            if (key === 'uid') continue;
            partial[key] = entry[key];
        }

        const originalComment = (partial.comment || '').trim();
        partial.comment = _uniqueComment(originalComment, targetComments);
        if (partial.comment) targetComments.add(partial.comment);

        try {
            const res = await rpc('createEntry', { bookName: targetBook, partial });
            if (res && Number.isInteger(res.uid)) {
                createdInTarget.push({ uid: res.uid });
            } else {
                createdInTarget.push({ uid: null });
            }
        } catch (err) {
            phaseAFailed = true;
            phaseAError = err;
            console.error(`${LOG} Batch move Phase A: createEntry uid=${uid} failed:`, err);
            break;
        }
    }

    if (phaseAFailed) {
        // --- Phase B: rollback — delete whatever was created in target ---
        _setBatchBarBusy(true, '回滚中...');
        let rollbackFail = 0;
        for (const created of createdInTarget) {
            if (created.uid === null) continue;
            try {
                await rpc('deleteEntry', { bookName: targetBook, uid: created.uid });
            } catch (rbErr) {
                rollbackFail++;
                console.error(`${LOG} Batch move Phase B rollback: deleteEntry uid=${created.uid} in '${targetBook}' failed:`, rbErr);
            }
        }

        state.bookCache.delete(targetBook);
        state.batchRunning = false;
        _setBatchBarBusy(false);

        if (rollbackFail > 0) {
            _showToast(`移动失败，回滚时 ${rollbackFail} 条清理失败，详见控制台`, 'error');
        } else {
            _showToast(`移动失败，已回滚（源书不变）`, 'error');
        }
        return;
    }

    // --- Phase C: delete source entries ---
    _setBatchBarBusy(true, '清理源条目...');
    const deleteResults = { ok: 0, fail: [] };
    for (const uid of uids) {
        try {
            await rpc('deleteEntry', { bookName: sourceBook, uid });
            deleteResults.ok++;
        } catch (err) {
            console.error(`${LOG} Batch move Phase C: deleteEntry uid=${uid} from '${sourceBook}' failed:`, err);
            deleteResults.fail.push({ uid, err });
        }
    }

    // Invalidate caches and refresh.
    state.bookCache.delete(sourceBook);
    state.bookCache.delete(targetBook);
    if (state.occupancy) state.occupancy.invalid = true;
    state.selectedUids = new Set();
    state.batchRunning = false;

    try {
        const book = await rpc('loadBook', { name: sourceBook });
        if (book) state.bookCache.set(sourceBook, book);
        if (book?.entries) _renderEntries(sourceBook, book);
    } catch (e) {
        console.warn(`${LOG} Reload after batch move failed:`, e);
        _refreshEntriesView();
    }

    if (deleteResults.fail.length === 0) {
        _showToast(`已移动 ${deleteResults.ok} 条到「${targetBook}」`, 'success');
    } else {
        _showToast(
            `已复制到目标书，但源书删除失败 ${deleteResults.fail.length} 条，详见控制台`,
            'warn',
        );
    }
}

// ===== Batch popover (light dropdown for "触发方式" etc.) =====

/** @type {HTMLElement | null} */
let _openBatchPopover = null;
let _popoverDocClickWired = false;

function _toggleBatchPopover(triggerEl) {
    if (state.batchRunning) return;
    const popover = triggerEl?.parentElement?.querySelector('.wb-batch-popover');
    if (!(popover instanceof HTMLElement)) return;
    if (_openBatchPopover === popover) {
        _closeAllBatchPopovers();
        return;
    }
    _closeAllBatchPopovers();
    popover.classList.add('is-open');
    _openBatchPopover = popover;
}

function _closeAllBatchPopovers() {
    if (_openBatchPopover) {
        _openBatchPopover.classList.remove('is-open');
        _openBatchPopover = null;
    }
}

function _ensurePopoverDocClick() {
    if (_popoverDocClickWired) return;
    _popoverDocClickWired = true;
    document.addEventListener('click', (e) => {
        if (!_openBatchPopover) return;
        const target = e.target instanceof HTMLElement ? e.target : null;
        if (!target) return;
        const dropdown = _openBatchPopover.parentElement;
        if (dropdown && dropdown.contains(target)) return;
        _closeAllBatchPopovers();
    });
}

// ===== Toast (lightweight in-tab notification) =====

let _toastSeq = 0;
function _showToast(message, level = 'info') {
    let container = document.getElementById('wb-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'wb-toast-container';
        container.className = 'wb-toast-container';
        document.body.appendChild(container);
    }
    const id = `wb-toast-${++_toastSeq}`;
    const toast = document.createElement('div');
    toast.id = id;
    toast.className = `wb-toast wb-toast-${level}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    setTimeout(() => {
        toast.classList.remove('is-visible');
        setTimeout(() => toast.remove(), 220);
    }, 3200);
}

// ===== Multi-separator key parsing =====

function parseKeys(text) {
    if (typeof text !== 'string') return [];
    return text.split(KEY_SPLIT_RE).map(s => s.trim()).filter(Boolean);
}

function serializeKeysForInput(keys) {
    if (!Array.isArray(keys)) return '';
    return keys.join(', ');
}

// ===== Drawer (edit / create entry) =====

function _findEntryInCache(bookName, uid) {
    const book = state.bookCache.get(bookName);
    if (!book || !book.entries) return null;
    return book.entries[uid] || null;
}

function _openDrawerForEdit(bookName, uid) {
    const entry = _findEntryInCache(bookName, uid);
    if (!entry) {
        console.warn(`${LOG} Cannot open drawer — entry uid=${uid} not in cache`);
        return;
    }
    state.editing = { bookName, uid, isNew: false, entry, context: state.view };
    _renderDrawer();
}

function _openDrawerForCreate(bookName) {
    state.editing = {
        bookName,
        uid: null,
        isNew: true,
        entry: { ...NEW_ENTRY_DEFAULTS, key: [], uid: null },
        context: state.view,
    };
    _renderDrawer();
}

function _closeDrawer() {
    const prev = state.editing;
    state.editing = null;
    state.saving = false;
    _renderDrawer();
    _restoreEditorContext(prev);
}

function _restoreEditorContext(prev) {
    const ctx = prev?.context || state.view;
    if (ctx === 'entries') {
        const detail = document.getElementById('wb-detail');
        if (!detail) return;
        if (prev?.bookName) {
            const book = state.bookCache.get(prev.bookName);
            if (book && book.entries) {
                _renderEntries(prev.bookName, book);
                return;
            }
            _selectBook(prev.bookName);
            return;
        }
        detail.innerHTML = `
            <div class="wb-detail-placeholder">
                <i class="ph ph-arrow-left"></i>
                <p>从左侧选一本世界书查看条目</p>
            </div>
        `;
        return;
    }
    if (ctx === 'occupancy') {
        if (state.occupancy?.invalid) {
            _fetchOccupancy();
        } else {
            _renderOccupancyContent();
        }
    }
}

function _renderDrawer() {
    const legacyRoot = document.getElementById('wb-drawer-root');
    if (legacyRoot) {
        legacyRoot.classList.remove('open');
        legacyRoot.innerHTML = '';
    }

    if (!state.editing) return;

    const ctx = state.editing.context || state.view;
    const target = ctx === 'occupancy'
        ? document.getElementById('wb-occ-content')
        : document.getElementById('wb-detail');
    if (!target) return;

    const { bookName, uid, isNew, entry } = state.editing;
    const keys = Array.isArray(entry.key) ? entry.key : [];
    const pos = Number(entry.position ?? 0);
    const depth = Number(entry.depth ?? 4);
    const order = Number(entry.order ?? 100);
    const titleLabel = isNew ? '新建条目' : `编辑 · UID ${uid}`;

    const posOptionsHtml = Object.entries(POSITION_LABELS)
        .map(([v, label]) => `<option value="${v}" ${Number(v) === pos ? 'selected' : ''}>${v} · ${label}</option>`)
        .join('');

    target.innerHTML = `
        <div class="wb-inline-editor" role="dialog" aria-label="${escapeAttr(titleLabel)}">
            <header class="wb-drawer-header">
                <div>
                    <div class="wb-drawer-title">${escapeHtml(titleLabel)}</div>
                    <div class="wb-drawer-sub">${escapeHtml(bookName)}</div>
                </div>
                <button id="wb-drawer-close" class="wb-icon-btn" type="button" title="关闭">
                    <i class="ph ph-x"></i>
                </button>
            </header>

            <form id="wb-edit-form" class="wb-form" autocomplete="off" onsubmit="return false;">
                <label class="wb-field">
                    <span class="wb-field-label">
                        标题 / 备注
                        <span class="wb-field-hint">comment 字段，留空时用第一个关键词作标题</span>
                    </span>
                    <input type="text" name="comment" value="${escapeAttr(entry.comment ?? '')}" />
                </label>

                <label class="wb-field">
                    <span class="wb-field-label">
                        关键词
                        <span class="wb-field-hint">支持 中英文逗号 / 分号 / 换行 作分隔符</span>
                    </span>
                    <textarea name="keys" rows="3" placeholder="例如：你好, 早安；晚安">${escapeHtml(serializeKeysForInput(keys))}</textarea>
                </label>

                <label class="wb-field">
                    <span class="wb-field-label">内容</span>
                    <textarea name="content" rows="10" placeholder="条目内容">${escapeHtml(entry.content ?? '')}</textarea>
                </label>

                <div class="wb-field-row">
                    <label class="wb-field wb-field-narrow">
                        <span class="wb-field-label">插入位置</span>
                        <select name="position" id="wb-form-position">${posOptionsHtml}</select>
                    </label>

                    <label class="wb-field wb-field-narrow" id="wb-form-depth-field" data-visible="${pos === 4}">
                        <span class="wb-field-label">深度</span>
                        <input type="number" name="depth" value="${depth}" step="1" min="0" />
                    </label>

                    <label class="wb-field wb-field-narrow">
                        <span class="wb-field-label">顺序</span>
                        <input type="number" name="order" id="wb-form-order" value="${order}" step="1" />
                    </label>
                </div>

                <div id="wb-form-order-hint" class="wb-form-order-hint"></div>

                <label class="wb-field">
                    <div class="wb-mode-group" role="radiogroup">
                        <label class="wb-mode-btn ${entry.disable ? '' : (entry.constant ? 'is-active' : '')}" data-mode="constant">
                            <input type="radio" name="mode" value="constant" ${(!entry.disable && entry.constant) ? 'checked' : ''} />
                            <span>始终生效</span>
                        </label>
                        <label class="wb-mode-btn ${(!entry.disable && !entry.constant) ? 'is-active' : ''}" data-mode="selective">
                            <input type="radio" name="mode" value="selective" ${(!entry.disable && !entry.constant) ? 'checked' : ''} />
                            <span>关键词触发</span>
                        </label>
                        <label class="wb-mode-btn ${entry.disable ? 'is-active' : ''}" data-mode="disabled">
                            <input type="radio" name="mode" value="disabled" ${entry.disable ? 'checked' : ''} />
                            <span>停用</span>
                        </label>
                    </div>
                </label>
            </form>

            <footer class="wb-drawer-footer">
                ${isNew ? '' : `
                    <button id="wb-drawer-delete" class="wb-btn wb-btn-danger" type="button">
                        删除
                    </button>
                `}
                <span class="wb-drawer-footer-spacer"></span>
                <button id="wb-drawer-cancel" class="wb-btn wb-btn-ghost" type="button">
                取消
                </button>
                <button id="wb-drawer-save" class="wb-btn wb-btn-primary" type="button">
                    保存
                </button>
            </footer>
        </div>
    `;

    document.getElementById('wb-drawer-close')?.addEventListener('click', _closeDrawer);
    document.getElementById('wb-drawer-cancel')?.addEventListener('click', _closeDrawer);
    document.getElementById('wb-drawer-save')?.addEventListener('click', _handleDrawerSave);
    document.getElementById('wb-drawer-delete')?.addEventListener('click', _handleDrawerDelete);

    document.getElementById('wb-form-position')?.addEventListener('change', (ev) => {
        const v = Number((ev.target instanceof HTMLSelectElement) ? ev.target.value : 0);
        const depthField = document.getElementById('wb-form-depth-field');
        if (depthField) depthField.setAttribute('data-visible', String(v === 4));
        _renderOrderHint();
    });
    document.querySelector('input[name="depth"]')?.addEventListener('input', _renderOrderHint);

    document.querySelectorAll('.wb-mode-group input[name="mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            document.querySelectorAll('.wb-mode-btn').forEach(btn => {
                const input = btn.querySelector('input[name="mode"]');
                btn.classList.toggle('is-active', input instanceof HTMLInputElement && input.checked);
            });
        });
    });

    _renderOrderHint();
}

function _renderOrderHint() {
    const hintRoot = document.getElementById('wb-form-order-hint');
    if (!hintRoot || !state.editing) return;
    const { bookName, uid, isNew } = state.editing;

    const posSel = /** @type {HTMLSelectElement|null} */ (document.getElementById('wb-form-position'));
    const depthInput = /** @type {HTMLInputElement|null} */ (document.querySelector('input[name="depth"]'));
    const pos = posSel ? Number(posSel.value) : 0;
    const depth = depthInput ? Number(depthInput.value) : 0;

    const book = state.bookCache.get(bookName);
    const entries = book?.entries ? Object.values(book.entries) : [];
    const ignoreUid = isNew ? null : uid;
    const usedOrders = [];
    for (const e of entries) {
        if (ignoreUid !== null && e.uid === ignoreUid) continue;
        const p = Number(e.position ?? 0);
        if (p !== pos) continue;
        if (p === 4 && Number(e.depth ?? 0) !== depth) continue;
        usedOrders.push(Number(e.order ?? 100));
    }
    const used = Array.from(new Set(usedOrders)).sort((a, b) => a - b);

    const orderInput = /** @type {HTMLInputElement|null} */ (document.getElementById('wb-form-order'));
    const currentOrder = orderInput ? Number(orderInput.value) : 100;
    const collides = used.includes(currentOrder);

    const usedSet = new Set(used);
    const suggestions = [];
    for (let o = 100; o <= 200 && suggestions.length < 5; o += 5) {
        if (!usedSet.has(o)) suggestions.push(o);
    }

    const usedLabel = used.length === 0
        ? '<span class="wb-form-hint-tag wb-form-hint-free">本书在此位置无其它条目</span>'
        : `<span>本书已用 order：</span>${used.map(o => `<span class="wb-form-hint-tag ${o === currentOrder ? 'is-current' : ''}">${o}</span>`).join('')}`;

    const suggestLabel = suggestions.length > 0
        ? `<span>建议空位：</span>${suggestions.map(o => `<button type="button" class="wb-form-hint-suggest" data-order="${o}">${o}</button>`).join('')}`
        : '';

    const warnLabel = collides
        ? `<div class="wb-form-hint-warn"><i class="ph ph-warning"></i> 当前 order ${currentOrder} 已被本书占用</div>`
        : '';

    hintRoot.innerHTML = `
        <div class="wb-form-hint-row">${usedLabel}</div>
        ${suggestLabel ? `<div class="wb-form-hint-row">${suggestLabel}</div>` : ''}
        ${warnLabel}
    `;

    hintRoot.querySelectorAll('.wb-form-hint-suggest').forEach(btn => {
        btn.addEventListener('click', () => {
            const v = btn.getAttribute('data-order');
            if (v && orderInput) {
                orderInput.value = v;
                _renderOrderHint();
            }
        });
    });
}

function _collectDrawerForm() {
    const form = /** @type {HTMLFormElement | null} */ (document.getElementById('wb-edit-form'));
    if (!form) return null;
    const fd = new FormData(form);

    const position = Number(fd.get('position') ?? 0);
    const orderRaw = String(fd.get('order') ?? '').trim();
    const updates = {
        comment: String(fd.get('comment') ?? '').trim(),
        key: parseKeys(String(fd.get('keys') ?? '')),
        content: String(fd.get('content') ?? ''),
        position,
        order: orderRaw === '' ? 100 : Number(orderRaw),
        constant: fd.get('mode') === 'constant',
        disable: fd.get('mode') === 'disabled',
    };
    const depthRaw = String(fd.get('depth') ?? '').trim();
    if (depthRaw !== '') {
        updates.depth = Number(depthRaw);
    }
    return updates;
}

async function _handleDrawerSave() {
    if (!state.editing || state.saving) return;
    const updates = _collectDrawerForm();
    if (!updates) return;

    const { bookName, uid, isNew } = state.editing;

    state.saving = true;
    _setDrawerBusy(true, isNew ? '创建中...' : '保存中...');

    try {
        if (isNew) {
            const res = await rpc('createEntry', { bookName, partial: updates });
            if (!res || !Number.isInteger(res.uid)) throw new Error('createEntry 未返回 uid');
            console.log(`${LOG} Created entry uid=${res.uid} in ${bookName}`);
        } else {
            await rpc('updateEntry', { bookName, uid, updates });
            console.log(`${LOG} Updated entry uid=${uid} in ${bookName}`);
        }
        state.bookCache.delete(bookName);
        if (state.occupancy) state.occupancy.invalid = true;
        await _reloadCurrentBook();
        _closeDrawer();
    } catch (e) {
        console.error(`${LOG} Save failed:`, e);
        _setDrawerError(e.message || String(e));
    } finally {
        state.saving = false;
        _setDrawerBusy(false);
    }
}

async function _handleDrawerDelete() {
    if (!state.editing || state.saving) return;
    const { bookName, uid, isNew } = state.editing;
    if (isNew || uid === null) return;

    const ok = window.confirm(`确认删除 UID ${uid}？该操作不可撤销。`);
    if (!ok) return;

    state.saving = true;
    _setDrawerBusy(true, '删除中...');

    try {
        await rpc('deleteEntry', { bookName, uid });
        console.log(`${LOG} Deleted entry uid=${uid} from ${bookName}`);
        state.bookCache.delete(bookName);
        if (state.occupancy) state.occupancy.invalid = true;
        await _reloadCurrentBook();
        _closeDrawer();
    } catch (e) {
        console.error(`${LOG} Delete failed:`, e);
        _setDrawerError(e.message || String(e));
    } finally {
        state.saving = false;
        _setDrawerBusy(false);
    }
}

function _setDrawerBusy(busy, label) {
    const saveBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('wb-drawer-save'));
    const cancelBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('wb-drawer-cancel'));
    const delBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('wb-drawer-delete'));
    if (saveBtn) {
        saveBtn.disabled = busy;
        if (busy && label) saveBtn.innerHTML = `<i class="ph ph-spinner-gap" style="animation:wb-spin 1s linear infinite;"></i> ${escapeHtml(label)}`;
        else saveBtn.innerHTML = '<i class="ph ph-floppy-disk"></i> 保存';
    }
    if (cancelBtn) cancelBtn.disabled = busy;
    if (delBtn) delBtn.disabled = busy;
}

function _setDrawerError(msg) {
    const footer = document.querySelector('.wb-drawer-footer');
    if (!footer) return;
    let bar = footer.querySelector('.wb-drawer-error');
    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'wb-drawer-error';
        footer.parentElement?.insertBefore(bar, footer);
    }
    bar.textContent = msg;
}

async function _reloadCurrentBook() {
    if (!state.selectedBook) return;
    const name = state.selectedBook;
    try {
        const book = await rpc('loadBook', { name });
        if (book) state.bookCache.set(name, book);
        if (book && book.entries) _renderEntries(name, book);
    } catch (e) {
        console.warn(`${LOG} Reload after save failed:`, e);
    }
}

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
    return escapeHtml(s);
}

async function _handlePingClick() {
    const out = document.getElementById('wb-ping-output');
    const btn = document.getElementById('wb-ping-btn');
    if (btn) btn.disabled = true;
    if (out) out.textContent = '发送 ping...';

    const t0 = performance.now();
    try {
        const result = await rpc('ping', { sentAt: Date.now() });
        const dt = (performance.now() - t0).toFixed(1);
        if (out) out.textContent = `OK (${dt}ms): ` + JSON.stringify(result);
        _setBridgeStatus('ok', `bridge OK · ${dt}ms`);
    } catch (e) {
        if (out) out.textContent = `ERROR: ${e.message}`;
        _setBridgeStatus('err', `bridge ERROR: ${e.message}`);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ===== Occupancy view (Phase 3) =====

function _initOccupancyStateIfNeeded() {
    if (state.occupancy) return;
    const active = state.initPayload?.activeBooks || { global: [], character: [], charLore: [] };
    const seed = new Set([
        ...(active.global || []),
        ...(active.character || []),
        ...(active.charLore || []),
    ]);
    state.occupancy = {
        selectedBooks: seed,
        data: null,
        loading: false,
        error: null,
        invalid: true,
        /** @type {'grid' | 'timeline'} */
        viewMode: 'grid',
        // Timeline-mode: collapse anchors with no active entries.
        hideEmpty: true,
        // Book-picker section starts collapsed when there's already a seed
        // selection (returning user); expanded otherwise to invite first picks.
        booksCollapsed: seed.size > 0,
    };
}

function _switchView(view) {
    if (view !== 'entries' && view !== 'occupancy') return;
    if (state.view !== view && state.selectMode) {
        state.selectMode = false;
        state.selectedUids = new Set();
        state.selectionBook = null;
    }
    state.view = view;

    document.querySelectorAll('.wb-tab').forEach(el => {
        const active = el.getAttribute('data-view') === view;
        el.classList.toggle('is-active', active);
        el.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    const entriesView = document.getElementById('wb-view-entries');
    const occupancyView = document.getElementById('wb-view-occupancy');
    if (entriesView) {
        if (view === 'entries') entriesView.removeAttribute('hidden');
        else entriesView.setAttribute('hidden', '');
        entriesView.classList.toggle('is-active', view === 'entries');
    }
    if (occupancyView) {
        if (view === 'occupancy') occupancyView.removeAttribute('hidden');
        else occupancyView.setAttribute('hidden', '');
        occupancyView.classList.toggle('is-active', view === 'occupancy');
    }

    if (view === 'occupancy') {
        _initOccupancyStateIfNeeded();
        _renderOccupancyView();
        if (state.occupancy.invalid && !state.occupancy.loading) {
            _fetchOccupancy();
        }
    }
}

async function _fetchOccupancy() {
    if (!state.occupancy) return;
    const sel = Array.from(state.occupancy.selectedBooks);
    state.occupancy.loading = true;
    state.occupancy.error = null;
    _renderOccupancyContent();

    try {
        if (sel.length === 0) {
            state.occupancy.data = null;
            state.occupancy.invalid = false;
            return;
        }
        const data = await rpc('getOccupancyMap', { bookNames: sel });
        state.occupancy.data = data;
        state.occupancy.invalid = false;
    } catch (e) {
        console.error(`${LOG} getOccupancyMap failed:`, e);
        state.occupancy.error = e.message || String(e);
    } finally {
        state.occupancy.loading = false;
        _renderOccupancyContent();
    }
}

function _renderOccupancyView() {
    const wrap = document.getElementById('wb-view-occupancy');
    if (!wrap) return;
    if (!wrap.dataset.scaffolded) {
        wrap.innerHTML = `
            <div class="wb-occ-toolbar">
                <span class="wb-occ-toolbar-title"><i class="ph ph-grid-four"></i> 槽位占用</span>
                <div class="wb-occ-mode" role="tablist" aria-label="视图模式">
                    <button type="button" class="wb-occ-mode-btn is-active" data-mode="grid" role="tab" aria-selected="true">
                        <i class="ph ph-grid-four"></i> 槽位
                    </button>
                    <button type="button" class="wb-occ-mode-btn" data-mode="timeline" role="tab" aria-selected="false">
                        <i class="ph ph-list-numbers"></i> 时间线
                    </button>
                </div>
                <label id="wb-occ-hide-empty" class="wb-occ-hide-empty" title="时间线模式：不显示无条目的锚点段">
                    <input type="checkbox" />
                    <span><i class="ph ph-eye-slash"></i> 隐藏空段</span>
                </label>
                <span class="wb-occ-toolbar-spacer"></span>
                <span class="wb-occ-legend">
                    <span class="wb-occ-legend-item"><span class="wb-occ-legend-swatch is-occupied"></span>占用</span>
                    <span class="wb-occ-legend-item"><span class="wb-occ-legend-swatch is-conflict"></span>跨书冲突</span>
                    <span class="wb-occ-legend-item"><span class="wb-occ-legend-swatch is-disabled"></span>已停用</span>
                </span>
                <button id="wb-occ-refresh" class="wb-btn wb-btn-ghost" type="button">
                    <i class="ph ph-arrow-clockwise"></i> 刷新
                </button>
            </div>
            <div class="wb-occ-scroll">
                <section id="wb-occ-books-section" class="wb-occ-books-section">
                    <button type="button" id="wb-occ-books-header" class="wb-occ-books-header" aria-expanded="true" aria-controls="wb-occ-books">
                        <i class="ph ph-books wb-occ-books-header-icon"></i>
                        <span class="wb-occ-books-header-label">世界书选择</span>
                        <span id="wb-occ-books-count" class="wb-occ-books-count"></span>
                        <i class="ph ph-caret-down wb-occ-books-caret"></i>
                    </button>
                    <div id="wb-occ-books" class="wb-occ-books"></div>
                </section>
                <div id="wb-occ-content" class="wb-occ-content"></div>
            </div>
        `;
        document.getElementById('wb-occ-refresh')?.addEventListener('click', () => {
            if (!state.occupancy) return;
            state.occupancy.invalid = true;
            _fetchOccupancy();
        });
        wrap.querySelectorAll('.wb-occ-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.getAttribute('data-mode');
                if (mode !== 'grid' && mode !== 'timeline') return;
                if (!state.occupancy || state.occupancy.viewMode === mode) return;
                state.occupancy.viewMode = mode;
                _syncOccupancyModeButtons();
                _renderOccupancyContent();
            });
        });
        const hideEmptyBox = wrap.querySelector('#wb-occ-hide-empty input[type="checkbox"]');
        hideEmptyBox?.addEventListener('change', () => {
            if (!state.occupancy) return;
            state.occupancy.hideEmpty = !!hideEmptyBox.checked;
            if (state.occupancy.viewMode === 'timeline') _renderOccupancyContent();
        });
        document.getElementById('wb-occ-books-header')?.addEventListener('click', () => {
            if (!state.occupancy) return;
            state.occupancy.booksCollapsed = !state.occupancy.booksCollapsed;
            _syncOccupancyBooksCollapse();
        });
        wrap.dataset.scaffolded = '1';
    }
    _syncOccupancyModeButtons();
    _renderOccupancyBookPicker();
    _renderOccupancyContent();
}

function _syncOccupancyBooksCollapse() {
    if (!state.occupancy) return;
    const section = document.getElementById('wb-occ-books-section');
    const header = document.getElementById('wb-occ-books-header');
    const countEl = document.getElementById('wb-occ-books-count');
    if (!section || !header) return;
    const collapsed = !!state.occupancy.booksCollapsed;
    section.classList.toggle('is-collapsed', collapsed);
    header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    if (countEl) {
        const total = (state.initPayload?.allBookNames || []).length;
        const selected = state.occupancy.selectedBooks.size;
        countEl.textContent = `已选 ${selected} / 共 ${total}`;
    }
}

function _renderOccupancyBookPicker() {
    const root = document.getElementById('wb-occ-books');
    if (!root || !state.occupancy) return;
    const allNames = state.initPayload?.allBookNames || [];
    if (allNames.length === 0) {
        root.innerHTML = '<div class="wb-empty-mini">没有可用的世界书</div>';
        return;
    }
    root.innerHTML = allNames.map(name => {
        const checked = state.occupancy.selectedBooks.has(name);
        const tags = _classifyBook(name);
        const tagsHtml = tags.map(t => `<span class="wb-tag wb-tag-${t.key}">${t.label}</span>`).join('');
        const color = _bookColor(name);
        return `
            <label class="wb-occ-book-chip ${checked ? 'is-checked' : ''}" data-name="${escapeAttr(name)}" style="--wb-occ-book-color:${color};">
                <input type="checkbox" ${checked ? 'checked' : ''} />
                <span class="wb-occ-book-swatch"></span>
                <span class="wb-occ-book-name" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
                ${tagsHtml}
            </label>
        `;
    }).join('');

    root.querySelectorAll('.wb-occ-book-chip').forEach(label => {
        const checkbox = label.querySelector('input[type="checkbox"]');
        checkbox?.addEventListener('change', () => {
            const name = label.getAttribute('data-name');
            if (!name || !state.occupancy) return;
            if (checkbox.checked) state.occupancy.selectedBooks.add(name);
            else state.occupancy.selectedBooks.delete(name);
            state.occupancy.invalid = true;
            label.classList.toggle('is-checked', checkbox.checked);
            _fetchOccupancy();
            _syncOccupancyBooksCollapse();
        });
    });
    _syncOccupancyBooksCollapse();
}

function _renderOccupancyContent() {
    const root = document.getElementById('wb-occ-content');
    if (!root || !state.occupancy) return;

    if (state.occupancy.loading) {
        root.innerHTML = '<div class="wb-detail-loading"><i class="ph ph-spinner-gap"></i> 计算占用图...</div>';
        return;
    }
    if (state.occupancy.error) {
        root.innerHTML = `<div class="wb-detail-error">获取失败：${escapeHtml(state.occupancy.error)}</div>`;
        return;
    }
    if (state.occupancy.selectedBooks.size === 0) {
        root.innerHTML = '<div class="wb-detail-empty">勾选至少一本世界书来查看槽位占用</div>';
        return;
    }
    const data = state.occupancy.data;
    if (!data) {
        root.innerHTML = '<div class="wb-detail-empty">暂无数据</div>';
        return;
    }

    const mode = state.occupancy.viewMode || 'grid';
    if (mode === 'timeline') {
        _renderTimelineMode(root, data);
    } else {
        _renderGridMode(root, data);
    }
}

function _syncOccupancyModeButtons() {
    if (!state.occupancy) return;
    const current = state.occupancy.viewMode || 'grid';
    document.querySelectorAll('.wb-occ-mode-btn').forEach(btn => {
        const active = btn.getAttribute('data-mode') === current;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    // hide-empty toggle is only meaningful in timeline mode.
    const hideEmptyWrap = document.getElementById('wb-occ-hide-empty');
    if (hideEmptyWrap) {
        hideEmptyWrap.classList.toggle('is-hidden', current !== 'timeline');
        const cb = hideEmptyWrap.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = !!state.occupancy.hideEmpty;
    }
}

function _renderGridMode(root, data) {
    const NON_DEPTH_POSITIONS = [0, 1, 2, 3, 5, 6];
    const totalSlots = NON_DEPTH_POSITIONS.reduce((acc, p) => acc + (data.timelines[p]?.length || 0), 0)
        + (data.depthGrid?.length || 0);
    const totalConflicts = NON_DEPTH_POSITIONS.reduce((acc, p) => {
        return acc + (data.timelines[p] || []).filter(_isConflictCell).length;
    }, 0) + (data.depthGrid || []).filter(_isConflictCell).length;

    const conflictBanner = totalConflicts > 0
        ? `<div class="wb-occ-conflict-banner"><i class="ph ph-warning-octagon"></i> 检测到 ${totalConflicts} 处跨书冲突</div>`
        : '';

    const timelinesHtml = NON_DEPTH_POSITIONS.map(pos =>
        _renderTimelineRow(pos, data.timelines[pos] || []),
    ).join('');

    root.innerHTML = `
        ${conflictBanner}
        <section class="wb-occ-section">
            <h3 class="wb-occ-section-title"><i class="ph ph-list-numbers"></i> 相对位置（非 @深度）</h3>
            <div class="wb-occ-timelines">${timelinesHtml}</div>
        </section>
        <section class="wb-occ-section">
            <h3 class="wb-occ-section-title"><i class="ph ph-grid-four"></i> @深度（深度 × 顺序）</h3>
            ${_renderDepthGrid(data.depthGrid)}
        </section>
        <div class="wb-occ-stats">共 ${totalSlots} 个被占用的槽位</div>
    `;
}

// ===== Timeline mode =====
// Anchors mirror ST's chat-completion injection order. Within each position,
// cells are ordered by `order` ascending (small first) — this matches
// `world-info.js` where entries are sortFn'd descending then `unshift`ed.
// @Depth entries are grouped under Chat History; depth descending (far → near),
// role ascending within each depth bucket (system → user → assistant).

const TIMELINE_ANCHORS = [
    {
        id: 'char',
        title: 'Character Definition',
        icon: 'ph-user-circle',
        rows: [
            { kind: 'pos', pos: 0 },
            { kind: 'placeholder', text: '[Char Description / Personality / Scenario]' },
            { kind: 'pos', pos: 1 },
        ],
    },
    {
        id: 'persona',
        title: 'Persona',
        icon: 'ph-user',
        rows: [
            { kind: 'placeholder', text: '[Persona Description]' },
        ],
    },
    {
        id: 'em',
        title: 'Example Messages',
        icon: 'ph-chat-circle-text',
        rows: [
            { kind: 'pos', pos: 5 },
            { kind: 'placeholder', text: '[Example Messages]' },
            { kind: 'pos', pos: 6 },
        ],
    },
    {
        id: 'chat',
        title: 'Chat History',
        icon: 'ph-chats',
        rows: [
            { kind: 'placeholder', text: '[Older messages…]' },
            { kind: 'depth' },
            { kind: 'placeholder', text: '[Last message]' },
        ],
    },
    {
        id: 'user',
        title: 'User Input',
        icon: 'ph-paper-plane-tilt',
        rows: [
            { kind: 'placeholder', text: '[User input]' },
        ],
    },
    {
        id: 'an',
        title: "Author's Note",
        icon: 'ph-note-pencil',
        note: 'AN 的实际位置由 AN 设置（chat-level metadata）决定，此处仅作示意。',
        rows: [
            { kind: 'pos', pos: 2 },
            { kind: 'placeholder', text: '[Author’s Note content]' },
            { kind: 'pos', pos: 3 },
        ],
    },
];

const DEPTH_ROLE_LABELS = { 0: 'system', 1: 'user', 2: 'assistant' };

function _renderTimelineMode(root, data) {
    const totalConflicts = [0, 1, 2, 3, 5, 6].reduce((acc, p) => {
        return acc + (data.timelines[p] || []).filter(_isConflictCell).length;
    }, 0) + (data.depthGrid || []).filter(_isConflictCell).length;

    const totalSlots = [0, 1, 2, 3, 5, 6].reduce((acc, p) => acc + (data.timelines[p]?.length || 0), 0)
        + (data.depthGrid?.length || 0);

    const outletCount = (data.timelines[7]?.length || 0);
    const outletNote = outletCount > 0
        ? `<div class="wb-tl-warn"><i class="ph ph-warning"></i> 检测到 ${outletCount} 条 outlet (pos 7) 条目，时间线模式不展示。</div>`
        : '';

    const hideEmpty = !!state.occupancy?.hideEmpty;
    const renderableAnchors = TIMELINE_ANCHORS.filter(anchor =>
        !hideEmpty || _anchorHasEntries(anchor, data),
    );
    const hiddenAnchorCount = TIMELINE_ANCHORS.length - renderableAnchors.length;

    const conflictBanner = totalConflicts > 0
        ? `<div id="wb-tl-conflict-banner" class="wb-occ-conflict-banner is-clickable" role="button" tabindex="0" title="点击跳转到首处冲突">
              <i class="ph ph-warning-octagon"></i>
              <span>检测到 ${totalConflicts} 处跨书冲突</span>
              <span class="wb-tl-banner-hint"><i class="ph ph-arrow-down"></i> 点击跳转</span>
           </div>`
        : '';

    const infoCard = `
        <div class="wb-tl-info">
            <i class="ph ph-info"></i>
            <div>
                按模型实际读到的顺序自上而下排列。每个位置内顺序小的在前；
                @深度段按深度值由大到小（远 → 近）展开。该顺序为"假设所有条目都已激活"的理论顺序，
                未模拟递归 / 概率等过滤逻辑。
            </div>
        </div>
    `;

    const sectionsHtml = renderableAnchors.map(anchor => _renderTimelineAnchor(anchor, data)).join('');

    const hiddenNote = hideEmpty && hiddenAnchorCount > 0
        ? `<div class="wb-tl-hidden-note"><i class="ph ph-eye-slash"></i> 已折叠 ${hiddenAnchorCount} 个无条目的锚点段</div>`
        : '';

    root.innerHTML = `
        ${conflictBanner}
        ${outletNote}
        ${infoCard}
        <div class="wb-tl">${sectionsHtml}</div>
        ${hiddenNote}
        <div class="wb-occ-stats">共 ${totalSlots} 个被占用的槽位</div>
    `;

    const banner = document.getElementById('wb-tl-conflict-banner');
    if (banner) {
        const jump = () => {
            const target = root.querySelector('.wb-tl-row.is-conflict');
            if (target && typeof target.scrollIntoView === 'function') {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.classList.add('is-flash');
                setTimeout(() => target.classList.remove('is-flash'), 1400);
            }
        };
        banner.addEventListener('click', jump);
        banner.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                jump();
            }
        });
    }

    root.addEventListener('click', _handleTimelineSlotActivate);
    root.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            const target = e.target instanceof HTMLElement ? e.target.closest('.wb-tl-slot.is-clickable') : null;
            if (target) {
                e.preventDefault();
                _activateTimelineSlot(target);
            }
        }
    });
}

function _handleTimelineSlotActivate(ev) {
    const target = ev.target instanceof HTMLElement ? ev.target.closest('.wb-tl-slot.is-clickable') : null;
    if (!target) return;
    _activateTimelineSlot(target);
}

async function _activateTimelineSlot(el) {
    const bookName = el.dataset.book;
    const uid = Number(el.dataset.uid);
    if (!bookName || !Number.isInteger(uid)) return;
    await _openDrawerForEditByName(bookName, uid);
}

async function _openDrawerForEditByName(bookName, uid) {
    let book = state.bookCache.get(bookName);
    if (!book) {
        try {
            book = await rpc('loadBook', { name: bookName });
            if (book) state.bookCache.set(bookName, book);
        } catch (e) {
            console.warn(`${LOG} Failed to load book '${bookName}' for edit:`, e);
            return;
        }
    }
    if (!book || !book.entries || !book.entries[uid]) {
        console.warn(`${LOG} Entry uid=${uid} not found in '${bookName}'`);
        return;
    }
    _openDrawerForEdit(bookName, uid);
}

function _anchorHasEntries(anchor, data) {
    for (const row of anchor.rows) {
        if (row.kind === 'pos' && (data.timelines[row.pos] || []).length > 0) return true;
        if (row.kind === 'depth' && (data.depthGrid || []).length > 0) return true;
    }
    return false;
}

function _anchorConflictCount(anchor, data) {
    let n = 0;
    for (const row of anchor.rows) {
        if (row.kind === 'pos') {
            n += (data.timelines[row.pos] || []).filter(_isConflictCell).length;
        } else if (row.kind === 'depth') {
            n += (data.depthGrid || []).filter(_isConflictCell).length;
        }
    }
    return n;
}

function _renderTimelineAnchor(anchor, data) {
    const hasEntries = _anchorHasEntries(anchor, data);
    const conflictCount = _anchorConflictCount(anchor, data);

    const rowsHtml = anchor.rows.map(row => {
        if (row.kind === 'placeholder') {
            return `<div class="wb-tl-placeholder">${escapeHtml(row.text)}</div>`;
        }
        if (row.kind === 'pos') {
            const cells = data.timelines[row.pos] || [];
            return _renderTimelinePosBlock(row.pos, cells);
        }
        if (row.kind === 'depth') {
            return _renderTimelineDepthBlock(data.depthGrid || []);
        }
        return '';
    }).join('');

    const noteHtml = anchor.note
        ? `<div class="wb-tl-anchor-note"><i class="ph ph-info"></i> ${escapeHtml(anchor.note)}</div>`
        : '';

    const conflictBadge = conflictCount > 0
        ? `<span class="wb-tl-anchor-conflict" title="此段内有 ${conflictCount} 处跨书冲突"><i class="ph ph-warning-octagon"></i> ${conflictCount}</span>`
        : '';

    const emptyTag = !hasEntries
        ? `<span class="wb-tl-anchor-empty">空</span>`
        : '';

    return `
        <section class="wb-tl-anchor ${!hasEntries ? 'is-empty' : ''} ${conflictCount > 0 ? 'has-conflict' : ''}" data-anchor="${anchor.id}">
            <header class="wb-tl-anchor-head">
                <i class="ph ${anchor.icon}"></i>
                <span class="wb-tl-anchor-title">${escapeHtml(anchor.title)}</span>
                ${emptyTag}
                ${conflictBadge}
            </header>
            ${noteHtml}
            <div class="wb-tl-anchor-body">${rowsHtml}</div>
        </section>
    `;
}

function _renderTimelinePosBlock(pos, cells) {
    const label = POSITION_LABELS[pos] || `位置 ${pos}`;
    if (cells.length === 0) {
        return `
            <div class="wb-tl-posblock is-empty" data-pos="${pos}">
                <span class="wb-tl-pos-tag">位置 ${pos}</span>
                <span class="wb-tl-pos-tag-label">${escapeHtml(label)}</span>
                <span class="wb-tl-empty-text">— 无条目</span>
            </div>
        `;
    }
    // cells already sorted by order asc from getOccupancyMap; reaffirm here.
    const sorted = [...cells].sort((a, b) => a.order - b.order);
    const cellsHtml = sorted.map(cell => _renderTimelineEntryRow(cell, { pos })).join('');
    return `
        <div class="wb-tl-posblock" data-pos="${pos}">
            <div class="wb-tl-posblock-head">
                <span class="wb-tl-pos-tag">位置 ${pos}</span>
                <span class="wb-tl-pos-tag-label">${escapeHtml(label)}</span>
                <span class="wb-tl-pos-count">${sorted.length}</span>
            </div>
            <div class="wb-tl-posblock-rows">${cellsHtml}</div>
        </div>
    `;
}

function _renderTimelineDepthBlock(cells) {
    if (!Array.isArray(cells) || cells.length === 0) {
        return `
            <div class="wb-tl-posblock is-empty" data-pos="4">
                <span class="wb-tl-pos-tag">pos 4</span>
                <span class="wb-tl-pos-tag-label">@深度</span>
                <span class="wb-tl-empty-text">— 无 @深度 条目</span>
            </div>
        `;
    }
    // Group by depth desc (far → near). Inside a depth: group by role asc, then order asc.
    const byDepth = new Map();
    for (const cell of cells) {
        for (const slot of (cell.slots || [])) {
            const d = Number(slot.depth ?? cell.depth ?? 0);
            if (!byDepth.has(d)) byDepth.set(d, []);
            byDepth.get(d).push({ slot, order: cell.order });
        }
    }
    const depths = Array.from(byDepth.keys()).sort((a, b) => b - a); // far → near

    const depthHtml = depths.map(depth => {
        const items = byDepth.get(depth);
        // Sub-group by role.
        const byRole = new Map();
        for (const it of items) {
            const r = Number(it.slot.role ?? 0);
            if (!byRole.has(r)) byRole.set(r, []);
            byRole.get(r).push(it);
        }
        const roles = Array.from(byRole.keys()).sort((a, b) => a - b);
        const multiRole = roles.length > 1;
        const distance = depth === 0 ? '最近' : `远 ${'·'.repeat(Math.min(depth, 6))}`;

        const rolesHtml = roles.map(role => {
            const list = byRole.get(role).sort((a, b) => a.order - b.order);
            const roleLabel = DEPTH_ROLE_LABELS[role] || `role ${role}`;
            const slotsHtml = list.map(({ slot, order }) => {
                // Synthesize a cell-like object for the row renderer.
                const cellLike = { order, slots: [slot] };
                return _renderTimelineEntryRow(cellLike, { pos: 4, depth, role });
            }).join('');
            return `
                <div class="wb-tl-depth-role" data-role="${role}">
                    <div class="wb-tl-depth-role-head">
                        <span class="wb-tl-role-badge wb-tl-role-${role}">${escapeHtml(roleLabel)}</span>
                        <span class="wb-tl-role-count">${list.length}</span>
                    </div>
                    <div class="wb-tl-posblock-rows">${slotsHtml}</div>
                </div>
            `;
        }).join('');

        const multiHint = multiRole
            ? `<span class="wb-tl-multirole-hint" title="该 depth 内混合了 ${roles.length} 种 role"><i class="ph ph-stack"></i> ${roles.length} roles</span>`
            : '';

        return `
            <div class="wb-tl-depth ${multiRole ? 'is-multirole' : ''}" data-depth="${depth}">
                <div class="wb-tl-depth-head">
                    <span class="wb-tl-pos-tag">@深度 ${depth}</span>
                    <span class="wb-tl-depth-distance">${escapeHtml(distance)}</span>
                    ${multiHint}
                </div>
                <div class="wb-tl-depth-body">${rolesHtml}</div>
            </div>
        `;
    }).join('');

    return `<div class="wb-tl-depthblock">${depthHtml}</div>`;
}

function _renderTimelineEntryRow(cell, ctx) {
    const isConflict = _isConflictCell(cell);
    const conflictBadge = isConflict
        ? `<span class="wb-tl-conflict-badge"><i class="ph ph-warning"></i> 冲突 ×${cell.slots.length}</span>`
        : '';
    const slotsHtml = cell.slots.map(s => _renderTimelineSlot(s)).join('');
    const orderTag = `<span class="wb-tl-order">order ${cell.order}</span>`;
    return `
        <div class="wb-tl-row ${isConflict ? 'is-conflict' : ''}" data-pos="${ctx.pos}" title="${escapeAttr(_describeCell(cell))}">
            <div class="wb-tl-row-meta">${orderTag}${conflictBadge}</div>
            <div class="wb-tl-row-slots">${slotsHtml}</div>
        </div>
    `;
}

function _renderTimelineSlot(slot) {
    const color = _bookColor(slot.bookName);
    const keysPreviewArr = Array.isArray(slot.keyPreview) ? slot.keyPreview : [];
    const keysLabel = keysPreviewArr.length > 0
        ? keysPreviewArr.join(' / ') + (slot.keyCount > keysPreviewArr.length ? ` +${slot.keyCount - keysPreviewArr.length}` : '')
        : '(无关键词)';
    const commentTrim = (slot.comment || '').trim();
    const titleText = commentTrim || keysLabel;

    // Multi-line tooltip (native title respects \n inside attribute).
    const tooltipLines = [`${slot.bookName} · uid ${slot.uid}`];
    if (commentTrim) tooltipLines.push(`备注: ${commentTrim}`);
    if (keysPreviewArr.length > 0) {
        tooltipLines.push(`关键词: ${keysLabel}`);
    } else {
        tooltipLines.push('关键词: (无)');
    }
    if (slot.constant) tooltipLines.push('★ 始终生效');
    if (slot.disable) tooltipLines.push('⊘ disabled');
    const tooltip = tooltipLines.join('\n');

    const flagsHtml = `
        ${slot.constant ? '<i class="ph ph-circles-three wb-occ-slot-flag" title="始终生效"></i>' : ''}
        ${slot.disable ? '<i class="ph ph-prohibit wb-occ-slot-flag" title="disabled"></i>' : ''}
    `;
    const canEdit = slot.bookName && Number.isInteger(slot.uid);
    const editAttrs = canEdit
        ? `role="button" tabindex="0" data-book="${escapeAttr(slot.bookName)}" data-uid="${slot.uid}"`
        : '';
    return `
        <div class="wb-tl-slot ${slot.disable ? 'is-disabled' : ''} ${canEdit ? 'is-clickable' : ''}" style="--wb-occ-book-color:${color};" title="${escapeAttr(tooltip)}" ${editAttrs}>
            <span class="wb-tl-slot-swatch"></span>
            <span class="wb-tl-slot-book">${escapeHtml(slot.bookName)}</span>
            <span class="wb-tl-slot-title">${escapeHtml(titleText)}</span>
            ${flagsHtml}
        </div>
    `;
}

function _renderTimelineRow(pos, items) {
    const label = POSITION_LABELS[pos] || `位置 ${pos}`;
    if (items.length === 0) {
        return `
            <div class="wb-occ-timeline">
                <div class="wb-occ-timeline-label">
                    <span class="wb-occ-pos-num">位置 ${pos}</span>
                    <span class="wb-occ-pos-label">${escapeHtml(label)}</span>
                </div>
                <div class="wb-occ-timeline-body is-empty">空闲</div>
            </div>
        `;
    }
    const cellsHtml = items.map(cell => _renderTimelineCell(cell)).join('');
    return `
        <div class="wb-occ-timeline">
            <div class="wb-occ-timeline-label">
                <span class="wb-occ-pos-num">位置 ${pos}</span>
                <span class="wb-occ-pos-label">${escapeHtml(label)}</span>
                <span class="wb-occ-pos-count">${items.length}</span>
            </div>
            <div class="wb-occ-timeline-body">${cellsHtml}</div>
        </div>
    `;
}

function _renderTimelineCell(cell) {
    const isConflict = _isConflictCell(cell);
    const stack = cell.slots.map(s => _renderSlotChip(s, false)).join('');
    const conflictBadge = isConflict
        ? `<div class="wb-occ-conflict-badge"><i class="ph ph-warning"></i> 冲突 ×${cell.slots.length}</div>`
        : '';
    return `
        <div class="wb-occ-cell ${isConflict ? 'is-conflict' : ''}" title="${escapeAttr(_describeCell(cell))}">
            <div class="wb-occ-cell-order">order ${cell.order}</div>
            <div class="wb-occ-cell-slots">${stack}</div>
            ${conflictBadge}
        </div>
    `;
}

function _renderDepthGrid(cells) {
    if (!Array.isArray(cells) || cells.length === 0) {
        return '<div class="wb-occ-grid-empty">没有 @深度 类条目</div>';
    }
    const depths = Array.from(new Set(cells.map(c => c.depth))).sort((a, b) => a - b);
    const orders = Array.from(new Set(cells.map(c => c.order))).sort((a, b) => a - b);
    const lookup = new Map(cells.map(c => [`${c.depth}|${c.order}`, c]));

    let html = '<div class="wb-occ-grid-wrap"><table class="wb-occ-grid"><thead><tr>';
    html += '<th class="wb-occ-grid-corner">depth \\ order</th>';
    for (const o of orders) html += `<th class="wb-occ-grid-col-h">${o}</th>`;
    html += '</tr></thead><tbody>';
    for (const d of depths) {
        html += `<tr><th class="wb-occ-grid-row-h">depth ${d}</th>`;
        for (const o of orders) {
            const cell = lookup.get(`${d}|${o}`);
            if (!cell) {
                html += '<td class="wb-occ-grid-cell wb-occ-grid-cell-empty"></td>';
            } else {
                const isConflict = _isConflictCell(cell);
                const slotsHtml = cell.slots.map(s => _renderSlotChip(s, true)).join('');
                const badge = isConflict
                    ? `<div class="wb-occ-conflict-badge"><i class="ph ph-warning"></i> ×${cell.slots.length}</div>`
                    : '';
                html += `<td class="wb-occ-grid-cell ${isConflict ? 'is-conflict' : ''}" title="${escapeAttr(_describeCell(cell))}">${slotsHtml}${badge}</td>`;
            }
        }
        html += '</tr>';
    }
    html += '</tbody></table></div>';
    return html;
}

function _renderSlotChip(slot, compact) {
    const color = _bookColor(slot.bookName);
    const keysLabel = slot.keyPreview.length > 0
        ? slot.keyPreview.join(' / ') + (slot.keyCount > slot.keyPreview.length ? ` +${slot.keyCount - slot.keyPreview.length}` : '')
        : '(无关键词)';
    const title = (slot.comment && slot.comment.trim()) || keysLabel;
    const flagsHtml = `
        ${slot.constant ? '<i class="ph ph-circles-three wb-occ-slot-flag" title="始终生效"></i>' : ''}
        ${slot.disable ? '<i class="ph ph-prohibit wb-occ-slot-flag" title="disabled"></i>' : ''}
    `;
    if (compact) {
        return `
            <div class="wb-occ-slot is-compact ${slot.disable ? 'is-disabled' : ''}" style="--wb-occ-book-color:${color};">
                <span class="wb-occ-slot-swatch"></span>
                <span class="wb-occ-slot-book" title="${escapeAttr(slot.bookName + ' · uid ' + slot.uid)}">${escapeHtml(slot.bookName)}</span>
                ${flagsHtml}
            </div>
        `;
    }
    return `
        <div class="wb-occ-slot ${slot.disable ? 'is-disabled' : ''}" style="--wb-occ-book-color:${color};">
            <div class="wb-occ-slot-head">
                <span class="wb-occ-slot-swatch"></span>
                <span class="wb-occ-slot-book" title="${escapeAttr(slot.bookName + ' · uid ' + slot.uid)}">${escapeHtml(slot.bookName)}</span>
                ${flagsHtml}
            </div>
            <div class="wb-occ-slot-title">${escapeHtml(title)}</div>
        </div>
    `;
}

function _isConflictCell(cell) {
    if (!cell || !Array.isArray(cell.slots) || cell.slots.length < 2) return false;
    const books = new Set(cell.slots.map(s => s.bookName));
    return books.size > 1;
}

function _describeCell(cell) {
    if (!cell) return '';
    const parts = [];
    if (cell.depth !== undefined) parts.push(`深度 ${cell.depth}`);
    parts.push(`顺序 ${cell.order}`);
    parts.push('—');
    parts.push(cell.slots.map(s => `${s.bookName}#${s.uid}`).join(', '));
    return parts.join(' ');
}

function _bookColor(name) {
    let hash = 0;
    const str = String(name || '');
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    const hue = ((hash % 360) + 360) % 360;
    return `hsl(${hue}deg, 60%, 70%)`;
}

export function boot() {
    console.log(`${LOG} Boot`);

    const app = document.getElementById('wb-app');
    if (!app) {
        console.error(`${LOG} #wb-app container missing`);
        return;
    }

    app.innerHTML = `
        <header class="wb-header">
            <i class="ph ph-book-open-text" style="font-size:22px;color:#ffffff;"></i>
            <h1>世界书编辑器</h1>
            <nav class="wb-tabs" role="tablist">
                <button type="button" class="wb-tab is-active" data-view="entries" role="tab" aria-selected="true">
                    <i class="ph ph-list"></i> 条目编辑
                </button>
                <button type="button" class="wb-tab" data-view="occupancy" role="tab" aria-selected="false">
                    <i class="ph ph-grid-four"></i> 槽位视图
                </button>
            </nav>
            <span id="wb-current-char" class="wb-char-badge"></span>
            <span class="wb-header-spacer"></span>
            <span class="wb-bridge-indicator">
                <span id="wb-bridge-dot" class="wb-status-dot"></span>
                <span id="wb-bridge-status">bridge 等待 init...</span>
            </span>
        </header>

        <main class="wb-main">
            <div id="wb-view-entries" class="wb-view wb-view-entries is-active">
                <aside class="wb-sidebar">
                    <div class="wb-search">
                        <i class="ph ph-magnifying-glass"></i>
                        <input id="wb-book-filter" type="text" placeholder="任意关键词" />
                        <button id="wb-sidebar-collapse" class="wb-sidebar-toggle" type="button" title="收起侧边栏" aria-label="收起侧边栏">
                            <i class="ph ph-caret-double-left"></i>
                        </button>
                    </div>
                    <div id="wb-book-list" class="wb-book-list">
                        <div class="wb-empty-mini">等待 init payload...</div>
                    </div>
                </aside>

                <section class="wb-detail-pane">
                    <div id="wb-detail" class="wb-detail">
                        <div class="wb-detail-placeholder">
                            <i class="ph ph-arrow-left"></i>
                            <p>从左侧选一本世界书查看条目</p>
                        </div>
                    </div>
                </section>

                <button id="wb-sidebar-expand" class="wb-sidebar-expand" type="button" title="展开侧边栏" aria-label="展开侧边栏">
                    <i class="ph ph-caret-double-right"></i>
                </button>
            </div>

            <div id="wb-view-occupancy" class="wb-view wb-view-occupancy" hidden>
                <div class="wb-detail-placeholder">
                    <i class="ph ph-spinner-gap"></i>
                    <p>初始化中...</p>
                </div>
            </div>
        </main>

        <footer class="wb-footer">
            <button id="wb-ping-btn" class="wb-btn wb-btn-ghost">
                <i class="ph ph-broadcast"></i> ping bridge
            </button>
            <span id="wb-ping-output" class="wb-footer-output"></span>
        </footer>

        <div id="wb-drawer-root" class="wb-drawer-root"></div>
    `;

    document.getElementById('wb-ping-btn')?.addEventListener('click', _handlePingClick);

    const filterInput = document.getElementById('wb-book-filter');
    filterInput?.addEventListener('input', (e) => {
        _scheduleGlobalSearch(e.target.value || '');
    });

    document.querySelectorAll('.wb-tab').forEach(el => {
        el.addEventListener('click', () => {
            const v = el.getAttribute('data-view');
            if (v === 'entries' || v === 'occupancy') _switchView(v);
        });
    });

    document.getElementById('wb-sidebar-collapse')?.addEventListener('click', _toggleSidebar);
    document.getElementById('wb-sidebar-expand')?.addEventListener('click', _toggleSidebar);

    _renderCharBadge();
    _setBridgeStatus('idle', 'bridge 等待 init...');
}

function _toggleSidebar() {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    const view = document.getElementById('wb-view-entries');
    if (view) view.classList.toggle('is-sidebar-collapsed', state.sidebarCollapsed);
}

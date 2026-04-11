// modules/phone/literature/writingTab.js — 写作 Tab UI + Logic
// Simulates a web novel platform with author profile, works, chapters, comments, and contract system.

import { escapeHtml } from '../utils/helpers.js';
import { showToast } from '../moments/momentsUI.js';
import { walletAdd } from '../moments/apiClient.js';
import {
    loadWritingData, saveWritingData,
    createWork, addChapter, addComment, setCommentReply, updateWorkStats, signWork, getChapterReward,
    getWork, getAllWorks, WORK_TYPES, CONTRACT_TIERS,
} from './literatureStorage.js';
import {
    generateAuthorInit, generateChapterUpdate, evaluateContract,
    generateAuthorReply, generateNewWork,
} from './literatureGeneration.js';

const AURIC_CELLS_ICON = '/scripts/extensions/third-party/TheGhostFace/assets/images/IconCurrency_auricCells.png';

let _currentWorkId = null;

// ═══════════════════════════════════════════════════════════════════════
// Public: Render Writing Tab Content
// ═══════════════════════════════════════════════════════════════════════

export function renderWritingTab(container) {
    const data = loadWritingData();

    if (!data.authorProfile.initialized) {
        _renderInitScreen(container);
    } else {
        _renderAuthorHome(container, data);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Init Screen — First-time setup
// ═══════════════════════════════════════════════════════════════════════

function _renderInitScreen(container) {
    container.innerHTML = `
        <div class="lit-init-screen">
            <div class="lit-init-icon"><i class="ph ph-pen-nib"></i></div>
            <div class="lit-init-title">创作平台</div>
            <div class="lit-init-desc">
                Ta 最近好像对写作产生了兴趣……<br>
                点击下方按钮，看看 Ta 在网文平台上都写了些什么？
            </div>
            <button class="lit-init-btn" id="lit_init_btn">
                <i class="ph ph-sparkle"></i> 发现 Ta 的秘密创作
            </button>
        </div>
    `;

    document.getElementById('lit_init_btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('lit_init_btn');
        if (!btn || btn.disabled) return;

        btn.disabled = true;
        btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 正在潜入创作平台……';

        try {
            const result = await generateAuthorInit();
            const data = loadWritingData();

            // Save author profile
            data.authorProfile.penName = result.profile.penName;
            data.authorProfile.bio = result.profile.bio;
            data.authorProfile.initialized = true;

            // Create first work
            const work = createWork(data, {
                title: result.firstWork.title,
                type: result.firstWork.type,
                genre: result.firstWork.genre,
                initialRating: result.firstWork.initialRating || 7.0,
                initialRatingCount: result.firstWork.initialRatingCount || 3,
                initialFavorites: result.firstWork.initialFavorites || 5,
                initialReaders: result.firstWork.initialReaders || 12,
            });

            // Add first chapter
            addChapter(data, work.id, {
                title: result.firstWork.firstChapterTitle,
                content: result.firstWork.firstChapterContent,
            });

            // Store synopsis as a special meta-comment
            if (result.firstWork.synopsis) {
                work.synopsis = result.firstWork.synopsis;
                saveWritingData(data);
            }

            showToast('发现了 Ta 的创作秘密！');
            _renderAuthorHome(container, data);
        } catch (err) {
            console.error('[文学] Init failed:', err);
            showToast('生成失败：' + err.message);
            btn.disabled = false;
            btn.innerHTML = '<i class="ph ph-sparkle"></i> 发现 Ta 的秘密创作';
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Author Home — Profile + Works List
// ═══════════════════════════════════════════════════════════════════════

function _renderAuthorHome(container, data) {
    _currentWorkId = null;
    const profile = data.authorProfile;
    const works = getAllWorks(data);

    // Best contract tier
    const bestTier = Math.max(0, ...works.map(w => w.contractTier));
    const tierInfo = CONTRACT_TIERS[bestTier];

    const worksHtml = works.map(w => {
        const typeLabel = WORK_TYPES[w.type] || w.type;
        const chCount = w.chapters.length;
        const totalWords = w.chapters.reduce((sum, ch) => sum + (ch.wordCount || 0), 0);
        const statusLabel = w.status === 'ongoing' ? '连载中' : w.status === 'completed' ? '已完结' : '暂停中';
        const tier = CONTRACT_TIERS[w.contractTier];

        return `
            <div class="lit-work-card" data-work-id="${w.id}">
                <div class="lit-work-card-header">
                    <div class="lit-work-title">${escapeHtml(w.title)}</div>
                    ${w.signed ? `<span class="lit-contract-badge" style="color:${tier.color}"><i class="ph-fill ${tier.icon}"></i> ${tier.label}</span>` : ''}
                </div>
                <div class="lit-work-meta">
                    <span class="lit-work-tag">${escapeHtml(typeLabel)}</span>
                    <span class="lit-work-tag">${escapeHtml(w.genre)}</span>
                    <span class="lit-work-status ${w.status}">${statusLabel}</span>
                </div>
                <div class="lit-work-stats">
                    <span><i class="ph ph-star"></i> ${w.rating.toFixed(1)}</span>
                    <span><i class="ph ph-book-open"></i> ${chCount}章</span>
                    <span><i class="ph ph-text-aa"></i> ${_formatNumber(totalWords)}字</span>
                    <span><i class="ph ph-heart"></i> ${_formatNumber(w.favorites)}</span>
                    <span><i class="ph ph-users"></i> ${_formatNumber(w.readers)}</span>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="lit-author-home">
            <!-- Author Profile Card -->
            <div class="lit-profile-card">
                <div class="lit-profile-header">
                    <div class="lit-profile-avatar"><i class="ph-fill ph-user-circle"></i></div>
                    <div class="lit-profile-info">
                        <div class="lit-profile-name">${escapeHtml(profile.penName)}</div>
                        <div class="lit-profile-tier" style="color:${tierInfo.color}">
                            <i class="ph-fill ${tierInfo.icon}"></i> ${tierInfo.label}
                        </div>
                    </div>
                </div>
                <div class="lit-profile-bio">${escapeHtml(profile.bio)}</div>
                <div class="lit-profile-stat-row">
                    <div class="lit-profile-stat">
                        <div class="lit-profile-stat-num">${works.length}</div>
                        <div class="lit-profile-stat-label">作品</div>
                    </div>
                    <div class="lit-profile-stat">
                        <div class="lit-profile-stat-num">${_formatNumber(profile.totalWords)}</div>
                        <div class="lit-profile-stat-label">总字数</div>
                    </div>
                    <div class="lit-profile-stat">
                        <div class="lit-profile-stat-num">${profile.signedWorks.length}</div>
                        <div class="lit-profile-stat-label">签约</div>
                    </div>
                </div>
            </div>

            <!-- Works List -->
            <div class="lit-section-header">
                <span>作品列表</span>
                <button class="lit-new-work-btn" id="lit_new_work_btn">
                    <i class="ph ph-plus"></i> 新作品
                </button>
            </div>
            <div class="lit-works-list">
                ${worksHtml || '<div class="lit-empty">暂无作品</div>'}
            </div>
        </div>
    `;

    // Bind work card clicks
    container.querySelectorAll('.lit-work-card').forEach(card => {
        card.addEventListener('click', () => {
            const workId = card.dataset.workId;
            _openWorkDetail(container, workId);
        });
    });

    // Bind new work button
    document.getElementById('lit_new_work_btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('lit_new_work_btn');
        if (!btn || btn.disabled) return;

        btn.disabled = true;
        btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';

        try {
            const data = loadWritingData();
            const result = await generateNewWork(data.works);
            const work = createWork(data, {
                title: result.title,
                type: result.type,
                genre: result.genre,
                initialRating: result.initialRating || 0,
                initialRatingCount: result.initialRatingCount || 0,
                initialFavorites: result.initialFavorites || 0,
                initialReaders: result.initialReaders || 0,
            });

            if (result.synopsis) {
                work.synopsis = result.synopsis;
            }

            addChapter(data, work.id, {
                title: result.firstChapterTitle,
                content: result.firstChapterContent,
            });

            showToast('开新坑啦！');
            _renderAuthorHome(container, data);
        } catch (err) {
            console.error('[文学] New work failed:', err);
            showToast('生成失败：' + err.message);
            btn.disabled = false;
            btn.innerHTML = '<i class="ph ph-plus"></i> 新作品';
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Work Detail — Chapters + Comments + Update
// ═══════════════════════════════════════════════════════════════════════

function _openWorkDetail(container, workId) {
    const data = loadWritingData();
    const work = getWork(data, workId);
    if (!work) return;

    _currentWorkId = workId;
    const typeLabel = WORK_TYPES[work.type] || work.type;
    const tier = CONTRACT_TIERS[work.contractTier];

    // Chapters list
    const chaptersHtml = work.chapters.map((ch, i) => `
        <div class="lit-chapter-item" data-ch-idx="${i}">
            <span class="lit-chapter-num">${i + 1}</span>
            <span class="lit-chapter-title">${escapeHtml(ch.title)}</span>
            <span class="lit-chapter-words">${_formatNumber(ch.wordCount)}字</span>
        </div>
    `).join('');

    // Comments
    const commentsHtml = _buildCommentsHtml(work);

    // Reward info for signed works
    const rewardPerChapter = getChapterReward(work);
    const rewardHtml = work.signed ? `
        <div class="lit-reward-badge">
            <img src="${AURIC_CELLS_ICON}" class="lit-auric-icon" alt="暗金细胞" />
            <span>更新奖励：${rewardPerChapter} / 章</span>
        </div>
    ` : '';

    container.innerHTML = `
        <div class="lit-work-detail">
            <!-- Work Header -->
            <div class="lit-detail-header">
                <button class="lit-back-btn" id="lit_back_to_home">
                    <i class="ph ph-caret-left"></i>
                </button>
                <div class="lit-detail-title-area">
                    <div class="lit-detail-title">${escapeHtml(work.title)}</div>
                    <div class="lit-detail-meta">
                        <span class="lit-work-tag">${escapeHtml(typeLabel)}</span>
                        <span class="lit-work-tag">${escapeHtml(work.genre)}</span>
                        ${work.signed ? `<span class="lit-contract-badge" style="color:${tier.color}"><i class="ph-fill ${tier.icon}"></i> ${tier.label}</span>` : ''}
                    </div>
                </div>
            </div>

            ${work.synopsis ? `<div class="lit-synopsis">${escapeHtml(work.synopsis)}</div>` : ''}

            <!-- Stats Bar -->
            <div class="lit-stats-bar">
                <div class="lit-stat-item">
                    <div class="lit-stat-num">${work.rating.toFixed(1)}</div>
                    <div class="lit-stat-label"><i class="ph ph-star"></i> 评分</div>
                </div>
                <div class="lit-stat-item">
                    <div class="lit-stat-num">${_formatNumber(work.favorites)}</div>
                    <div class="lit-stat-label"><i class="ph ph-heart"></i> 收藏</div>
                </div>
                <div class="lit-stat-item">
                    <div class="lit-stat-num">${_formatNumber(work.readers)}</div>
                    <div class="lit-stat-label"><i class="ph ph-users"></i> 读者</div>
                </div>
                <div class="lit-stat-item">
                    <div class="lit-stat-num">${work.ratingCount}</div>
                    <div class="lit-stat-label"><i class="ph ph-chat-dots"></i> 评价</div>
                </div>
            </div>

            ${rewardHtml}

            <!-- Action Bar -->
            <div class="lit-action-bar">
                <button class="lit-update-btn" id="lit_update_btn">
                    <i class="ph ph-pencil-line"></i> 催更
                </button>
            </div>

            <!-- Chapters Section -->
            <div class="lit-section-header"><span>章节目录</span></div>
            <div class="lit-chapters-list" id="lit_chapters_list">
                ${chaptersHtml || '<div class="lit-empty">暂无章节</div>'}
            </div>

            <!-- Comments Section -->
            <div class="lit-section-header"><span>读者评论 (${work.comments.length})</span></div>
            <div class="lit-comments-list" id="lit_comments_list">
                ${commentsHtml}
            </div>

            <!-- User Comment Input -->
            <div class="lit-comment-input-area">
                <textarea id="lit_user_comment" class="lit-comment-textarea" placeholder="写条评论……" rows="2" maxlength="300"></textarea>
                <div class="lit-comment-input-row">
                    <div class="lit-user-rating" id="lit_user_rating">
                        ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<span class="lit-rate-dot${n <= 7 ? ' active' : ''}" data-rate="${n}">${n}</span>`).join('')}
                    </div>
                    <button class="lit-comment-submit" id="lit_submit_comment">发布</button>
                </div>
            </div>
        </div>

        <!-- Chapter Reader Overlay -->
        <div class="lit-reader-overlay" id="lit_reader_overlay">
            <div class="lit-reader-header">
                <button class="lit-back-btn" id="lit_reader_close"><i class="ph ph-caret-left"></i></button>
                <div class="lit-reader-title" id="lit_reader_title"></div>
            </div>
            <div class="lit-reader-body" id="lit_reader_body"></div>
        </div>

        <!-- Contract Event Overlay -->
        <div class="lit-contract-overlay" id="lit_contract_overlay">
            <div class="lit-contract-modal" id="lit_contract_modal"></div>
        </div>
    `;

    _bindWorkDetailEvents(container, work);
}

function _bindWorkDetailEvents(container, work) {
    // Back button
    document.getElementById('lit_back_to_home')?.addEventListener('click', () => {
        _renderAuthorHome(container, loadWritingData());
    });

    // Chapter clicks → open reader
    container.querySelectorAll('.lit-chapter-item').forEach(item => {
        item.addEventListener('click', () => {
            const idx = parseInt(item.dataset.chIdx);
            _openChapterReader(work, idx);
        });
    });

    // Reader close
    document.getElementById('lit_reader_close')?.addEventListener('click', () => {
        document.getElementById('lit_reader_overlay')?.classList.remove('active');
    });

    // Update button (催更)
    document.getElementById('lit_update_btn')?.addEventListener('click', () => {
        _handleUpdate(container, work.id);
    });

    // User rating selection
    let selectedRating = 7;
    document.getElementById('lit_user_rating')?.addEventListener('click', (e) => {
        const dot = e.target.closest('.lit-rate-dot');
        if (!dot) return;
        selectedRating = parseInt(dot.dataset.rate);
        document.querySelectorAll('.lit-rate-dot').forEach((d, i) => {
            d.classList.toggle('active', i < selectedRating);
        });
    });

    // Submit user comment
    document.getElementById('lit_submit_comment')?.addEventListener('click', () => {
        const textarea = document.getElementById('lit_user_comment');
        const content = textarea?.value?.trim();
        if (!content) { showToast('请输入评论内容'); return; }

        const data = loadWritingData();
        addComment(data, work.id, {
            author: '我',
            content,
            rating: selectedRating,
            isReader: false,
        });

        textarea.value = '';
        showToast('评论已发布');

        // Refresh comments
        const freshWork = getWork(data, work.id);
        const listEl = document.getElementById('lit_comments_list');
        if (listEl && freshWork) {
            listEl.innerHTML = _buildCommentsHtml(freshWork);
            _bindReplyButtons(container, work.id);
        }
    });

    // Reply buttons for reader comments
    _bindReplyButtons(container, work.id);
}

// ═══════════════════════════════════════════════════════════════════════
// Reply Button Handlers (Author replies to reader comments)
// ═══════════════════════════════════════════════════════════════════════

function _bindReplyButtons(container, workId) {
    container.querySelectorAll('.lit-reply-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const commentId = btn.dataset.commentId;
            if (!commentId || btn.disabled) return;

            // Show loading state
            btn.disabled = true;
            btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';

            try {
                const data = loadWritingData();
                const work = getWork(data, workId);
                if (!work) throw new Error('作品不存在');

                const comment = work.comments.find(c => c.id === commentId);
                if (!comment) throw new Error('评论不存在');

                // Generate reply via LLM
                const reply = await generateAuthorReply(work, comment);

                // Save reply
                setCommentReply(data, workId, commentId, reply);

                showToast('作者已回复');

                // Refresh comments
                const freshWork = getWork(loadWritingData(), workId);
                const listEl = document.getElementById('lit_comments_list');
                if (listEl && freshWork) {
                    listEl.innerHTML = _buildCommentsHtml(freshWork);
                    _bindReplyButtons(container, workId);
                }
            } catch (err) {
                console.error('[文学] Reply failed:', err);
                showToast('回复失败：' + err.message);
                btn.disabled = false;
                btn.innerHTML = '<i class="ph ph-chat-text"></i>';
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Chapter Reader
// ═══════════════════════════════════════════════════════════════════════

function _openChapterReader(work, chapterIdx) {
    const chapter = work.chapters[chapterIdx];
    if (!chapter) return;

    const overlay = document.getElementById('lit_reader_overlay');
    const titleEl = document.getElementById('lit_reader_title');
    const bodyEl = document.getElementById('lit_reader_body');

    if (!overlay || !titleEl || !bodyEl) return;

    titleEl.textContent = chapter.title;

    // Format content with paragraph breaks
    const paragraphs = chapter.content.split(/\n+/).filter(p => p.trim());
    bodyEl.innerHTML = paragraphs.map(p =>
        `<p class="lit-reader-paragraph">${escapeHtml(p.trim())}</p>`
    ).join('');

    // Navigation
    const hasNext = chapterIdx < work.chapters.length - 1;
    const hasPrev = chapterIdx > 0;
    bodyEl.innerHTML += `
        <div class="lit-reader-nav">
            ${hasPrev ? `<button class="lit-reader-nav-btn" id="lit_reader_prev">上一章</button>` : '<span></span>'}
            <span class="lit-reader-progress">${chapterIdx + 1} / ${work.chapters.length}</span>
            ${hasNext ? `<button class="lit-reader-nav-btn" id="lit_reader_next">下一章</button>` : '<span></span>'}
        </div>
    `;

    overlay.classList.add('active');
    bodyEl.scrollTop = 0;

    // Nav buttons
    document.getElementById('lit_reader_prev')?.addEventListener('click', () => {
        _openChapterReader(work, chapterIdx - 1);
    });
    document.getElementById('lit_reader_next')?.addEventListener('click', () => {
        _openChapterReader(work, chapterIdx + 1);
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Update Flow (催更)
// ═══════════════════════════════════════════════════════════════════════

async function _handleUpdate(container, workId) {
    const btn = document.getElementById('lit_update_btn');
    if (!btn || btn.disabled) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 创作中……';

    try {
        let data = loadWritingData();
        let work = getWork(data, workId);
        if (!work) throw new Error('作品不存在');

        // 1. Generate chapter + comments + stats
        const result = await generateChapterUpdate(work);

        // 2. Add new chapter
        addChapter(data, workId, {
            title: result.chapter.title,
            content: result.chapter.content,
        });

        // 3. Add reader comments
        if (result.newComments && Array.isArray(result.newComments)) {
            for (const cmt of result.newComments) {
                addComment(data, workId, {
                    author: cmt.author,
                    content: cmt.content,
                    rating: cmt.rating,
                    isReader: true,
                });
            }
        }

        // 4. Update stats
        if (result.statsUpdate) {
            const s = result.statsUpdate;
            work = getWork(data, workId); // Refresh ref
            updateWorkStats(data, workId, {
                rating: Math.max(0, Math.min(10, work.rating + (s.ratingDelta || 0))),
                ratingCount: work.ratingCount + (s.newRatingCount || 0),
                favorites: Math.max(0, work.favorites + (s.favoriteDelta || 0)),
                readers: Math.max(0, work.readers + (s.readerDelta || 0)),
            });
        }

        // 5. Handle signed work reward
        work = getWork(data, workId);
        if (work.signed) {
            const reward = getChapterReward(work);
            try {
                await walletAdd(reward, `文学签约更新：${work.title}`);
                showToast(`更新成功！签约奖励 +${reward} 暗金细胞`);
            } catch (e) {
                console.warn('[文学] Wallet add failed:', e);
                showToast('更新成功！（奖励发放失败）');
            }
        } else {
            showToast('更新成功！');
        }

        // 6. Check for contract event (SURPRISE!)
        if (!work.signed && result.qualityAssessment) {
            const contractResult = evaluateContract(work, result.qualityAssessment.qualityScore);
            if (contractResult && contractResult.shouldSign) {
                signWork(data, workId, contractResult.tier);
                // Show contract celebration after a brief delay
                setTimeout(() => {
                    _showContractEvent(container, work, contractResult);
                }, 800);
            }
        }

        // 7. Re-render
        _openWorkDetail(container, workId);

    } catch (err) {
        console.error('[文学] Update failed:', err);
        showToast('催更失败：' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="ph ph-pencil-line"></i> 催更';
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Contract Celebration (签约庆祝)
// ═══════════════════════════════════════════════════════════════════════

function _showContractEvent(container, work, contractResult) {
    const overlay = document.getElementById('lit_contract_overlay');
    const modal = document.getElementById('lit_contract_modal');
    if (!overlay || !modal) return;

    const tier = CONTRACT_TIERS[contractResult.tier];
    const reward = getChapterReward(work);

    modal.innerHTML = `
        <div class="lit-contract-celebration">
            <div class="lit-contract-icon" style="color: ${tier.color}">
                <i class="ph-fill ${tier.icon}"></i>
            </div>
            <div class="lit-contract-title">恭喜签约！</div>
            <div class="lit-contract-tier" style="color: ${tier.color}">${tier.label}</div>
            <div class="lit-contract-message">${escapeHtml(contractResult.editorMessage)}</div>
            <div class="lit-contract-reward">
                <img src="${AURIC_CELLS_ICON}" class="lit-auric-icon" alt="暗金细胞" />
                <span>签约后每次更新可获得 <strong>${reward}</strong> 暗金细胞</span>
            </div>
            <button class="lit-contract-accept-btn" id="lit_contract_accept">
                <i class="ph ph-check"></i> 接受签约
            </button>
        </div>
    `;

    overlay.classList.add('active');

    document.getElementById('lit_contract_accept')?.addEventListener('click', () => {
        overlay.classList.remove('active');
        showToast('签约成功！每次更新都会获得暗金细胞奖励！');
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Comments Builder
// ═══════════════════════════════════════════════════════════════════════

function _buildCommentsHtml(work) {
    if (!work.comments || work.comments.length === 0) {
        return '<div class="lit-empty">暂无评论</div>';
    }

    // Show most recent first
    const sorted = [...work.comments].reverse();

    return sorted.map(c => {
        const isUser = !c.isReader;
        const ratingDots = c.rating ? `<span class="lit-comment-rating">${c.rating}/10</span>` : '';
        const authorIcon = isUser
            ? '<i class="ph-fill ph-user-circle lit-comment-icon-user"></i>'
            : '<i class="ph-fill ph-user-circle lit-comment-icon-reader"></i>';

        let replyHtml = '';
        if (c.authorReply) {
            replyHtml = `
                <div class="lit-comment-reply">
                    <i class="ph ph-arrow-bend-down-right"></i>
                    <span class="lit-reply-author">作者回复：</span>
                    ${escapeHtml(c.authorReply)}
                </div>
            `;
        }

        // Reply button for reader comments without replies
        const replyBtn = c.isReader && !c.authorReply
            ? `<button class="lit-reply-btn" data-comment-id="${c.id}"><i class="ph ph-chat-text"></i></button>`
            : '';

        return `
            <div class="lit-comment-card ${isUser ? 'lit-comment-mine' : ''}">
                <div class="lit-comment-header">
                    <div class="lit-comment-author">${authorIcon} ${escapeHtml(c.author)}</div>
                    <div class="lit-comment-header-right">
                        ${ratingDots}
                        ${replyBtn}
                    </div>
                </div>
                <div class="lit-comment-content">${escapeHtml(c.content)}</div>
                ${replyHtml}
            </div>
        `;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════════════
// Back Button Integration
// ═══════════════════════════════════════════════════════════════════════

let _backBound = false;

export function bindWritingBackButton() {
    if (_backBound) return;

    window.addEventListener('phone-app-back', (e) => {
        // Contract overlay
        const contractOverlay = document.getElementById('lit_contract_overlay');
        if (contractOverlay?.classList.contains('active')) {
            e.preventDefault();
            contractOverlay.classList.remove('active');
            return;
        }

        // Reader overlay
        const readerOverlay = document.getElementById('lit_reader_overlay');
        if (readerOverlay?.classList.contains('active')) {
            e.preventDefault();
            readerOverlay.classList.remove('active');
            return;
        }

        // Work detail → back to home
        if (_currentWorkId) {
            e.preventDefault();
            const container = document.getElementById('lit_tab_writing');
            if (container) _renderAuthorHome(container, loadWritingData());
            return;
        }
    });

    _backBound = true;
}

// ═══════════════════════════════════════════════════════════════════════
// Utility
// ═══════════════════════════════════════════════════════════════════════

function _formatNumber(n) {
    if (n == null) return '0';
    if (n >= 10000) return (n / 10000).toFixed(1) + '万';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
}

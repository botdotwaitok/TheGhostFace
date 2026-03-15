// modules/phone/music/musicApp.js — 音乐推荐 App「Resonance / Ta的歌单」
// Apple Music inspired dark UI with daily song recommendations.

import { openAppInViewport } from '../phoneController.js';
import { getPhoneCharInfo, getPhoneUserName } from '../phoneContext.js';
import {
    loadMusicData, saveMusicData,
    getTodayRecommendation, getRecommendationByDate,
    addDailyRecommendation, toggleLike,
    getTodayDateStr, getAllDates,
    hasPreferences, loadPreferences, savePreferences, MUSIC_GENRES,
    MUSIC_PLATFORMS, buildPlatformUrl, buildNativeUrl, getSelectedPlatform, getSelectedPlatformInfo,
} from './musicStorage.js';
import { generateDailyRecommendation } from './musicGeneration.js';

const MUSIC_LOG = '[音乐]';

// ─── State ───
let _currentViewDate = null; // The date currently being viewed
let _isGenerating = false;

// ═══════════════════════════════════════════════════════════════════════
// Entry Point
// ═══════════════════════════════════════════════════════════════════════

export function openMusicApp() {
    _currentViewDate = getTodayDateStr();
    const data = loadMusicData();
    const html = buildMusicPage(data);

    const actionsHtml = `<button class="music-pref-btn" id="music_pref_btn" title="音乐偏好设置"><i class="ph ph-sliders-horizontal"></i></button>`;

    openAppInViewport('你们的歌单', html, () => {
        bindMusicEvents();
        // Show onboarding if first time
        if (!hasPreferences()) {
            const overlay = document.getElementById('music_onboarding_overlay');
            if (overlay) overlay.classList.add('active');
        }
    }, actionsHtml);
}

// ═══════════════════════════════════════════════════════════════════════
// HTML Builders
// ═══════════════════════════════════════════════════════════════════════

function buildMusicPage(data) {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '角色';
    const rec = getRecommendationByDate(data, _currentViewDate);
    const isToday = _currentViewDate === getTodayDateStr();

    return `
    <div class="music-page" id="music_page_root">
        <!-- Tab Bar -->
        <div class="music-tab-bar">
            <button class="music-tab active" data-tab="today">
                <i class="ph ph-star"></i> 今日推荐
            </button>
            <button class="music-tab" data-tab="history">
                <i class="ph ph-clock-counter-clockwise"></i> 历史
            </button>
        </div>

        <!-- Today Tab Content -->
        <div class="music-tab-content active" id="music_tab_today">
            <!-- Date Navigator -->
            <div class="music-date-nav">
                <button class="music-date-btn" id="music_prev_date" title="前一天">
                    <i class="ph ph-caret-left"></i>
                </button>
                <span class="music-date-label" id="music_date_label">${formatDisplayDate(_currentViewDate)}</span>
                <button class="music-date-btn" id="music_next_date" title="后一天" ${isToday ? 'disabled' : ''}>
                    <i class="ph ph-caret-right"></i>
                </button>
            </div>

            <!-- Song Cards Container -->
            <div class="music-cards-container" id="music_cards_container">
                ${rec ? buildSongCards(rec.songs) : buildEmptyState(isToday, charName)}
            </div>
        </div>

        <!-- History Tab Content -->
        <div class="music-tab-content" id="music_tab_history">
            ${buildHistoryList(data)}
        </div>

        <!-- Onboarding Overlay -->
        ${buildOnboardingOverlay(charName)}

        <!-- Preference Settings Overlay -->
        ${buildPrefSettingsOverlay()}

        <!-- Loading Overlay -->
        <div class="music-loading-overlay" id="music_loading_overlay">
            <div class="music-loading-content">
                <div class="music-loading-icon"><i class="ph ph-vinyl-record"></i></div>
                <div class="music-loading-text" id="music_loading_text">正在挑选歌曲…</div>
                <div class="music-loading-dots"><span>.</span><span>.</span><span>.</span></div>
            </div>
        </div>
    </div>`;
}

function buildSongCards(songs) {
    if (!songs || songs.length === 0) return buildEmptyState(false, '');

    const platformInfo = getSelectedPlatformInfo();
    const isToday = _currentViewDate === getTodayDateStr();

    const cards = songs.map((song, idx) => `
        <div class="music-song-card" data-song-idx="${idx}" style="animation-delay: ${idx * 0.12}s">
            <div class="music-song-header">
                <div class="music-song-info">
                    <div class="music-song-title-row">
                        <span class="music-song-title">${escHtml(song.title)}</span>
                        <button class="music-copy-btn" data-copy="${escAttr(song.title + ' - ' + song.artist)}" title="复制歌名">
                            <i class="ph ph-copy"></i>
                        </button>
                    </div>
                    <div class="music-song-artist">${escHtml(song.artist)}</div>
                </div>
                <div class="music-song-actions">
                    <button class="music-open-btn" data-title="${escAttr(song.title)}" data-artist="${escAttr(song.artist)}" title="在${escAttr(platformInfo.label)}中搜索">
                        <i class="ph ${platformInfo.icon}"></i>
                    </button>
                    <button class="music-like-btn ${song.liked ? 'liked' : ''}" data-song-idx="${idx}" title="收藏">
                        <i class="ph${song.liked ? '-fill' : ''} ph-heart"></i>
                    </button>
                </div>
            </div>
            <div class="music-song-comment">
                <i class="ph ph-quotes music-quote-icon"></i>
                <span>${escHtml(song.comment)}</span>
            </div>
        </div>
    `).join('');

    // Hint + regenerate button (only for today)
    const footer = `
        <div class="music-cards-footer">
            <div class="music-cards-hint">
                <i class="ph ph-heart"></i> 点击红心收藏喜欢的歌曲
            </div>
            ${isToday ? `<button class="music-regenerate-btn" id="music_generate_btn">
                <i class="ph ph-arrows-clockwise"></i> 换一批
            </button>` : ''}
        </div>`;

    return cards + footer;
}

function buildEmptyState(isToday, charName) {
    if (isToday) {
        return `
        <div class="music-empty">
            <div class="music-empty-icon"><i class="ph ph-headphones"></i></div>
            <div class="music-empty-title">今天还没有推荐哦</div>
            <div class="music-empty-desc">让${escHtml(charName)}为你挑几首歌吧</div>
            <button class="music-generate-btn" id="music_generate_btn">
                <i class="ph ph-sparkle"></i> 生成今日推荐
            </button>
        </div>`;
    }
    return `
    <div class="music-empty">
        <div class="music-empty-icon"><i class="ph ph-music-note-simple"></i></div>
        <div class="music-empty-title">这天没有推荐</div>
        <div class="music-empty-desc">只有今天可以生成新推荐哦</div>
    </div>`;
}

function buildHistoryList(data) {
    const dates = getAllDates(data);
    if (dates.length === 0) {
        return `
        <div class="music-empty">
            <div class="music-empty-icon"><i class="ph ph-vinyl-record"></i></div>
            <div class="music-empty-title">还没有推荐记录</div>
            <div class="music-empty-desc">生成第一次推荐后就会出现在这里</div>
        </div>`;
    }

    return `
    <div class="music-history-list">
        ${dates.map(dateStr => {
        const rec = getRecommendationByDate(data, dateStr);
        if (!rec) return '';
        const likedCount = rec.songs.filter(s => s.liked).length;
        const songPreview = rec.songs.map(s => s.title).join(' · ');
        return `
            <div class="music-history-item" data-date="${dateStr}">
                <div class="music-history-date">${formatDisplayDate(dateStr)}</div>
                <div class="music-history-songs">${escHtml(songPreview)}</div>
                ${likedCount > 0 ? `<span class="music-history-likes"><i class="ph-fill ph-heart"></i> ${likedCount}</span>` : ''}
                <i class="ph ph-caret-right music-history-arrow"></i>
            </div>`;
    }).join('')}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// Date Formatting
// ═══════════════════════════════════════════════════════════════════════

function formatDisplayDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    const today = getTodayDateStr();
    const yesterday = _offsetDate(today, -1);

    if (dateStr === today) return `${m}/${d} 今天`;
    if (dateStr === yesterday) return `${m}/${d} 昨天`;
    return `${m}/${d}`;
}

function _offsetDate(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Event Binding
// ═══════════════════════════════════════════════════════════════════════

function bindMusicEvents() {
    const root = document.getElementById('music_page_root');
    if (!root) return;

    // Tab switching
    root.querySelectorAll('.music-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            root.querySelectorAll('.music-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            root.querySelectorAll('.music-tab-content').forEach(c => c.classList.remove('active'));
            const content = document.getElementById(`music_tab_${tabId}`);
            if (content) content.classList.add('active');
        });
    });

    // Date navigation
    document.getElementById('music_prev_date')?.addEventListener('click', () => navigateDate(-1));
    document.getElementById('music_next_date')?.addEventListener('click', () => navigateDate(1));

    // Generate button
    _bindGenerateBtn();

    // Song card interactions (delegated)
    _bindCardInteractions(root);

    // History item clicks
    _bindHistoryClicks(root);

    // Onboarding events
    _bindOnboardingEvents(root);

    // Preference settings events
    _bindPrefSettingsEvents(root);
}

function _bindGenerateBtn() {
    const btn = document.getElementById('music_generate_btn');
    if (!btn) return;
    btn.addEventListener('click', () => handleGenerate());
}

function _bindCardInteractions(root) {
    // Like buttons (delegated from container)
    root.addEventListener('click', (e) => {
        const likeBtn = e.target.closest('.music-like-btn');
        if (likeBtn) {
            e.stopPropagation();
            const idx = parseInt(likeBtn.dataset.songIdx);
            handleLike(idx, likeBtn);
            return;
        }

        const copyBtn = e.target.closest('.music-copy-btn');
        if (copyBtn) {
            e.stopPropagation();
            handleCopy(copyBtn);
            return;
        }

        const openBtn = e.target.closest('.music-open-btn');
        if (openBtn) {
            e.stopPropagation();
            handleOpenInPlatform(openBtn);
            return;
        }
    });
}

function _bindHistoryClicks(root) {
    root.addEventListener('click', (e) => {
        const item = e.target.closest('.music-history-item');
        if (!item) return;
        const dateStr = item.dataset.date;
        if (!dateStr) return;

        // Switch to today tab and navigate to that date
        _currentViewDate = dateStr;
        root.querySelectorAll('.music-tab').forEach(t => t.classList.remove('active'));
        root.querySelector('.music-tab[data-tab="today"]')?.classList.add('active');
        root.querySelectorAll('.music-tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById('music_tab_today')?.classList.add('active');
        refreshTodayView();
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Handlers
// ═══════════════════════════════════════════════════════════════════════

const RETRY_DELAYS = [5, 15, 30];   // Seconds before each retry
const MAX_GEN_RETRIES = 3;
let _retryCountdown = null;
let _retryCancelled = false;

async function handleGenerate() {
    if (_isGenerating) return;
    _isGenerating = true;
    _retryCancelled = false;

    showLoading();

    for (let attempt = 0; attempt <= MAX_GEN_RETRIES; attempt++) {
        if (_retryCancelled) {
            console.log(`${MUSIC_LOG} 用户取消了重试`);
            break;
        }

        try {
            console.log(`${MUSIC_LOG} 生成尝试 ${attempt + 1}/${MAX_GEN_RETRIES + 1}...`);
            _updateLoadingText('正在挑选歌曲…');

            let data = loadMusicData();
            const songs = await generateDailyRecommendation(data);
            data = addDailyRecommendation(data, getTodayDateStr(), songs);
            _currentViewDate = getTodayDateStr();
            refreshTodayView();
            refreshHistoryView();
            console.log(`${MUSIC_LOG} 今日推荐已生成并保存`);
            _isGenerating = false;
            hideLoading();
            return; // Success!

        } catch (err) {
            console.error(`${MUSIC_LOG} 生成失败 (attempt ${attempt + 1}):`, err);

            if (attempt < MAX_GEN_RETRIES && !_retryCancelled) {
                const delay = RETRY_DELAYS[attempt] || 30;
                await _showRetryCountdown(attempt + 1, MAX_GEN_RETRIES, delay, err.message || '未知错误');

                if (_retryCancelled) {
                    console.log(`${MUSIC_LOG} 用户取消了重试`);
                    break;
                }
                // Continue to next attempt...
            } else {
                // All retries exhausted
                if (typeof toastr !== 'undefined') {
                    toastr.error('歌曲推荐生成失败: ' + (err.message || '未知错误'));
                }
            }
        }
    }

    _isGenerating = false;
    hideLoading();
}

/**
 * Show a countdown in the loading overlay before retrying.
 * Returns a promise that resolves after the countdown (or is cancelled).
 */
function _showRetryCountdown(attempt, maxRetries, delaySec, errorMsg) {
    return new Promise(resolve => {
        let remaining = delaySec;

        _updateLoadingText(`
            <div class="music-retry-notice">
                <div class="music-retry-error"><i class="ph ph-warning"></i> ${escHtml(errorMsg)}</div>
                <div class="music-retry-countdown">
                    <i class="ph ph-timer"></i>
                    <span class="music-retry-seconds">${remaining}</span>秒后重试 (${attempt}/${maxRetries})
                </div>
                <button class="music-retry-cancel" id="music_retry_cancel">取消重试</button>
            </div>
        `);

        // Cancel button
        document.getElementById('music_retry_cancel')?.addEventListener('click', () => {
            _retryCancelled = true;
            if (_retryCountdown) {
                clearInterval(_retryCountdown);
                _retryCountdown = null;
            }
            resolve();
        });

        // Countdown timer
        _retryCountdown = setInterval(() => {
            remaining--;
            const secondsEl = document.querySelector('.music-retry-seconds');
            if (secondsEl) secondsEl.textContent = remaining;

            if (remaining <= 0) {
                clearInterval(_retryCountdown);
                _retryCountdown = null;
                _updateLoadingText('<i class="ph ph-arrows-clockwise"></i> 正在重试…');
                resolve();
            }
        }, 1000);
    });
}

/** Update the text content inside the loading overlay */
function _updateLoadingText(html) {
    const textEl = document.getElementById('music_loading_text');
    if (textEl) textEl.innerHTML = html;
}

function handleLike(songIdx, btnEl) {
    let data = loadMusicData();
    data = toggleLike(data, _currentViewDate, songIdx);

    const song = getRecommendationByDate(data, _currentViewDate)?.songs[songIdx];
    if (!song) return;

    // Update button UI
    const isLiked = song.liked;
    btnEl.classList.toggle('liked', isLiked);
    const icon = btnEl.querySelector('i');
    if (icon) {
        icon.className = `ph${isLiked ? '-fill' : ''} ph-heart`;
    }

    // Animate
    btnEl.classList.add('music-like-pop');
    setTimeout(() => btnEl.classList.remove('music-like-pop'), 400);
}

function handleCopy(btnEl) {
    const text = btnEl.dataset.copy;
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
        // Show brief feedback
        const icon = btnEl.querySelector('i');
        if (icon) {
            icon.className = 'ph ph-check';
            setTimeout(() => { icon.className = 'ph ph-copy'; }, 1200);
        }
    }).catch(err => {
        console.warn(`${MUSIC_LOG} 复制失败:`, err);
    });
}

function handleOpenInPlatform(btnEl) {
    const title = btnEl.dataset.title;
    const artist = btnEl.dataset.artist;
    if (!title) return;

    const nativeUrl = buildNativeUrl(title, artist);
    const webUrl = buildPlatformUrl(title, artist);

    if (!nativeUrl) {
        // Platforms with good universal links (Spotify, YouTube Music)
        window.open(webUrl, '_blank');
        return;
    }

    // Try opening native app directly via location.href
    // This is a trusted user-gesture context (click), so browsers allow scheme navigation.
    // If the app opens: the page goes to background → visibilitychange fires → we skip fallback.
    // If the app does NOT open: page stays visible → after timeout we open web fallback.
    let appOpened = false;

    const onVisChange = () => {
        if (document.hidden) appOpened = true;
    };
    document.addEventListener('visibilitychange', onVisChange);

    // Direct navigation to native scheme
    window.location.href = nativeUrl;

    // Fallback: if still visible after 2s, native didn't work → open web
    setTimeout(() => {
        document.removeEventListener('visibilitychange', onVisChange);
        if (!appOpened) {
            console.log(`${MUSIC_LOG} Native scheme did not open app, using web fallback`);
            window.open(webUrl, '_blank');
        }
    }, 2000);
}

function navigateDate(offset) {
    _currentViewDate = _offsetDate(_currentViewDate, offset);
    refreshTodayView();
}

// ═══════════════════════════════════════════════════════════════════════
// UI Refresh
// ═══════════════════════════════════════════════════════════════════════

function refreshTodayView() {
    const data = loadMusicData();
    const rec = getRecommendationByDate(data, _currentViewDate);
    const isToday = _currentViewDate === getTodayDateStr();
    const charName = getPhoneCharInfo()?.name || '角色';

    // Update date label
    const dateLabel = document.getElementById('music_date_label');
    if (dateLabel) dateLabel.textContent = formatDisplayDate(_currentViewDate);

    // Update nav buttons
    const nextBtn = document.getElementById('music_next_date');
    if (nextBtn) nextBtn.disabled = isToday;

    // Update cards
    const container = document.getElementById('music_cards_container');
    if (container) {
        container.innerHTML = rec ? buildSongCards(rec.songs) : buildEmptyState(isToday, charName);
        // Re-bind generate button if needed
        _bindGenerateBtn();
    }
}

function refreshHistoryView() {
    const data = loadMusicData();
    const historyTab = document.getElementById('music_tab_history');
    if (historyTab) {
        historyTab.innerHTML = buildHistoryList(data);
    }
}

function showLoading() {
    const el = document.getElementById('music_loading_overlay');
    if (el) el.classList.add('active');
}

function hideLoading() {
    const el = document.getElementById('music_loading_overlay');
    if (el) el.classList.remove('active');
}

// ═══════════════════════════════════════════════════════════════════════
// Onboarding — First-time genre selection
// ═══════════════════════════════════════════════════════════════════════

function buildOnboardingOverlay(charName) {
    const chips = MUSIC_GENRES.map(g => `
        <button class="music-genre-chip" data-genre="${g.id}">
            <i class="ph ${g.icon}"></i>
            <span>${escHtml(g.label)}</span>
        </button>
    `).join('');

    return `
    <div class="music-onboarding-overlay" id="music_onboarding_overlay">
        <div class="music-onboarding-content">
            <div class="music-onboarding-icon"><i class="ph ph-headphones"></i></div>
            <div class="music-onboarding-title">你想听什么？</div>
            <div class="music-onboarding-desc">
                告诉${escHtml(charName)}你喜欢的音乐风格吧<br>
                这样推荐会更合你心意哦
            </div>
            <div class="music-genre-grid" id="music_genre_grid">
                ${chips}
                <button class="music-genre-chip music-genre-add" id="music_onboard_add_btn">
                    <i class="ph ph-plus"></i>
                    <span>自定义</span>
                </button>
            </div>
            <div class="music-genre-add-input" id="music_onboard_add_input" style="display:none">
                <div class="music-input-wrap">
                    <input type="text" class="music-custom-genre-input" id="music_onboard_add_field"
                        placeholder="输入自定义风格名…" maxlength="20" />
                </div>
                <button class="music-custom-genre-confirm" id="music_onboard_add_confirm">
                    <i class="ph ph-check"></i>
                </button>
            </div>
            <div class="music-onboarding-custom">
                <div class="music-input-wrap">
                    <input type="text" class="music-custom-note-input" id="music_custom_note"
                        placeholder="其她偏好？例如：喜欢伤感的、节奏快的…" maxlength="100" />
                </div>
            </div>
            <div class="music-platform-section">
                <div class="music-platform-label">你常用的音乐平台</div>
                <div class="music-platform-grid" id="music_onboard_platform_grid">
                    ${MUSIC_PLATFORMS.map(p => `
                        <button class="music-platform-chip${p.id === 'spotify' ? ' selected' : ''}" data-platform="${p.id}">
                            <i class="ph ${p.icon}"></i>
                            <span>${escHtml(p.label)}</span>
                        </button>
                    `).join('')}
                </div>
            </div>
            <button class="music-onboarding-confirm" id="music_onboarding_confirm" disabled>
                <i class="ph ph-check"></i> 就这些！
            </button>
        </div>
    </div>`;
}

function _bindOnboardingEvents(root) {
    const grid = document.getElementById('music_genre_grid');
    const confirmBtn = document.getElementById('music_onboarding_confirm');
    if (!grid || !confirmBtn) return;

    const selectedGenres = new Set();
    const customGenres = [];

    const updateConfirmState = () => {
        confirmBtn.disabled = selectedGenres.size === 0 && customGenres.length === 0;
    };

    // Genre chip toggle
    grid.addEventListener('click', (e) => {
        const chip = e.target.closest('.music-genre-chip');
        if (!chip || chip.classList.contains('music-genre-add')) return;

        // Handle remove button on custom chips
        const removeBtn = e.target.closest('.music-custom-chip-remove');
        if (removeBtn) {
            const label = chip.dataset.customGenre;
            const idx = customGenres.indexOf(label);
            if (idx !== -1) customGenres.splice(idx, 1);
            chip.remove();
            updateConfirmState();
            return;
        }

        const genreId = chip.dataset.genre;
        if (!genreId) return;

        if (selectedGenres.has(genreId)) {
            selectedGenres.delete(genreId);
            chip.classList.remove('selected');
        } else {
            selectedGenres.add(genreId);
            chip.classList.add('selected');
        }
        updateConfirmState();
    });

    // Add custom genre
    _bindAddCustomGenre(
        'music_onboard_add_btn', 'music_onboard_add_input',
        'music_onboard_add_field', 'music_onboard_add_confirm',
        grid, customGenres, updateConfirmState
    );

    // Platform chip toggle (single-select)
    const onboardPlatformGrid = document.getElementById('music_onboard_platform_grid');
    if (onboardPlatformGrid) {
        onboardPlatformGrid.addEventListener('click', (e) => {
            const chip = e.target.closest('.music-platform-chip');
            if (!chip) return;
            onboardPlatformGrid.querySelectorAll('.music-platform-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
        });
    }

    // Confirm
    confirmBtn.addEventListener('click', () => {
        const customNote = document.getElementById('music_custom_note')?.value || '';
        const platformChip = document.querySelector('#music_onboard_platform_grid .music-platform-chip.selected');
        const platform = platformChip?.dataset.platform || 'spotify';
        savePreferences([...selectedGenres], customNote, [...customGenres], platform);

        const overlay = document.getElementById('music_onboarding_overlay');
        if (overlay) {
            overlay.classList.add('closing');
            setTimeout(() => overlay.classList.remove('active', 'closing'), 350);
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Preference Settings — Re-edit preferences
// ═══════════════════════════════════════════════════════════════════════

function buildPrefSettingsOverlay() {
    const prefs = loadPreferences();
    const chips = MUSIC_GENRES.map(g => {
        const isSelected = prefs?.genres?.includes(g.id) ? ' selected' : '';
        return `
        <button class="music-genre-chip${isSelected}" data-genre="${g.id}">
            <i class="ph ${g.icon}"></i>
            <span>${escHtml(g.label)}</span>
        </button>`;
    }).join('');

    // Existing custom genre chips
    const customChips = (prefs?.customGenres || []).map(label => `
        <button class="music-genre-chip selected" data-custom-genre="${escAttr(label)}">
            <span>${escHtml(label)}</span>
            <i class="ph ph-x music-custom-chip-remove"></i>
        </button>`).join('');

    return `
    <div class="music-pref-overlay" id="music_pref_overlay">
        <div class="music-pref-header">
            <button class="music-pref-close" id="music_pref_close"><i class="ph ph-x"></i></button>
            <span class="music-pref-title">音乐偏好</span>
            <button class="music-pref-save" id="music_pref_save">保存</button>
        </div>
        <div class="music-pref-body">
            <div class="music-pref-label">选择你喜欢的风格</div>
            <div class="music-genre-grid" id="music_pref_genre_grid">
                ${chips}
                ${customChips}
                <button class="music-genre-chip music-genre-add" id="music_pref_add_btn">
                    <i class="ph ph-plus"></i>
                    <span>自定义</span>
                </button>
            </div>
            <div class="music-genre-add-input" id="music_pref_add_input" style="display:none">
                <div class="music-input-wrap">
                    <input type="text" class="music-custom-genre-input" id="music_pref_add_field"
                        placeholder="输入自定义风格名…" maxlength="20" />
                </div>
                <button class="music-custom-genre-confirm" id="music_pref_add_confirm">
                    <i class="ph ph-check"></i>
                </button>
            </div>
            <div class="music-pref-label" style="margin-top:16px">其她偏好</div>
            <div class="music-input-wrap">
                <input type="text" class="music-custom-note-input" id="music_pref_custom_note"
                    value="${escAttr(prefs?.customNote || '')}"
                    placeholder="例如：喜欢伤感的、节奏快的…" maxlength="100" />
            </div>
            <div class="music-pref-label" style="margin-top:16px">音乐平台</div>
            <div class="music-platform-grid" id="music_pref_platform_grid">
                ${MUSIC_PLATFORMS.map(p => {
                    const sel = (prefs?.platform || 'spotify') === p.id ? ' selected' : '';
                    return `
                    <button class="music-platform-chip${sel}" data-platform="${p.id}">
                        <i class="ph ${p.icon}"></i>
                        <span>${escHtml(p.label)}</span>
                    </button>`;
                }).join('')}
            </div>
        </div>
    </div>`;
}

function _bindPrefSettingsEvents(root) {
    const prefCustomGenres = [];
    // Seed from existing prefs
    const prefs = loadPreferences();
    if (prefs?.customGenres) prefCustomGenres.push(...prefs.customGenres);

    // Open
    document.getElementById('music_pref_btn')?.addEventListener('click', () => {
        const overlay = document.getElementById('music_pref_overlay');
        if (overlay) overlay.classList.add('active');
    });

    // Close
    document.getElementById('music_pref_close')?.addEventListener('click', () => {
        const overlay = document.getElementById('music_pref_overlay');
        if (overlay) overlay.classList.remove('active');
    });

    // Genre chip toggle in pref settings
    const prefGrid = document.getElementById('music_pref_genre_grid');
    if (prefGrid) {
        prefGrid.addEventListener('click', (e) => {
            const chip = e.target.closest('.music-genre-chip');
            if (!chip || chip.classList.contains('music-genre-add')) return;

            // Handle remove on custom chips
            const removeBtn = e.target.closest('.music-custom-chip-remove');
            if (removeBtn) {
                const label = chip.dataset.customGenre;
                const idx = prefCustomGenres.indexOf(label);
                if (idx !== -1) prefCustomGenres.splice(idx, 1);
                chip.remove();
                return;
            }

            chip.classList.toggle('selected');
        });
    }

    // Add custom genre
    _bindAddCustomGenre(
        'music_pref_add_btn', 'music_pref_add_input',
        'music_pref_add_field', 'music_pref_add_confirm',
        prefGrid, prefCustomGenres, null
    );

    // Platform chip toggle in pref settings (single-select)
    const prefPlatformGrid = document.getElementById('music_pref_platform_grid');
    if (prefPlatformGrid) {
        prefPlatformGrid.addEventListener('click', (e) => {
            const chip = e.target.closest('.music-platform-chip');
            if (!chip) return;
            prefPlatformGrid.querySelectorAll('.music-platform-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
        });
    }

    // Save
    document.getElementById('music_pref_save')?.addEventListener('click', () => {
        const grid = document.getElementById('music_pref_genre_grid');
        // Collect predefined genre selections
        const selected = [...(grid?.querySelectorAll('.music-genre-chip.selected[data-genre]') || [])]
            .map(el => el.dataset.genre)
            .filter(Boolean);
        const customNote = document.getElementById('music_pref_custom_note')?.value || '';
        const platformChip = document.querySelector('#music_pref_platform_grid .music-platform-chip.selected');
        const platform = platformChip?.dataset.platform || 'spotify';

        savePreferences(selected, customNote, [...prefCustomGenres], platform);

        const overlay = document.getElementById('music_pref_overlay');
        if (overlay) overlay.classList.remove('active');

        // Refresh cards to update platform icon
        refreshTodayView();

        if (typeof toastr !== 'undefined') {
            toastr.success('音乐偏好已更新');
        }
    });
}

// ─── Shared helper: + button → inline input → create custom chip ────

function _bindAddCustomGenre(addBtnId, inputWrapperId, inputFieldId, confirmBtnId, grid, customGenresArr, onChangeCallback) {
    const addBtn = document.getElementById(addBtnId);
    const inputWrap = document.getElementById(inputWrapperId);
    const inputField = document.getElementById(inputFieldId);
    const confirmBtn = document.getElementById(confirmBtnId);
    if (!addBtn || !inputWrap || !inputField || !confirmBtn || !grid) return;

    addBtn.addEventListener('click', () => {
        inputWrap.style.display = 'flex';
        inputField.value = '';
        inputField.focus();
    });

    const doAdd = () => {
        const label = inputField.value.trim();
        if (!label) return;
        if (customGenresArr.includes(label)) {
            inputField.value = '';
            return; // no duplicates
        }

        customGenresArr.push(label);

        // Insert chip before the + button
        const chip = document.createElement('button');
        chip.className = 'music-genre-chip selected';
        chip.dataset.customGenre = label;
        chip.innerHTML = `<span>${escHtml(label)}</span><i class="ph ph-x music-custom-chip-remove"></i>`;
        grid.insertBefore(chip, addBtn);

        inputField.value = '';
        inputWrap.style.display = 'none';

        if (onChangeCallback) onChangeCallback();
    };

    confirmBtn.addEventListener('click', doAdd);
    inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); doAdd(); }
        if (e.key === 'Escape') { inputWrap.style.display = 'none'; }
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════

function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

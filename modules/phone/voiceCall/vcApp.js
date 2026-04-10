// modules/phone/voiceCall/vcApp.js — Voice Call app (phone home screen entry)
// Shows two tabs: "电话" (call history) and "一起看看" (watch party setup).
// Replaces the old FAB menu with a cleaner header-tab navigation.

import { openAppInViewport } from '../phoneController.js';
import { openVoiceCall } from './voiceCallUI.js';
import { openWatchParty } from './watchParty/watchPartyUI.js';
import { isScreenCaptureSupported } from './watchParty/screenCapture.js';
import { loadCallLogs, deleteCallLog } from './vcStorage.js';
import { getPhoneCharInfo } from '../phoneContext.js';
import { saveMetadataDebounced } from '../../../../../../extensions.js';
import { chat_metadata } from '../../../../../../../script.js';
import { escapeHtml } from '../utils/helpers.js';
import { getPhoneSetting, setPhoneSetting } from '../phoneSettings.js';

const LOG_PREFIX = '[VcApp]';

// Current active tab
let _activeTab = 'phone'; // 'phone' | 'watch'

// Resume-from state (set when user taps a "continue watching" card)
let _resumeFromLog = null;

// ═══════════════════════════════════════════════════════════════════════
// Entry Point
// ═══════════════════════════════════════════════════════════════════════

/**
 * Open the Voice Call app in the phone viewport.
 * Displays a tabbed interface: call history + watch party.
 * @param {string} [tab] - Which tab to open: 'phone' or 'watch'
 */
export function openVcApp(tab) {
    if (tab) _activeTab = tab;

    // Build header tabs HTML — inject into the title area
    const titleHtml = `
        <div class="vc-header-tabs">
            <button class="vc-header-tab${_activeTab === 'phone' ? ' active' : ''}" data-tab="phone">
                <span>电话</span>
            </button>
            <button class="vc-header-tab${_activeTab === 'watch' ? ' active' : ''}" data-tab="watch">
                <span>一起看看</span>
            </button>
        </div>
    `;

    // Body content depends on active tab
    const bodyHtml = _activeTab === 'phone'
        ? _buildPhoneTabHtml()
        : _buildWatchTabHtml();

    // Actions: only show clear button on phone tab
    const actionsHtml = _activeTab === 'phone'
        ? `<button id="vc_clear_all_btn" class="phone-header-action-btn" title="清空通话记录" style="background: none; border: none; color: #ff3b30; font-size: 14px; cursor: pointer; padding: 4px 8px;">
               清空
           </button>`
        : '';

    openAppInViewport(titleHtml, bodyHtml, () => {
        _bindTabEvents();
        if (_activeTab === 'phone') {
            _renderCallList();
            _bindPhoneTabEvents();
        } else {
            _bindWatchTabEvents();
        }
    }, actionsHtml);
}

// ═══════════════════════════════════════════════════════════════════════
// Tab Switching
// ═══════════════════════════════════════════════════════════════════════

function _bindTabEvents() {
    const tabs = document.querySelectorAll('.vc-header-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const newTab = tab.dataset.tab;
            if (newTab === _activeTab) return;
            _activeTab = newTab;
            openVcApp(); // Re-render with new tab
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Phone Tab — Call History
// ═══════════════════════════════════════════════════════════════════════

function _buildPhoneTabHtml() {
    return `
    <div class="vc-app-container">
        <div id="vc_call_list" class="vc-call-list">
            <!-- Call history rendered here -->
        </div>
        <button id="vc_dial_fab" class="vc-dial-fab" title="拨打电话"><i class="ph ph-phone-call"></i></button>
    </div>
    `;
}

function _bindPhoneTabEvents() {
    // Dial FAB
    const dialBtn = document.getElementById('vc_dial_fab');
    if (dialBtn) {
        dialBtn.addEventListener('click', () => openVoiceCall());
    }

    // Clear all button
    const clearBtn = document.getElementById('vc_clear_all_btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            const logs = loadCallLogs();
            if (logs.length === 0) return;
            if (confirm(`确定清空全部 ${logs.length} 条通话记录？`)) {
                if (chat_metadata) {
                    chat_metadata['gf_voiceCallLogs'] = [];
                    saveMetadataDebounced();
                }
                _renderCallList();
            }
        });
    }
}

function _renderCallList() {
    const container = document.getElementById('vc_call_list');
    if (!container) return;

    const logs = loadCallLogs();
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '联系人';

    if (logs.length === 0) {
        container.innerHTML = `
            <div class="vc-empty-state">
                <i class="ph ph-phone-call" style="font-size: 48px; color: rgba(0,0,0,0.08); margin-bottom: 16px;"></i>
                <div style="font-size: 17px; font-weight: 600; color: #1c1c1e; margin-bottom: 6px;">暂无通话记录</div>
                <div style="font-size: 14px; color: #8e8e93;">点击下方按钮开始通话</div>
            </div>
        `;
        return;
    }

    const listHtml = logs.map(log => {
        const startDate = new Date(log.startTime);
        const dateStr = _formatCallDate(startDate);
        const timeStr = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const durationStr = _formatDuration(log.duration || 0);
        const messageCount = log.messages?.length || 0;
        const summaryPreview = log.summary
            ? escapeHtml(log.summary.substring(0, 80)) + (log.summary.length > 80 ? '...' : '')
            : `${messageCount} 条对话`;

        // Differentiate watch party vs voice call
        const isWatchParty = log.type === 'watch-party';
        const iconClass = isWatchParty ? 'ph ph-monitor-play' : 'ph ph-phone-call';
        const typeLabel = isWatchParty
            ? (log.contentTitle ? `一起看 · ${escapeHtml(log.contentTitle)}` : '一起看看')
            : escapeHtml(charName);

        return `
        <div class="vc-call-item${isWatchParty ? ' watch-party' : ''}" data-call-id="${log.id}">
            <div class="vc-call-item-main">
                <div class="vc-call-item-avatar${isWatchParty ? ' watch-party-icon' : ''}">
                    <i class="${iconClass}"></i>
                </div>
                <div class="vc-call-item-info">
                    <div class="vc-call-item-name">${typeLabel}</div>
                    <div class="vc-call-item-meta">
                        <span class="vc-call-item-date">${dateStr} ${timeStr}</span>
                        <span class="vc-call-item-duration">${durationStr}</span>
                    </div>
                    <div class="vc-call-item-summary">${summaryPreview}</div>
                </div>
                <div class="vc-call-item-actions">
                    <button class="vc-call-item-delete" data-delete-id="${log.id}" title="删除">
                        <i class="ph ph-trash"></i>
                    </button>
                    <i class="ph ph-caret-right" style="color: #c7c7cc; font-size: 12px;"></i>
                </div>
            </div>
        </div>
        `;
    }).join('');

    container.innerHTML = listHtml;

    // Bind click events
    container.querySelectorAll('.vc-call-item').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.closest('.vc-call-item-delete')) return;
            const callId = el.dataset.callId;
            _openCallDetail(callId);
        });
    });

    // Bind delete buttons
    container.querySelectorAll('.vc-call-item-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.deleteId;
            if (confirm('确定删除这条通话记录？')) {
                deleteCallLog(id);
                _renderCallList();
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Watch Tab — Setup Page
// ═══════════════════════════════════════════════════════════════════════

// ─── Talk Frequency Presets ───
const TALK_FREQ_PRESETS = {
    quiet: { label: '安静陪看', icon: 'ph ph-moon-stars', desc: '只在关键时刻说话，大部分时间安静陪你', frameMs: 30000, llmMs: 25000 },
    moderate: { label: '偶尔说说', icon: 'ph ph-chat-circle-dots', desc: '适当评论有趣的画面，不会太吵', frameMs: 20000, llmMs: 15000 },
    chatty: { label: '话唠模式', icon: 'ph ph-megaphone-simple', desc: '积极评论每个画面，停不下来的那种', frameMs: 10000, llmMs: 8000 },
};

function _buildWatchTabHtml() {
    const savedFreq = getPhoneSetting('watchPartyTalkFrequency', 'moderate');

    const freqOptionsHtml = Object.entries(TALK_FREQ_PRESETS).map(([key, preset]) => {
        const isActive = key === savedFreq ? ' active' : '';
        return `
            <button class="wp-freq-option${isActive}" data-freq="${key}">
                <i class="${preset.icon}"></i>
                <span class="wp-freq-option-label">${preset.label}</span>
            </button>`;
    }).join('');

    const currentDesc = TALK_FREQ_PRESETS[savedFreq]?.desc || '';

    // Build "continue watching" carousel from previous watch party logs
    const resumeCarouselHtml = _buildResumeCardsHtml();

    return `
    <div class="wp-setup-container">
        <div class="wp-setup-header">
            <i class="ph ph-monitor-play wp-setup-icon"></i>
            <div class="wp-setup-title">一起看看</div>
            <div class="wp-setup-subtitle">和你对象一起看电影、看你打游戏、看视频</div>
        </div>

        ${resumeCarouselHtml}

        <div class="wp-setup-form">
            <div class="wp-setup-field">
                <label class="wp-setup-label">内容类型</label>
                <div class="wp-setup-type-grid" id="wp_type_grid">
                    <button class="wp-type-btn active" data-type="movie">
                        <i class="ph ph-film-strip"></i>
                        <span>电影</span>
                    </button>
                    <button class="wp-type-btn" data-type="anime">
                        <i class="ph ph-shooting-star"></i>
                        <span>动画</span>
                    </button>
                    <button class="wp-type-btn" data-type="game">
                        <i class="ph ph-game-controller"></i>
                        <span>直播</span>
                    </button>
                    <button class="wp-type-btn" data-type="video">
                        <i class="ph ph-youtube-logo"></i>
                        <span>视频</span>
                    </button>
                    <button class="wp-type-btn" data-type="other">
                        <i class="ph ph-dots-three-outline"></i>
                        <span>其她</span>
                    </button>
                </div>
            </div>

            <div class="wp-setup-field">
                <label class="wp-setup-label">发言频率</label>
                <div class="wp-freq-selector" id="wp_freq_selector">
                    ${freqOptionsHtml}
                </div>
                <div class="wp-freq-desc" id="wp_freq_desc">${currentDesc}</div>
            </div>

            <div class="wp-setup-field">
                <label class="wp-setup-label">标题 <span class="wp-optional">(选填)</span></label>
                <textarea id="wp_content_title" class="wp-setup-textarea"
                          placeholder="例如：黎明杀机弱智小视频、黎明杀机游戏直播..." rows="1" maxlength="100"></textarea>
            </div>

            <div class="wp-setup-field">
                <label class="wp-setup-label">补充说明 <span class="wp-optional">(选填)</span></label>
                <textarea id="wp_content_desc" class="wp-setup-textarea"
                          placeholder="可以简单描述一下内容，帮你对象更好地理解&#10;例如电影剧情简介、游戏类型、看到哪里了..."
                          rows="3" maxlength="500"></textarea>
            </div>
        </div>

        <div id="wp_resume_badge" class="wp-resume-badge" style="display: none;">
            <i class="ph ph-arrow-bend-up-left"></i>
            <span id="wp_resume_badge_text">继续上次的观影</span>
            <button id="wp_resume_cancel" class="wp-resume-cancel" title="取消继续">
                <i class="ph ph-x"></i>
            </button>
        </div>

        <button id="wp_start_btn" class="wp-start-btn">
            <i class="ph ph-play"></i>
            开始共享
        </button>

        <div class="wp-setup-note">
            <i class="ph ph-info"></i>
            点击后浏览器会弹出屏幕选择窗口，选择要共享的应用或窗口
        </div>
    </div>
    `;
}

function _bindWatchTabEvents() {
    // Check screen capture support
    if (!isScreenCaptureSupported()) {
        const startBtn = document.getElementById('wp_start_btn');
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.innerHTML = '<i class="ph ph-warning"></i> 当前浏览器不支持屏幕共享';
            startBtn.style.opacity = '0.5';
        }
        return;
    }

    // Bind type selection
    const typeGrid = document.getElementById('wp_type_grid');
    if (typeGrid) {
        typeGrid.addEventListener('click', (e) => {
            const btn = e.target.closest('.wp-type-btn');
            if (!btn) return;
            typeGrid.querySelectorAll('.wp-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    }

    // Bind frequency selector
    const freqSelector = document.getElementById('wp_freq_selector');
    const freqDescEl = document.getElementById('wp_freq_desc');
    if (freqSelector) {
        freqSelector.addEventListener('click', (e) => {
            const btn = e.target.closest('.wp-freq-option');
            if (!btn) return;
            const freq = btn.dataset.freq;
            freqSelector.querySelectorAll('.wp-freq-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Update description
            if (freqDescEl && TALK_FREQ_PRESETS[freq]) {
                freqDescEl.textContent = TALK_FREQ_PRESETS[freq].desc;
            }
            // Persist preference
            setPhoneSetting('watchPartyTalkFrequency', freq);
        });
    }

    // ── Bind "Continue Watching" cards ──
    _bindResumeCardEvents();

    // ── Bind resume badge cancel ──
    const resumeCancelBtn = document.getElementById('wp_resume_cancel');
    if (resumeCancelBtn) {
        resumeCancelBtn.addEventListener('click', () => _clearResumeState());
    }

    // Bind start button
    const startBtn = document.getElementById('wp_start_btn');
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            const selectedType = typeGrid?.querySelector('.wp-type-btn.active')?.dataset.type || 'other';
            const contentTitle = document.getElementById('wp_content_title')?.value?.trim() || '';
            const contentDesc = document.getElementById('wp_content_desc')?.value?.trim() || '';
            const selectedFreq = freqSelector?.querySelector('.wp-freq-option.active')?.dataset.freq || 'moderate';
            const freqPreset = TALK_FREQ_PRESETS[selectedFreq];

            const config = {
                contentType: selectedType,
                contentTitle: contentTitle,
                contentDescription: contentDesc,
                talkFrequency: selectedFreq,
                frameIntervalMs: freqPreset.frameMs,
                minLlmIntervalMs: freqPreset.llmMs,
            };

            // ── Inject previous session context if resuming ──
            if (_resumeFromLog) {
                const parts = [];
                if (_resumeFromLog.sessionSummary) parts.push(_resumeFromLog.sessionSummary);
                if (_resumeFromLog.summary) parts.push(_resumeFromLog.summary);
                if (parts.length > 0) {
                    config.previousSummary = parts.join('\n\n');
                }
                config.resumedFromId = _resumeFromLog.id;
                console.log(`${LOG_PREFIX} Resuming watch party from log: ${_resumeFromLog.id}`);
                _resumeFromLog = null; // Clear after use
            }

            openWatchParty(config);
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Call Detail — Transcript View
// ═══════════════════════════════════════════════════════════════════════

function _openCallDetail(callId) {
    const logs = loadCallLogs();
    const log = logs.find(l => l.id === callId);
    if (!log) return;

    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '联系人';
    const startDate = new Date(log.startTime);
    const dateStr = startDate.toLocaleDateString('zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric',
    });
    const timeStr = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const durationStr = _formatDuration(log.duration || 0);

    const isWatchParty = log.type === 'watch-party';
    const detailTitle = isWatchParty
        ? (log.contentTitle ? `一起看 · ${escapeHtml(log.contentTitle)}` : '观影回忆')
        : '通话详情';

    // Build transcript bubbles
    const transcriptHtml = (log.messages || []).map(msg => {
        const isUser = msg.role === 'user';
        const bubbleClass = isUser ? 'user' : 'char';
        const msgTime = new Date(msg.timestamp).toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        return `
            <div class="vc-transcript-bubble ${bubbleClass}">
                <div class="vc-transcript-text">${escapeHtml(msg.content)}</div>
                <div class="vc-transcript-time">${msgTime}</div>
            </div>
        `;
    }).join('');

    const summaryBlock = log.summary
        ? `<div class="vc-detail-summary">
               <div class="vc-detail-summary-title">${isWatchParty ? '观影回忆' : '通话概要'}</div>
               <div class="vc-detail-summary-text">${escapeHtml(log.summary)}</div>
           </div>`
        : '';

    const html = `
    <div class="vc-detail-container">
        <div class="vc-detail-header">
            <div class="vc-detail-header-name">${isWatchParty ? detailTitle : escapeHtml(charName)}</div>
            <div class="vc-detail-header-meta">${dateStr} ${timeStr} · ${durationStr}</div>
        </div>

        ${summaryBlock}

        <div class="vc-detail-transcript">
            ${transcriptHtml || '<div style="text-align: center; color: #8e8e93; padding: 20px;">无通话内容</div>'}
        </div>
    </div>
    `;

    // Render inline — replace the viewport body content
    const body = document.getElementById('phone_app_viewport_body');
    const titleEl = document.getElementById('phone_app_viewport_title');
    const actionsEl = document.getElementById('phone_app_viewport_actions');
    if (!body) return;

    body.innerHTML = html;
    if (titleEl) titleEl.textContent = detailTitle;
    if (actionsEl) actionsEl.innerHTML = '';

    // Intercept back button to return to call list
    const _backHandler = (e) => {
        e.preventDefault();
        window.removeEventListener('phone-app-back', _backHandler);
        openVcApp('phone');
    };
    window.addEventListener('phone-app-back', _backHandler);
}

// ═══════════════════════════════════════════════════════════════════════
// Continue Watching — Resume Carousel
// ═══════════════════════════════════════════════════════════════════════

const TYPE_ICONS = {
    movie: 'ph ph-film-strip',
    anime: 'ph ph-shooting-star',
    game: 'ph ph-game-controller',
    video: 'ph ph-youtube-logo',
    other: 'ph ph-monitor-play',
};

const TYPE_LABELS = {
    movie: '电影',
    anime: '动画',
    game: '直播',
    video: '视频',
    other: '共享',
};

/**
 * Build horizontal scroll card carousel from recent watch-party logs.
 * Shows up to 5 most recent watch party sessions.
 */
function _buildResumeCardsHtml() {
    const logs = loadCallLogs();
    const wpLogs = logs.filter(l => l.type === 'watch-party').slice(0, 5);
    if (wpLogs.length === 0) return '';

    const cardsHtml = wpLogs.map(log => {
        const title = log.contentTitle || '未命名观影';
        const icon = TYPE_ICONS[log.contentType] || TYPE_ICONS.other;
        const typeLabel = TYPE_LABELS[log.contentType] || '共享';
        const durationStr = _formatDuration(log.duration || 0);
        const startDate = new Date(log.startTime);
        const dateStr = _formatCallDate(startDate);

        return `
            <button class="wp-resume-card" data-resume-id="${log.id}">
                <div class="wp-resume-card-icon"><i class="${icon}"></i></div>
                <div class="wp-resume-card-title">${escapeHtml(title)}</div>
                <div class="wp-resume-card-meta">${typeLabel} · ${durationStr}</div>
                <div class="wp-resume-card-date">${dateStr}</div>
            </button>`;
    }).join('');

    return `
        <div class="wp-resume-section">
            <div class="wp-resume-section-label">
                <i class="ph ph-arrow-bend-up-left"></i>
                <span>继续看</span>
            </div>
            <div class="wp-resume-carousel" id="wp_resume_carousel">
                ${cardsHtml}
            </div>
        </div>`;
}

/**
 * Bind click events on each resume card.
 * Tapping a card pre-fills the form and sets _resumeFromLog.
 */
function _bindResumeCardEvents() {
    const carousel = document.getElementById('wp_resume_carousel');
    if (!carousel) return;

    carousel.querySelectorAll('.wp-resume-card').forEach(card => {
        card.addEventListener('click', () => {
            const logId = card.dataset.resumeId;
            const log = loadCallLogs().find(l => l.id === logId);
            if (!log) return;

            _resumeFromLog = log;

            // Pre-fill content type
            const typeGrid = document.getElementById('wp_type_grid');
            if (typeGrid && log.contentType) {
                typeGrid.querySelectorAll('.wp-type-btn').forEach(b => b.classList.remove('active'));
                const matchBtn = typeGrid.querySelector(`[data-type="${log.contentType}"]`);
                if (matchBtn) matchBtn.classList.add('active');
            }

            // Pre-fill title
            const titleEl = document.getElementById('wp_content_title');
            if (titleEl && log.contentTitle) titleEl.value = log.contentTitle;

            // Show resume badge
            const badge = document.getElementById('wp_resume_badge');
            const badgeText = document.getElementById('wp_resume_badge_text');
            if (badge) {
                badge.style.display = 'flex';
                if (badgeText) {
                    badgeText.textContent = `继续看「${log.contentTitle || '未命名'}」`;
                }
            }

            // Highlight the selected card
            carousel.querySelectorAll('.wp-resume-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');

            // Update start button text
            const startBtn = document.getElementById('wp_start_btn');
            if (startBtn) {
                startBtn.innerHTML = '<i class="ph ph-play"></i> 继续共享';
            }

            console.log(`${LOG_PREFIX} Resume card selected: ${logId} (${log.contentTitle})`);
        });
    });
}

/**
 * Clear the resume state — reset form to normal "new session" mode.
 */
function _clearResumeState() {
    _resumeFromLog = null;

    // Hide badge
    const badge = document.getElementById('wp_resume_badge');
    if (badge) badge.style.display = 'none';

    // Deselect cards
    const carousel = document.getElementById('wp_resume_carousel');
    if (carousel) {
        carousel.querySelectorAll('.wp-resume-card').forEach(c => c.classList.remove('selected'));
    }

    // Reset start button text
    const startBtn = document.getElementById('wp_start_btn');
    if (startBtn) {
        startBtn.innerHTML = '<i class="ph ph-play"></i> 开始共享';
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function _formatDuration(seconds) {
    if (seconds < 60) return `${seconds}秒`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m < 60) return s > 0 ? `${m}分${s}秒` : `${m}分钟`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm > 0 ? `${h}小时${rm}分` : `${h}小时`;
}

function _formatCallDate(date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return '今天';
    if (date.toDateString() === yesterday.toDateString()) return '昨天';

    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

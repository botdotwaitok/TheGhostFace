// modules/phone/tree/treeApp.js — 树树 App 主入口
// 领养仪式、树主界面、日常照顾、阶段升级、小游戏入口。
// 支持 8 种果树 + 果实收集 + 大树图鉴。

import { openAppInViewport } from '../phoneController.js';
import { getPhoneCharInfo, getPhoneUserName } from '../phoneContext.js';
import {
    GROWTH_STAGES, CARE_ACTIONS,
    getCurrentSeason, getTreeImagePath, getTreeImageFallback,
    getStageByGrowth, getGrowthProgress,
    STAGE_SEASON_DESCRIPTIONS, SEASONS,
    TREE_TYPES, getTreeType, getRandomTreeType,
    FRUIT_CONFIG, getFruitImagePath,
    GACHA_POOL,
} from './treeConfig.js';
import {
    loadTreeData, getTreeState, updateTreeState,
    addGrowth, checkDailyReset,
    popCareLine, getRemainingCareLines,
    getTreeSettings, updateTreeSettings,
    addFruitToCollection, getFruitsCollected,
    archiveCurrentTree, getTreeArchive, getCompletedTreeTypes,
    getRemainingQuestions,
    getCollection, getStoryFragments,
    initTreeDataFromServer,
    hasPendingSync, flushSyncNow,
} from './treeStorage.js';
import {
    QUIZ_LOW_THRESHOLD, TOD_LOW_THRESHOLD,
} from './treeQuestions.js';
import { openQuizGame, openGachaGame, openTodGame } from './treeGames.js';
import {
    generateMilestoneMessage,
    generateContentStepByStep,
} from './treeLLM.js';
import { updateTreeWorldInfo } from './treeWorldInfo.js';
import { startKeepAlive, stopKeepAlive, isKeepAliveActive } from '../keepAlive.js';

const TREE_LOG = '[树树]';

// Developer debug state — purely in-memory, never persisted
const _debugState = {
    active: false,
    seasonOverride: null, // null = use real season
    stageOverride: null,  // null = use real stage
};

// Re-entry guard: prevents _triggerBackgroundRefill → showRefillQCPage → showTreeMainPage → _triggerBackgroundRefill loop
let _refillInProgress = false;

// ═══════════════════════════════════════════════════════════════════════
// Entry Point
// ═══════════════════════════════════════════════════════════════════════

export async function openTreeApp() {
    // If localStorage is empty, try to restore from server (cross-device)
    await initTreeDataFromServer();

    // Register safety nets for sync (idempotent — only binds once)
    _registerSyncSafetyNets();

    // Daily reset check
    const { isNewDay, data } = checkDailyReset();
    if (isNewDay) {
        console.log(`${TREE_LOG} 新的一天，每日次数已重置`);
    }

    const state = data.treeState;

    // First time? Show onboarding then adoption
    if (!state.treeName) {
        const seenOnboarding = localStorage.getItem('gf_tree_onboarding_done');
        if (!seenOnboarding) {
            showOnboarding();
        } else {
            showAdoptionCeremony();
        }
    } else if (_isContentIncomplete(data)) {
        // First-time generation was interrupted — resume from loading page
        console.log(`${TREE_LOG} 检测到首次生成未完成，重新进入加载页面`);
        showLoadingPage(state.treeName);
    } else {
        showTreeMainPage();
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Onboarding (first-time tutorial)
// ═══════════════════════════════════════════════════════════════════════

function showOnboarding() {
    const charName = getPhoneCharInfo()?.name || '你的恋人';

    const pages = [
        {
            icon: 'fa-solid fa-seedling',
            color: '#22c55e',
            title: '和你的对象一起养树',
            desc: `和 ${escHtml(charName)} 一起领养一棵树树，用心照顾它，看着它从种子长成参天（并非）大树。`,
        },
        {
            icon: 'fa-solid fa-hand-holding-heart',
            color: '#f472b6',
            title: '每天照顾 + 小游戏',
            desc: '浇水、施肥、唱歌、抚摸——每天照顾树树促进成长。\n还有默契挑战、真心话、扭蛋等趣味小游戏！',
        },
        {
            icon: 'fa-solid fa-clipboard-check',
            color: '#8b5cf6',
            title: '内容质检由你决定',
            desc: '所有台词和题目由LLM生成（所以建议你用一个聪明模型）。\n生成完成后你可以预览并确认质量，\n不满意随时重新生成！',
        },
    ];

    const pagesHTML = pages.map((p, i) => `
        <div class="tree-onboarding-slide" data-slide="${i}" style="${i > 0 ? 'display:none;' : ''}">
            <div class="tree-onboarding-icon" style="color: ${p.color}; background: ${p.color}15;">
                <i class="${p.icon}"></i>
            </div>
            <div class="tree-onboarding-title">${p.title}</div>
            <div class="tree-onboarding-desc">${p.desc.replace(/\\n/g, '<br>')}</div>
        </div>
    `).join('');

    const dotsHTML = pages.map((_, i) =>
        `<span class="tree-onboarding-dot${i === 0 ? ' active' : ''}" data-dot="${i}"></span>`
    ).join('');

    const html = `
    <div class="tree-page" id="tree_page_root">
        <div class="tree-onboarding">
            <div class="tree-onboarding-slides">
                ${pagesHTML}
            </div>
            <div class="tree-onboarding-dots">
                ${dotsHTML}
            </div>
            <button class="tree-onboarding-btn" id="tree_onboarding_btn">
                下一步
            </button>
        </div>
    </div>`;

    openAppInViewport('树树', html, () => {
        let currentSlide = 0;
        const totalSlides = pages.length;
        const btn = document.getElementById('tree_onboarding_btn');

        btn?.addEventListener('click', () => {
            currentSlide++;
            if (currentSlide >= totalSlides) {
                // Done — mark as seen, proceed to adoption
                localStorage.setItem('gf_tree_onboarding_done', '1');
                showAdoptionCeremony();
                return;
            }

            // Show next slide
            document.querySelectorAll('.tree-onboarding-slide').forEach(s => {
                s.style.display = parseInt(s.dataset.slide) === currentSlide ? '' : 'none';
            });
            document.querySelectorAll('.tree-onboarding-dot').forEach(d => {
                d.classList.toggle('active', parseInt(d.dataset.dot) === currentSlide);
            });

            // Last slide: change button text
            if (currentSlide === totalSlides - 1) {
                btn.textContent = '开始领养';
            }
        });
    });
}

/**
 * Check if first-time content generation is incomplete.
 * Returns true if treeName exists but essential content (care lines, quiz, tod) is missing.
 */
function _isContentIncomplete(data) {
    const hasCareLines = data.dialogueCache.careLines.length > 0;
    const hasQuiz = data.questionBank.quiz.length > 0;
    const hasTod = data.questionBank.tod.length > 0;
    return !hasCareLines || !hasQuiz || !hasTod;
}

// ═══════════════════════════════════════════════════════════════════════
// Adoption Ceremony
// ═══════════════════════════════════════════════════════════════════════

function showAdoptionCeremony() {
    const charName = getPhoneCharInfo()?.name || '你的恋人';

    // 随机分配树种（排除已养过的）
    const completedTypes = getCompletedTreeTypes();
    const assignedType = getRandomTreeType(completedTypes);

    // 种子图片路径
    const seedImgPath = getTreeImagePath(assignedType.id, 'seed', 'spring');

    const html = `
    <div class="tree-page" id="tree_page_root">
        <div class="tree-adoption">
            <div class="tree-adoption-icon">
                <img class="tree-adoption-seed-img" src="${seedImgPath}"
                    alt="种子" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
                <div class="tree-adoption-seed-fallback" style="display:none;">
                    <i class="fa-solid fa-seedling"></i>
                </div>
            </div>
            <div class="tree-adoption-title">领养一棵${escHtml(assignedType.name)}</div>
            <div class="tree-adoption-type-badge">
                ${assignedType.emoji} ${escHtml(assignedType.name)}
            </div>
            <div class="tree-adoption-subtitle">
                和 ${escHtml(charName)} 一起种下一棵属于你们的${escHtml(assignedType.name)}吧。<br>
                用心照顾它，看着它慢慢长大……
            </div>
            <div class="tree-adoption-input-wrap">
                <input type="text" class="tree-adoption-input" id="tree_name_input"
                    placeholder="给小树起个名字" maxlength="20" autocomplete="off" />
            </div>
            <button class="tree-adoption-btn" id="tree_adopt_btn" disabled
                data-tree-type="${assignedType.id}">
                <i class="fa-solid fa-heart"></i>  领养
            </button>
        </div>
    </div>`;

    openAppInViewport('树树', html, () => bindAdoptionEvents());
}

function bindAdoptionEvents() {
    const input = document.getElementById('tree_name_input');
    const btn = document.getElementById('tree_adopt_btn');
    if (!input || !btn) return;

    input.addEventListener('input', () => {
        btn.disabled = !input.value.trim();
    });

    // Enter to confirm
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
            handleAdopt();
        }
    });

    btn.addEventListener('click', () => {
        if (input.value.trim()) handleAdopt();
    });

    // Auto-focus
    requestAnimationFrame(() => input.focus());
}

function handleAdopt() {
    const input = document.getElementById('tree_name_input');
    const btn = document.getElementById('tree_adopt_btn');
    const name = input?.value.trim();
    if (!name) return;

    const treeType = btn?.dataset.treeType || 'apple';

    updateTreeState({
        treeName: name,
        treeType: treeType,
        adoptedAt: new Date().toISOString(),
    });

    console.log(`${TREE_LOG} 领养成功！树种: ${treeType}, 树名: ${name}`);

    // Go to loading page first — must generate all content before entering game
    showLoadingPage(name);
}

// ═══════════════════════════════════════════════════════════════════════
// Loading Page (First-Time Content Generation)
// ═══════════════════════════════════════════════════════════════════════

function showLoadingPage(treeName) {
    const charName = getPhoneCharInfo()?.name || '你的恋人';

    const html = `
    <div class="tree-page" id="tree_page_root">
        <div class="tree-loading-page">
            <div class="tree-loading-icon">
                <i class="fa-solid fa-seedling"></i>
            </div>
            <div class="tree-loading-title">${escHtml(treeName)}</div>
            <div class="tree-loading-subtitle">
                ${escHtml(charName)} 正在准备专属于你们的内容……
            </div>
            <div class="tree-loading-progress-wrap">
                <div class="tree-loading-progress-bar">
                    <div class="tree-loading-progress-fill" id="tree_loading_fill" style="width: 0%;"></div>
                </div>
                <div class="tree-loading-progress-text" id="tree_loading_text">准备中…</div>
                <div class="tree-loading-progress-pct" id="tree_loading_pct">0%</div>
            </div>
        </div>
    </div>`;

    openAppInViewport('树树', html, () => {
        _runFirstTimeGeneration();
    });
}

async function _runFirstTimeGeneration() {
    const fillEl = document.getElementById('tree_loading_fill');
    const textEl = document.getElementById('tree_loading_text');
    const pctEl = document.getElementById('tree_loading_pct');

    // Temporarily activate keep-alive so iOS won't kill the page during long LLM generation
    const wasAlreadyActive = isKeepAliveActive();
    startKeepAlive();

    try {
        await generateContentStepByStep({
            onStepStart: ({ step, totalSteps, stepName }) => {
                const pct = Math.round((step / totalSteps) * 100);
                if (fillEl) fillEl.style.width = `${pct}%`;
                if (textEl) textEl.textContent = `正在生成${stepName}…`;
                if (pctEl) pctEl.textContent = `${pct}%`;
                // Hide any previous preview card
                const previewArea = document.getElementById('tree_loading_preview');
                if (previewArea) previewArea.style.display = 'none';
            },
            onStepComplete: ({ step, totalSteps, stepName, samples, rawCount }) => {
                return new Promise((resolve) => {
                    const pct = Math.round(((step + 1) / totalSteps) * 100);
                    if (fillEl) fillEl.style.width = `${pct}%`;
                    if (pctEl) pctEl.textContent = `${pct}%`;
                    if (textEl) textEl.textContent = `${stepName}生成完毕 (${rawCount} 条)`;

                    // Build preview card
                    let previewArea = document.getElementById('tree_loading_preview');
                    if (!previewArea) {
                        previewArea = document.createElement('div');
                        previewArea.id = 'tree_loading_preview';
                        previewArea.className = 'tree-loading-preview';
                        // Insert after progress wrap
                        const progressWrap = document.querySelector('.tree-loading-progress-wrap');
                        if (progressWrap) {
                            progressWrap.after(previewArea);
                        } else {
                            document.querySelector('.tree-loading-page')?.appendChild(previewArea);
                        }
                    }

                    previewArea.style.display = 'block';
                    previewArea.innerHTML = _buildPreviewCardHTML(stepName, samples, rawCount);

                    // Bind buttons
                    document.getElementById('tree_qc_approve')?.addEventListener('click', () => {
                        resolve('approve');
                    });
                    document.getElementById('tree_qc_retry')?.addEventListener('click', () => {
                        resolve('retry');
                    });
                });
            },
        });
    } catch (e) {
        console.warn(`${TREE_LOG} 首次内容生成出错:`, e.message);
        if (textEl) textEl.textContent = '生成过程中出错，请重新打开树树';
        if (fillEl) fillEl.style.width = '100%';
        if (pctEl) pctEl.textContent = '100%';
    }

    // Restore keep-alive state — stop only if we started it ourselves
    if (!wasAlreadyActive) {
        stopKeepAlive();
    }

    // Brief pause so user sees completion before transitioning
    if (fillEl) fillEl.style.width = '100%';
    if (textEl) textEl.textContent = '准备完毕！';
    if (pctEl) pctEl.textContent = '100%';
    await new Promise(r => setTimeout(r, 600));

    // Enter the game
    showTreeMainPage();
}

/**
 * Build preview card HTML for a generation step.
 * No emoji in action buttons per user request.
 */
function _buildPreviewCardHTML(stepName, samples, rawCount) {
    let samplesHTML = '';

    if (!samples || samples.length === 0) {
        samplesHTML = `<div class="tree-qc-empty">生成失败，没有内容产出。建议重新生成。</div>`;
    } else if (typeof samples[0] === 'string') {
        // Care lines — array of strings
        samplesHTML = samples.map(line =>
            `<div class="tree-qc-sample-line">「${escHtml(line)}」</div>`
        ).join('');
    } else if (samples[0].options) {
        // Quiz question — has question + options + answer
        const q = samples[0];
        const correctIdx = typeof q.answer === 'number' ? q.answer : 0;
        samplesHTML = `
            <div class="tree-qc-sample-quiz">
                <div class="tree-qc-sample-question">${escHtml(q.question)}</div>
                <div class="tree-qc-sample-options">
                    ${q.options.map((opt, i) => `<span class="tree-qc-option${i === correctIdx ? ' tree-qc-option-correct' : ''}">${'ABCD'[i]}. ${escHtml(opt)}${i === correctIdx ? ' ✓' : ''}</span>`).join('')}
                </div>
            </div>`;
    } else if (samples[0].question) {
        // ToD question — has question + type
        const q = samples[0];
        const typeLabel = q.type === 'ai' ? '角色回答' : '玩家回答';
        samplesHTML = `
            <div class="tree-qc-sample-tod">
                <div class="tree-qc-sample-question">${escHtml(q.question)}</div>
                <div class="tree-qc-sample-type">[${typeLabel}]</div>
            </div>`;
    }

    return `
        <div class="tree-qc-card">
            <div class="tree-qc-title">${escHtml(stepName)}预览 (共 ${rawCount} 条)</div>
            <div class="tree-qc-samples">
                ${samplesHTML}
            </div>
            <div class="tree-qc-actions">
                <button class="tree-qc-btn tree-qc-btn-approve" id="tree_qc_approve">通过</button>
                <button class="tree-qc-btn tree-qc-btn-retry" id="tree_qc_retry">重新生成</button>
            </div>
        </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// Tree Main Page
// ═══════════════════════════════════════════════════════════════════════

function showTreeMainPage() {
    const data = loadTreeData();
    const state = data.treeState;
    // Use debug overrides if active, otherwise real values
    const realSeason = getCurrentSeason();
    const realStage = getStageByGrowth(state.growth);
    const season = _debugState.active && _debugState.seasonOverride
        ? (SEASONS.find(s => s.id === _debugState.seasonOverride) || realSeason)
        : realSeason;
    const stage = _debugState.active && _debugState.stageOverride
        ? (GROWTH_STAGES.find(s => s.id === _debugState.stageOverride) || realStage)
        : realStage;
    const progress = _debugState.active && _debugState.stageOverride
        ? 0.5 // Show 50% in debug mode for visual preview
        : getGrowthProgress(state.growth);
    const charName = getPhoneCharInfo()?.name || '恋人';
    const treeType = state.treeType || 'apple';
    const treeTypeInfo = getTreeType(treeType);

    // AI auto-care (first open of the day)
    let aiCareHtml = '';
    if (!state.aiCaredToday) {
        const aiResult = performAiCare(state, charName);
        aiCareHtml = aiResult.html;
    }

    // Remaining care count (per-action: each action usable once/day)
    const usedActions = state.dailyCareUsedActions || [];
    const playerRemaining = _debugState.active
        ? 999
        : CARE_ACTIONS.length - usedActions.length;
    const allCareDisabled = !_debugState.active && playerRemaining <= 0;

    // Season icon
    const seasonIcon = getSeasonIcon(season.id);

    // Stage description
    const stageDesc = STAGE_SEASON_DESCRIPTIONS[stage.id]?.[season.id] || stage.name;

    // Tree image (now includes treeType)
    const imgPath = getTreeImagePath(treeType, stage.id, season.id);
    const fallbackPath = getTreeImageFallback(stage.id, season.id);
    const stageIcon = getStageIcon(stage.id);

    // Next stage info
    const nextStage = GROWTH_STAGES.find(s => s.minGrowth > stage.minGrowth);
    const progressText = nextStage
        ? `${state.growth} / ${nextStage.minGrowth}`
        : `${state.growth} (MAX)`;
    const progressPct = Math.round(progress * 100);

    // Care lines low-stock tip
    const remainingLines = getRemainingCareLines();
    const showRefillBar = remainingLines > 0 && remainingLines <= 4;

    // Fruit collection: show in autumn when medium or big stage
    const canShowFruit = season.id === FRUIT_CONFIG.season
        && (stage.id === 'medium' || stage.id === 'big');
    const fruitImg = canShowFruit ? getFruitImagePath(treeType) : '';

    // Graduation: big stage at MAX growth
    const isMaxed = stage.id === 'big' && !nextStage;


    const html = `
    <div class="tree-page season-${season.id}" id="tree_page_root">
        <div class="tree-main" id="tree_main_area">

            ${showRefillBar ? `
            <!-- Refill Tip Bar -->
            <div class="tree-refill-bar" id="tree_refill_bar">
                <span>台词快用完了（剩 ${remainingLines} 条），要刷新吗？</span>
                <button class="tree-refill-btn" id="tree_refill_btn">刷新</button>
            </div>` : ''}

            <!-- Status Header -->
            <div class="tree-status-header">
                <div class="tree-name-area">
                    <div class="tree-name">${escHtml(state.treeName)}</div>
                    <div class="tree-stage-label">
                        <i class="${stageIcon}"></i>
                        ${treeTypeInfo ? escHtml(treeTypeInfo.emoji) : ''}
                        ${escHtml(stage.name)} · ${escHtml(stageDesc)}
                    </div>
                </div>
                <div class="tree-season-badge">
                    <i class="${seasonIcon}"></i>
                    ${escHtml(season.name)}
                </div>
            </div>

            <!-- Tree Stage Display -->
            <div class="tree-stage-display" id="tree_stage_display"
                style="background-image: url('/scripts/extensions/third-party/TheGhostFace/assets/images/tree/tree_bg_${season.id}.png');">
                <img class="tree-stage-img" id="tree_stage_img"
                    src="${imgPath}"
                    alt="${escHtml(stageDesc)}"
                    onerror="this.src='${fallbackPath}'; this.onerror=null;" />
                ${canShowFruit ? `
                <img class="tree-fruit-img" id="tree_fruit_img"
                    src="${fruitImg}"
                    alt="果实"
                    title="点击尝试收集${treeTypeInfo?.fruitName || '果实'}"
                    onerror="this.style.display='none';" />
                ` : ''}
            </div>

            <!-- Dialogue Bubble (populated dynamically) -->
            <div class="tree-dialogue-bubble" id="tree_dialogue_bubble" style="display:none;"></div>

            <!-- Growth Progress -->
            <div class="tree-progress-section">
                <div class="tree-progress-labels">
                    <span class="tree-progress-stage">${escHtml(stage.name)}</span>
                    <span>${progressText} (${progressPct}%)</span>
                </div>
                <div class="tree-progress-bar">
                    <div class="tree-progress-fill" style="width: ${progressPct}%;"></div>
                </div>
            </div>

            ${aiCareHtml}

            <!-- Care Buttons -->
            <div class="tree-care-section">
                <div class="tree-care-header">
                    <span>照顾树树</span>
                    <span class="tree-care-remaining">
                        今日剩余: ${playerRemaining} / ${CARE_ACTIONS.length}
                    </span>
                </div>
                <div class="tree-care-grid">
                    ${CARE_ACTIONS.map(action => {
        const actionUsed = !_debugState.active && usedActions.includes(action.id);
        return `
                        <button class="tree-care-btn${actionUsed ? ' tree-care-btn-used' : ''}" data-care-id="${action.id}"
                            ${actionUsed || allCareDisabled ? 'disabled' : ''}>
                            <div class="tree-care-btn-icon">
                                <i class="${action.icon}"></i>
                            </div>
                            <span class="tree-care-btn-name">${escHtml(action.name)}</span>
                            <span class="tree-care-btn-value">${actionUsed ? '✓' : '+' + action.growthValue}</span>
                        </button>`;
    }).join('')}
                </div>
            </div>

            ${isMaxed ? `
            <!-- Graduation -->
            <div class="tree-graduation-section">
                <div class="tree-graduation-title">🎉 大树已满级！</div>
                <div class="tree-graduation-desc">
                    你们的${escHtml(treeTypeInfo?.name || '小树')}已经长成了参天大树！<br>
                    可以让它毕业进入图鉴，然后种一棵新树吧！
                </div>
                <button class="tree-graduation-btn" id="tree_graduate_btn">
                    <i class="fa-solid fa-graduation-cap"></i> 毕业，种新树
                </button>
            </div>` : ''}

            <!-- Mini-games -->
            <div class="tree-games-section">
                <div class="tree-games-title">互动小游戏</div>
                <div class="tree-games-grid">
                    <button class="tree-game-btn tree-game-btn-active" id="tree_game_quiz">
                        <i class="fa-solid fa-brain"></i>
                        <span>默契挑战</span>
                    </button>
                    <button class="tree-game-btn tree-game-btn-active" id="tree_game_gacha">
                        <i class="fa-solid fa-dice"></i>
                        <span>记忆扭蛋</span>
                    </button>
                    <button class="tree-game-btn tree-game-btn-active" id="tree_game_tod">
                        <i class="fa-solid fa-comments"></i>
                        <span>真心话</span>
                    </button>
                    <button class="tree-game-btn tree-game-btn-active" id="tree_game_gallery">
                        <i class="fa-solid fa-book"></i>
                        <span>图鉴</span>
                    </button>
                </div>
            </div>

        </div>
    </div>`;

    // Settings gear action in viewport header
    const actionsHtml = `
        <!-- Debug button hidden for production
        <button class="phone-app-back-btn" id="tree_debug_btn" title="调试信息" style="font-size: 12px; opacity: 0.5;">
            <i class="fa-solid fa-bug"></i>
        </button>
        -->`;

    openAppInViewport('树树', html, () => {
        bindTreeMainEvents();
        // Trigger background LLM content refill (non-blocking)
        _triggerBackgroundRefill(stage.id);
        // Update World Book if enabled
        _triggerWorldBookUpdate();
        // Re-show debug panel if active
        if (_debugState.active) _showDebugPanel();
    }, actionsHtml);
}

// ═══════════════════════════════════════════════════════════════════════
// AI Auto-Care
// ═══════════════════════════════════════════════════════════════════════

function performAiCare(state, charName) {
    // Pick a random care action
    const actionIdx = Math.floor(Math.random() * CARE_ACTIONS.length);
    const action = CARE_ACTIONS[actionIdx];

    // Apply growth + mark AI-cared in a single atomic write
    const result = addGrowth(action.growthValue, { aiCaredToday: true });

    // Try to get a cached care line
    const careLine = popCareLine();

    console.log(`${TREE_LOG} AI 自动照顾: ${charName} → ${action.name} (+${action.growthValue})`);

    const html = `
        <div class="tree-ai-care-notice" id="tree_ai_care_notice">
            <i class="${action.icon}"></i>
            <span>${escHtml(charName)} 今天帮忙${escHtml(action.name)}了小树 (+${action.growthValue})</span>
            ${careLine ? `<div class="tree-ai-care-dialogue">「${escHtml(careLine)}」</div>` : ''}
        </div>`;

    return { html, result, action };
}

// ═══════════════════════════════════════════════════════════════════════
// Event Binding — Main Page
// ═══════════════════════════════════════════════════════════════════════

function bindTreeMainEvents() {
    // Care buttons
    document.querySelectorAll('.tree-care-btn[data-care-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            const careId = btn.dataset.careId;
            handleCare(careId);
        });
    });

    // Mini-game buttons
    document.getElementById('tree_game_quiz')?.addEventListener('click', () => {
        openQuizGame(() => showTreeMainPage());
    });
    document.getElementById('tree_game_gacha')?.addEventListener('click', () => {
        openGachaGame(() => showTreeMainPage());
    });
    document.getElementById('tree_game_tod')?.addEventListener('click', () => {
        openTodGame(() => showTreeMainPage());
    });

    // Gallery
    document.getElementById('tree_game_gallery')?.addEventListener('click', () => {
        showGalleryPage();
    });

    // Graduation
    document.getElementById('tree_graduate_btn')?.addEventListener('click', () => {
        handleGraduation();
    });

    // Fruit collection
    document.getElementById('tree_fruit_img')?.addEventListener('click', () => {
        handleFruitCollection();
    });

    // Debug
    document.getElementById('tree_debug_btn')?.addEventListener('click', handleDebug);

    // Refill bar — enters QC flow
    document.getElementById('tree_refill_btn')?.addEventListener('click', () => {
        if (_refillInProgress) return;
        _refillInProgress = true;
        showRefillQCPage({ forceCareLines: true });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Care Logic
// ═══════════════════════════════════════════════════════════════════════

function handleCare(careId) {
    const action = CARE_ACTIONS.find(a => a.id === careId);
    if (!action) return;

    const data = loadTreeData();
    const state = data.treeState;

    // Check per-action daily limit (skip in debug mode)
    const usedActions = state.dailyCareUsedActions || [];

    if (!_debugState.active && usedActions.includes(careId)) {
        console.log(`${TREE_LOG} 今日已经${action.name}过了`);
        return;
    }

    // Record this action as used (skip in debug mode)
    if (!_debugState.active) {
        updateTreeState({ dailyCareUsedActions: [...usedActions, careId] });
    }

    // Show growth toast
    showGrowthToast(`+${action.growthValue}`);

    // In debug mode: visual only, no persistence
    if (_debugState.active) {
        console.log(`${TREE_LOG} [调试] 照顾: ${action.name} (+${action.growthValue}) — 不写入存档`);
        _showCareDialogueBubble();
        // Fake visual progress bump (cycles 0→100)
        const fill = document.querySelector('.tree-progress-fill');
        if (fill) {
            const current = parseFloat(fill.style.width) || 0;
            const next = current >= 97 ? 3 : current + 3;
            fill.style.width = `${next}%`;
            const labels = document.querySelector('.tree-progress-labels');
            const rightLabel = labels?.querySelector('span:last-child');
            if (rightLabel) rightLabel.textContent = `(${Math.round(next)}%)`;
        }
        return;
    }

    // Apply growth
    const oldGrowth = state.growth;
    const result = addGrowth(action.growthValue);

    console.log(`${TREE_LOG} 照顾: ${action.name} (+${action.growthValue}), 成长值: ${oldGrowth} → ${result.newGrowth}`);

    // Show care dialogue bubble
    _showCareDialogueBubble();

    // Update World Book if enabled (fire-and-forget)
    _triggerWorldBookUpdate();

    // Check stage up
    if (result.stageChanged) {
        const newStage = getStageByGrowth(result.newGrowth);
        const treeName = data.treeState.treeName || '小树';
        console.log(`${TREE_LOG} 阶段升级！${state.stage} → ${newStage.id}`);
        showStageUpAnimation(newStage, treeName, () => {
            // 升级后检查是否需要为新阶段生成内容
            _handlePostStageUp(newStage.id);
        });
    } else {
        // Partial UI refresh
        refreshAfterCare();
    }
}

function showGrowthToast(text) {
    const display = document.getElementById('tree_stage_display');
    if (!display) return;

    const toast = document.createElement('div');
    toast.className = 'tree-growth-toast';
    toast.textContent = text;
    display.appendChild(toast);

    // Remove after animation
    setTimeout(() => toast.remove(), 1000);
}

function refreshAfterCare() {
    const data = loadTreeData();
    const state = data.treeState;
    const stage = getStageByGrowth(state.growth);
    const progress = getGrowthProgress(state.growth);
    const progressPct = Math.round(progress * 100);

    // Update progress bar
    const fill = document.querySelector('.tree-progress-fill');
    if (fill) fill.style.width = `${progressPct}%`;

    // Update progress text
    const nextStage = GROWTH_STAGES.find(s => s.minGrowth > stage.minGrowth);
    const progressText = nextStage
        ? `${state.growth} / ${nextStage.minGrowth}`
        : `${state.growth} (MAX)`;
    const labels = document.querySelector('.tree-progress-labels');
    if (labels) {
        const rightLabel = labels.querySelector('span:last-child');
        if (rightLabel) rightLabel.textContent = `${progressText} (${progressPct}%)`;
    }

    // Update remaining care count (per-action)
    const usedActions = state.dailyCareUsedActions || [];
    const remaining = CARE_ACTIONS.length - usedActions.length;

    const remainEl = document.querySelector('.tree-care-remaining');
    if (remainEl) remainEl.textContent = `今日剩余: ${remaining} / ${CARE_ACTIONS.length}`;

    // Disable individual buttons that were already used today
    document.querySelectorAll('.tree-care-btn[data-care-id]').forEach(btn => {
        const id = btn.dataset.careId;
        if (usedActions.includes(id)) {
            btn.disabled = true;
            btn.classList.add('tree-care-btn-used');
            const valueEl = btn.querySelector('.tree-care-btn-value');
            if (valueEl) valueEl.textContent = '✓';
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Stage Up Animation
// ═══════════════════════════════════════════════════════════════════════

function showStageUpAnimation(newStage, treeName, afterDismiss) {
    const root = document.getElementById('tree_page_root');
    if (!root) return;

    const stageIcon = getStageIcon(newStage.id);

    const overlay = document.createElement('div');
    overlay.className = 'tree-stageup-overlay';
    overlay.id = 'tree_stageup_overlay';
    overlay.innerHTML = `
        <div class="tree-stageup-card">
            <div class="tree-stageup-icon">
                <i class="${stageIcon}"></i>
            </div>
            <div class="tree-stageup-title">${escHtml(newStage.name)}</div>
            <div class="tree-stageup-subtitle">
                恭喜，你们的小树升级了！
            </div>
            <div class="tree-stageup-llm-text" id="tree_stageup_llm_text">
                <i class="fa-solid fa-spinner fa-spin" style="opacity:0.4;"></i>
            </div>
            <div class="tree-stageup-dismiss">点击任意位置关闭</div>
        </div>`;

    root.appendChild(overlay);

    // Fire-and-forget LLM celebration (don't block the animation)
    generateMilestoneMessage(newStage, treeName).then(text => {
        const el = document.getElementById('tree_stageup_llm_text');
        if (el && text) {
            el.innerHTML = `<em>「${escHtml(text)}」</em>`;
        } else if (el) {
            el.style.display = 'none';
        }
    });

    let dismissed = false;
    const dismiss = () => {
        if (dismissed) return;
        dismissed = true;
        overlay.remove();
        if (typeof afterDismiss === 'function') afterDismiss();
    };

    // Dismiss on click
    overlay.addEventListener('click', dismiss);

    // Auto-dismiss after 6s (longer to allow reading LLM text)
    setTimeout(() => {
        if (document.getElementById('tree_stageup_overlay')) dismiss();
    }, 6000);
}

// ═══════════════════════════════════════════════════════════════════════
// Developer Debug Mode
// ═══════════════════════════════════════════════════════════════════════

function handleDebug() {
    _debugState.active = !_debugState.active;
    console.log(`${TREE_LOG} 调试模式: ${_debugState.active ? 'ON' : 'OFF'}`);

    if (_debugState.active) {
        // Also log current data
        const data = loadTreeData();
        console.log(`${TREE_LOG} 当前数据:`, JSON.parse(JSON.stringify(data)));
        _showDebugPanel();
    } else {
        // Clear overrides and remove panel
        _debugState.seasonOverride = null;
        _debugState.stageOverride = null;
        document.getElementById('tree_debug_panel')?.remove();
        showTreeMainPage();
    }

    // Update debug button visual
    const debugBtn = document.getElementById('tree_debug_btn');
    if (debugBtn) {
        debugBtn.style.opacity = _debugState.active ? '1' : '0.5';
        debugBtn.style.color = _debugState.active ? '#ef4444' : '';
    }
}

function _showDebugPanel() {
    // Remove existing panel
    document.getElementById('tree_debug_panel')?.remove();

    const currentSeason = _debugState.seasonOverride || getCurrentSeason().id;
    const currentStage = _debugState.stageOverride || getStageByGrowth(getTreeState().growth).id;

    const seasonBtns = SEASONS.map(s => `
        <button class="tree-dbg-btn ${s.id === currentSeason ? 'tree-dbg-btn-active' : ''}"
            data-dbg-season="${s.id}">${s.emoji} ${s.name}</button>
    `).join('');

    const stageBtns = GROWTH_STAGES.map(s => `
        <button class="tree-dbg-btn ${s.id === currentStage ? 'tree-dbg-btn-active' : ''}"
            data-dbg-stage="${s.id}">${s.emoji} ${s.name}</button>
    `).join('');

    const panel = document.createElement('div');
    panel.id = 'tree_debug_panel';
    panel.className = 'tree-debug-panel';
    panel.innerHTML = `
        <div class="tree-dbg-title">
            <i class="fa-solid fa-bug"></i> DEV MODE
            <span class="tree-dbg-close" id="tree_dbg_close">&times;</span>
        </div>
        <div class="tree-dbg-section">
            <div class="tree-dbg-label">季节</div>
            <div class="tree-dbg-row">${seasonBtns}</div>
        </div>
        <div class="tree-dbg-section">
            <div class="tree-dbg-label">阶段</div>
            <div class="tree-dbg-row">${stageBtns}</div>
        </div>
        <div class="tree-dbg-hint">照顾次数无限 · 不影响存档</div>
    `;

    // Insert into tree page root
    const root = document.getElementById('tree_main_area') || document.getElementById('tree_page_root');
    if (root) {
        root.prepend(panel);
    }

    // Bind events
    panel.querySelectorAll('[data-dbg-season]').forEach(btn => {
        btn.addEventListener('click', () => {
            _debugState.seasonOverride = btn.dataset.dbgSeason;
            console.log(`${TREE_LOG} 调试: 季节 → ${btn.dataset.dbgSeason}`);
            showTreeMainPage();
        });
    });

    panel.querySelectorAll('[data-dbg-stage]').forEach(btn => {
        btn.addEventListener('click', () => {
            _debugState.stageOverride = btn.dataset.dbgStage;
            console.log(`${TREE_LOG} 调试: 阶段 → ${btn.dataset.dbgStage}`);
            showTreeMainPage();
        });
    });

    document.getElementById('tree_dbg_close')?.addEventListener('click', () => {
        handleDebug(); // Toggle off
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Refill QC Page (content refill with quality check)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Show a loading/QC page for content refill.
 * Reuses the same QC preview + approve/retry flow as first-time generation.
 * After all steps complete, returns to tree main page.
 *
 * @param {Object} [options]
 * @param {boolean} [options.forceCareLines=false] — force regenerate care lines
 * @param {boolean} [options.skipQuiz=false] — skip quiz generation
 * @param {boolean} [options.skipTod=false] — skip ToD generation
 */
function showRefillQCPage({ forceCareLines = false, skipQuiz = false, skipTod = false } = {}) {
    const charName = getPhoneCharInfo()?.name || '你的恋人';

    // Determine which steps to skip based on current stock
    const data = loadTreeData();
    const currentStageId = data.treeState.stage;
    const needsCareLines = forceCareLines
        || getRemainingCareLines() === 0
        || data.dialogueCache.currentStage !== currentStageId;

    const remaining = getRemainingQuestions();
    const actualSkipCareLines = !needsCareLines;
    const actualSkipQuiz = skipQuiz || remaining.quiz >= QUIZ_LOW_THRESHOLD;
    const actualSkipTod = skipTod || remaining.tod >= TOD_LOW_THRESHOLD;

    // If nothing actually needs refill, just return
    if (actualSkipCareLines && actualSkipQuiz && actualSkipTod) {
        console.log(`${TREE_LOG} 所有内容存量充足，无需补充`);
        return;
    }

    const html = `
    <div class="tree-page" id="tree_page_root">
        <div class="tree-loading-page">
            <div class="tree-loading-icon">
                <i class="fa-solid fa-wand-magic-sparkles"></i>
            </div>
            <div class="tree-loading-title">内容补充</div>
            <div class="tree-loading-subtitle">
                ${escHtml(charName)} 正在准备新的内容……
            </div>
            <div class="tree-loading-progress-wrap">
                <div class="tree-loading-progress-bar">
                    <div class="tree-loading-progress-fill" id="tree_loading_fill" style="width: 0%;"></div>
                </div>
                <div class="tree-loading-progress-text" id="tree_loading_text">准备中…</div>
                <div class="tree-loading-progress-pct" id="tree_loading_pct">0%</div>
            </div>
        </div>
    </div>`;

    openAppInViewport('树树', html, () => {
        _runRefillGeneration(actualSkipCareLines, actualSkipQuiz, actualSkipTod);
    });
}

async function _runRefillGeneration(skipCareLines, skipQuiz, skipTod) {
    const fillEl = document.getElementById('tree_loading_fill');
    const textEl = document.getElementById('tree_loading_text');
    const pctEl = document.getElementById('tree_loading_pct');

    // Temporarily activate keep-alive so iOS won't kill the page during LLM generation
    const wasAlreadyActive = isKeepAliveActive();
    startKeepAlive();

    try {
        await generateContentStepByStep({
            skipCareLines,
            skipQuiz,
            skipTod,
            onStepStart: ({ step, totalSteps, stepName }) => {
                const pct = Math.round((step / totalSteps) * 100);
                if (fillEl) fillEl.style.width = `${pct}%`;
                if (textEl) textEl.textContent = `正在生成${stepName}…`;
                if (pctEl) pctEl.textContent = `${pct}%`;
                // Hide any previous preview card
                const previewArea = document.getElementById('tree_loading_preview');
                if (previewArea) previewArea.style.display = 'none';
            },
            onStepComplete: ({ step, totalSteps, stepName, samples, rawCount }) => {
                return new Promise((resolve) => {
                    const pct = Math.round(((step + 1) / totalSteps) * 100);
                    if (fillEl) fillEl.style.width = `${pct}%`;
                    if (pctEl) pctEl.textContent = `${pct}%`;
                    if (textEl) textEl.textContent = `${stepName}生成完毕 (${rawCount} 条)`;

                    // Build preview card
                    let previewArea = document.getElementById('tree_loading_preview');
                    if (!previewArea) {
                        previewArea = document.createElement('div');
                        previewArea.id = 'tree_loading_preview';
                        previewArea.className = 'tree-loading-preview';
                        const progressWrap = document.querySelector('.tree-loading-progress-wrap');
                        if (progressWrap) {
                            progressWrap.after(previewArea);
                        } else {
                            document.querySelector('.tree-loading-page')?.appendChild(previewArea);
                        }
                    }

                    previewArea.style.display = 'block';
                    previewArea.innerHTML = _buildPreviewCardHTML(stepName, samples, rawCount);

                    // Bind buttons
                    document.getElementById('tree_qc_approve')?.addEventListener('click', () => {
                        resolve('approve');
                    });
                    document.getElementById('tree_qc_retry')?.addEventListener('click', () => {
                        resolve('retry');
                    });
                });
            },
        });
    } catch (e) {
        console.warn(`${TREE_LOG} 内容补充生成出错:`, e.message);
        if (textEl) textEl.textContent = '生成过程中出错';
        if (fillEl) fillEl.style.width = '100%';
        if (pctEl) pctEl.textContent = '100%';
    }

    // Restore keep-alive state
    if (!wasAlreadyActive) {
        stopKeepAlive();
    }

    // Clear re-entry guard BEFORE returning to main page
    _refillInProgress = false;

    // Brief pause so user sees completion before transitioning
    if (fillEl) fillEl.style.width = '100%';
    if (textEl) textEl.textContent = '补充完毕！';
    if (pctEl) pctEl.textContent = '100%';
    await new Promise(r => setTimeout(r, 600));

    // Return to tree main page
    showTreeMainPage();
}

// ═══════════════════════════════════════════════════════════════════════
// LLM Helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * 升级后的内容刷新处理。
 * 检测是否需要为新阶段生成台词，如果需要则直接进入 QC 流程，
 * 避免先闪一下主页再跳转到加载页。
 */
function _handlePostStageUp(newStageId) {
    const data = loadTreeData();
    const needsNewCareLines = data.dialogueCache.currentStage !== newStageId;

    if (needsNewCareLines) {
        console.log(`${TREE_LOG} 新阶段需要生成新台词: ${data.dialogueCache.currentStage} → ${newStageId}`);
        showRefillQCPage({ forceCareLines: true, skipQuiz: true, skipTod: true });
    } else {
        showTreeMainPage();
    }
}

/**
 * Trigger content refill with QC when content is running low.
 * Called when tree main page opens.
 */
function _triggerBackgroundRefill(currentStageId) {
    // Re-entry guard: if a refill is already in progress, skip
    if (_refillInProgress) {
        console.log(`${TREE_LOG} 跳过内容补充检查（补充流程进行中）`);
        return;
    }

    const data = loadTreeData();
    const remainingLines = getRemainingCareLines();
    const cachedStage = data.dialogueCache.currentStage;
    const needsCareLines =
        remainingLines === 0 ||
        cachedStage !== currentStageId;

    const remaining = getRemainingQuestions();
    const needsQuiz = remaining.quiz < QUIZ_LOW_THRESHOLD;
    const needsTod = remaining.tod < TOD_LOW_THRESHOLD;

    if (needsCareLines || needsQuiz || needsTod) {
        console.log(`${TREE_LOG} 内容不足，进入质检补充流程 (台词=${needsCareLines}, 默契=${needsQuiz}, 真心话=${needsTod})`);
        console.log(`${TREE_LOG}   ↳ 台词诊断: 剩余=${remainingLines}, 缓存阶段="${cachedStage}", 当前阶段="${currentStageId}"`);
        _refillInProgress = true;
        showRefillQCPage({
            forceCareLines: needsCareLines,
            skipQuiz: !needsQuiz,
            skipTod: !needsTod,
        });
    }
    // If nothing is low, no refill needed
}

/**
 * Show a care dialogue bubble when player cares for the tree.
 * Pops one line from the dialogue cache.
 */
function _showCareDialogueBubble() {
    const careLine = popCareLine();
    if (!careLine) return;

    const charName = getPhoneCharInfo()?.name || '恋人';
    const bubble = document.getElementById('tree_dialogue_bubble');
    if (!bubble) return;

    bubble.style.display = 'block';
    bubble.innerHTML = `<strong>${escHtml(charName)}</strong>：「${escHtml(careLine)}」`;
    bubble.className = 'tree-dialogue-bubble tree-dialogue-show';

    // Auto-hide after 4s
    clearTimeout(bubble._hideTimer);
    bubble._hideTimer = setTimeout(() => {
        bubble.classList.remove('tree-dialogue-show');
        bubble.classList.add('tree-dialogue-hide');
        setTimeout(() => {
            bubble.style.display = 'none';
            bubble.className = 'tree-dialogue-bubble';
        }, 400);
    }, 4000);
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get FontAwesome icon class for a growth stage
 */
function getStageIcon(stageId) {
    const icons = {
        seed: 'fa-solid fa-seedling',
        sprout: 'fa-solid fa-leaf',
        small: 'fa-solid fa-tree',
        medium: 'fa-solid fa-tree',
        big: 'fa-solid fa-tree',
    };
    return icons[stageId] || 'fa-solid fa-tree';
}

/**
 * Get FontAwesome icon class for a season
 */
function getSeasonIcon(seasonId) {
    const icons = {
        spring: 'fa-solid fa-sun',
        summer: 'fa-solid fa-sun',
        autumn: 'fa-solid fa-wind',
        winter: 'fa-solid fa-snowflake',
    };
    return icons[seasonId] || 'fa-solid fa-sun';
}

function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════════════════
// Fruit Collection
// ═══════════════════════════════════════════════════════════════════════

function handleFruitCollection() {
    const state = getTreeState();
    const stage = getStageByGrowth(state.growth);
    const treeType = state.treeType || 'apple';
    const treeTypeInfo = getTreeType(treeType);
    const fruitName = treeTypeInfo?.fruitName || '果实';

    // Roll the dice
    const chanceConfig = FRUIT_CONFIG[stage.id];
    if (!chanceConfig) return;

    const roll = Math.random();
    const success = roll < chanceConfig.chance;

    const fruitImg = document.getElementById('tree_fruit_img');

    if (success) {
        const isNew = addFruitToCollection(treeType);
        // Show success animation
        if (fruitImg) {
            fruitImg.classList.add('tree-fruit-collected');
            setTimeout(() => fruitImg.classList.remove('tree-fruit-collected'), 800);
        }
        showGrowthToast(isNew ? `🎉 收集到新果实: ${fruitName}！` : `${fruitName} 已在图鉴中`);
        console.log(`${TREE_LOG} 果实收集成功: ${treeType} (roll=${roll.toFixed(2)}, chance=${chanceConfig.chance})`);
    } else {
        // Show miss
        if (fruitImg) {
            fruitImg.classList.add('tree-fruit-miss');
            setTimeout(() => fruitImg.classList.remove('tree-fruit-miss'), 600);
        }
        showGrowthToast(`${fruitName}没有熟透，下次再试吧～`);
        console.log(`${TREE_LOG} 果实收集失败 (roll=${roll.toFixed(2)}, chance=${chanceConfig.chance})`);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Graduation & Gallery
// ═══════════════════════════════════════════════════════════════════════

function handleGraduation() {
    const state = getTreeState();
    const charName = getPhoneCharInfo()?.name || '恋人';
    const oldTreeName = state.treeName;
    const oldTreeType = state.treeType;
    const oldTypeInfo = getTreeType(oldTreeType);

    // Get next tree type (random, excluding already-completed)
    const completedTypes = getCompletedTreeTypes();
    const newType = getRandomTreeType(completedTypes);
    const newSeedImg = getTreeImagePath(newType.id, 'seed', 'spring');

    const html = `
    <div class="tree-page" id="tree_page_root">
        <div class="tree-graduation-ceremony">
            <div class="tree-graduation-congrats">
                <i class="fa-solid fa-trophy"></i>
            </div>
            <div class="tree-graduation-title">🎉 毕业典礼</div>
            <div class="tree-graduation-subtitle">
                你们的 <strong>${escHtml(oldTreeName)}</strong>（${oldTypeInfo?.emoji || '🌳'} ${escHtml(oldTypeInfo?.name || '小树')}）<br>
                已经长成参天大树，被收录进了图鉴！
            </div>
            <div class="tree-graduation-new">
                <img class="tree-graduation-new-img" src="${newSeedImg}"
                    alt="新种子" onerror="this.style.display='none';" />
                <div>下一棵：${newType.emoji} ${escHtml(newType.name)}</div>
            </div>
            <div class="tree-adoption-input-wrap">
                <input type="text" class="tree-adoption-input" id="tree_new_name_input"
                    placeholder="给新树起个名字" maxlength="20" autocomplete="off" />
            </div>
            <button class="tree-adoption-btn" id="tree_new_adopt_btn" disabled
                data-tree-type="${newType.id}">
                <i class="fa-solid fa-seedling"></i>  开始新的旅程
            </button>
        </div>
    </div>`;

    openAppInViewport('树树', html, () => {
        const input = document.getElementById('tree_new_name_input');
        const btn = document.getElementById('tree_new_adopt_btn');
        if (!input || !btn) return;

        input.addEventListener('input', () => {
            btn.disabled = !input.value.trim();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && input.value.trim()) {
                completeGraduation(newType.id, input.value.trim());
            }
        });
        btn.addEventListener('click', () => {
            if (input.value.trim()) {
                completeGraduation(newType.id, input.value.trim());
            }
        });
        requestAnimationFrame(() => input.focus());
    });
}

function completeGraduation(newTreeType, newTreeName) {
    archiveCurrentTree(newTreeType, newTreeName);
    console.log(`${TREE_LOG} 毕业完成，新树: ${newTreeType} 「${newTreeName}」`);
    showLoadingPage(newTreeName);
}

function showGalleryPage() {
    const archive = getTreeArchive();
    const fruits = getFruitsCollected();
    const collected = getCollection();
    const fragments = getStoryFragments();
    const totalFragments = GACHA_POOL.filter(i => i.effect?.type === 'storyFragment').length;

    const archiveHtml = archive.length === 0
        ? '<div class="tree-gallery-empty">还没有毕业的大树哦～</div>'
        : archive.map(entry => {
            const typeInfo = getTreeType(entry.treeType);
            const springImg = getTreeImagePath(entry.treeType, 'big', 'spring');
            const dateStr = entry.completedAt ? new Date(entry.completedAt).toLocaleDateString() : '';
            return `
                <div class="tree-gallery-card">
                    <img class="tree-gallery-card-img" src="${springImg}"
                        alt="${escHtml(typeInfo?.name || entry.treeType)}"
                        onerror="this.style.display='none';" />
                    <div class="tree-gallery-card-info">
                        <div class="tree-gallery-card-name">${escHtml(entry.treeName)}</div>
                        <div class="tree-gallery-card-type">${typeInfo?.emoji || '🌳'} ${escHtml(typeInfo?.name || entry.treeType)}</div>
                        <div class="tree-gallery-card-date">${escHtml(dateStr)}</div>
                    </div>
                </div>`;
        }).join('');

    // Fruit collection display
    const fruitHtml = TREE_TYPES.map(type => {
        const fcollected = fruits.includes(type.id);
        const fruitImgPath = fcollected ? getFruitImagePath(type.id) : '';
        return `
            <div class="tree-fruit-gallery-item ${fcollected ? 'collected' : 'locked'}">
                ${fcollected
                ? `<img class="tree-fruit-gallery-img" src="${fruitImgPath}" alt="${escHtml(type.fruitName)}" onerror="this.style.display='none';" />`
                : '<i class="fa-solid fa-question"></i>'
            }
                <span class="tree-fruit-gallery-name">${fcollected ? escHtml(type.fruitName) : '???'}</span>
            </div>`;
    }).join('');

    // Gacha collection display
    const gachaHtml = GACHA_POOL.map(item => {
        const owned = collected.includes(item.id);
        return `
            <div class="tg-collection-item ${owned ? 'owned' : 'locked'} rarity-${item.rarity.id}">
                <div class="tg-collection-item-icon">${owned ? item.emoji : '？'}</div>
                <div class="tg-collection-item-name">${owned ? escHtml(item.name) : '???'}</div>
            </div>`;
    }).join('');

    const fragmentsHtml = totalFragments > 0 ? `
        <div class="tg-collection-fragments">
            <div class="tg-collection-fragments-title">
                <i class="fa-solid fa-puzzle-piece"></i> 剧情碎片 ${fragments.length}/${totalFragments}
            </div>
            <div class="tg-collection-fragments-bar">
                <div class="tg-collection-fragments-fill" style="width: ${(fragments.length / totalFragments) * 100}%"></div>
            </div>
            ${fragments.length >= totalFragments
            ? '<div class="tg-collection-fragments-complete"><i class="fa-solid fa-star"></i> 碎片已集齐！隐藏故事已解锁</div>'
            : '<div class="tg-collection-fragments-hint">集齐碎片可解锁隐藏故事</div>'
        }
        </div>` : '';

    const html = `
    <div class="tree-page" id="tree_page_root">
        <div class="tree-gallery">
            <div class="tree-gallery-section">
                <div class="tree-gallery-section-title">🌳 大树图鉴</div>
                <div class="tree-gallery-grid">
                    ${archiveHtml}
                </div>
            </div>
            <div class="tree-gallery-section">
                <div class="tree-gallery-section-title">🍒 果实图鉴 (${fruits.length}/${TREE_TYPES.length})</div>
                <div class="tree-fruit-gallery-grid">
                    ${fruitHtml}
                </div>
            </div>
            <div class="tree-gallery-section">
                <div class="tree-gallery-section-title">🎰 扭蛋收藏 (${collected.length}/${GACHA_POOL.length})</div>
                <div class="tg-collection-grid">
                    ${gachaHtml}
                </div>
                ${fragmentsHtml}
            </div>
        </div>
    </div>`;

    // Use '树树' as title so the back button event is consistent
    // Register a one-time back-button interceptor to return to tree main page
    const backHandler = (e) => {
        const isGallery = document.querySelector('.tree-gallery');
        if (isGallery) {
            e.preventDefault();
            showTreeMainPage();
        }
    };
    window.addEventListener('phone-app-back', backHandler, { once: true });

    openAppInViewport('图鉴', html, null);
}

// ═══════════════════════════════════════════════════════════════════════
// World Book Update
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fire-and-forget World Book update.
 * Only runs if the WB toggle is enabled.
 */
function _triggerWorldBookUpdate() {
    const data = loadTreeData();
    if (!data.settings.injectWorldBook) return;

    const state = data.treeState;
    if (!state.treeName) return; // Tree not adopted yet

    const season = getCurrentSeason();
    const stage = getStageByGrowth(state.growth);
    const charName = getPhoneCharInfo()?.name || '恋人';
    const userName = getPhoneUserName() || '玩家';

    updateTreeWorldInfo(state, season, stage, charName, userName).catch(e => {
        console.warn(`${TREE_LOG} World Book 更新失败:`, e);
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Cloud Sync Guard
// ═══════════════════════════════════════════════════════════════════════

let _syncSafetyNetsRegistered = false;

/**
 * Register browser-level safety nets for cloud sync.
 * Called once from openTreeApp(). Idempotent.
 */
function _registerSyncSafetyNets() {
    if (_syncSafetyNetsRegistered) return;
    _syncSafetyNetsRegistered = true;

    // ── Back-button sync guard ──
    // Intercept the back event when leaving tree app with pending data
    window.addEventListener('phone-app-back', (e) => {
        // Only intercept if we're on the tree main page (not sub-pages like gallery/games)
        const isTreeMainPage = document.querySelector('.tree-care-grid');
        if (!isTreeMainPage) return;  // Let sub-pages handle their own back
        if (!hasPendingSync()) return; // Nothing pending, let it close normally

        // Block the default viewport close
        e.preventDefault();

        // Show sync guard, then close viewport after sync is done
        _showSyncGuardAndLeave(() => {
            const viewport = document.getElementById('phone_app_viewport');
            if (viewport) viewport.classList.remove('app-active');
        });
    });

    // ── visibilitychange: flush when user switches tabs / minimises ──
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && hasPendingSync()) {
            console.log(`${TREE_LOG} 页面切到后台，立即同步数据`);
            flushSyncNow();
        }
    });

    // ── beforeunload: last-resort flush when tab/window closes ──
    window.addEventListener('beforeunload', () => {
        if (hasPendingSync()) {
            console.log(`${TREE_LOG} 页面即将关闭，立即同步数据`);
            flushSyncNow();
        }
    });

    console.log(`${TREE_LOG} 云端同步安全网已注册 (back-guard + visibilitychange + beforeunload)`);
}

/**
 * Show a sync guard overlay when the user tries to leave tree app
 * with pending unsaved data. Blocks navigation until sync completes.
 * @param {Function} onDone - called after sync finishes (or is skipped)
 */
async function _showSyncGuardAndLeave(onDone) {
    if (!hasPendingSync()) {
        // Nothing pending — leave immediately
        if (typeof onDone === 'function') onDone();
        return;
    }

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'tree-sync-guard-overlay';
    overlay.innerHTML = `
        <div class="tree-sync-guard-card">
            <i class="fa-solid fa-cloud-arrow-up tree-sync-guard-icon"></i>
            <div class="tree-sync-guard-text">正在保存到云端…</div>
            <div class="tree-sync-guard-sub">请稍等，确保你的数据不会丢失</div>
        </div>`;
    document.body.appendChild(overlay);

    console.log(`${TREE_LOG} 同步守卫：有待上传数据，正在立即同步…`);

    const success = await flushSyncNow();

    // Update overlay to show result briefly
    const card = overlay.querySelector('.tree-sync-guard-card');
    if (card) {
        if (success) {
            card.innerHTML = `
                <i class="fa-solid fa-circle-check tree-sync-guard-icon tree-sync-guard-success"></i>
                <div class="tree-sync-guard-text">已保存 ✓</div>`;
        } else {
            card.innerHTML = `
                <i class="fa-solid fa-circle-exclamation tree-sync-guard-icon tree-sync-guard-fail"></i>
                <div class="tree-sync-guard-text">保存失败，数据仅在本地</div>
                <div class="tree-sync-guard-sub">下次打开树树时会重试</div>`;
        }
    }

    // Brief pause so user sees the result
    await new Promise(r => setTimeout(r, success ? 500 : 1500));
    overlay.remove();

    if (typeof onDone === 'function') onDone();
}

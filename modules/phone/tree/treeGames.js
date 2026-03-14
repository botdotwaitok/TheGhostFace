// modules/phone/tree/treeGames.js — 树树小游戏模块
// Stage 3: 默契挑战 · 记忆扭蛋 · 真心话大冒险
// Stage 4: LLM 集成完成 — 真心话 AI 回答 + 扭蛋恋人密语。

import { openAppInViewport } from '../phoneController.js';
import { getPhoneCharInfo, getPhoneUserName } from '../phoneContext.js';
import {
    GAME_REWARDS, GACHA_POOL, GACHA_PITY_THRESHOLD, DAILY_FREE_GACHA, RARITY,
    DAILY_QUIZ_MAX, DAILY_TOD_MAX,
} from './treeConfig.js';
import {
    QUIZ_PER_ROUND, TOD_ROUNDS_PER_GAME,
} from './treeQuestions.js';
import {
    loadTreeData, updateTreeState, addGrowth,
    updateGameHistory, getGameHistory,
    addToCollection, getCollection,
    addStoryFragment, getStoryFragments,
    popQuizQuestions, popTodQuestionsByType, getRemainingQuestions,
} from './treeStorage.js';
import { generateTodAnswer, generateTodReaction, generateGachaDialogue } from './treeLLM.js';

const LOG = '[树树·游戏]';

let _globalTreeGamesEventsBound = false;
let _currentGameFinishCallback = null;

function bindGlobalGameBackEvent(onFinish) {
    _currentGameFinishCallback = onFinish;
    if (!_globalTreeGamesEventsBound) {
        _globalTreeGamesEventsBound = true;
        window.addEventListener('phone-app-back', (e) => {
            const isTreeGame = document.querySelector('.tg-quiz-page') ||
                               document.querySelector('.tg-gacha-page') ||
                               document.querySelector('.tg-tod-page');
            if (isTreeGame) {
                e.preventDefault();
                if (typeof _currentGameFinishCallback === 'function') {
                    _currentGameFinishCallback();
                }
            }
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Shared Helpers
// ═══════════════════════════════════════════════════════════════════════

function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getCharName() {
    return getPhoneCharInfo()?.name || '恋人';
}

/** Show a reward overlay, then call afterDismiss */
function showRewardOverlay(root, { bonusCare = 0, bonusGrowth = 0, title = '' }, afterDismiss) {
    const overlay = document.createElement('div');
    overlay.className = 'tg-reward-overlay';
    overlay.innerHTML = `
        <div class="tg-reward-card">
            <div class="tg-reward-icon"><i class="fa-solid fa-gift"></i></div>
            <div class="tg-reward-title">${title ? esc(title) + ' · ' : ''}获得奖励！</div>
            <div class="tg-reward-items">
                ${bonusCare > 0 ? `<div class="tg-reward-item"><i class="fa-solid fa-hand-holding-heart"></i> 额外照顾 ×${bonusCare}</div>` : ''}
                ${bonusGrowth > 0 ? `<div class="tg-reward-item"><i class="fa-solid fa-seedling"></i> 成长值 +${bonusGrowth}</div>` : ''}
            </div>
            <div class="tg-reward-dismiss">点击关闭</div>
        </div>`;
    root.appendChild(overlay);

    // Apply rewards
    if (bonusCare > 0) {
        const data = loadTreeData();
        updateTreeState({ bonusCareCount: (data.treeState.bonusCareCount || 0) + bonusCare });
    }
    if (bonusGrowth > 0) {
        addGrowth(bonusGrowth);
    }

    overlay.addEventListener('click', () => {
        overlay.remove();
        if (typeof afterDismiss === 'function') afterDismiss();
    });
}

// ═══════════════════════════════════════════════════════════════════════
// 3a. 默契挑战 — Quiz Game
// ═══════════════════════════════════════════════════════════════════════

/**
 * Open the quiz mini-game.
 * @param {Function} onFinish - called when the game ends (to refresh tree main page)
 */
export function openQuizGame(onFinish) {
    bindGlobalGameBackEvent(onFinish);

    // Daily limit check
    const hist = getGameHistory();
    const dailyPlayed = hist.dailyQuizPlayed || 0;
    if (dailyPlayed >= DAILY_QUIZ_MAX) {
        const html = `
        <div class="tree-page tg-quiz-page" id="tree_page_root">
            <div class="tg-quiz-container" style="text-align:center; padding: 40px 20px;">
                <div style="font-size: 24px; margin-bottom: 16px;"><i class="fa-solid fa-brain"></i></div>
                <div style="margin-bottom: 12px;">今天已经玩了 ${dailyPlayed} 轮默契挑战了！</div>
                <div style="font-size: 12px; opacity: 0.6; margin-bottom: 20px;">每天最多 ${DAILY_QUIZ_MAX} 轮，明天再来吧~</div>
                <button class="tg-primary-btn" id="tg_quiz_back_limit">
                    <i class="fa-solid fa-arrow-left"></i> 返回
                </button>
            </div>
        </div>`;
        openAppInViewport('默契挑战', html, () => {
            document.getElementById('tg_quiz_back_limit')?.addEventListener('click', () => {
                if (typeof onFinish === 'function') onFinish();
            });
        });
        return;
    }

    // Draw questions from LLM-generated storage only (no builtin fallback)
    let questions = popQuizQuestions(QUIZ_PER_ROUND);

    if (questions.length === 0) {
        // No questions available at all — show a message
        const html = `
        <div class="tree-page tg-quiz-page" id="tree_page_root">
            <div class="tg-quiz-container" style="text-align:center; padding: 40px 20px;">
                <div style="font-size: 24px; margin-bottom: 16px;"><i class="fa-solid fa-brain"></i></div>
                <div style="margin-bottom: 12px;">题目已用完，需要生成新题目。</div>
                <div style="font-size: 12px; opacity: 0.6; margin-bottom: 20px;">返回树主页后会自动补充题目</div>
                <button class="tg-primary-btn" id="tg_quiz_back_empty">
                    <i class="fa-solid fa-arrow-left"></i> 返回
                </button>
            </div>
        </div>`;
        openAppInViewport('默契挑战', html, () => {
            document.getElementById('tg_quiz_back_empty')?.addEventListener('click', () => {
                if (typeof onFinish === 'function') onFinish();
            });
        });
        return;
    }

    // Shuffle final set
    questions = questions.slice(0, QUIZ_PER_ROUND).sort(() => Math.random() - 0.5);

    const state = {
        questions,
        currentIdx: 0,
        score: 0,
        results: [], // { question, playerAnswer, aiAnswer, match }
    };

    renderQuizQuestion(state, onFinish);
}

function renderQuizQuestion(state, onFinish) {
    const q = state.questions[state.currentIdx];
    const charName = getCharName();
    const progress = `${state.currentIdx + 1} / ${state.questions.length}`;

    const html = `
    <div class="tree-page tg-quiz-page" id="tree_page_root">
        <div class="tg-quiz-container">
            <div class="tg-quiz-progress">
                <div class="tg-quiz-progress-text">${progress}</div>
                <div class="tg-quiz-progress-bar">
                    <div class="tg-quiz-progress-fill" style="width: ${((state.currentIdx + 1) / state.questions.length) * 100}%"></div>
                </div>
                <div class="tg-quiz-score">默契 ${state.score}</div>
            </div>

            <div class="tg-quiz-question-card">
                <div class="tg-quiz-question-text">${esc(q.question)}</div>
                <div class="tg-quiz-question-hint">你觉得 ${esc(charName)} 会选什么？</div>
            </div>

            <div class="tg-quiz-options" id="tg_quiz_options">
                ${q.options.map((opt, i) => `
                    <button class="tg-quiz-option" data-idx="${i}">
                        <span class="tg-quiz-option-letter">${'ABCD'[i]}</span>
                        <span class="tg-quiz-option-text">${esc(opt)}</span>
                    </button>
                `).join('')}
            </div>
        </div>
    </div>`;

    openAppInViewport('默契挑战', html, () => {
        document.querySelectorAll('#tg_quiz_options .tg-quiz-option').forEach(btn => {
            btn.addEventListener('click', () => {
                handleQuizAnswer(state, parseInt(btn.dataset.idx), onFinish);
            });
        });
    });
}

function handleQuizAnswer(state, playerIdx, onFinish) {
    const q = state.questions[state.currentIdx];
    const charName = getCharName();

    // Disable all buttons
    const btns = document.querySelectorAll('#tg_quiz_options .tg-quiz-option');
    btns.forEach(b => { b.style.pointerEvents = 'none'; });

    // Mark player selection
    btns[playerIdx].classList.add('tg-quiz-option-selected');

    // Use pre-defined correct answer
    const correctIdx = typeof q.answer === 'number' ? q.answer : 0;
    const isCorrect = playerIdx === correctIdx;

    setTimeout(() => {
        // Reveal correct answer
        btns[correctIdx].classList.add('tg-quiz-option-ai');
        if (isCorrect) {
            btns[playerIdx].classList.add('tg-quiz-option-match');
        } else {
            btns[playerIdx].classList.add('tg-quiz-option-mismatch');
        }

        // Update score
        if (isCorrect) state.score++;

        state.results.push({
            question: q.question,
            playerAnswer: q.options[playerIdx],
            aiAnswer: q.options[correctIdx],
            match: isCorrect,
        });

        // Show result indicator
        const card = document.querySelector('.tg-quiz-question-card');
        if (card) {
            const indicator = document.createElement('div');
            indicator.className = `tg-quiz-result-indicator ${isCorrect ? 'match' : 'mismatch'}`;
            indicator.innerHTML = isCorrect
                ? `<i class="fa-solid fa-heart"></i> 回答正确！`
                : `<i class="fa-solid fa-heart-crack"></i> 回答错误~`;
            card.appendChild(indicator);
        }

        // Next question or results after 1.5s
        setTimeout(() => {
            state.currentIdx++;
            if (state.currentIdx < state.questions.length) {
                renderQuizQuestion(state, onFinish);
            } else {
                renderQuizResults(state, onFinish);
            }
        }, 1500);
    }, 800);
}

function renderQuizResults(state, onFinish) {
    const total = state.questions.length;
    const score = state.score;
    const pct = Math.round((score / total) * 100);
    const charName = getCharName();

    // Determine reward tier
    let reward = { bonusCare: 0, bonusGrowth: 0 };
    let tierLabel = '';
    if (score >= total) {
        reward = { ...GAME_REWARDS.quiz.perfect };
        tierLabel = '<i class="ph ph-trophy"></i> 完美默契！';
    } else if (score >= 4) {
        reward = { ...GAME_REWARDS.quiz.pass };
        tierLabel = '<i class="ph ph-heart"></i> 默契不错~';
    } else {
        tierLabel = '<i class="ph ph-question"></i> 还需要多了解对方哦';
    }

    const hist2 = getGameHistory();
    updateGameHistory({
        quizPlayed: (hist2.quizPlayed || 0) + 1,
        quizPerfect: (hist2.quizPerfect || 0) + (score >= total ? 1 : 0),
        lastQuizDate: new Date().toISOString(),
        dailyQuizPlayed: (hist2.dailyQuizPlayed || 0) + 1,
    });

    console.log(`${LOG} 默契挑战结束: ${score}/${total}, 奖励: care+${reward.bonusCare} growth+${reward.bonusGrowth}`);

    const html = `
    <div class="tree-page tg-quiz-page" id="tree_page_root">
        <div class="tg-quiz-container tg-quiz-results">
            <div class="tg-quiz-results-header">
                <div class="tg-quiz-results-score">${score}<span class="tg-quiz-results-total">/${total}</span></div>
                <div class="tg-quiz-results-label">${tierLabel}</div>
                <div class="tg-quiz-results-pct">默契度 ${pct}%</div>
            </div>

            <div class="tg-quiz-results-list">
                ${state.results.map((r, i) => `
                    <div class="tg-quiz-results-item ${r.match ? 'match' : 'mismatch'}">
                        <div class="tg-quiz-results-q">${i + 1}. ${esc(r.question)}</div>
                        <div class="tg-quiz-results-answers">
                            <span>你: ${esc(r.playerAnswer)}</span>
                            <span>${esc(charName)}: ${esc(r.aiAnswer)}</span>
                            <i class="fa-solid ${r.match ? 'fa-heart' : 'fa-heart-crack'}"></i>
                        </div>
                    </div>
                `).join('')}
            </div>

            ${reward.bonusCare > 0 || reward.bonusGrowth > 0 ? `
            <div class="tg-quiz-reward-banner">
                <i class="fa-solid fa-gift"></i>
                ${reward.bonusCare > 0 ? `照顾 +${reward.bonusCare}` : ''}
                ${reward.bonusGrowth > 0 ? `成长值 +${reward.bonusGrowth}` : ''}
                ${reward.title ? `· 称号「${esc(reward.title)}」` : ''}
            </div>` : ''}

            <button class="tg-primary-btn" id="tg_quiz_done">
                <i class="fa-solid fa-arrow-left"></i> 返回
            </button>
        </div>
    </div>`;

    openAppInViewport('默契挑战', html, () => {
        // Apply rewards (growth only, no bonus care)
        if (reward.bonusGrowth > 0) {
            addGrowth(reward.bonusGrowth);
        }

        document.getElementById('tg_quiz_done')?.addEventListener('click', () => {
            if (typeof onFinish === 'function') onFinish();
        });
    });
}


// ═══════════════════════════════════════════════════════════════════════
// 3b. 记忆扭蛋 — Gacha Game
// ═══════════════════════════════════════════════════════════════════════

/**
 * Open the gacha mini-game.
 * @param {Function} onFinish
 */
export function openGachaGame(onFinish) {
    bindGlobalGameBackEvent(onFinish);
    renderGachaMachine(onFinish);
}

function renderGachaMachine(onFinish) {
    const hist = getGameHistory();
    const freeRemaining = Math.max(0, DAILY_FREE_GACHA - (hist.dailyGachaUsed || 0));
    const canPull = freeRemaining > 0;

    const html = `
    <div class="tree-page tg-gacha-page" id="tree_page_root">
        <div class="tg-gacha-container">
            <div class="tg-gacha-machine">
                <div class="tg-gacha-dome">
                    <div class="tg-gacha-ball" id="tg_gacha_ball">
                        <i class="fa-solid fa-question"></i>
                    </div>
                    <div class="tg-gacha-ball tg-gacha-ball-bg b1"></div>
                    <div class="tg-gacha-ball tg-gacha-ball-bg b2"></div>
                    <div class="tg-gacha-ball tg-gacha-ball-bg b3"></div>
                </div>
                <div class="tg-gacha-slot"></div>
            </div>

            <div class="tg-gacha-info">
                <span>今日免费: ${freeRemaining}/${DAILY_FREE_GACHA}</span>
            </div>

            <button class="tg-primary-btn tg-gacha-pull-btn" id="tg_gacha_pull" ${!canPull ? 'disabled' : ''}>
                <i class="fa-solid fa-hand-pointer"></i>
                ${canPull ? '扭一下！' : '今日已用完'}
            </button>


        </div>
    </div>`;

    openAppInViewport('记忆扭蛋', html, () => {
        document.getElementById('tg_gacha_pull')?.addEventListener('click', () => handleGachaPull(onFinish));

    });
}

function handleGachaPull(onFinish) {
    const hist = getGameHistory();
    const freeRemaining = Math.max(0, DAILY_FREE_GACHA - (hist.dailyGachaUsed || 0));
    if (freeRemaining <= 0) return;

    // Disable button
    const pullBtn = document.getElementById('tg_gacha_pull');
    if (pullBtn) {
        pullBtn.disabled = true;
        pullBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 扭蛋中...';
    }

    // Determine if pity triggered
    const pityCounter = hist.gachaPityCounter || 0;
    const isPity = pityCounter >= GACHA_PITY_THRESHOLD;

    // Weighted draw
    const item = drawGachaItem(isPity);

    // Update history
    const isAir = item.id === 'air';
    updateGameHistory({
        gachaPlayed: (hist.gachaPlayed || 0) + 1,
        dailyGachaUsed: (hist.dailyGachaUsed || 0) + 1,
        gachaPityCounter: isAir ? pityCounter + 1 : 0,
    });

    // Add to collection
    addToCollection(item.id);

    // Apply effect
    applyGachaEffect(item);

    console.log(`${LOG} 扭蛋: ${item.name} (${item.rarity.name}) pity=${pityCounter}${isPity ? ' [保底]' : ''}`);

    // Animate: ball drop → reveal
    const ball = document.getElementById('tg_gacha_ball');
    if (ball) {
        ball.classList.add('tg-gacha-ball-drop');
    }

    setTimeout(() => {
        renderGachaResult(item, onFinish);
    }, 600);
}

function drawGachaItem(isPity) {
    let pool = [...GACHA_POOL];

    if (isPity) {
        // Exclude pityExclude items (i.e., "air") and commons for pity
        pool = pool.filter(item => !item.pityExclude && item.rarity.id !== 'common');
        if (pool.length === 0) {
            // Fallback: just exclude air
            pool = GACHA_POOL.filter(item => !item.pityExclude);
        }
    }

    // Weighted random
    const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * totalWeight;

    for (const item of pool) {
        roll -= item.weight;
        if (roll <= 0) return item;
    }

    return pool[pool.length - 1]; // fallback
}

function applyGachaEffect(item) {
    if (!item.effect) return;

    switch (item.effect.type) {
        case 'bonusCare': {
            const d = loadTreeData();
            updateTreeState({ bonusCareCount: (d.treeState.bonusCareCount || 0) + item.effect.value });
            break;
        }
        case 'bonusGrowth':
            addGrowth(item.effect.value);
            break;
        case 'storyFragment':
            addStoryFragment(item.effect.value);
            break;
        case 'triggerDialogue':
            // Stage 4: call LLM to generate a sweet dialogue
            _showGachaDialogueOverlay();
            break;
        case 'none':
        default:
            break;
    }
}

function renderGachaResult(item, onFinish) {
    const rarityClass = `rarity-${item.rarity.id}`;

    const html = `
    <div class="tree-page tg-gacha-page" id="tree_page_root">
        <div class="tg-gacha-container tg-gacha-result">
            <div class="tg-gacha-result-ball ${rarityClass}">
                <span class="tg-gacha-result-emoji">${esc(item.emoji)}</span>
            </div>
            <div class="tg-gacha-result-name ${rarityClass}">${esc(item.name)}</div>
            <div class="tg-gacha-result-rarity ${rarityClass}">
                ${item.rarity.label} ${esc(item.rarity.name)}
            </div>
            <div class="tg-gacha-result-desc">${esc(item.description)}</div>

            <div class="tg-gacha-result-actions">
                <button class="tg-primary-btn" id="tg_gacha_again">
                    <i class="fa-solid fa-rotate-right"></i> 再来一次
                </button>
                <button class="tg-secondary-btn" id="tg_gacha_result_back">
                    <i class="fa-solid fa-arrow-left"></i> 返回
                </button>
            </div>
        </div>
    </div>`;

    openAppInViewport('记忆扭蛋', html, () => {
        document.getElementById('tg_gacha_again')?.addEventListener('click', () => renderGachaMachine(onFinish));
        document.getElementById('tg_gacha_result_back')?.addEventListener('click', () => {
            if (typeof onFinish === 'function') onFinish();
        });
    });
}

export function renderGachaCollection(onFinish) {
    const collected = getCollection();
    const fragments = getStoryFragments();
    const totalFragments = GACHA_POOL.filter(i => i.effect?.type === 'storyFragment').length;

    const html = `
    <div class="tree-page tg-gacha-page" id="tree_page_root">
        <div class="tg-gacha-container tg-collection">
            <div class="tg-collection-header">
                <span>收藏图鉴</span>
                <span class="tg-collection-count">${collected.length} / ${GACHA_POOL.length}</span>
            </div>

            <div class="tg-collection-grid">
                ${GACHA_POOL.map(item => {
                    const owned = collected.includes(item.id);
                    return `
                    <div class="tg-collection-item ${owned ? 'owned' : 'locked'} rarity-${item.rarity.id}">
                        <div class="tg-collection-item-icon">${owned ? item.emoji : '？'}</div>
                        <div class="tg-collection-item-name">${owned ? esc(item.name) : '???'}</div>
                    </div>`;
                }).join('')}
            </div>

            ${totalFragments > 0 ? `
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
            </div>` : ''}

            <button class="tg-secondary-btn" id="tg_collection_back">
                <i class="fa-solid fa-arrow-left"></i> 返回扭蛋
            </button>
        </div>
    </div>`;

    openAppInViewport('收藏图鉴', html, () => {
        document.getElementById('tg_collection_back')?.addEventListener('click', () => renderGachaMachine(onFinish));
    });
}


/**
 * Show gacha dialogue overlay — called when "恋人密语" is pulled.
 * Fire-and-forget LLM call with fallback.
 */
async function _showGachaDialogueOverlay() {
    const charName = getCharName();

    // Create overlay immediately with loading state
    const overlay = document.createElement('div');
    overlay.className = 'tg-gacha-dialogue-overlay';
    overlay.innerHTML = `
        <div class="tg-gacha-dialogue-card">
            <div class="tg-gacha-dialogue-header">
                <span class="tg-gacha-dialogue-emoji"><i class="ph ph-envelope-simple"></i></span>
                <span class="tg-gacha-dialogue-title">恋人密语</span>
            </div>
            <div class="tg-gacha-dialogue-content" id="tg_gacha_dialogue_content">
                <i class="fa-solid fa-spinner fa-spin"></i>
                <em>${esc(charName)} 正在写一封小情书…</em>
            </div>
            <div class="tg-gacha-dialogue-dismiss">点击关闭</div>
        </div>`;

    document.body.appendChild(overlay);

    // Call LLM
    try {
        const text = await generateGachaDialogue();
        const contentEl = document.getElementById('tg_gacha_dialogue_content');
        if (contentEl) {
            contentEl.innerHTML = text
                ? `「${esc(text)}」`
                : `「有你在的每一天，都是我最喜欢的日子。」`;
        }
    } catch {
        const contentEl = document.getElementById('tg_gacha_dialogue_content');
        if (contentEl) {
            contentEl.innerHTML = `「有你在的每一天，都是我最喜欢的日子。」`;
        }
    }

    overlay.addEventListener('click', () => overlay.remove());
}

// ═══════════════════════════════════════════════════════════════════════
// 3c. 真心话大冒险 — Truth or Dare
// ═══════════════════════════════════════════════════════════════════════

/**
 * Open the Truth-or-Dare mini-game.
 * @param {Function} onFinish
 */
export function openTodGame(onFinish) {
    bindGlobalGameBackEvent(onFinish);

    // Daily limit check
    const hist = getGameHistory();
    const dailyPlayed = hist.dailyTodPlayed || 0;
    if (dailyPlayed >= DAILY_TOD_MAX) {
        const html = `
        <div class="tree-page tg-tod-page" id="tree_page_root">
            <div class="tg-tod-container" style="text-align:center; padding: 40px 20px;">
                <div style="font-size: 24px; margin-bottom: 16px;"><i class="fa-solid fa-comments"></i></div>
                <div style="margin-bottom: 12px;">今天已经玩过真心话了！</div>
                <div style="font-size: 12px; opacity: 0.6; margin-bottom: 20px;">每天最多 ${DAILY_TOD_MAX} 轮，明天再来吧~</div>
                <button class="tg-primary-btn" id="tg_tod_back_limit">
                    <i class="fa-solid fa-arrow-left"></i> 返回
                </button>
            </div>
        </div>`;
        openAppInViewport('真心话大冒险', html, () => {
            document.getElementById('tg_tod_back_limit')?.addEventListener('click', () => {
                if (typeof onFinish === 'function') onFinish();
            });
        });
        return;
    }

    const halfRounds = Math.ceil(TOD_ROUNDS_PER_GAME / 2);

    // Draw questions from LLM-generated storage only (no builtin fallback)
    let playerQuestions = popTodQuestionsByType('player', halfRounds);
    let aiQuestions = popTodQuestionsByType('ai', TOD_ROUNDS_PER_GAME - halfRounds);

    const totalRounds = playerQuestions.length + aiQuestions.length;

    if (totalRounds === 0) {
        // No questions available at all — show a message
        const html = `
        <div class="tree-page tg-tod-page" id="tree_page_root">
            <div class="tg-tod-container" style="text-align:center; padding: 40px 20px;">
                <div style="font-size: 24px; margin-bottom: 16px;"><i class="fa-solid fa-comments"></i></div>
                <div style="margin-bottom: 12px;">题目已用完，需要生成新题目。</div>
                <div style="font-size: 12px; opacity: 0.6; margin-bottom: 20px;">返回树主页后会自动补充题目</div>
                <button class="tg-primary-btn" id="tg_tod_back_empty">
                    <i class="fa-solid fa-arrow-left"></i> 返回
                </button>
            </div>
        </div>`;
        openAppInViewport('真心话大冒险', html, () => {
            document.getElementById('tg_tod_back_empty')?.addEventListener('click', () => {
                if (typeof onFinish === 'function') onFinish();
            });
        });
        return;
    }

    // Shuffle each pool
    playerQuestions = playerQuestions.sort(() => Math.random() - 0.5);
    aiQuestions = aiQuestions.sort(() => Math.random() - 0.5);

    const state = {
        playerQuestions,    // user 回答的题池
        aiQuestions,        // char 回答的题池
        playerIdx: 0,       // player 题池指针
        aiIdx: 0,           // ai 题池指针
        totalRounds,
        completedRounds: 0,
        isPlayerTurn: Math.random() > 0.5, // random who starts
        chatLog: [],        // { role: 'divider'|'player'|'ai', text: string }
    };

    renderTodRoulette(state, onFinish);
}

function renderTodRoulette(state, onFinish) {
    const charName = getCharName();
    const userName = getPhoneUserName() || '你';
    const currentTurnLabel = state.isPlayerTurn ? esc(userName) : esc(charName);
    const done = state.completedRounds;
    const total = state.totalRounds;

    // Generate slots for the revolver cylinder
    const slots = Array.from({ length: 6 }, (_, i) => {
        const isBullet = i === 0; // one "bullet" in slot 0
        return `<div class="tg-tod-slot ${isBullet ? 'bullet' : 'empty'}" data-slot="${i}"></div>`;
    }).join('');

    const chatLogHTML = _renderChatLogHTML(state.chatLog, charName);

    const html = `
    <div class="tree-page tg-tod-page" id="tree_page_root">
        <div class="tg-tod-container">
            <div class="tg-tod-header">
                <span>进度 ${done}/${total}</span>
                <span class="tg-tod-turn">${currentTurnLabel} 的回合</span>
            </div>

            <div class="tg-tod-roulette-area">
                <div class="tg-tod-cylinder" id="tg_tod_cylinder">
                    ${slots}
                    <div class="tg-tod-cylinder-center">
                        <i class="fa-solid fa-crosshairs"></i>
                    </div>
                </div>
                <div class="tg-tod-pointer">
                    <i class="fa-solid fa-caret-left"></i>
                </div>
            </div>

            <button class="tg-primary-btn tg-tod-fire-btn" id="tg_tod_fire">
                <i class="fa-solid fa-hand-pointer"></i> 开枪！
            </button>

            <button class="tg-secondary-btn" id="tg_tod_quit" style="margin-top: 8px;">
                <i class="fa-solid fa-door-open"></i> 结束游戏
            </button>

            ${chatLogHTML}
        </div>
    </div>`;

    openAppInViewport('真心话大冒险', html, () => {
        // Scroll chat log to bottom
        const logEl = document.getElementById('tg_tod_chat_log');
        if (logEl) logEl.scrollTop = logEl.scrollHeight;

        document.getElementById('tg_tod_fire')?.addEventListener('click', () => handleTodFire(state, onFinish));
        document.getElementById('tg_tod_quit')?.addEventListener('click', () => finishTodGame(state, onFinish));
    });
}

function handleTodFire(state, onFinish) {
    const fireBtn = document.getElementById('tg_tod_fire');
    if (fireBtn) {
        fireBtn.disabled = true;
        fireBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    // Spin the cylinder — random rotation
    const cylinder = document.getElementById('tg_tod_cylinder');
    const randomDeg = 720 + Math.floor(Math.random() * 360); // 2+ full rotations
    if (cylinder) {
        cylinder.style.transition = 'transform 1.2s cubic-bezier(0.33, 1.0, 0.68, 1.0)';
        cylinder.style.transform = `rotate(${randomDeg}deg)`;
    }

    setTimeout(() => {
        // 从对应角色的题池中取题
        const effectiveType = state.isPlayerTurn ? 'player' : 'ai';
        let q;
        if (effectiveType === 'player' && state.playerIdx < state.playerQuestions.length) {
            q = state.playerQuestions[state.playerIdx];
            state.playerIdx++;
        } else if (effectiveType === 'ai' && state.aiIdx < state.aiQuestions.length) {
            q = state.aiQuestions[state.aiIdx];
            state.aiIdx++;
        } else {
            // 当前类型题池用完，从另一个池子取
            const fallbackType = effectiveType === 'player' ? 'ai' : 'player';
            if (fallbackType === 'player' && state.playerIdx < state.playerQuestions.length) {
                q = state.playerQuestions[state.playerIdx];
                state.playerIdx++;
            } else if (fallbackType === 'ai' && state.aiIdx < state.aiQuestions.length) {
                q = state.aiQuestions[state.aiIdx];
                state.aiIdx++;
            }
            // 注意：fallback 时 effectiveType 要跟着题目的 type 走
            if (q) {
                renderTodQuestion(state, q, q.type || fallbackType, onFinish);
                return;
            }
        }

        if (q) {
            renderTodQuestion(state, q, effectiveType, onFinish);
        } else {
            // 全部用完，结束游戏
            finishTodGame(state, onFinish);
        }
    }, 1400);
}


/**
 * Render chat log bubbles HTML from state.chatLog
 */
function _renderChatLogHTML(chatLog, charName) {
    if (!chatLog || chatLog.length === 0) return '';
    const bubbles = chatLog.map(entry => {
        if (entry.role === 'divider') {
            return `<div class="tg-tod-chat-divider"><i class="fa-solid fa-comment-dots"></i> ${esc(entry.text)}</div>`;
        }
        const isPlayer = entry.role === 'player';
        const label = isPlayer ? '你' : esc(charName);
        return `
            <div class="tg-tod-chat-bubble ${entry.role}">
                <div class="tg-tod-chat-bubble-name">${label}</div>
                <div class="tg-tod-chat-bubble-text">${esc(entry.text)}</div>
            </div>`;
    }).join('');
    return `
        <div class="tg-tod-chat-log" id="tg_tod_chat_log">
            <div class="tg-tod-chat-log-title"><i class="fa-solid fa-clock-rotate-left"></i> 本局对话</div>
            ${bubbles}
        </div>`;
}

function renderTodQuestion(state, question, targetType, onFinish) {
    const charName = getCharName();
    const userName = getPhoneUserName() || '你';
    const isForPlayer = targetType === 'player';
    const targetLabel = isForPlayer ? esc(userName) : esc(charName);

    // Add question as divider in chat log
    state.chatLog.push({ role: 'divider', text: question.question });

    const chatLogHTML = _renderChatLogHTML(state.chatLog, charName);

    const html = `
    <div class="tree-page tg-tod-page" id="tree_page_root">
        <div class="tg-tod-container tg-tod-question-view">
            <div class="tg-tod-hit-banner">
                <i class="fa-solid fa-bullseye"></i>
                <span>${targetLabel} 中招了！</span>
            </div>

            <div class="tg-tod-question-card">
                <div class="tg-tod-question-label">真心话</div>
                <div class="tg-tod-question-text">${esc(question.question)}</div>
            </div>

            ${isForPlayer ? `
                <div class="tg-tod-input-area">
                    <textarea class="tg-tod-textarea" id="tg_tod_player_input"
                        placeholder="写下你的回答…"
                        rows="3" maxlength="500"></textarea>
                </div>
                <div class="tg-tod-reaction-area" id="tg_tod_reaction_area" style="display:none;"></div>
                <button class="tg-primary-btn" id="tg_tod_submit">
                    <i class="fa-solid fa-paper-plane"></i> 提交回答
                </button>
            ` : `
                <div class="tg-tod-ai-response" id="tg_tod_ai_response">
                    <div class="tg-tod-ai-avatar">
                        <i class="fa-solid fa-heart"></i>
                    </div>
                    <div class="tg-tod-ai-text" id="tg_tod_ai_text">
                        <div class="tg-tod-ai-typing">
                            <span></span><span></span><span></span>
                        </div>
                        <i>${esc(charName)} 正在认真思考中…</i>
                    </div>
                </div>
                <button class="tg-primary-btn" id="tg_tod_answered" disabled>
                    <i class="fa-solid fa-spinner fa-spin"></i> 等待回答中…
                </button>
            `}

            ${chatLogHTML}
        </div>
    </div>`;

    openAppInViewport('真心话大冒险', html, () => {
        // Scroll chat log to bottom
        const logEl = document.getElementById('tg_tod_chat_log');
        if (logEl) logEl.scrollTop = logEl.scrollHeight;

        if (isForPlayer) {
            // ── Player turn: textarea + submit → LLM reaction ──
            const submitBtn = document.getElementById('tg_tod_submit');
            const textarea = document.getElementById('tg_tod_player_input');

            submitBtn?.addEventListener('click', async () => {
                if (submitBtn._submitted) return; // prevent re-entry when repurposed as "next round"
                const answer = textarea?.value?.trim();
                if (!answer) {
                    // Shake the textarea
                    textarea?.classList.add('tg-tod-shake');
                    setTimeout(() => textarea?.classList.remove('tg-tod-shake'), 500);
                    return;
                }
                submitBtn._submitted = true;

                // Disable input
                if (textarea) textarea.disabled = true;
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 等待反应中…';

                // Add player answer to chat log
                state.chatLog.push({ role: 'player', text: answer });

                // Show reaction area with loading
                const reactionArea = document.getElementById('tg_tod_reaction_area');
                if (reactionArea) {
                    reactionArea.style.display = 'flex';
                    reactionArea.innerHTML = `
                        <div class="tg-tod-ai-avatar">
                            <i class="fa-solid fa-heart"></i>
                        </div>
                        <div class="tg-tod-ai-text" id="tg_tod_reaction_text">
                            <div class="tg-tod-ai-typing">
                                <span></span><span></span><span></span>
                            </div>
                            <i>${esc(charName)} 正在思考怎么回应…</i>
                        </div>`;
                }

                // Call LLM for reaction
                const reaction = await generateTodReaction(question.question, answer);
                const reactionText = reaction || `（看着你的回答，${charName}露出了一个意味深长的微笑）`;

                // Add AI reaction to chat log
                state.chatLog.push({ role: 'ai', text: reactionText });

                // Display reaction
                const textEl = document.getElementById('tg_tod_reaction_text');
                if (textEl) {
                    textEl.innerHTML = esc(reactionText);
                }

                // Change button to "next round"
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fa-solid fa-arrow-right"></i> 下一轮';
                submitBtn.onclick = () => {
                    state.completedRounds++;
                    state.isPlayerTurn = !state.isPlayerTurn;
                    const totalUsed = state.playerIdx + state.aiIdx;
                    if (totalUsed >= state.totalRounds) {
                        finishTodGame(state, onFinish);
                    } else {
                        renderTodRoulette(state, onFinish);
                    }
                };
            });
        } else {
            // ── AI turn: LLM answer ──
            generateTodAnswer(question.question).then(answer => {
                const answerText = answer || `（害羞地捂脸）这个问题太难了…让我想想…`;

                // Add AI answer to chat log
                state.chatLog.push({ role: 'ai', text: answerText });

                const textEl = document.getElementById('tg_tod_ai_text');
                if (textEl) {
                    textEl.innerHTML = esc(answerText);
                }
                const btn = document.getElementById('tg_tod_answered');
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-solid fa-arrow-right"></i> 下一轮';
                }
            });

            document.getElementById('tg_tod_answered')?.addEventListener('click', () => {
                state.completedRounds++;
                state.isPlayerTurn = !state.isPlayerTurn;
                const totalUsed = state.playerIdx + state.aiIdx;
                if (totalUsed >= state.totalRounds) {
                    finishTodGame(state, onFinish);
                } else {
                    renderTodRoulette(state, onFinish);
                }
            });
        }
    });
}

function finishTodGame(state, onFinish) {
    const charName = getCharName();
    const completed = state.completedRounds;
    const reward = completed > 0 ? { ...GAME_REWARDS.tod.complete } : { bonusCare: 0, bonusGrowth: 0 };

    const hist2 = getGameHistory();
    updateGameHistory({
        todPlayed: (hist2.todPlayed || 0) + 1,
        lastTodDate: new Date().toISOString(),
        dailyTodPlayed: (hist2.dailyTodPlayed || 0) + 1,
    });

    console.log(`${LOG} 真心话结束: ${completed} 轮完成, 奖励: care+${reward.bonusCare} growth+${reward.bonusGrowth}`);

    const chatLogHTML = _renderChatLogHTML(state.chatLog, charName);

    const html = `
    <div class="tree-page tg-tod-page" id="tree_page_root">
        <div class="tg-tod-container tg-tod-finish">
            <div class="tg-tod-finish-icon">
                <i class="fa-solid fa-face-laugh-beam"></i>
            </div>
            <div class="tg-tod-finish-title">游戏结束！</div>
            <div class="tg-tod-finish-sub">
                和 ${esc(charName)} 完成了 ${completed} 轮真心话
            </div>

            ${reward.bonusCare > 0 || reward.bonusGrowth > 0 ? `
            <div class="tg-quiz-reward-banner">
                <i class="fa-solid fa-gift"></i>
                ${reward.bonusCare > 0 ? `照顾 +${reward.bonusCare}` : ''}
                ${reward.bonusGrowth > 0 ? `成长值 +${reward.bonusGrowth}` : ''}
            </div>` : `
            <div class="tg-tod-no-reward">未完成足够回合，没有获得奖励</div>
            `}

            <button class="tg-primary-btn" id="tg_tod_done">
                <i class="fa-solid fa-arrow-left"></i> 返回
            </button>

            ${chatLogHTML}
        </div>
    </div>`;

    openAppInViewport('真心话大冒险', html, () => {
        // Scroll chat log to bottom
        const logEl = document.getElementById('tg_tod_chat_log');
        if (logEl) logEl.scrollTop = logEl.scrollHeight;

        // Apply rewards (growth only, no bonus care)
        if (reward.bonusGrowth > 0) {
            addGrowth(reward.bonusGrowth);
        }

        document.getElementById('tg_tod_done')?.addEventListener('click', () => {
            if (typeof onFinish === 'function') onFinish();
        });
    });
}

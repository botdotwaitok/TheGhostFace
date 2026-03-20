// modules/phone/dnd/dndCreation.js — Character Creation & Partner Generation
// Extracted from dndApp.js: Race/Class/Stat selection wizard + LLM-powered partner generation.

import { openAppInViewport } from '../phoneController.js';
import { getPhoneCharInfo, getPhoneUserName } from '../phoneContext.js';
import { callPhoneLLM } from '../../api.js';
import {
    savePlayerCharacter, savePartnerCharacter,
    getPlayerCharacter, saveDndData, loadDndData,
} from './dndStorage.js';
import {
    RACES, CLASSES, ABILITY_NAMES, ABILITY_ORDER,
    createCharacter,
} from './dndCharacter.js';
import {
    STANDARD_ARRAY, abilityModifier,
} from './dndDice.js';
import { buildPartnerCharGenPrompt } from './dndPromptBuilder.js';
import {
    esc, setCurrentView, buildCharCardHtml,
} from './dndUI.js';
import { getCharacterDerived } from './dndCharacter.js';

const DND_LOG = '[D&D]';

// ═══════════════════════════════════════════════════════════════════════
// Creation State
// ═══════════════════════════════════════════════════════════════════════

let _creationState = { step: 'race', raceId: null, classId: null, stats: null, method: null };

// ═══════════════════════════════════════════════════════════════════════
// Character Creation Entry
// ═══════════════════════════════════════════════════════════════════════

/**
 * Show character creation wizard.
 * @param {Function} onComplete - called after both player + partner are created (usually showMainPage)
 */
let _onCreationComplete = null;

export function showCharacterCreation(onComplete) {
    _onCreationComplete = onComplete;
    setCurrentView('creation');
    _creationState = { step: 'race', raceId: null, classId: null, stats: null, method: null };
    _renderCreationStep();
}

function _renderCreationStep() {
    const userName = getPhoneUserName();
    let html = '';

    if (_creationState.step === 'race') {
        html = _buildRaceSelection();
    } else if (_creationState.step === 'class') {
        html = _buildClassSelection();
    } else if (_creationState.step === 'stats') {
        html = _buildStatAllocation();
    } else if (_creationState.step === 'confirm') {
        html = _buildCreationConfirm();
    }

    const wrappedHtml = `<div class="dnd-page" id="dnd_root"><div class="dnd-creation">${html}</div></div>`;

    openAppInViewport('D&D - 创建角色', wrappedHtml, () => {
        _bindCreationEvents();
        _refreshAllStatRows();

        const backBtnSpan = document.getElementById('phone_app_back_btn')?.querySelector('span');
        if (backBtnSpan) {
            backBtnSpan.textContent = _creationState.step === 'race' ? '返回' : '上一步';
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Race Selection
// ═══════════════════════════════════════════════════════════════════════

function _buildRaceSelection() {
    if (_creationState.raceIndex === undefined) {
        _creationState.raceIndex = 0;
        _creationState.raceId = RACES[0].id;
    }
    const r = RACES[_creationState.raceIndex];

    const bonusHtml = Object.entries(r.bonuses)
        .map(([k, v]) => `<span class="dnd-tag dnd-tag--gold">${ABILITY_NAMES[k].name}+${v}</span>`)
        .join('');

    const traitsHtml = (r.traits || [])
        .map(t => `<div class="dnd-race-trait"><i class="ph ph-check-circle"></i> ${t}</div>`)
        .join('');

    const dotsHtml = RACES.map((_, i) =>
        `<div class="dnd-carousel-dot ${i === _creationState.raceIndex ? 'active' : ''}" data-index="${i}"></div>`
    ).join('');

    return `
        <div class="dnd-creation-title">选择你的种族</div>
        <div class="dnd-creation-subtitle">左右滑动浏览不同种族</div>

        <div class="dnd-carousel-container" id="dnd_race_carousel">
            <button class="dnd-carousel-btn left" id="dnd_race_prev"><i class="ph ph-caret-left"></i></button>

            <div class="dnd-race-detail-card">
                <div class="dnd-race-header">
                    <div class="dnd-race-icon-large"><i class="ph ${r.icon}"></i></div>
                    <div class="dnd-race-titles">
                        <div class="dnd-race-name">${r.name}</div>
                        <div class="dnd-race-name-en">${r.nameEn}</div>
                    </div>
                </div>

                <div class="dnd-race-section">
                    <div class="dnd-race-section-title">属性加成</div>
                    <div class="dnd-race-bonuses">${bonusHtml}</div>
                </div>

                <div class="dnd-race-section">
                    <div class="dnd-race-section-title">种族特性</div>
                    <div class="dnd-race-traits">${traitsHtml}</div>
                </div>

                <div class="dnd-race-section">
                    <div class="dnd-race-section-title">关于</div>
                    <div class="dnd-race-desc">${r.description}</div>
                </div>
            </div>

            <button class="dnd-carousel-btn right" id="dnd_race_next"><i class="ph ph-caret-right"></i></button>
        </div>

        <div class="dnd-carousel-dots">${dotsHtml}</div>

        <button class="dnd-confirm-btn" id="dnd_creation_next">
            选择 ${r.name}并继续 <i class="ph ph-arrow-right"></i>
        </button>`;
}

// ═══════════════════════════════════════════════════════════════════════
// Class Selection
// ═══════════════════════════════════════════════════════════════════════

function _buildClassSelection() {
    if (_creationState.classIndex === undefined) {
        _creationState.classIndex = 0;
        _creationState.classId = CLASSES[0].id;
    }
    const c = CLASSES[_creationState.classIndex];

    const statsHtml = c.primaryAbility
        .map(a => `<span class="dnd-tag dnd-tag--gold">${ABILITY_NAMES[a].name}</span>`)
        .join('');

    const featuresHtml = (c.features || [])
        .map(f => `<div class="dnd-race-trait"><i class="ph ph-star"></i> ${f}</div>`)
        .join('');

    const dotsHtml = CLASSES.map((_, i) =>
        `<div class="dnd-carousel-dot ${i === _creationState.classIndex ? 'active' : ''}" data-index="${i}"></div>`
    ).join('');

    return `
        <div class="dnd-creation-title">选择你的职业</div>
        <div class="dnd-creation-subtitle">左右滑动浏览不同职业</div>

        <div class="dnd-carousel-container" id="dnd_class_carousel">
            <button class="dnd-carousel-btn left" id="dnd_class_prev"><i class="ph ph-caret-left"></i></button>

            <div class="dnd-race-detail-card">
                <div class="dnd-race-header">
                    <div class="dnd-race-icon-large"><i class="ph ${c.icon}"></i></div>
                    <div class="dnd-race-titles">
                        <div class="dnd-race-name">${c.name}</div>
                        <div class="dnd-race-name-en">${c.nameEn}</div>
                    </div>
                </div>

                <div class="dnd-race-section">
                    <div class="dnd-race-section-title">核心属性</div>
                    <div class="dnd-race-bonuses">${statsHtml}</div>
                </div>

                <div class="dnd-race-section">
                    <div class="dnd-race-section-title">职业特性</div>
                    <div class="dnd-race-traits">${featuresHtml}</div>
                </div>

                <div class="dnd-race-section">
                    <div class="dnd-race-section-title">防具熟练</div>
                    <div class="dnd-race-desc"><i class="ph ph-shield"></i> ${c.armorProf || '无'}</div>
                </div>

                <div class="dnd-race-section">
                    <div class="dnd-race-section-title">关于</div>
                    <div class="dnd-race-desc">${c.description}</div>
                </div>
            </div>

            <button class="dnd-carousel-btn right" id="dnd_class_next"><i class="ph ph-caret-right"></i></button>
        </div>

        <div class="dnd-carousel-dots">${dotsHtml}</div>

        <button class="dnd-confirm-btn" id="dnd_creation_next">
            选择 ${c.name}并继续 <i class="ph ph-arrow-right"></i>
        </button>`;
}

// ═══════════════════════════════════════════════════════════════════════
// Stat Allocation
// ═══════════════════════════════════════════════════════════════════════

function _buildStatAllocation() {
    const race = RACES.find(r => r.id === _creationState.raceId);
    const cls = CLASSES.find(c => c.id === _creationState.classId);

    if (!_creationState.stats) {
        _creationState.stats = {};
        _creationState.method = 'standard';
        const suggested = cls.suggestedStats || ABILITY_ORDER;
        suggested.forEach((ability, i) => {
            _creationState.stats[ability] = STANDARD_ARRAY[i];
        });
    }

    const rows = ABILITY_ORDER.map(ability => {
        const baseVal = _creationState.stats[ability] || 10;
        const raceBonus = race?.bonuses?.[ability] || 0;
        const finalVal = baseVal + raceBonus;
        const mod = abilityModifier(finalVal);
        const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
        const abilityInfo = ABILITY_NAMES[ability];

        return `
            <div class="dnd-stat-row" data-ability="${ability}">
                <div class="dnd-stat-label">
                    <i class="ph ${abilityInfo.icon}"></i> ${abilityInfo.name}
                </div>
                <div class="dnd-stat-stepper">
                    <button class="dnd-stepper-btn" data-ability="${ability}" data-dir="-1"><i class="ph ph-minus"></i></button>
                    <div class="dnd-stepper-value" data-ability="${ability}">${baseVal}</div>
                    <button class="dnd-stepper-btn" data-ability="${ability}" data-dir="1"><i class="ph ph-plus"></i></button>
                </div>
                <div class="dnd-stat-final">
                    <div class="dnd-stat-value">${finalVal}</div>
                    <div class="dnd-stat-mod">${modStr}</div>
                </div>
            </div>`;
    }).join('');

    return `
        <div class="dnd-creation-title">分配属性值</div>
        <div class="dnd-creation-subtitle">
            标准数组：${STANDARD_ARRAY.join(', ')}
            ${race?.name ? ` | ${race.name}加成：${Object.entries(race.bonuses).map(([k, v]) => `${ABILITY_NAMES[k]?.name}+${v}`).join(' ')}` : ''}
        </div>
        ${rows}
        <button class="dnd-confirm-btn" id="dnd_creation_next">
            下一步：确认角色 <i class="ph ph-arrow-right"></i>
        </button>`;
}

function _refreshAllStatRows() {
    if (!_creationState.stats) return;
    const race = RACES.find(r => r.id === _creationState.raceId);
    ABILITY_ORDER.forEach(ability => {
        const baseVal = _creationState.stats[ability];
        const raceBonus = race?.bonuses?.[ability] || 0;
        const finalVal = baseVal + raceBonus;
        const mod = abilityModifier(finalVal);
        const modStr = mod >= 0 ? `+${mod}` : `${mod}`;

        const stepperVal = document.querySelector(`.dnd-stepper-value[data-ability="${ability}"]`);
        if (stepperVal) stepperVal.textContent = baseVal;

        const row = document.querySelector(`.dnd-stat-row[data-ability="${ability}"]`);
        if (row) {
            row.querySelector('.dnd-stat-value').textContent = finalVal;
            row.querySelector('.dnd-stat-mod').textContent = modStr;
        }

        const sorted = [...STANDARD_ARRAY].sort((a, b) => a - b);
        const minusBtn = document.querySelector(`.dnd-stepper-btn[data-ability="${ability}"][data-dir="-1"]`);
        const plusBtn = document.querySelector(`.dnd-stepper-btn[data-ability="${ability}"][data-dir="1"]`);
        if (minusBtn) minusBtn.disabled = baseVal <= sorted[0];
        if (plusBtn) plusBtn.disabled = baseVal >= sorted[sorted.length - 1];
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Confirm & Finalize
// ═══════════════════════════════════════════════════════════════════════

function _buildCreationConfirm() {
    const race = RACES.find(r => r.id === _creationState.raceId);
    const cls = CLASSES.find(c => c.id === _creationState.classId);
    const userName = getPhoneUserName();

    const previewChar = createCharacter({
        name: userName,
        raceId: _creationState.raceId,
        classId: _creationState.classId,
        baseStats: _creationState.stats,
        proficientSkills: cls.skillChoices.from.slice(0, cls.skillChoices.count),
    });

    const derived = getCharacterDerived(previewChar);

    return `
        <div class="dnd-creation-title">确认你的角色</div>
        ${buildCharCardHtml(previewChar, derived, userName)}
        <button class="dnd-confirm-btn" id="dnd_creation_confirm">
            <i class="ph ph-check"></i> 确认创建
        </button>`;
}

// ═══════════════════════════════════════════════════════════════════════
// Event Binding
// ═══════════════════════════════════════════════════════════════════════

function _bindCreationEvents() {
    // Race Carousel
    document.getElementById('dnd_race_prev')?.addEventListener('click', (e) => {
        e.stopPropagation();
        _creationState.raceIndex = (_creationState.raceIndex - 1 + RACES.length) % RACES.length;
        _creationState.raceId = RACES[_creationState.raceIndex].id;
        _renderCreationStep();
    });

    document.getElementById('dnd_race_next')?.addEventListener('click', (e) => {
        e.stopPropagation();
        _creationState.raceIndex = (_creationState.raceIndex + 1) % RACES.length;
        _creationState.raceId = RACES[_creationState.raceIndex].id;
        _renderCreationStep();
    });

    // Touch swipe for Race Carousel
    const raceCarousel = document.getElementById('dnd_race_carousel');
    if (raceCarousel) {
        let startX = 0;
        raceCarousel.addEventListener('touchstart', (e) => {
            startX = e.changedTouches[0].screenX;
        }, { passive: true });
        raceCarousel.addEventListener('touchend', (e) => {
            const endX = e.changedTouches[0].screenX;
            if (endX < startX - 40) {
                _creationState.raceIndex = (_creationState.raceIndex + 1) % RACES.length;
                _creationState.raceId = RACES[_creationState.raceIndex].id;
                _renderCreationStep();
            } else if (endX > startX + 40) {
                _creationState.raceIndex = (_creationState.raceIndex - 1 + RACES.length) % RACES.length;
                _creationState.raceId = RACES[_creationState.raceIndex].id;
                _renderCreationStep();
            }
        }, { passive: true });
    }

    // Clickable Race Dots
    document.querySelectorAll('#dnd_race_carousel ~ .dnd-carousel-dots .dnd-carousel-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(dot.dataset.index);
            if (!isNaN(idx) && idx !== _creationState.raceIndex) {
                _creationState.raceIndex = idx;
                _creationState.raceId = RACES[idx].id;
                _renderCreationStep();
            }
        });
    });

    // Class Carousel
    document.getElementById('dnd_class_prev')?.addEventListener('click', (e) => {
        e.stopPropagation();
        _creationState.classIndex = (_creationState.classIndex - 1 + CLASSES.length) % CLASSES.length;
        _creationState.classId = CLASSES[_creationState.classIndex].id;
        _renderCreationStep();
    });

    document.getElementById('dnd_class_next')?.addEventListener('click', (e) => {
        e.stopPropagation();
        _creationState.classIndex = (_creationState.classIndex + 1) % CLASSES.length;
        _creationState.classId = CLASSES[_creationState.classIndex].id;
        _renderCreationStep();
    });

    // Touch swipe for Class Carousel
    const classCarousel = document.getElementById('dnd_class_carousel');
    if (classCarousel) {
        let startX = 0;
        classCarousel.addEventListener('touchstart', (e) => {
            startX = e.changedTouches[0].screenX;
        }, { passive: true });
        classCarousel.addEventListener('touchend', (e) => {
            const endX = e.changedTouches[0].screenX;
            if (endX < startX - 40) {
                _creationState.classIndex = (_creationState.classIndex + 1) % CLASSES.length;
                _creationState.classId = CLASSES[_creationState.classIndex].id;
                _renderCreationStep();
            } else if (endX > startX + 40) {
                _creationState.classIndex = (_creationState.classIndex - 1 + CLASSES.length) % CLASSES.length;
                _creationState.classId = CLASSES[_creationState.classIndex].id;
                _renderCreationStep();
            }
        }, { passive: true });
    }

    // Clickable Class Dots
    document.querySelectorAll('#dnd_class_carousel ~ .dnd-carousel-dots .dnd-carousel-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(dot.dataset.index);
            if (!isNaN(idx) && idx !== _creationState.classIndex) {
                _creationState.classIndex = idx;
                _creationState.classId = CLASSES[idx].id;
                _renderCreationStep();
            }
        });
    });

    // Stat stepper buttons
    document.querySelectorAll('.dnd-stepper-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const ability = btn.dataset.ability;
            const dir = parseInt(btn.dataset.dir);
            const currentVal = _creationState.stats[ability];

            const sorted = [...STANDARD_ARRAY].sort((a, b) => a - b);
            const currentIdx = sorted.indexOf(currentVal);
            const targetIdx = currentIdx + dir;
            if (targetIdx < 0 || targetIdx >= sorted.length) return;

            const targetVal = sorted[targetIdx];
            const swapAbility = ABILITY_ORDER.find(a => a !== ability && _creationState.stats[a] === targetVal);
            if (!swapAbility) return;

            _creationState.stats[ability] = targetVal;
            _creationState.stats[swapAbility] = currentVal;
            _refreshAllStatRows();
        });
    });

    // Next button
    document.getElementById('dnd_creation_next')?.addEventListener('click', () => {
        if (_creationState.step === 'race' && _creationState.raceId) {
            _creationState.step = 'class';
        } else if (_creationState.step === 'class' && _creationState.classId) {
            _creationState.step = 'stats';
        } else if (_creationState.step === 'stats') {
            _creationState.step = 'confirm';
        }
        _renderCreationStep();
    });

    // Confirm creation
    document.getElementById('dnd_creation_confirm')?.addEventListener('click', () => {
        _finalizeCharacterCreation();
    });
}

async function _finalizeCharacterCreation() {
    const userName = getPhoneUserName();
    const cls = CLASSES.find(c => c.id === _creationState.classId);

    const playerChar = createCharacter({
        name: userName,
        raceId: _creationState.raceId,
        classId: _creationState.classId,
        baseStats: _creationState.stats,
        proficientSkills: cls.skillChoices.from.slice(0, cls.skillChoices.count),
    });

    savePlayerCharacter(playerChar);
    console.log(`${DND_LOG} Player character created:`, playerChar.race, playerChar.class);

    showPartnerGeneration(_onCreationComplete);
}

// ═══════════════════════════════════════════════════════════════════════
// Partner Character Generation — with thinking display
// ═══════════════════════════════════════════════════════════════════════

export async function showPartnerGeneration(onComplete) {
    setCurrentView('partnerGen');
    const charName = getPhoneCharInfo()?.name || '角色';

    const html = `
    <div class="dnd-page" id="dnd_root">
        <div class="dnd-partner-gen-container">
            <div class="dnd-partner-gen-loading" id="dnd_partner_loading">
                <i class="ph ph-book-open-text"></i>
                <span>${esc(charName)}正在翻阅《玩家手册》...</span>
            </div>
            <div class="dnd-partner-thinking" id="dnd_partner_thinking" style="display:none">
                <div class="dnd-thinking-bubble">
                    <div class="dnd-thinking-name">${esc(charName)}的思考</div>
                    <div class="dnd-thinking-text" id="dnd_thinking_text"></div>
                </div>
                <div class="dnd-thinking-result" id="dnd_thinking_result" style="display:none">
                </div>
                <button class="dnd-confirm-btn" id="dnd_partner_confirm" style="display:none">
                    <i class="ph ph-check"></i> 好的，出发！
                </button>
            </div>
        </div>
    </div>`;

    openAppInViewport('D&D', html, () => { });

    try {
        const playerChar = getPlayerCharacter();
        const { system, user } = await buildPartnerCharGenPrompt(playerChar);
        const result = await callPhoneLLM(system, user);

        let raceId = 'human', classId = 'cleric', thinking = '', playerComment = '';
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.raceId && RACES.find(r => r.id === parsed.raceId)) raceId = parsed.raceId;
                if (parsed.classId && CLASSES.find(c => c.id === parsed.classId)) classId = parsed.classId;
                if (parsed.thinking) thinking = parsed.thinking.replace(/\*\*/g, '');
                if (parsed.playerComment) playerComment = parsed.playerComment.replace(/\*\*/g, '');
            } catch (e) { /* use defaults */ }
        }

        const loadingEl = document.getElementById('dnd_partner_loading');
        const thinkingEl = document.getElementById('dnd_partner_thinking');
        const thinkingTextEl = document.getElementById('dnd_thinking_text');
        const resultEl = document.getElementById('dnd_thinking_result');
        const confirmBtn = document.getElementById('dnd_partner_confirm');

        if (loadingEl) loadingEl.style.display = 'none';
        if (thinkingEl) thinkingEl.style.display = 'block';
        if (thinkingTextEl) thinkingTextEl.textContent = thinking || `嗯...我觉得${RACES.find(r => r.id === raceId)?.name || ''}${CLASSES.find(c => c.id === classId)?.name || ''}很适合我！`;

        const race = RACES.find(r => r.id === raceId);
        const cls = CLASSES.find(c => c.id === classId);

        setTimeout(() => {
            if (resultEl) {
                resultEl.innerHTML = `
                    <div class="dnd-thinking-result-card">
                        <div class="dnd-thinking-result-header">
                            <div class="dnd-race-icon-large"><i class="ph ${race?.icon || 'ph-user'}"></i></div>
                            <div class="dnd-race-titles">
                                <div class="dnd-race-name">${esc(race?.name || '???')} · ${esc(cls?.name || '???')}</div>
                                <div class="dnd-race-name-en">${esc(race?.nameEn || '')} ${esc(cls?.nameEn || '')}</div>
                            </div>
                        </div>
                        <div class="dnd-thinking-result-traits">
                            ${(race?.traits || []).map(t => `<div class="dnd-race-trait"><i class="ph ph-check-circle"></i> ${t}</div>`).join('')}
                        </div>
                        <div class="dnd-thinking-result-traits">
                            ${(cls?.features || []).map(f => `<div class="dnd-race-trait"><i class="ph ph-star"></i> ${f}</div>`).join('')}
                        </div>
                    </div>`;
                resultEl.style.display = 'block';
            }
            if (playerComment && thinkingEl) {
                const commentEl = document.createElement('div');
                commentEl.className = 'dnd-player-comment';
                commentEl.innerHTML = `
                    <div class="dnd-comment-label">${esc(charName)}对你的评价</div>
                    <div class="dnd-comment-text">${esc(playerComment)}</div>`;
                const confirmBtn2 = document.getElementById('dnd_partner_confirm');
                if (confirmBtn2) thinkingEl.insertBefore(commentEl, confirmBtn2);
            }
            if (confirmBtn) confirmBtn.style.display = 'block';
        }, 800);

        const _doConfirm = () => {
            const baseStats = {};
            const suggested = cls?.suggestedStats || ABILITY_ORDER;
            suggested.forEach((ability, i) => {
                baseStats[ability] = STANDARD_ARRAY[i];
            });

            const partnerChar = createCharacter({
                name: charName,
                raceId,
                classId,
                baseStats,
                proficientSkills: cls?.skillChoices?.from?.slice(0, cls.skillChoices.count) || [],
            });

            savePartnerCharacter(partnerChar);
            console.log(`${DND_LOG} Partner character created:`, raceId, classId);
            if (onComplete) onComplete();
        };

        document.getElementById('dnd_root')?.addEventListener('click', (e) => {
            if (e.target.closest('#dnd_partner_confirm')) _doConfirm();
        });

    } catch (err) {
        console.error(`${DND_LOG} Partner generation failed:`, err);
        const partnerChar = createCharacter({
            name: charName,
            raceId: 'human',
            classId: 'cleric',
            baseStats: { STR: 12, DEX: 10, CON: 14, INT: 8, WIS: 15, CHA: 13 },
            proficientSkills: ['insight', 'medicine'],
        });
        savePartnerCharacter(partnerChar);
        if (onComplete) onComplete();
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Back Navigation Helper (used by dndApp.js)
// ═══════════════════════════════════════════════════════════════════════

export function getCreationState() {
    return _creationState;
}

export function setCreationStep(step) {
    _creationState.step = step;
    _renderCreationStep();
}

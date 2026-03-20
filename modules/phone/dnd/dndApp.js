// modules/phone/dnd/dndApp.js — D&D App Main Entry (Coordinator)
// Core game loop: Campaign selection → Character creation → Adventure → Resolution.
// Delegates to: dndCreation, dndCombatUI, dndExploration, dndUI.

import { openAppInViewport } from '../phoneController.js';
import { getPhoneCharInfo, getPhoneUserName } from '../phoneContext.js';
import { callPhoneLLM } from '../../api.js';
import {
    loadDndData, saveDndData, savePlayerCharacter, savePartnerCharacter,
    getPlayerCharacter, getPartnerCharacter, hasCharacters,
    startRun, getCurrentRun, updateCurrentRun, appendNarrative, flushNarrative,
    advanceRoom, updateHP, useItem, addLoot, endRun,
    initDndDataFromServer, resetDndData,
    setCombatState, getCombatState, setInCombat,
    getNarrativeContext, addRoomSummary,
} from './dndStorage.js';
import {
    RACES, CLASSES, ABILITY_NAMES, ABILITY_ORDER, SKILLS,
    createCharacter, getCharacterDerived, getProficiencyBonus,
    canLevelUp, getXpForNextLevel, levelUp,
    getCombatSpells, getClassSpells, isPreparedCaster, getPreparedSpellCount,
    SPELL_LIST, SHOP_ITEMS, getShopItemName, consumeSpellSlot,
    getItemInfo,
    CLASS_ABILITIES, getAvailableAbilities, getAbilityUsesRemaining,
} from './dndCharacter.js';
import {
    roll, abilityCheck, attackRoll, damageRoll, initiativeRoll,
    deathSavingThrow, generateAbilityScores, STANDARD_ARRAY, abilityModifier,
} from './dndDice.js';
import {
    CAMPAIGNS, getCampaignById, pickRandomRoomType, pickRandomEnemy, pickRandomLoot,
    pickRandomTrap, pickRandomNPC,
} from './dndCampaigns.js';
import {
    buildDMSystemPrompt, buildEnterRoomPrompt, buildActionResultPrompt,
    buildCombatAttackPrompt, buildConclusionPrompt,
    buildPartnerCharGenPrompt, buildCustomActionPrompt,
    buildCombatRoomPrompt, buildRoomSummaryPrompt,
    buildSpellCastPrompt, buildAbilityUsePrompt,
    buildTrapRoomPrompt, buildTrapResultPrompt,
    buildNPCEncounterPrompt, buildNPCInteractionResultPrompt,
    buildTreasureRoomPrompt, buildTreasureResultPrompt,
    buildRestRoomPrompt, buildRestSearchResultPrompt,
} from './dndPromptBuilder.js';
import {
    initCombat, getCurrentTurnInfo, advanceTurn,
    processPlayerAttack, processEnemyAttack, processPartnerAttack,
    processPartnerHeal, decidePartnerAction, processDeathSave,
    processUseItem, isCombatOver, getCombatSummary, getInitiativeSummary,
    processPlayerSpell, processPartnerSpell, pickPartnerSpell,
    processClassAbility, processDivineSmite,
} from './dndCombat.js';

// ── New module imports ──
import {
    esc, setActions, refreshNarrative, scrollNarrativeToBottom,
    refreshHPBars, refreshRoomIndicator, showRerollButton,
    isProcessing, setProcessing, getLastActionsHtml,
    getCurrentView, setCurrentView, buildSpellSlotIndicator,
    showCharacterCard, showInventoryPage, showHistory,
    buildCharCardHtml, buildInventoryGrid,
    refreshInventoryList, bindInventoryUseButtons,
} from './dndUI.js';
import {
    showCharacterCreation, showPartnerGeneration,
    getCreationState, setCreationStep,
} from './dndCreation.js';
import {
    handleTrapRoom, handleNPCRoom, handleTreasureRoom, handleRestRoom,
    showContinueButtons,
} from './dndExploration.js';
import {
    runCombatTurnLoop, processCombatNarration,
    buildCombatPanelHtml, refreshCombatPanel,
} from './dndCombatUI.js';

// ═══════════════════════════════════════════════════════════════════════
// Navigation Intercept
// ═══════════════════════════════════════════════════════════════════════

window.addEventListener('phone-app-back', (e) => {
    const dndRoot = document.getElementById('dnd_root');
    if (!dndRoot) return;

    const view = getCurrentView();

    if (view === 'preparation') {
        e.preventDefault();
        _showMainPage();
        return;
    }

    if (view === 'charCard' || view === 'history' || view === 'inventory') {
        e.preventDefault();
        if (getCurrentRun()) _showAdventure();
        else _showMainPage();
        return;
    }

    if (view === 'creation') {
        const state = getCreationState();
        if (state.step === 'confirm') {
            setCreationStep('stats');
            e.preventDefault();
        } else if (state.step === 'stats') {
            setCreationStep('class');
            e.preventDefault();
        } else if (state.step === 'class') {
            setCreationStep('race');
            e.preventDefault();
        }
    }
});

// ═══════════════════════════════════════════════════════════════════════
// Entry Point
// ═══════════════════════════════════════════════════════════════════════

export function openDndApp() {
    console.log('[D&D] Opening D&D App...');
    const data = loadDndData();

    if (!data.playerCharacter) {
        showCharacterCreation(_showMainPage);
        return;
    }

    if (!data.partnerCharacter) {
        showPartnerGeneration(_showMainPage);
        return;
    }

    if (data.currentRun) {
        _showAdventure();
        return;
    }

    _showMainPage();
}

// ═══════════════════════════════════════════════════════════════════════
// Main Page — Campaign Selection
// ═══════════════════════════════════════════════════════════════════════

function _showMainPage() {
    setCurrentView('main');
    const data = loadDndData();
    const playerChar = data.playerCharacter;
    const partnerChar = data.partnerCharacter;

    if (!playerChar) { showCharacterCreation(_showMainPage); return; }
    if (!partnerChar) { showPartnerGeneration(_showMainPage); return; }

    const playerDerived = getCharacterDerived(playerChar);
    const partnerDerived = getCharacterDerived(partnerChar);
    const charName = getPhoneCharInfo()?.name || '角色';

    const continueBanner = data.currentRun ? `
        <div class="dnd-continue-banner">
            <div class="dnd-continue-text"><i class="ph ph-sword"></i> 你有一场未完成的冒险</div>
            <button class="dnd-continue-btn" id="dnd_continue_run">继续冒险</button>
        </div>` : '';

    const campaignCards = CAMPAIGNS.map(c => `
        <div class="dnd-campaign-card" data-campaign="${c.id}">
            <div class="dnd-campaign-header">
                <div class="dnd-campaign-icon"><i class="ph ${c.icon}"></i></div>
                <div class="dnd-campaign-titles">
                    <div class="dnd-campaign-name">${esc(c.name)}</div>
                    <div class="dnd-campaign-name-en">${esc(c.nameEn)}</div>
                </div>
            </div>
            <div class="dnd-campaign-desc">${esc(c.description)}</div>
            <div class="dnd-campaign-tags">
                <span class="dnd-tag dnd-tag--gold">Lv.${c.levelRange}</span>
                <span class="dnd-tag">${esc(c.setting)}</span>
                <span class="dnd-tag">${c.roomCount} 个房间</span>
            </div>
            <div class="dnd-campaign-footer">
                <span></span>
                <button class="dnd-start-btn" data-campaign="${c.id}">开始冒险</button>
            </div>
        </div>
    `).join('');

    const historyCount = data.history?.length || 0;
    const victories = data.history?.filter(h => h.result === 'victory').length || 0;

    const html = `
    <div class="dnd-page" id="dnd_root">
        ${continueBanner}
        <div class="dnd-campaign-list">
            ${campaignCards}
        </div>
        <div class="dnd-bottom-bar">
            <button class="dnd-bottom-btn" id="dnd_view_char">
                <i class="ph ph-identification-card"></i> 角色卡
            </button>
            <button class="dnd-bottom-btn" id="dnd_view_history">
                <i class="ph ph-scroll"></i> 冒险记录 ${historyCount > 0 ? `(${victories}胜)` : ''}
            </button>
        </div>
    </div>`;

    const settingsGearHtml = `<button class="dnd-header-btn" id="dnd_settings_btn" title="清空数据"><i class="ph ph-skull"></i></button>`;

    openAppInViewport('D&D', html, () => {
        _bindMainPageEvents();

        const backBtnSpan = document.getElementById('phone_app_back_btn')?.querySelector('span');
        if (backBtnSpan) backBtnSpan.textContent = '返回';
    }, settingsGearHtml);
}

function _bindMainPageEvents() {
    document.querySelectorAll('.dnd-start-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const campaignId = btn.dataset.campaign;
            _startCampaign(campaignId);
        });
    });

    document.getElementById('dnd_continue_run')?.addEventListener('click', () => {
        _showAdventure();
    });

    document.getElementById('dnd_view_char')?.addEventListener('click', () => {
        showCharacterCard(_showMainPage, _showAdventure);
    });

    document.getElementById('dnd_view_history')?.addEventListener('click', () => {
        showHistory(_showMainPage);
    });

    document.getElementById('dnd_settings_btn')?.addEventListener('click', () => {
        const input = prompt('⚠️ 此操作将清除所有 D&D 数据！\n（角色、冒险记录、背包都会被永久删除）\n\n请输入 CLEAN 确认清除：');
        if (input && input.trim() === 'CLEAN') {
            resetDndData();
            showCharacterCreation(_showMainPage);
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Start Campaign
// ═══════════════════════════════════════════════════════════════════════

async function _startCampaign(campaignId) {
    const campaign = getCampaignById(campaignId);
    if (!campaign) return;

    _showPreparationPage(campaignId);
}

// ═══════════════════════════════════════════════════════════════════════
// Pre-Adventure Preparation Page
// ═══════════════════════════════════════════════════════════════════════

function _showPreparationPage(campaignId) {
    setCurrentView('preparation');
    const data = loadDndData();
    const playerChar = data.playerCharacter;
    const campaign = getCampaignById(campaignId);
    if (!playerChar || !campaign) return;

    const cls = CLASSES.find(c => c.id === playerChar.class);
    const gold = playerChar.gold || 0;

    let spellPrepHtml = '';
    if (cls?.spellcaster && isPreparedCaster(cls.id)) {
        const maxPrep = getPreparedSpellCount(playerChar);
        const classSpells = getClassSpells(playerChar).filter(s => s.level > 0);
        const prepared = playerChar.preparedSpells || [];

        spellPrepHtml = `
            <div class="dnd-prep-section">
                <div class="dnd-prep-section-title"><i class="ph ph-magic-wand"></i> 法术准备 (${prepared.length}/${maxPrep})</div>
                <div class="dnd-prep-section-desc">选择今日要准备的法术</div>
                <div class="dnd-spell-prep-list" id="dnd_spell_prep_list">
                    ${classSpells.map(spell => `
                        <label class="dnd-spell-prep-item ${prepared.includes(spell.id) ? 'selected' : ''}" data-spell="${spell.id}">
                            <input type="checkbox" ${prepared.includes(spell.id) ? 'checked' : ''} data-spell="${spell.id}" />
                            <i class="ph ${spell.icon}"></i>
                            <div class="dnd-spell-prep-info">
                                <div class="dnd-spell-prep-name">${esc(spell.name)}</div>
                                <div class="dnd-spell-prep-desc">${esc(spell.description)}</div>
                            </div>
                            <span class="dnd-tag dnd-tag--gold">Lv.${spell.level}</span>
                        </label>
                    `).join('')}
                </div>
            </div>`;
    }

    const inventoryHtml = `
        <div class="dnd-prep-section">
            <div class="dnd-prep-section-title"><i class="ph ph-backpack"></i> 背包</div>
            <div class="dnd-shop-list">
                ${playerChar.inventory.map(item => {
                    const info = getItemInfo(item);
                    const displayName = item.startsWith('[已装备]') ? item.replace('[已装备] ', '') : item;
                    const equippedTag = item.startsWith('[已装备]') ? ' <span class="dnd-tag dnd-tag--gold">已装备</span>' : '';
                    return `<div class="dnd-shop-item">
                        <i class="ph ${info.icon}"></i>
                        <div class="dnd-shop-item-info">
                            <div class="dnd-shop-item-name">${esc(displayName)}${equippedTag}</div>
                        </div>
                    </div>`;
                }).join('') || '<div class="dnd-shop-item"><div class="dnd-shop-item-info"><div class="dnd-shop-item-name" style="color:#8a8a9a">空空如也</div></div></div>'}
            </div>
        </div>`;

    const shopHtml = `
        <div class="dnd-prep-section">
            <div class="dnd-prep-section-title"><i class="ph ph-storefront"></i> 商店 <span class="dnd-gold-display"><i class="ph ph-coins"></i> ${gold} gp</span></div>
            <div class="dnd-shop-list" id="dnd_shop_list">
                ${SHOP_ITEMS.map(item => `
                    <div class="dnd-shop-item ${gold < item.price ? 'disabled' : ''}" data-shop="${item.id}" data-price="${item.price}">
                        <i class="ph ${item.icon}"></i>
                        <div class="dnd-shop-item-info">
                            <div class="dnd-shop-item-name">${esc(item.name)}</div>
                            <div class="dnd-shop-item-desc">${esc(item.description)}</div>
                        </div>
                        <button class="dnd-shop-buy-btn" ${gold < item.price ? 'disabled' : ''} data-shop="${item.id}" data-price="${item.price}">
                            ${item.price} gp
                        </button>
                    </div>
                `).join('')}
            </div>
        </div>`;

    const html = `
    <div class="dnd-page" id="dnd_root">
        <div class="dnd-creation">
            <div class="dnd-creation-title">冒险准备</div>
            <div class="dnd-creation-subtitle">${esc(campaign.name)} — ${campaign.roomCount} 个房间</div>
            ${spellPrepHtml}
            ${inventoryHtml}
            ${shopHtml}
        </div>
        <div class="dnd-prep-footer">
            <button class="dnd-confirm-btn" id="dnd_depart_btn">
                <i class="ph ph-compass"></i> 出发冒险！
            </button>
        </div>
    </div>`;

    openAppInViewport('D&D - 准备', html, () => {
        _bindPreparationEvents(campaignId);
    });
}

function _bindPreparationEvents(campaignId) {
    const data = loadDndData();
    const playerChar = data.playerCharacter;
    const cls = CLASSES.find(c => c.id === playerChar?.class);

    if (cls?.spellcaster && isPreparedCaster(cls.id)) {
        const maxPrep = getPreparedSpellCount(playerChar);
        document.querySelectorAll('#dnd_spell_prep_list input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                const checked = [...document.querySelectorAll('#dnd_spell_prep_list input:checked')];
                if (checked.length > maxPrep) {
                    cb.checked = false;
                    return;
                }
                cb.closest('.dnd-spell-prep-item').classList.toggle('selected', cb.checked);
                const freshData = loadDndData();
                freshData.playerCharacter.preparedSpells = checked.map(c => c.dataset.spell);
                saveDndData(freshData);
            });
        });
    }

    document.querySelectorAll('.dnd-shop-buy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const shopId = btn.dataset.shop;
            const price = parseInt(btn.dataset.price);
            const freshData = loadDndData();
            const currentGold = freshData.playerCharacter?.gold || 0;
            if (currentGold < price) return;

            freshData.playerCharacter.gold -= price;
            const itemName = getShopItemName(shopId);
            if (itemName) freshData.playerCharacter.inventory.push(itemName);
            saveDndData(freshData);

            _showPreparationPage(campaignId);
        });
    });

    document.getElementById('dnd_depart_btn')?.addEventListener('click', () => {
        const campaign = getCampaignById(campaignId);
        startRun(campaignId, campaign.roomCount);
        _showAdventure();
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Adventure View
// ═══════════════════════════════════════════════════════════════════════

function _showAdventure() {
    setCurrentView('adventure');
    const data = loadDndData();
    const run = data.currentRun;
    if (!run) { _showMainPage(); return; }

    const playerChar = data.playerCharacter;
    const partnerChar = data.partnerCharacter;
    const campaign = getCampaignById(run.campaignId);
    const charName = getPhoneCharInfo()?.name || '角色';
    const userName = getPhoneUserName();

    const playerHPPercent = Math.round((playerChar.currentHP / playerChar.maxHP) * 100);
    const partnerHPPercent = Math.round((partnerChar.currentHP / partnerChar.maxHP) * 100);

    const narrativeHtml = run.narrativeLog.map(entry =>
        `<div class="dnd-narrative-entry ${entry.type}">${esc(entry.text)}</div>`
    ).join('');

    const html = `
    <div class="dnd-page dnd-adventure" id="dnd_root">
        <div class="dnd-status-bar">
            <div class="dnd-status-hp">
                <span class="dnd-hp-name">${esc(userName)}</span>
                <div class="dnd-hp-bar">
                    <div class="dnd-hp-fill ${playerHPPercent <= 25 ? 'danger' : playerHPPercent <= 50 ? 'warning' : ''}"
                         style="width:${playerHPPercent}%"></div>
                </div>
                <span class="dnd-hp-text">${playerChar.currentHP}/${playerChar.maxHP}</span>
            </div>
            <div class="dnd-room-indicator">
                ${campaign ? esc(campaign.name) : ''} ${run.currentRoom}/${run.totalRooms}
            </div>
            <div class="dnd-status-hp">
                <span class="dnd-hp-name">${esc(charName)}</span>
                <div class="dnd-hp-bar">
                    <div class="dnd-hp-fill ${partnerHPPercent <= 25 ? 'danger' : partnerHPPercent <= 50 ? 'warning' : ''}"
                         style="width:${partnerHPPercent}%"></div>
                </div>
                <span class="dnd-hp-text">${partnerChar.currentHP}/${partnerChar.maxHP}</span>
            </div>
        </div>

        ${run.inCombat && run.combatState ? buildCombatPanelHtml(run.combatState) : ''}

        <div class="dnd-narrative" id="dnd_narrative">
            ${narrativeHtml || '<div class="dnd-narrative-entry system">冒险即将开始，点击下方按钮，踏入地下城</div>'}
        </div>

        <div class="dnd-actions" id="dnd_actions">
            ${run.currentRoom === 0 ? `
                <button class="dnd-action-btn" id="dnd_enter_first_room">
                    <i class="ph ph-door-open"></i> 踏入地下城
                </button>` : (run.inCombat ? '' : getLastActionsHtml())}
        </div>

        <div class="dnd-custom-input-bar">
            <input type="text" id="dnd_custom_input" placeholder="例：我想搭建一个隐蔽的伏击点" />
            <button id="dnd_custom_send"><i class="ph ph-paper-plane-tilt"></i></button>
        </div>

        <div class="dnd-toolbar">
            <button class="dnd-tool-btn" id="dnd_tool_inventory"><i class="ph ph-backpack"></i>背包</button>
            <button class="dnd-tool-btn" id="dnd_tool_charcard"><i class="ph ph-identification-card"></i>角色</button>
            <button class="dnd-tool-btn" id="dnd_tool_rest"><i class="ph ph-campfire"></i>短休</button>
            <button class="dnd-tool-btn" id="dnd_tool_retreat"><i class="ph ph-sign-out"></i>撤退</button>
        </div>
    </div>`;

    openAppInViewport('D&D', html, () => {
        _bindAdventureEvents();
        scrollNarrativeToBottom();

        const backBtnSpan = document.getElementById('phone_app_back_btn')?.querySelector('span');
        if (backBtnSpan) backBtnSpan.textContent = '返回';

        if (run.inCombat && run.combatState) {
            runCombatTurnLoop(_endAdventure, _enterNextRoom);
        }
    });
}

function _bindAdventureEvents() {
    document.getElementById('dnd_enter_first_room')?.addEventListener('click', () => {
        _enterNextRoom();
    });

    document.getElementById('dnd_tool_inventory')?.addEventListener('click', () => {
        showInventoryPage(_showMainPage, _showAdventure, _handleUseItemOutsideCombat);
    });

    document.getElementById('dnd_tool_charcard')?.addEventListener('click', () => {
        showCharacterCard(_showMainPage, _showAdventure);
    });

    document.getElementById('dnd_tool_rest')?.addEventListener('click', () => {
        _handleShortRest();
    });

    document.getElementById('dnd_tool_retreat')?.addEventListener('click', () => {
        _handleRetreat();
    });

    // Custom action input
    const customInput = document.getElementById('dnd_custom_input');
    const customSendBtn = document.getElementById('dnd_custom_send');
    if (customInput && customSendBtn) {
        customSendBtn.addEventListener('click', () => {
            const text = customInput.value.trim();
            if (text && !isProcessing()) {
                customInput.value = '';
                _handleCustomAction(text);
            }
        });
        customInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const text = customInput.value.trim();
                if (text && !isProcessing()) {
                    customInput.value = '';
                    _handleCustomAction(text);
                }
            }
        });
    }

    // Delegated action button clicks (exploration only — combat buttons have their own handlers)
    document.getElementById('dnd_actions')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.dnd-action-btn');
        if (!btn || isProcessing()) return;

        // Combat-specific buttons are handled by their own direct listeners in dndCombatUI.js
        // Do NOT let them fall through to the exploration handler (_handleActionChoice)
        if (btn.classList.contains('dnd-combat-action')) return;

        const actionData = btn.dataset;

        if (actionData.type === 'special') {
            if (actionData.action === 'next_room') {
                _enterNextRoom();
            } else if (actionData.action === 'end') {
                _endAdventure(actionData.result || 'victory');
            } else if (actionData.action === 'enter_combat') {
                _enterCombatFromNarrative();
            }
            return;
        }

        _handleActionChoice(actionData);
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Custom Action — Free-form player input
// ═══════════════════════════════════════════════════════════════════════

/**
 * Use an item outside of combat (e.g. healing potion from action options or inventory).
 */
async function _handleUseItemOutsideCombat(itemName) {
    if (isProcessing()) return;
    setProcessing(true);

    const data = loadDndData();
    const char = data.playerCharacter;
    if (!char) { setProcessing(false); return; }

    const idx = char.inventory.indexOf(itemName);
    if (idx === -1) {
        appendNarrative('system', `背包中没有「${itemName}」`);
        setProcessing(false);
        refreshNarrative();
        return;
    }

    const info = getItemInfo(itemName);
    let effectText = '';
    let llmHint = '';

    switch (info.type) {
        case 'healing': {
            const diceCount = info.effect.dice === '4D4' ? 4 : 2;
            let healRoll = info.effect.bonus;
            for (let i = 0; i < diceCount; i++) healRoll += roll(4);
            const hpBefore = char.currentHP;
            const hpAfter = Math.min(char.maxHP, hpBefore + healRoll);
            char.inventory.splice(idx, 1);
            char.currentHP = hpAfter;
            saveDndData(data);
            appendNarrative('dice', `${itemName}：恢复 ${healRoll} HP (${hpBefore} → ${hpAfter})`);
            refreshHPBars();
            effectText = `恢复了 ${healRoll} HP`;
            llmHint = `玩家喝下了${itemName}，恢复了${healRoll}HP。`;
            break;
        }
        case 'currency': {
            const goldGain = info.effect.gold || 0;
            char.inventory.splice(idx, 1);
            char.gold = (char.gold || 0) + goldGain;
            saveDndData(data);
            appendNarrative('dice', `${itemName} → 获得 ${goldGain} gp`);
            effectText = `获得 ${goldGain} 金币`;
            llmHint = `玩家将${itemName}兑换为${goldGain}金币。`;
            break;
        }
        case 'equipment': {
            const equipped = `[已装备] ${itemName}`;
            if (itemName.startsWith('[已装备]')) {
                const originalName = itemName.replace('[已装备] ', '');
                char.inventory[idx] = originalName;
                if (info.effect.stat === 'ac') char.ac = Math.max(10, (char.ac || 10) - info.effect.bonus);
                saveDndData(data);
                appendNarrative('action', `>> 卸下 ${originalName}`);
                effectText = `卸下了 ${originalName}`;
                llmHint = `玩家卸下了${originalName}。`;
            } else {
                char.inventory[idx] = equipped;
                if (info.effect.stat === 'ac') char.ac = (char.ac || 10) + info.effect.bonus;
                saveDndData(data);
                appendNarrative('dice', `装备 ${itemName}：${info.effect.desc}`);
                effectText = info.effect.desc;
                llmHint = `玩家装备了${itemName}（${info.effect.desc}）。`;
            }
            break;
        }
        case 'scroll': {
            char.inventory.splice(idx, 1);
            saveDndData(data);
            const spellName = itemName.replace(/卷轴[：:]/, '');
            appendNarrative('dice', `卷轴展开，${spellName}的魔力释放！`);
            effectText = `释放了卷轴：${spellName}`;
            llmHint = `玩家使用了${itemName}，卷轴化为灰烬，${spellName}的魔法释放。请描述法术的效果和场景。`;
            break;
        }
        case 'consumable': {
            char.inventory.splice(idx, 1);
            if (info.effect.stat === 'ac') char.ac = (char.ac || 10) + info.effect.bonus;
            saveDndData(data);
            appendNarrative('dice', `${itemName}：${info.effect.description}`);
            effectText = info.effect.description;
            llmHint = `玩家使用了${itemName}。效果：${info.effect.description}。`;
            break;
        }
        default: {
            if (info.consumed) char.inventory.splice(idx, 1);
            saveDndData(data);
            effectText = info.effect?.description || `使用了 ${itemName}`;
            llmHint = `玩家使用了${itemName}。`;
            break;
        }
    }

    appendNarrative('action', `>> 使用 ${itemName}`);
    refreshInventoryList(_showAdventure, _handleUseItemOutsideCombat);

    setActions('<div class="dnd-loading"><i class="ph ph-flask"></i> DM 正在描述...</div>');
    try {
        const campaign = getCampaignById(data.currentRun?.campaignId);
        const systemPrompt = await buildDMSystemPrompt({
            playerChar: char,
            partnerChar: data.partnerCharacter,
            campaign,
            currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
        });
        const userPrompt = `${llmHint}请用1-2段简短的叙事描述这个场景，以及搭档的反应。然后给出2-3个行动选项。`;
        const response = await callPhoneLLM(systemPrompt, userPrompt);
        _processLLMResponse(response);
    } catch (err) {
        console.error('[D&D] Item narration failed:', err);
        appendNarrative('system', '叙事生成失败: ' + err.message);
        showRerollButton(() => _handleUseItemOutsideCombat(itemName));
    }

    setProcessing(false);
    refreshNarrative();
}

async function _handleCustomAction(text) {
    if (isProcessing()) return;
    setProcessing(true);

    appendNarrative('action', `>> ${text}`);
    refreshNarrative();

    setActions('<div class="dnd-loading"><i class="ph ph-dice-five"></i> DM 正在回应...</div>');

    try {
        const data = loadDndData();
        const campaign = getCampaignById(data.currentRun?.campaignId);

        const systemPrompt = await buildDMSystemPrompt({
            playerChar: data.playerCharacter,
            partnerChar: data.partnerCharacter,
            campaign,
            currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
        });

        const userPrompt = buildCustomActionPrompt(text);
        const response = await callPhoneLLM(systemPrompt, userPrompt);

        // During combat, route through combat narration and restart turn loop
        const run = getCurrentRun();
        if (run?.inCombat && run?.combatState) {
            processCombatNarration(response);
            refreshCombatPanel();
            setProcessing(false);
            refreshNarrative();
            await runCombatTurnLoop(_endAdventure, _enterNextRoom);
            return;
        }

        _processLLMResponse(response);
    } catch (err) {
        console.error('[D&D] Custom action failed:', err);
        appendNarrative('system', '生成失败: ' + err.message);
        showRerollButton(() => _handleCustomAction(text));
    }

    setProcessing(false);
    refreshNarrative();
}

// ═══════════════════════════════════════════════════════════════════════
// Game Flow
// ═══════════════════════════════════════════════════════════════════════

async function _enterNextRoom() {
    if (isProcessing()) return;
    setProcessing(true);

    const data = loadDndData();
    const run = data.currentRun;
    const campaign = getCampaignById(run.campaignId);

    const nextRoom = run.currentRoom + 1;
    const isBoss = nextRoom === run.totalRooms;

    // ── Smart room type selection ──
    // Room 1: always combat (guarantee players fight early)
    // Penultimate room: force combat if no combat has happened yet
    // Boss room: always combat (boss encounter)
    let roomType;
    if (isBoss) {
        roomType = 'combat';
    } else if (nextRoom === 1) {
        roomType = 'combat';
    } else {
        const history = run.roomHistory || [];
        const hadCombat = history.includes('combat');
        const isSecondToLast = nextRoom === run.totalRooms - 1;
        if (!hadCombat && isSecondToLast) {
            roomType = 'combat';
        } else {
            roomType = pickRandomRoomType();
        }
    }

    // ── Room-transition summarization: compress current room's narrative ──
    if (run.currentRoom >= 1) {
        try {
            flushNarrative();
            const freshRun = getCurrentRun();
            const roomLog = freshRun?.narrativeLog || [];
            // Find entries from the current room (entries after the last room separator)
            let roomStartIdx = 0;
            for (let i = roomLog.length - 1; i >= 0; i--) {
                if (roomLog[i].type === 'system' && roomLog[i].text.startsWith('—— 房间')) {
                    roomStartIdx = i;
                    break;
                }
            }
            const roomEntries = roomLog.slice(roomStartIdx);
            if (roomEntries.length > 3) {
                setActions('<div class="dnd-loading"><i class="ph ph-notebook"></i> 正在整理冒险日志...</div>');
                const summaryPrompt = buildRoomSummaryPrompt(roomEntries, run.currentRoom, run.roomType || 'unknown');
                const summary = await callPhoneLLM('你是一个冒险日志整理助手。', summaryPrompt);
                if (summary && summary.trim()) {
                    addRoomSummary(summary.trim());
                    console.log(`[D&D] Room ${run.currentRoom} summary saved (${summary.trim().length} chars)`);
                }
            }
        } catch (err) {
            console.warn('[D&D] Room summary generation failed:', err.message);
        }
    }

    advanceRoom(roomType);
    refreshRoomIndicator();

    appendNarrative('system', `—— 房间 ${nextRoom}/${run.totalRooms} ——`);
    setActions('<div class="dnd-loading"><i class="ph ph-dice-five"></i> DM 正在准备房间...</div>');

    try {
        if (roomType === 'combat') {
            const combatState = initCombat(data.playerCharacter, data.partnerCharacter, campaign, isBoss);
            const initSummary = getInitiativeSummary(combatState);

            appendNarrative('dice', `先攻顺序：${initSummary}`);

            const systemPrompt = await buildDMSystemPrompt({
                playerChar: data.playerCharacter,
                partnerChar: data.partnerCharacter,
                campaign,
                currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
            });
            const userPrompt = buildCombatRoomPrompt(nextRoom, run.totalRooms, combatState.enemies, initSummary, isBoss);
            const response = await callPhoneLLM(systemPrompt, userPrompt);

            processCombatNarration(response);
            refreshCombatPanel();

            setProcessing(false);
            refreshNarrative();
            await runCombatTurnLoop(_endAdventure, _enterNextRoom);
            return;
        }

        // Structured room flows — delegate to dndExploration
        const _showContinue = () => showContinueButtons(_enterNextRoom, _endAdventure);

        if (roomType === 'trap') {
            await handleTrapRoom(data, campaign, nextRoom, run.totalRooms, processCombatNarration, _showContinue);
        } else if (roomType === 'npc') {
            await handleNPCRoom(data, campaign, nextRoom, run.totalRooms, processCombatNarration, _showContinue);
        } else if (roomType === 'treasure') {
            await handleTreasureRoom(data, campaign, nextRoom, run.totalRooms, processCombatNarration, _showContinue);
        } else if (roomType === 'rest') {
            await handleRestRoom(data, campaign, nextRoom, run.totalRooms, processCombatNarration, _enterNextRoom, _endAdventure);
        } else {
            // Puzzle or fallback — original LLM flow
            const systemPrompt = await buildDMSystemPrompt({
                playerChar: data.playerCharacter,
                partnerChar: data.partnerCharacter,
                campaign,
                currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
            });
            const userPrompt = buildEnterRoomPrompt(nextRoom, run.totalRooms, roomType, isBoss);
            const response = await callPhoneLLM(systemPrompt, userPrompt);
            _processLLMResponse(response);
        }
    } catch (err) {
        console.error('[D&D] Room generation failed:', err);
        appendNarrative('system', '生成失败，请重试');
        setActions(`<button class="dnd-action-btn" id="dnd_enter_first_room">
            <i class="ph ph-arrow-clockwise"></i> 重试</button>`);
        document.getElementById('dnd_enter_first_room')?.addEventListener('click', () => _enterNextRoom());
    }

    setProcessing(false);
    refreshNarrative();
}

// ═══════════════════════════════════════════════════════════════════════
// Action Choice Handler
// ═══════════════════════════════════════════════════════════════════════

async function _handleActionChoice(actionData) {
    if (isProcessing()) return;
    setProcessing(true);

    const actionText = actionData.action || '行动';
    const checkType = actionData.check || '';
    const dc = parseInt(actionData.dc) || 10;
    const isAttack = actionData.type === 'attack';
    const isItem = actionData.type === 'item';

    if (isItem) {
        setProcessing(false);
        _handleUseItemOutsideCombat(actionData.item || actionText);
        return;
    }

    const data = loadDndData();
    const playerChar = data.playerCharacter;
    const campaign = getCampaignById(data.currentRun?.campaignId);

    let diceResult;
    if (isAttack) {
        const derived = getCharacterDerived(playerChar);
        const attackRes = attackRoll(
            playerChar.stats[derived.primaryAbility],
            playerChar.proficiencyBonus,
            parseInt(actionData.targetac) || 15
        );
        const dmgExpr = actionData.damage || '1D8+2';
        const dmgRes = attackRes.hit ? damageRoll(dmgExpr, attackRes.isCritical) : null;

        appendNarrative('dice', `${attackRes.summary}${dmgRes ? `\n${dmgExpr} → ${dmgRes.detail}` : ''}`);
        appendNarrative('action', `>> ${actionText}`);

        setActions('<div class="dnd-loading"><i class="ph ph-sword"></i> DM 正在描述结果...</div>');

        try {
            const systemPrompt = await buildDMSystemPrompt({
                playerChar, partnerChar: data.partnerCharacter, campaign, currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
            });
            const userPrompt = buildCombatAttackPrompt(attackRes, dmgRes, actionData.target || '敌人');
            const response = await callPhoneLLM(systemPrompt, userPrompt);
            _processLLMResponse(response);
        } catch (err) {
            appendNarrative('system', '生成失败: ' + err.message);
            showRerollButton(() => _handleActionChoice(actionData));
        }
    } else {
        const abilityKey = (checkType || 'STR').toUpperCase();
        const score = playerChar.stats[abilityKey] || 10;
        const proficient = playerChar.proficientSkills.some(s => SKILLS[s]?.ability === abilityKey);

        diceResult = abilityCheck(score, proficient, playerChar.proficiencyBonus, dc);

        appendNarrative('dice', diceResult.summary);
        appendNarrative('action', `>> ${actionText}`);

        setActions('<div class="dnd-loading"><i class="ph ph-dice-five"></i> DM 正在描述结果...</div>');

        try {
            const systemPrompt = await buildDMSystemPrompt({
                playerChar, partnerChar: data.partnerCharacter, campaign, currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
            });
            const userPrompt = buildActionResultPrompt(actionText, diceResult);
            const response = await callPhoneLLM(systemPrompt, userPrompt);
            _processLLMResponse(response);
        } catch (err) {
            appendNarrative('system', '生成失败: ' + err.message);
            showRerollButton(() => _handleActionChoice(actionData));
        }
    }

    setProcessing(false);
    refreshNarrative();
}

// ═══════════════════════════════════════════════════════════════════════
// LLM Response Parser
// ═══════════════════════════════════════════════════════════════════════

function _processLLMResponse(response) {
    if (!response) return;
    response = response.replace(/\*\*/g, '');

    // Normalize section delimiters: accept 【】, [], and plain section headers
    // Split on 【 or [ that starts a known section label
    const parts = response.split(/(?:【|(?:^|\n)\s*\[?)\s*(?=DM叙事|DM|行动选项|选项)/m);

    let dmText = '';
    let partnerText = '';
    let actionOptions = [];

    for (const part of parts) {
        const cleaned = part.replace(/[【】\[\]]/g, '').trim();
        if (!cleaned) continue;

        if (cleaned.startsWith('DM叙事') || cleaned.startsWith('DM')) {
            dmText = cleaned.replace(/^DM叙事[：:]?\s*|^DM[：:]?\s*/, '').trim();
        } else if (cleaned.includes('行动选项') || cleaned.includes('选项')) {
            const lines = cleaned.split('\n').filter(l => l.trim());
            for (const line of lines) {
                const trimmed = line.trim();
                if (/行动选项|选项|请选择|应对策略|关键点|接下来|如下|以下/.test(trimmed)) continue;
                if (!/^\s*(?:\d+[.、）)]\s*|[-·•]\s*)/.test(trimmed)) continue;
                const optMatch = trimmed.match(/^(?:\d+[.、）)]\s*|[-·•]\s*)(.+?)(?:\s*\[(.+?)\s*(?:DC\s*(\d+))?\])?$/);
                if (optMatch) {
                    const text = optMatch[1].trim();
                    const check = optMatch[2] || '';
                    const dc = optMatch[3] || '10';
                    if (text) actionOptions.push({ text, check, dc });
                }
            }
        } else {
            let text = cleaned;
            const charName = getPhoneCharInfo()?.name || '';
            const colonIdx = text.search(/[：:]/);
            if (colonIdx !== -1 && colonIdx < 20) {
                text = text.substring(colonIdx + 1).trim();
            } else if (charName && text.startsWith(charName)) {
                text = text.substring(charName.length).trim();
            }
            partnerText = text;
        }
    }

    if (!dmText && !partnerText) {
        dmText = response;
    }

    if (dmText) appendNarrative('dm', dmText);
    if (partnerText) appendNarrative('partner', partnerText);

    const run = getCurrentRun();
    if (run && run.currentRoom >= run.totalRooms) {
        const lowerText = (dmText + partnerText).toLowerCase();
        if (lowerText.includes('胜利') || lowerText.includes('击败') || lowerText.includes('倒下')) {
            actionOptions.push({ text: '结束冒险', check: '', dc: '0', special: 'end_victory' });
        }
    }

    if (actionOptions.length === 0) {
        if (run && run.currentRoom < run.totalRooms) {
            actionOptions.push({ text: '前进到下一个房间', check: '', dc: '0', special: 'next_room' });
        } else {
            actionOptions.push({ text: '完成冒险', check: '', dc: '0', special: 'end_victory' });
        }
    }

    const buttonsHtml = actionOptions.map((opt, i) => {
        if (opt.special === 'next_room') {
            return `<button class="dnd-action-btn" data-action="next_room" data-type="special">
                <i class="ph ph-door-open"></i> ${esc(opt.text)}</button>`;
        }
        if (opt.special === 'end_victory') {
            return `<button class="dnd-action-btn" data-action="end" data-result="victory" data-type="special">
                <i class="ph ph-trophy"></i> ${esc(opt.text)}</button>`;
        }

        const checkParts = opt.check.match(/(STR|DEX|CON|INT|WIS|CHA|力量|敏捷|体质|智力|感知|魅力)/i);
        let checkAbility = '';
        if (checkParts) {
            const nameMap = { '力量': 'STR', '敏捷': 'DEX', '体质': 'CON', '智力': 'INT', '感知': 'WIS', '魅力': 'CHA' };
            checkAbility = nameMap[checkParts[1]] || checkParts[1].toUpperCase();
        }

        const isAttack = opt.check.includes('攻击') || opt.text.includes('攻击');
        const isItem = opt.text.includes('药水') || opt.text.includes('使用') || opt.text.includes('喝');
        const isCombat = opt.check.includes('战斗') || opt.text.includes('进入战斗') || opt.text.includes('迎战');

        if (isCombat) {
            return `<button class="dnd-action-btn dnd-spell-trigger" data-action="enter_combat" data-type="special">
                <i class="ph ph-swords"></i>
                <span>${esc(opt.text)}</span>
            </button>`;
        }

        if (isItem) {
            const itemMatch = opt.text.match(/(?:使用|喝下?)\s*[「「]?(.+?)[」」]?$/)
                || opt.text.match(/((?:高等)?治疗药水)/)
                || [null, opt.text];
            const itemName = itemMatch[1] || opt.text;
            return `<button class="dnd-action-btn"
                data-action="${esc(opt.text)}"
                data-item="${esc(itemName)}"
                data-type="item">
                <i class="ph ph-flask"></i>
                <span>${esc(opt.text)}</span>
            </button>`;
        }

        return `<button class="dnd-action-btn"
            data-action="${esc(opt.text)}"
            data-check="${checkAbility}"
            data-dc="${opt.dc}"
            data-type="${isAttack ? 'attack' : 'check'}">
            <i class="ph ${isAttack ? 'ph-sword' : 'ph-dice-five'}"></i>
            <span>${esc(opt.text)}</span>
            ${opt.check ? `<span class="dnd-action-check">[${esc(opt.check)} DC${opt.dc}]</span>` : ''}
        </button>`;
    }).join('');

    setActions(buttonsHtml);

    document.querySelectorAll('.dnd-action-btn[data-type="special"]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.action === 'next_room') {
                _enterNextRoom();
            } else if (btn.dataset.action === 'end') {
                _endAdventure(btn.dataset.result || 'victory');
            } else if (btn.dataset.action === 'enter_combat') {
                _enterCombatFromNarrative();
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Enter Combat from Non-Combat Narrative
// ═══════════════════════════════════════════════════════════════════════

async function _enterCombatFromNarrative() {
    if (isProcessing()) return;
    setProcessing(true);

    const data = loadDndData();
    const run = data.currentRun;
    const campaign = getCampaignById(run?.campaignId);
    if (!campaign) { setProcessing(false); return; }

    const isBoss = run.currentRoom >= run.totalRooms;
    const combatState = initCombat(data.playerCharacter, data.partnerCharacter, campaign, isBoss);
    const initSummary = getInitiativeSummary(combatState);

    appendNarrative('system', '—— 战斗开始！——');
    appendNarrative('dice', `先攻顺序：${initSummary}`);

    setActions('<div class="dnd-loading"><i class="ph ph-swords"></i> 战斗准备中...</div>');

    try {
        const systemPrompt = await buildDMSystemPrompt({
            playerChar: data.playerCharacter,
            partnerChar: data.partnerCharacter,
            campaign,
            currentRun: getCurrentRun(), narrativeContext: getNarrativeContext(),
        });
        const userPrompt = buildCombatRoomPrompt(
            run.currentRoom, run.totalRooms, combatState.enemies, initSummary, isBoss,
        );
        const response = await callPhoneLLM(systemPrompt, userPrompt);
        processCombatNarration(response);
    } catch (err) {
        console.error('[D&D] Combat intro narration failed:', err);
    }

    refreshCombatPanel();
    setProcessing(false);
    refreshNarrative();
    await runCombatTurnLoop(_endAdventure, _enterNextRoom);
}

// ═══════════════════════════════════════════════════════════════════════
// End of Adventure
// ═══════════════════════════════════════════════════════════════════════

function _endAdventure(result) {
    setInCombat(false);

    const run = getCurrentRun();
    const highlights = run?.narrativeLog
        ?.filter(e => e.type === 'dice')
        ?.map(e => e.text)
        ?.join(' | ')
        ?.substring(0, 200) || '';

    const xpGained = (run?.currentRoom || 1) * 100;
    const goldGained = result !== 'defeat' ? (run?.currentRoom || 1) * 25 : 0;
    const resultLabels = { victory: '胜利！', defeat: '全队覆灭……', retreat: '撤退' };
    const resultLabel = resultLabels[result] || '结束';

    if (result === 'defeat') {
        endRun(result, highlights, 0, []);
        appendNarrative('system', `—— 冒险结束 —— ${resultLabel}`);
    } else {
        const lootItem = pickRandomLoot(getCampaignById(run?.campaignId) || CAMPAIGNS[0]);
        endRun(result, highlights, xpGained, [lootItem]);
        appendNarrative('system', `—— 冒险结束 —— ${resultLabel} | +${xpGained} XP | +${goldGained} gp | 战利品：${lootItem}`);
    }

    refreshNarrative();

    const data = loadDndData();
    if (data.playerCharacter && canLevelUp(data.playerCharacter)) {
        _showLevelUpCard();
    } else {
        _showReturnButton();
    }
}

function _showReturnButton() {
    setActions(`<button class="dnd-action-btn" data-type="special" id="dnd_return_main">
        <i class="ph ph-house"></i> 返回主页
    </button>`);
    document.getElementById('dnd_return_main')?.addEventListener('click', () => {
        _showMainPage();
    });
}

function _showLevelUpCard() {
    const data = loadDndData();
    const pc = data.playerCharacter;
    const oldLevel = pc.level;

    const result = levelUp(pc);
    saveDndData(data);

    if (data.partnerCharacter && data.partnerCharacter.level < result.newLevel) {
        const partnerResult = levelUp(data.partnerCharacter);
        saveDndData(data);
    }

    const cls = CLASSES.find(c => c.id === pc.class);
    let slotsHtml = '';
    if (result.slotChanges) {
        slotsHtml = `<div class="dnd-levelup-detail"><i class="ph ph-magic-wand"></i> 法术位：${Object.entries(result.slotChanges).map(([k, v]) => `${k}: ${v}`).join(' | ')}</div>`;
    }

    appendNarrative('system', `★ 升级！Lv.${oldLevel} → Lv.${result.newLevel} | HP +${result.hpGain} (D${cls?.hitDie}=${result.hpRoll}+CON) ★`);
    refreshNarrative();

    setActions(`
        <div class="dnd-level-up-card">
            <div class="dnd-levelup-title"><i class="ph ph-star"></i> 升级！</div>
            <div class="dnd-levelup-level">Lv.${oldLevel} → Lv.${result.newLevel}</div>
            <div class="dnd-levelup-detail"><i class="ph ph-heart"></i> HP +${result.hpGain} (${pc.maxHP} 总计)</div>
            <div class="dnd-levelup-detail"><i class="ph ph-shield"></i> 熟练加值：+${result.newProfBonus}</div>
            ${slotsHtml}
        </div>
        <button class="dnd-action-btn" data-type="special" id="dnd_return_main">
            <i class="ph ph-house"></i> 返回主页
        </button>
    `);
    document.getElementById('dnd_return_main')?.addEventListener('click', () => {
        _showMainPage();
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Short Rest & Retreat
// ═══════════════════════════════════════════════════════════════════════

function _handleShortRest() {
    const data = loadDndData();
    const playerChar = data.playerCharacter;
    const partnerChar = data.partnerCharacter;

    if (!playerChar.hitDice || playerChar.hitDice.remaining <= 0) {
        appendNarrative('system', '没有剩余的生命骰可用');
        refreshNarrative();
        return;
    }

    const cls = CLASSES.find(c => c.id === playerChar.class);
    const hitDieSides = cls?.hitDie || 8;
    const conMod = abilityModifier(playerChar.stats.CON);
    const healRoll = Math.max(1, roll(hitDieSides) + conMod);
    const oldPlayerHP = playerChar.currentHP;
    playerChar.currentHP = Math.min(playerChar.currentHP + healRoll, playerChar.maxHP);
    playerChar.hitDice.remaining -= 1;

    let partnerHealMsg = '';
    if (partnerChar && partnerChar.currentHP < partnerChar.maxHP) {
        const partnerCls = CLASSES.find(c => c.id === partnerChar.class);
        const partnerDie = partnerCls?.hitDie || 8;
        const partnerConMod = abilityModifier(partnerChar.stats.CON);
        const partnerHeal = Math.max(1, roll(partnerDie) + partnerConMod);
        const oldPartnerHP = partnerChar.currentHP;
        partnerChar.currentHP = Math.min(partnerChar.currentHP + partnerHeal, partnerChar.maxHP);
        partnerHealMsg = ` | 搭档：D${partnerDie}+${partnerConMod} = 恢复 ${partnerHeal} HP (${oldPartnerHP} → ${partnerChar.currentHP})`;
    }

    if (cls?.id === 'warlock' && playerChar.maxSpellSlots) {
        playerChar.spellSlots = { ...playerChar.maxSpellSlots };
        appendNarrative('system', '邪术师契约魔法：短休恢复全部法术位');
    }

    saveDndData(data);

    appendNarrative('dice', `短休：D${hitDieSides}+${conMod} = 恢复 ${healRoll} HP (${oldPlayerHP} → ${playerChar.currentHP})${partnerHealMsg}`);
    appendNarrative('system', `剩余生命骰：${playerChar.hitDice.remaining}/${playerChar.hitDice.total}`);

    refreshNarrative();
    refreshHPBars();

    const run = getCurrentRun();
    if (run && run.currentRoom < run.totalRooms) {
        setActions(`<button class="dnd-action-btn" data-action="next_room" data-type="special">
            <i class="ph ph-door-open"></i> 前进到下一个房间</button>`);
        document.querySelector('.dnd-action-btn[data-action="next_room"]')?.addEventListener('click', () => {
            _enterNextRoom();
        });
    } else {
        setActions(`<button class="dnd-action-btn" data-action="end" data-result="victory" data-type="special">
            <i class="ph ph-trophy"></i> 完成冒险</button>`);
        document.querySelector('.dnd-action-btn[data-action="end"]')?.addEventListener('click', () => {
            _endAdventure('victory');
        });
    }
}

function _handleRetreat() {
    _endAdventure('retreat');
}

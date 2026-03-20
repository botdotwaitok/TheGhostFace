// modules/phone/dnd/dndUI.js — Shared UI state, utility functions, and view pages
// Extracted from dndApp.js: Character card, Inventory, History, Equipment management, UI helpers.

import { openAppInViewport } from '../phoneController.js';
import { getPhoneCharInfo, getPhoneUserName } from '../phoneContext.js';
import {
    loadDndData, saveDndData, getCurrentRun,
    getPlayerCharacter, getPartnerCharacter, flushNarrative,
    getEpilogues,
} from './dndStorage.js';
import {
    RACES, CLASSES, ABILITY_NAMES, ABILITY_ORDER,
    getCharacterDerived, getXpForNextLevel, getItemInfo,
    SHOP_CATEGORIES, getItemCategory,
} from './dndCharacter.js';
import { abilityModifier } from './dndDice.js';
import { getCampaignById } from './dndCampaigns.js';

const DND_LOG = '[D&D]';

// Preserved navigation callbacks for re-renders (fixes MID-1)
let _savedShowMainPage = null;
let _savedShowAdventure = null;

// ═══════════════════════════════════════════════════════════════════════
// Shared State — used by all DnD modules
// ═══════════════════════════════════════════════════════════════════════

let _isProcessing = false;
let _lastActionsHtml = '';
let _currentView = 'main'; // 'main' | 'creation' | 'adventure' | 'charCard' | 'history' | 'partnerGen' | 'inventory' | 'preparation'

export function isProcessing() { return _isProcessing; }
export function setProcessing(v) { _isProcessing = v; }
export function getLastActionsHtml() { return _lastActionsHtml; }
export function getCurrentView() { return _currentView; }
export function setCurrentView(v) { _currentView = v; }

// ═══════════════════════════════════════════════════════════════════════
// UI Utility Helpers
// ═══════════════════════════════════════════════════════════════════════

export function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function setActions(html) {
    const el = document.getElementById('dnd_actions');
    if (el) el.innerHTML = html;
    _lastActionsHtml = html;
}

export function refreshNarrative() {
    flushNarrative(); // ensure buffered entries are written before reading
    const run = getCurrentRun();
    if (!run) return;
    const el = document.getElementById('dnd_narrative');
    if (el) {
        el.innerHTML = run.narrativeLog.map(entry =>
            `<div class="dnd-narrative-entry ${entry.type}">${esc(entry.text)}</div>`
        ).join('');
        scrollNarrativeToBottom();
    }
}

export function scrollNarrativeToBottom() {
    const el = document.getElementById('dnd_narrative');
    if (el) el.scrollTop = el.scrollHeight;
}

/** Refresh player and partner HP bars in status bar. */
export function refreshHPBars() {
    const data = loadDndData();
    if (!data.playerCharacter || !data.partnerCharacter) return;

    const bars = document.querySelectorAll('.dnd-status-hp');
    if (bars.length >= 2) {
        // Player HP (first bar)
        const playerPercent = Math.round((data.playerCharacter.currentHP / data.playerCharacter.maxHP) * 100);
        const playerFill = bars[0].querySelector('.dnd-hp-fill');
        const playerText = bars[0].querySelector('.dnd-hp-text');
        if (playerFill) {
            playerFill.style.width = `${playerPercent}%`;
            playerFill.className = `dnd-hp-fill ${playerPercent <= 25 ? 'danger' : playerPercent <= 50 ? 'warning' : ''}`;
        }
        if (playerText) playerText.textContent = `${data.playerCharacter.currentHP}/${data.playerCharacter.maxHP}`;

        // Partner HP (second bar)
        const partnerPercent = Math.round((data.partnerCharacter.currentHP / data.partnerCharacter.maxHP) * 100);
        const partnerFill = bars[1].querySelector('.dnd-hp-fill');
        const partnerText = bars[1].querySelector('.dnd-hp-text');
        if (partnerFill) {
            partnerFill.style.width = `${partnerPercent}%`;
            partnerFill.className = `dnd-hp-fill ${partnerPercent <= 25 ? 'danger' : partnerPercent <= 50 ? 'warning' : ''}`;
        }
        if (partnerText) partnerText.textContent = `${data.partnerCharacter.currentHP}/${data.partnerCharacter.maxHP}`;
    }
}

/** Refresh room indicator in status bar. */
export function refreshRoomIndicator() {
    const el = document.querySelector('.dnd-room-indicator');
    if (!el) return;
    const run = getCurrentRun();
    if (!run) return;
    const campaign = getCampaignById(run.campaignId);
    el.textContent = `${campaign ? campaign.name : ''} ${run.currentRoom}/${run.totalRooms}`;
}

/**
 * Show a reroll button in the actions area for user-initiated retry.
 * @param {Function} retryFn - The function to call when the user clicks reroll
 */
export function showRerollButton(retryFn) {
    setActions(`<button class="dnd-action-btn" id="dnd_reroll_btn">
        <i class="ph ph-arrow-clockwise"></i> 重新掷骰</button>`);
    document.getElementById('dnd_reroll_btn')?.addEventListener('click', () => {
        _isProcessing = false;
        retryFn();
    });
}

/** Build compact spell slot indicator like ●●○ */
export function buildSpellSlotIndicator(char) {
    if (!char.spellSlots || !char.maxSpellSlots) return '';
    return Object.entries(char.maxSpellSlots).map(([key, total]) => {
        const remaining = char.spellSlots[key] || 0;
        return `${key}:${'●'.repeat(remaining)}${'○'.repeat(total - remaining)}`;
    }).join(' ');
}

// ═══════════════════════════════════════════════════════════════════════
// Character Card View
// ═══════════════════════════════════════════════════════════════════════

/**
 * Show character card page. Requires showMainPage and showAdventure callbacks
 * to handle navigation back.
 */
export function showCharacterCard(showMainPage, showAdventure) {
    _currentView = 'charCard';
    // Preserve valid callbacks for re-renders (fixes MID-1)
    if (showMainPage && typeof showMainPage === 'function' && showMainPage.toString() !== '() => {}') {
        _savedShowMainPage = showMainPage;
    }
    if (showAdventure && typeof showAdventure === 'function' && showAdventure.toString() !== '() => {}') {
        _savedShowAdventure = showAdventure;
    }
    const _goMain = _savedShowMainPage || (() => {});
    const _goAdventure = _savedShowAdventure || (() => {});

    const data = loadDndData();
    if (!data.playerCharacter) { _goMain(); return; }

    const playerDerived = getCharacterDerived(data.playerCharacter);
    const userName = getPhoneUserName();
    const charName = getPhoneCharInfo()?.name || '角色';

    let html = `<div class="dnd-page" id="dnd_root"><div class="dnd-creation">
        ${buildCharCardHtml(data.playerCharacter, playerDerived, userName, 'player')}`;

    if (data.partnerCharacter) {
        const partnerDerived = getCharacterDerived(data.partnerCharacter);
        html += buildCharCardHtml(data.partnerCharacter, partnerDerived, charName, 'partner');
    }

    html += `</div>
    <div class="dnd-prep-footer">
        <button class="dnd-confirm-btn" id="dnd_back_main">
            <i class="ph ph-arrow-left"></i> 返回
        </button>
    </div></div>`;

    openAppInViewport('D&D - 角色卡', html, () => {
        _bindCharCardEquipEvents();
        document.getElementById('dnd_back_main')?.addEventListener('click', () => {
            if (getCurrentRun()) _goAdventure();
            else _goMain();
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Character Card — Equipment Management
// ═══════════════════════════════════════════════════════════════════════

function _bindCharCardEquipEvents() {
    // Player unequip buttons
    document.querySelectorAll('.dnd-equip-unequip-btn[data-owner="player"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const item = btn.dataset.item;
            _handleUnequipItem(item, 'player');
        });
    });

    // Partner unequip buttons
    document.querySelectorAll('.dnd-equip-unequip-btn[data-owner="partner"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const item = btn.dataset.item;
            _handleUnequipItem(item, 'partner');
        });
    });

    // "Equip to partner" button
    document.getElementById('dnd_equip_to_partner')?.addEventListener('click', () => {
        _showEquipToPartnerPanel();
    });

    // "Equip to self" button
    document.getElementById('dnd_equip_to_player')?.addEventListener('click', () => {
        _showEquipToSelfPanel();
    });
}

function _showEquipToPartnerPanel() {
    const data = loadDndData();
    const playerChar = data.playerCharacter;
    if (!playerChar) return;

    const equipItems = playerChar.inventory.filter(item => {
        if (item.startsWith('[已装备]')) return false;
        const info = getItemInfo(item);
        return info.type === 'equipment';
    });

    if (equipItems.length === 0) {
        alert('背包中没有可装备的物品');
        return;
    }

    _showEquipSelectionModal(equipItems, 'partner');
}

function _showEquipToSelfPanel() {
    const data = loadDndData();
    const playerChar = data.playerCharacter;
    if (!playerChar) return;

    const equipItems = playerChar.inventory.filter(item => {
        if (item.startsWith('[已装备]')) return false;
        const info = getItemInfo(item);
        return info.type === 'equipment';
    });

    if (equipItems.length === 0) {
        alert('背包中没有可装备的物品');
        return;
    }

    _showEquipSelectionModal(equipItems, 'player');
}

function _showEquipSelectionModal(items, targetOwner) {
    document.getElementById('dnd_equip_modal')?.remove();

    const charName = getPhoneCharInfo()?.name || '角色';
    const targetLabel = targetOwner === 'partner' ? charName : getPhoneUserName();

    const modal = document.createElement('div');
    modal.id = 'dnd_equip_modal';
    modal.className = 'dnd-equip-modal-overlay';
    modal.innerHTML = `
        <div class="dnd-equip-modal">
            <div class="dnd-equip-modal-title">装备给 ${esc(targetLabel)}</div>
            <div class="dnd-equip-modal-list">
                ${items.map(item => {
                    const info = getItemInfo(item);
                    return `
                    <button class="dnd-equip-modal-item" data-item="${esc(item)}">
                        <i class="ph ${info.icon}"></i>
                        <div class="dnd-equip-modal-item-info">
                            <div class="dnd-equip-modal-item-name">${esc(item)}</div>
                            <div class="dnd-equip-modal-item-desc">${info.effect?.desc || ''}</div>
                        </div>
                    </button>`;
                }).join('')}
            </div>
            <button class="dnd-equip-modal-cancel" id="dnd_equip_modal_cancel">取消</button>
        </div>`;

    document.getElementById('dnd_root')?.appendChild(modal);

    modal.querySelector('#dnd_equip_modal_cancel')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });

    modal.querySelectorAll('.dnd-equip-modal-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const itemName = btn.dataset.item;
            modal.remove();
            if (targetOwner === 'partner') {
                _handleEquipToPartner(itemName);
            } else {
                _handleEquipToSelf(itemName);
            }
        });
    });
}

/**
 * Recalculate a character's AC from base class AC + equipment bonuses.
 * This prevents drift from repeated equip/unequip operations.
 */
function _recalcAC(char) {
    const cls = CLASSES.find(c => c.id === char.class);
    const dexMod = abilityModifier(char.stats.DEX);
    const conMod = abilityModifier(char.stats.CON);

    // Base AC (same logic as createCharacter)
    let baseAC;
    if (cls?.id === 'barbarian') {
        baseAC = 10 + dexMod + conMod;
    } else if (cls?.id === 'monk') {
        baseAC = 10 + dexMod + abilityModifier(char.stats.WIS);
    } else if (['fighter', 'paladin'].includes(cls?.id)) {
        baseAC = 16;
    } else if (['cleric', 'druid', 'ranger'].includes(cls?.id)) {
        baseAC = 14 + Math.min(dexMod, 2);
    } else {
        baseAC = 11 + dexMod;
    }

    // Add equipment AC bonuses from inventory
    let equipBonus = 0;
    for (const item of (char.inventory || [])) {
        if (!item.startsWith('[已装备]')) continue;
        const originalName = item.replace('[已装备] ', '');
        const info = getItemInfo(originalName);
        if (info.effect?.stat === 'ac') equipBonus += info.effect.bonus;
    }

    char.ac = baseAC + equipBonus;
}

function _handleEquipToPartner(itemName) {
    const data = loadDndData();
    const playerChar = data.playerCharacter;
    const partnerChar = data.partnerCharacter;
    if (!playerChar || !partnerChar) return;

    const idx = playerChar.inventory.indexOf(itemName);
    if (idx === -1) return;

    const info = getItemInfo(itemName);
    if (info.type !== 'equipment') return;

    playerChar.inventory.splice(idx, 1);
    partnerChar.inventory.push(`[已装备] ${itemName}`);
    _recalcAC(partnerChar);

    saveDndData(data);
    showCharacterCard(null, null); // preserved callbacks used automatically
}

function _handleEquipToSelf(itemName) {
    const data = loadDndData();
    const playerChar = data.playerCharacter;
    if (!playerChar) return;

    const idx = playerChar.inventory.indexOf(itemName);
    if (idx === -1) return;

    const info = getItemInfo(itemName);
    if (info.type !== 'equipment') return;

    playerChar.inventory[idx] = `[已装备] ${itemName}`;
    _recalcAC(playerChar);

    saveDndData(data);
    showCharacterCard(null, null); // preserved callbacks used automatically
}

function _handleUnequipItem(equippedItemName, owner) {
    const data = loadDndData();
    const char = owner === 'partner' ? data.partnerCharacter : data.playerCharacter;
    if (!char) return;

    const idx = char.inventory.indexOf(equippedItemName);
    if (idx === -1) return;

    const originalName = equippedItemName.replace('[已装备] ', '');

    if (owner === 'partner') {
        char.inventory.splice(idx, 1);
        data.playerCharacter.inventory.push(originalName);
    } else {
        char.inventory[idx] = originalName;
    }

    _recalcAC(char);

    saveDndData(data);
    showCharacterCard(null, null); // preserved callbacks used automatically
}

// ═══════════════════════════════════════════════════════════════════════
// Character Card HTML Builder
// ═══════════════════════════════════════════════════════════════════════

export function buildCharCardHtml(char, derived, displayName, ownerType = 'player') {
    const race = RACES.find(r => r.id === char.race);
    const cls = CLASSES.find(c => c.id === char.class);

    const statCells = ABILITY_ORDER.map(ability => {
        const val = char.stats[ability];
        const mod = abilityModifier(val);
        const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
        return `
            <div class="dnd-char-stat-cell">
                <div class="dnd-char-stat-label">${ABILITY_NAMES[ability]?.name || ability}</div>
                <div class="dnd-char-stat-val">${val}</div>
                <div class="dnd-char-stat-mod">${modStr}</div>
            </div>`;
    }).join('');

    const xp = char.xp || 0;
    const xpNeeded = getXpForNextLevel(char.level);
    const xpPercent = Math.min(100, Math.round((xp / xpNeeded) * 100));

    let spellSlotsHtml = '';
    if (char.maxSpellSlots) {
        spellSlotsHtml = `
        <div class="dnd-card-section">
            <div class="dnd-card-section-title">法术位</div>
            <div class="dnd-spell-slots-row">
                ${Object.entries(char.maxSpellSlots).map(([key, total]) => {
            const remaining = char.spellSlots?.[key] || 0;
            return `<span class="dnd-slot-group">${key}: ${'●'.repeat(remaining)}${'○'.repeat(total - remaining)}</span>`;
        }).join('')}
            </div>
        </div>`;
    }

    let spellsHtml = '';
    if (char.knownSpells && char.knownSpells.length > 0) {
        spellsHtml = `
        <div class="dnd-card-section">
            <div class="dnd-card-section-title">已知法术</div>
            <div class="dnd-card-spells">${char.knownSpells.map(s => `<span class="dnd-tag">${esc(s)}</span>`).join('')}</div>
        </div>`;
    }

    const equippedItems = (char.inventory || []).filter(i => i.startsWith('[已装备]'));
    let equipHtml = '';
    if (equippedItems.length > 0) {
        equipHtml = `
        <div class="dnd-card-section dnd-equip-section">
            <div class="dnd-card-section-title"><i class="ph ph-shield-star"></i> 装备</div>
            ${equippedItems.map(item => {
                const originalName = item.replace('[已装备] ', '');
                const info = getItemInfo(originalName);
                return `
                <div class="dnd-equip-slot">
                    <i class="ph ${info.icon}"></i>
                    <div class="dnd-equip-slot-info">
                        <div class="dnd-equip-slot-name">${esc(originalName)}</div>
                        <div class="dnd-equip-slot-desc">${info.effect?.desc || ''}</div>
                    </div>
                    <button class="dnd-equip-unequip-btn" data-item="${esc(item)}" data-owner="${ownerType}">卸下</button>
                </div>`;
            }).join('')}
        </div>`;
    }

    let equipActionHtml = '';
    if (_currentView === 'charCard') {
        if (ownerType === 'partner') {
            equipActionHtml = `<button class="dnd-equip-action-btn" id="dnd_equip_to_partner"><i class="ph ph-arrow-circle-down"></i> 从背包装备给TA</button>`;
        } else {
            equipActionHtml = `<button class="dnd-equip-action-btn" id="dnd_equip_to_player"><i class="ph ph-arrow-circle-down"></i> 从背包装备</button>`;
        }
    }

    return `
        <div class="dnd-char-card">
            <div class="dnd-char-card-header">
                <div class="dnd-char-card-icon"><i class="ph ${cls?.icon || 'ph-user'}"></i></div>
                <div class="dnd-char-card-info">
                    <div class="dnd-char-card-name">${esc(displayName)}</div>
                    <div class="dnd-char-card-class">${race?.name || '???'} ${cls?.name || '???'} Lv.${char.level} | HP ${char.currentHP}/${char.maxHP} | AC ${char.ac}</div>
                </div>
            </div>
            <div class="dnd-xp-section">
                <div class="dnd-xp-info">
                    <span>XP ${xp} / ${xpNeeded}</span>
                    ${char.gold !== undefined ? `<span><i class="ph ph-coins"></i> ${char.gold} gp</span>` : ''}
                </div>
                <div class="dnd-xp-bar"><div class="dnd-xp-fill" style="width:${xpPercent}%"></div></div>
            </div>
            <div class="dnd-char-card-stats">${statCells}</div>
            ${spellSlotsHtml}
            ${spellsHtml}
            ${equipHtml}
            ${equipActionHtml}
        </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// Inventory Page
// ═══════════════════════════════════════════════════════════════════════

export function showInventoryPage(showMainPage, showAdventure, handleUseItemOutsideCombat) {
    _currentView = 'inventory';
    const data = loadDndData();
    const playerChar = data.playerCharacter;
    if (!playerChar) { showMainPage(); return; }

    const gold = playerChar.gold || 0;
    const html = `<div class="dnd-page" id="dnd_root"><div class="dnd-creation">
        <div class="dnd-creation-title">背包</div>
        <div class="dnd-inventory-gold"><i class="ph ph-coins"></i> ${gold} gp</div>
        <div class="dnd-category-tabs" id="dnd_inv_tabs">
            ${SHOP_CATEGORIES.map(cat => `
                <button class="dnd-category-tab ${cat.id === 'all' ? 'active' : ''}" data-category="${cat.id}">
                    <i class="ph ${cat.icon}"></i> ${esc(cat.name)}
                </button>
            `).join('')}
        </div>
        <div class="dnd-inventory-grid" id="dnd_inventory_list">
            ${buildInventoryGrid(playerChar.inventory)}
        </div>
    </div>
    <div class="dnd-prep-footer">
        <button class="dnd-confirm-btn" id="dnd_back_main">
            <i class="ph ph-arrow-left"></i> 返回
        </button>
    </div></div>`;

    openAppInViewport('D&D - 背包', html, () => {
        bindInventoryUseButtons(showAdventure, handleUseItemOutsideCombat);
        _bindInventoryTabs();
        document.getElementById('dnd_back_main')?.addEventListener('click', () => {
            if (getCurrentRun()) showAdventure();
            else showMainPage();
        });
    });
}

export function buildInventoryGrid(inventory) {
    if (!inventory || inventory.length === 0) {
        return '<div class="dnd-empty"><div class="dnd-empty-icon"><i class="ph ph-backpack"></i></div><div class="dnd-empty-title">背包空空</div></div>';
    }
    return inventory.map(item => {
        const info = getItemInfo(item);
        const category = getItemCategory(item);
        const isEquipped = item.startsWith('[已装备]');
        const displayName = isEquipped ? item.replace('[已装备] ', '') : item;
        const btnHtml = info.usable
            ? `<button class="dnd-grid-use-btn" data-item="${esc(item)}">${isEquipped ? '卸下' : info.label}</button>`
            : '';
        return `
        <div class="dnd-inventory-card ${isEquipped ? 'equipped' : ''}" data-category="${category}">
            <div class="dnd-inventory-card-icon"><i class="ph ${info.icon}"></i></div>
            <div class="dnd-inventory-card-name">${esc(displayName)}</div>
            ${isEquipped ? '<div class="dnd-inventory-card-tag">已装备</div>' : ''}
            ${btnHtml}
        </div>`;
    }).join('');
}

/** Bind inventory category tab click handlers. */
function _bindInventoryTabs() {
    document.querySelectorAll('#dnd_inv_tabs .dnd-category-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#dnd_inv_tabs .dnd-category-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const cat = tab.dataset.category;
            document.querySelectorAll('#dnd_inventory_list .dnd-inventory-card').forEach(card => {
                card.style.display = (cat === 'all' || card.dataset.category === cat) ? '' : 'none';
            });
        });
    });
}

/** Refresh inventory list in the overlay (if visible). */
export function refreshInventoryList(showAdventure, handleUseItemOutsideCombat) {
    const listEl = document.getElementById('dnd_inventory_list');
    if (!listEl) return;
    const data = loadDndData();
    listEl.innerHTML = buildInventoryGrid(data.playerCharacter?.inventory || []);
    bindInventoryUseButtons(showAdventure, handleUseItemOutsideCombat);
}

/** Bind click handlers on inventory '使用' buttons. */
export function bindInventoryUseButtons(showAdventure, handleUseItemOutsideCombat) {
    document.querySelectorAll('.dnd-grid-use-btn, .dnd-use-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const itemName = btn.dataset.item;
            if (!itemName) return;
            showAdventure();
            handleUseItemOutsideCombat(itemName);
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// History View
// ═══════════════════════════════════════════════════════════════════════

export function showHistory(showMainPage) {
    _currentView = 'history';
    const data = loadDndData();
    const history = data.history || [];

    let content;
    if (history.length === 0) {
        content = `<div class="dnd-empty">
            <div class="dnd-empty-icon"><i class="ph ph-scroll"></i></div>
            <div class="dnd-empty-title">还没有冒险记录</div>
            <div class="dnd-empty-desc">完成一次冒险后，记录就会出现在这里</div>
        </div>`;
    } else {
        content = `<div class="dnd-history-list">
            ${history.map(h => `
                <div class="dnd-history-item">
                    <div class="dnd-history-date">${h.date}</div>
                    <div class="dnd-history-campaign">${esc(h.campaign || h.campaignId)}</div>
                    <span class="dnd-history-result ${h.result}">${h.result === 'victory' ? '胜利' : h.result === 'defeat' ? '失败' : '撤退'}</span>
                    ${h.highlights ? `<div class="dnd-history-highlight">${esc(h.highlights)}</div>` : ''}
                    <div class="dnd-history-xp">+${h.xpGained || 0} XP | 战利品：${(h.loot || []).join('、') || '无'}</div>
                </div>
            `).reverse().join('')}
        </div>`;
    }

    const html = `<div class="dnd-page" id="dnd_root">
        <div style="padding:12px">
            <div class="dnd-creation-title">冒险记录</div>
        </div>
        ${content}
        <div class="dnd-bottom-bar">
            <button class="dnd-bottom-btn" id="dnd_back_main"><i class="ph ph-arrow-left"></i> 返回</button>
        </div>
    </div>`;

    openAppInViewport('D&D - 冒险记录', html, () => {
        document.getElementById('dnd_back_main')?.addEventListener('click', () => showMainPage());
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Epilogue (后日谈) View
// ═══════════════════════════════════════════════════════════════════════

export function showEpiloguePage(showMainPage) {
    _currentView = 'epilogue';
    const epilogues = getEpilogues();
    const charName = getPhoneCharInfo()?.name || '角色';

    let content;
    if (epilogues.length === 0) {
        content = `<div class="dnd-empty">
            <div class="dnd-empty-icon"><i class="ph ph-notebook"></i></div>
            <div class="dnd-empty-title">还没有后日谈</div>
            <div class="dnd-empty-desc">通关一次冒险后，${esc(charName)}会在这里写下日记</div>
        </div>`;
    } else {
        content = `<div class="dnd-epilogue-list">
            ${epilogues.map((ep, i) => {
                const preview = ep.diaryText.length > 60 ? ep.diaryText.substring(0, 60) + '…' : ep.diaryText;
                return `
                <div class="dnd-epilogue-card" data-index="${i}">
                    <div class="dnd-epilogue-header">
                        <div class="dnd-epilogue-campaign"><i class="ph ph-map-trifold"></i> ${esc(ep.campaignName)}</div>
                        <div class="dnd-epilogue-date">${esc(ep.date)}</div>
                    </div>
                    <div class="dnd-epilogue-preview" id="dnd_ep_preview_${i}">${esc(preview)}</div>
                    <div class="dnd-epilogue-full" id="dnd_ep_full_${i}" style="display:none">${esc(ep.diaryText)}</div>
                    ${ep.diaryText.length > 60 ? `<button class="dnd-epilogue-toggle" data-index="${i}"><i class="ph ph-caret-down"></i> 展开</button>` : ''}
                </div>`;
            }).reverse().join('')}
        </div>`;
    }

    const html = `<div class="dnd-page" id="dnd_root">
        <div style="padding:12px">
            <div class="dnd-creation-title">后日谈</div>
            <div class="dnd-creation-subtitle">${esc(charName)}的冒险日记</div>
        </div>
        ${content}
        <div class="dnd-bottom-bar">
            <button class="dnd-bottom-btn" id="dnd_back_main"><i class="ph ph-arrow-left"></i> 返回</button>
        </div>
    </div>`;

    openAppInViewport('D&D - 后日谈', html, () => {
        document.getElementById('dnd_back_main')?.addEventListener('click', () => showMainPage());

        // Toggle expand/collapse
        document.querySelectorAll('.dnd-epilogue-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = btn.dataset.index;
                const preview = document.getElementById(`dnd_ep_preview_${idx}`);
                const full = document.getElementById(`dnd_ep_full_${idx}`);
                if (!preview || !full) return;

                const isExpanded = full.style.display !== 'none';
                preview.style.display = isExpanded ? '' : 'none';
                full.style.display = isExpanded ? 'none' : '';
                btn.innerHTML = isExpanded
                    ? '<i class="ph ph-caret-down"></i> 展开'
                    : '<i class="ph ph-caret-up"></i> 收起';
            });
        });
    });
}

// modules/phone/shop/shopTreeBridge.js — Bridge between shop and tree storage
// Maps tree buff items to treeStorage API calls for instant consumption.

import { getShopItem } from './shopData.js';
import {
    addGrowth, updateTreeState, loadTreeData, updateGameHistory,
} from '../tree/treeStorage.js';

const BRIDGE_LOG = '[Shop→Tree]';

/**
 * Apply a tree buff item immediately.
 * Called from shopStorage.activateItem when effectType === 'treeBuff'.
 * @param {string} itemId - Shop item ID
 * @returns {{ success: boolean, message: string }}
 */
export function applyTreeBuff(itemId) {
    const item = getShopItem(itemId);
    if (!item || !item.treeEffect) {
        return { success: false, message: '未知的树道具' };
    }

    // Check if tree has been adopted
    const data = loadTreeData();
    if (!data.treeState.treeName) {
        return { success: false, message: '请先在「树树」App 中领养一棵小树！' };
    }

    const effect = item.treeEffect;

    switch (effect.type) {
        case 'growth': {
            const result = addGrowth(effect.amount);
            console.log(`${BRIDGE_LOG} ${item.name}: 成长值 +${effect.amount} → ${result.newGrowth}`);
            const extra = result.stageChanged ? ' 树升级了！' : '';
            return { success: true, message: `${item.name}：成长值 +${effect.amount}${extra}` };
        }

        case 'bonusCare': {
            const state = data.treeState;
            const newBonus = (state.bonusCareCount || 0) + effect.amount;
            updateTreeState({ bonusCareCount: newBonus });
            console.log(`${BRIDGE_LOG} ${item.name}: 额外照顾次数 +${effect.amount} → ${newBonus}`);
            return { success: true, message: `${item.name}：额外照顾次数 +${effect.amount}` };
        }

        case 'bonusGacha': {
            const history = data.gameHistory;
            // Reduce used count (allowing more free pulls today)
            const newUsed = Math.max(0, (history.dailyGachaUsed || 0) - effect.amount);
            updateGameHistory({ dailyGachaUsed: newUsed });
            console.log(`${BRIDGE_LOG} ${item.name}: 额外扭蛋次数 +${effect.amount}`);
            return { success: true, message: `${item.name}：额外扭蛋机会 +${effect.amount}` };
        }

        default:
            return { success: false, message: `未知效果类型: ${effect.type}` };
    }
}


// modules/phone/shop/shopApi.js — Shop-specific API functions
// Moved from moments/apiClient.js to respect single responsibility.

import { apiRequest } from '../moments/apiClient.js';
import { getSettings } from '../moments/state.js';

// ═══════════════════════════════════════════════════════════════════════
// Shop Reviews API（服务器端评价存储）
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fetch all reviews for a shop item from the remote server.
 * Returns an empty array if backend is not configured or request fails.
 */
export async function getShopReviews(itemId) {
    const settings = getSettings();
    if (!settings.backendUrl || !settings.secretToken) return [];
    try {
        const result = await apiRequest('GET', `/api/shop/reviews/${encodeURIComponent(itemId)}`);
        return result.reviews || [];
    } catch (e) {
        console.warn('[Shop] Failed to fetch remote reviews:', e);
        return [];
    }
}

/**
 * Post a new review for a shop item to the remote server.
 */
export async function postShopReview(itemId, review) {
    const settings = getSettings();
    return apiRequest('POST', `/api/shop/reviews/${encodeURIComponent(itemId)}`, {
        ...review,
        userId: settings.userId || 'anonymous',
    });
}

/**
 * Delete a review from the remote server by its server-side ID.
 * Silently no-ops if backend is not configured.
 */
export async function deleteShopReview(itemId, reviewId) {
    const settings = getSettings();
    if (!settings.backendUrl || !settings.secretToken) return;
    try {
        await apiRequest('DELETE', `/api/shop/reviews/${encodeURIComponent(itemId)}/${encodeURIComponent(reviewId)}`);
    } catch (e) {
        console.warn('[Shop] Failed to delete remote review:', e);
    }
}

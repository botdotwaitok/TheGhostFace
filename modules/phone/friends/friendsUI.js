// phone/friends/friendsUI.js — Friends list UI (decoupled from Moments)

import { addFriend, removeFriend, listFriends } from '../moments/apiClient.js';
import { showToast } from '../moments/momentsUI.js';
import { escapeHtml } from '../utils/helpers.js';

/**
 * Load and render the friends list into the container identified by `${prefix}_friends_list`.
 */
export async function loadFriendsUI(prefix = 'phone_friends') {
    const listEl = document.getElementById(`${prefix}_friends_list`);
    if (!listEl) return;

    try {
        const result = await listFriends();
        if (!result.ok || result.friends.length === 0) {
            listEl.innerHTML = '<div class="moments-empty-state">暂无好友</div>';
            return;
        }

        listEl.innerHTML = result.friends.map(f => `
            <div class="moments-friend-item" data-friend-id="${f.id}">
                <div class="moments-friend-avatar">
                    ${f.avatarUrl ? `<img src="${escapeHtml(f.avatarUrl)}" />` : '<i class="fa-solid fa-user"></i>'}
                </div>
                <div class="moments-friend-info">
                    <div class="moments-friend-name">${escapeHtml(f.displayName)}</div>
                    <div class="moments-friend-id">${f.id.substring(0, 8)}...</div>
                </div>
                <button class="moments-friend-remove moments-small-btn" data-remove-id="${f.id}" title="删除好友">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `).join('');

        // Bind remove buttons
        listEl.querySelectorAll('.moments-friend-remove').forEach(btn => {
            btn.addEventListener('click', async () => {
                const fid = btn.dataset.removeId;
                if (confirm(`确定删除好友?`)) {
                    try {
                        await removeFriend(fid);
                        showToast('好友已删除');
                        loadFriendsUI(prefix);
                    } catch (e) {
                        showToast('删除失败: ' + e.message);
                    }
                }
            });
        });
    } catch (e) {
        listEl.innerHTML = `<div class="moments-empty-state">加载失败: ${e.message}</div>`;
    }
}

/**
 * Read the friend ID from the input and send an add-friend request.
 */
export async function addFriendFromUI(prefix = 'phone_friends') {
    const input = document.getElementById(`${prefix}_add_friend_id`);
    const friendId = input?.value?.trim();
    if (!friendId) return showToast('请输入好友ID');

    try {
        await addFriend(friendId);
        input.value = '';
        showToast('好友已添加 🎉');
        loadFriendsUI(prefix);
    } catch (e) {
        showToast('添加失败: ' + e.message);
    }
}

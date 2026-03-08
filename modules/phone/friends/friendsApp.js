// ui/phone/friends/friendsApp.js — Friends app for the GF Phone
// Extracted from phoneController.js for modular organization.

import { openAppInViewport } from '../phoneController.js';
import { loadFriendsUI, addFriendFromUI, onClick } from '../moments/momentsUI.js';

export function openFriendsApp() {
    const P = 'phone_friends'; // prefix for unique IDs
    const html = `
    <div class="phone-friends-page">
        <div class="phone-friends-card">
            <div class="phone-settings-group-title">添加好友</div>
            <div class="phone-settings-row">
                <label>输入对方ID</label>
                <div class="phone-settings-id-row">
                    <input id="${P}_add_friend_id" type="text" class="phone-settings-input" placeholder="好友的UUID" />
                    <button id="${P}_add_friend_btn" class="phone-settings-small-btn phone-settings-btn-primary" title="添加">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                </div>
            </div>
        </div>
        <div class="phone-friends-card">
            <div class="phone-settings-group-title">我的好友</div>
            <div id="${P}_friends_list" class="phone-friends-list">
                <div class="phone-settings-coming-soon">加载中...</div>
            </div>
        </div>
    </div>
    `;

    openAppInViewport('好友', html, () => {
        loadFriendsUI(P);
        onClick(`${P}_add_friend_btn`, () => addFriendFromUI(P));
    });
}

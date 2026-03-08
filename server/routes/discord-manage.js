// server/routes/discord-manage.js — Discord 侧管理朋友圈账号
// 内部 API，通过 Bearer Token 鉴权（与其他 /api 路由相同），
// 供 Petbot 等服务端调用，不通过 session。

const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db');

const router = express.Router();

// ── Helper: hash password (same algorithm as auth.js) ───────────────
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return { salt, hash };
}

// ── GET /api/discord-manage/profile ─────────────────────────────────
// Query: ?discordId=123456789
// Returns the Moments user profile linked to this Discord ID.
router.get('/profile', (req, res) => {
    try {
        const { discordId } = req.query;
        if (!discordId) {
            return res.status(400).json({ error: 'discordId is required' });
        }

        const db = getDb();

        // Debug: list all users with discordId set
        const allBound = db.prepare("SELECT id, username, displayName, discordId FROM users WHERE discordId IS NOT NULL AND LENGTH(discordId) > 0").all();
        console.log(`[DiscordManage] Looking for discordId="${String(discordId)}", type=${typeof discordId}`);
        console.log(`[DiscordManage] All bound users:`, JSON.stringify(allBound));

        const user = db.prepare(
            'SELECT username, displayName, bio, avatarUrl, createdAt FROM users WHERE discordId = ?'
        ).get(String(discordId));

        if (!user) {
            console.log(`[DiscordManage] No user found for discordId="${String(discordId)}"`);
            return res.status(404).json({ error: '未找到绑定的朋友圈账号' });
        }

        console.log(`[DiscordManage] Found user: ${user.username} / ${user.displayName}`);
        res.json({ ok: true, user });
    } catch (err) {
        console.error('[DiscordManage] profile error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /api/discord-manage/change-password ────────────────────────
// Body: { discordId: string, newPassword: string }
// Changes the password of the Moments user linked to this Discord ID.
router.post('/change-password', (req, res) => {
    try {
        const { discordId, newPassword } = req.body;

        if (!discordId) {
            return res.status(400).json({ error: 'discordId is required' });
        }
        if (!newPassword || newPassword.length < 4) {
            return res.status(400).json({ error: '密码长度至少 4 位' });
        }

        const db = getDb();
        const user = db.prepare('SELECT id, username FROM users WHERE discordId = ?').get(String(discordId));

        if (!user) {
            return res.status(404).json({ error: '未找到绑定的朋友圈账号' });
        }

        const { salt, hash } = hashPassword(newPassword);
        db.prepare('UPDATE users SET passwordHash = ?, salt = ? WHERE id = ?').run(hash, salt, user.id);

        res.json({ ok: true, message: '密码修改成功' });
    } catch (err) {
        console.error('[DiscordManage] change-password error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;

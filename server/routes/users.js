// server/routes/users.js — User registration & friend management
const express = require('express');
const { getDb } = require('../db');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// ─── POST /api/users/register ───────────────────────────────────────
// Create or update a user profile.
// Body: { id?, displayName, avatarUrl?, bio? }
// If id is provided and exists, update. Otherwise create new.
router.post('/register', (req, res) => {
    try {
        const { id, displayName, avatarUrl, bio } = req.body;
        if (!displayName || !displayName.trim()) {
            return res.status(400).json({ error: 'displayName is required' });
        }

        const db = getDb();
        const userId = id || uuidv4();

        const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
        if (existing) {
            db.prepare(`
                UPDATE users SET displayName = ?, avatarUrl = ?, bio = ? WHERE id = ?
            `).run(displayName.trim(), avatarUrl || '', bio || '', userId);
        } else {
            db.prepare(`
                INSERT INTO users (id, displayName, avatarUrl, bio) VALUES (?, ?, ?, ?)
            `).run(userId, displayName.trim(), avatarUrl || '', bio || '');
        }

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        res.json({ ok: true, user });
    } catch (err) {
        console.error('[Users] register error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── GET /api/users/:id ─────────────────────────────────────────────
// Get user profile
router.get('/:id', (req, res) => {
    try {
        const db = getDb();
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ ok: true, user });
    } catch (err) {
        console.error('[Users] get user error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── POST /api/users/friends ────────────────────────────────────────
// Add a friend (bidirectional).
// Body: { userId, friendId }
router.post('/friends', (req, res) => {
    try {
        const { userId, friendId } = req.body;
        if (!userId || !friendId) {
            return res.status(400).json({ error: 'userId and friendId are required' });
        }
        if (userId === friendId) {
            return res.status(400).json({ error: 'Cannot add yourself as a friend' });
        }

        const db = getDb();

        // Verify both users exist
        const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
        const friend = db.prepare('SELECT id FROM users WHERE id = ?').get(friendId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!friend) return res.status(404).json({ error: 'Friend user not found' });

        // Insert bidirectional friendship (ignore if already exists)
        const insert = db.prepare(`
            INSERT OR IGNORE INTO friends (userId, friendId) VALUES (?, ?)
        `);
        const addBoth = db.transaction(() => {
            insert.run(userId, friendId);
            insert.run(friendId, userId);
        });
        addBoth();

        res.json({ ok: true, message: 'Friend added' });
    } catch (err) {
        console.error('[Users] add friend error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── DELETE /api/users/friends/:userId/:friendId ────────────────────
// Remove a friend (bidirectional) — URL params version (preferred).
router.delete('/friends/:userId/:friendId', (req, res) => {
    try {
        const { userId, friendId } = req.params;
        if (!userId || !friendId) {
            return res.status(400).json({ error: 'userId and friendId are required' });
        }

        const db = getDb();
        const del = db.prepare('DELETE FROM friends WHERE userId = ? AND friendId = ?');
        const removeBoth = db.transaction(() => {
            del.run(userId, friendId);
            del.run(friendId, userId);
        });
        removeBoth();

        res.json({ ok: true, message: 'Friend removed' });
    } catch (err) {
        console.error('[Users] remove friend error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── DELETE /api/users/friends (legacy, body-based) ─────────────────
// Kept for backward compatibility. Prefer the URL params version above.
router.delete('/friends', (req, res) => {
    try {
        const { userId, friendId } = req.body;
        if (!userId || !friendId) {
            return res.status(400).json({ error: 'userId and friendId are required' });
        }

        const db = getDb();
        const del = db.prepare('DELETE FROM friends WHERE userId = ? AND friendId = ?');
        const removeBoth = db.transaction(() => {
            del.run(userId, friendId);
            del.run(friendId, userId);
        });
        removeBoth();

        res.json({ ok: true, message: 'Friend removed' });
    } catch (err) {
        console.error('[Users] remove friend error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── GET /api/users/:id/friends ─────────────────────────────────────
// List all friends of a user
router.get('/:id/friends', (req, res) => {
    try {
        const db = getDb();
        const friends = db.prepare(`
            SELECT u.id, u.displayName, u.avatarUrl, u.bio, u.discordId, f.createdAt as friendsSince
            FROM friends f
            JOIN users u ON u.id = f.friendId
            WHERE f.userId = ?
            ORDER BY u.displayName
        `).all(req.params.id);

        res.json({ ok: true, friends });
    } catch (err) {
        console.error('[Users] list friends error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── PUT /api/users/:id/settings ────────────────────────────────────
// Update user settings
// Body: { settings: object }
router.put('/:id/settings', (req, res) => {
    try {
        const { settings } = req.body;
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ error: 'Valid settings object is required' });
        }

        const db = getDb();
        const userId = req.params.id;

        const stringifiedSettings = JSON.stringify(settings);

        const result = db.prepare(`
            UPDATE users SET settings = ? WHERE id = ?
        `).run(stringifiedSettings, userId);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ ok: true, message: 'Settings updated successfully' });
    } catch (err) {
        console.error('[Users] update settings error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── PUT /api/users/:id/profile ─────────────────────────────────────
// Update profile page fields: signature, coverImageUrl, pinnedContent
// Body: { signature?, coverImageUrl?, pinnedContent? }
router.put('/:id/profile', (req, res) => {
    try {
        const db = getDb();
        const userId = req.params.id;

        // Build dynamic update — only set fields that are provided
        const updates = [];
        const params = [];

        if (req.body.signature !== undefined) {
            updates.push('signature = ?');
            params.push(req.body.signature);
        }
        if (req.body.coverImageUrl !== undefined) {
            updates.push('coverImageUrl = ?');
            params.push(req.body.coverImageUrl);
        }
        if (req.body.pinnedContent !== undefined) {
            updates.push('pinnedContent = ?');
            params.push(typeof req.body.pinnedContent === 'string'
                ? req.body.pinnedContent
                : JSON.stringify(req.body.pinnedContent));
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No profile fields to update' });
        }

        params.push(userId);
        const result = db.prepare(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
        ).run(...params);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        res.json({ ok: true, user });
    } catch (err) {
        console.error('[Users] update profile error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── PUT /api/users/:id/discord ─────────────────────────────────────
// Bind Discord ID via verification code from Petbot.
// Body: { code: string }
router.put('/:id/discord', async (req, res) => {
    try {
        const { code } = req.body;
        if (!code || !code.trim()) {
            return res.status(400).json({ error: '请输入绑定码' });
        }

        const trimmedCode = code.trim().toUpperCase();

        // Verify the code with Petbot API
        const PETBOT_API_URL = (process.env.PETBOT_API_URL || 'http://127.0.0.1:8900').replace(/\/+$/, '');
        const PETBOT_API_TOKEN = process.env.PETBOT_API_TOKEN || '';

        const headers = { 'Content-Type': 'application/json' };
        if (PETBOT_API_TOKEN) {
            headers['Authorization'] = `Bearer ${PETBOT_API_TOKEN}`;
        }

        const verifyResp = await fetch(`${PETBOT_API_URL}/api/verify-bind-code`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ code: trimmedCode }),
        });

        const verifyData = await verifyResp.json();
        if (!verifyResp.ok) {
            return res.status(verifyResp.status).json({
                error: verifyData.error || '绑定码验证失败'
            });
        }

        const discordId = String(verifyData.user_id);
        const db = getDb();
        const userId = req.params.id;

        // Check if this Discord ID is already bound to another user
        const existing = db.prepare('SELECT id FROM users WHERE discordId = ? AND id != ?').get(discordId, userId);
        if (existing) {
            return res.status(409).json({ error: '此 Discord 账号已绑定到其他用户' });
        }

        const result = db.prepare('UPDATE users SET discordId = ? WHERE id = ?').run(discordId, userId);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ ok: true, discordId });
    } catch (err) {
        console.error('[Users] bind discord error:', err);
        if (err.message?.includes('UNIQUE constraint')) {
            return res.status(409).json({ error: '此 Discord 账号已绑定到其他用户' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;

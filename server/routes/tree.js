// server/routes/tree.js — 树树 cloud persistence
// Simple GET/POST for tree data backup & cross-device restore.

const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

// ── GET /api/tree/:userId — 获取树数据 ──────────────────────────────
router.get('/:userId', (req, res) => {
    try {
        const { userId } = req.params;
        const db = getDb();
        const row = db.prepare('SELECT data, updatedAt FROM tree_data WHERE userId = ?').get(userId);

        if (!row) {
            return res.json({ ok: true, data: null });
        }

        let parsed = {};
        try {
            parsed = JSON.parse(row.data);
        } catch (e) {
            console.warn('[Tree] Failed to parse stored tree data for', userId);
        }

        res.json({ ok: true, data: parsed, updatedAt: row.updatedAt });
    } catch (err) {
        console.error('[Tree] GET error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/tree/:userId — 保存树数据 ─────────────────────────────
router.post('/:userId', (req, res) => {
    try {
        const { userId } = req.params;
        const { data } = req.body;

        if (!data || typeof data !== 'object') {
            return res.status(400).json({ error: 'data must be a non-null object' });
        }

        const db = getDb();
        const jsonStr = JSON.stringify(data);

        db.prepare(`
            INSERT INTO tree_data (userId, data, updatedAt)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(userId) DO UPDATE SET
                data = excluded.data,
                updatedAt = excluded.updatedAt
        `).run(userId, jsonStr);

        res.json({ ok: true, message: '树数据已保存' });
    } catch (err) {
        console.error('[Tree] POST error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

// server/routes/dnd.js — D&D cloud persistence
// Simple GET/POST for D&D data backup & cross-device sync.
// Same pattern as tree.js.

const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

// ── GET /api/dnd/:userId — 获取 D&D 存档 ──────────────────────────
router.get('/:userId', (req, res) => {
    try {
        const { userId } = req.params;
        const db = getDb();
        const row = db.prepare('SELECT data, updatedAt FROM dnd_data WHERE userId = ?').get(userId);

        if (!row) {
            return res.json({ ok: true, data: null });
        }

        let parsed = {};
        try {
            parsed = JSON.parse(row.data);
        } catch (e) {
            console.warn('[D&D] Failed to parse stored data for', userId);
        }

        res.json({ ok: true, data: parsed, updatedAt: row.updatedAt });
    } catch (err) {
        console.error('[D&D] GET error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/dnd/:userId — 保存 D&D 存档 ─────────────────────────
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
            INSERT INTO dnd_data (userId, data, updatedAt)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(userId) DO UPDATE SET
                data = excluded.data,
                updatedAt = excluded.updatedAt
        `).run(userId, jsonStr);

        res.json({ ok: true, message: 'D&D 数据已保存' });
    } catch (err) {
        console.error('[D&D] POST error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

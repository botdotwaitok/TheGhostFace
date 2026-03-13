// server/routes/calendar.js — 日历节日云推送路由
// 从 data/holidays.json 读取管理员手动维护的节日数据

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const HOLIDAYS_FILE = path.join(__dirname, '..', 'data', 'holidays.json');

/**
 * GET /api/calendar/holidays
 * 返回当年的节日数据（管理员手动维护）
 * 无需 session（公共 API，仅需 Bearer Token）
 */
router.get('/holidays', (_req, res) => {
    try {
        if (!fs.existsSync(HOLIDAYS_FILE)) {
            return res.json({ year: new Date().getFullYear(), holidays: [], updatedAt: null });
        }
        const raw = fs.readFileSync(HOLIDAYS_FILE, 'utf-8');
        const data = JSON.parse(raw);
        res.json(data);
    } catch (e) {
        console.error('[Calendar] Failed to read holidays:', e.message);
        res.status(500).json({ error: 'Failed to read holidays data' });
    }
});

/**
 * PUT /api/calendar/holidays
 * 管理员更新节日数据（通过 Dashboard 或手动调用）
 * Body: { year, holidays: [{ date, name, emoji, category? }], updatedAt }
 */
router.put('/holidays', (req, res) => {
    try {
        const data = req.body;
        if (!data || !Array.isArray(data.holidays)) {
            return res.status(400).json({ error: 'Invalid data format' });
        }

        // Ensure data directory exists
        const dataDir = path.dirname(HOLIDAYS_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        data.updatedAt = new Date().toISOString();
        fs.writeFileSync(HOLIDAYS_FILE, JSON.stringify(data, null, 2), 'utf-8');
        res.json({ ok: true, updatedAt: data.updatedAt, count: data.holidays.length });
    } catch (e) {
        console.error('[Calendar] Failed to save holidays:', e.message);
        res.status(500).json({ error: 'Failed to save holidays data' });
    }
});

module.exports = router;

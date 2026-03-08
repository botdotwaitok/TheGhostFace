// server/routes/shop.js — Shop Reviews + Dynamic Catalog API
const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const fs = require('fs');
const path = require('path');

// Path to the dynamic shop data override file
const SHOP_DATA_FILE = path.join(__dirname, '..', 'shopData.json');

// ── Catalog helpers ──────────────────────────────────────────────────────────

function readCatalog() {
    try {
        if (!fs.existsSync(SHOP_DATA_FILE)) return null;
        return JSON.parse(fs.readFileSync(SHOP_DATA_FILE, 'utf-8'));
    } catch {
        return null;
    }
}

function writeCatalog(data) {
    fs.writeFileSync(SHOP_DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ── GET /api/shop/catalog ────────────────────────────────────────────────────
// Returns the dynamic shop catalog (items + categories). Requires Bearer auth.
// Returns null if no override has been set yet (plugin falls back to built-in defaults).
router.get('/catalog', (req, res) => {
    try {
        const data = readCatalog();
        res.json({ ok: true, data }); // data === null means "no override, use defaults"
    } catch (err) {
        console.error('[Shop] GET catalog error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /api/shop/catalog ───────────────────────────────────────────────────
// Write the full shop catalog override. Requires Bearer auth.
// Body: { items: [...], categories: [...] }
router.post('/catalog', (req, res) => {
    try {
        const { items, categories } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'items must be a non-empty array' });
        }

        writeCatalog({ items, categories: categories || [] });
        console.log(`[Shop] Catalog updated: ${items.length} items, ${(categories || []).length} categories`);
        res.json({ ok: true, message: `商品数据已更新！共 ${items.length} 件商品，下次用户打开商店即生效 ✅` });
    } catch (err) {
        console.error('[Shop] POST catalog error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── DELETE /api/shop/catalog ─────────────────────────────────────────────────
// Remove the override file entirely — plugin will fall back to built-in defaults.
router.delete('/catalog', (req, res) => {
    try {
        if (fs.existsSync(SHOP_DATA_FILE)) {
            fs.unlinkSync(SHOP_DATA_FILE);
        }
        res.json({ ok: true, message: '覆盖数据已清除，将恢复插件内置默认商品目录' });
    } catch (err) {
        console.error('[Shop] DELETE catalog error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── Public catalog endpoint (no auth) ───────────────────────────────────────
// This is mounted directly on the Express app (not under /api) so it bypasses
// the Bearer token middleware. Used by the SillyTavern plugin to fetch catalog.
// Call registerPublicShopRoute(app) from index.js to activate it.
function registerPublicShopRoute(app) {
    app.get('/shop-catalog', (_req, res) => {
        try {
            const data = readCatalog();
            res.json(data); // null = no override, plugin uses built-in defaults
        } catch (err) {
            console.error('[Shop] Public catalog error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}

module.exports = { router, registerPublicShopRoute };

// ── GET /api/shop/reviews/:itemId ─────────────────────────────────────
// Returns all reviews for a specific shop item, newest first.
router.get('/reviews/:itemId', (req, res) => {
    try {
        const db = getDb();
        const reviews = db.prepare(`
            SELECT id, itemId, author, text, rating, isCharacter, userId, date, createdAt
            FROM shop_reviews
            WHERE itemId = ?
            ORDER BY createdAt DESC
        `).all(req.params.itemId);

        res.json({ reviews });
    } catch (err) {
        console.error('[Shop] GET reviews error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /api/shop/reviews/:itemId ────────────────────────────────────
// Add a new review for a shop item.
// Body: { author, text, rating, isCharacter, userId, date }
router.post('/reviews/:itemId', (req, res) => {
    try {
        const { author, text, rating, isCharacter, userId, date } = req.body;

        if (!author || !text) {
            return res.status(400).json({ error: 'author and text are required' });
        }

        const db = getDb();
        const id = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const safeRating = Math.min(5, Math.max(1, parseInt(rating) || 5));
        const safeDate = date || new Date().toISOString().slice(0, 10);

        db.prepare(`
            INSERT INTO shop_reviews (id, itemId, author, text, rating, isCharacter, userId, date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            req.params.itemId,
            String(author).slice(0, 50),
            String(text).slice(0, 1000),
            safeRating,
            isCharacter ? 1 : 0,
            userId || 'anonymous',
            safeDate,
        );

        const newReview = db.prepare('SELECT * FROM shop_reviews WHERE id = ?').get(id);
        res.json({ ok: true, review: newReview });
    } catch (err) {
        console.error('[Shop] POST review error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── DELETE /api/shop/reviews/:itemId/:reviewId ────────────────────────
// Delete a specific review by its ID.
router.delete('/reviews/:itemId/:reviewId', (req, res) => {
    try {
        const db = getDb();
        const { itemId, reviewId } = req.params;

        const existing = db.prepare('SELECT id FROM shop_reviews WHERE id = ? AND itemId = ?').get(reviewId, itemId);
        if (!existing) {
            return res.status(404).json({ error: 'Review not found' });
        }

        db.prepare('DELETE FROM shop_reviews WHERE id = ? AND itemId = ?').run(reviewId, itemId);
        res.json({ ok: true });
    } catch (err) {
        console.error('[Shop] DELETE review error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});



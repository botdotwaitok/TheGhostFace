// server/routes/wallet.js — Petbot 暗金细胞 wallet proxy
// Proxies balance/deduct/add requests to the Petbot API server,
// using the authenticated user's linked Discord ID.

const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

const PETBOT_API_URL = (process.env.PETBOT_API_URL || 'http://127.0.0.1:8900').replace(/\/+$/, '');
const PETBOT_API_TOKEN = process.env.PETBOT_API_TOKEN || '';
const GFBOT_WEBHOOK_URL = (process.env.GFBOT_WEBHOOK_URL || 'http://127.0.0.1:8901').replace(/\/+$/, '');
const GFBOT_WEBHOOK_TOKEN = process.env.GFBOT_WEBHOOK_TOKEN || '';

// ── Helper: fetch from Petbot API ───────────────────────────────────
async function petbotRequest(method, path, body = null) {
    const url = `${PETBOT_API_URL}${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (PETBOT_API_TOKEN) {
        headers['Authorization'] = `Bearer ${PETBOT_API_TOKEN}`;
    }

    const opts = { method, headers };
    if (body && method !== 'GET') {
        opts.body = JSON.stringify(body);
    }

    const resp = await fetch(url, opts);
    const data = await resp.json();

    if (!resp.ok) {
        const err = new Error(data.error || `Petbot API ${resp.status}`);
        err.status = resp.status;
        err.data = data;
        throw err;
    }
    return data;
}

// ── Helper: resolve discordId from session user ─────────────────────
function getDiscordId(req, res) {
    const sessionToken = req.headers['x-session-token'];
    const db = getDb();

    let userId = null;

    // Try session-based auth first
    if (sessionToken) {
        const session = db.prepare(
            "SELECT userId FROM sessions WHERE token = ? AND expiresAt > datetime('now')"
        ).get(sessionToken);
        if (session) userId = session.userId;
    }

    // Fallback: accept userId from query/body (for non-session flows)
    if (!userId) {
        userId = req.query.userId || (req.body && req.body.userId);
    }

    if (!userId) {
        res.status(401).json({ error: '未登录或会话已过期' });
        return null;
    }

    const user = db.prepare('SELECT discordId FROM users WHERE id = ?').get(userId);
    if (!user || !user.discordId) {
        res.status(400).json({ error: '未绑定 Discord ID，请在设置中绑定' });
        return null;
    }

    return { userId, discordId: user.discordId };
}

// ── GET /api/wallet/balance ─────────────────────────────────────────
// Returns the user's Dark Gold Cell balance from Petbot.
router.get('/balance', async (req, res) => {
    try {
        const identity = getDiscordId(req, res);
        if (!identity) return; // response already sent

        const data = await petbotRequest('GET', `/api/balance/${identity.discordId}`);
        res.json({
            ok: true,
            balance: data.balance,
            discordId: identity.discordId,
        });
    } catch (err) {
        console.error('[Wallet] balance error:', err.message);
        const status = err.status || 500;
        res.status(status).json({ error: err.message || 'Failed to fetch balance' });
    }
});

// ── POST /api/wallet/deduct ─────────────────────────────────────────
// Deduct Dark Gold Cells. Body: { amount: int, reason: string }
router.post('/deduct', async (req, res) => {
    try {
        const identity = getDiscordId(req, res);
        if (!identity) return;

        const { amount, reason } = req.body;
        if (!amount || typeof amount !== 'number' || amount <= 0) {
            return res.status(400).json({ error: 'amount must be a positive number' });
        }

        const data = await petbotRequest('POST', '/api/deduct', {
            user_id: identity.discordId,
            amount,
            reason: reason || 'moments_shop',
        });
        res.json({ ok: true, ...data });
    } catch (err) {
        console.error('[Wallet] deduct error:', err.message);
        const status = err.status || 500;
        const payload = err.data || { error: err.message };
        res.status(status).json(payload);
    }
});

// ── POST /api/wallet/add ────────────────────────────────────────────
// Add Dark Gold Cells. Body: { amount: int, reason: string }
router.post('/add', async (req, res) => {
    try {
        const identity = getDiscordId(req, res);
        if (!identity) return;

        const { amount, reason } = req.body;
        if (!amount || typeof amount !== 'number' || amount <= 0) {
            return res.status(400).json({ error: 'amount must be a positive number' });
        }

        const data = await petbotRequest('POST', '/api/add-balance', {
            user_id: identity.discordId,
            amount,
            reason: reason || 'moments_reward',
        });
        res.json({ ok: true, ...data });
    } catch (err) {
        console.error('[Wallet] add error:', err.message);
        const status = err.status || 500;
        const payload = err.data || { error: err.message };
        res.status(status).json(payload);
    }
});

// ── POST /api/wallet/grant-item ─────────────────────────────────────
// Cross-platform gift: tavern character → user's Discord inventory.
// Proxies to GF Bot webhook, which calls Petbot/DBD Bot grant-item APIs.
// Body: { giftName, itemType, itemId?, itemKey?, characterName, quantity? }
router.post('/grant-item', async (req, res) => {
    try {
        const identity = getDiscordId(req, res);
        if (!identity) return;

        const { giftName, itemType, itemId, itemKey, characterName, quantity } = req.body;
        if (!giftName) {
            return res.status(400).json({ error: 'giftName is required' });
        }

        // Forward to GF Bot webhook
        const webhookBody = {
            discord_id: identity.discordId,
            gift_name: giftName,
            item_type: itemType || 'petbot',
            item_id: itemId,
            item_key: itemKey,
            character_name: characterName || '角色',
            quantity: quantity || 1,
        };

        const headers = { 'Content-Type': 'application/json' };
        if (GFBOT_WEBHOOK_TOKEN) {
            headers['Authorization'] = `Bearer ${GFBOT_WEBHOOK_TOKEN}`;
        }

        const webhookResp = await fetch(`${GFBOT_WEBHOOK_URL}/webhook/tavern-gift`, {
            method: 'POST',
            headers,
            body: JSON.stringify(webhookBody),
        });
        const data = await webhookResp.json();

        if (!webhookResp.ok) {
            console.error('[Wallet] grant-item webhook error:', data);
            return res.status(webhookResp.status).json(data);
        }

        console.log(`[Wallet] grant-item success: ${giftName} → ${identity.discordId}`);
        res.json({ ok: true, ...data });
    } catch (err) {
        console.error('[Wallet] grant-item error:', err.message);
        const status = err.status || 500;
        res.status(status).json({ error: err.message || 'Failed to grant item' });
    }
});

// ── POST /api/wallet/rob ────────────────────────────────────────────
// Tavern character robbery: proxied via GF Bot → Petbot.
// Body: { victimDiscordId: string, characterName: string }
router.post('/rob', async (req, res) => {
    try {
        const identity = getDiscordId(req, res);
        if (!identity) return;

        const { victimDiscordId, characterName } = req.body;
        if (!victimDiscordId) {
            return res.status(400).json({ error: 'victimDiscordId is required' });
        }

        // Forward to GF Bot webhook
        const webhookBody = {
            robber_discord_id: identity.discordId,
            victim_discord_id: victimDiscordId,
            character_name: characterName || '角色',
        };

        const headers = { 'Content-Type': 'application/json' };
        if (GFBOT_WEBHOOK_TOKEN) {
            headers['Authorization'] = `Bearer ${GFBOT_WEBHOOK_TOKEN}`;
        }

        const webhookResp = await fetch(`${GFBOT_WEBHOOK_URL}/webhook/tavern-robbery`, {
            method: 'POST',
            headers,
            body: JSON.stringify(webhookBody),
        });

        // Safely parse response — GF Bot webhook may return non-JSON on errors
        const rawText = await webhookResp.text();
        let data;
        try {
            data = JSON.parse(rawText);
        } catch (_parseErr) {
            console.error(`[Wallet] rob webhook returned non-JSON (status ${webhookResp.status}): ${rawText.slice(0, 200)}`);
            return res.status(502).json({ error: `GF Bot webhook returned invalid response (status ${webhookResp.status})` });
        }

        if (!webhookResp.ok) {
            console.error('[Wallet] rob webhook error:', data);
            return res.status(webhookResp.status).json(data);
        }

        console.log(`[Wallet] rob result: ${characterName} robbed for user ${identity.discordId} → success=${data.success}`);
        res.json({ ok: true, ...data });
    } catch (err) {
        console.error('[Wallet] rob error:', err.message);
        const status = err.status || 500;
        res.status(status).json({ error: err.message || 'Robbery failed' });
    }
});

// ── GET /api/wallet/leaderboard ─────────────────────────────────────
// Leaderboard data: proxied to Petbot, then enriched with local display names.
router.get('/leaderboard', async (req, res) => {
    try {
        const data = await petbotRequest('GET', '/api/leaderboard');

        // Collect all unique Discord IDs from all dimensions
        const allIds = new Set();
        for (const entry of (data.gifter || [])) allIds.add(entry.user_id);
        for (const entry of (data.robber || [])) allIds.add(entry.user_id);
        for (const entry of (data.victim || [])) allIds.add(entry.user_id);

        // Batch-lookup displayNames from local users table
        const nameMap = {};
        if (allIds.size > 0) {
            const db = getDb();
            const placeholders = [...allIds].map(() => '?').join(',');
            const rows = db.prepare(
                `SELECT discordId, displayName FROM users WHERE discordId IN (${placeholders})`
            ).all(...allIds);
            for (const row of rows) {
                nameMap[row.discordId] = row.displayName;
            }
        }

        // Inject 'name' field into each entry
        const enrich = (list) => (list || []).map(e => ({
            ...e,
            name: nameMap[e.user_id] || null,
        }));

        res.json({
            ok: true,
            gifter: enrich(data.gifter),
            robber: enrich(data.robber),
            victim: enrich(data.victim),
        });
    } catch (err) {
        console.error('[Wallet] leaderboard error:', err.message);
        const status = err.status || 500;
        res.status(status).json({ error: err.message || 'Failed to fetch leaderboard' });
    }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');

// ── Helper Functions ────────────────────────────────────────────────

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return { salt, hash };
}

function verifyPassword(password, salt, hash) {
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
}

// ── Routes ──────────────────────────────────────────────────────────

// POST /api/auth/register
router.post('/register', (req, res) => {
    const { username, password, displayName } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    const db = getDb();

    // Check if username exists
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
        return res.status(409).json({ error: 'Username already taken' });
    }

    const { salt, hash } = hashPassword(password);
    const userId = uuidv4();
    const finalDisplayName = displayName || username;

    try {
        const stmt = db.prepare(`
            INSERT INTO users (id, username, passwordHash, salt, displayName, avatarUrl)
            VALUES (?, ?, ?, ?, ?, '')
        `);
        stmt.run(userId, username, hash, salt, finalDisplayName);

        // Auto-login: Create session
        const token = uuidv4();
        // Expires in 30 days
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        db.prepare('INSERT INTO sessions (token, userId, expiresAt) VALUES (?, ?, ?)').run(token, userId, expiresAt);

        res.status(201).json({
            token,
            user: {
                id: userId,
                username,
                displayName: finalDisplayName,
                avatarUrl: '',
                settings: '{}'
            }
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user || !user.passwordHash || !user.salt) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!verifyPassword(password, user.salt, user.passwordHash)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Login success
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    try {
        db.prepare('INSERT INTO sessions (token, userId, expiresAt) VALUES (?, ?, ?)').run(token, user.id, expiresAt);

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                displayName: user.displayName,
                avatarUrl: user.avatarUrl,
                settings: user.settings
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    const token = req.headers['x-session-token'];
    if (token) {
        const db = getDb();
        db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
    res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
    const token = req.headers['x-session-token'];
    if (!token) {
        return res.status(401).json({ error: 'No session token' });
    }

    const db = getDb();
    const session = db.prepare(`
        SELECT s.*, u.username, u.displayName, u.avatarUrl, u.settings 
        FROM sessions s
        JOIN users u ON s.userId = u.id
        WHERE s.token = ? AND s.expiresAt > datetime('now')
    `).get(token);

    if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
    }

    res.json({
        user: {
            id: session.userId,
            username: session.username,
            displayName: session.displayName,
            avatarUrl: session.avatarUrl,
            settings: session.settings
        }
    });
});

module.exports = router;

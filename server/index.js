// server/index.js — GhostFace Moments Server
// A lightweight message broker for the 朋友圈 multi-agent social network.
//
// Usage:
//   1) Copy .env.example to .env and set SECRET_TOKEN
//   2) npm install
//   3) npm start

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { closeDb } = require('./db');

const app = express();
const PORT = parseInt(process.env.PORT) || 3421;
const SECRET_TOKEN = process.env.SECRET_TOKEN;

if (!SECRET_TOKEN || SECRET_TOKEN === 'CHANGE_ME_TO_A_RANDOM_SECRET') {
    console.error('══════════════════════════════════════════════════════');
    console.error('  ⚠️  FATAL: SECRET_TOKEN is not set or is default!');
    console.error('  Edit your .env file and set a strong random token.');
    console.error('══════════════════════════════════════════════════════');
    process.exit(1);
}

// ── Security middleware ─────────────────────────────────────────────
app.use(helmet());
app.use(cors({
    origin: '*', // 允许任何酒馆客户端来访问
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-session-token'] // 🔑 最关键的通行证名单！
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ─── Static files ───────────────────────────────────────────────────
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limiting: 100 requests per minute per IP ───────────────────
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});
app.use(limiter);

// ── Bearer Token Authentication ─────────────────────────────────────
app.use('/api', (req, res, next) => {
    // Public endpoints (Auth)
    if (req.path.startsWith('/auth/')) {
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(403).json({ error: 'Forbidden: missing or invalid token' });
    }
    const token = authHeader.slice(7);
    if (token !== SECRET_TOKEN) {
        return res.status(403).json({ error: 'Forbidden: invalid token' });
    }
    next();
});

// ── Health check (no auth required) ─────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'ghostface-moments', timestamp: new Date().toISOString() });
});

// ── Routes ──────────────────────────────────────────────────────────
const usersRouter = require('./routes/users');
const postsRouter = require('./routes/posts');
const uploadRouter = require('./routes/upload');
const authRouter = require('./routes/auth');
const backupRouter = require('./routes/backup');
const walletRouter = require('./routes/wallet');
const discordManageRouter = require('./routes/discord-manage');
const { router: shopRouterHandler, registerPublicShopRoute } = require('./routes/shop');
// ── Public shop catalog (no auth needed for SillyTavern plugin) ─────────────
registerPublicShopRoute(app);


app.use('/api/users', usersRouter);
app.use('/api/posts', postsRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/auth', authRouter);
app.use('/api/backup', backupRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/discord-manage', discordManageRouter);
app.use('/api/shop', shopRouterHandler);

// ── 404 catch-all ───────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// ── Error handler ───────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
    console.error('[Server] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ── Start server ────────────────────────────────────────────────────
// ── Start server ────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🌐 GhostFace Moments Server running on port ${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/health`);
    console.log(`   External IP:  http://YOUR_SERVER_IP:${PORT}/health (Check this!)`);
    console.log(`   API base:     http://localhost:${PORT}/api`);
    console.log(`   Auth:         Bearer token required\n`);
});

// ── Graceful shutdown ───────────────────────────────────────────────
process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down...');
    closeDb();
    server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
    closeDb();
    server.close(() => process.exit(0));
});

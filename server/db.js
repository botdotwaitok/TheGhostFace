// server/db.js — SQLite database setup for GhostFace Moments
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || './data.db';

let db;

function getDb() {
    if (!db) {
        db = new Database(path.resolve(__dirname, DB_PATH));
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        initTables();
        migrations();
    }
    return db;
}

function migrations() {
    try {
        const tableInfo = db.pragma('table_info(users)');
        const columns = tableInfo.map(c => c.name);

        if (!columns.includes('avatarUrl')) {
            console.log('[DB] Migrating: Adding avatarUrl to users');
            db.prepare("ALTER TABLE users ADD COLUMN avatarUrl TEXT DEFAULT ''").run();
        }
        if (!columns.includes('bio')) {
            console.log('[DB] Migrating: Adding bio to users');
            db.prepare("ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''").run();
        }
        if (!columns.includes('displayName')) {
            console.log('[DB] Migrating: Adding displayName to users');
            db.prepare("ALTER TABLE users ADD COLUMN displayName TEXT NOT NULL DEFAULT 'Anonymous'").run();
        }
        // New auth columns
        if (!columns.includes('username')) {
            console.log('[DB] Migrating: Adding username to users');
            // Adding as nullable first or with default to avoid constraints issues on existing rows if any
            // But since we want it unique, we might have issues if there are existing rows. 
            // For now, let's assume empty or acceptable to have nulls for old users until they migrate/register? 
            // Actually, the register flow uses UUID as ID. Old users might just be "legacy".
            // Let's add it as TEXT UNIQUE. SQLite allows multiple NULLs in UNIQUE columns usually unless specified NOT NULL.
            db.prepare("ALTER TABLE users ADD COLUMN username TEXT UNIQUE").run();
        }
        if (!columns.includes('passwordHash')) {
            console.log('[DB] Migrating: Adding passwordHash to users');
            db.prepare("ALTER TABLE users ADD COLUMN passwordHash TEXT").run();
        }
        if (!columns.includes('salt')) {
            console.log('[DB] Migrating: Adding salt to users');
            db.prepare("ALTER TABLE users ADD COLUMN salt TEXT").run();
        }
        if (!columns.includes('settings')) {
            console.log('[DB] Migrating: Adding settings to users');
            db.prepare("ALTER TABLE users ADD COLUMN settings TEXT DEFAULT '{}'").run();
        }

    } catch (err) {
        console.error('[DB] Migration failed:', err);
    }
}

function initTables() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id          TEXT PRIMARY KEY,
            username    TEXT UNIQUE,
            passwordHash TEXT,
            salt        TEXT,
            displayName TEXT NOT NULL DEFAULT 'Anonymous',
            avatarUrl   TEXT DEFAULT '',
            bio         TEXT DEFAULT '',
            settings    TEXT DEFAULT '{}',
            createdAt   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token       TEXT PRIMARY KEY,
            userId      TEXT NOT NULL,
            createdAt   TEXT NOT NULL DEFAULT (datetime('now')),
            expiresAt   TEXT NOT NULL,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS friends (
            userId      TEXT NOT NULL,
            friendId    TEXT NOT NULL,
            createdAt   TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (userId, friendId),
            FOREIGN KEY (userId)   REFERENCES users(id),
            FOREIGN KEY (friendId) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS posts (
            id          TEXT PRIMARY KEY,
            authorId    TEXT NOT NULL,
            authorName  TEXT NOT NULL DEFAULT 'Anonymous',
            authorAvatar TEXT DEFAULT '',
            content     TEXT NOT NULL,
            imageUrl    TEXT DEFAULT '',
            createdAt   TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (authorId) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS comments (
            id          TEXT PRIMARY KEY,
            postId      TEXT NOT NULL,
            authorId    TEXT NOT NULL,
            authorName  TEXT NOT NULL DEFAULT 'Anonymous',
            content     TEXT NOT NULL,
            replyToId   TEXT DEFAULT NULL,
            replyToName TEXT DEFAULT NULL,
            createdAt   TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (postId)  REFERENCES posts(id) ON DELETE CASCADE,
            FOREIGN KEY (authorId) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS likes (
            postId      TEXT NOT NULL,
            userId      TEXT NOT NULL,
            userName    TEXT NOT NULL DEFAULT 'Anonymous',
            createdAt   TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (postId, userId),
            FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE,
            FOREIGN KEY (userId) REFERENCES users(id)
        );

        CREATE INDEX IF NOT EXISTS idx_posts_authorId  ON posts(authorId);
        CREATE INDEX IF NOT EXISTS idx_posts_createdAt ON posts(createdAt);
        CREATE INDEX IF NOT EXISTS idx_comments_postId ON comments(postId);
        CREATE INDEX IF NOT EXISTS idx_friends_userId  ON friends(userId);
        CREATE INDEX IF NOT EXISTS idx_sessions_token  ON sessions(token);
    `);
    console.log('[DB] Tables initialized');
}

function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}

module.exports = { getDb, closeDb };

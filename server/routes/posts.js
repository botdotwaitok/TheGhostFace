// server/routes/posts.js — Post, comment, and like endpoints
const express = require('express');
const { getDb } = require('../db');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// ─── POST /api/posts ────────────────────────────────────────────────
// Create a new post.
// Body: { authorId, authorName, authorAvatar?, content, imageUrl? }
router.post('/', (req, res) => {
    try {
        const { authorId, authorName, authorAvatar, content, imageUrl } = req.body;
        if (!authorId || !content || !content.trim()) {
            return res.status(400).json({ error: 'authorId and content are required' });
        }

        const db = getDb();

        // Auto-register user if not exists (convenience for first post)
        const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(authorId);
        if (!existing) {
            db.prepare(`INSERT INTO users (id, displayName, avatarUrl) VALUES (?, ?, ?)`)
                .run(authorId, authorName || 'Anonymous', authorAvatar || '');
        }

        const postId = uuidv4();
        db.prepare(`
            INSERT INTO posts (id, authorId, authorName, authorAvatar, content, imageUrl)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(postId, authorId, authorName || 'Anonymous', authorAvatar || '', content.trim(), imageUrl || '');

        const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
        res.status(201).json({ ok: true, post });
    } catch (err) {
        console.error('[Posts] create error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── GET /api/posts/feed/:userId ────────────────────────────────────
// Get feed: own posts + friends' posts, sorted by time desc.
// Query params:
//   since — ISO timestamp, return only posts after this time
//   limit — max posts to return (default 50)
router.get('/feed/:userId', (req, res) => {
    try {
        const { userId } = req.params;
        const { since, limit } = req.query;
        const maxPosts = Math.min(parseInt(limit) || 50, 200);

        const db = getDb();

        // Get the user's friend list + self
        const friendIds = db.prepare(
            'SELECT friendId FROM friends WHERE userId = ?'
        ).all(userId).map(r => r.friendId);
        friendIds.push(userId); // include own posts

        // Build query with placeholders
        const placeholders = friendIds.map(() => '?').join(',');
        let query = `
            SELECT p.*,
                   (SELECT COUNT(*) FROM likes WHERE postId = p.id) as likeCount,
                   (SELECT COUNT(*) FROM comments WHERE postId = p.id) as commentCount,
                   EXISTS(SELECT 1 FROM likes WHERE postId = p.id AND userId = ?) as likedByMe,
                   u.username as authorUsername
            FROM posts p
            LEFT JOIN users u ON p.authorId = u.id
            WHERE p.authorId IN (${placeholders})
        `;
        const params = [userId, ...friendIds];

        if (since) {
            query += ' AND p.createdAt > ?';
            params.push(since);
        }

        query += ' ORDER BY p.createdAt DESC LIMIT ?';
        params.push(maxPosts);

        const posts = db.prepare(query).all(...params);

        if (posts.length > 0) {
            const postIds = posts.map(p => p.id);
            const commentPlaceholders = postIds.map(() => '?').join(',');
            const comments = db.prepare(
                `SELECT c.*, u.username as authorUsername FROM comments c LEFT JOIN users u ON c.authorId = u.id WHERE c.postId IN (${commentPlaceholders}) ORDER BY c.createdAt ASC`
            ).all(...postIds);

            // Group comments by postId
            const commentsByPostId = {};
            comments.forEach(c => {
                if (!commentsByPostId[c.postId]) {
                    commentsByPostId[c.postId] = [];
                }
                commentsByPostId[c.postId].push(c);
            });

            // Associate comments and convert likedByMe
            posts.forEach(p => {
                p.likedByMe = !!p.likedByMe;
                p.comments = commentsByPostId[p.id] || [];
            });
        }
        res.json({ ok: true, posts, count: posts.length });
    } catch (err) {
        console.error('[Posts] feed error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── GET /api/posts/:postId ─────────────────────────────────────────
// Get a single post with its comments and likes
router.get('/:postId', (req, res) => {
    try {
        const db = getDb();
        const post = db.prepare('SELECT p.*, u.username as authorUsername FROM posts p LEFT JOIN users u ON p.authorId = u.id WHERE p.id = ?').get(req.params.postId);
        if (!post) return res.status(404).json({ error: 'Post not found' });

        const comments = db.prepare(
            'SELECT c.*, u.username as authorUsername FROM comments c LEFT JOIN users u ON c.authorId = u.id WHERE c.postId = ? ORDER BY c.createdAt ASC'
        ).all(req.params.postId);

        const likes = db.prepare(
            'SELECT userId, userName FROM likes WHERE postId = ?'
        ).all(req.params.postId);

        res.json({ ok: true, post, comments, likes });
    } catch (err) {
        console.error('[Posts] get post error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── POST /api/posts/:postId/comments ───────────────────────────────
// Add a comment to a post.
// Body: { authorId, authorName, content, replyToId?, replyToName? }
router.post('/:postId/comments', (req, res) => {
    try {
        const { authorId, authorName, content, replyToId, replyToName } = req.body;
        if (!authorId || !content || !content.trim()) {
            return res.status(400).json({ error: 'authorId and content are required' });
        }

        const db = getDb();

        // Verify post exists
        const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.postId);
        if (!post) return res.status(404).json({ error: 'Post not found' });

        const commentId = uuidv4();
        db.prepare(`
            INSERT INTO comments (id, postId, authorId, authorName, content, replyToId, replyToName)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(commentId, req.params.postId, authorId, authorName || 'Anonymous',
            content.trim(), replyToId || null, replyToName || null);

        const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
        res.status(201).json({ ok: true, comment });
    } catch (err) {
        console.error('[Posts] add comment error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── GET /api/posts/:postId/comments ────────────────────────────────
// List all comments for a post
router.get('/:postId/comments', (req, res) => {
    try {
        const db = getDb();
        const comments = db.prepare(
            'SELECT c.*, u.username as authorUsername FROM comments c LEFT JOIN users u ON c.authorId = u.id WHERE c.postId = ? ORDER BY c.createdAt ASC'
        ).all(req.params.postId);
        res.json({ ok: true, comments });
    } catch (err) {
        console.error('[Posts] list comments error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── POST /api/posts/:postId/like ───────────────────────────────────
// Toggle like on a post.
// Body: { userId, userName }
router.post('/:postId/like', (req, res) => {
    try {
        const { userId, userName } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required' });

        const db = getDb();

        const existing = db.prepare(
            'SELECT 1 FROM likes WHERE postId = ? AND userId = ?'
        ).get(req.params.postId, userId);

        if (existing) {
            db.prepare('DELETE FROM likes WHERE postId = ? AND userId = ?')
                .run(req.params.postId, userId);
            res.json({ ok: true, liked: false });
        } else {
            db.prepare(`
                INSERT INTO likes (postId, userId, userName) VALUES (?, ?, ?)
            `).run(req.params.postId, userId, userName || 'Anonymous');
            res.json({ ok: true, liked: true });
        }
    } catch (err) {
        console.error('[Posts] toggle like error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── DELETE /api/posts/:postId ──────────────────────────────────────
// Delete a post
router.delete('/:postId', (req, res) => {
    try {
        const db = getDb();
        const result = db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.postId);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Post not found' });
        }
        res.json({ ok: true });
    } catch (err) {
        console.error('[Posts] delete post error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── DELETE /api/posts/:postId/comments/:commentId ──────────────────
// Delete a comment
router.delete('/:postId/comments/:commentId', (req, res) => {
    try {
        const db = getDb();
        // Since sqlite enforces foreign keys differently depending on pragmas, 
        // passing both commentId and postId ensures we delete the right comment from the right post.
        const result = db.prepare('DELETE FROM comments WHERE id = ? AND postId = ?').run(req.params.commentId, req.params.postId);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Comment not found' });
        }
        res.json({ ok: true });
    } catch (err) {
        console.error('[Posts] delete comment error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;

// server/routes/upload.js — Image upload endpoint
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Ensure public/uploads directory exists
const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ─── POST /api/upload ───────────────────────────────────────────────
// Upload a base64 image.
// Body: { image: "data:image/png;base64,..." }
router.post('/', (req, res) => {
    try {
        const { image } = req.body;
        if (!image) {
            return res.status(400).json({ error: 'No image data provided' });
        }

        // Validate base64 data
        const matches = image.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
            return res.status(400).json({ error: 'Invalid image data' });
        }

        const type = matches[1];
        const buffer = Buffer.from(matches[2], 'base64');

        // Simple validation: check first bytes for PNG/JPG/GIF/WEBP
        // (Optional: add more robust validation if needed)

        // Generate filename
        const ext = type === 'jpeg' ? 'jpg' : type;
        const filename = `${uuidv4()}.${ext}`;
        const filePath = path.join(uploadDir, filename);

        // Limit file size (e.g. 5MB)
        if (buffer.length > 5 * 1024 * 1024) {
            return res.status(400).json({ error: 'Image too large (max 5MB)' });
        }

        fs.writeFileSync(filePath, buffer);

        // Return relative URL
        // Assumes server mounts 'public' at root or similar
        const fileUrl = `/uploads/${filename}`;

        console.log(`[Upload] Saved image: ${filename} (${(buffer.length / 1024).toFixed(2)} KB)`);

        res.status(201).json({ ok: true, url: fileUrl });
    } catch (err) {
        console.error('[Upload] error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;

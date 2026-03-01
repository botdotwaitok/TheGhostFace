// server/routes/backup.js — 备份邮件发送路由
// 使用 nodemailer 通过用户自配的 SMTP 发送角色卡备份邮件

const express = require('express');
const router = express.Router();

router.post('/send-email', async (req, res) => {
    try {
        const { smtp, to, subject, text, attachments } = req.body;

        if (!smtp || !to || !subject) {
            return res.status(400).json({ error: '缺少必要参数 (smtp, to, subject)' });
        }

        if (!smtp.host || !smtp.user || !smtp.pass) {
            return res.status(400).json({ error: 'SMTP 配置不完整 (需要 host, user, pass)' });
        }

        // 动态加载 nodemailer (避免在未安装时影响服务器启动)
        let nodemailer;
        try {
            nodemailer = require('nodemailer');
        } catch (e) {
            console.error('[Backup] nodemailer 未安装，请运行: npm install nodemailer');
            return res.status(500).json({
                error: 'nodemailer 未安装。请在 server/ 目录下运行: npm install nodemailer'
            });
        }

        // 创建 SMTP 传输器
        const transporter = nodemailer.createTransport({
            host: smtp.host,
            port: smtp.port || 465,
            secure: smtp.secure !== false, // 默认为 true (SSL)
            auth: {
                user: smtp.user,
                pass: smtp.pass,
            },
            // 超时设置
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 30000,
        });

        // 构建邮件附件
        const mailAttachments = (attachments || []).map(att => ({
            filename: att.filename,
            content: att.content,
            encoding: att.encoding || 'base64',
            contentType: att.contentType,
        }));

        // 发送邮件
        const info = await transporter.sendMail({
            from: `"鬼面备份 👻" <${smtp.user}>`,
            to: to,
            subject: subject,
            text: text || '',
            attachments: mailAttachments,
        });

        console.log(`[Backup] 邮件发送成功: ${info.messageId}`);
        res.json({ ok: true, messageId: info.messageId });

    } catch (error) {
        console.error('[Backup] 邮件发送失败:', error.message);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

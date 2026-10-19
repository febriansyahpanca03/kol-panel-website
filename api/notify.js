// Tombol "Telegram" di dashboard: mengirim teks ringkasan yang sudah
// disusun (dan mungkin diedit) pemilik. Hanya sandi edit yang boleh.

import { sameSecret } from './data.js';
import { telegramConfig, kirimTelegram } from '../lib/telegram.js';

async function readBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Pakai POST' });
    if (!sameSecret(req.headers['x-edit-key'], process.env.EDIT_PASSPHRASE)) {
        return res.status(401).json({ error: 'Hanya pemilik (sandi edit) yang bisa mengirim' });
    }
    const cfg = telegramConfig();
    if (!cfg) return res.status(500).json({ error: 'Telegram belum disetel', detail: 'Isi TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID di Vercel' });
    try {
        const body = await readBody(req);
        const text = String(body.text || '').trim();
        if (!text) return res.status(400).json({ error: 'Teks kosong' });
        await kirimTelegram(cfg, text);
        return res.status(200).json({ ok: true });
    } catch (e) {
        return res.status(502).json({ error: 'Gagal mengirim ke Telegram', detail: String(e.message || e) });
    }
}

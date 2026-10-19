// Pengingat pagi otomatis ke Telegram.
//
// Dijalankan Vercel Cron (vercel.json) setiap hari 00:00 UTC = 07:00 WIB.
// Membaca data online (api/data), menyusun ringkasan dengan fungsi yang
// sama dengan dashboard (data/pantau-core.js), lalu mengirimnya.
//
// Vercel mengirim header `Authorization: Bearer <CRON_SECRET>` bila env
// CRON_SECRET diisi; tanpa itu endpoint ini juga bisa dipicu manual dengan
// header x-edit-key = EDIT_PASSPHRASE.

import '../data/pantau-core.js';
import { KEY, redis, redisConfig, sameSecret } from './data.js';
import { telegramConfig, kirimTelegram } from '../lib/telegram.js';

const C = globalThis.PantauCore;

export function todayJakarta(now = Date.now()) {
    return new Date(now + 7 * 3600000).toISOString().slice(0, 10);
}

export function dpOfFactory(setelan) {
    return t => {
        const own = t.dpPercent;
        if (own === '' || own === undefined || own === null || isNaN(parseInt(own, 10))) return Number(setelan.dpPercent) || 0;
        return parseInt(own, 10);
    };
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const cron = process.env.CRON_SECRET;
    const viaCron = cron && req.headers.authorization === 'Bearer ' + cron;
    const viaOwner = sameSecret(req.headers['x-edit-key'], process.env.EDIT_PASSPHRASE);
    if (!viaCron && !viaOwner) return res.status(401).json({ error: 'Tidak diizinkan' });

    const db = redisConfig();
    const tg = telegramConfig();
    if (!db || !tg) {
        return res.status(500).json({ error: 'Belum disetel', detail: [!db && 'database (Upstash)', !tg && 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID'].filter(Boolean).join(', ') });
    }
    try {
        const [raw] = await redis(db, [['GET', KEY]]);
        if (!raw) return res.status(200).json({ ok: true, skipped: 'Belum ada data online' });
        const state = JSON.parse(raw).data || {};
        const setelan = state.setelan || {};
        const text = C.dailySummary(state, todayJakarta(), {
            contractEndingSoon: setelan.contractEndingSoon,
            dpOf: dpOfFactory(setelan)
        });
        await kirimTelegram(tg, text);
        return res.status(200).json({ ok: true });
    } catch (e) {
        return res.status(502).json({ error: 'Gagal', detail: String(e.message || e) });
    }
}

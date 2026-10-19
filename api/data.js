// Penyimpanan online Pantau Talent.
//
// Data disimpan sebagai satu dokumen JSON di Upstash Redis (Vercel
// Marketplace → Storage → Upstash for Redis, gratis). Fungsi ini satu-satunya
// yang memegang token database.
//
// Hak akses:
//   - x-edit-key = EDIT_PASSPHRASE  → baca lengkap + simpan (hanya pemilik)
//   - x-view-key = VIEW_PASSPHRASE  → baca saja, data pribadi talent
//                                    (No. HP, alamat, rekening) dihapus
//   - selain itu                    → 401
//
// Penyimpanan memakai nomor versi: klien mengirim versi yang ia pegang, dan
// bila server sudah lebih baru (diubah dari perangkat lain) jawabannya 409,
// bukan menimpa diam-diam. Lima versi sebelumnya disimpan sebagai cadangan.
//
// Env var: EDIT_PASSPHRASE (wajib), VIEW_PASSPHRASE (opsional), dan dari
// integrasi Upstash: KV_REST_API_URL + KV_REST_API_TOKEN (atau
// UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).

import { timingSafeEqual } from 'node:crypto';

export const KEY = 'pantau-talent:data';
export const BACKUP_KEY = 'pantau-talent:cadangan';
const BACKUP_COUNT = 5;

// Kolom pribadi talent yang tidak boleh terlihat dengan sandi lihat.
const PRIVATE_FIELDS = ['phone', 'address', 'bank', 'fullName'];

export function sameSecret(given, expected) {
    if (!expected || typeof given !== 'string' || !given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

export function stripPrivate(data) {
    const copy = JSON.parse(JSON.stringify(data || {}));
    (copy.talents || []).forEach(t => {
        PRIVATE_FIELDS.forEach(f => { if (f in t) t[f] = ''; });
        (t.letters || []).forEach(l => {
            PRIVATE_FIELDS.forEach(f => { if (l.data && f in l.data) l.data[f] = ''; });
        });
        // Riwayat perubahan bisa memuat nilai lama kolom pribadi.
        t.changeLog = (t.changeLog || []).filter(c => PRIVATE_FIELDS.indexOf(c.field) === -1);
    });
    return copy;
}

export function redisConfig() {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

export async function redis(cfg, commands) {
    const r = await fetch(cfg.url + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(commands)
    });
    if (!r.ok) throw new Error('Database menolak: HTTP ' + r.status);
    const out = await r.json();
    const err = out.find(x => x && x.error);
    if (err) throw new Error('Database: ' + err.error);
    return out.map(x => x.result);
}

async function readBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    const editKey = process.env.EDIT_PASSPHRASE;
    const viewKey = process.env.VIEW_PASSPHRASE;
    const cfg = redisConfig();
    if (!editKey || !cfg) {
        return res.status(500).json({
            error: 'Server belum disetel',
            detail: 'Env var yang belum terisi: ' + [
                !editKey && 'EDIT_PASSPHRASE',
                !cfg && 'KV_REST_API_URL / KV_REST_API_TOKEN (pasang Upstash for Redis)'
            ].filter(Boolean).join(', ')
        });
    }

    const isOwner = sameSecret(req.headers['x-edit-key'], editKey);
    const isViewer = !isOwner && sameSecret(req.headers['x-view-key'], viewKey);
    if (!isOwner && !isViewer) return res.status(401).json({ error: 'Frasa sandi salah' });

    try {
        if (req.method === 'GET') {
            const [raw] = await redis(cfg, [['GET', KEY]]);
            if (!raw) return res.status(200).json({ version: 0, updatedAt: null, data: null, role: isOwner ? 'owner' : 'viewer' });
            const doc = JSON.parse(raw);
            return res.status(200).json({
                version: doc.version,
                updatedAt: doc.updatedAt,
                data: isOwner ? doc.data : stripPrivate(doc.data),
                role: isOwner ? 'owner' : 'viewer'
            });
        }

        if (req.method === 'PUT') {
            if (!isOwner) return res.status(403).json({ error: 'Sandi lihat tidak bisa menyimpan' });
            const body = await readBody(req);
            if (!body || typeof body.data !== 'object' || !Array.isArray(body.data.talents)) {
                return res.status(400).json({ error: 'Data tidak valid' });
            }
            const [raw] = await redis(cfg, [['GET', KEY]]);
            const current = raw ? JSON.parse(raw) : { version: 0 };
            if (!body.force && Number(body.baseVersion) !== current.version) {
                return res.status(409).json({
                    error: 'Data online sudah diubah dari perangkat lain',
                    version: current.version, updatedAt: current.updatedAt
                });
            }
            const doc = { version: current.version + 1, updatedAt: new Date().toISOString(), data: body.data };
            const commands = [['SET', KEY, JSON.stringify(doc)]];
            if (raw) commands.push(['LPUSH', BACKUP_KEY, raw], ['LTRIM', BACKUP_KEY, 0, BACKUP_COUNT - 1]);
            await redis(cfg, commands);
            return res.status(200).json({ version: doc.version, updatedAt: doc.updatedAt });
        }

        res.setHeader('Allow', 'GET, PUT');
        return res.status(405).json({ error: 'Metode tidak didukung' });
    } catch (e) {
        return res.status(502).json({ error: 'Gagal menghubungi database', detail: String(e.message || e) });
    }
}

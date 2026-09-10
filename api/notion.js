// Perantara ke Notion Content Calendar.
//
// Token Notion TIDAK BOLEH ada di halaman: dashboard adalah berkas publik,
// siapa pun bisa membacanya. Jadi token disimpan sebagai env var di Vercel
// dan hanya fungsi ini yang memegangnya.
//
// Endpoint ini sendiri publik, maka dikunci frasa sandi. Frasa itu diketik
// pengguna di dashboard dan disimpan di localStorage miliknya, tidak pernah
// ikut tertulis di kode halaman.
//
// Perlu env var di Vercel: NOTION_TOKEN, SYNC_PASSPHRASE, NOTION_DATABASE_ID

const NOTION_VERSION = '2022-06-28';

module.exports = async function handler(req, res) {
    const token = process.env.NOTION_TOKEN;
    const sandi = process.env.SYNC_PASSPHRASE;
    const dbId = process.env.NOTION_DATABASE_ID;

    if (!token || !sandi || !dbId) {
        return res.status(500).json({
            error: 'Server belum disetel',
            detail: 'Env var yang belum terisi: ' +
                [!token && 'NOTION_TOKEN', !sandi && 'SYNC_PASSPHRASE', !dbId && 'NOTION_DATABASE_ID']
                    .filter(Boolean).join(', ')
        });
    }

    const diberikan = req.headers['x-sync-key'] || '';
    if (diberikan !== sandi) {
        return res.status(401).json({ error: 'Frasa sandi salah' });
    }

    try {
        const baris = [];
        let cursor = undefined;

        // Notion membatasi 100 baris per permintaan, jadi ditelusuri berhalaman.
        do {
            const r = await fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Notion-Version': NOTION_VERSION,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ page_size: 100, start_cursor: cursor })
            });

            if (!r.ok) {
                const teks = await r.text();
                return res.status(r.status).json({ error: 'Notion menolak', detail: teks.slice(0, 400) });
            }

            const data = await r.json();
            data.results.forEach(p => {
                const props = p.properties || {};
                const judul = props['Content name'];
                const tanggal = props['Film date'];
                const nama = judul && judul.title && judul.title.length
                    ? judul.title.map(t => t.plain_text).join('').trim() : '';
                const tgl = tanggal && tanggal.date && tanggal.date.start
                    ? String(tanggal.date.start).slice(0, 10) : '';
                if (nama && tgl) baris.push({ nama: nama, tgl: tgl });
            });

            cursor = data.has_more ? data.next_cursor : undefined;
        } while (cursor);

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ jumlah: baris.length, baris: baris });
    } catch (e) {
        return res.status(500).json({ error: 'Gagal menghubungi Notion', detail: String(e.message || e) });
    }
};

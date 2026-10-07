/**
 * Satu sumber angka untuk kartu talent, tab Hari Ini, dan Kalender.
 *
 * Sebelumnya tiap angka punya rumusnya sendiri: "Sisa" dari jumlah baris
 * upload, "Tertinggal" dari proporsi hari kontrak, "Jadwal terlewat" dari
 * slot yang tanggalnya persis sama dengan tanggal upload. Ketiganya bisa
 * saling membantah — kuota penuh tapi 20 jadwal terlewat, sekaligus
 * tertinggal 0 video. Semua sekarang diturunkan dari `talentMetrics`.
 *
 * Berkas ini sengaja skrip biasa (bukan modul ES) supaya halaman tetap jalan
 * saat dibuka langsung dari berkas lokal. Hasilnya dipasang di
 * `globalThis.PantauCore`.
 */
(function (root) {
    'use strict';

    const DAY_MS = 86400000;

    // Tanggal diolah sebagai string YYYY-MM-DD dalam UTC agar hasilnya sama
    // di zona waktu mana pun mesin berjalan.
    function parseIso(iso) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
        if (!m) return null;
        const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
        return isNaN(t) ? null : t;
    }

    function isoFromMs(ms) {
        return new Date(ms).toISOString().slice(0, 10);
    }

    function addDays(iso, n) {
        return isoFromMs(parseIso(iso) + n * DAY_MS);
    }

    function daysBetween(fromIso, toIso) {
        return Math.round((parseIso(toIso) - parseIso(fromIso)) / DAY_MS);
    }

    function uploadDaysOf(talent) {
        if (!talent || !talent.uploadDays) return [];
        return String(talent.uploadDays).split(',')
            .map(d => parseInt(d.trim(), 10))
            .filter(d => !isNaN(d) && d >= 0 && d <= 6);
    }

    /**
     * Jadwal diturunkan dari kontrak, tidak disimpan. Hari upload terisi →
     * slot jatuh di hari itu. Kosong → kuota disebar rata sepanjang periode.
     * Algoritmanya sama persis dengan versi sebelumnya; hanya dipindah.
     */
    function generateSlots(days, start, end, count, skip) {
        const slots = [];
        if (count <= 0 || start === null || end === null || end < start) return slots;
        if (days.length) {
            for (let t = start; t <= end && slots.length < count; t += DAY_MS) {
                const iso = isoFromMs(t);
                if (days.indexOf(new Date(t).getUTCDay()) !== -1 && !skip.has(iso)) slots.push(iso);
            }
        } else {
            const span = Math.round((end - start) / DAY_MS) + 1;
            for (let i = 0; i < count; i++) {
                slots.push(isoFromMs(start + Math.round((i + 0.5) * span / count - 0.5) * DAY_MS));
            }
        }
        return slots;
    }

    /**
     * Setelah kontrak diedit, slot yang sudah lewat atau sudah terisi upload
     * "dipaku" (`pinnedSlots`) dan tidak dihitung ulang. Hanya sisa kuota yang
     * disusun ulang, mulai `pinnedFrom` (hari pengeditan), memakai kuota,
     * periode, dan hari upload yang baru.
     */
    function buildSchedule(talent) {
        const quota = parseInt(talent && talent.quota, 10) || 0;
        const start = parseIso(talent && talent.startDate);
        const end = parseIso(talent && talent.endDate);
        const days = uploadDaysOf(talent);

        const pinned = Array.isArray(talent && talent.pinnedSlots) ? talent.pinnedSlots.slice().sort() : null;
        if (pinned && pinned.length && talent.pinnedFrom) {
            const from = parseIso(talent.pinnedFrom);
            const mulai = start === null ? from : Math.max(start, from);
            const fresh = generateSlots(days, mulai, end, quota - pinned.length, new Set(pinned));
            return pinned.concat(fresh).sort();
        }

        if (!quota) return [];
        return generateSlots(days, start, end, quota, new Set());
    }

    function byDateThenId(a, b) {
        return String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id));
    }

    /**
     * Semua angka satu talent.
     *
     * Aturan pencocokan upload ke slot (satu upload = satu slot):
     *  1. Upload yang tanggalnya sama dengan slot mengesahkan slot itu.
     *  2. Upload sisanya mengisi slot kosong paling awal, berurutan waktu.
     *     Tanpa langkah ini, talent yang upload Rabu sementara slotnya jatuh
     *     Selasa terbaca "terlewat" padahal videonya sudah tayang.
     *  3. Upload yang tidak kebagian slot = kelebihan di atas kuota.
     */
    function talentMetrics(talent, uploads, today) {
        const quota = parseInt(talent && talent.quota, 10) || 0;
        const own = (uploads || [])
            .filter(u => u && u.talentId === talent.id && u.date)
            .slice()
            .sort(byDateThenId);

        const dates = buildSchedule(talent);
        const slots = dates.map(date => ({ date, uploadId: null, matchedBy: null, status: null }));
        const used = new Set();

        slots.forEach(slot => {
            const u = own.find(x => !used.has(x.id) && x.date === slot.date);
            if (u) { used.add(u.id); slot.uploadId = u.id; slot.matchedBy = 'tanggal'; }
        });
        const leftover = own.filter(u => !used.has(u.id));
        slots.forEach(slot => {
            if (slot.uploadId || !leftover.length) return;
            const u = leftover.shift();
            used.add(u.id); slot.uploadId = u.id; slot.matchedBy = 'urutan';
        });

        slots.forEach(slot => {
            slot.status = slot.uploadId ? 'done'
                : slot.date < today ? 'pending'
                : slot.date === today ? 'today'
                : 'future';
        });

        const uploaded = own.length;
        const pending = slots.filter(s => s.status === 'pending');
        const due = slots.filter(s => s.date <= today).length;
        const daysLeft = talent.endDate && parseIso(talent.endDate) !== null && parseIso(today) !== null
            ? daysBetween(today, talent.endDate) : null;

        return {
            quota,
            uploaded,
            remaining: Math.max(0, quota - uploaded),
            over: Math.max(0, uploaded - quota),
            percent: quota ? Math.round(uploaded / quota * 100) : 0,
            slots,
            // Jumlah slot yang semestinya sudah tayang sampai hari ini.
            target: due,
            filledDue: slots.filter(s => s.date <= today && s.status === 'done').length,
            pendingDates: pending.map(s => s.date),
            // Tertinggal dan jadwal terlewat kini angka yang sama: slot yang
            // tanggalnya sudah lewat dan belum terisi upload apa pun.
            behind: pending.length,
            todaySlotOpen: slots.some(s => s.status === 'today'),
            uploadedToday: own.some(u => u.date === today),
            // Kuota lebih besar dari slot yang muat di periode (mis. hari
            // upload terlalu jarang). Ditampilkan, bukan disembunyikan.
            unscheduled: Math.max(0, quota - slots.length),
            scheduleMode: uploadDaysOf(talent).length ? 'hari' : 'rata',
            daysLeft
        };
    }

    // ------------------------------------------------------------------------
    // Impor riwayat Notion
    // ------------------------------------------------------------------------

    const BULAN_NAMA = {
        january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
        august: 8, september: 9, october: 10, november: 11, december: 12,
        januari: 1, februari: 2, maret: 3, mei: 5, juni: 6, juli: 7,
        agustus: 8, oktober: 10, desember: 12
    };

    function rakitIso(th, bl, hr) {
        return th + '-' + String(bl).padStart(2, '0') + '-' + String(hr).padStart(2, '0');
    }

    // Notion mengekspor tanggal dalam beberapa bentuk tergantung bahasa dan
    // setelan akun, jadi keempatnya diterima.
    function parseTanggalNotion(s) {
        if (!s) return '';
        s = String(s).trim();

        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return m[1] + '-' + m[2] + '-' + m[3];

        m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
        if (m && BULAN_NAMA[m[1].toLowerCase()]) return rakitIso(m[3], BULAN_NAMA[m[1].toLowerCase()], m[2]);

        m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
        if (m && BULAN_NAMA[m[2].toLowerCase()]) return rakitIso(m[3], BULAN_NAMA[m[2].toLowerCase()], m[1]);

        // Bentuk angka: Notion mengekspor bulan/hari/tahun.
        m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) return rakitIso(m[3], m[1], m[2]);

        return '';
    }

    // Pengurai CSV yang menghormati tanda kutip, karena judul konten bisa
    // mengandung koma.
    function parseCSV(teks) {
        const hasil = [];
        let kolom = '', baris = [], dalamKutip = false;
        teks = String(teks).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (teks.charCodeAt(0) === 0xFEFF) teks = teks.slice(1);

        for (let i = 0; i < teks.length; i++) {
            const c = teks[i];
            if (dalamKutip) {
                if (c === '"') {
                    if (teks[i + 1] === '"') { kolom += '"'; i++; }
                    else dalamKutip = false;
                } else kolom += c;
            } else if (c === '"') {
                dalamKutip = true;
            } else if (c === ',') {
                baris.push(kolom); kolom = '';
            } else if (c === '\n') {
                baris.push(kolom); hasil.push(baris); baris = []; kolom = '';
            } else kolom += c;
        }
        if (kolom.length || baris.length) { baris.push(kolom); hasil.push(baris); }
        return hasil.filter(r => r.some(v => String(v).trim()));
    }

    const KOLOM_ID = ['id', 'page id', 'notion id', 'notion page id', 'url', 'page url', 'notion url', 'link notion'];

    // ID halaman Notion: 32 digit heksa, dengan atau tanpa tanda hubung, juga
    // bila tertanam di ujung URL halaman. Nilai lain (mis. properti Unique ID
    // "CC-12") dipakai apa adanya.
    function normalizeNotionId(v) {
        const s = String(v || '').trim();
        if (!s) return '';
        const polos = s.replace(/-/g, '');
        const m = polos.match(/([0-9a-f]{32})(?:[?#].*)?$/i);
        if (m) return m[1].toLowerCase();
        return s;
    }

    /**
     * CSV Content Calendar → baris `{nama, tgl, notionId}`.
     * Mengembalikan `{ error }` bila kolom wajib tidak ada.
     */
    function rowsFromNotionCsv(teks) {
        const baris = parseCSV(teks);
        if (baris.length < 2) return { error: 'kosong', rows: [], tanggalGagal: 0 };

        const kepala = baris[0].map(h => String(h).trim().toLowerCase());
        const iNama = kepala.indexOf('content name');
        const iTgl = kepala.indexOf('film date');
        const iId = kepala.findIndex(h => KOLOM_ID.indexOf(h) !== -1);
        if (iNama === -1 || iTgl === -1) return { error: 'kolom', header: baris[0], rows: [], tanggalGagal: 0 };

        const rows = [];
        let tanggalGagal = 0;
        for (let i = 1; i < baris.length; i++) {
            const nama = String(baris[i][iNama] || '').trim();
            const mentah = String(baris[i][iTgl] || '').trim();
            const tgl = parseTanggalNotion(mentah);
            if (nama && tgl) {
                rows.push({ nama, tgl, notionId: iId === -1 ? '' : normalizeNotionId(baris[i][iId]) });
            } else if (nama && mentah) tanggalGagal++;
        }
        return { rows, tanggalGagal, adaKolomId: iId !== -1, totalBaris: baris.length - 1 };
    }

    /**
     * Menentukan baris mana yang baru, tanpa mengubah apa pun.
     *
     * Kunci dedupe:
     *  - baris ber-ID: ID halaman Notion. Upload lama yang belum ber-ID pada
     *    talent + tanggal yang sama dianggap baris yang sama dan diklaim
     *    (ID-nya ditempelkan), supaya impor pertama setelah pembaruan ini
     *    tidak menggandakan seluruh riwayat lama.
     *  - baris tanpa ID: talent + tanggal.
     * Hasilnya: impor ulang berkas yang sama selalu menghasilkan nol entri baru.
     */
    function planNotionImport(talents, uploads, rows, today) {
        const baru = [];
        const klaim = [];      // { uploadId, notionId }
        const laporan = {};
        let duplikat = 0, diLuarPeriode = 0;

        const idTerpakai = new Set(uploads.filter(u => u.notionId).map(u => u.notionId));
        const diklaim = new Set();
        const kunciTalent = t => String(t.notionName || t.account || '').trim().toLowerCase();
        const kenal = new Set(talents.map(kunciTalent).filter(Boolean));
        const asing = [];

        rows.forEach(r => {
            const n = String(r.nama || '').trim();
            if (!kenal.has(n.toLowerCase()) && n && asing.indexOf(n) === -1) asing.push(n);
        });

        talents.forEach(t => {
            const kunci = kunciTalent(t);
            if (!kunci) return;
            const milik = uploads.filter(u => u.talentId === t.id);
            const tanggalBaru = new Set();

            rows.forEach(r => {
                if (String(r.nama || '').trim().toLowerCase() !== kunci) return;
                if (r.tgl < t.startDate || r.tgl > t.endDate || r.tgl > today) { diLuarPeriode++; return; }

                const nid = r.notionId || '';
                if (nid) {
                    if (idTerpakai.has(nid)) { duplikat++; return; }
                    const lama = milik.find(u => !u.notionId && u.date === r.tgl && !diklaim.has(u.id));
                    if (lama) {
                        diklaim.add(lama.id); idTerpakai.add(nid);
                        klaim.push({ uploadId: lama.id, notionId: nid });
                        duplikat++;
                        return;
                    }
                    idTerpakai.add(nid);
                } else {
                    if (milik.some(u => u.date === r.tgl) || tanggalBaru.has(r.tgl)) { duplikat++; return; }
                }
                tanggalBaru.add(r.tgl);
                baru.push({
                    id: 'upload-notion-' + t.id + '-' + (nid || r.tgl),
                    talentId: t.id, date: r.tgl,
                    title: 'Dari Notion Content Calendar', link: '',
                    source: 'notion', notionId: nid
                });
                laporan[t.account] = (laporan[t.account] || 0) + 1;
            });
        });

        return { baru, klaim, duplikat, diLuarPeriode, asing, laporan };
    }

    /**
     * Upload yang tercatat lebih dari sekali: ID Notion sama, atau talent,
     * tanggal, judul, dan tautan yang semuanya sama. Mengembalikan salinan
     * yang berlebih (yang pertama per kelompok dipertahankan).
     */
    function findDuplicateUploads(uploads) {
        const lihat = new Map();
        const lebih = [];
        uploads.slice().sort(byDateThenId).forEach(u => {
            const k = u.notionId
                ? 'n|' + u.talentId + '|' + u.notionId
                : 'x|' + u.talentId + '|' + u.date + '|' + String(u.title || '').trim() + '|' + String(u.link || '').trim();
            if (lihat.has(k)) lebih.push(u); else lihat.set(k, u);
        });
        return lebih;
    }

    // ------------------------------------------------------------------------
    // Edit kontrak
    // ------------------------------------------------------------------------

    const FIELD_LABELS = {
        name: 'Nama', account: 'Nama akun', platform: 'Platform', quota: 'Kuota video',
        startDate: 'Tanggal mulai', endDate: 'Tanggal berakhir', value: 'Nilai kontrak',
        uploadDays: 'Hari upload', fullName: 'Nama lengkap', phone: 'No. kontak',
        address: 'Alamat', bank: 'Rekening pembayaran', scheduleText: 'Keterangan jadwal di surat',
        contractDate: 'Tanggal surat', dpPercent: 'Persentase DP', notionName: 'Nama di Notion'
    };
    const CONTRACT_FIELDS = Object.keys(FIELD_LABELS);
    const SCHEDULE_FIELDS = ['quota', 'startDate', 'endDate', 'uploadDays'];
    // Nama di Notion hanya dipakai untuk impor, tidak tercetak di surat.
    const LETTER_FIELDS = CONTRACT_FIELDS.filter(f => f !== 'notionName');

    function asText(v) {
        return v === undefined || v === null ? '' : String(v).trim();
    }

    function normalizeUploadDays(v) {
        return uploadDaysOf({ uploadDays: v }).slice().sort((a, b) => a - b).join(',');
    }

    function sameValue(field, a, b) {
        if (field === 'uploadDays') return normalizeUploadDays(a) === normalizeUploadDays(b);
        return asText(a) === asText(b);
    }

    function diffFields(before, after) {
        return CONTRACT_FIELDS
            .filter(f => !sameValue(f, before[f], after[f]))
            .map(f => ({ field: f, label: FIELD_LABELS[f], from: asText(before[f]), to: asText(after[f]) }));
    }

    // Selisih dua daftar tanggal sebagai multiset (dua slot bisa jatuh di
    // tanggal yang sama pada jadwal sebar-rata).
    function diffSchedules(before, after) {
        const hitung = list => list.reduce((m, d) => (m[d] = (m[d] || 0) + 1, m), {});
        const a = hitung(before), b = hitung(after);
        const added = [], removed = [];
        Object.keys(Object.assign({}, a, b)).sort().forEach(d => {
            const n = (b[d] || 0) - (a[d] || 0);
            for (let i = 0; i < n; i++) added.push(d);
            for (let i = 0; i < -n; i++) removed.push(d);
        });
        return { added, removed };
    }

    /**
     * Rencana perubahan kontrak — tidak mengubah apa pun sampai dipakai.
     *
     *  - Field lain milik talent (riwayat, surat, paku jadwal) dipertahankan.
     *  - Kuota/tanggal/hari upload berubah → slot yang sudah lewat atau sudah
     *    terisi upload dipaku; hanya slot mendatang yang belum terisi disusun
     *    ulang. Daftar upload tidak pernah disentuh.
     *  - Setiap field yang berubah dicatat: waktu, kolom, lama → baru.
     *  - Surat yang sudah pernah dibuat ditandai perlu dibuat ulang.
     */
    function planContractEdit(before, fields, uploads, today, nowIso) {
        const after = Object.assign({}, before, fields);
        const changes = diffFields(before, after);
        const scheduleChanged = changes.some(c => SCHEDULE_FIELDS.indexOf(c.field) !== -1);
        const warnings = [];
        let kept = 0;

        if (scheduleChanged) {
            const m = talentMetrics(before, uploads, today);
            const paku = m.slots.filter(s => s.date < today || s.status === 'done').map(s => s.date);
            kept = paku.length;
            if (paku.length) {
                after.pinnedSlots = paku;
                after.pinnedFrom = today;
            } else {
                delete after.pinnedSlots;
                delete after.pinnedFrom;
            }
            const q = parseInt(after.quota, 10) || 0;
            if (paku.length > q) {
                warnings.push('Kuota baru (' + q + ') lebih kecil dari ' + paku.length +
                    ' slot yang sudah lewat atau terisi. Slot itu tetap, tidak ada slot mendatang.');
            }
        }

        const { added, removed } = diffSchedules(buildSchedule(before), buildSchedule(after));
        const hasil = talentMetrics(after, uploads, today);
        if (hasil.unscheduled) {
            warnings.push(hasil.unscheduled + ' kuota tidak muat di periode dengan hari upload ini.');
        }

        after.changeLog = (before.changeLog || []).concat(
            changes.map(c => Object.assign({ at: nowIso }, c))
        );

        const letterTouched = changes.some(c => LETTER_FIELDS.indexOf(c.field) !== -1);
        if (letterTouched && (before.letters || []).length) after.letterStale = true;

        return { talent: after, changes, scheduleChanged, added, removed, kept, warnings };
    }

    /**
     * Surat kontrak berversi. Isi yang tercetak disalin ke versi itu, sehingga
     * versi lama bisa diunduh ulang persis seperti saat dibuat walau kontrak
     * sudah diubah sesudahnya.
     */
    function createLetterVersion(talent, setelan, letterKeys, dpEffective, nowIso) {
        const data = {};
        LETTER_FIELDS.forEach(f => { data[f] = talent[f] === undefined ? '' : talent[f]; });
        data.dpPercent = dpEffective;
        data.id = talent.id;
        const s = {};
        letterKeys.forEach(k => { s[k] = setelan[k]; });

        const letters = (talent.letters || []).slice();
        const letter = { version: letters.length + 1, createdAt: nowIso, data, setelan: s };
        letters.push(letter);
        return { talent: Object.assign({}, talent, { letters, letterStale: false }), letter };
    }

    root.PantauCore = {
        parseIso, addDays, daysBetween, uploadDaysOf, buildSchedule, talentMetrics,
        parseTanggalNotion, parseCSV, normalizeNotionId, rowsFromNotionCsv,
        planNotionImport, findDuplicateUploads,
        FIELD_LABELS, SCHEDULE_FIELDS, diffFields, diffSchedules, planContractEdit, createLetterVersion
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);

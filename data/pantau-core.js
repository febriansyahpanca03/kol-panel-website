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
    // Tanggal upload yang dipilih satu per satu di kalender (bukan hari tetap
    // tiap minggu). Disimpan sebagai daftar YYYY-MM-DD, urut dan unik.
    function uploadDatesOf(talent) {
        if (!talent || !Array.isArray(talent.uploadDates)) return [];
        return [...new Set(talent.uploadDates.filter(d => parseIso(d) !== null))].sort();
    }

    function generateSlots(days, start, end, count, skip, dates) {
        const slots = [];
        if (count <= 0 || start === null || end === null || end < start) return slots;
        if (dates && dates.length) {
            dates.forEach(iso => {
                const t = parseIso(iso);
                if (slots.length < count && t >= start && t <= end && !skip.has(iso)) slots.push(iso);
            });
        } else if (days.length) {
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
        const dates = uploadDatesOf(talent);

        const pinned = Array.isArray(talent && talent.pinnedSlots) ? talent.pinnedSlots.slice().sort() : null;
        if (pinned && pinned.length && talent.pinnedFrom) {
            const from = parseIso(talent.pinnedFrom);
            const mulai = start === null ? from : Math.max(start, from);
            const fresh = generateSlots(days, mulai, end, quota - pinned.length, new Set(pinned), dates);
            return pinned.concat(fresh).sort();
        }

        if (!quota) return [];
        return generateSlots(days, start, end, quota, new Set(), dates);
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
            scheduleMode: uploadDatesOf(talent).length ? 'tanggal' : uploadDaysOf(talent).length ? 'hari' : 'rata',
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
                const dalamKontrak = contractsOf(t).some(c => r.tgl >= c.startDate && r.tgl <= c.endDate);
                if (!dalamKontrak || r.tgl > today) { diLuarPeriode++; return; }

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

    // ------------------------------------------------------------------------
    // Jenis konten dan platform
    // ------------------------------------------------------------------------

    // Satu kontrak = satu jenis konten. Kontrak lama tanpa jenis = video.
    const CONTENT_TYPES = [
        { id: 'video', label: 'Video', unit: 'video' },
        { id: 'poster', label: 'Poster / foto feed', unit: 'poster' },
        { id: 'carousel', label: 'Carousel', unit: 'carousel' },
        { id: 'story', label: 'Story', unit: 'story' },
        { id: 'live', label: 'Live', unit: 'sesi live' },
        { id: 'lainnya', label: 'Konten lain', unit: 'konten' }
    ];

    function contentTypeOf(talent) {
        const id = talent && talent.contentType;
        return CONTENT_TYPES.find(c => c.id === id) || CONTENT_TYPES[0];
    }

    const PLATFORMS = ['TikTok', 'Instagram', 'YouTube', 'Facebook', 'Threads', 'Lainnya'];

    // Kontrak lama menyimpan satu string `platform`; yang baru `platforms`
    // (bisa lebih dari satu karena konten di-mirror ke beberapa platform).
    function platformsOf(talent) {
        if (!talent) return [];
        const raw = Array.isArray(talent.platforms) && talent.platforms.length
            ? talent.platforms
            : String(talent.platform || '').split(/[,+/]/);
        const out = [];
        raw.map(p => String(p).trim()).filter(Boolean).forEach(p => {
            const baku = PLATFORMS.find(x => x.toLowerCase() === p.toLowerCase()) || p;
            if (out.indexOf(baku) === -1) out.push(baku);
        });
        return out;
    }

    // "Lainnya" saja dianggap belum diisi: tidak ada platform nyata yang tercatat.
    function platformMissing(talent) {
        const p = platformsOf(talent);
        return !p.length || (p.length === 1 && p[0] === 'Lainnya');
    }

    const FIELD_LABELS = {
        name: 'Nama', account: 'Nama akun', platforms: 'Platform', contentType: 'Jenis konten', quota: 'Kuota',
        startDate: 'Tanggal mulai', endDate: 'Tanggal berakhir', value: 'Nilai kontrak',
        uploadDays: 'Hari upload', uploadDates: 'Tanggal upload', fullName: 'Nama lengkap', phone: 'No. kontak',
        address: 'Alamat', bank: 'Rekening pembayaran', scheduleText: 'Keterangan jadwal di surat',
        contractDate: 'Tanggal surat', dpPercent: 'Persentase DP', notionName: 'Nama di Notion'
    };
    const CONTRACT_FIELDS = Object.keys(FIELD_LABELS);
    const SCHEDULE_FIELDS = ['quota', 'startDate', 'endDate', 'uploadDays', 'uploadDates'];
    // Nama di Notion hanya dipakai untuk impor, tidak tercetak di surat.
    const LETTER_FIELDS = CONTRACT_FIELDS.filter(f => f !== 'notionName');

    function asText(v) {
        return v === undefined || v === null ? '' : String(v).trim();
    }

    function normalizeUploadDays(v) {
        return uploadDaysOf({ uploadDays: v }).slice().sort((a, b) => a - b).join(',');
    }

    // Nilai satu kolom dalam bentuk baku, untuk dibandingkan dan dicatat.
    function fieldText(field, t) {
        if (field === 'uploadDays') return normalizeUploadDays(t.uploadDays);
        if (field === 'uploadDates') return uploadDatesOf(t).join(', ');
        if (field === 'platforms') return platformsOf(t).join(', ');
        if (field === 'contentType') return contentTypeOf(t).label;
        return asText(t[field]);
    }

    function diffFields(before, after) {
        return CONTRACT_FIELDS
            .filter(f => fieldText(f, before) !== fieldText(f, after))
            .map(f => ({ field: f, label: FIELD_LABELS[f], from: fieldText(f, before), to: fieldText(f, after) }));
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

    // ------------------------------------------------------------------------
    // Kontrak berurutan (perpanjangan)
    // ------------------------------------------------------------------------
    //
    // Kontrak yang sedang berjalan tetap disimpan di kolom talent itu sendiri
    // (agar semua tampilan lama tetap bekerja); kontrak sebelumnya diarsipkan
    // di talent.kontrakLama. Data lama tanpa arsip = Kontrak #1.

    const KOLOM_KONTRAK = ['quota', 'value', 'startDate', 'endDate', 'uploadDays', 'uploadDates', 'contentType',
        'platforms', 'platform', 'dpPercent', 'scheduleText', 'contractDate', 'letters', 'letterStale',
        'pinnedSlots', 'pinnedFrom'];

    function contractsOf(talent) {
        const lama = (talent.kontrakLama || []).map((c, i) => Object.assign({ no: c.no || i + 1, arsip: true }, c));
        const kini = { no: talent.kontrakNo || lama.length + 1, arsip: false };
        KOLOM_KONTRAK.forEach(k => { if (k in talent) kini[k] = talent[k]; });
        return lama.concat([kini]).sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)) || a.no - b.no);
    }

    /**
     * Kontrak untuk satu tanggal upload: yang periodenya mencakup tanggal itu
     * (bila tumpang tindih, yang mulai paling akhir). Sebelum kontrak pertama
     * → kontrak pertama; sesudah kontrak terakhir → kontrak terakhir (upload
     * telat tetap milik kontrak berjalan). Di sela dua kontrak → null.
     */
    function contractForDate(kontrak, date) {
        if (!kontrak.length) return null;
        const cakup = kontrak.filter(c => date >= c.startDate && date <= c.endDate);
        if (cakup.length) return cakup[cakup.length - 1];
        if (date < kontrak[0].startDate) return kontrak[0];
        const akhir = kontrak[kontrak.length - 1];
        if (date > akhir.endDate) return akhir;
        return null;
    }

    function uploadsForContract(talent, uploads, no) {
        const kontrak = contractsOf(talent);
        return uploads.filter(u => {
            if (u.talentId !== talent.id || !u.date) return false;
            const c = contractForDate(kontrak, u.date);
            return c && c.no === no;
        });
    }

    function currentUploads(talent, uploads) {
        const kontrak = contractsOf(talent);
        return uploadsForContract(talent, uploads, kontrak.find(c => !c.arsip).no);
    }

    function outsideContractUploads(talent, uploads) {
        const kontrak = contractsOf(talent);
        return uploads.filter(u => u.talentId === talent.id && u.date && !contractForDate(kontrak, u.date));
    }

    /**
     * Perpanjang: kontrak berjalan diarsipkan utuh (termasuk suratnya), lalu
     * kolom kontrak diisi kontrak baru. Identitas talent, riwayat upload, dan
     * analitik tetap satu. Surat dan paku jadwal kontrak baru mulai kosong.
     */
    function renewContract(talent, fields, nowIso) {
        const kontrak = contractsOf(talent);
        const kini = kontrak.find(c => !c.arsip);
        if (!fields.startDate || !fields.endDate || fields.endDate < fields.startDate) {
            return { error: 'Periode kontrak baru tidak valid.' };
        }
        if (fields.startDate <= kini.startDate) {
            return { error: 'Kontrak baru harus mulai setelah ' + kini.startDate + ' (awal kontrak #' + kini.no + ').' };
        }
        const arsip = { no: kini.no, arsipAt: nowIso };
        KOLOM_KONTRAK.forEach(k => { if (k in talent) arsip[k] = talent[k]; });

        const baru = Object.assign({}, talent, fields);
        baru.kontrakLama = (talent.kontrakLama || []).concat([arsip]);
        baru.kontrakNo = kini.no + 1;
        baru.letters = [];
        baru.letterStale = false;
        delete baru.pinnedSlots;
        delete baru.pinnedFrom;
        const ringkas = c => '#' + c.no + ' ' + c.startDate + ' s/d ' + c.endDate + ', ' + c.quota + ' konten, Rp' + (Number(c.value) || 0);
        baru.changeLog = (talent.changeLog || []).concat([{
            at: nowIso, field: 'kontrak', label: 'Perpanjang kontrak',
            from: ringkas(kini), to: ringkas(Object.assign({ no: kini.no + 1 }, baru))
        }]);
        return { talent: baru };
    }

    // ------------------------------------------------------------------------
    // Biaya & performa
    // ------------------------------------------------------------------------

    // Kosong berarti "tidak ada data", bukan nol — nol palsu menyeret rata-rata.
    // Angka dari sheet berlokal Indonesia memakai titik sebagai pemisah ribuan
    // ("1.200" = seribu dua ratus) dan koma sebagai desimal.
    function numOrNull(v) {
        if (v === null || v === undefined) return null;
        if (typeof v === 'number') return isFinite(v) ? v : null;
        let s = String(v).trim().replace(/^rp\s*/i, '').replace(/\s/g, '');
        if (!s) return null;
        if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
        else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
        else s = s.replace(',', '.');
        const n = Number(s);
        return isFinite(n) ? n : null;
    }

    function median(list) {
        const xs = list.filter(x => x !== null && isFinite(x)).slice().sort((a, b) => a - b);
        if (!xs.length) return null;
        const mid = Math.floor(xs.length / 2);
        return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
    }

    function monthOf(iso) {
        return String(iso || '').slice(0, 7);
    }

    function pricePerContent(talent) {
        const q = parseInt(talent && talent.quota, 10) || 0;
        const v = Number(talent && talent.value) || 0;
        return q ? v / q : null;
    }

    /**
     * Buku biaya per talent per bulan. Biaya dicatat saat konten tayang:
     * harga per konten (nilai kontrak ÷ kuota) × konten tayang bulan itu.
     * Upload di atas kuota adalah bonus — tidak menambah biaya.
     */
    function monthlyLedger(talents, uploads) {
        const out = {};
        talents.forEach(t => {
            const own = uploads.filter(u => u.talentId === t.id && u.date).slice().sort(byDateThenId);
            out[t.id] = {};
            // Tiap kontrak punya harga dan kuotanya sendiri, sehingga biaya
            // bulan lama tidak berubah saat kontrak diperpanjang.
            const kontrak = contractsOf(t);
            const terpakai = {};
            own.forEach(u => {
                const m = monthOf(u.date);
                const a = out[t.id][m] || (out[t.id][m] = {
                    konten: 0, bonus: 0, biaya: 0, views: 0, interaksi: 0, klik: 0,
                    denganViews: 0, denganInteraksi: 0, denganKlik: 0, luarKontrak: 0
                });
                const c = contractForDate(kontrak, u.date);
                if (!c) { a.bonus++; a.luarKontrak++; }
                else {
                    terpakai[c.no] = (terpakai[c.no] || 0) + 1;
                    if (terpakai[c.no] <= (parseInt(c.quota, 10) || 0)) { a.konten++; a.biaya += pricePerContent(c) || 0; }
                    else a.bonus++;
                }
                const v = numOrNull(u.views), it = numOrNull(u.interaksi), k = numOrNull(u.klik);
                if (v !== null) { a.views += v; a.denganViews++; }
                if (it !== null) { a.interaksi += it; a.denganInteraksi++; }
                if (k !== null) { a.klik += k; a.denganKlik++; }
            });
        });
        return out;
    }

    /** Jadwal kas keluar sesuai surat: DP di awal kontrak, pelunasan di akhir. */
    function paymentSchedule(talent, dpPercent) {
        const total = Number(talent.value) || 0;
        const dp = Math.round(total * (Number(dpPercent) || 0) / 100);
        const out = [];
        if (dp > 0 && talent.startDate) out.push({ month: monthOf(talent.startDate), date: talent.startDate, jenis: 'DP', jumlah: dp });
        if (total - dp > 0 && talent.endDate) out.push({ month: monthOf(talent.endDate), date: talent.endDate, jenis: 'Pelunasan', jumlah: total - dp });
        return out;
    }

    /**
     * CPM = biaya ÷ views × 1.000, CPV = biaya ÷ views, CPC = biaya ÷ klik,
     * CPE = biaya ÷ interaksi, ER = interaksi ÷ views. Tanpa data → null,
     * supaya layar menulis "belum ada data", bukan Rp0 yang terbaca gratis.
     */
    function costMetrics(input) {
        const biaya = numOrNull(input.biaya);
        const views = numOrNull(input.views);
        const klik = numOrNull(input.klik);
        const interaksi = numOrNull(input.interaksi);
        const bagi = (a, b) => (a !== null && b !== null && b > 0 ? a / b : null);
        return {
            cpm: bagi(biaya, views) === null ? null : bagi(biaya, views) * 1000,
            cpv: bagi(biaya, views),
            cpc: bagi(biaya, klik),
            cpe: bagi(biaya, interaksi),
            er: bagi(interaksi, views) === null ? null : bagi(interaksi, views) * 100,
            ctr: bagi(klik, views) === null ? null : bagi(klik, views) * 100
        };
    }

    /**
     * Harga wajar per konten = median views ÷ 1.000 × target CPM (rumus yang
     * sama dengan "pagar harga" di KOL Panel). Median dipakai agar satu video
     * viral tidak membuat harga terlihat murah.
     *
     * Status: wajar (≤ harga wajar), di-atas (≤ +ambang %), overprice (lebih
     * dari itu), cek (belum ada views, tapi jauh di atas talent lain sejenis),
     * tanpa-data.
     */
    function priceVerdict(talent, uploads, opts) {
        const targetCpm = Number(opts && opts.targetCpm) || 0;
        const ambang = Number(opts && opts.overpricePercent);
        const batas = 1 + (isFinite(ambang) ? ambang : 50) / 100;
        const harga = pricePerContent(talent);
        const views = uploads
            .filter(u => u.talentId === talent.id)
            .map(u => numOrNull(u.views))
            .filter(v => v !== null);

        const res = {
            harga, sampel: views.length, medianViews: median(views),
            hargaWajar: null, rasio: null, status: 'tanpa-data', catatan: [], pembanding: null
        };
        if (harga === null || !harga) return res;

        // Belum ada views per upload, tapi ada analitik ringkas yang disimpan
        // dari kalkulator (total views ÷ jumlah konten). Dipakai sebagai
        // rata-rata per konten; ditandai supaya jelas sumbernya.
        const ringkas = opts && opts.snapshot;
        if (!views.length && ringkas && numOrNull(ringkas.views) !== null && numOrNull(ringkas.konten) > 0) {
            res.sumber = 'analitik';
            res.sampel = numOrNull(ringkas.konten);
            res.medianViews = numOrNull(ringkas.views) / numOrNull(ringkas.konten);
            if (targetCpm > 0) {
                res.hargaWajar = res.medianViews / 1000 * targetCpm;
                res.rasio = res.hargaWajar > 0 ? harga / res.hargaWajar : Infinity;
                res.status = res.rasio <= 1 ? 'wajar' : res.rasio <= batas ? 'di-atas' : 'overprice';
            }
            res.catatan.push('Dari analitik tersimpan ' + (ringkas.tanggal || '') + ' (rata-rata ' + res.sampel + ' konten).');
        }

        if (views.length && targetCpm > 0) {
            res.hargaWajar = res.medianViews / 1000 * targetCpm;
            res.rasio = res.hargaWajar > 0 ? harga / res.hargaWajar : Infinity;
            res.status = res.rasio <= 1 ? 'wajar' : res.rasio <= batas ? 'di-atas' : 'overprice';
            if (views.length < 3) {
                res.catatan.push('Baru ' + views.length + ' konten punya data views; penilaian makin akurat bila datanya bertambah.');
            }
        }

        const peers = (opts && opts.peerPrices || []).filter(x => x !== null && x > 0);
        if (peers.length >= 2) {
            const med = median(peers);
            res.pembanding = med;
            if (harga > 2 * med) {
                res.catatan.push('Harga per konten ' + (harga / med).toFixed(1).replace('.', ',') +
                    '× median talent lain dengan jenis konten yang sama.');
                if (res.status === 'tanpa-data') res.status = 'cek';
            }
        }
        return res;
    }

    // ------------------------------------------------------------------------
    // Impor performa dari KOL Manager (sheet "Post" milik ekstensi KOL Panel)
    // ------------------------------------------------------------------------

    // Sheet KOL Manager berlokal Indonesia, jadi bentuk garis miring dibaca
    // hari/bulan/tahun. Bentuk ISO dan nama bulan juga diterima.
    function parseTanggalSheet(s) {
        s = String(s || '').trim();
        if (!s) return '';
        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return m[1] + '-' + m[2] + '-' + m[3];
        m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
        if (m) {
            let d = +m[1], mo = +m[2];
            if (mo > 12 && d <= 12) { const x = d; d = mo; mo = x; }
            if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
            return rakitIso(m[3], mo, d);
        }
        return parseTanggalNotion(s);
    }

    function normHandle(s) {
        return String(s || '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]/g, '');
    }

    function sumOrNull(values) {
        const xs = values.map(numOrNull).filter(v => v !== null);
        return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
    }

    function rowsFromKolCsv(teks) {
        const baris = parseCSV(teks);
        if (baris.length < 2) return { error: 'kosong', rows: [] };
        const kepala = baris[0].map(h => String(h).trim().toLowerCase());
        const i = n => kepala.indexOf(n);
        if (i('post id') === -1 || i('views') === -1) return { error: 'kolom', header: baris[0], rows: [] };
        const ambil = (r, n) => (i(n) === -1 ? '' : r[i(n)]);
        const rows = baris.slice(1).map(r => ({
            platform: String(ambil(r, 'platform')).trim(),
            username: String(ambil(r, 'username')).trim(),
            postId: String(ambil(r, 'post id')).trim(),
            tgl: parseTanggalSheet(ambil(r, 'tanggal')),
            views: numOrNull(ambil(r, 'views')),
            interaksi: sumOrNull(['likes', 'comments', 'shares', 'saves', 'replies'].map(n => ambil(r, n)))
        })).filter(r => r.postId);
        return { rows };
    }

    /**
     * Mencocokkan post dari sheet ke entri upload:
     *  1. ID post tercantum di tautan upload (paling pasti);
     *  2. akun talent = username sheet dan tanggal tayang sama.
     * Satu konten yang di-mirror ke TikTok dan Instagram mendapat dua angka
     * (satu per platform); views totalnya dijumlah.
     */
    function planKolImport(talents, uploads, rows) {
        const cocok = [];
        const tidakCocok = [];
        const terpakai = new Set();
        rows.forEach(r => {
            const plat = r.platform || 'Lainnya';
            let u = r.postId.length >= 5
                ? uploads.find(x => x.link && x.link.indexOf(r.postId) !== -1)
                : null;
            let via = 'tautan';
            if (!u && r.tgl) {
                const h = normHandle(r.username);
                const t = h && talents.find(x => normHandle(x.account) === h || normHandle(x.notionName) === h);
                if (t) {
                    u = uploads.find(x => x.talentId === t.id && x.date === r.tgl && !terpakai.has(x.id + '|' + plat));
                    via = 'akun+tanggal';
                }
            }
            if (!u) { tidakCocok.push(r); return; }
            terpakai.add(u.id + '|' + plat);
            cocok.push({ uploadId: u.id, platform: plat, postId: r.postId, views: r.views, interaksi: r.interaksi, via });
        });
        return { cocok, tidakCocok };
    }

    /** Menulis hasil pencocokan; views & interaksi = jumlah semua platform. */
    function applyKolImport(uploads, plan, nowIso) {
        plan.cocok.forEach(c => {
            const u = uploads.find(x => x.id === c.uploadId);
            if (!u) return;
            u.perf = Object.assign({}, u.perf);
            u.perf[c.platform] = { postId: c.postId, views: c.views, interaksi: c.interaksi, at: nowIso };
            const per = Object.values(u.perf);
            u.views = sumOrNull(per.map(p => p.views));
            u.interaksi = sumOrNull(per.map(p => p.interaksi));
        });
        return uploads;
    }

    root.PantauCore = {
        contractsOf, contractForDate, uploadsForContract, currentUploads, outsideContractUploads, renewContract,
        numOrNull, median, monthOf, pricePerContent, monthlyLedger, paymentSchedule, costMetrics, priceVerdict,
        parseTanggalSheet, rowsFromKolCsv, planKolImport, applyKolImport,
        parseIso, addDays, daysBetween, uploadDaysOf, buildSchedule, talentMetrics,
        parseTanggalNotion, parseCSV, normalizeNotionId, rowsFromNotionCsv,
        planNotionImport, findDuplicateUploads, uploadDatesOf,
        CONTENT_TYPES, contentTypeOf, PLATFORMS, platformsOf, platformMissing,
        FIELD_LABELS, SCHEDULE_FIELDS, diffFields, diffSchedules, planContractEdit, createLetterVersion
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);

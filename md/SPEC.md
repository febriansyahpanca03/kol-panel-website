# KOL Panel — Spec

## Konteks

Membangun **KOL Panel**: alat bantu untuk agency dan freelancer campaign KOL di Indonesia. Landing page-nya sudah jadi (static, terpisah). Produknya terdiri dari dua bagian:

1. **Ekstensi Chrome (MV3)** — muncul sebagai panel saat membuka profil Instagram, TikTok, atau Threads. Membaca data profil dan post, menghitung metrik, menampilkannya, lalu mengirimnya ke spreadsheet.
2. **KOL Manager** — Google Sheets + Apps Script yang dipasang sendiri di Drive, jadi tujuan pengiriman data.

Masalah yang dipecahkan: rekap 40 KOL sekarang dikerjakan manual — buka profil, catat followers, buka 12 post satu-satu, catat likes/komentar/views, hitung ER di kalkulator, ketik ke sheet, ulangi. Butuh sehari penuh dan angkanya sering salah karena tampilan sudah dibulatkan.

## Batasan yang tidak bisa ditawar

Ini menentukan arsitekturnya, dipatuhi ketat:

- **Tidak boleh membuat request sendiri ke API platform.** Ekstensi hanya boleh *ikut membaca* respons yang halaman itu memang minta untuk dirinya sendiri, ditambah payload JSON yang sudah tertanam di HTML. Tidak ada `fetch` ke endpoint platform, tidak ada penyusunan ulang signature, tidak ada rotasi token.
- **Tidak ada bulk scraping.** Data hanya terbaca untuk profil yang sedang dibuka, saat dibuka. Tidak ada antrean, crawler, atau iterasi otomatis antar-akun.
- **Tidak minta kredensial apa pun.** Tidak ada form login, tidak ada penyimpanan cookie atau session.
- **Tidak ada server sendiri di tengah.** Data berhenti di dua tempat: `chrome.storage.local` dan spreadsheet Google milik user.
- **Parser tidak boleh mengunci path.** Jangan tulis `data.user.stats.followerCount`. Platform memindahkan struktur datanya beberapa kali setahun.

Kalau ada permintaan yang bertabrakan dengan batasan ini: bilang, jangan diam-diam dicarikan jalan pintas.

## Bagian 1 — Ekstensi Chrome

Stack: TypeScript, Vite, Vitest. Manifest V3. Tanpa framework UI berat — Preact atau vanilla + template, asal panelnya ringan.

### Pengambilan data

Content script jalan di `document_start`. Script terinjeksi ke **MAIN world** yang mem-patch `window.fetch` dan `XMLHttpRequest.prototype.open/send` untuk menyalin respons yang lewat, lalu kirim salinannya ke ISOLATED world lewat `window.postMessage` dengan penanda origin yang jelas. Patch-nya harus transparan: nilai balik asli diteruskan apa adanya, error tidak ditelan, halaman tetap jalan normal kalau patch gagal.

Sumber kedua: JSON yang sudah ada di dalam `<script>` di HTML awal (TikTok menaruhnya di rehydration payload, Instagram di beberapa blok berbeda). Ambil semuanya, jangan pilih-pilih berdasarkan nama variabel.

### Parser berbasis bentuk

Walker yang menelusuri seluruh objek JSON secara rekursif dan mengenali objek berdasarkan **bentuknya**, bukan lokasinya:

- Objek berbentuk **profil**: kombinasi field identitas (username/handle/uniqueId) dan angka follower dengan nama apa pun (`followerCount`, `follower_count`, `edge_followed_by.count`, dst).
- Objek berbentuk **post**: id, timestamp, dan setidaknya satu metrik interaksi.

Normalkan ke skema kanonik (didesain & disetujui sebelum parser ditulis di tahap 2):

```
Profile { platform, username, displayName, followers, verified, capturedAt }
Post    { id, platform, takenAt, likes, comments, views, shares, saves, replies, isPaid, isPinned }
```

Aturan penting: **field yang tidak tersedia harus `null`, bukan `0`.** Like disembunyikan, komentar dimatikan, views tidak dibuka platform — semuanya `null`. Nol palsu menyeret rata-rata ke angka salah tanpa disadari. Tidak dikompromikan demi tipe yang lebih rapi.

### Modul statistik

Modul murni, tanpa DOM, mudah dites:

- Sampel default **12 post terakhir, post pinned dikecualikan**. Bisa diubah lewat pengaturan.
- Hitung **mean dan median berdampingan**, keduanya selalu tersedia. Median jadi tampilan default.
- **Nilai `null` dilewati**, bukan dihitung nol. Hitung dari post yang punya nilai saja, catat berapa post yang dipakai.
- **ER** = interaksi / followers × 100. TikTok juga **ER by views** = interaksi / views × 100. Threads tidak punya kolom komentar → interaksi = suka + balasan, rumus ini ditampilkan apa adanya di panel.
- **Deteksi outlier**: post tertinggi ≥ 5× median → flag + rasio.
- **Ritme posting**: dari **median selang antar-post**, bukan jumlah post dibagi rentang waktu. Keluarkan post/minggu dan rentang sampel.
- **Pagar harga endorse**: `rata-rata views / 1000 × target CPM`. Target CPM dari pengaturan, default Rp100.000. Views tidak tersedia (Threads) → `null`, panel jelaskan kenapa, bukan Rp0.
- **Pemisahan organik vs berbayar**: metrik terpisah untuk dua kelompok. Saringan hanya muncul kalau ada minimal satu post berbayar di sampel.

### Panel

Render di **Shadow DOM**. Bisa dilipat, posisi diingat, tidak menghalangi kontrol asli halaman.

Isi: followers + delta, toggle rata-rata/median, ER besar + rumus tertulis, banner outlier (rasio + ajakan pindah ke median), saringan organik/berbayar, daftar per-post scrollable, ritme posting, pagar harga CPM, tombol kirim ke Sheets.

**Badge ER di tiap thumbnail** pada grid profil: hijau ≥ 2× median, redup < 0,5× median, penanda khusus post berbayar. `MutationObserver` + `IntersectionObserver`, **tanpa request tambahan** — murni dari data yang sudah terkumpul.

### Penyimpanan

`chrome.storage.local`. Riwayat followers: satu angka per akun per hari, maksimal **60 hari untuk 400 akun**, eviction LRU saat penuh. Delta 7 hari di panel. Tombol ekspor dan hapus semua data di halaman pengaturan.

### Halaman pengaturan

URL Web App Apps Script, token, ukuran sampel, target CPM default, default kolom niche dan campaign, tombol tes koneksi.

## Bagian 2 — KOL Manager (Apps Script)

Sheet: `KOL`, `Post`, `Campaign`, `Kalender`, `Dashboard`, `Config`.

`doPost` menerima payload dari ekstensi, verifikasi token dengan perbandingan waktu-konstan, lalu:

- **Upsert berdasarkan `username + platform`**, bukan append. Kirim ulang memperbarui baris lama.
- **Kolom isian manusia tidak boleh ditimpa**: rate card, kontak, catatan, biaya. Ditandai di satu tempat sebagai daftar yang dilindungi, bukan dipencar sebagai pengecualian di banyak fungsi.
- Baris post di-upsert berdasarkan `postId`.
- `LockService` supaya dua pengiriman bersamaan tidak saling menimpa.

Dashboard: budget, terpakai, sisa, % target views, CPV, CPE, ER aktual per campaign. **Semuanya rumus sheet**, bukan nilai yang ditulis script.

Aturan tampilan: **CPV dan CPE dibiarkan kosong selama belum ada view.** Nol di kolom biaya-per-hasil terbaca seperti "gratis".

Kalender post: rencana dan aktual **satu baris**, bukan dua tabel. Post telat / tayang besok naik ke daftar "Perlu perhatian" di dashboard.

## Testing

Vitest, porsi terbesar di parser dan modul statistik.

Fixture payload asli (dianonimkan) di `tests/fixtures/`, termasuk **bentuk lama dan baru** untuk platform yang sama. Struktur baru ditemukan → fixture masuk repo dulu, baru parser disesuaikan.

Kasus wajib punya tes:
- like disembunyikan → `null`, bukan `0`, tidak menurunkan rata-rata
- satu post viral → median stabil, flag outlier menyala dengan rasio benar
- post pinned dikecualikan dari sampel
- sampel kurang dari 12 post
- semua metrik kosong pada satu post
- ritme posting untuk akun yang posting tidak teratur
- upsert dua kali → satu baris, kolom manusia utuh

## Cara mengerjakan

Bertahap, berhenti di tiap akhir tahap untuk direview:

1. Struktur repo, `manifest.json`, build Vite yang jalan, panel kosong yang berhasil muncul di ketiga platform. **[DONE]**
2. Lapisan pengambilan data + skema kanonik. Skema ditunjukkan sebelum parser ditulis. **[DONE]**
3. Parser berbasis bentuk untuk TikTok saja, lengkap fixture dan tes. **[DONE]**
4. Modul statistik, lengkap tes. **[DONE]**
5. Panel menampilkan angka betulan. **[DONE]**
6. Instagram dan Threads. **[DONE]**
7. Badge di thumbnail. **[DONE]**
8. Apps Script + pengiriman ke Sheets. **[DONE]**
9. Halaman pengaturan, ekspor, hapus data. **[DONE]**

Di tiap tahap: kode dulu, tes menyusul di tahap yang sama, tidak ditunda. Keputusan desain dengan lebih dari satu jawaban wajar → ditanyakan, bukan dipilih sendiri diam-diam.

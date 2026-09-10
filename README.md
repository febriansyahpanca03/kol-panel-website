# KOL Panel — Dokumentasi

Situs dokumentasi untuk **KOL Panel**, ekstensi Chrome MV3 yang mengumpulkan
metrik KOL dari Instagram, TikTok, dan Threads lalu mengirimnya ke Google Sheets.

## Isi

| Halaman | Keterangan |
|---|---|
| `index.html` | Beranda dan indeks dokumen |
| `setup-guide.html` | Panduan setup 5 langkah |
| `config-generator.html` | Alat bantu menyusun setelan ekstensi |
| `deployment-dashboard.html` | Status proyek dan checklist pra-rilis |
| `doc.html?p=…` | Penampil dokumen Markdown dari `md/` |

## Menjalankan secara lokal

```bash
npx serve .
# atau
python -m http.server 8000
```

Buka `http://localhost:8000`.

> `doc.html` mengambil berkas dari `/md/` lewat `fetch`, jadi situs perlu
> dilayani lewat HTTP — membuka berkas langsung dengan `file://` tidak cukup.

## Deployment

Situs statis, tanpa langkah build. Setiap push ke `main` otomatis di-deploy Vercel.

```bash
git add .
git commit -m "docs: perbarui panduan"
git push
```

## Repo terkait

Kode ekstensi dan Apps Script ada di repo `kol-panel` yang terpisah.

## Model data relasional (Tahap 1)

`data/` berisi model data relasional untuk Pantau Talent, terpisah dari
dashboard yang sudah berjalan:

| Berkas | Isi |
|---|---|
| `data/model.js` | Bentuk entitas, ID tetap, identitas video, tanggal Asia/Jakarta |
| `data/migrate.js` | Migrasi dari bentuk lama `{talents, uploads}`, dapat diulang |
| `data/quota.js` | Progres berbasis kewajiban, konfirmasi, riwayat pengukuran |
| `data/storage.js` | Bootstrap, cadangan sekali jalan, pemulihan |

```bash
npm install
npm test
```

### Yang berubah dari bentuk lama

Bentuk lama menyatukan talent dan kontrak dalam satu baris, sehingga satu
talent hanya bisa punya satu kontrak dan satu akun. Kuota dihitung dari
jumlah baris upload, jadi impor ulang mengurangi kuota dua kali.

Model baru memisahkan talent, akun, kontrak, kewajiban, konten, video, dan
pengukuran. Kuota dihitung dari konten yang **dikonfirmasi** terhadap satu
kewajiban, sehingga pemindaian ulang tidak bisa menghitung ganda.

### Belum menjadi penyimpanan bersama

`localStorage` terikat ke domain dashboard, sehingga extension yang berjalan
di `tiktok.com` **tidak bisa** membacanya. Menyatukan data keduanya butuh
penyimpanan yang bisa dijangkau dua sisi, dan itu keputusan arsitektur yang
belum diambil — lihat laporan di percakapan.

Dashboard lama tetap membaca dan menulis kunci `pantau-talent-data` seperti
sebelumnya. Model relasional diturunkan ke kunci `pantau-talent-v1` dan belum
dipakai oleh antarmuka mana pun.

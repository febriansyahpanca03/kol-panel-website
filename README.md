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

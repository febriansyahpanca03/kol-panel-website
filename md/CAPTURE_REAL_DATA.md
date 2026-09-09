# Capture Real Profile Data

Panduan untuk menangkap data profil asli dari TikTok, Instagram, atau Threads agar parser bisa diverifikasi terhadap data sungguhan.

> **Untuk siapa:** Siapa saja yang ingin membantu proyek dengan merekam satu payload asli dari platform sosial media favorit mereka.

> **Waktu:** ~5 menit

---

## Setup: Buka Developer Tools

1. **Buka browser** (Chrome, Firefox, Safari, Edge — semua punya DevTools)
2. **Tekan `F12`** (atau klik kanan → Inspect)
3. **Pergi ke tab `Network`**

Sekarang kamu siap untuk menangkap.

---

## Untuk TikTok: Tangkap `item_list` Response

1. Buka profil TikTok publik manapun: `https://www.tiktok.com/@username`
2. **Scroll down** di video grid sampai kamu lihat lebih banyak video loading
3. Di **Network tab**, cari request dengan nama mengandung `item_list`
   - Biasanya tampilannya seperti: `/api/post/item_list/` atau `/v1/feed/`
4. **Klik request itu**
5. Pergi ke tab **`Response`** (bukan Preview, tapi Response yang raw)
6. **Copy semuanya** (Ctrl+A / Cmd+A, then Ctrl+C / Cmd+C)
7. **Buka editor teks** (Notepad, VS Code, atau apa saja) dan paste: `Ctrl+V`
8. **Simpan sebagai** `tiktok-capture.json`

✅ **Selesai!** Kirim file `tiktok-capture.json` ini.

---

## Untuk Instagram: Tangkap GraphQL Query

1. Login ke Instagram
2. Buka profil publik manapun: `https://www.instagram.com/username/`
3. Tunggu halaman fully load
4. Di **Network tab**, scroll up (atau filter untuk `graphql`)
5. Cari request ke `/graphql/` yang berisi user/profile data
   - Response-nya panjang dan kompleks — itu normal
6. **Klik request itu → tab `Response`**
7. **Copy response JSON-nya** (bukan wrapper, tapi bagian `data` di dalamnya cukup)
8. **Paste ke editor teks**
9. **Simpan sebagai** `instagram-capture.json`

✅ **Selesai!** Kirim `instagram-capture.json`.

---

## Untuk Threads: Tangkap GraphQL Query

Sama persis dengan Instagram:

1. Login ke Threads
2. Buka profil publik: `https://www.threads.net/@username`
3. Di **Network tab**, cari `/graphql/` request
4. Tab **`Response`** → copy JSON
5. Paste ke editor teks
6. **Simpan sebagai** `threads-capture.json`

✅ **Selesai!** Kirim `threads-capture.json`.

---

## Keamanan: Apa yang Aman, Apa yang Tidak

**AMAN untuk dikirmkan — tidak ada private data:**
- Nama akun (@username)
- Jumlah followers/likes/comments
- Post content (video title, caption)
- Timestamps

**JANGAN kirim — ini private:**
- Cookies
- Tokens/auth headers
- Email address
- Personal messages / DM content

Catatan: File yang kamu ambil dari Network tab biasanya tidak punya auth token — itu request yang PUBLIC (semua orang bisa lihatnya). Jadi aman untuk kirim.

---

## Mengirim File Capture

Setelah dapat file `.json`-nya:

1. **Buka issue atau PR** di repository ini
2. **Lampirkan file** (upload via GitHub atau paste isinya di komentar)
3. **Tulis keterangan:**
   ```
   Platform: TikTok (atau Instagram / Threads)
   Public Account: @username (atau siapa saja yang public)
   Captured: [tanggal hari ini]
   ```

Tim development akan:
- Anonimkan username & auth token (kalau ada)
- Verifikasi field names cocok dengan parser
- Update fixture di repo dengan data asli
- Sebutkan nama kamu di commits sebagai credit

---

## Troubleshooting

**"Saya tidak lihat `item_list` atau `graphql` di Network tab"**
- Refresh halaman (F5) dulu, terus perhatiin Network tab dari awal
- Network tab punya max history; jika terlalu lama, hal-hal tua hilang — pastiin tab Network sudah active sebelum refresh
- TikTok: tunggu sampai video grid selesai load, baru scroll — banyak item_list requests akan muncul

**"Response-nya sangat panjang, copy-paste lambat"**
- Itu normal. Ada dua cara cepat:
  1. Klik kanan pada request → **Save response as…** (Chrome/Edge)
  2. Atau buka Network tab di Full Screen mode (F12 → klik maximize), lebih mudah select semua

**"File saya sudah dicapture, tapi saya tidak yakin apakah itu yang benar"**
- Buka file dengan editor teks, search untuk kata-kata yang kamu kenal (username, followers count, dll)
- Kalau ketemu, benar — file capture-nya valid

---

## FAQ

**Q: Apakah aman untuk account pribadi saya?**  
A: Ya, totally aman. Kamu hanya menangkap **public profile data** yang sudah terlihat di browser semua orang. Tidak ada akses ke private/DM content. Kalaupun ada username pribadi di capture, kami akan anonimkan sebelum masuk repo.

**Q: Berapa banyak capture yang dibutuhkan?**  
A: Satu per platform sudah cukup buat verifikasi. Kalau kamu mau lebih, ambil bebas — lebih banyak data = lebih percaya verifikasi.

**Q: Bisakah saya capture dari akun creator/influencer?**  
A: Ya, lebih baik malahan — creator punya posting pattern yang lebih jelas. Pastiin itu akun public (kamu bisa lihat profilnya tanpa follow).

**Q: Apakah ini akan digunakan untuk apa-apa selain testing?**  
A: Tidak. Data real ini hanya dipakai untuk unit tests, biar parser bisa dibilang benar-benar bekerja terhadap data asli. Tidak disimpan, tidak dijual, tidak dipakai lain.

---

Terima kasih sudah membantu! 🙏

Kalau ada pertanyaan, cek `FIXTURE_CAPTURE_GUIDE.md` untuk detail teknis lebih lanjut.

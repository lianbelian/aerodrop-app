# AeroDrop

Aplikasi kirim file dan teks antarperangkat dalam satu sesi QR. Tanpa database: sesi dan daftar perangkat hanya disimpan di memori server.

## Dipakai orang lain (tanpa npm)

Aplikasi ini **bukan situs statis**: `socket.io` butuh proses Node yang terus hidup. Karena itu GitHub Pages saja tidak bisa dipakai apa adanya. Cara paling mudah:

1. Push repo ini ke GitHub (remote sudah ada: `lianbelian/aerodrop-app`).
2. Buka [Render Dashboard](https://dashboard.render.com/) → **New** → **Blueprint** → hubungkan GitHub → pilih **hanya** repo `lianbelian/aerodrop-app`.
3. `render.yaml` terdeteksi otomatis: build `npm install`, start `node server.js`, plan **Free**, health check `/health`.
4. Klik **Apply**, tunggu deploy selesai, lalu bagikan URL `https://aerodrop.onrender.com` (atau URL yang muncul) ke orang lain.

Mereka cukup membuka URL dan memindai QR. Tidak perlu Node, npm, atau `npm start`.

Alternatif tanpa blueprint: **New → Web Service** → repo yang sama → plan **Free** → start command `node server.js`. Hindari Vercel/serverless untuk versi ini karena WebSocket butuh koneksi yang persisten.

## Jalankan lokal (opsional, untuk pengembangan)

```bash
npm install
npm start
```

Lalu buka `http://localhost:3000`.

## Catatan

- `PORT` diatur otomatis oleh host; lokal default `3000`.
- `GET /health` dipakai untuk health check hosting.
- Paket `render.yaml` dan `Procfile` sudah disiapkan, jadi tidak ada perintah khusus di dashboard selain memilih repo.
- Render Free: $0/bulan, 512 MB RAM, 750 jam instance/bulan, 5 GB bandwidth/bulan, WebSocket didukung. Service tidur setelah 15 menit tanpa trafik dan bangun lagi ~1 menit saat ada kunjungan. Cocok untuk demo/hobi, bukan produksi. Tanpa kartu kartenya pun bisa; kalau kuota terlampaui, service disuspend sampai bulan berikutnya.
- Batas buffer Socket.IO adalah 100 MB per pesan. File tidak disimpan permanen dan sesi hilang saat server restart.
- Siapa pun yang tahu kode sesi bisa masuk ke ruangan itu. Jangan dipakai untuk data sensitif tanpa autentikasi tambahan.

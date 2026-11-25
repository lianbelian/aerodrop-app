# AeroDrop

Kirim file dan teks antarperangkat dalam satu sesi QR. Real-time memakai WebSocket asli di Cloudflare Workers + Durable Objects, tanpa database permanen dan tanpa server yang perlu dinyalakan sendiri.

## Dipakai orang lain

Buka URL deploy, izinkan kamera, lalu bagikan QR atau ID sesi. Pemakai **tidak perlu** Node, npm, atau `npm start`.

URL produksi: **https://aerodrop-app.lianbelian.workers.dev**

## Deploy ke Cloudflare (gratis, tanpa kartu)

1. Pastikan repo ini sudah di-push ke `lianbelian/aerodrop-app`.
2. Di folder proyek: `npm install`.
3. Login Cloudflare: `npx wrangler login`.
4. Deploy: `npm run deploy`.
5. Wrangler akan menampilkan URL `*.workers.dev`. Bagikan URL itu.

Konfigurasi ada di `wrangler.jsonc`: static assets dari `public/`, endpoint WebSocket di `/ws`, dan satu Durable Object (`Hub`) untuk koordinasi sesi.

## Jalankan lokal

```bash
npm install
npm run dev
```

Lalu buka URL lokal yang ditampilkan Wrangler (biasanya `http://localhost:8787`).

## Batasan

- Workers Free: 100.000 request/hari, 10 ms CPU per request, tanpa kartu kredit.
- Tidak ada sleep/wake-up seperti host PaaS gratis; WebSocket langsung aktif.
- File dibatasi **85 MB per file**. File dikirim sebagai potongan biner WebSocket, bukan base64, agar tidak membengkak dan tetap melewati batas pesan Cloudflare. File tidak disimpan permanen; pesan hanya berlangsung saat sesi aktif.
- Siapa pun yang tahu ID sesi bisa masuk ruangan itu. Jangan dipakai untuk data sensitif tanpa autentikasi tambahan.
- Server Node lama (`server.js`, Socket.IO, `render.yaml`, `Procfile`) sudah dihapus karena Render mewajibkan kartu untuk verifikasi akun.

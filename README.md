# Yusuf Music

Pemutar musik pribadi berbasis HTML, CSS, dan JavaScript. Aplikasi ini dibuat sebagai PWA dan dapat di-hosting secara gratis dengan GitHub Pages.

## Fitur

- Menambahkan beberapa file audio dari perangkat.
- Menyimpan file audio dan informasi lagu di IndexedDB browser.
- Play, pause, next, previous, seek, dan pengaturan volume.
- Shuffle dan repeat (mati / semua lagu / satu lagu).
- Favorit dan playlist.
- Kontrol media melalui Media Session API pada browser/perangkat yang mendukung.
- App shell dapat dibuka offline setelah pernah dibuka online dan service worker berhasil terpasang.
- Dapat dipasang ke layar utama sebagai PWA pada browser yang mendukung.

## Catatan penting

1. Lagu tersimpan di browser dan perangkat yang mengunggahnya. Lagu tidak otomatis tersinkronisasi ke HP/laptop lain.
2. GitHub Pages hanya meng-host file aplikasi. Jangan taruh file MP3 pribadi atau lagu berhak cipta di repository publik.
3. Background playback bergantung pada browser dan sistem operasi. Uji dengan memulai lagu terlebih dahulu, lalu kunci layar. Ini tidak dijamin sama pada semua perangkat, terutama iOS.
4. HP yang benar-benar dimatikan (power off) tidak dapat memutar musik.
5. IndexedDB memakai penyimpanan browser. Simpan juga file musik aslinya di tempat aman; menghapus data situs/browser dapat menghapus koleksi lokal aplikasi.

## Menjalankan di VS Code (Windows)

### Cara A — Live Server

1. Ekstrak folder `yusuf-music`.
2. Buka VS Code.
3. Pilih **File > Open Folder...** lalu pilih folder `yusuf-music`.
4. Buka Extensions (`Ctrl + Shift + X`), cari **Live Server** oleh Ritwick Dey, lalu install.
5. Klik kanan `index.html` dan pilih **Open with Live Server**.
6. Browser akan membuka aplikasi melalui alamat localhost.

### Cara B — Python

Jika Python sudah terpasang, buka Terminal di VS Code, pastikan terminal berada di folder proyek, lalu jalankan:

```powershell
py -m http.server 5500
```

Buka `http://localhost:5500` di browser.

> Jangan membuka `index.html` dengan double-click (`file://`). IndexedDB, service worker, dan fitur PWA perlu localhost atau HTTPS.

## Hosting di GitHub Pages

1. Buat repository GitHub baru, misalnya `yusuf-music`.
2. Pilih **Public** atau **Private**. GitHub Pages pada paket gratis umumnya digunakan dengan repository public untuk project site; periksa pengaturan paket akun GitHub sebelum memilih private.
3. Upload seluruh isi folder proyek ke root repository. Pastikan `index.html` berada langsung di root, bukan di dalam folder bersarang.
4. Jangan upload koleksi lagu pribadi ke repository.
5. Buka repository **Settings > Pages**.
6. Di bagian **Build and deployment**, pilih **Deploy from a branch**.
7. Pilih branch `main` dan folder `/(root)`, lalu klik **Save**.
8. Tunggu proses deployment selesai. URL biasanya berbentuk `https://USERNAME.github.io/yusuf-music/`.
9. Buka URL tersebut di Chrome Android. Tambahkan lagu dari perangkat, lalu pilih **Add to Home screen / Install app** jika tersedia.

## Menguji pemutaran saat layar terkunci

1. Buka aplikasi melalui URL HTTPS GitHub Pages.
2. Tambahkan file musik dari HP.
3. Putar satu lagu dan pastikan audionya sudah berjalan.
4. Kunci layar, lalu tunggu beberapa menit.
5. Coba kontrol media dari lock screen / notification shade.

Jika audio berhenti, periksa pengaturan battery optimization browser, izin aktivitas latar belakang, dan pengaturan hemat daya perangkat. Browser tetap dapat membatasi pemutaran latar belakang.

## Struktur folder

```text
yusuf-music/
├── index.html
├── styles.css
├── app.js
├── manifest.webmanifest
├── sw.js
├── README.md
└── assets/
    ├── icon.svg
    ├── icon-192.png
    └── icon-512.png
```

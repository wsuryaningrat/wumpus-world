# Wumpus World Tel-U

Game Wumpus World untuk mata kuliah Kecerdasan Buatan (materi KBS / reasoning), dimainkan di laptop maupun HP. Skor setiap game dikirim ke Google Sheet lewat Google Apps Script, dan dosen bisa memantau livescore dari dashboard admin.

Developed by **WHS** (SoC – Telkom University)

## Aturan

- Dunia N×N (default 5×5, bisa 4×4 sampai 8×8), mulai di (1,1).
- Percept: Stench (Wumpus di sebelah), Breeze (lubang di sebelah), Glitter (emas di kotak ini), Bump (menabrak dinding), Scream (Wumpus terkena panah).
- Anak panah tidak dibawa dari awal: harus ditemukan di dalam gua lalu diambil.
- Setiap aksi −10, keluar membawa emas +1000, terbunuh (lubang / Wumpus hidup) −1000.
- Kuota 5 game per pemain (per NIM, atau per nama untuk guest), dicek di server.

## Isi repo

| File | Fungsi |
| --- | --- |
| `index.html` | Game (satu file, siap di-host di GitHub Pages) |
| `apps-script/Code.gs` | Backend Google Apps Script yang menulis ke Google Sheet |

## Pemasangan (sekali saja, ±10 menit)

### 1. Siapkan Google Sheet + Apps Script

1. Buka [sheets.new](https://sheets.new) dengan akun Gmail dosen. Beri nama, misalnya **Wumpus World – Skor**.
2. Menu **Extensions → Apps Script**. Hapus isi `Code.gs` bawaan, lalu tempel seluruh isi `apps-script/Code.gs` dari repo ini. Simpan.
3. Pilih fungsi **`setup`** di toolbar, lalu klik **Run**. Izinkan akses saat diminta (Review permissions → pilih akun → Advanced → Go to project → Allow).
4. Buka **Execution log**: catat baris `ADMIN_KEY = ...`. Ini kunci untuk masuk dashboard admin di game. Kunci juga bisa dilihat atau diganti di **Project Settings → Script Properties**.
5. Klik **Deploy → New deployment** → ikon roda gigi → **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Klik **Deploy**, lalu salin **Web app URL** (berakhiran `/exec`).

Setelah `setup` dijalankan, Sheet berisi tiga tab:

- **Games**: satu baris per game (mulai, ID, nama, NIM, mode, ukuran, status, skor, aksi, selesai).
- **Rekap**: rekap otomatis per mahasiswa (jumlah game, skor terbaik, total).
- **Config**: peta dosen yang diatur dari game.

### 2. Sambungkan game ke Apps Script

Edit `index.html`, cari dua baris berikut di bagian awal script, lalu isi:

```js
const API_URL="https://script.google.com/macros/s/XXXX/exec";   // Web app URL dari langkah 1.6
const SHEET_URL="https://docs.google.com/spreadsheets/d/XXXX";   // opsional, untuk tombol di dashboard admin
```

### 3. Aktifkan GitHub Pages

Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch: **main**, folder **/ (root)** → Save.
Setelah 1–2 menit, game bisa dibuka di `https://<username>.github.io/wumpus-world/`.

## Pemakaian

- **Mahasiswa**: buka link, pilih nama dari daftar presensi (atau Guest), pilih peta, lalu main. Tidak perlu login.
- **Dosen**: klik **Admin** di bagian bawah halaman, lalu masukkan `ADMIN_KEY`. Setelah masuk, dosen bisa:
  - melihat livescore (diperbarui setiap 4 detik);
  - mereset kuota mahasiswa;
  - menyalin rekap CSV;
  - membuat custom map dan menjadikannya **Peta dosen**.
- Semua data permanen ada di Google Sheet, yang hanya bisa dibuka akun Gmail dosen.

Kontrol: tombol panah / WASD untuk bergerak, `G` ambil, `F` lalu arah untuk menembak (atau `Shift`+panah), `C` keluar, `M` tandai, `N` suara. Di HP tersedia d-pad di layar.

## Catatan

- Jika `Code.gs` diubah, buat versi baru lewat **Deploy → Manage deployments → Edit → Version: New version** agar URL tetap sama.
- Pemain tidak login, jadi siapa pun bisa memilih nama orang lain. Kuota tetap terkunci per NIM di server.
- Validasi skor di server (skor harus sama dengan −10 × aksi + bonus) mencegah perubahan sembarangan, tapi bukan pengaman penuh terhadap pemain yang memanipulasi kode halaman.
- Kapasitas: livescore memakai cache Apps Script, bukan Sheet. Setiap pemain mengirim status paling sering setiap 4 detik, sehingga 40 pemain bersamaan masih jauh di bawah batas eksekusi Apps Script.

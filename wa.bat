@echo off
:: 1. Pindah ke lokasi folder (PENTING agar tidak error module not found)
cd /d D:\nginx\html\whatsapp-service

:: 2. Jalankan PM2
:: (Ganti 'index.js' dengan nama file utama Anda, misal: app.js atau server.js)
pm2 start ecosystem.config.js
:: 3. Tahan layar sebentar untuk melihat status sukses/gagal
pause
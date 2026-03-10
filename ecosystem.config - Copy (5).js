module.exports = {
  apps : [
    {
      // 1. LARAVEL QUEUE WORKER
      name: "laravel-queue",
      script: "artisan", 
      interpreter: "php", // Menggunakan PHP untuk menjalankan script
      args: "queue:work --tries=3 --timeout=90", // Argumen perintah
      // PENTING: Ganti path di bawah ini ke folder proyek Laravel Anda
      cwd: "D:/nginx/html/listrik", 
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G"
    },
    {
      // 2. WHATSAPP BOT SERVICE
      name: "wa-bot",
      script: "index.js",
      // PENTING: Ganti path di bawah ini ke folder whatsapp-service Anda
      cwd: "D:/nginx/html/whatsapp-service", 
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
      }
    }
  ]
};
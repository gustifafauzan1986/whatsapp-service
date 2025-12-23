module.exports = {
  apps : [
    // 1. LARAVEL SCHEDULER (Menjalankan Task Scheduling Otomatis)
    // Ini menggantikan Cron Job di Windows. Menjalankan 'php artisan schedule:work'
    {
      name: "laravel-scheduler",
      script: "artisan",
      interpreter: "php",
      args: "schedule:work",
      cwd: "D:/nginx/html/listrik", // Path project Laravel
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G"
    },

    // 2. LARAVEL QUEUE WORKER (Memproses Antrian WA dll)
    {
      name: "laravel-queue",
      script: "artisan", 
      interpreter: "php", 
      args: "queue:work --tries=3 --timeout=90", 
      cwd: "D:/nginx/html/listrik", // Path project Laravel
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G"
    },

    // 3. WHATSAPP BOT SERVICE (Node.js)
    {
      name: "wa-bot",
      script: "index.js",
      cwd: "D:/nginx/html/whatsapp-service", // Path bot WA
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
      }
    }
  ]
};
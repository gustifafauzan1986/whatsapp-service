module.exports = {
  apps : [
    {
      // 1. LARAVEL SCHEDULER (NODE JS WRAPPER - TOTAL SILENT)
      // Menggunakan script 'scheduler.js' sebagai perantara untuk menjalankan 
      // 'php artisan schedule:run' secara background tanpa popup window.
      name: "laravel-scheduler",
      script: "scheduler.js", 
      interpreter: "node", 
      cwd: "D:/nginx/html/listrik", 
      instances: 1,
      
      // Matikan cron_restart PM2 karena scheduler.js sudah punya timer internal (setInterval)
      autorestart: true,      
      watch: false,
      max_memory_restart: "1G"
    },

    {
      // 2. LARAVEL QUEUE WORKER
      // Menjalankan queue:work menggunakan php-win agar window tidak muncul.
      name: "laravel-queue",
      script: "artisan", 
      interpreter: "php", // Menggunakan PHP untuk menjalankan script
      args: "queue:work --tries=3 --timeout=90", // Argumen perintah
      cwd: "D:/nginx/html/listrik",
      instances: 1,
      autorestart: true, // Queue harus selalu hidup (restart jika crash)
      watch: false,
      max_memory_restart: "1G"
    },

    {
      // 3. WHATSAPP BOT SERVICE (Node.js Baileys)
      name: "wa-bot",
      script: "index.js",
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
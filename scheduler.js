const { exec } = require('child_process');

console.log("------------------------------------------------");
console.log("  Laravel Scheduler Daemon (Node.js Wrapper)");
console.log("  Mode: Silent / Background");
console.log("------------------------------------------------");

// Fungsi untuk menjalankan artisan schedule:run
const runSchedule = () => {
    // Gunakan php-win agar tidak muncul window
    // windowsHide: true adalah kunci agar tidak ada popup
    exec('php-win artisan schedule:run --quiet', { 
        windowsHide: true 
    }, (error, stdout, stderr) => {
        if (error) {
            // Log error tapi jangan matikan proses
            console.error(`[ERROR] Exec error: ${error.message}`);
            return;
        }
        if (stderr) {
            // console.error(`[STDERR] ${stderr}`); // Uncomment jika butuh debug
        }
        // console.log(`[OUTPUT] ${stdout}`); // Uncomment jika butuh debug
    });
};

// 1. Jalankan segera saat start
runSchedule();

// 2. Ulangi setiap 60 detik (1 menit)
setInterval(() => {
    runSchedule();
}, 60 * 1000);

// Menjaga proses tetap hidup agar PM2 tidak restart-restart
setInterval(() => {}, 1 << 30);
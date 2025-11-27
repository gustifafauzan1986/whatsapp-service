const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const express = require('express');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json()); // Middleware untuk parsing JSON body dari Laravel

// Variabel global untuk menyimpan instance socket WA
let sock;

// Fungsi utama untuk menghubungkan ke WhatsApp
async function connectToWhatsApp() {
    // 1. Setup Auth: Menyimpan sesi login di folder 'auth_info_baileys'
    // Ini penting agar tidak perlu scan QR ulang setiap kali server restart
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    // Fetch versi terbaru WA Web agar tidak dianggap bot usang
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Menggunakan WA v${version.join('.')}, isLatest: ${isLatest}`);

    // 2. Inisialisasi Socket
    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, // Kita handle manual agar tampilan lebih rapi
        logger: pino({ level: 'silent' }), // Log level silent agar terminal bersih dari debug info
        browser: Browsers.macOS('Chrome'), // Identitas browser (bisa diganti Ubuntu/Windows)
        syncFullHistory: false, // Matikan sync history chat lama agar startup cepat
        generateHighQualityLinkPreview: true,
    });

    // 3. Event Listener: Update Koneksi (QR, Connecting, Open, Close)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Jika butuh Scan QR
        if (qr) {
            console.log('\n================================================');
            console.log('SILAKAN SCAN QR CODE INI DI WHATSAPP (LINKED DEVICES):');
            console.log('================================================');
            qrcode.generate(qr, { small: true });
        }

        // Jika Koneksi Terputus
        if (connection === 'close') {
            // Deteksi alasan putus koneksi
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            
            console.log('Koneksi terputus. Alasan:', lastDisconnect?.error?.message || 'Unknown');
            
            // Reconnect otomatis jika bukan karena Logout manual dari HP
            if (shouldReconnect) {
                console.log('Mencoba menghubungkan kembali dalam 3 detik...');
                setTimeout(connectToWhatsApp, 3000);
            } else {
                console.log('Sesi Anda telah logout. Silakan hapus folder "auth_info_baileys" dan scan ulang.');
                // Hapus kredensial jika logout (opsional)
                // fs.rmdirSync('auth_info_baileys', { recursive: true });
            }
        } else if (connection === 'open') {
            console.log('\n================================================');
            console.log('✅ WHATSAPP TERHUBUNG! SIAP MENERIMA PESAN DARI LARAVEL.');
            console.log('================================================');
        }
    });

    // 4. Event Listener: Simpan Kredensial
    // Penting: Simpan setiap perubahan sesi (kunci enkripsi baru) agar login awet
    sock.ev.on('creds.update', saveCreds);
}

// Jalankan fungsi koneksi
connectToWhatsApp();

// ------------------------------------------------------------------
// API ENDPOINT (JEMBATAN ANTARA LARAVEL DAN WHATSAPP)
// ------------------------------------------------------------------
app.post('/send-message', async (req, res) => {
    try {
        const { number, message } = req.body;

        // Validasi Input
        if (!number || !message) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'Parameter "number" dan "message" wajib diisi.' 
            });
        }

        // Format Nomor HP (Pembersihan karakter)
        // Hapus semua karakter selain angka
        let formattedNumber = number.toString().replace(/\D/g, ''); 

        // Ubah awalan 08... atau 0... menjadi 62...
        if (formattedNumber.startsWith('0')) {
            formattedNumber = '62' + formattedNumber.slice(1);
        }

        // Tambahkan domain WhatsApp (@s.whatsapp.net) jika belum ada
        if (!formattedNumber.endsWith('@s.whatsapp.net')) {
            formattedNumber += '@s.whatsapp.net';
        }

        // Cek Kesiapan Socket
        if (!sock) {
            return res.status(500).json({ 
                status: 'error', 
                message: 'Layanan WA belum siap/terhubung.' 
            });
        }

        // --- PROSES KIRIM PESAN ---
        // Menggunakan fungsi sendMessage bawaan Baileys
        const sentMsg = await sock.sendMessage(formattedNumber, { text: message });
        
        console.log(`[LOG] Pesan terkirim ke: ${formattedNumber.split('@')[0]}`);

        return res.json({ 
            status: 'success', 
            message: 'Pesan berhasil dikirim ke antrian WhatsApp.',
            data: sentMsg
        });

    } catch (error) {
        console.error('[ERROR] Gagal kirim pesan:', error);
        return res.status(500).json({ 
            status: 'error', 
            message: error.message || 'Internal Server Error' 
        });
    }
});

// Jalankan Server Express di Port 3000
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Server API WhatsApp berjalan di port ${PORT}`);
    console.log(`🔗 Endpoint Laravel: http://localhost:${PORT}/send-message\n`);
});
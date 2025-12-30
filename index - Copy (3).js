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
const cors = require('cors'); // Added cors back as it was in the original but missing in your snippet, good for Laravel interaction
const qrcode = require('qrcode-terminal');

const app = express();
const port = 3000;

app.use(cors()); // Allow access from Laravel
app.use(express.json()); // Middleware parsing JSON

let sock;
let currentQR = null; // Variable to store latest QR for API endpoint
let statusWA = 'disconnected'; // disconnected, connecting, connected

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, // We handle printing manually with qrcode-terminal
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Chrome'),
        syncFullHistory: false
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQR = qr;
            statusWA = 'scan_needed';
            console.log('SCAN QR CODE DI BAWAH INI:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus. Reconnecting...', shouldReconnect);
            statusWA = 'disconnected';
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ WA SERVICE SIAP! (Support Text & Media)');
            currentQR = null;
            statusWA = 'connected';
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

connectToWhatsApp();

// --- API ENDPOINTS UNTUK LARAVEL ---

// 1. Endpoint Ambil QR (Tetap dipertahankan untuk fitur Scan di Web Laravel)
app.get('/qr', (req, res) => {
    res.json({
        status: statusWA,
        qr: currentQR
    });
});

// 2. Endpoint Status
app.get('/status', (req, res) => {
    res.json({
        status: statusWA
    });
});

// 3. Endpoint Kirim Pesan (Updated with Media Support)
app.post('/send-message', async (req, res) => {
    try {
        // Parameter dari Laravel Job
        const { number, message, type = 'text', media_url, file_name, mime_type } = req.body;

        // Validasi
        if (!number) return res.status(400).json({ status: 'error', message: 'Nomor wajib diisi' });
        if (!sock) return res.status(500).json({ status: 'error', message: 'WA belum siap' });

        // Format Nomor HP (08xx -> 628xx)
        let formattedNumber = number.toString().replace(/\D/g, '');
        if (formattedNumber.startsWith('0')) formattedNumber = '62' + formattedNumber.slice(1);
        if (!formattedNumber.endsWith('@s.whatsapp.net')) formattedNumber += '@s.whatsapp.net';

        // Susun Konten Pesan Berdasarkan Tipe
        let content = {};

        if (type === 'image') {
            // Kirim Gambar
            content = { 
                image: { url: media_url }, // Baileys akan download otomatis dari URL ini
                caption: message 
            };
        } else if (type === 'document') {
            // Kirim Dokumen
            content = { 
                document: { url: media_url }, 
                caption: message,
                mimetype: mime_type || 'application/pdf',
                fileName: file_name || 'document.pdf'
            };
        } else {
            // Kirim Teks Biasa
            content = { text: message };
        }

        // Eksekusi Kirim
        await sock.sendMessage(formattedNumber, content);
        
        console.log(`[${type.toUpperCase()}] Terkirim ke ${formattedNumber.split('@')[0]}`);
        return res.json({ status: 'success' });

    } catch (error) {
        console.error('Gagal kirim:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
});

app.listen(port, () => {
    console.log(`🚀 Server berjalan di port ${port}`);
});
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
app.use(express.json()); // Middleware parsing JSON

let sock;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Chrome'),
        syncFullHistory: false
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('SCAN QR CODE DI BAWAH INI:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus. Reconnecting...', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ WA SERVICE SIAP! (Support Text & Media)');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

connectToWhatsApp();

// --- API ENDPOINT UTAMA ---
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

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server berjalan di port ${PORT}`);
});
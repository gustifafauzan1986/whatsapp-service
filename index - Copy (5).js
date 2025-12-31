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
const cors = require('cors');
const fs = require('fs');
const axios = require('axios'); 

const app = express();
const port = 3000;

// URL Webhook Laravel (Sesuaikan dengan domain/IP server Anda)
const LARAVEL_WEBHOOK_URL = 'http://127.0.0.1/api/whatsapp/webhook';

app.use(cors());
app.use(express.json());

// --- PENYIMPANAN SESI (MULTI-DEVICE) ---
// Map menyimpan objek: { sock: Socket, qr: String, status: String, phone: String }
const sessions = new Map();

/**
 * Fungsi untuk memulai sesi WhatsApp spesifik berdasarkan ID
 */
async function startSession(sessionId) {
    // Hindari duplikasi start jika sesi sudah ada dan terhubung
    if (sessions.has(sessionId) && sessions.get(sessionId).status === 'connected') {
        console.log(`Sesi ${sessionId} sudah berjalan.`);
        return;
    }

    const authFolder = `auth_info_${sessionId}`;
    
    // Pastikan folder ada atau akan dibuat oleh useMultiFileAuthState
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true, 
        logger: pino({ level: 'silent' }), // Silent agar terminal bersih
        browser: Browsers.macOS('Chrome'),
        syncFullHistory: false
    });

    // Simpan state awal ke memory Map
    sessions.set(sessionId, { sock, qr: null, status: 'connecting', phone: null });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Ambil data sesi dari Map
        const sessionData = sessions.get(sessionId);
        if (!sessionData) return; // Safety check jika sesi sudah dihapus manual

        if (qr) {
            sessionData.qr = qr;
            sessionData.status = 'scan_needed';
            console.log(`[${sessionId}] QR Code Generated. Menunggu Scan...`);
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`[${sessionId}] Koneksi terputus. Reconnect: ${shouldReconnect}`);
            
            sessionData.status = 'disconnected';
            
            if (shouldReconnect) {
                startSession(sessionId); // Reconnect otomatis
            } else {
                console.log(`[${sessionId}] Logged Out. Menghapus sesi.`);
                // Hapus file session jika logout dari HP
                try {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                } catch(e) {
                    console.error(`Gagal hapus folder ${authFolder}:`, e);
                }
                sessions.delete(sessionId);
            }
        } else if (connection === 'open') {
            console.log(`[${sessionId}] ✅ TERHUBUNG!`);
            sessionData.qr = null;
            sessionData.status = 'connected';
            
            // Ambil nomor HP bot yang terhubung
            const user = sock.user;
            sessionData.phone = user.id ? user.id.split(':')[0] : 'Unknown';
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- LISTENER PESAN MASUK (WEBHOOK KE LARAVEL) ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            // Hanya proses pesan dari orang lain (bukan dari bot sendiri)
            if (!msg.key.fromMe && msg.message) {
                console.log(`[${sessionId}] Pesan masuk dari: ${msg.key.remoteJid}`);

                // Ekstrak isi pesan (Text biasa, Extended Text, atau List Response)
                let textMessage = msg.message.conversation 
                    || msg.message.extendedTextMessage?.text 
                    || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
                    || msg.message.buttonsResponseMessage?.selectedButtonId
                    || '';

                if (textMessage) {
                    try {
                        // Kirim data ke Laravel
                        await axios.post(LARAVEL_WEBHOOK_URL, {
                            session_id: sessionId,
                            from: msg.key.remoteJid,
                            name: msg.pushName || 'Unknown',
                            message: textMessage
                        });
                        console.log(`[${sessionId}] Webhook sent to Laravel`);
                    } catch (error) {
                        // Jangan crash server jika Laravel mati/error
                        console.error(`[${sessionId}] Gagal kirim Webhook:`, error.message);
                    }
                }
            }
        }
    });
}

// --- INIT SESSIONS (Restore session saat restart) ---
// Membaca folder auth yang ada di direktori saat ini
// Fix: Mencari folder yang diawali 'auth_info_' saja, bukan 'auth_info_gateway_'
// agar sesuai dengan folder yang dibuat di fungsi startSession.
if (fs.existsSync('.')) {
    fs.readdirSync('.').forEach(file => {
        if (file.startsWith('auth_info_') && !file.endsWith('.json')) {
            const sessionId = file.replace('auth_info_', '');
            // Validasi sederhana agar tidak membaca file sampah
            if(sessionId && sessionId.length > 0) {
                console.log(`Memuat sesi tersimpan: ${sessionId}`);
                startSession(sessionId);
            }
        }
    });
}

// --- API ENDPOINTS ---

// 1. Start Session Baru (Dipanggil saat tombol "Tambah Gateway" diklik di Laravel)
app.post('/session/start', (req, res) => {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ message: 'session_id required' });
    
    startSession(session_id);
    res.json({ status: true, message: `Sesi ${session_id} diinisialisasi` });
});

// 2. Logout / Hapus Sesi
app.post('/session/logout', async (req, res) => {
    const { session_id } = req.body;
    const session = sessions.get(session_id);
    const authFolder = `auth_info_${session_id}`;
    
    if (session && session.sock) {
        try {
            await session.sock.logout();
        } catch(e) {} // Abaikan error logout jika koneksi sudah putus
        
        sessions.delete(session_id);
    }

    // Hapus folder sesi fisik
    if (fs.existsSync(authFolder)) {
        try {
            fs.rmSync(authFolder, { recursive: true, force: true });
            res.json({ status: true, message: `Sesi ${session_id} dihapus & logout` });
        } catch (e) {
            res.status(500).json({ status: false, message: 'Gagal menghapus folder sesi' });
        }
    } else {
        // Jika hanya ada di memori (jarang terjadi) atau folder sudah hilang
        if (session) {
            res.json({ status: true, message: `Sesi ${session_id} dihapus dari memori` });
        } else {
            res.status(404).json({ message: 'Sesi tidak ditemukan' });
        }
    }
});

// 3. Cek Status Specific Session (Untuk update badge status di Laravel)
app.get('/session/status/:id', (req, res) => {
    const sessionId = req.params.id;
    const session = sessions.get(sessionId);

    if (!session) {
        return res.json({ status: 'not_found', qr: null });
    }

    res.json({
        status: session.status,
        qr: session.qr,
        phone: session.phone
    });
});

// 4. List Semua Sesi (Untuk sinkronisasi Dashboard Laravel)
app.get('/sessions', (req, res) => {
    const list = [];
    sessions.forEach((val, key) => {
        list.push({ 
            session_id: key, 
            status: val.status, 
            phone: val.phone 
        });
    });
    res.json(list);
});

// 5. Kirim Pesan (Multi-Gateway Support & Load Balancing)
app.post('/send-message', async (req, res) => {
    try {
        // FIX: Menambahkan destrukturisasi variabel footer, title, buttonText, sections
        const { 
            number, 
            message, 
            type = 'text', 
            media_url, 
            session_id,
            footer,
            title,
            buttonText,
            sections 
        } = req.body;

        let selectedSession;

        // A. Pilih berdasarkan session_id jika diminta spesifik
        if (session_id && sessions.has(session_id)) {
            selectedSession = sessions.get(session_id);
            if (selectedSession.status !== 'connected') {
                return res.status(500).json({ message: `Gateway ${session_id} tidak terhubung` });
            }
        } 
        // B. Load Balancing: Pilih gateway yang connected secara acak
        else {
            const connectedSessions = Array.from(sessions.values()).filter(s => s.status === 'connected');
            if (connectedSessions.length === 0) {
                return res.status(500).json({ message: 'Tidak ada gateway WA yang terhubung!' });
            }
            // Pilih acak (Round Robin sederhana)
            selectedSession = connectedSessions[Math.floor(Math.random() * connectedSessions.length)];
        }

        const sock = selectedSession.sock;

        // Format Nomor HP
        let formattedNumber = number.toString().replace(/\D/g, '');
        if (formattedNumber.startsWith('0')) formattedNumber = '62' + formattedNumber.slice(1);
        if (!formattedNumber.endsWith('@s.whatsapp.net')) formattedNumber += '@s.whatsapp.net';

        // Konten Pesan (Text atau Media)
        let content = {};
        if (type === 'image') {
            content = { image: { url: media_url }, caption: message };
        } else if (type === 'document') {
            content = { 
                document: { url: media_url }, 
                caption: message, 
                mimetype: 'application/pdf', 
                fileName: 'file.pdf' 
            };
        } else if (type === 'list') {
            // FIX: Variabel sekarang sudah didefinisikan dari req.body
            content = {
                text: message,
                footer: footer || 'Sistem Sekolah',
                title: title || 'Menu Pilihan',
                buttonText: buttonText || 'Klik disini',
                sections: sections || [] // Array [{title: '..', rows: [...]}]
            };
        } else {
            content = { text: message };
        }

        // Eksekusi Kirim
        await sock.sendMessage(formattedNumber, content);
        
        console.log(`[Sent via ${selectedSession.phone}] -> ${formattedNumber.split('@')[0]}`);
        return res.json({ status: 'success', sender: selectedSession.phone });

    } catch (error) {
        console.error('Gagal kirim:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
});

app.listen(port, () => {
    console.log(`🚀 Multi-Device WA Server running on port ${port}`);
});
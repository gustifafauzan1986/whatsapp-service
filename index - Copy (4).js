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
const axios = require('axios'); // Optional: If you implement webhook sending back to Laravel

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// --- PENYIMPANAN SESI (MULTI-DEVICE) ---
// Format: { 'session_1': { sock: ..., qr: ..., status: ... } }
const sessions = new Map();

/**
 * Fungsi untuk memulai sesi WhatsApp spesifik berdasarkan ID
 * @param {string} sessionId - ID unik untuk setiap nomor (misal: 'gateway_1', 'gateway_2')
 */
async function startSession(sessionId) {
    // Hindari duplikasi start jika sesi sudah ada dan terhubung
    if (sessions.has(sessionId) && sessions.get(sessionId).status === 'connected') {
        console.log(`Sesi ${sessionId} sudah berjalan.`);
        return;
    }

    const authFolder = `auth_info_${sessionId}`;
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true, 
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Chrome'),
        syncFullHistory: false
    });

    // Simpan state awal ke memory Map
    sessions.set(sessionId, { sock, qr: null, status: 'connecting', phone: null });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        const sessionData = sessions.get(sessionId);

        if (!sessionData) return; // Safety check

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
                try {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                } catch(e) {}
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

    // --- LISTENER PESAN MASUK (OPSIONAL: WEBHOOK KE LARAVEL) ---
    // Jika orang tua membalas pesan, kita bisa kirim ke Laravel
    // sock.ev.on('messages.upsert', async ({ messages }) => { ... });
}

// --- INIT SESSIONS (Restore session saat restart) ---
if (!fs.existsSync('auth_info_baileys')) { 
    fs.readdirSync('.').forEach(file => {
        if (file.startsWith('auth_info_gateway_')) {
            const sessionId = file.replace('auth_info_', '');
            console.log(`Memuat sesi tersimpan: ${sessionId}`);
            startSession(sessionId);
        }
    });
}

// --- API ENDPOINTS ---

// 1. Start Session Baru
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
    
    if (session && session.sock) {
        try {
            await session.sock.logout();
        } catch(e) {} 
        
        sessions.delete(session_id);
        const authFolder = `auth_info_${session_id}`;
        if (fs.existsSync(authFolder)) {
            fs.rmSync(authFolder, { recursive: true, force: true });
        }
        res.json({ status: true, message: `Sesi ${session_id} dihapus` });
    } else {
        const authFolder = `auth_info_${session_id}`;
        if (fs.existsSync(authFolder)) {
            fs.rmSync(authFolder, { recursive: true, force: true });
            res.json({ status: true, message: `Sesi ${session_id} dihapus (Cleanup)` });
        } else {
            res.status(404).json({ message: 'Sesi tidak ditemukan' });
        }
    }
});

// 3. Cek Status Specific Session
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

// 4. List Semua Sesi
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

// 5. Kirim Pesan (Multi-Gateway Support & List Message Support)
app.post('/send-message', async (req, res) => {
    try {
        const { 
            number, 
            message, 
            type = 'text', 
            media_url, 
            session_id, 
            // Parameter tambahan untuk List Message
            sections, 
            title, 
            footer, 
            buttonText 
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
            selectedSession = connectedSessions[Math.floor(Math.random() * connectedSessions.length)];
        }

        const sock = selectedSession.sock;

        // Format Nomor HP
        let formattedNumber = number.toString().replace(/\D/g, '');
        if (formattedNumber.startsWith('0')) formattedNumber = '62' + formattedNumber.slice(1);
        if (!formattedNumber.endsWith('@s.whatsapp.net')) formattedNumber += '@s.whatsapp.net';

        // Konten Pesan
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
            // FITUR BARU: KIRIM LIST MESSAGE (MENU PILIHAN)
            // sections contoh: [{ title: 'Menu', rows: [{title: 'Opsi 1', rowId: '1'}, {title: 'Opsi 2', rowId: '2'}] }]
            content = {
                text: message,
                footer: footer || 'Sistem Sekolah',
                title: title || 'Pilih Menu',
                buttonText: buttonText || 'Klik disini',
                sections: sections
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
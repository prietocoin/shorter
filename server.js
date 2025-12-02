const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// Configuración de directorios y DB
const DATA_DIR = fs.existsSync('/app/data') ? '/app/data' : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'database.db');

const appUrl = process.env.PUBLIC_URL || null;

app.use(bodyParser.json());
const db = new sqlite3.Database(DB_PATH);

db.run(`CREATE TABLE IF NOT EXISTS links (hash_corto TEXT PRIMARY KEY, hash_original TEXT, link_drive TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

// Función segura de conversión
function hexToBase62(hexStr) {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    // Solo agregamos 0x si estamos seguros de que lo que sigue es Hex puro
    try {
        let num = BigInt('0x' + hexStr); 
        while (num > 0n) {
            let remainder = num % 62n;
            result = chars[Number(remainder)] + result;
            num = num / 62n;
        }
    } catch (e) {
        console.error("Error matemático ignorado, usando fallback.");
        return null; 
    }
    return result || '0';
}

app.post('/procesar', (req, res) => {
    let { linkDrive, hashOriginal } = req.body;
    if (!linkDrive || !hashOriginal) return res.status(400).json({ ok: false, error: 'Faltan datos' });

    // --- CORRECCIÓN CRÍTICA ---
    // Si el hash tiene letras que NO son a-f (como 'm', 'z', 'H'), es un ID de Drive.
    // Lo convertimos a SHA256 para que sea un Hex válido.
    if (!/^[0-9a-fA-F]+$/.test(hashOriginal)) {
        console.log("Detectado ID de Drive, convirtiendo a Hash seguro...");
        hashOriginal = crypto.createHash('sha256').update(hashOriginal).digest('hex');
    }

    const hashBase62 = hexToBase62(hashOriginal);
    // Si falló la conversión, usamos una parte del hash hexadecimal directamente
    const hashMinimo = (hashBase62 || hashOriginal).substring(0, 7);

    db.run(`INSERT OR REPLACE INTO links (hash_corto, hash_original, link_drive) VALUES (?, ?, ?)`, 
    [hashMinimo, hashOriginal, linkDrive], function(err) {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        
        let finalUrl;
        if (appUrl) {
            finalUrl = `${appUrl.replace(/\/$/, "")}/i/${hashMinimo}`;
        } else {
            finalUrl = `${req.protocol}://${req.get('host')}/i/${hashMinimo}`;
        }

        console.log(`Link generado: ${finalUrl}`);
        res.json({ ok: true, hash_minimo: hashMinimo, url_corta: finalUrl });
    });
});

app.get('/i/:id', (req, res) => {
    db.get("SELECT link_drive FROM links WHERE hash_corto = ?", [req.params.id], (err, row) => {
        if (row) res.redirect(row.link_drive);
        else res.status(404).send('Link no encontrado');
    });
});

app.get('/', (req, res) => res.send('Microservicio Activo 🚀'));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// --- CONFIGURACIÓN ---
const DATA_DIR = fs.existsSync('/app/data') ? '/app/data' : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'database.db');

// AQUÍ ESTÁ EL TRUCO: Leemos la variable de entorno o usamos una por defecto
const PUBLIC_DOMAIN = process.env.PUBLIC_URL || null;

app.use(bodyParser.json());
const db = new sqlite3.Database(DB_PATH);

db.run(`CREATE TABLE IF NOT EXISTS links (
    hash_corto TEXT PRIMARY KEY,
    hash_original TEXT,
    link_drive TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

function hexToBase62(hexStr) {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    const cleanHex = hexStr.startsWith('0x') ? hexStr : '0x' + hexStr;
    try {
        let num = BigInt(cleanHex); 
        while (num > 0n) {
            let remainder = num % 62n;
            result = chars[Number(remainder)] + result;
            num = num / 62n;
        }
    } catch (e) { return null; }
    return result || '0';
}

app.post('/procesar', (req, res) => {
    let { linkDrive, hashOriginal } = req.body;
    if (!linkDrive || !hashOriginal) return res.status(400).json({ ok: false, error: 'Faltan datos' });

    // Normalizar Hash
    if (!/^[0-9a-fA-F]+$/.test(hashOriginal)) {
        hashOriginal = crypto.createHash('sha256').update(hashOriginal).digest('hex');
    }

    const hashBase62 = hexToBase62(hashOriginal);
    const hashMinimo = hashBase62.substring(0, 7);

    const query = `INSERT OR REPLACE INTO links (hash_corto, hash_original, link_drive) VALUES (?, ?, ?)`;
    
    db.run(query, [hashMinimo, hashOriginal, linkDrive], function(err) {
        if (err) return res.status(500).json({ ok: false, error: err.message });

        // --- CONSTRUCCIÓN INTELIGENTE DE URL ---
        let finalUrl;
        if (PUBLIC_DOMAIN) {
            // Si configuraste tu dominio en Easypanel, usamos ese
            // Quitamos la barra final si la pusiste por error
            const domain = PUBLIC_DOMAIN.replace(/\/$/, "");
            finalUrl = `${domain}/i/${hashMinimo}`;
        } else {
            // Si no, usamos la interna (fallback)
            finalUrl = `${req.protocol}://${req.get('host')}/i/${hashMinimo}`;
        }

        res.json({
            ok: true,
            hash_minimo: hashMinimo,
            url_corta: finalUrl
        });
    });
});

app.get('/i/:id', (req, res) => {
    db.get("SELECT link_drive FROM links WHERE hash_corto = ?", [req.params.id], (err, row) => {
        if (row) res.redirect(row.link_drive);
        else res.status(404).send('Link no encontrado');
    });
});

app.listen(PORT, () => console.log(`🚀 Listo en puerto ${PORT}`));

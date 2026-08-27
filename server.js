const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// --- CONFIGURACIÓN POSTGRESQL (Nuevos Enlaces) ---
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'base_john',
  port: process.env.DB_PORT || 5432,
});

// --- CONFIGURACIÓN SQLITE (Enlaces Históricos) ---
const DATA_DIR = fs.existsSync('/app/data') ? '/app/data' : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'database.db');
const db = new sqlite3.Database(DB_PATH);

db.run(`CREATE TABLE IF NOT EXISTS links (hash_corto TEXT PRIMARY KEY, hash_original TEXT, link_drive TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

const appUrl = process.env.PUBLIC_URL || null;

function hexToBase62(hexStr) {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    try {
        let num = BigInt('0x' + hexStr); 
        while (num > 0n) {
            let remainder = num % 62n;
            result = chars[Number(remainder)] + result;
            num = num / 62n;
        }
    } catch (e) {
        return null; 
    }
    return result || '0';
}

// Endpoint Legacy para compatibilidad
app.post('/procesar', (req, res) => {
    let { linkDrive, hashOriginal } = req.body;
    if (!linkDrive || !hashOriginal) return res.status(400).json({ ok: false, error: 'Faltan datos' });

    if (!/^[0-9a-fA-F]+$/.test(hashOriginal)) {
        hashOriginal = crypto.createHash('sha256').update(hashOriginal).digest('hex');
    }

    const hashBase62 = hexToBase62(hashOriginal);
    const hashMinimo = (hashBase62 || hashOriginal).substring(0, 7);

    db.run(`INSERT OR REPLACE INTO links (hash_corto, hash_original, link_drive) VALUES (?, ?, ?)`, 
    [hashMinimo, hashOriginal, linkDrive], function(err) {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        
        let finalUrl = appUrl 
          ? `${appUrl.replace(/\/$/, "")}/i/${hashMinimo}`
          : `${req.protocol}://${req.get('host')}/i/${hashMinimo}`;

        res.json({ ok: true, hash_minimo: hashMinimo, url_corta: finalUrl });
    });
});

// --- REDIRECCIÓN HÍBRIDA (GET /i/:id) ---
app.get('/i/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Intentar buscar en PostgreSQL (Formato Hexadecimal corto: 6924ede)
        const pgResult = await pool.query(
            'SELECT id_drive FROM cola_recepcion WHERE hash_corto = $1 AND id_drive IS NOT NULL LIMIT 1',
            [id]
        );

        if (pgResult.rows.length > 0 && pgResult.rows[0].id_drive) {
            return res.redirect(`https://drive.google.com/file/d/${pgResult.rows[0].id_drive}/view`);
        }

        // 2. Fallback: Buscar en SQLite (Enlaces viejos / Base62)
        db.get('SELECT link_drive FROM links WHERE hash_corto = ?', [id], (err, row) => {
            if (row && row.link_drive) {
                return res.redirect(row.link_drive);
            }
            return res.status(404).send('Link no encontrado');
        });

    } catch (error) {
        console.error('Error PostgreSQL:', error);
        // Fallback de emergencia a SQLite si la DB principal falla
        db.get('SELECT link_drive FROM links WHERE hash_corto = ?', [id], (err, row) => {
            if (row && row.link_drive) {
                return res.redirect(row.link_drive);
            }
            return res.status(500).send('Error interno del servidor');
        });
    }
});

app.get('/', (req, res) => res.send('Acortador Híbrido Activo (PostgreSQL + SQLite) 🚀'));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

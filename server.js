const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto'); // Nueva librería para arreglar el problema

const app = express();
const PORT = 3000;

// --- CONFIGURACIÓN DE RUTAS PERSISTENTES ---
const DATA_DIR = fs.existsSync('/app/data') ? '/app/data' : path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)){
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'database.db');

app.use(bodyParser.json());

// --- INICIALIZAR BASE DE DATOS ---
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) console.error('❌ Error crítico al abrir DB:', err.message);
    else console.log(`✅ Base de datos conectada en: ${DB_PATH}`);
});

db.run(`CREATE TABLE IF NOT EXISTS links (
    hash_corto TEXT PRIMARY KEY,
    hash_original TEXT,
    link_drive TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// --- LÓGICA MATEMÁTICA MEJORADA ---
function hexToBase62(hexStr) {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    // Aseguramos formato hex con '0x'
    const cleanHex = hexStr.startsWith('0x') ? hexStr : '0x' + hexStr;
    
    try {
        let num = BigInt(cleanHex); 
        while (num > 0n) {
            let remainder = num % 62n;
            result = chars[Number(remainder)] + result;
            num = num / 62n;
        }
    } catch (e) {
        console.error("Error convirtiendo hash", e);
        return null; 
    }
    return result || '0';
}

// --- ENDPOINT PROCESAR ---
app.post('/procesar', (req, res) => {
    let { linkDrive, hashOriginal } = req.body;

    if (!linkDrive || !hashOriginal) {
        return res.status(400).json({ ok: false, error: 'Faltan datos' });
    }

    // --- EL ARREGLO MÁGICO ---
    // Si el ID tiene letras raras (como los de Google Drive),
    // creamos un hash SHA256 válido a partir de él.
    const isHex = /^[0-9a-fA-F]+$/.test(hashOriginal);
    if (!isHex) {
        // Convertimos el ID de Drive (ej: "1ABC...") a un Hex válido
        hashOriginal = crypto.createHash('sha256').update(hashOriginal).digest('hex');
    }

    // Ahora sí, convertimos matemáticamente
    const hashBase62 = hexToBase62(hashOriginal);
    
    if (!hashBase62) {
        return res.status(500).json({ ok: false, error: 'Error interno generando ID corto' });
    }

    // Recortar a 7 caracteres
    const hashMinimo = hashBase62.substring(0, 7);

    // Insertar en SQLite
    const query = `INSERT OR REPLACE INTO links (hash_corto, hash_original, link_drive) VALUES (?, ?, ?)`;
    
    db.run(query, [hashMinimo, hashOriginal, linkDrive], function(err) {
        if (err) {
            console.error("Error SQL:", err.message);
            return res.status(500).json({ ok: false, error: err.message });
        }

        const protocol = req.protocol;
        const host = req.get('host');
        // Usa el host que viene en la petición (útil para proxies)
        const shortUrl = `${protocol}://${host}/i/${hashMinimo}`;

        res.json({
            ok: true,
            hash_minimo: hashMinimo,
            url_corta: shortUrl
        });
    });
});

// --- ENDPOINT REDIRECCIONAR ---
app.get('/i/:id', (req, res) => {
    const id = req.params.id;
    db.get("SELECT link_drive FROM links WHERE hash_corto = ?", [id], (err, row) => {
        if (row) {
            res.redirect(row.link_drive);
        } else {
            res.status(404).send('Imagen no encontrada 😕');
        }
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor listo en puerto ${PORT}`);
});

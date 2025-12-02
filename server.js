const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// --- CONFIGURACIÓN DE RUTAS PERSISTENTES ---
// Si existe la carpeta '/app/data' (Easypanel/Docker), úsala.
// Si no, usa la carpeta local 'data' (tu PC).
const DATA_DIR = fs.existsSync('/app/data') ? '/app/data' : path.join(__dirname, 'data');

// Nos aseguramos de que la carpeta exista (útil para pruebas locales)
if (!fs.existsSync(DATA_DIR)){
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'database.db');

app.use(bodyParser.json());

// --- INICIALIZAR BASE DE DATOS ---
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Error crítico al abrir DB:', err.message);
    } else {
        console.log(`✅ Base de datos conectada en: ${DB_PATH}`);
    }
});

// Crear tabla si no existe
db.run(`CREATE TABLE IF NOT EXISTS links (
    hash_corto TEXT PRIMARY KEY,
    hash_original TEXT,
    link_drive TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// --- LÓGICA MATEMÁTICA: HEX A BASE62 ---
function hexToBase62(hexStr) {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    // Aseguramos que tenga formato hex válido para BigInt
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
        return null; // Retorna null si el hash no es válido
    }
    return result || '0';
}

// --- ENDPOINT 1: PROCESAR (Recibe de n8n) ---
app.post('/procesar', (req, res) => {
    const { linkDrive, hashOriginal } = req.body;

    if (!linkDrive || !hashOriginal) {
        return res.status(400).json({ ok: false, error: 'Faltan datos: linkDrive o hashOriginal' });
    }

    // 1. Convertir Hash
    const hashBase62 = hexToBase62(hashOriginal);
    
    if (!hashBase62) {
        return res.status(400).json({ ok: false, error: 'Hash original inválido' });
    }

    // 2. Recortar a 7 caracteres (Mínimo Viable)
    const hashMinimo = hashBase62.substring(0, 7);

    // 3. Insertar o Actualizar en SQLite
    const query = `INSERT OR REPLACE INTO links (hash_corto, hash_original, link_drive) VALUES (?, ?, ?)`;
    
    db.run(query, [hashMinimo, hashOriginal, linkDrive], function(err) {
        if (err) {
            console.error("Error SQL:", err.message);
            return res.status(500).json({ ok: false, error: err.message });
        }

        // Construimos la URL basada en el host actual (o puedes hardcodear tu dominio)
        const protocol = req.protocol;
        const host = req.get('host');
        const shortUrl = `${protocol}://${host}/i/${hashMinimo}`;

        res.json({
            ok: true,
            hash_minimo: hashMinimo,
            url_corta: shortUrl
        });
    });
});

// --- ENDPOINT 2: REDIRECCIONAR (Para el usuario) ---
app.get('/i/:id', (req, res) => {
    const id = req.params.id;
    
    db.get("SELECT link_drive FROM links WHERE hash_corto = ?", [id], (err, row) => {
        if (err) return res.status(500).send("Error de servidor");
        
        if (row) {
            res.redirect(row.link_drive);
        } else {
            res.status(404).send('<h3>Imagen no encontrada 😕</h3>');
        }
    });
});

// --- ENDPOINT DE SALUD (Para Easypanel Health Check) ---
app.get('/', (req, res) => {
    res.send('Microservicio Activo 🚀');
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`📂 Guardando datos en: ${DATA_DIR}`);
});

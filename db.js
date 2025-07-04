// db.js
const sqlite3 = require('sqlite3').verbose();
const dbPath = './messages.db';
let db = null;

function initializeDatabase() {
    db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
            console.error('❌ Error al abrir/crear la base de datos SQLite:', err.message);
        } else {
            console.log('✅ Conectado a la base de datos SQLite.');
            db.run(`CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                sender TEXT,
                messageContent TEXT,
                responseContent TEXT,
                errorContent TEXT
            )`);
        }
    });
    return db;
}

function closeDatabase() {
    if (db) {
        db.close((err) => {
            if (err) console.error('❌ Error al cerrar la base de datos:', err.message);
            else console.log('✅ Conexión a la base de datos SQLite cerrada.');
        });
    }
}

module.exports = { initializeDatabase, closeDatabase };

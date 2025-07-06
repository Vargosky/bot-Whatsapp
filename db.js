// db.js  – SQLite con migración ordenada usando serialize()
const sqlite3 = require('sqlite3').verbose();
const dbPath  = './messages.db';
let db = null;

function initializeDatabase() {
  db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, err => {
    if (err) {
      console.error('❌ Error al abrir/crear SQLite:', err.message);
      return;
    }
    console.log('✅ Conectado a la base de datos SQLite.');

    // Ejecutamos las sentencias en serie para evitar “no such table”
    db.serialize(() => {
      // 1) Crear la tabla con TODAS las columnas si aún no existe
      db.run(`
        CREATE TABLE IF NOT EXISTS messages (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp        TEXT,
          sender           TEXT,
          messageContent   TEXT,
          responseContent  TEXT,
          errorContent     TEXT,
          promptTokens     INTEGER,
          completionTokens INTEGER,
          totalTokens      INTEGER,
          costUSD          REAL
        )
      `);

      // 2) Por si vienes de una versión antigua, intenta añadir columnas faltantes
      const tryAlter = (col, type) =>
        db.run(`ALTER TABLE messages ADD COLUMN ${col} ${type}`, e => {
          if (e && !/duplicate column/i.test(e.message))
            console.error(`❌ Migración SQLite [${col}]:`, e.message);
        });

      tryAlter('promptTokens',     'INTEGER');
      tryAlter('completionTokens', 'INTEGER');
      tryAlter('totalTokens',      'INTEGER');
      tryAlter('costUSD',          'REAL');
    });
  });
  return db;
}

function closeDatabase() {
  if (db) {
    db.close(err => {
      if (err) console.error('❌ Error al cerrar SQLite:', err.message);
      else console.log('✅ Conexión SQLite cerrada.');
    });
  }
}

module.exports = { initializeDatabase, closeDatabase };

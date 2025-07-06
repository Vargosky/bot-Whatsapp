// index.js
// Bot de WhatsApp + DeepSeek + SQLite
require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { initializeDatabase, closeDatabase } = require('./db');
const enviarAIA = require('./ai');

let db = initializeDatabase();

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  }
});

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('authenticated', () => console.log('✅ Autenticado en WhatsApp'));
client.on('ready', () => console.log('✅ Bot de WhatsApp listo y funcionando'));

// ────────────────────────────────────
client.on('message', async msg => {
  console.log('[↩️  Recibido]', msg.from, '→', msg.body);

  // Ignora Estados (y grupos si quieres)
  if (msg.isStatus /* || msg.from.endsWith('@g.us') */) return;

  const timestamp      = new Date().toISOString();
  const sender         = msg.from;
  const messageContent = msg.body;
  let responseContent  = '';
  let errorContent     = '';
  let messageDbId      = null;

  try {
    // Guarda mensaje entrante
    messageDbId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO messages (timestamp, sender, messageContent)
         VALUES (?, ?, ?)`,
        [timestamp, sender, messageContent],
        function (err) { err ? reject(err) : resolve(this.lastID); }
      );
    });

    // Llama a DeepSeek
    const { text: respuesta, usage } = await enviarAIA(messageContent);
    console.log('[✅ DeepSeek]', respuesta.slice(0, 80), '...');
    responseContent = respuesta;

    // Envía la respuesta
    try {
      await client.sendMessage(sender, respuesta);
      console.log('[📤 Enviado OK]');
    } catch (sendErr) {
      console.error('[🚫 Error sendMessage]', sendErr);
      throw sendErr;
    }

    // Actualiza BD con métrica de uso
    db.run(
      `UPDATE messages
         SET responseContent = ?, promptTokens = ?, completionTokens = ?,
             totalTokens = ?, costUSD = ?
       WHERE id = ?`,
      [
        responseContent,
        usage?.prompt_tokens     ?? null,
        usage?.completion_tokens ?? null,
        usage?.total_tokens      ?? null,
        usage?.cost              ?? null,
        messageDbId
      ]
    );

  } catch (err) {
    console.error('❌ Error manejando mensaje:', err.message);
    errorContent = err.message;
    try {
      await client.sendMessage(sender, 'Lo siento, ocurrió un error. Inténtalo más tarde.');
    } catch {/* ignorar */}
    if (messageDbId) {
      db.run(`UPDATE messages SET errorContent = ? WHERE id = ?`, [errorContent, messageDbId]);
    }
  }
});
// ────────────────────────────────────

// ¡IMPORTANTE! Iniciar el cliente para que quede vivo
client.initialize();

// Ctrl-C → cerrar SQLite ordenadamente
process.on('SIGINT', () => {
  closeDatabase();
  process.exit(0);
});

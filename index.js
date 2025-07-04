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

client.on('message', async msg => {
    if (msg.isStatus || msg.from.endsWith('@g.us')) return;

    const timestamp = new Date().toISOString();
    const sender = msg.from;
    const messageContent = msg.body;
    let responseContent = '', errorContent = '';
    let messageDbId = null;

    try {
        messageDbId = await new Promise((resolve, reject) => {
            db.run(`INSERT INTO messages (timestamp, sender, messageContent) VALUES (?, ?, ?)`,
                [timestamp, sender, messageContent],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                });
        });

        const respuesta = await enviarAIA(msg.body);
        responseContent = respuesta;
        await client.sendMessage(msg.from, respuesta);

        db.run(`UPDATE messages SET responseContent = ? WHERE id = ?`, [responseContent, messageDbId]);
    } catch (err) {
        console.error('❌ Error manejando mensaje:', err.message);
        errorContent = err.message;
        await client.sendMessage(msg.from, 'Lo siento, ocurrió un error. Inténtalo más tarde.');

        if (messageDbId) {
            db.run(`UPDATE messages SET errorContent = ? WHERE id = ?`, [errorContent, messageDbId]);
        }
    }
});

client.initialize();

process.on('SIGINT', () => {
    closeDatabase();
    process.exit(0);
});

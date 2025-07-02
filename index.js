// Importar módulos necesarios
require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Asegúrate de que esta línea esté presente

// --- NUEVO: Importar y configurar SQLite ---
const sqlite3 = require('sqlite3').verbose();
const dbPath = './messages.db'; // Ruta donde se guardará el archivo de la base de datos

// Abrir la base de datos (o crearla si no existe)
let db = null; // Inicializamos db como null

function initializeDatabase() {
    db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
            console.error('❌ Error al abrir/crear la base de datos SQLite:', err.message);
        } else {
            console.log('✅ Conectado a la base de datos SQLite.');
            // Crear la tabla 'messages' si no existe
            db.run(`CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                sender TEXT,
                messageContent TEXT,
                responseContent TEXT,
                errorContent TEXT
            )`, (createErr) => {
                if (createErr) {
                    console.error('❌ Error al crear la tabla messages:', createErr.message);
                } else {
                    console.log('✅ Tabla messages lista.');
                }
            });
        }
    });
}

// Llama a la función de inicialización de la DB al inicio
initializeDatabase();
// --- FIN NUEVO: Importar y configurar SQLite ---


// Configuración de Gemini
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

// Verifica que la API Key esté configurada
if (!GEMINI_API_KEY) {
    console.error('❌ Error: GEMINI_API_KEY no está configurada en tu archivo .env');
    console.error('Asegúrate de haberla reemplazado con tu clave API real.');
    process.exit(1);
}

// Inicializar la API de Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });


// Inicializa el cliente de WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true, // Ejecuta el navegador sin interfaz gráfica
        args: [ // Argumentos recomendados para entornos de servidor
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // Esto puede ayudar en entornos con poca RAM
            '--disable-gpu'
        ]
    }
});

// Eventos del cliente de WhatsApp
client.on('qr', qr => {
    console.log('Escanea este código QR con tu teléfono:');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => console.log('✅ Autenticado en WhatsApp'));
client.on('auth_failure', msg => console.error('❌ Falla al autenticar en WhatsApp', msg));
client.on('ready', () => console.log('✅ Bot de WhatsApp listo y funcionando'));
client.on('disconnected', (reason) => {
    console.log('❌ Cliente desconectado:', reason);
    // Puedes añadir lógica aquí para intentar reconectar si es necesario
});

// Manejo de mensajes entrantes
client.on('message', async msg => {
    // Ignora los mensajes de estado o de grupos que no sean de interés (opcional)
    if (msg.isStatus || msg.from.endsWith('@g.us')) {
        return;
    }

    console.log(`📩 Mensaje de ${msg.from}: "${msg.body}"`);

    const timestamp = new Date().toISOString();
    const sender = msg.from;
    const messageContent = msg.body;
    let responseContent = '';
    let errorContent = '';
    let messageDbId = null; // Para guardar el ID de la fila insertada

    // --- NUEVO: Guardar el mensaje entrante en la base de datos ---
    if (db) {
        // Usamos una promesa para esperar a que la inserción termine y obtener el ID
        messageDbId = await new Promise((resolve, reject) => {
            db.run(`INSERT INTO messages (timestamp, sender, messageContent) VALUES (?, ?, ?)`,
                [timestamp, sender, messageContent],
                function(err) {
                    if (err) {
                        console.error('❌ Error al insertar mensaje entrante en la DB:', err.message);
                        errorContent = `Error al guardar mensaje entrante: ${err.message}`;
                        reject(err);
                    } else {
                        console.log(`✅ Mensaje entrante ${this.lastID} guardado en la DB.`);
                        resolve(this.lastID); // Resolvemos con el ID de la fila insertada
                    }
                }
            );
        }).catch(err => {
            // Manejamos el error si la inserción falló
            console.error('Error en la promesa de inserción inicial:', err);
            return null;
        });
    }
    // --- FIN NUEVO: Guardar el mensaje entrante ---

    try {
        const respuesta = await enviarAIA(msg.body);
        responseContent = respuesta; // Guarda la respuesta para el log
        await client.sendMessage(msg.from, respuesta);
        console.log(`📤 Respondido a ${msg.from}: "${respuesta.substring(0, 50)}..."`); // Muestra un extracto

        // --- NUEVO: Actualizar la respuesta del bot en la base de datos ---
        if (db && messageDbId) {
            db.run(`UPDATE messages SET responseContent = ? WHERE id = ?`,
                [responseContent, messageDbId],
                function(err) {
                    if (err) {
                        console.error('❌ Error al actualizar respuesta en la DB:', err.message);
                        errorContent += ` | Error al actualizar respuesta: ${err.message}`;
                    } else {
                        console.log(`✅ Respuesta actualizada para el mensaje con ID ${messageDbId}.`);
                    }
                }
            );
        }
        // --- FIN NUEVO: Actualizar la respuesta del bot ---

    } catch (err) {
        console.error('❌ Error manejando mensaje:', err.response?.data?.error?.message || err.message);
        errorContent = `Error al procesar/responder: ${err.response?.data?.error?.message || err.message || err}`; // Captura el error para el log
        await client.sendMessage(msg.from, 'Lo siento, en este momento no puedo procesar tu solicitud. Por favor, inténtalo de nuevo más tarde.');

        // --- NUEVO: Actualizar errores en la base de datos ---
        if (db && messageDbId) {
            db.run(`UPDATE messages SET errorContent = ? WHERE id = ?`,
                [errorContent, messageDbId],
                function(err) {
                    if (err) {
                        console.error('❌ Error al actualizar error en la DB:', err.message);
                    }
                }
            );
        }
        // --- FIN NUEVO: Actualizar errores ---
    }
});

// Función para enviar el mensaje a la IA de Gemini
async function enviarAIA(userMessage) {
    const prompt = buildPrompt(userMessage);

    const body = {
        contents: [{ parts: [{ text: prompt }] }]
    };

    try {
        const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
            body,
            { params: { key: GEMINI_API_KEY } }
        );
        const geminiResponse = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return (geminiResponse || '').trim() || 'Sin respuesta de Gemini.';
    } catch (error) {
        console.error('❌ Error al llamar a la API de Gemini:', error.response?.data || error.message);
        return 'Lo siento, no pude obtener una respuesta de la IA en este momento.';
    }
}

// Función para construir el prompt con el contexto del candidato
function buildPrompt(userMessage) {
    return `
Eres el asistente oficial de WhatsApp del candidato republicano Ignacio Valverde, exmilitar y defensor incansable de la seguridad, la libertad económica y el desarrollo de Chile. Tu propósito es informar de manera clara, concisa y propositiva sobre su visión y propuestas.

**Motivaciones Clave del Candidato Ignacio Valverde:**
- Defender la libertad de emprender y reducir la burocracia.
- Restaurar el orden público y fortalecer las instituciones de seguridad.
- Proteger y apoyar a la familia como pilar fundamental de la sociedad.
- Impulsar el desarrollo y la autonomía de las regiones.

**Propuestas Clave de Campaña:**
1)  **Ley Antiterrorista Reforzada:** Cero tolerancia al terrorismo, más herramientas para combatir la violencia y el crimen organizado.
2)  **Ley de Reducción Burocrática:** Simplificación de trámites y eliminación de obstáculos para emprendedores y ciudadanos.
3)  **Ley de Protección a la Familia:** Fortalecimiento de la familia, apoyo a su desarrollo y protección de sus valores.
4)  **Ley de Cárcel Efectiva:** Fin a las puertas giratorias, cumplimiento total de las penas para delincuentes.
5)  **Reforma Constitucional para un Congreso Eficiente:** Menos burocracia en el poder legislativo, mayor agilidad en la toma de decisiones.
6)  **Ley de Apoyo a Carabineros y FF.AA.:** Respaldo total y recursos para nuestras fuerzas de orden y seguridad.

**Instrucciones para el Asistente:**
-   Mantén siempre un tono respetuoso, firme y enfocado en las soluciones.
-   Responde directamente a las preguntas relacionadas con el candidato y sus propuestas.
-   **Mantén tus respuestas breves y al grano, idealmente entre 2 y 4 oraciones.** Si es absolutamente necesario dar más detalle para una propuesta compleja, no excedas las 6 oraciones.
-   Si la pregunta es tangencial o busca desviar la conversación, redirige amablemente hacia una de sus propuestas o motivaciones principales.
-   Si se presenta información errónea, corrígela con la verdad basada en la plataforma del candidato.
-   Mantén las respuestas concisas y claras, evitando ambigüedades.
-   Finaliza tus respuestas con una invitación a conocer más o un llamado a la acción si es apropiado.

Mensaje del ciudadano: "${userMessage}"

Respuesta como Asistente de Ignacio Valverde 🇨🇱:
`.trim();
}

// Arranca el bot de WhatsApp
client.initialize();

// --- NUEVO: Cerrar la base de datos al salir del proceso (importante para evitar corrupción) ---
process.on('SIGINT', () => {
    if (db) {
        db.close((err) => {
            if (err) {
                console.error('❌ Error al cerrar la base de datos:', err.message);
            }
            console.log('✅ Conexión a la base de datos SQLite cerrada.');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});
// --- FIN NUEVO: Cerrar la base de datos ---
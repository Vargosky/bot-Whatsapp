require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

// Configuración de Gemini
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash'; // Usa el modelo del .env, con un fallback

// Verifica que la API Key esté configurada
if (!GEMINI_API_KEY) {
    console.error('❌ Error: GEMINI_API_KEY no está configurada en tu archivo .env');
    console.error('Asegúrate de haberla reemplazado con tu clave API real.');
    process.exit(1); // Sale del proceso si no hay API Key
}

// Inicializa el cliente de WhatsApp
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { 
    headless: true, // Ejecuta el navegador sin interfaz gráfica
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // Argumentos recomendados para entornos de servidor
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

// Manejo de mensajes entrantes
client.on('message', async msg => {
  // Ignora los mensajes de estado o de grupos que no sean de interés (opcional)
  if (msg.isStatus || msg.from.endsWith('@g.us')) {
      return; 
  }

  try {
    console.log(`📩 Mensaje de ${msg.from}: "${msg.body}"`);
    const respuesta = await enviarAIA(msg.body);
    await client.sendMessage(msg.from, respuesta);
    console.log(`📤 Respondido a ${msg.from}: "${respuesta.substring(0, 50)}..."`); // Muestra un extracto
  } catch (err) {
    console.error('Error manejando mensaje:', err.response?.data?.error?.message || err.message);
    await client.sendMessage(msg.from, 'Lo siento, en este momento no puedo procesar tu solicitud. Por favor, inténtalo de nuevo más tarde.');
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
    // Accede a la respuesta de Gemini de forma segura
    const geminiResponse = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return (geminiResponse || '').trim() || 'Sin respuesta de Gemini.';
  } catch (error) {
    console.error('Error al llamar a la API de Gemini:', error.response?.data || error.message);
    // Devuelve un mensaje amigable en caso de error de la API
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
// index.js (temporal para debug)
require('dotenv').config();
const axios = require('axios');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function listGeminiModels() {
  if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY no está configurada en .env');
    return;
  }

  try {
    console.log('✨ Intentando listar modelos de Gemini...');
    const response = await axios.get(
      `https://generativelanguage.googleapis.com/v1beta/models`, // Endpoint para listar modelos
      {
        params: {
          key: GEMINI_API_KEY
        }
      }
    );

    console.log('✅ Modelos disponibles en v1beta:');
    response.data.models.forEach(model => {
      console.log(`- ID: ${model.name}`);
      console.log(`  DisplayName: ${model.displayName}`);
      console.log(`  SupportedMethods: ${model.supportedGenerationMethods.join(', ')}`);
      console.log('---');
    });

  } catch (error) {
    console.error('❌ Error al listar modelos de Gemini:', error.response?.data || error.message);
    if (error.response?.status === 403) {
      console.error('Asegúrate de que la API de Google AI esté habilitada en tu proyecto de Google Cloud y tu clave API sea válida.');
    }
  }
}

listGeminiModels();

// No inicialices el cliente de WhatsApp en este script temporal, solo estamos debuggeando
// client.initialize(); // <-- COMENTAR O QUITAR ESTA LÍNEA TEMPORALMENTE
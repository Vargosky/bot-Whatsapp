// ai.js
const axios = require('axios');
const buildPrompt = require('./utils/promptBuilder');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

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
        return (res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim() || 'Sin respuesta de Gemini.';
    } catch (error) {
        console.error('❌ Error al llamar a la API de Gemini:', error.response?.data || error.message);
        throw error;
    }
}

module.exports = enviarAIA;

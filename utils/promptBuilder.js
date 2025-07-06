// utils/promptBuilder.js
const fs = require('fs');
const basePrompt = fs.readFileSync('./prompt.txt', 'utf-8');

function buildPrompt(userMessage) {
    return `${basePrompt}\n\nMensaje del ciudadano: "${userMessage}"\n\nRespuesta como Asistente de Ignacio Valverde 🇨🇱:`.trim();
}

module.exports = buildPrompt;

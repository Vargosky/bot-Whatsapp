// ai.js – versión DeepSeek con historial y cálculo de costo
require('dotenv').config();
const axios = require('axios');

const API_KEY   = process.env.DEEPSEEK_API_KEY;
const MODEL     = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const PRICE_IN  = parseFloat(process.env.DEEPSEEK_PRICE_INPUT_1M  || '0.27');
const PRICE_OUT = parseFloat(process.env.DEEPSEEK_PRICE_OUTPUT_1M || '1.10');

/**
 * Envia un array de mensajes en formato OpenAI/DeepSeek
 * @param {Array} messages - [{ role: 'user', content: '...' }, ...]
 * @returns { text, usage }
 */
async function enviarAIA(messages) {
  try {
    const res = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: MODEL,
        messages,
        stream: false
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    const text = res.data.choices?.[0]?.message?.content?.trim() || '';
    const usage = res.data.usage || null;

    let cost = null;
    if (usage) {
      cost = Number((
        (usage.prompt_tokens     / 1_000_000) * PRICE_IN +
        (usage.completion_tokens / 1_000_000) * PRICE_OUT
      ).toFixed(6));
    }

    return { text, usage: usage ? { ...usage, cost } : null };

  } catch (error) {
    console.error('❌ DeepSeek ➜', JSON.stringify(error.response?.data || error.message));
    throw error;
  }
}

module.exports = enviarAIA;

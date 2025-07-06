// ai.js – DeepSeek API (v1) con roles correctos, timeout y costo preciso
require('dotenv').config();
const axios = require('axios');
const fs    = require('fs');

const API_KEY  = process.env.DEEPSEEK_API_KEY;
const MODEL    = process.env.DEEPSEEK_MODEL  || 'deepseek-chat';

const PRICE_IN  = parseFloat(process.env.DEEPSEEK_PRICE_INPUT_1M  || '0'); // USD / 1M IN
const PRICE_OUT = parseFloat(process.env.DEEPSEEK_PRICE_OUTPUT_1M || '0'); // USD / 1M OUT

if (!API_KEY) throw new Error('DEEPSEEK_API_KEY no definido en .env');

const systemPrompt = fs.readFileSync('./prompt_Einsoft.txt', 'utf-8').trim();

async function enviarAIA(userMessage) {
  try {
    console.log('[DeepSeek] usando modelo:', MODEL);

    const res = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage }
        ],
        stream: false
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000         // 60 s por si el prompt es largo
      }
    );

    const text  = res.data.choices?.[0]?.message?.content?.trim() || 'Sin respuesta de DeepSeek.';
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
    if (error.response?.data) {
      console.error('DeepSeek ➜', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

module.exports = enviarAIA;

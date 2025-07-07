// index.js
// Bot de WhatsApp + DeepSeek + SQLite
// - Antiloops, debounce, fotos 1‑5, leído/typing
// - Pide confirmación tras 3 turnos: «Continuar» o «Cancelar»
//   • Continuar  → retoma el chat
//   • Cancelar   → guarda silencio 5 min (para evitar loops con otros bots)
// - Marcadores [[FOTO]] / [[FOTO3]] para adjuntar imágenes
// - Sin botones por defecto; si ALLOW_BUTTONS=true y el número es WABA, enviará 2 botones
// - Fallback: si la IA NO pide foto, se envía test.png con el texto como caption

require('dotenv').config();
const path  = require('path');
const fs    = require('fs');
const axios = require('axios');
const {
  Client,
  LocalAuth,
  MessageMedia,
  Buttons // sólo cuando USE_BUTTONS === true y cuentas WABA
} = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { initializeDatabase, closeDatabase } = require('./db');
const enviarAIA = require('./ai');

// ─────────── CONFIG ───────────
const USE_BUTTONS   = process.env.ALLOW_BUTTONS === 'true';
const MAX_TURNS     = 3;            // respuestas seguidas antes de pedir confirmación
const COOLDOWN_MS   = 15_000;       // anti‑spam entre respuestas
const DEBOUNCE_MS   = 2_000;        // agrupar mensajes rápidos
const IGNORE_OLD_MS = 5_000;        // descartar msgs previos al arranque
const INV_MARK      = '\u200B';     // marca invisible (evita loops)
const SILENCE_MIN   = 60_000;       // silencio si supera turnos (ms)
const SILENCE_CANCEL= 5*60*1000;    // silencio tras «Cancelar» (5 min)
const BTN_TITLE     = 'Einsoft Bot';
const BTN_FOOTER    = 'Pulsa una opción';

// ─────────── ESTADO ───────────
const lastReply   = {};   // ts última respuesta
const botTurns    = {};   // turnos consecutivos
const needAck     = {};   // bool espera confirmación
const silenceTill = {};   // ts hasta cuándo estar en silencio
const lastUserMsg = {};
const timers      = {};
const lastChats   = {};

// ─────────── FOTOS ───────────
const MEDIA_DIR   = path.join(__dirname, 'media');
const PHOTO_FILES = fs.existsSync(MEDIA_DIR)
  ? fs.readdirSync(MEDIA_DIR).filter(f => /^([1-5])\.(jpe?g|png)$/i.test(f)).sort()
  : [];
if (!PHOTO_FILES.length) console.warn('⚠️  Sin imágenes 1‑5 en /media');

// ─────────── WHATSAPP ───────────
let botReadyAt = null;
const db = initializeDatabase();

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] }
});

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('authenticated', () => console.log('✅ Autenticado en WhatsApp'));
client.on('ready', () => { botReadyAt = Date.now(); console.log('✅ Bot listo'); });

// ─────────── RECEPCIÓN ───────────
client.on('message', async msg => {
  if (msg.isStatus || msg.fromMe) return;
  if (botReadyAt && msg.timestamp*1000 < botReadyAt - IGNORE_OLD_MS) return;

  const uid  = msg.from;
  const body = (msg.body || '').trim();
  const chat = await msg.getChat();
  await chat.sendSeen();
  lastChats[uid] = chat;
  if (body.includes(INV_MARK)) return; // rebote

  // Si estamos esperando confirmación
  if (needAck[uid]) {
    if (body === 'continuar_chat' || /^(continuar|seguir|ok)$/i.test(body)) {
      needAck[uid]   = false;
      botTurns[uid]  = 0;
      silenceTill[uid] = 0;
      await safeSend(chat, '¡Perfecto! Continuemos.' + INV_MARK);
    } else if (body === 'cancelar_chat' || /^cancelar$/i.test(body)) {
      needAck[uid]   = false;
      botTurns[uid]  = 0;
      silenceTill[uid] = Date.now() + SILENCE_CANCEL; // 5 minutos de silencio
      await safeSend(chat, 'Entendido. Cancelo la conversación por ahora.' + INV_MARK);
    }
    return;
  }

  // Comandos foto manuales
  const mFoto = body.match(/^!foto(\d)?/i);
  const mFotoTest = body.match(/^!foto_test/i);
  if (mFoto)     { await enviarFoto(uid, mFoto[1] ? parseInt(mFoto[1],10):null); return; }
  if (mFotoTest) { await enviarFoto(uid, null, true, 'Ejemplo de proyecto 📸'+INV_MARK); return; }

  // Periodo de silencio
  if (silenceTill[uid] && Date.now() < silenceTill[uid]) return;

  // Debounce
  lastUserMsg[uid] = body;
  clearTimeout(timers[uid]);
  timers[uid] = setTimeout(() => handleUser(uid), DEBOUNCE_MS);
});

// ─────────── HANDLE USER ───────────
// ─────────── HANDLE USER ───────────
async function handleUser(uid) {
  const body = lastUserMsg[uid];
  const chat = lastChats[uid];
  if (!body || !chat) return;

  /* ---------- 1. Límite de turnos ---------- */
  if ((botTurns[uid] || 0) >= MAX_TURNS) {
    await enviarPeticionContinuar(chat);
    console.log('[🤖 Pregunta de confirmación enviada]');
    needAck[uid]     = true;
    botTurns[uid]    = 0;                            // reinicia contador
    silenceTill[uid] = Date.now() + SILENCE_MIN;     // pausa 60 s
    lastReply[uid]   = Date.now();
    return;
  }

  /* ---------- 2. Cool-down anti-spam ---------- */
  if (lastReply[uid] && Date.now() - lastReply[uid] < COOLDOWN_MS) return;

  // ---------- 3. Guarda en BD ----------
  const ts = new Date().toISOString();
  let rowId = null;
  try {
    rowId = await runDb(
      'INSERT INTO messages(timestamp,sender,messageContent) VALUES(?,?,?)',
      [ts, uid, body]
    );
  } catch (e) {
    console.error('BD ERROR:', e.message);
  }

  // ---------- 4. Llama a la IA ----------
  try {
    await chat.sendStateTyping();
    const { text: respOriginal, usage } = await enviarAIA(body);

    // --- Detectar marcador de imagen ---
    let resp = respOriginal || '';
    const fotoMatch = resp.match(/\[\[FOTO(\d)?\]\]/i);
    let fotoNumero = null;
    if (fotoMatch) {
      fotoNumero = fotoMatch[1] ? parseInt(fotoMatch[1], 10) : null;
      resp = resp.replace(/\[\[FOTO(\d)?\]\]/i, '').trim();
    }

    // --- Enviar texto y/o foto ---
    if (fotoMatch) {
      if (resp) await safeSend(chat, resp + INV_MARK);
      await enviarFoto(uid, fotoNumero, false, 'Ejemplo de proyecto 📸' + INV_MARK);
    } else {
      await enviarFoto(uid, null, true, (resp || 'Ejemplo de proyecto 📸') + INV_MARK);
    }

    // --- Guarda métricas ---
    await runDb(
      `UPDATE messages SET responseContent=?,promptTokens=?,completionTokens=?,totalTokens=?,costUSD=? WHERE id=?`,
      [
        respOriginal,
        usage?.prompt_tokens ?? null,
        usage?.completion_tokens ?? null,
        usage?.total_tokens ?? null,
        usage?.cost ?? null,
        rowId
      ]
    );

    botTurns[uid]  = (botTurns[uid] || 0) + 1;
    lastReply[uid] = Date.now();

  } catch (err) {
    console.error('IA ERROR:', err.message);
    await safeSend(chat, 'Lo siento, ocurrió un error. Inténtalo más tarde.' + INV_MARK);
    if (rowId) await runDb('UPDATE messages SET errorContent=? WHERE id=?', [err.message, rowId]);
  } finally {
    await chat.clearState();
  }
}


// ─────────── PEDIR CONFIRMACIÓN ───────────
async function enviarPeticionContinuar(chat){
  const txt = 'He respondido varias veces seguidas. Si quieres continuar escribe *Continuar*. Si eres un bot escribe *Cancelar*.' + INV_MARK;

  if (USE_BUTTONS) {
    try {
      const btn = new Buttons(txt, [ { body: 'Continuar' }, { body: 'Cancelar' } ], BTN_TITLE, BTN_FOOTER);
      await chat.sendMessage(btn);
      return;
    } catch(e) {
      console.warn('⚠️  No fue posible enviar botones. Fallback a texto.', e.message);
    }
  }

  await safeSend(chat, txt);
}

// ─────────── FOTOS ───────────
async function enviarFoto(chatId, numero=null, isTest=false, caption=null){
  try {
    let file;
    if (isTest) {
      file = 'test.png';
    } else {
      file = (numero && PHOTO_FILES[numero-1]) ? PHOTO_FILES[numero-1] : PHOTO_FILES[Math.floor(Math.random()*PHOTO_FILES.length)];
    }
    const full = path.join(MEDIA_DIR, file || '');
    if (!file || !fs.existsSync(full)) {
      await safeSend(lastChats[chatId] || await client.getChatById(chatId), 'No hay fotos disponibles.');
      return;
    }
    const media = MessageMedia.fromFilePath(full);
    await client.sendMessage(chatId, media, { caption: caption || '' });
    console.log(`[📷 Enviada ${file}]`);
  } catch(e) {
    console.error('Foto ERROR:', e.message);
    await safeSend(lastChats[chatId] || await client.getChatById(chatId), 'Error al enviar la foto.');
  }
}

// ─────────── HELPERS ───────────
async function safeSend(target, text){
  try {
    typeof target === 'string' ? await client.sendMessage(target, text) : await target.sendMessage(text);
  } catch(e) { console.error('send ERROR:', e.message); }
}

function runDb(sql, p = []){
  return new Promise((res, rej) => {
    db.run(sql, p, function(err){ err ? rej(err) : res(this.lastID); });
  });
}

// ─────────── START / STOP ───────────
client.initialize();
process.on('SIGINT', () => {
  closeDatabase();
  console.log('\n🛑 SQLite cerrado');
  process.exit(0);
});

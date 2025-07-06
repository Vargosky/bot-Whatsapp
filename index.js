// index.js
// Bot de WhatsApp + DeepSeek + SQLite
// - Antiloops, debounce, fotos 1‑5, leído/typing
// - Botón «Continuar» tras 3 turnos
// - Marcadores [[FOTO]] / [[FOTO3]] para adjuntar imágenes solicitadas por la IA
// - Fallback: si la IA NO pide foto, se envía test.png pero **en el mismo mensaje** (texto como caption)
//   ⇒ Sólo sale UN mensaje (con foto + caption) y no suma turno extra.

require('dotenv').config();
const path    = require('path');
const fs      = require('fs');
const {
  Client,
  LocalAuth,
  MessageMedia,
  Buttons,
  List
} = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { initializeDatabase, closeDatabase } = require('./db');
const enviarAIA = require('./ai');

// ─────────── CONFIG ───────────
const MAX_TURNS     = 3;           // respuestas consecutivas antes de exigir confirmación
const COOLDOWN_MS   = 15_000;      // anti‑spam (ms)
const DEBOUNCE_MS   = 2_000;       // agrupa mensajes seguidos (ms)
const INV_MARK      = '\u200B';    // marca invisible para rebote
const IGNORE_OLD_MS = 5_000;       // descarta msgs previos al arranque (ms)
const SILENCE_MIN   = 60_000;      // silencio hasta confirmación (ms)
const BTN_TITLE     = 'Einsoft Bot';
const BTN_FOOTER    = 'Pulsa para continuar';

// ─────────── ESTADO EN MEMORIA ───────────
const lastReply   = {};
const botTurns    = {};
const needAck     = {};
const silenceTill = {};
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

// ─────────── MENSAJES ───────────
client.on('message', async msg => {
  if (msg.isStatus || msg.fromMe) return;
  if (botReadyAt && msg.timestamp * 1000 < botReadyAt - IGNORE_OLD_MS) return;

  const uid  = msg.from;
  const body = (msg.body || '').trim();
  const chat = await msg.getChat();
  await chat.sendSeen();
  lastChats[uid] = chat;
  if (body.includes(INV_MARK)) return; // rebote propio

  // Confirmaciones
  if (needAck[uid]) {
    if (body === 'continuar_chat' || /^(continuar|seguir|ok)$/i.test(body)) {
      needAck[uid] = false; botTurns[uid] = 0; silenceTill[uid] = 0;
      await safeSend(chat,'¡Perfecto! Continuemos.'+INV_MARK);
    }
    return;
  }

  // Comandos foto manuales
  const mFoto      = body.match(/^!foto(\d)?/i);
  const mFotoTest  = body.match(/^!foto_test/i);
  if (mFoto)      { await enviarFoto(uid, mFoto[1] ? parseInt(mFoto[1],10):null); return; }
  if (mFotoTest)  { await enviarFoto(uid, null, true, 'Ejemplo de proyecto 📸'+INV_MARK); return; }

  if (silenceTill[uid] && Date.now() < silenceTill[uid]) return;

  lastUserMsg[uid] = body;
  clearTimeout(timers[uid]);
  timers[uid] = setTimeout(() => handleUser(uid), DEBOUNCE_MS);
});

// ─────────── HANDLE USER ───────────
async function handleUser(uid){
  const body = lastUserMsg[uid];
  const chat = lastChats[uid];
  if(!body || !chat) return;
  if(lastReply[uid] && Date.now()-lastReply[uid] < COOLDOWN_MS) return;

  if(botTurns[uid] >= MAX_TURNS){
    await enviarBotonContinuar(chat);
    needAck[uid]   = true;
    silenceTill[uid] = Date.now()+SILENCE_MIN;
    lastReply[uid] = Date.now();
    return;
  }

  const ts = new Date().toISOString();
  let rowId=null;
  try{ rowId = await runDb('INSERT INTO messages(timestamp,sender,messageContent) VALUES(?,?,?)',[ts,uid,body]); }
  catch(e){ console.error('BD ERROR:',e.message); }

  try{
    await chat.sendStateTyping();
    const { text:respOriginal, usage } = await enviarAIA(body);

    // Detectar marcador de imagen
    let resp = respOriginal||'';
    const fotoMatch = resp.match(/\[\[FOTO(\d)?\]\]/i);
    let fotoNumero = null;
    if(fotoMatch){
      fotoNumero = fotoMatch[1] ? parseInt(fotoMatch[1],10):null;
      resp = resp.replace(/\[\[FOTO(\d)?\]\]/i,'').trim();
    }

    if(fotoMatch){
      // ── IA pidió una foto concreta ──
      if(resp) await safeSend(chat, resp + INV_MARK); // texto aparte
      await enviarFoto(uid, fotoNumero, false, 'Ejemplo de proyecto 📸'+INV_MARK);
    }else{
      // ── IA no pidió foto → enviamos test.png con caption = texto ──
      await enviarFoto(uid, null, true, (resp || 'Ejemplo de proyecto 📸') + INV_MARK);
    }

    // Guardar en BD
    await runDb('UPDATE messages SET responseContent=?,promptTokens=?,completionTokens=?,totalTokens=?,costUSD=? WHERE id=?',[respOriginal,usage?.prompt_tokens??null,usage?.completion_tokens??null,usage?.total_tokens??null,usage?.cost??null,rowId]);

    botTurns[uid]  = (botTurns[uid]||0)+1; // Foto no incrementa turnos extra
    lastReply[uid] = Date.now();
  }catch(err){
    console.error('IA ERROR:',err.message);
    await safeSend(chat,'Lo siento, ocurrió un error. Inténtalo más tarde.'+INV_MARK);
    if(rowId) await runDb('UPDATE messages SET errorContent=? WHERE id=?',[err.message,rowId]);
  }finally{
    await chat.clearState();
  }
}

// ─────────── BOTÓN CONTINUAR ───────────
async function enviarBotonContinuar(chat){
  try{
    // WhatsApp‑web.js < v2.x usa quick‑reply buttons con la firma:
    // new Buttons(body, buttonsArray, title, footer)
    const button = new Buttons(
      'He respondido varias veces seguidas. ¿Quieres seguir conversando?'+INV_MARK, // body (texto principal)
      [ { body: 'Continuar' } ],                                                  // 1 botón
      BTN_TITLE,                                                                   // título
      BTN_FOOTER                                                                   // pie
    );

    await chat.sendMessage(button);
  }catch(e){
    console.error('Botón Continuar ERROR:',e.message,'→ fallback texto');
    await safeSend(chat,'He respondido varias veces seguidas. Escribe *Continuar* para seguir.'+INV_MARK);
  }
}

// ─────────── FOTOS ─────────── ───────────
/**
 * @param {string} chatId   — id del chat (uid)
 * @param {number|null} numero — 1‑5 o null para aleatoria
 * @param {boolean} isTest — true fuerza test.png
 * @param {string|null} caption — texto opcional en la misma burbuja
 */
async function enviarFoto(chatId, numero=null, isTest=false, caption=null){
  try{
    let file;
    if(isTest){
      file='test.png';
    }else{
      file = (numero && PHOTO_FILES[numero-1]) ? PHOTO_FILES[numero-1] : PHOTO_FILES[Math.floor(Math.random()*PHOTO_FILES.length)];
    }
    const full = path.join(MEDIA_DIR,file||'');
    if(!file || !fs.existsSync(full)){
      await safeSend(lastChats[chatId]||await client.getChatById(chatId),'No hay fotos disponibles.');
      return;
    }
    const media = MessageMedia.fromFilePath(full);
    await client.sendMessage(chatId, media, { caption: caption || '' });
    console.log(`[📷 Enviada ${file}]`);
  }catch(e){
    console.error('Foto ERROR:',e.message);
    await safeSend(lastChats[chatId]||await client.getChatById(chatId),'Error al enviar la foto.');
  }
}

// ─────────── HELPERS ───────────
async function safeSend(target, text) {
  try {
    if (typeof target === 'string') {
      await client.sendMessage(target, text);
    } else {
      await target.sendMessage(text);
    }
  } catch (e) {
    console.error('send ERROR:', e.message);
  }
}

function runDb(sql, p = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, p, function (err) {
      if (err) {
        reject(err);
      } else {
        resolve(this.lastID);
      }
    });
  });
}

// ─────────── START / STOP ───────────
client.initialize();
process.on('SIGINT', () => {
  closeDatabase();
  console.log('🛑 SQLite cerrado');
  process.exit(0);
});

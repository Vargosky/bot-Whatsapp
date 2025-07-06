require('dotenv').config();
const enviarAIA = require('./ai');

enviarAIA('Hola, ¿cómo estás?').then(r => {
  console.log(r);
}).catch(e => console.error(e.response?.data || e));
// Este script es para probar la función enviarAIA con un mensaje de ejemplo
// Asegúrate de que el archivo ai.js esté correctamente configurado y que las variables de entorno estén definidas en tu .env
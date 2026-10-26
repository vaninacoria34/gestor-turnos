// Punto de entrada serverless para Vercel.
// Reutiliza la app Express del servidor y ejecuta el seed inicial.
const { app, startServer } = require('../server/src/index');

let ready = null;
function ensureReady() {
  if (!ready) ready = startServer();
  return ready;
}

module.exports = async (req, res) => {
  try {
    await ensureReady();
  } catch (error) {
    console.error('No se pudo iniciar el servidor:', error);
    res.statusCode = 503;
    return res.end('No se pudo iniciar el servidor. Revisá las variables de entorno de Firebase.');
  }
  return app(req, res);
};

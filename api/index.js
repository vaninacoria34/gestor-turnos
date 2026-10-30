// Punto de entrada serverless para Vercel.
// Reutiliza la app Express del servidor y ejecuta el seed inicial.
const { app } = require('../server/src/index');

module.exports = async (req, res) => {
  return app(req, res);
};

// Prueba local extendida: simula cómo Vercel invoca api/index.js.
const http = require('http');
const handler = require('../api/index.js');

const server = http.createServer((req, res) => {
  Promise.resolve(handler(req, res)).catch((error) => {
    console.error('handler error:', error.message);
    res.statusCode = 500;
    res.end('handler failure');
  });
});

async function main() {
  const base = 'http://127.0.0.1:4003';
  const health = await fetch(`${base}/api/health`);
  console.log('HEALTH:', health.status, JSON.stringify(await health.json().catch(() => null)));

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@gestor-turnos.local', password: 'Admin123!' }),
  });
  const loginBody = await login.json().catch(() => null);
  console.log('LOGIN:', login.status, loginBody && loginBody.token ? 'token OK' : JSON.stringify(loginBody));

  if (loginBody && loginBody.token) {
    const dash = await fetch(`${base}/api/dashboard?month=2026-10`, {
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    const dashBody = await dash.json().catch(() => null);
    console.log('DASHBOARD:', dash.status, dashBody ? `persistence=${dashBody.persistence} employees=${dashBody.summary?.employees}` : 'sin cuerpo');
  }

  server.close();
  process.exit(0);
}

server.listen(4003, '127.0.0.1', () => { console.log('READY'); main(); });

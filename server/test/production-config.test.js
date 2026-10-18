const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

function runNode(source, env) {
  return spawnSync(process.execPath, ['-e', source], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('la configuración de producción exige el ID del proyecto Firebase', () => {
  const firebasePath = require.resolve('../src/config/firebase');
  const result = runNode(`require(${JSON.stringify(firebasePath)})`, {
    NODE_ENV: 'production',
    FIRESTORE_PROJECT_ID: '',
    GCLOUD_PROJECT: '',
    GOOGLE_CLOUD_PROJECT: '',
    FIREBASE_SERVICE_ACCOUNT: '',
    GOOGLE_APPLICATION_CREDENTIALS: '',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Falta FIRESTORE_PROJECT_ID, GCLOUD_PROJECT o GOOGLE_CLOUD_PROJECT/);
});

test('la configuración de producción exige un secreto JWT fuerte', () => {
  const authPath = require.resolve('../src/lib/auth');
  const result = runNode(`require(${JSON.stringify(authPath)})`, {
    NODE_ENV: 'production',
    JWT_SECRET: '',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JWT_SECRET debe configurarse con al menos 32 bytes aleatorios/);
});

test('la API de producción deshabilita el registro público', async (context) => {
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'test-production-secret-0123456789-ab';
  const firebasePath = require.resolve('../src/config/firebase');
  require.cache[firebasePath] = {
    id: firebasePath,
    filename: firebasePath,
    loaded: true,
    exports: { db: null, isConfigured: false, isProduction: true },
  };

  const { app } = require('../src/index');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  context.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'attacker@example.com', password: 'password', role: 'admin' }),
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { message: 'El registro público está deshabilitado en producción.' });
});

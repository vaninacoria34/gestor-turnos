const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

test('catálogo universal: migración, CRUD, renombrado, asignaciones y eliminación en uso', async (context) => {
  // An isolated Firestore-shaped fixture exercises migration without production access.
  const collections = new Map([
    ['employees', new Map([['legacy-employee', { name: 'Persona existente', active: true, restDays: ['monday'], jobFunction: 'Sector legado' }]])],
    ['shiftTypes', new Map([['legacy-shift', { name: 'Mañana', active: true, startTime: '08:00', endTime: '12:00', requiredEmployees: 1, jobFunction: ' sector legado ' }]])],
  ]);
  const db = { collection(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    const rows = collections.get(name);
    return {
      async get() { return { docs: [...rows.entries()].map(([id, body]) => ({ id, data: () => ({ ...body }) })) }; },
      doc(id) { return { async set(body) { rows.set(id, { ...body }); }, async delete() { rows.delete(id); } }; },
      async add(body) { const id = crypto.randomUUID(); rows.set(id, { ...body }); return { id }; },
    };
  } };
  const firebasePath = require.resolve('../src/config/firebase');
  require.cache[firebasePath] = { id: firebasePath, filename: firebasePath, loaded: true, exports: { db, isConfigured: true } };
  const { app } = require('../src/index');
  const { signToken } = require('../src/lib/auth');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  context.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const token = signToken({ id: 'test', email: 'test@example.com' });
  async function request(path, method = 'GET', body) {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await fetch(base + '/job-functions')).status, 401);
  const imported = (await request('/job-functions')).body;
  assert.equal(imported.length, 1);
  assert.equal(imported[0].name, 'Sector legado');
  const legacyId = imported[0].id;
  assert.equal(collections.get('employees').get('legacy-employee').jobFunctionId, legacyId);
  assert.equal(collections.get('shiftTypes').get('legacy-shift').jobFunctionId, legacyId);
  assert.equal((await request('/job-functions')).body.length, 1);
  assert.equal((await request('/job-functions', 'POST', { name: '   ' })).status, 400);
  assert.equal((await request('/job-functions', 'POST', { name: 'sector LEGADO' })).status, 409);
  const created = await request('/job-functions', 'POST', { name: ' Logística ', description: 'Preparar envíos' });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Logística');
  assert.equal((await request(`/job-functions/${created.body.id}`)).body.description, 'Preparar envíos');
  const concurrent = await Promise.all([request('/job-functions', 'POST', { name: 'Recepción' }), request('/job-functions', 'POST', { name: 'recepción' })]);
  assert.deepEqual(concurrent.map((item) => item.status).sort(), [201, 409]);
  assert.equal((await request('/job-functions/missing')).status, 404);
  const blocked = await request(`/job-functions/${legacyId}`, 'DELETE');
  assert.equal(blocked.status, 409);
  assert.deepEqual(blocked.body.employees, ['Persona existente']);
  assert.deepEqual(blocked.body.shiftTypes, ['Mañana']);
  const renamed = await request(`/job-functions/${legacyId}`, 'PUT', { name: 'Operaciones', description: 'Nueva descripción' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.id, legacyId);
  assert.equal((await request('/employees')).body[0].jobFunction, 'Operaciones');
  assert.equal((await request('/shiftTypes')).body[0].jobFunction, 'Operaciones');
  assert.equal((await request('/job-functions')).body.some((item) => item.name === 'Sector legado'), false);
  assert.equal((await request(`/job-functions/${legacyId}`, 'PUT', { name: 'LOGÍSTICA' })).status, 409);
  const proposal = (await request('/schedules/generate', 'POST', { period: 'month', month: '2026-10' })).body;
  assert.ok(proposal.assignments.length > 0);
  assert.ok(proposal.assignments.every((item) => item.jobFunctionId === legacyId && item.jobFunction === 'Operaciones'));
  const reassigned = await request('/employees/legacy-employee', 'PUT', { jobFunctionId: created.body.id, name: 'Nombre actualizado' });
  assert.equal(reassigned.body.jobFunction, 'Logística');
  assert.deepEqual(reassigned.body.restDays, ['monday']);
  assert.equal((await request('/employees/legacy-employee', 'PUT', { jobFunctionId: 'missing' })).status, 400);
  assert.equal((await request('/employees/legacy-employee', 'PUT', { name: '' })).status, 400);
  const typeUpdate = await request('/shiftTypes/legacy-shift', 'PUT', { jobFunctionId: created.body.id, name: 'Horario actualizado', startTime: '09:00', endTime: '13:00', requiredEmployees: 2 });
  assert.equal(typeUpdate.body.jobFunction, 'Logística');
  assert.equal(typeUpdate.body.requiredEmployees, 2);
  assert.equal((await request('/shiftTypes/legacy-shift', 'PUT', { startTime: '15:00', endTime: '12:00' })).status, 400);
  assert.equal((await request(`/job-functions/${legacyId}`, 'DELETE')).status, 200);
  assert.equal((await request('/job-functions')).body.some((item) => item.id === legacyId), false);
  assert.equal((await request(`/job-functions/${legacyId}`, 'DELETE')).status, 404);
  const manual = await request('/shifts', 'POST', { employeeId: 'legacy-employee', date: '2026-11-01', startTime: '08:00', endTime: '12:00', notes: 'Original' });
  assert.equal(manual.status, 201);
  const shiftEdit = await request(`/shifts/${manual.body.id}`, 'PUT', { startTime: '14:00', endTime: '18:00', partial: true, notes: 'Ajustado', shiftTypeId: '' });
  assert.equal(shiftEdit.status, 200);
  assert.equal(shiftEdit.body.startTime, '14:00');
  assert.equal(shiftEdit.body.partial, true);
  assert.equal((await request('/shifts', 'POST', { employeeId: 'legacy-employee', date: '2026-11-01', startTime: '15:00', endTime: '17:00' })).status, 400);
  assert.equal((await request(`/shifts/${manual.body.id}`, 'DELETE')).status, 200);
  assert.equal((await request('/shifts')).body.length, 0);
  assert.equal((await request('/employees/legacy-employee', 'DELETE')).status, 200);
  assert.equal((await request('/shiftTypes/legacy-shift', 'DELETE')).status, 200);
  assert.equal((await request(`/job-functions/${created.body.id}`, 'DELETE')).status, 200);
});

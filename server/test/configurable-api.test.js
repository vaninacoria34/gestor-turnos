const { test } = require('node:test');
const assert = require('node:assert/strict');

test('CRUD dinámico, persistencia, excepciones, concurrencia y errores de Firebase', async (context) => {
  const collections = new Map();
  let failCommit = false;
  let failRead = false;
  let reads = 0;
  const rows = (name) => { if (!collections.has(name)) collections.set(name, new Map()); return collections.get(name); };
  const db = {
    collection(name) {
      const query = (filters = []) => ({
        name,
        where(field, op, value) { return query([...filters, { field, op, value }]); },
        async get() {
          reads += 1;
          if (failRead) throw new Error('Firestore offline');
          return { docs: [...rows(name)].filter(([, data]) => filters.every(({ field, op, value }) => op === '>=' ? data[field] >= value : op === '<=' ? data[field] <= value : data[field]?.some((item) => value.includes(item)))).map(([id, data]) => ({ id, data: () => structuredClone(data) })) };
        },
        doc(id) { return { id, path: `${name}/${id}`, name }; },
      });
      return query();
    },
    async runTransaction(work) {
      const pending = [];
      let wrote = false;
      await work({
        async get(query) { assert.equal(wrote, false, 'Firestore exige leer antes de escribir'); return query.get(); },
        set(ref, data) { wrote = true; pending.push(() => rows(ref.name).set(ref.id, structuredClone(data))); },
        delete(ref) { wrote = true; pending.push(() => rows(ref.name).delete(ref.id)); },
      });
      if (failCommit) throw new Error('Firestore commit failed');
      for (const commit of pending) commit();
    },
  };
  const firebasePath = require.resolve('../src/config/firebase');
  require.cache[firebasePath] = { id: firebasePath, filename: firebasePath, loaded: true, exports: { db, isConfigured: true, isProduction: false } };
  let app = require('../src/index').app;
  let server;
  let base;
  async function listen() {
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api`;
  }
  await listen();
  context.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const token = require('../src/lib/auth').signToken({ id: 'test', email: 'test@example.com' });
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const sector = (await request('/job-functions', 'POST', { name: 'Atención' })).body;
  const night = (await request('/shiftTypes', 'POST', { name: 'Tarde-Noche', jobFunctionId: sector.id, startTime: '18:00', endTime: '23:00' })).body;
  assert.equal((await request(`/shiftTypes/${night.id}`, 'PUT', { name: 'Noche configurable' })).body.name, 'Noche configurable');
  const days = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'saturday', 'sunday'].map((d) => [d, { mode: 'rest' }]));
  days.thursday = { mode: 'fixed', shiftTypeId: night.id };
  days.friday = { mode: 'fixed', shiftTypeId: night.id };
  const created = await request('/employees', 'POST', { name: 'Lautaro', jobFunctionIds: [sector.id], preferredShiftTypeIds: [night.id], weeklySchedule: days });
  assert.equal(created.status, 201);
  assert.equal((await request('/employees', 'POST', { name: ' LAUTARO ' })).status, 409);
  const employee = created.body;
  assert.equal((await request(`/employees/${employee.id}`, 'PUT', { weeklyOverrides: { '2026-10-20': {} } })).status, 400);
  assert.equal((await request(`/employees/${employee.id}`, 'PUT', { weeklySchedule: { monday: { mode: 'fixed', shiftTypeId: 'missing' } } })).status, 400);
  const initial = (await request('/schedules/generate', 'POST', { period: 'month', month: '2026-10' })).body;
  const index = initial.assignments.findIndex((a) => a.date === '2026-10-22');
  const edited = await request(`/schedules/proposals/${initial.id}/assignments/${index}`, 'PUT', { shiftTypeId: night.id, startTime: '19:00', endTime: '22:00' });
  assert.equal(edited.status, 200);
  const regenerated = (await request('/schedules/generate', 'POST', { period: 'month', month: '2026-10' })).body;
  assert.deepEqual(regenerated.assignments.filter((a) => a.date === '2026-10-22').map((a) => [a.startTime, a.endTime, a.manuallyEdited]), [['19:00', '22:00', true]]);
  assert.equal((await request(`/schedules/proposals/${initial.id}/assignments/${index}`, 'PUT', { shiftTypeId: night.id })).status, 409);
  assert.equal((await request('/schedules/confirm', 'POST', { proposalId: regenerated.id })).status, 200);
  const history = (await request('/sundayHistory')).body;
  await request('/schedules/confirm', 'POST', { proposalId: regenerated.id });
  assert.equal((await request('/sundayHistory')).body.length, history.length);
  await request(`/employees/${employee.id}`, 'PUT', { weeklyOverrides: { '2026-10-19': { friday: { mode: 'rest' } } } });
  const exception = (await request('/schedules/generate', 'POST', { weekStart: '2026-10-19' })).body;
  assert.ok(!exception.assignments.some((a) => a.date === '2026-10-23'));
  assert.ok(exception.assignments.some((a) => a.date === '2026-10-22' && a.startTime === '19:00'));
  assert.equal((await request('/shifts', 'POST', { employeeId: employee.id, date: '2026-10-23', startTime: '18:00', endTime: '23:00' })).status, 400);
  const second = (await request('/employees', 'POST', { name: 'Ana', jobFunctionIds: [sector.id] })).body;
  const shift = { employeeId: second.id, date: '2026-12-01', jobFunctionId: sector.id, startTime: '08:00', endTime: '12:00' };
  const concurrent = await Promise.all([request('/shifts', 'POST', shift), request('/shifts', 'POST', shift)]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 400]);
  assert.equal((await request(`/employees/${employee.id}`, 'DELETE')).status, 409);
  assert.equal((await request(`/shiftTypes/${night.id}`, 'DELETE')).status, 409);
  reads = 0;
  const dashboard = await request('/dashboard?month=2026-10');
  assert.equal(dashboard.status, 200);
  assert.deepEqual(dashboard.body.employees.map((e) => e.name), ['Ana', 'Lautaro']);
  assert.equal(dashboard.body.persistence, 'firestore');
  assert.equal(dashboard.body.shifts.length, 0, 'No descarga turnos de diciembre');
  assert.ok(reads <= 8, `Consultas acotadas por carga: ${reads}`);
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  delete require.cache[require.resolve('../src/index')];
  app = require('../src/index').app;
  await listen();
  assert.ok((await request('/dashboard?month=2026-10')).body.proposals.some((p) => p.assignments.some((a) => a.manuallyEdited && a.startTime === '19:00')));
  failCommit = true;
  assert.equal((await request(`/employees/${employee.id}`, 'PUT', { name: 'No persistir' })).status, 503);
  failCommit = false;
  assert.equal((await request('/employees')).body.find((e) => e.id === employee.id).name, 'Lautaro');
  failRead = true;
  assert.equal((await request('/employees')).status, 503);
  failRead = false;
});

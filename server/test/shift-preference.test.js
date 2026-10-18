const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateWeekProposal, matchesShiftPreference } = require('../src/lib/schedule');

test('las propuestas respetan mañana, tarde, flexible y empleados anteriores', () => {
  const shifts = [
    { id: 'morning', name: 'Mañana', startTime: '08:00', endTime: '12:00', requiredEmployees: 1 },
    { id: 'afternoon', name: 'Tarde', startTime: '14:00', endTime: '18:00', requiredEmployees: 1 },
  ];
  for (const preference of ['morning', 'afternoon', 'flexible', undefined]) {
    const proposal = generateWeekProposal({ employees: [{ id: 'person', name: 'Ana', shiftPreference: preference }], shiftTypes: shifts, weekStart: '2026-10-12' });
    assert.equal(proposal.assignments.length, preference === 'morning' || preference === 'afternoon' ? 7 : 14);
    assert.ok(proposal.assignments.every((item) => matchesShiftPreference({ shiftPreference: preference }, item)));
  }
  assert.equal(matchesShiftPreference({ shiftPreference: 'morning' }, { startTime: '12:00' }), false);
  assert.equal(matchesShiftPreference({ shiftPreference: 'afternoon' }, { startTime: '12:00' }), true);
});

test('las restricciones conservan descansos y generan advertencias si falta personal', () => {
  const proposal = generateWeekProposal({
    employees: [{ id: 'person', shiftPreference: 'morning', restDays: ['monday'] }],
    shiftTypes: [{ id: 'am', name: 'Mañana', startTime: '08:00', endTime: '12:00', requiredEmployees: 1 }, { id: 'pm', name: 'Tarde', startTime: '14:00', endTime: '18:00', requiredEmployees: 1 }], weekStart: '2026-10-12',
  });
  assert.equal(proposal.assignments.length, 6);
  assert.equal(proposal.warnings.length, 8);
});

test('las APIs guardan preferencias y permiten editar propuestas confirmadas sin duplicar turnos', async (context) => {
  // Force an isolated in-memory store; never connect tests to the user's Firestore.
  const firebasePath = require.resolve('../src/config/firebase');
  require.cache[firebasePath] = { id: firebasePath, filename: firebasePath, loaded: true, exports: { db: null, isConfigured: false } };
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
  const employee = (await request('/employees', 'POST', { name: 'Ana', active: false })).body;
  assert.equal(employee.shiftPreference, 'flexible');
  let updated = await request(`/employees/${employee.id}`, 'PUT', { shiftPreference: 'morning' });
  assert.equal(updated.body.active, false);
  assert.equal(updated.body.shiftPreference, 'morning');
  assert.equal((await request(`/employees/${employee.id}`, 'PUT', { shiftPreference: 'invalid' })).status, 400);
  assert.equal((await request('/employees', 'POST', { name: 'Invalid', shiftPreference: 'invalid' })).status, 400);
  await request(`/employees/${employee.id}`, 'PUT', { active: true });
  const morning = (await request('/shiftTypes', 'POST', { name: 'Mañana', startTime: '08:00', endTime: '12:00', requiredEmployees: 1 })).body;
  const afternoon = (await request('/shiftTypes', 'POST', { name: 'Tarde', startTime: '14:00', endTime: '18:00', requiredEmployees: 1 })).body;
  const proposal = (await request('/schedules/generate', 'POST', { weekStart: '2026-10-12' })).body;
  assert.equal(proposal.assignments.length, 7);
  await request('/schedules/confirm', 'POST', { proposalId: proposal.id });
  updated = await request(`/schedules/proposals/${proposal.id}/assignments/0`, 'PUT', { shiftTypeId: afternoon.id });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.assignments.length, 7);
  assert.equal(updated.body.assignments[0].startTime, '14:00');
  assert.equal(updated.body.status, 'proposed');
  assert.equal(updated.body.confirmedAt, null);
  assert.ok(updated.body.warnings.some((warning) => warning.date === proposal.assignments[0].date && warning.shiftTypeName === 'Mañana'));
  const employees = (await request('/employees')).body;
  assert.equal(employees.find((item) => item.id === employee.id).shiftPreference, 'morning');
  await request('/shifts', 'POST', { employeeId: employee.id, date: proposal.assignments[0].date, startTime: morning.startTime, endTime: morning.endTime });
  assert.equal((await request(`/schedules/proposals/${proposal.id}/assignments/0`, 'PUT', { shiftTypeId: morning.id })).status, 409);
  assert.equal((await request(`/schedules/proposals/${proposal.id}/assignments/999`, 'PUT', { shiftTypeId: morning.id })).status, 404);
});

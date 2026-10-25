const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateWeekProposal, matchesShiftPreference } = require('../src/lib/schedule');

test('las propuestas respetan mañana, tarde, flexible y empleados anteriores', () => {
  const shifts = [
    { id: 'morning', name: 'Mañana', startTime: '08:00', endTime: '12:00', requiredEmployees: 1 },
    { id: 'afternoon', name: 'Tarde', startTime: '14:00', endTime: '18:00', requiredEmployees: 1 },
  ];
  for (const preference of ['morning', 'afternoon', 'flexible', undefined]) {
    const proposal = generateWeekProposal({ employees: [{ id: 'person', name: 'Ana', shiftPreference: preference, allowedDoubleShifts: preference === 'flexible' }], shiftTypes: shifts, weekStart: '2026-10-12' });
    assert.equal(proposal.assignments.length, preference === 'flexible' ? 14 : 7);
    assert.ok(proposal.assignments.every((item) => matchesShiftPreference({ shiftPreference: preference }, item)));
  }
  const notAuthorized = generateWeekProposal({
    employees: [{ id: 'person', name: 'Ana' }],
    shiftTypes: shifts,
    weekStart: '2026-10-12',
  });
  assert.equal(notAuthorized.assignments.length, 7);
  assert.equal(matchesShiftPreference({ shiftPreference: 'morning' }, { startTime: '12:00' }), false);
  assert.equal(matchesShiftPreference({ shiftPreference: 'afternoon' }, { startTime: '12:00' }), true);
});

test('prioriza a quien prefiere la tarde y respeta su descanso dominical', () => {
  const proposal = generateWeekProposal({
    employees: [
      { id: 'lujan', name: 'Luján', shiftPreference: 'afternoon', restDays: ['sunday'] },
      { id: 'flexible', name: 'Flexible', shiftPreference: 'flexible' },
    ],
    shiftTypes: [{ id: 'pm', name: 'Tarde', startTime: '14:00', endTime: '18:00', requiredEmployees: 1 }],
    weekStart: '2026-10-12',
  });

  assert.deepEqual(
    proposal.assignments.filter((item) => item.employeeId === 'lujan').map((item) => item.date),
    proposal.dates.slice(0, 6),
  );
  assert.ok(proposal.assignments.some((item) => item.employeeId === 'flexible' && item.date === '2026-10-18'));
});

test('prioriza a quien descansó el día anterior cuando hay un turno disponible', () => {
  const proposal = generateWeekProposal({
    employees: [{ id: 'santino' }, { id: 'compañero' }],
    shiftTypes: [{ id: 'pm', name: 'Tarde', startTime: '14:00', endTime: '18:00', requiredEmployees: 1 }],
    manualShifts: [{ employeeId: 'compañero', date: '2026-10-12', startTime: '14:00', endTime: '18:00' }],
    weekStart: '2026-10-12',
  });

  assert.ok(proposal.assignments.some((item) => item.employeeId === 'santino' && item.date === '2026-10-13'));
});

test('rota día a día cada tipo de turno entre personas elegibles de la misma función', () => {
  const proposal = generateWeekProposal({
    employees: ['a', 'b', 'c'].map((id) => ({ id, name: id, jobFunction: 'Atención', shiftPreference: 'flexible' })),
    shiftTypes: [{ id: 'pm', name: 'Tarde', jobFunction: 'Atención', startTime: '14:00', endTime: '18:00', requiredEmployees: 1 }],
    weekStart: '2026-10-12',
  });

  assert.deepEqual(
    proposal.assignments.filter((item) => item.date <= '2026-10-17').map((item) => item.employeeId),
    ['a', 'b', 'c', 'a', 'b', 'c'],
  );
  assert.ok(proposal.assignments.every((item) => item.jobFunction === 'Atención' && item.shiftTypeId === 'pm'));
});

test('las restricciones conservan descansos y generan advertencias si falta personal', () => {
  const proposal = generateWeekProposal({
    employees: [{ id: 'person', shiftPreference: 'morning', restDays: ['monday'] }],
    shiftTypes: [{ id: 'am', name: 'Mañana', startTime: '08:00', endTime: '12:00', requiredEmployees: 1 }, { id: 'pm', name: 'Tarde', startTime: '14:00', endTime: '18:00', requiredEmployees: 1 }], weekStart: '2026-10-12',
  });
  assert.equal(proposal.assignments.length, 6);
  assert.equal(proposal.warnings.length, 8);
  assert.ok(proposal.warnings.every((item) => item.message.startsWith('TURNO SIN CUBRIR')));
  assert.ok(proposal.warnings.every((item) => item.startTime && item.endTime && item.missing === 1));
});

test('las dobles asignaciones autorizadas no pueden superponerse', () => {
  const proposal = generateWeekProposal({
    employees: [{ id: 'person', allowedDoubleShifts: true }],
    shiftTypes: [
      { id: 'morning', name: 'Mañana', startTime: '08:00', endTime: '16:00', requiredEmployees: 1 },
      { id: 'afternoon', name: 'Tarde', startTime: '14:00', endTime: '22:00', requiredEmployees: 1 },
    ],
    weekStart: '2026-10-12',
  });

  assert.ok(proposal.assignments.every((item) => !(item.shiftTypeId === 'morning' && proposal.assignments.some((other) => (
    other.employeeId === item.employeeId && other.date === item.date && other.shiftTypeId === 'afternoon'
  )))));
  assert.ok(proposal.warnings.some((item) => item.message.startsWith('TURNO SIN CUBRIR')));
});

test('respeta el máximo de horas semanales configurado', () => {
  const proposal = generateWeekProposal({
    employees: [{ id: 'person', maxHoursPerWeek: 8 }],
    shiftTypes: [{ id: 'full-day', name: 'Jornada', startTime: '08:00', endTime: '16:00', requiredEmployees: 1 }],
    weekStart: '2026-10-12',
  });
  assert.equal(proposal.assignments.length, 1);
  assert.equal(proposal.warnings.length, 6);
  assert.ok(proposal.warnings.every((item) => item.missing === 1));
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
  await request(`/employees/${employee.id}`, 'PUT', { allowedDoubleShifts: true });
  assert.equal((await request('/shifts', 'POST', { employeeId: employee.id, date: proposal.assignments[0].date, startTime: morning.startTime, endTime: morning.endTime })).status, 201);
  assert.equal((await request(`/schedules/proposals/${proposal.id}/assignments/0`, 'PUT', { shiftTypeId: morning.id })).status, 409);
  assert.equal((await request(`/schedules/proposals/${proposal.id}/assignments/999`, 'PUT', { shiftTypeId: morning.id })).status, 404);
});

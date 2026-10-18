const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateMonthProposal, requiredEmployeesOnDate, resolveSpecialDay, validateSpecialDayAssignment } = require('../src/lib/schedule');

const shiftTypes = [
  { id: 'am', name: 'Mañana', startTime: '08:00', endTime: '12:00', requiredEmployees: 4 },
  { id: 'pm', name: 'Tarde', startTime: '14:00', endTime: '18:00', requiredEmployees: 4 },
  { id: 'full', name: 'Completo', startTime: '08:00', endTime: '16:00', requiredEmployees: 1 },
];
const employees = Array.from({ length: 12 }, (_, index) => ({ id: `person-${index}`, name: `Persona ${index}`, active: true, shiftPreference: 'flexible' }));
const sunday = { id: 'sunday', name: 'Domingo reducido', mode: 'weekday', weekday: 'sunday', active: true, restOthers: true, requirements: [{ shiftTypeId: 'am', requiredEmployees: 2 }, { shiftTypeId: 'pm', requiredEmployees: 2 }] };

test('domingo 2+2 usa cuatro personas distintas, cierra los demás turnos y rota el personal', () => {
  const proposal = generateMonthProposal({ month: '2026-10', employees, shiftTypes, specialDays: [sunday] });
  const dates = proposal.dates.filter((date) => new Date(`${date}T12:00:00Z`).getUTCDay() === 0);
  for (const date of dates) {
    const daily = proposal.assignments.filter((item) => item.date === date);
    assert.equal(daily.length, 4);
    assert.equal(new Set(daily.map((item) => item.employeeId)).size, 4);
    assert.equal(daily.filter((item) => item.shiftTypeId === 'am').length, 2);
    assert.equal(daily.filter((item) => item.shiftTypeId === 'pm').length, 2);
    assert.equal(daily.filter((item) => item.shiftTypeId === 'full').length, 0);
    assert.equal(proposal.warnings.filter((item) => item.date === date).length, 0);
  }
  const loads = employees.map((employee) => proposal.assignments.filter((item) => dates.includes(item.date) && item.employeeId === employee.id).length);
  assert.ok(Math.max(...loads) - Math.min(...loads) <= 1);
  assert.ok(proposal.assignments.some((item) => item.date === '2026-10-05' && item.shiftTypeId === 'full'));
});

test('las fechas puntuales prevalecen y pueden dejar a todo el equipo de descanso', () => {
  const closed = { id: 'holiday', name: 'Feriado', mode: 'date', date: '2026-10-11', active: true, restOthers: true, requirements: [] };
  const proposal = generateMonthProposal({ month: '2026-10', employees, shiftTypes, specialDays: [sunday, closed] });
  assert.equal(proposal.assignments.filter((item) => item.date === closed.date).length, 0);
  assert.equal(proposal.warnings.filter((item) => item.date === closed.date).length, 0);
  assert.equal(resolveSpecialDay(closed.date, [sunday, closed]).id, closed.id);
  assert.equal(requiredEmployeesOnDate(shiftTypes[0], closed.date, [sunday, closed]), 0);
  assert.equal(resolveSpecialDay(closed.date, [sunday, { ...closed, active: false }]).id, sunday.id);
  assert.equal(proposal.specialDayRules.length, 2);
});

test('un tipo de turno omitido queda cerrado aunque tenga el mismo horario que otro habilitado', () => {
  const alias = { ...shiftTypes[0], id: 'alias', name: 'Otro turno de mañana' };
  const error = validateSpecialDayAssignment({ employeeId: employees[0].id, date: '2026-10-04', shiftTypeId: alias.id, startTime: '08:00', endTime: '12:00' }, [], [...shiftTypes, alias], employees, [sunday]);
  assert.match(error, /no está habilitado/);
});

test('los turnos manuales se consideran, se conservan y se advierte si exceden la regla', () => {
  const manualShifts = [{ employeeId: employees[0].id, date: '2026-10-04', startTime: '08:00', endTime: '12:00' }];
  let proposal = generateMonthProposal({ month: '2026-10', employees, shiftTypes, manualShifts, specialDays: [sunday] });
  const daily = proposal.assignments.filter((item) => item.date === '2026-10-04');
  assert.equal(daily.length, 3);
  assert.ok(daily.every((item) => item.employeeId !== employees[0].id));
  assert.equal(proposal.warnings.filter((item) => item.date === '2026-10-04').length, 0);
  manualShifts.push({ ...manualShifts[0], employeeId: employees[1].id }, { ...manualShifts[0], employeeId: employees[2].id });
  proposal = generateMonthProposal({ month: '2026-10', employees, shiftTypes, manualShifts, specialDays: [sunday] });
  assert.equal(manualShifts.length, 3);
  assert.ok(proposal.warnings.some((item) => item.date === '2026-10-04' && item.kind === 'special-day'));
});

test('las reglas respetan funciones, preferencias, descansos y permiten solo ajustar una dotación', () => {
  const people = [
    { id: 'a', name: 'A', shiftPreference: 'morning', jobFunction: 'Sector A' },
    { id: 'b', name: 'B', shiftPreference: 'afternoon', jobFunction: 'Sector A' },
    { id: 'c', name: 'C', shiftPreference: 'flexible', jobFunction: 'Sector B' },
    { id: 'd', name: 'D', shiftPreference: 'flexible', jobFunction: 'Sector A', restDays: ['sunday'] },
  ];
  const types = shiftTypes.slice(0, 2).map((item) => ({ ...item, jobFunction: 'Sector A' }));
  const proposal = generateMonthProposal({ month: '2026-10', employees: people, shiftTypes: types, specialDays: [sunday] });
  const daily = proposal.assignments.filter((item) => item.date === '2026-10-04');
  assert.deepEqual(daily.map((item) => item.employeeId).sort(), ['a', 'b']);
  assert.equal(proposal.warnings.filter((item) => item.date === '2026-10-04' && item.missing === 1).length, 2);
  const partial = { ...sunday, restOthers: false, requirements: [{ shiftTypeId: 'am', requiredEmployees: 1 }] };
  assert.equal(requiredEmployeesOnDate(types[0], '2026-10-04', [partial]), 1);
  assert.equal(requiredEmployeesOnDate(types[1], '2026-10-04', [partial]), 4);
  assert.equal(requiredEmployeesOnDate(types[0], '2026-10-04', [{ ...partial, active: false }]), 4);
});

test('CRUD de reglas y APIs de calendario conservan las propuestas y aplican los límites', async (context) => {
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
  assert.equal((await fetch(base + '/special-days')).status, 401);
  for (const employee of employees) await request('/employees', 'POST', employee);
  for (const type of shiftTypes) await request('/shiftTypes', 'POST', type);
  await request('/shiftTypes', 'POST', { ...shiftTypes[0], id: 'alias', name: 'Otro turno de mañana' });
  const created = await request('/special-days', 'POST', sunday);
  assert.equal(created.status, 201);
  const rule = created.body;
  assert.equal((await request(`/special-days/${rule.id}`)).body.requirements[0].requiredEmployees, 2);
  assert.equal((await request('/special-days', 'POST', { ...sunday, name: 'Duplicado' })).status, 409);
  const invalid = [
    { ...sunday, weekday: 'wrong' },
    { ...sunday, mode: 'date', date: '2026-02-31' },
    { ...sunday, weekday: 'monday', requirements: [{ shiftTypeId: 'missing', requiredEmployees: 2 }] },
    { ...sunday, weekday: 'monday', requirements: [{ shiftTypeId: 'am', requiredEmployees: -1 }] },
    { ...sunday, weekday: 'monday', requirements: [{ shiftTypeId: 'am', requiredEmployees: 1.5 }] },
    { ...sunday, weekday: 'monday', requirements: [{ shiftTypeId: 'am', requiredEmployees: 1 }, { shiftTypeId: 'am', requiredEmployees: 2 }] },
  ];
  for (const body of invalid) assert.equal((await request('/special-days', 'POST', body)).status, 400);
  const proposal = (await request('/schedules/generate', 'POST', { month: '2026-10' })).body;
  const daily = proposal.assignments.filter((item) => item.date === '2026-10-04');
  assert.equal(daily.length, 4);
  assert.equal(new Set(daily.map((item) => item.employeeId)).size, 4);
  const unused = employees.find((employee) => !daily.some((item) => item.employeeId === employee.id));
  const excess = await request('/shifts', 'POST', { employeeId: unused.id, date: '2026-10-04', startTime: '08:00', endTime: '12:00' });
  assert.equal(excess.status, 400);
  assert.match(excess.body.message, /dotación/);
  const amIndex = proposal.assignments.findIndex((item) => item.date === '2026-10-04' && item.shiftTypeId === 'am');
  assert.equal((await request(`/schedules/proposals/${proposal.id}/assignments/${amIndex}`, 'PUT', { shiftTypeId: 'pm' })).status, 409);
  assert.equal((await request(`/schedules/proposals/${proposal.id}/assignments/${amIndex}`, 'PUT', { shiftTypeId: 'full' })).status, 409);
  assert.equal((await request(`/schedules/proposals/${proposal.id}/assignments/${amIndex}`, 'PUT', { shiftTypeId: 'alias' })).status, 409);
  const updated = await request(`/special-days/${rule.id}`, 'PUT', { name: 'Domingo actualizado', requirements: [{ shiftTypeId: 'am', requiredEmployees: 1 }, { shiftTypeId: 'pm', requiredEmployees: 1 }] });
  assert.equal(updated.status, 200);
  const saved = (await request('/schedules/proposals')).body.find((item) => item.id === proposal.id);
  assert.equal(saved.specialDayRules[0].requirements[0].requiredEmployees, 2);
  assert.equal(saved.assignments.filter((item) => item.date === '2026-10-04').length, 4);
  const closed = await request('/special-days', 'POST', { name: 'Feriado', mode: 'date', date: '2026-10-11', requirements: [], restOthers: true });
  assert.equal(closed.status, 201);
  const regenerated = (await request('/schedules/generate', 'POST', { month: '2026-10' })).body;
  assert.equal(regenerated.assignments.filter((item) => item.date === '2026-10-11').length, 0);
  assert.equal(regenerated.assignments.filter((item) => item.date === '2026-10-04').length, 2);
  assert.equal((await request('/shifts', 'POST', { employeeId: unused.id, date: '2026-10-11', startTime: '08:00', endTime: '12:00' })).status, 400);
  assert.equal((await request('/shiftTypes/am', 'DELETE')).status, 409);
  assert.equal((await request(`/special-days/${rule.id}`, 'PUT', { active: false })).body.active, false);
  const ordinary = (await request('/schedules/generate', 'POST', { month: '2026-11' })).body;
  assert.equal(ordinary.assignments.filter((item) => item.date === '2026-11-01' && item.shiftTypeId === 'am').length, 4);
  assert.equal((await request(`/special-days/${rule.id}`, 'DELETE')).status, 200);
  assert.equal((await request('/shiftTypes/am', 'DELETE')).status, 200);
  assert.equal((await request(`/special-days/${rule.id}`)).status, 404);
  assert.equal((await request(`/special-days/${closed.body.id}`, 'DELETE')).status, 200);
  assert.equal((await request('/special-days')).body.length, 0);
});

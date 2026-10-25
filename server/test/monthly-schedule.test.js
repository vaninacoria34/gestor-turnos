const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateMonthProposal, generateWeekProposal, getMonthDates, getWeekDates, matchesFunction } = require('../src/lib/schedule');

test('el mes incluye todos y solo sus días, incluidos febrero y cambios de año', () => {
  for (const [month, length] of [['2024-02', 29], ['2026-02', 28], ['2026-04', 30], ['2026-12', 31], ['2027-01', 31]]) {
    const dates = getMonthDates(month);
    assert.equal(dates.length, length);
    assert.equal(dates[0], `${month}-01`);
    assert.equal(dates.at(-1), `${month}-${length}`);
    assert.equal(new Set(dates).size, length);
  }
  assert.throws(() => getMonthDates('2026-13'));
  assert.throws(() => getMonthDates('2026-2'));
  assert.equal(getWeekDates('2026-10-11')[0], '2026-10-05');
});

const employees = [
  { id: 'kitchen', name: 'Vanina', jobFunction: 'Cocina / Elaboración', shiftPreference: 'morning', restDays: ['monday'] },
  { id: 'service', name: 'Ana', jobFunction: 'Atención al público', shiftPreference: 'afternoon' },
];
const shiftTypes = [
  { id: 'k-am', name: 'Mañana cocina', jobFunction: 'Cocina / Elaboración', startTime: '08:00', endTime: '12:00', requiredEmployees: 1 },
  { id: 's-pm', name: 'Tarde atención', jobFunction: 'Atención al público', startTime: '14:00', endTime: '18:00', requiredEmployees: 1 },
];

test('la generación mensual respeta funciones, horarios y descansos en las cinco semanas', () => {
  const proposal = generateMonthProposal({ month: '2026-10', employees, shiftTypes });
  assert.equal(proposal.period, 'month');
  assert.equal(proposal.month, '2026-10');
  assert.equal(proposal.dates.length, 31);
  assert.equal(proposal.assignments.filter((item) => item.employeeId === 'kitchen').length, 27);
  assert.equal(proposal.assignments.filter((item) => item.employeeId === 'service').length, 31);
  assert.equal(proposal.warnings.length, 4);
  assert.ok(proposal.assignments.every((item) => matchesFunction(employees.find((employee) => employee.id === item.employeeId), shiftTypes.find((type) => type.id === item.shiftTypeId))));
  assert.ok(proposal.assignments.every((item) => item.jobFunction && item.date.startsWith('2026-10')));
  assert.ok(proposal.warnings.every((item) => item.jobFunction === 'Cocina / Elaboración'));
});

test('un empleado con varias funciones puede cubrir turnos de cada una', () => {
  const crossTrained = {
    id: 'cross-trained',
    name: 'Alex',
    jobFunctionIds: ['kitchen-id', 'service-id'],
    jobFunctions: ['Cocina / Elaboración', 'Atención al público'],
  };
  const proposal = generateMonthProposal({
    month: '2026-10',
    employees: [crossTrained],
    shiftTypes: [
      { ...shiftTypes[0], id: 'kitchen-shift', jobFunctionId: 'kitchen-id' },
      { ...shiftTypes[1], id: 'service-shift', jobFunctionId: 'service-id' },
    ],
  });

  assert.ok(proposal.assignments.some((item) => item.shiftTypeId === 'kitchen-shift' && item.jobFunctionId === 'kitchen-id'));
  assert.ok(proposal.assignments.some((item) => item.shiftTypeId === 'service-shift' && item.jobFunctionId === 'service-id'));
});

test('prioriza turnos fijos semanales y conserva el descanso configurado', () => {
  const kitchenEmployee = {
    id: 'vanina',
    name: 'Vanina',
    jobFunctionIds: ['kitchen-id'],
    jobFunctions: ['Cocina'],
    restDays: ['sunday'],
    fixedShiftTypeIdsByDay: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((day) => [day, 'kitchen-shift'])),
  };
  const proposal = generateMonthProposal({
    month: '2026-10',
    employees: [kitchenEmployee],
    shiftTypes: [{ id: 'kitchen-shift', name: 'Cocina mañana', jobFunctionId: 'kitchen-id', jobFunction: 'Cocina', startTime: '08:00', endTime: '16:00', requiredEmployees: 1 }],
  });
  const assignments = proposal.assignments.filter((item) => item.employeeId === kitchenEmployee.id);
  assert.equal(assignments.length, 27);
  assert.ok(assignments.every((item) => item.notes.startsWith('Turno fijo automático')));
  assert.ok(assignments.every((item) => new Date(`${item.date}T12:00:00Z`).getUTCDay() !== 0));
});

test('no cubre sectores distintos ni turnos parciales como si fueran puestos configurados', () => {
  const proposal = generateMonthProposal({
    month: '2026-10',
    employees: [
      { id: 'service', jobFunctionId: 'service-id', restDays: ['thursday'] },
      { id: 'kitchen', jobFunctionId: 'kitchen-id' },
    ],
    shiftTypes: [
      { id: 'service-shift', name: 'Tarde', jobFunctionId: 'service-id', jobFunction: 'Atención', startTime: '14:00', endTime: '22:00', requiredEmployees: 2 },
    ],
    manualShifts: [
      { id: 'wrong-sector', employeeId: 'kitchen', date: '2026-10-01', startTime: '14:00', endTime: '22:00' },
      { id: 'partial', employeeId: 'service', date: '2026-10-02', startTime: '14:00', endTime: '18:00' },
    ],
  });
  const wrongSectorWarning = proposal.warnings.find((item) => item.date === '2026-10-01');
  const partialWarning = proposal.warnings.find((item) => item.date === '2026-10-02');
  assert.equal(wrongSectorWarning.missing, 2);
  assert.equal(partialWarning.missing, 2);
  assert.ok(wrongSectorWarning.message.includes('14:00–22:00'));
});

test('verifica una semana con horario fijo, descansos, sectores y faltantes reales', () => {
  const employees = [
    { id: 'vanina', name: 'Vanina', jobFunctionIds: ['kitchen'], restDays: ['sunday'], fixedShiftTypeIdsByDay: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((day) => [day, 'kitchen-am'])) },
    { id: 'brisa', name: 'Brisa', jobFunctionIds: ['service'], restDays: ['monday'] },
    { id: 'lautaro', name: 'Lautaro', jobFunctionIds: ['service', 'kitchen'], restDays: ['tuesday'] },
    { id: 'denis', name: 'Denis', jobFunctionIds: ['service', 'kitchen'], restDays: ['wednesday'] },
    { id: 'santino', name: 'Santino', jobFunctionIds: ['service'], restDays: ['thursday', 'friday'] },
    { id: 'caro', name: 'Caro', jobFunctionIds: ['service'], restDays: ['friday'] },
    { id: 'lujan', name: 'Luján', jobFunctionIds: ['service', 'kitchen'], restDays: ['sunday'], allowedDoubleShifts: true },
  ];
  const shiftTypes = [
    { id: 'service-pm', name: 'Tarde', jobFunctionId: 'service', jobFunction: 'Atención al público', startTime: '14:00', endTime: '22:00', requiredEmployees: 2 },
    { id: 'service-am', name: 'Mañana', jobFunctionId: 'service', jobFunction: 'Atención al público', startTime: '08:00', endTime: '16:00', requiredEmployees: 2 },
    { id: 'kitchen-am', name: 'Mañana', jobFunctionId: 'kitchen', jobFunction: 'Cocina y Elaboración', startTime: '08:00', endTime: '16:00', requiredEmployees: 2 },
  ];
  const sunday = { id: 'sunday', name: 'Domingo', mode: 'weekday', weekday: 'sunday', active: true, restOthers: true, requirements: [{ shiftTypeId: 'service-am', requiredEmployees: 2 }, { shiftTypeId: 'service-pm', requiredEmployees: 2 }] };
  const proposal = generateWeekProposal({ employees, shiftTypes, specialDays: [sunday], weekStart: '2026-10-12' });

  const vaninaAssignments = proposal.assignments.filter((item) => item.employeeId === 'vanina');
  assert.deepEqual(vaninaAssignments.map((item) => item.date), proposal.dates.slice(0, 6));
  assert.ok(vaninaAssignments.every((item) => item.shiftTypeId === 'kitchen-am'));
  assert.ok(proposal.assignments.some((item) => item.employeeId === 'lujan' && item.shiftTypeId === 'service-pm'));
  for (const date of proposal.dates) {
    const daily = proposal.assignments.filter((item) => item.date === date);
    for (const shiftTypeId of ['service-am', 'service-pm']) {
      assert.equal(daily.filter((item) => item.shiftTypeId === shiftTypeId).length, 2, `${date} ${shiftTypeId}`);
    }
    for (const [index, assignment] of daily.entries()) {
      assert.ok(daily.slice(index + 1).every((other) => (
        other.employeeId !== assignment.employeeId
        || assignment.endTime <= other.startTime
        || other.endTime <= assignment.startTime
      )), `${assignment.employeeName} has overlapping turns on ${date}`);
    }
  }
  const fridayKitchenWarning = proposal.warnings.find((item) => item.date === '2026-10-16' && item.shiftTypeId === 'kitchen-am');
  assert.equal(fridayKitchenWarning.missing, 1);
  assert.match(fridayKitchenWarning.message, /TURNO SIN CUBRIR.*Cocina y Elaboración.*08:00–16:00/);
});

test('un sector sin personal no toma empleados de otro sector', () => {
  const proposal = generateMonthProposal({ month: '2026-02', employees: [employees[1]], shiftTypes: [shiftTypes[0]] });
  assert.equal(proposal.assignments.length, 0);
  assert.equal(proposal.warnings.length, 28);
  assert.equal(matchesFunction({ jobFunction: ' cocina / elaboración ' }, shiftTypes[0]), true);
});

test('los turnos manuales cubren su sector sin duplicar puestos', () => {
  const manualShifts = [{ employeeId: 'kitchen', date: '2026-10-01', startTime: '08:00', endTime: '12:00' }];
  const proposal = generateMonthProposal({ month: '2026-10', employees, shiftTypes, manualShifts });
  assert.equal(proposal.assignments.filter((item) => item.employeeId === 'kitchen' && item.date === '2026-10-01').length, 0);
  assert.equal(proposal.warnings.filter((item) => item.date === '2026-10-01').length, 0);
  const wrongSector = generateMonthProposal({ month: '2026-10', employees: [employees[1]], shiftTypes: [shiftTypes[0]], manualShifts: [{ ...manualShifts[0], employeeId: 'service' }] });
  assert.equal(wrongSector.warnings.length, 31);
});

test('la rotación de domingos se distribuye a lo largo del mes', () => {
  const proposal = generateMonthProposal({ month: '2026-10', employees: [{ id: 'a' }, { id: 'b' }], shiftTypes: [{ ...shiftTypes[0], jobFunction: '' }] });
  const sundays = proposal.assignments.filter((item) => new Date(`${item.date}T12:00:00Z`).getUTCDay() === 0);
  assert.equal(sundays.length, 4);
  assert.equal(sundays.filter((item) => item.employeeId === 'a').length, 2);
  assert.equal(sundays.filter((item) => item.employeeId === 'b').length, 2);
});

test('la API mensual guarda sectores, confirma y edita sin mezclar funciones', async (context) => {
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
  const employee = (await request('/employees', 'POST', employees[0])).body;
  assert.equal(employee.jobFunction, 'Cocina / Elaboración');
  assert.equal((await request('/employees', 'POST', { name: 'Bad', jobFunction: 123 })).status, 400);
  const kitchen = (await request('/shiftTypes', 'POST', shiftTypes[0])).body;
  const service = (await request('/shiftTypes', 'POST', shiftTypes[1])).body;
  assert.equal((await request('/schedules/generate', 'POST', { period: 'month', month: '2026-13' })).status, 400);
  const response = await request('/schedules/generate', 'POST', { period: 'month', month: '2026-10' });
  assert.equal(response.status, 201);
  const proposal = response.body;
  assert.equal(proposal.dates.length, 31);
  assert.equal(proposal.assignments.length, 27);
  assert.ok(proposal.assignments.every((item) => item.jobFunction === employee.jobFunction));
  assert.equal((await request(`/schedules/proposals/${proposal.id}/assignments/0`, 'PUT', { shiftTypeId: service.id })).status, 400);
  await request('/schedules/confirm', 'POST', { proposalId: proposal.id });
  assert.equal((await request('/schedules/proposals')).body[0].status, 'confirmed');
  const edited = await request(`/schedules/proposals/${proposal.id}/assignments/0`, 'PUT', { shiftTypeId: kitchen.id });
  assert.equal(edited.body.status, 'proposed');
  assert.equal(edited.body.assignments.length, 27);
  assert.equal((await request('/shifts', 'POST', { employeeId: employee.id, shiftTypeId: service.id, date: '2026-10-01', startTime: '14:00', endTime: '18:00' })).status, 400);
  await request(`/employees/${employee.id}`, 'PUT', { allowedDoubleShifts: true });
  assert.equal((await request('/shifts', 'POST', { employeeId: employee.id, date: '2026-10-06', startTime: '15:00', endTime: '18:00' })).status, 201);
  const coverage = (await request('/coverage?month=2026-10&jobFunction=Cocina%20%2F%20Elaboraci%C3%B3n')).body.coverage;
  assert.ok(coverage.some((item) => item.date === '2026-10-06'));
  assert.ok(coverage.every((item) => item.date.startsWith('2026-10') && item.employees.every((person) => person.jobFunction === employee.jobFunction)));
  assert.equal((await request('/coverage?month=2026-11')).body.coverage.length, 0);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateWeekProposal, generateMonthProposal, buildCoverageWarnings, selectProposal, effectiveAssignments, dailyRule, hoursWorked } = require('../src/lib/schedule');

const night = { id: 'night', name: 'Tarde-Noche', jobFunctionId: 'service', startTime: '18:00', endTime: '23:00', requiredEmployees: 1 };
const saturday = { id: 'saturday', name: 'Sábado especial', jobFunctionId: 'service', startTime: '14:00', endTime: '18:00', requiredEmployees: 1 };
const lautaro = {
  id: 'lautaro', name: 'Lautaro', jobFunctionIds: ['service'], preferredShiftTypeIds: [night.id, saturday.id],
  weeklySchedule: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'sunday'].map((day) => [day, { mode: 'rest' }])),
};
lautaro.weeklySchedule.thursday = { mode: 'fixed', shiftTypeId: night.id, startTime: '18:30', endTime: '22:30', jobFunctionId: 'service' };
lautaro.weeklySchedule.friday = { mode: 'fixed', shiftTypeId: night.id };
lautaro.weeklySchedule.saturday = { mode: 'fixed', shiftTypeId: saturday.id };

test('Lautaro tiene jueves/viernes Tarde-Noche, sábado distinto y horas individuales', () => {
  const p = generateWeekProposal({ weekStart: '2026-10-19', employees: [lautaro], shiftTypes: [night, saturday] });
  assert.deepEqual(p.assignments.map((a) => [a.date, a.shiftTypeId, a.startTime, a.endTime]), [
    ['2026-10-22', 'night', '18:30', '22:30'], ['2026-10-23', 'night', '18:00', '23:00'], ['2026-10-24', 'saturday', '14:00', '18:00'],
  ]);
  assert.ok(p.warnings.some((w) => w.date === '2026-10-22' && w.shiftTypeId === night.id));
});

test('la excepción sólo afecta su semana y puede habilitar un descanso habitual', () => {
  const employee = { ...lautaro, weeklyOverrides: { '2026-10-19': { friday: { mode: 'rest' }, monday: { mode: 'fixed', shiftTypeId: night.id } } } };
  const p = generateMonthProposal({ month: '2026-10', employees: [employee], shiftTypes: [night, saturday] });
  assert.ok(p.assignments.some((a) => a.date === '2026-10-19'));
  assert.ok(!p.assignments.some((a) => a.date === '2026-10-23'));
  assert.ok(p.assignments.some((a) => a.date === '2026-10-30'));
  assert.equal(dailyRule(employee, '2026-10-26').mode, 'rest');
});

test('la disponibilidad automática acota horas y sector; los tipos se eligen por ID', () => {
  const employee = { id: 'a', jobFunctionIds: ['service', 'kitchen'], preferredShiftTypeIds: ['night'], weeklySchedule: { monday: { mode: 'auto', startTime: '19:00', endTime: '23:00', jobFunctionId: 'service' } } };
  const p = generateWeekProposal({ weekStart: '2026-10-19', employees: [employee], shiftTypes: [night, saturday, { ...night, id: 'k', jobFunctionId: 'kitchen' }] });
  assert.ok(!p.assignments.some((a) => a.date === '2026-10-19'));
  assert.ok(p.assignments.every((a) => a.shiftTypeId === 'night'));
});

test('un turno manual sin tipo sólo cubre su sector efectivo, incluso con empleados multisector', () => {
  const employee = { id: 'multi', jobFunctionIds: ['service', 'kitchen'] };
  const assignments = [{ employeeId: 'multi', date: '2026-10-19', jobFunctionId: 'kitchen', startTime: '18:00', endTime: '23:00' }];
  assert.equal(buildCoverageWarnings(assignments, ['2026-10-19'], [night], [employee])[0].missing, 1);
  assert.equal(buildCoverageWarnings([{ ...assignments[0], jobFunctionId: 'service' }], ['2026-10-19'], [night], [employee]).length, 0);
  assert.equal(buildCoverageWarnings([{ ...assignments[0], jobFunctionId: '' }], ['2026-10-19'], [night], [employee])[0].missing, 1);
});

test('reserva la persona multisector para cocina si atención tiene personal exclusivo', () => {
  const employees = [{ id: 'multi', jobFunctionIds: ['service', 'kitchen'] }, { id: 'a', jobFunctionIds: ['service'] }, { id: 'b', jobFunctionIds: ['service'] }];
  const shiftTypes = [{ ...night, requiredEmployees: 2 }, { ...night, id: 'k', jobFunctionId: 'kitchen' }];
  const p = generateWeekProposal({ weekStart: '2026-10-19', employees, shiftTypes });
  assert.equal(p.warnings.length, 0);
  assert.ok(p.assignments.filter((a) => a.shiftTypeId === 'k').every((a) => a.employeeId === 'multi'));
});

test('el máximo semanal incluye propuestas del mes vecino y conserva ediciones manuales', () => {
  const employee = { id: 'a', jobFunctionIds: ['service'], maxHoursPerWeek: 10 };
  const before = [{ employeeId: 'a', date: '2026-10-30', shiftTypeId: night.id, startTime: '18:00', endTime: '23:00' }];
  const locked = [{ ...before[0], date: '2026-11-01', startTime: '19:00', endTime: '22:00', manuallyEdited: true }];
  const p = generateMonthProposal({ month: '2026-11', employees: [employee], shiftTypes: [night], contextAssignments: before, lockedAssignments: locked });
  assert.equal(p.assignments.filter((a) => a.date === '2026-11-01').length, 1);
  assert.equal(p.assignments.find((a) => a.date === '2026-11-01').startTime, '19:00');
  for (let day = 2; day <= 30; day += 7) {
    const slice = p.assignments.filter((a) => Number(a.date.slice(-2)) >= day && Number(a.date.slice(-2)) < day + 7);
    assert.ok(slice.reduce((sum, a) => sum + hoursWorked(a.startTime, a.endTime), 0) <= 10);
  }
});

test('la propuesta más reciente gobierna cada fecha aunque sea semanal y exista un mes anterior', () => {
  const older = { id: 'm', month: '2026-10', dates: ['2026-10-19', '2026-10-20'], createdAt: '2026-10-01', assignments: [{ date: '2026-10-19', employeeId: 'old' }, { date: '2026-10-20', employeeId: 'old' }] };
  const recent = { id: 'w', dates: ['2026-10-19'], createdAt: '2026-10-02', assignments: [{ date: '2026-10-19', employeeId: 'new' }] };
  assert.equal(selectProposal([older, recent], '2026-10-19').id, 'w');
  assert.deepEqual(effectiveAssignments([older, recent]).map((a) => a.employeeId), ['new', 'old']);
});

test('los turnos fijos no exceden una regla dominical y un sector requiere habilitación explícita', () => {
  const employees = ['a', 'b', 'c'].map((id) => ({ id, name: id, jobFunctionIds: ['service'], weeklySchedule: { sunday: { mode: 'fixed', shiftTypeId: night.id } } }));
  const specialDays = [{ id: 'sun', name: 'Domingo', mode: 'weekday', weekday: 'sunday', restOthers: true, requirements: [{ shiftTypeId: night.id, requiredEmployees: 1 }] }];
  const p = generateWeekProposal({ weekStart: '2026-10-19', employees, shiftTypes: [night], specialDays });
  assert.equal(p.assignments.filter((a) => a.date === '2026-10-25').length, 1);
  assert.ok(p.warnings.some((w) => w.kind === 'fixed-shift' && /dotación/.test(w.message)));
  const unqualified = generateWeekProposal({ weekStart: '2026-10-19', employees: [{ id: 'none' }], shiftTypes: [night] });
  assert.equal(unqualified.assignments.length, 0);
});

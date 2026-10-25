const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const moduleUrl = (file) => pathToFileURL(path.resolve(__dirname, '../../web/src/lib', file)).href;
const functions = import(moduleUrl('calendar-export.js'));
const dates = ['2026-10-22', '2026-10-23', '2026-10-24'];
const employee = { id: 'l', name: 'Lautaro', active: true, jobFunctionIds: ['service', 'kitchen'], jobFunctions: ['Atención', 'Cocina'], weeklySchedule: { saturday: { mode: 'rest' } } };
const night = { id: 'night', name: 'Tarde-Noche', jobFunctionId: 'service', jobFunction: 'Atención', startTime: '18:00', endTime: '23:00', active: true, requiredEmployees: 1 };
const proposal = { id: 'new', dates, status: 'proposed', createdAt: '2026-10-20', specialDayRules: [] };
const shift = { employeeId: 'l', employeeName: 'Lautaro', date: dates[0], shiftTypeId: 'night', shiftTypeName: 'Tarde-Noche', jobFunctionId: 'service', jobFunction: 'Atención', startTime: '19:00', endTime: '22:00', source: 'proposal', proposalId: 'new', proposalStatus: 'proposed', manuallyEdited: true };

test('exporta la edición vigente sin propuestas reemplazadas ni fechas fuera de vista', async () => {
  const { createCalendarSnapshot } = await functions;
  const old = { ...proposal, id: 'old', createdAt: '2026-10-01', status: 'confirmed' };
  const snapshot = createCalendarSnapshot({ dates, employees: [employee], assignments: [{ ...shift, proposalId: 'old', startTime: '08:00' }, shift, { ...shift, date: '2026-11-01' }], proposals: [old, proposal], shiftTypes: [night] });
  assert.equal(snapshot.assignmentCount, 1);
  assert.equal(snapshot.status, 'PROPUESTA SIN CONFIRMAR');
  assert.deepEqual(snapshot.rows[0].cells[0].shifts.map((a) => [a.startTime, a.endTime, a.manuallyEdited]), [['19:00', '22:00', true]]);
  assert.equal(snapshot.rows[0].cells[2].emptyLabel, 'Descanso');
  assert.ok(snapshot.warnings.some((w) => w.date === dates[0] && /faltan 1/.test(w.message)), 'Una franja parcial no es cobertura completa');
});

test('el filtro de atención excluye cocina de una persona multisector', async () => {
  const { createCalendarSnapshot, calendarCsv } = await functions;
  const kitchen = { ...shift, date: dates[1], source: 'manual', shiftTypeName: 'Elaboración', jobFunctionId: 'kitchen', jobFunction: 'Cocina', notes: 'Sólo cocina' };
  const snapshot = createCalendarSnapshot({ dates, employees: [employee], assignments: [shift, kitchen], proposals: [proposal], sector: 'Atención', sectorId: 'service' });
  assert.equal(snapshot.assignmentCount, 1);
  assert.equal(snapshot.rows[0].cells[1].emptyLabel, 'Asignado a otro sector');
  assert.ok(!calendarCsv(snapshot).includes('Sólo cocina'));
  assert.ok(!calendarCsv(snapshot).includes('Elaboración'));
});

test('el CSV conserva acentos, comillas, ediciones y neutraliza fórmulas de planilla', async () => {
  const { createCalendarSnapshot, calendarCsv, calendarFilename } = await functions;
  const snapshot = createCalendarSnapshot({ dates, employees: [{ ...employee, name: '=HYPERLINK("x")' }], assignments: [{ ...shift, source: 'manual', notes: '@SUM(1;2)\nTexto "con comillas"' }], proposals: [{ ...proposal, status: 'confirmed' }], sector: 'Atención', sectorId: 'service' });
  const csv = calendarCsv(snapshot);
  assert.equal(csv[0], '\uFEFF');
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(csv.includes('"\'@SUM(1;2)\nTexto ""con comillas"""'));
  assert.ok(csv.includes('"Atención"') && csv.includes('"19:00"') && csv.includes('"Manual"') && csv.includes('"Sí"'));
  assert.equal(calendarFilename(snapshot, 'pdf'), 'calendario-2026-10-22-al-2026-10-24-atencion.pdf');
});

test('conserva excepciones, descansos, inactivos y personas del historial', async () => {
  const { createCalendarSnapshot } = await functions;
  const person = { ...employee, restDays: ['thursday'], weeklyOverrides: { '2026-10-19': { thursday: { mode: 'auto' } } } };
  const snapshot = createCalendarSnapshot({ dates, employees: [person, { id: 'inactive', name: 'Ana', active: false }], assignments: [{ ...shift, employeeId: 'legacy', employeeName: 'Persona histórica', source: 'manual' }], proposals: [proposal] });
  assert.equal(snapshot.rows.find((r) => r.id === 'l').cells[0].emptyLabel, 'Sin asignación');
  assert.equal(snapshot.rows.find((r) => r.id === 'inactive').employeeStatus, 'Inactivo');
  assert.equal(snapshot.rows.find((r) => r.id === 'legacy').name, 'Persona histórica');
});

test('bloquea períodos vacíos y organiza el mes en semanas sin inventar fechas', async () => {
  const { createCalendarSnapshot, groupCalendarWeeks } = await functions;
  assert.equal(createCalendarSnapshot({ dates, employees: [employee] }).canExport, false);
  assert.equal(createCalendarSnapshot({ dates, employees: [employee], proposals: [proposal] }).canExport, true);
  const month = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  const weeks = groupCalendarWeeks(month);
  assert.deepEqual(weeks.flat(), month);
  assert.equal(weeks[0].length, 4);
  assert.ok(weeks.every((week) => week.length <= 7));
});

test('prepara un mensaje WhatsApp con el período, sector y turnos visibles', async () => {
  const { calendarWhatsAppMessage, createCalendarSnapshot, displayDate } = await functions;
  const snapshot = createCalendarSnapshot({
    dates,
    employees: [employee],
    assignments: [shift, { ...shift, date: dates[1], startTime: '20:00', endTime: '22:00', source: 'manual', jobFunctionId: 'kitchen', jobFunction: 'Cocina', shiftTypeName: 'Cierre' }],
    proposals: [proposal],
    sector: 'Atención',
    sectorId: 'service',
  });

  const message = calendarWhatsAppMessage(snapshot);
  assert.ok(message.includes(snapshot.periodLabel));
  assert.ok(message.includes('Sector: Atención'));
  assert.ok(message.includes('PROPUESTA SIN CONFIRMAR'));
  assert.ok(message.includes('19:00–22:00 · Lautaro · Tarde-Noche · Atención'));
  assert.ok(!message.includes('20:00–22:00'), 'No incluye otros sectores excluidos del filtro');
  assert.ok(message.includes(`*${displayDate(dates[0], true)}*`));
});

test('el PDF pagina equipos largos y advertencias sin usar una captura de pantalla', async () => {
  const { createCalendarSnapshot } = await functions;
  const { createCalendarPdf } = await import(moduleUrl('calendar-pdf.js'));
  const team = Array.from({ length: 22 }, (_, i) => ({ ...employee, id: `e${i}`, name: `Empleado ${i}` }));
  const snapshot = createCalendarSnapshot({ dates, employees: team, assignments: [shift], proposals: [proposal], warnings: [{ date: dates[0], message: 'Revisar cobertura de prueba' }] });
  const blob = await createCalendarPdf(snapshot, new Date('2026-10-24T15:00:00Z'));
  assert.equal(blob.type, 'application/pdf');
  const data = Buffer.from(await blob.arrayBuffer());
  assert.equal(data.subarray(0, 5).toString(), '%PDF-');
  assert.ok((data.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length >= 3);
  assert.ok(data.toString('latin1').trimEnd().endsWith('%%EOF'));
});

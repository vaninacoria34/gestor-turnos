const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const normalize = (value) => String(value || '').trim().toLocaleLowerCase('es-AR');
const names = (employee) => employee.jobFunctions?.length ? employee.jobFunctions : employee.jobFunction ? [employee.jobFunction] : [];
const monday = (date) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
};
export const displayDate = (date, weekday = false) => new Date(`${date}T12:00:00Z`).toLocaleDateString('es-AR', { timeZone: 'UTC', ...(weekday ? { weekday: 'short' } : {}), day: '2-digit', month: '2-digit', year: 'numeric' });

function proposalForDate(proposals, date) {
  return [...proposals].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || String(b.id || '').localeCompare(String(a.id || '')))
    .find((p) => p.dates?.includes(date) || p.month === date.slice(0, 7));
}

export function createCalendarSnapshot({ dates, employees = [], assignments = [], proposals = [], shiftTypes = [], specialDays = [], sector = '', sectorId = '', warnings = [] }) {
  const orderedDates = [...new Set(dates)].sort();
  if (!orderedDates.length) throw new Error('Elegí un período para exportar.');
  const dateSet = new Set(orderedDates);
  const planned = new Map(orderedDates.map((date) => [date, proposalForDate(proposals, date)]));
  const employeesById = new Map(employees.map((e) => [e.id, e]));
  const typesById = new Map(shiftTypes.map((t) => [t.id, t]));
  // Use the visible effective assignments, not the history of replaced proposals.
  const period = assignments.filter((a) => dateSet.has(a.date) && (a.source !== 'proposal' || !a.proposalId || planned.get(a.date)?.id === a.proposalId)).map((assignment) => {
    const type = typesById.get(assignment.shiftTypeId);
    const employee = employeesById.get(assignment.employeeId);
    return { ...assignment, proposalStatus: assignment.source === 'proposal' ? planned.get(assignment.date)?.status || assignment.proposalStatus : assignment.proposalStatus, employeeName: employee?.name || assignment.employeeName || 'Empleado sin registro', shiftTypeName: assignment.shiftTypeName || type?.name || 'Turno manual', jobFunction: assignment.jobFunction || type?.jobFunction || '', jobFunctionId: assignment.jobFunctionId || type?.jobFunctionId || '' };
  });
  const visible = period.filter((a) => !sector || (sectorId && a.jobFunctionId ? a.jobFunctionId === sectorId : normalize(a.jobFunction) === normalize(sector)));
  const visibleByDate = new Map();
  const visibleByEmployeeDate = new Map();
  const periodKeys = new Set(period.map((a) => JSON.stringify([a.employeeId, a.date])));
  for (const assignment of visible) {
    if (!visibleByDate.has(assignment.date)) visibleByDate.set(assignment.date, []);
    visibleByDate.get(assignment.date).push(assignment);
    const key = JSON.stringify([assignment.employeeId, assignment.date]);
    if (!visibleByEmployeeDate.has(key)) visibleByEmployeeDate.set(key, []);
    visibleByEmployeeDate.get(key).push(assignment);
  }
  const team = employees.filter((e) => !sector || (sectorId && e.jobFunctionIds?.length ? e.jobFunctionIds.includes(sectorId) : names(e).some((name) => normalize(name) === normalize(sector))));
  const rowsById = new Map(team.map((employee) => [employee.id, { ...employee }]));
  for (const assignment of visible) {
    if (!rowsById.has(assignment.employeeId)) rowsById.set(assignment.employeeId, { id: assignment.employeeId, name: assignment.employeeName, jobFunctions: [assignment.jobFunction].filter(Boolean), archived: true });
  }
  const rows = [...rowsById.values()].sort((a, b) => names(a).join(', ').localeCompare(names(b).join(', '), 'es') || a.name.localeCompare(b.name, 'es')).map((employee) => ({
    id: employee.id,
    name: employee.name,
    employeeStatus: employee.archived ? 'No figura en el equipo actual' : employee.active === false ? 'Inactivo' : 'Activo',
    sectors: names(employee).join(', ') || 'Sin sector',
    cells: orderedDates.map((date) => {
      const key = JSON.stringify([employee.id, date]);
      const shifts = [...visibleByEmployeeDate.get(key) || []].sort((a, b) => a.startTime.localeCompare(b.startTime));
      const day = DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
      const rule = employee.weeklyOverrides?.[monday(date)]?.[day] ?? employee.weeklySchedule?.[day];
      const rest = rule ? rule.mode === 'rest' : (employee.restDays || []).includes(day);
      const saved = planned.get(date);
      const rules = saved ? saved.specialDayRules || [] : specialDays;
      const special = rules.find((r) => r.active !== false && r.mode === 'date' && r.date === date) || rules.find((r) => r.active !== false && r.mode === 'weekday' && r.weekday === day);
      const otherSector = sector && periodKeys.has(key) && !shifts.length;
      const emptyLabel = rest ? 'Descanso' : otherSector ? 'Asignado a otro sector' : employee.active === false ? 'Inactivo' : special?.restOthers && saved ? 'Descanso según regla' : saved ? 'Sin asignación' : 'Sin planificar';
      return { date, shifts, rest, emptyLabel };
    }),
  }));
  const hasPlan = [...planned.values()].some(Boolean);
  const draft = [...planned.values()].some((p) => p && p.status !== 'confirmed');
  const partial = [...planned.values()].some((p) => !p);
  const status = draft ? 'PROPUESTA SIN CONFIRMAR' : hasPlan ? partial ? 'PLANIFICACIÓN PARCIAL' : 'PROPUESTAS CONFIRMADAS' : 'ASIGNACIONES MANUALES';
  const warningCandidates = [...warnings];
  for (const date of orderedDates) {
    const saved = planned.get(date);
    warningCandidates.push(...(saved?.warnings || []).filter((w) => w.date === date && !('missing' in w)));
    const rules = saved ? saved.specialDayRules || [] : specialDays;
    const day = DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
    const special = rules.find((r) => r.active !== false && r.mode === 'date' && r.date === date) || rules.find((r) => r.active !== false && r.mode === 'weekday' && r.weekday === day);
    for (const type of shiftTypes.filter((t) => t.active !== false && (!sector || (sectorId && t.jobFunctionId ? t.jobFunctionId === sectorId : normalize(t.jobFunction) === normalize(sector))))) {
      const rule = special?.requirements?.find((r) => r.shiftTypeId === type.id);
      const required = rule ? Number(rule.requiredEmployees) : special?.restOthers ? 0 : Number(type.requiredEmployees || 1);
      const count = new Set((visibleByDate.get(date) || []).filter((a) => {
        const employee = employeesById.get(a.employeeId);
        if (!employee || employee.active === false || employee.deleted) return false;
        if (a.date !== date || a.startTime > type.startTime || a.endTime < type.endTime || (a.shiftTypeId && a.shiftTypeId !== type.id)) return false;
        if (type.jobFunctionId && (!(employee.jobFunctionIds || [employee.jobFunctionId]).includes(type.jobFunctionId) || a.jobFunctionId !== type.jobFunctionId)) return false;
        return !type.jobFunction || normalize(a.jobFunction) === normalize(type.jobFunction);
      }).map((a) => a.employeeId)).size;
      if (count < required) warningCandidates.push({ date, message: `${type.jobFunction || 'Sin sector'} · ${type.name} (${type.startTime}-${type.endTime}): faltan ${required - count} empleado(s).` });
    }
  }
  const exportWarnings = [...new Map(warningCandidates.filter((w) => dateSet.has(w.date) && (!sector || !w.jobFunction || normalize(w.jobFunction) === normalize(sector))).map((w) => [`${w.date}|${w.message}`, { date: w.date, message: w.message }])).values()].sort((a, b) => a.date.localeCompare(b.date));
  return { dates: orderedDates, rows, status, sector: sector || 'Todos los sectores', warnings: exportWarnings, canExport: hasPlan || visible.length > 0, assignmentCount: visible.length, hasManualShifts: visible.some((a) => a.source === 'manual'), periodLabel: `${displayDate(orderedDates[0])} al ${displayDate(orderedDates.at(-1))}` };
}

export function assignmentStatus(assignment) {
  return assignment.source === 'manual' ? 'Manual' : assignment.proposalStatus === 'confirmed' ? 'Confirmado' : 'Propuesta sin confirmar';
}

function csvCell(value) {
  const text = String(value ?? '');
  // Prevent spreadsheet formulas from names, notes or configurable sector/type labels.
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function calendarCsv(snapshot) {
  const rows = [['Empleado', 'Estado del empleado', 'Fecha', 'Día', 'Entrada', 'Salida', 'Tipo de turno', 'Sector', 'Origen / estado', 'Cambio protegido', 'Estado del calendario', 'Observaciones', 'Avisos del día']];
  for (const employee of snapshot.rows) {
    for (const cell of employee.cells) {
      const day = new Date(`${cell.date}T12:00:00Z`).toLocaleDateString('es-AR', { weekday: 'long', timeZone: 'UTC' });
      const warning = snapshot.warnings.filter((w) => w.date === cell.date).map((w) => w.message).join(' | ');
      if (!cell.shifts.length) rows.push([employee.name, employee.employeeStatus, cell.date, day, '', '', cell.emptyLabel, snapshot.sector === 'Todos los sectores' ? employee.sectors : snapshot.sector, cell.emptyLabel, '', snapshot.status, '', warning]);
      for (const shift of cell.shifts) rows.push([employee.name, employee.employeeStatus, cell.date, day, shift.startTime, shift.endTime, shift.shiftTypeName, shift.jobFunction || 'Sin sector', assignmentStatus(shift), shift.manuallyEdited ? 'Sí' : 'No', snapshot.status, shift.notes || '', [cell.rest ? 'Descanso configurado' : '', warning].filter(Boolean).join(' | ')]);
    }
  }
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export function calendarFilename(snapshot, extension) {
  const slug = snapshot.sector.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'equipo';
  return `calendario-${snapshot.dates[0]}-al-${snapshot.dates.at(-1)}-${slug}.${extension}`;
}

export function calendarWhatsAppMessage(snapshot) {
  const lines = [
    '*Calendario de turnos*',
    snapshot.periodLabel,
    `Sector: ${snapshot.sector}`,
    `Estado: ${snapshot.status}`,
    '',
  ];

  for (const date of snapshot.dates) {
    const shifts = snapshot.rows.flatMap((employee) => {
      const cell = employee.cells.find((item) => item.date === date);
      return (cell?.shifts || []).map((shift) => ({ ...shift, employeeName: employee.name }));
    }).sort((first, second) => first.startTime.localeCompare(second.startTime) || first.employeeName.localeCompare(second.employeeName, 'es'));

    if (!shifts.length) continue;
    lines.push(`*${displayDate(date, true)}*`);
    for (const shift of shifts) {
      const sector = shift.jobFunction ? ` · ${shift.jobFunction}` : '';
      lines.push(`• ${shift.startTime}–${shift.endTime} · ${shift.employeeName} · ${shift.shiftTypeName}${sector}`);
    }
    lines.push('');
  }

  if (!snapshot.assignmentCount) lines.push('Todavía no hay turnos asignados para este período.');
  if (snapshot.warnings.length) {
    lines.push(`Avisos de cobertura: ${snapshot.warnings.length}. Consultá el calendario para ver el detalle.`);
  }

  return lines.join('\n').trim();
}

export function groupCalendarWeeks(dates) {
  const groups = new Map();
  for (const date of dates) {
    const key = monday(date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(date);
  }
  return [...groups.values()];
}

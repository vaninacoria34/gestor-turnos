function minutesFromTime(value) {
  if (!value) return 0;
  const [hours, minutes] = String(value).split(':').map(Number);
  return hours * 60 + minutes;
}

function timeFromMinutes(totalMinutes) {
  const safeMinutes = Math.max(0, totalMinutes);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function buildBlocks(startTime, endTime, blockMinutes = 60) {
  const start = minutesFromTime(startTime);
  const end = minutesFromTime(endTime);
  const blocks = [];

  for (let current = start; current < end; current += blockMinutes) {
    const next = Math.min(current + blockMinutes, end);
    blocks.push({
      start: timeFromMinutes(current),
      end: timeFromMinutes(next),
      fromMinutes: current,
      toMinutes: next,
    });
  }

  return blocks;
}

function hoursWorked(startTime, endTime) {
  const diff = minutesFromTime(endTime) - minutesFromTime(startTime);
  return Math.max(diff / 60, 0);
}

function overlaps(startA, endA, startB, endB) {
  return minutesFromTime(startA) < minutesFromTime(endB) && minutesFromTime(startB) < minutesFromTime(endA);
}

const SHIFT_PREFERENCES = ['flexible', 'morning', 'afternoon'];

function matchesShiftPreference(employee, shiftType) {
  if (Array.isArray(employee.preferredShiftTypeIds)) return !employee.preferredShiftTypeIds.length || employee.preferredShiftTypeIds.includes(shiftType.id);
  const preference = employee.shiftPreference || 'flexible';
  return preference === 'flexible' || (preference === 'morning'
    ? minutesFromTime(shiftType.startTime) < 720
    : minutesFromTime(shiftType.startTime) >= 720);
}

function dailyRule(employee, date) {
  const day = weekdayForDate(date);
  const week = getWeekDates(date)[0];
  return employee.weeklyOverrides?.[week]?.[day] ?? employee.weeklySchedule?.[day] ?? null;
}

function isRestDate(employee, date) {
  const rule = dailyRule(employee, date);
  return rule ? rule.mode === 'rest' : (employee.restDays || []).includes(weekdayForDate(date));
}

function availableForShift(employee, date, type) {
  const rule = dailyRule(employee, date);
  if (isRestDate(employee, date)) return false;
  if (rule?.mode === 'fixed') return rule.shiftTypeId === type.id
    && (!rule.startTime || type.startTime >= rule.startTime) && (!rule.endTime || type.endTime <= rule.endTime);
  return (!rule?.startTime || type.startTime >= rule.startTime) && (!rule?.endTime || type.endTime <= rule.endTime)
    && (!rule?.jobFunctionId || type.jobFunctionId === rule.jobFunctionId);
}

function selectProposal(proposals, date) {
  return [...proposals].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || (b.id || '').localeCompare(a.id || ''))
    .find((item) => item.dates?.includes(date) || item.month === date.slice(0, 7));
}

function effectiveAssignments(proposals, dates) {
  const relevant = dates || [...new Set(proposals.flatMap((p) => p.dates || []))];
  return relevant.flatMap((date) => (selectProposal(proposals, date)?.assignments || []).filter((a) => a.date === date));
}

function assignmentSector(assignment, employees, types = []) {
  const type = types.find((t) => t.id === assignment.shiftTypeId);
  const employee = employees.find((e) => e.id === assignment.employeeId);
  // Legacy records can only inherit a sector when it is unambiguous.
  const ids = employee?.jobFunctionIds || (employee?.jobFunctionId ? [employee.jobFunctionId] : []);
  const names = employee?.jobFunctions || (employee?.jobFunction ? [employee.jobFunction] : []);
  const unambiguous = ids.length === 1 || (!ids.length && names.length === 1);
  return {
    ...assignment,
    jobFunctionId: assignment.jobFunctionId || type?.jobFunctionId || (ids.length === 1 ? ids[0] : ''),
    jobFunction: assignment.jobFunction || type?.jobFunction || (unambiguous ? names[0] || employee?.jobFunction : '') || '',
  };
}

function getWeekDates(startDate) {
  const start = new Date(`${String(startDate).slice(0, 10)}T12:00:00Z`);
  const day = start.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(start);
  monday.setUTCDate(start.getUTCDate() + mondayOffset);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function normalizeFunction(value) {
  return String(value || '').trim().toLocaleLowerCase('es-AR');
}

function matchesFunction(employee, shiftType) {
  const employeeFunctionIds = employee.jobFunctionIds || (employee.jobFunctionId ? [employee.jobFunctionId] : []);
  const employeeFunctions = employee.jobFunctions || (employee.jobFunction ? [employee.jobFunction] : []);
  if (shiftType.jobFunctionId) return employeeFunctionIds.includes(shiftType.jobFunctionId);
  if (!normalizeFunction(shiftType.jobFunction)) return true;
  return employeeFunctions.some((jobFunction) => normalizeFunction(jobFunction) === normalizeFunction(shiftType.jobFunction));
}

function getMonthDates(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Mes inválido. Usá AAAA-MM.');
  const [year, monthNumber] = month.split('-').map(Number);
  const length = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function resolveSpecialDay(date, specialDays = []) {
  const active = specialDays.filter((item) => item.active !== false);
  return active.find((item) => item.mode === 'date' && item.date === date)
    || active.find((item) => item.mode === 'weekday' && item.weekday === DAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()])
    || null;
}

function requiredEmployeesOnDate(shiftType, date, specialDays = []) {
  const rule = resolveSpecialDay(date, specialDays);
  const requirement = rule?.requirements?.find((item) => item.shiftTypeId === shiftType.id);
  return requirement ? requirement.requiredEmployees : rule?.restOthers ? 0 : Number(shiftType.requiredEmployees || 1);
}

function assignmentCoversShift(assignment, shiftType, employees) {
  const employee = employees.find((item) => item.id === assignment.employeeId);
  if (!employee || employee.active === false || employee.deleted) return false;
  if (!matchesFunction(employee, shiftType)) return false;
  const sector = assignmentSector(assignment, employees, [shiftType]);
  if (shiftType.jobFunctionId && sector.jobFunctionId !== shiftType.jobFunctionId) return false;
  if (!shiftType.jobFunctionId && shiftType.jobFunction && normalizeFunction(sector.jobFunction) !== normalizeFunction(shiftType.jobFunction)) return false;
  if (assignment.shiftTypeId && assignment.shiftTypeId !== shiftType.id) return false;
  return assignment.startTime <= shiftType.startTime && assignment.endTime >= shiftType.endTime;
}

function assignedEmployeeIds(assignments, date, shiftType, employees) {
  return new Set(assignments
    .filter((item) => item.date === date && assignmentCoversShift(item, shiftType, employees))
    .map((item) => item.employeeId));
}

function weekdayForDate(date) {
  return DAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

function assignmentsForEmployee(assignments, employeeId, date) {
  return assignments.filter((item) => item.employeeId === employeeId && item.date === date);
}

function canAssignAdditionalShift(employee, existing, shiftType) {
  if (existing.some((item) => overlaps(item.startTime, item.endTime, shiftType.startTime, shiftType.endTime))) return false;
  if (existing.some((item) => item.shiftTypeId === shiftType.id)) return false;
  if (!existing.length) return true;
  return employee.allowedDoubleShifts === true && existing.length < 2;
}

function hoursAssignedInWeek(assignments, employeeId, date) {
  const weekDates = new Set(getWeekDates(date));
  return assignments
    .filter((item) => item.employeeId === employeeId && weekDates.has(item.date))
    .reduce((total, item) => total + hoursWorked(item.startTime, item.endTime), 0);
}

function exceedsWeeklyHours(employee, assignments, date, shiftType) {
  const maximum = Number(employee.maxHoursPerWeek);
  if (!Number.isFinite(maximum) || maximum <= 0) return false;
  return hoursAssignedInWeek(assignments, employee.id, date) + hoursWorked(shiftType.startTime, shiftType.endTime) > maximum;
}

function validateSpecialDayAssignment(assignment, others, shiftTypes, employees, specialDays = []) {
  const rule = resolveSpecialDay(assignment.date, specialDays);
  if (!rule?.restOthers) return null;
  const employee = employees.find((item) => item.id === assignment.employeeId) || assignment;
  const allowed = shiftTypes.filter((type) => type.active !== false && requiredEmployeesOnDate(type, assignment.date, specialDays) > 0 && matchesFunction(employee, type));
  if (assignment.shiftTypeId && !allowed.some((type) => type.id === assignment.shiftTypeId)) return `El turno no está habilitado por la regla “${rule.name}”.`;
  if (!allowed.some((type) => assignment.startTime >= type.startTime && assignment.endTime <= type.endTime)) return `El horario no está habilitado por la regla “${rule.name}”.`;
  const sameDay = assignmentsForEmployee(others, assignment.employeeId, assignment.date);
  if (!canAssignAdditionalShift(employee, sameDay, { ...assignment, id: assignment.shiftTypeId })) return `La regla “${rule.name}” no permite otro turno para esta persona o el horario se superpone.`;
  for (const type of allowed) {
    if (assignedEmployeeIds([...others, assignment], assignment.date, type, employees).size > requiredEmployeesOnDate(type, assignment.date, specialDays)) return `La dotación de ${type.name} ya está completa para la regla “${rule.name}”.`;
  }
  return null;
}

function buildCoverageWarnings(assignments, dates, shiftTypes, employees, specialDays = []) {
  const warnings = [];
  const checkedWeeks = new Set();
  for (const assignment of assignments.filter((a) => dates.includes(a.date))) {
    const employee = employees.find((e) => e.id === assignment.employeeId);
    if (!employee || employee.active === false || employee.deleted || isRestDate(employee, assignment.date)) warnings.push({ date: assignment.date, kind: 'availability', message: `Revisá el turno conservado de ${employee?.name || assignment.employeeName || assignment.employeeId}: la persona está inactiva, no existe o tiene descanso configurado.` });
    if (employee) {
      const rule = dailyRule(employee, assignment.date);
      if ((rule?.startTime && assignment.startTime < rule.startTime) || (rule?.endTime && assignment.endTime > rule.endTime) || (rule?.jobFunctionId && assignment.jobFunctionId !== rule.jobFunctionId)) warnings.push({ date: assignment.date, kind: 'availability', message: `El turno conservado de ${employee.name} no coincide con la disponibilidad diaria actual. Revisalo manualmente.` });
      const week = `${employee.id}|${getWeekDates(assignment.date)[0]}`;
      if (!checkedWeeks.has(week)) {
        checkedWeeks.add(week);
        if (Number(employee.maxHoursPerWeek) > 0 && hoursAssignedInWeek(assignments, employee.id, assignment.date) > Number(employee.maxHoursPerWeek)) warnings.push({ date: assignment.date, kind: 'hours', message: `Los turnos conservados de ${employee.name} superan su máximo semanal de ${employee.maxHoursPerWeek} horas. Revisalos manualmente.` });
      }
    }
  }
  for (const date of dates) {
    for (const type of shiftTypes.filter((item) => item.active !== false)) {
      const required = requiredEmployeesOnDate(type, date, specialDays);
      const assigned = assignedEmployeeIds(assignments, date, type, employees).size;
      const missing = Math.max(0, required - assigned);
      if (missing) warnings.push({
        date,
        shiftTypeId: type.id,
        shiftTypeName: type.name,
        jobFunction: type.jobFunction || '',
        jobFunctionId: type.jobFunctionId || '',
        startTime: type.startTime,
        endTime: type.endTime,
        required,
        assigned,
        missing,
        message: `TURNO SIN CUBRIR - ${date} · ${type.jobFunction || 'Sin sector'} · ${type.name} (${type.startTime}–${type.endTime}) · faltan ${missing} empleado(s).`,
      });
    }
    const rule = resolveSpecialDay(date, specialDays);
    const daily = assignments.filter((a) => a.date === date);
    for (const [index, assignment] of daily.entries()) {
      if (daily.slice(index + 1).some((other) => other.employeeId === assignment.employeeId && overlaps(assignment.startTime, assignment.endTime, other.startTime, other.endTime))) warnings.push({ date, kind: 'overlap', message: `Hay turnos conservados que se superponen para ${assignment.employeeName || assignment.employeeId}. Revisalos manualmente.` });
    }
    if (rule?.restOthers) {
      const daily = assignments.filter((item) => item.date === date);
      for (const assignment of daily) {
        const error = validateSpecialDayAssignment(assignment, daily.filter((item) => item !== assignment), shiftTypes, employees, specialDays);
        if (error && !warnings.some((item) => item.date === date && item.message === error)) warnings.push({ date, kind: 'special-day', message: error });
      }
    }
  }
  return warnings;
}

function buildCoverageMap(assignments = []) {
  const coverage = {};

  for (const assignment of assignments) {
    const startTime = assignment.startTime || '00:00';
    const endTime = assignment.endTime || '00:00';

    for (const block of buildBlocks(startTime, endTime, 60)) {
      const key = `${assignment.date}|${block.start}`;
      coverage[key] = coverage[key] || [];
      coverage[key].push({
        employeeId: assignment.employeeId,
        employeeName: assignment.employeeName,
        date: assignment.date,
        jobFunction: assignment.jobFunction || '',
        jobFunctionId: assignment.jobFunctionId || '',
      });
    }
  }

  return coverage;
}

function generateWeekProposal({ employees = [], shiftTypes = [], manualShifts = [], weekStart = null, sundayHistory = [], specialDays = [], lockedAssignments = [], contextAssignments = [] }) {
  const dates = getWeekDates(weekStart || new Date().toISOString().slice(0, 10));
  return { ...generatePeriodProposal({ employees, shiftTypes, manualShifts, dates, sundayHistory, specialDays, lockedAssignments, contextAssignments }), period: 'week', weekStart: dates[0] };
}

function generateMonthProposal({ month, ...options }) {
  const dates = getMonthDates(month);
  return { ...generatePeriodProposal({ ...options, dates }), period: 'month', month };
}

function generatePeriodProposal({ employees = [], shiftTypes = [], manualShifts = [], dates, sundayHistory = [], specialDays = [], lockedAssignments = [], contextAssignments = [] }) {
  manualShifts = [...manualShifts, ...contextAssignments.filter((a) => !dates.includes(a.date))];
  const activeEmployees = employees.filter((employee) => employee.active !== false && !employee.deleted);
  const activeShiftTypes = shiftTypes.filter((shiftType) => shiftType.active !== false);
  const assignments = lockedAssignments.filter((a) => dates.includes(a.date)).map((a) => ({ ...a, manuallyEdited: true }));
  const coverage = {};
  const fixedShiftWarnings = [];

  const pastSundays = new Map();
  for (const item of sundayHistory.filter((entry) => entry.date < dates[0])) {
    if (!pastSundays.has(item.date)) pastSundays.set(item.date, new Set());
    for (const id of item.employeeIds || []) pastSundays.get(item.date).add(id);
  }
  const sundayList = [...pastSundays.values()].flatMap((ids) => [...ids]);
  const previousCalendarDate = (date) => {
    const previous = new Date(`${date}T12:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    return previous.toISOString().slice(0, 10);
  };

  const employeeLoad = Object.fromEntries(
    activeEmployees.map((employee) => [employee.id, {
      totalHours: [...manualShifts, ...assignments].filter((item) => item.employeeId === employee.id && dates.includes(item.date)).reduce((total, item) => total + hoursWorked(item.startTime, item.endTime), 0),
      sundayCount: sundayList.filter((id) => id === employee.id).length,
    }]),
  );
  const shiftTypeLoad = new Map(activeShiftTypes.map((shiftType) => [
    shiftType.id,
    new Map(activeEmployees.map((employee) => [employee.id, 0])),
  ]));
  for (const shift of manualShifts) {
    const counts = shiftTypeLoad.get(shift.shiftTypeId);
    if (dates.includes(shift.date) && counts?.has(shift.employeeId)) {
      counts.set(shift.employeeId, counts.get(shift.employeeId) + 1);
    }
  }

  for (const [dateIndex, date] of dates.entries()) {
    const dayName = weekdayForDate(date);
    const previousDate = previousCalendarDate(date);
    const workedPreviousDay = new Set([...manualShifts, ...assignments].filter((item) => item.date === previousDate).map((item) => item.employeeId));
    coverage[date] = {};
    const specialDay = resolveSpecialDay(date, specialDays);

    for (const employee of activeEmployees) {
      const rule = dailyRule(employee, date);
      const configured = rule ? (rule.mode === 'fixed' ? rule.shiftTypeId : []) : employee.fixedShiftTypeIdsByDay?.[dayName];
      const fixedTypeIds = Array.isArray(configured) ? configured : configured ? [configured] : [];
      for (const shiftTypeId of fixedTypeIds) {
        const originalType = activeShiftTypes.find((item) => item.id === shiftTypeId);
        const shiftType = originalType && { ...originalType, startTime: rule?.startTime || originalType.startTime, endTime: rule?.endTime || originalType.endTime };
        if (!shiftType) {
          fixedShiftWarnings.push({ date, kind: 'fixed-shift', message: `No se pudo aplicar el turno fijo de ${employee.name}: el tipo de turno configurado para ${dayName} no existe o está inactivo.` });
          continue;
        }
        if (requiredEmployeesOnDate(shiftType, date, specialDays) === 0) {
          fixedShiftWarnings.push({ date, kind: 'fixed-shift', message: `El turno fijo de ${employee.name} (${shiftType.jobFunction || 'Sin sector'}, ${shiftType.startTime}–${shiftType.endTime}) coincide con un día en que el turno está cerrado.` });
          continue;
        }
        if (!matchesFunction(employee, shiftType)) {
          fixedShiftWarnings.push({ date, kind: 'fixed-shift', message: `El turno fijo de ${employee.name} no corresponde a una función habilitada para esa persona.` });
          continue;
        }
        if (isRestDate(employee, date)) {
          fixedShiftWarnings.push({ date, kind: 'fixed-shift', message: `El turno fijo de ${employee.name} coincide con su descanso configurado (${dayName}).` });
          continue;
        }
        const existingAssignments = [...manualShifts, ...assignments];
        const alreadyAssigned = existingAssignments.some((item) => item.employeeId === employee.id && item.date === date && (item.manuallyEdited || assignmentCoversShift(item, shiftType, employees)));
        if (alreadyAssigned) continue;
        const sameDay = assignmentsForEmployee(existingAssignments, employee.id, date);
        if (!canAssignAdditionalShift(employee, sameDay, shiftType)) {
          fixedShiftWarnings.push({ date, kind: 'fixed-shift', message: `No se pudo aplicar el turno fijo de ${employee.name} (${shiftType.jobFunction || 'Sin sector'}, ${shiftType.startTime}–${shiftType.endTime}) por superposición o porque no tiene habilitada una jornada doble.` });
          continue;
        }
        if (exceedsWeeklyHours(employee, existingAssignments, date, shiftType)) {
          fixedShiftWarnings.push({ date, kind: 'fixed-shift', message: `No se pudo aplicar el turno fijo de ${employee.name}: superaría su máximo configurado de ${employee.maxHoursPerWeek} horas semanales.` });
          continue;
        }
        const item = {
          employeeId: employee.id,
          employeeName: employee.name,
          jobFunction: shiftType.jobFunction || employee.jobFunction || '',
          jobFunctionId: shiftType.jobFunctionId || employee.jobFunctionId || '',
          date,
          shiftTypeId: shiftType.id,
          shiftTypeName: shiftType.name,
          startTime: shiftType.startTime,
          endTime: shiftType.endTime,
          durationHours: hoursWorked(shiftType.startTime, shiftType.endTime),
          partial: false,
          notes: `Turno fijo automático - ${shiftType.name}`,
        };
        const specialError = validateSpecialDayAssignment(item, existingAssignments, activeShiftTypes, employees, specialDays);
        if (specialError) {
          fixedShiftWarnings.push({ date, kind: 'fixed-shift', message: `No se pudo aplicar el turno fijo de ${employee.name}: ${specialError}` });
          continue;
        }
        assignments.push(item);
        employeeLoad[employee.id].totalHours += item.durationHours;
        const typeCounts = shiftTypeLoad.get(shiftType.id);
        typeCounts?.set(employee.id, (typeCounts.get(employee.id) || 0) + 1);
        if (dayName === 'sunday') employeeLoad[employee.id].sundayCount += 1;
      }
    }

    const sectors = new Map();
    for (const shiftType of activeShiftTypes) {
      const sectorId = shiftType.jobFunctionId || normalizeFunction(shiftType.jobFunction) || 'general';
      if (!sectors.has(sectorId)) sectors.set(sectorId, []);
      sectors.get(sectorId).push(shiftType);
    }
    const beforeAutomatic = [...manualShifts, ...assignments];
    const eligibleByType = new Map(activeShiftTypes.map((type) => [type.id, activeEmployees.filter((employee) => matchesFunction(employee, type) && matchesShiftPreference(employee, type) && availableForShift(employee, date, type) && canAssignAdditionalShift(employee, assignmentsForEmployee(beforeAutomatic, employee.id, date), type) && !exceedsWeeklyHours(employee, beforeAutomatic, date, type))]));
    const eligibleCount = (type) => eligibleByType.get(type.id).length;
    const remainingDemand = (type) => Math.max(0, requiredEmployeesOnDate(type, date, specialDays) - assignedEmployeeIds(beforeAutomatic, date, type, employees).size);
    const flexibility = new Map(activeEmployees.map((employee) => [employee.id, activeShiftTypes.filter((type) => requiredEmployeesOnDate(type, date, specialDays) > 0 && eligibleByType.get(type.id).includes(employee)).length]));
    const orderedSectors = [...sectors.entries()].map(([id, types], order) => ({
      id,
      types,
      order,
      demand: types.reduce((total, type) => total + requiredEmployeesOnDate(type, date, specialDays), 0),
      slack: Math.min(...types.filter((t) => remainingDemand(t) > 0).map((t) => eligibleCount(t) - remainingDemand(t))),
    })).sort((first, second) => first.slack - second.slack || second.demand - first.demand
      || ((first.order - (dateIndex % sectors.size) + sectors.size) % sectors.size) - ((second.order - (dateIndex % sectors.size) + sectors.size) % sectors.size));
    const dailyShiftTypes = orderedSectors.flatMap(({ types }) => {
      const rotation = types.length ? dateIndex % types.length : 0;
      return [...types.slice(rotation), ...types.slice(0, rotation)].sort((a, b) => (eligibleCount(a) - remainingDemand(a)) - (eligibleCount(b) - remainingDemand(b)));
    });
    for (const shiftType of dailyShiftTypes) {
      const requiredEmployees = requiredEmployeesOnDate(shiftType, date, specialDays);
      if (requiredEmployees <= 0) {
        coverage[date][shiftType.id] = [];
        continue;
      }
      const currentAssignments = [...manualShifts, ...assignments];
      const assignedIds = assignedEmployeeIds(currentAssignments, date, shiftType, employees);
      const picked = [];

      const candidates = [...eligibleByType.get(shiftType.id)].sort((first, second) => {
        const flexibilityDifference = flexibility.get(first.id) - flexibility.get(second.id);
        if (flexibilityDifference) return flexibilityDifference;
        if (dayName === 'sunday') {
          const sundayDifference = employeeLoad[first.id].sundayCount - employeeLoad[second.id].sundayCount;
          if (sundayDifference) return sundayDifference;
        }
        const firstPreferred = (first.shiftPreference || 'flexible') !== 'flexible' && matchesShiftPreference(first, shiftType);
        const secondPreferred = (second.shiftPreference || 'flexible') !== 'flexible' && matchesShiftPreference(second, shiftType);
        if (firstPreferred !== secondPreferred) return firstPreferred ? -1 : 1;
        const typeCounts = shiftTypeLoad.get(shiftType.id);
        const shiftDifference = (typeCounts?.get(first.id) || 0) - (typeCounts?.get(second.id) || 0);
        if (shiftDifference) return shiftDifference;
        const firstRestedYesterday = !workedPreviousDay.has(first.id);
        const secondRestedYesterday = !workedPreviousDay.has(second.id);
        if (firstRestedYesterday !== secondRestedYesterday) return firstRestedYesterday ? -1 : 1;
        const firstScore = employeeLoad[first.id]?.totalHours || 0;
        const secondScore = employeeLoad[second.id]?.totalHours || 0;
        if (firstScore !== secondScore) return firstScore - secondScore;
        return (sundayList.filter((id) => id === first.id).length || 0) - (sundayList.filter((id) => id === second.id).length || 0);
      });

      for (const employee of candidates) {
        if (assignedIds.size + picked.length >= requiredEmployees) break;
        if (!matchesFunction(employee, shiftType)) continue;
        if (!matchesShiftPreference(employee, shiftType)) continue;
        if (assignedIds.has(employee.id)) continue;
        if (!availableForShift(employee, date, shiftType)) continue;
        const existingAssignments = [...manualShifts, ...assignments];
        if (!canAssignAdditionalShift(employee, assignmentsForEmployee(existingAssignments, employee.id, date), shiftType)) continue;
        if (exceedsWeeklyHours(employee, existingAssignments, date, shiftType)) continue;
        if (specialDay?.restOthers && assignmentsForEmployee(existingAssignments, employee.id, date).length && employee.allowedDoubleShifts !== true) continue;

        picked.push({
          employeeId: employee.id,
          employeeName: employee.name,
          jobFunction: shiftType.jobFunction || employee.jobFunction || '',
          jobFunctionId: shiftType.jobFunctionId || employee.jobFunctionId || '',
          date,
          shiftTypeId: shiftType.id,
          shiftTypeName: shiftType.name,
          startTime: shiftType.startTime,
          endTime: shiftType.endTime,
          durationHours: hoursWorked(shiftType.startTime, shiftType.endTime),
          partial: false,
          notes: `Propuesta automática - ${shiftType.name}`,
        });
      }

      for (const item of picked) {
        assignments.push(item);
        employeeLoad[item.employeeId].totalHours += item.durationHours;
        const typeCounts = shiftTypeLoad.get(shiftType.id);
        typeCounts?.set(item.employeeId, (typeCounts.get(item.employeeId) || 0) + 1);
        if (dayName === 'sunday' && assignmentsForEmployee(assignments, item.employeeId, date).length === 1) employeeLoad[item.employeeId].sundayCount += 1;
      }

      coverage[date][shiftType.id] = picked.map((item) => item.employeeName);
    }
  }

  const allAssignments = [...manualShifts.filter((item) => dates.includes(item.date)), ...assignments];
  const hourCoverage = buildCoverageMap(allAssignments);

  return {
    dates,
    assignments,
    coverage: hourCoverage,
    warnings: [...fixedShiftWarnings, ...buildCoverageWarnings([...allAssignments, ...contextAssignments.filter((a) => !dates.includes(a.date))], dates, shiftTypes, employees, specialDays)],
    specialDayRules: specialDays.filter((rule) => rule.active !== false && dates.some((date) => resolveSpecialDay(date, specialDays)?.id === rule.id)).map((rule) => ({ ...rule, requirements: (rule.requirements || []).map((item) => ({ ...item })) })),
  };
}

module.exports = {
  dailyRule,
  isRestDate,
  availableForShift,
  assignmentSector,
  assignmentCoversShift,
  selectProposal,
  effectiveAssignments,
  DAY_KEYS,
  resolveSpecialDay,
  requiredEmployeesOnDate,
  validateSpecialDayAssignment,
  normalizeFunction,
  matchesFunction,
  getMonthDates,
  generateMonthProposal,
  buildCoverageWarnings,
  SHIFT_PREFERENCES,
  matchesShiftPreference,
  minutesFromTime,
  timeFromMinutes,
  buildBlocks,
  buildCoverageMap,
  hoursWorked,
  overlaps,
  getWeekDates,
  generateWeekProposal,
};

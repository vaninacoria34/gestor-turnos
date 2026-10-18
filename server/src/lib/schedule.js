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
  const preference = employee.shiftPreference || 'flexible';
  return preference === 'flexible' || (preference === 'morning'
    ? minutesFromTime(shiftType.startTime) < 720
    : minutesFromTime(shiftType.startTime) >= 720);
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
  if (shiftType.jobFunctionId && employee.jobFunctionId) return employee.jobFunctionId === shiftType.jobFunctionId;
  return !normalizeFunction(shiftType.jobFunction) || normalizeFunction(employee.jobFunction) === normalizeFunction(shiftType.jobFunction);
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

function coverageCounts(assignments, date, shiftType, employees) {
  const daily = assignments.filter((item) => item.date === date && matchesFunction(employees.find((employee) => employee.id === item.employeeId) || { jobFunction: item.jobFunction }, shiftType));
  const boundaries = [...new Set([shiftType.startTime, shiftType.endTime, ...daily.flatMap((item) => [item.startTime, item.endTime])])].filter((time) => time >= shiftType.startTime && time <= shiftType.endTime).sort();
  const counts = boundaries.slice(0, -1).map((start, index) => new Set(daily.filter((item) => item.startTime <= start && item.endTime >= boundaries[index + 1]).map((item) => item.employeeId)).size);
  return counts.length ? counts : [0];
}

function minimumCoverage(assignments, date, shiftType, employees) {
  return Math.min(...coverageCounts(assignments, date, shiftType, employees));
}

function validateSpecialDayAssignment(assignment, others, shiftTypes, employees, specialDays = []) {
  const rule = resolveSpecialDay(assignment.date, specialDays);
  if (!rule?.restOthers) return null;
  const employee = employees.find((item) => item.id === assignment.employeeId) || assignment;
  const allowed = shiftTypes.filter((type) => type.active !== false && requiredEmployeesOnDate(type, assignment.date, specialDays) > 0 && matchesFunction(employee, type));
  if (assignment.shiftTypeId && !allowed.some((type) => type.id === assignment.shiftTypeId)) return `El turno no está habilitado por la regla “${rule.name}”.`;
  if (!allowed.some((type) => assignment.startTime >= type.startTime && assignment.endTime <= type.endTime)) return `El horario no está habilitado por la regla “${rule.name}”.`;
  if (others.some((item) => item.employeeId === assignment.employeeId && item.date === assignment.date)) return `La regla “${rule.name}” permite un solo turno por persona; el resto descansa.`;
  for (const type of allowed) {
    const maximum = Math.max(...coverageCounts([...others, assignment], assignment.date, type, employees));
    if (maximum > requiredEmployeesOnDate(type, assignment.date, specialDays)) return `La dotación de ${type.name} ya está completa para la regla “${rule.name}”.`;
  }
  return null;
}

function buildCoverageWarnings(assignments, dates, shiftTypes, employees, specialDays = []) {
  const warnings = [];
  for (const date of dates) {
    for (const type of shiftTypes.filter((item) => item.active !== false)) {
      const required = requiredEmployeesOnDate(type, date, specialDays);
      const missing = Math.max(0, required - minimumCoverage(assignments, date, type, employees));
      if (missing) warnings.push({ date, shiftTypeName: type.name, jobFunction: type.jobFunction || '', missing, message: `Falta cobertura para ${type.name}${type.jobFunction ? ` · ${type.jobFunction}` : ''} en ${date}.` });
    }
    const rule = resolveSpecialDay(date, specialDays);
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
      });
    }
  }

  return coverage;
}

function generateWeekProposal({ employees = [], shiftTypes = [], manualShifts = [], weekStart = null, sundayHistory = [], specialDays = [] }) {
  const dates = getWeekDates(weekStart || new Date().toISOString().slice(0, 10));
  return { ...generatePeriodProposal({ employees, shiftTypes, manualShifts, dates, sundayHistory, specialDays }), period: 'week', weekStart: dates[0] };
}

function generateMonthProposal({ month, ...options }) {
  const dates = getMonthDates(month);
  return { ...generatePeriodProposal({ ...options, dates }), period: 'month', month };
}

function generatePeriodProposal({ employees = [], shiftTypes = [], manualShifts = [], dates, sundayHistory = [], specialDays = [] }) {
  const activeEmployees = employees.filter((employee) => employee.active !== false && !employee.deleted);
  const activeShiftTypes = shiftTypes.filter((shiftType) => shiftType.active !== false);
  const assignments = [];
  const coverage = {};

  const sundayList = sundayHistory.flatMap((item) => item.employeeIds || []);

  const employeeLoad = Object.fromEntries(
    activeEmployees.map((employee) => [employee.id, { totalHours: 0, sundayCount: sundayList.filter((id) => id === employee.id).length }]),
  );

  for (const date of dates) {
    const dayName = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    coverage[date] = {};
    const specialDay = resolveSpecialDay(date, specialDays);

    for (const shiftType of activeShiftTypes) {
      const requiredEmployees = requiredEmployeesOnDate(shiftType, date, specialDays);
      const existingCoverage = minimumCoverage([...manualShifts, ...assignments], date, shiftType, employees);
      const picked = [];

      const candidates = [...activeEmployees].sort((first, second) => {
        if (dayName === 'sunday') {
          const sundayDifference = employeeLoad[first.id].sundayCount - employeeLoad[second.id].sundayCount;
          if (sundayDifference) return sundayDifference;
        }
        const firstScore = employeeLoad[first.id]?.totalHours || 0;
        const secondScore = employeeLoad[second.id]?.totalHours || 0;
        if (firstScore !== secondScore) return firstScore - secondScore;
        return (sundayList.filter((id) => id === first.id).length || 0) - (sundayList.filter((id) => id === second.id).length || 0);
      });

      for (const employee of candidates) {
        if (picked.length + existingCoverage >= requiredEmployees) break;
        if (!matchesFunction(employee, shiftType)) continue;
        if (!matchesShiftPreference(employee, shiftType)) continue;
        if (specialDay?.restOthers && [...manualShifts, ...assignments].some((item) => item.employeeId === employee.id && item.date === date)) continue;

        const restMatch = employee.restDays || [];
        if (restMatch.includes(dayName)) continue;

        const employeeAlreadyScheduled = assignments.some(
          (item) => item.employeeId === employee.id && item.date === date && overlaps(item.startTime, item.endTime, shiftType.startTime, shiftType.endTime),
        );

        if (employeeAlreadyScheduled) continue;

        const manualConflict = manualShifts.some(
          (item) => item.employeeId === employee.id && item.date === date && overlaps(item.startTime, item.endTime, shiftType.startTime, shiftType.endTime),
        );

        if (manualConflict) continue;

        if (dayName === 'sunday') {
          const sundayWorked = sundayHistory.some((entry) => entry.date === date && (entry.employeeIds || []).includes(employee.id));
          if (sundayWorked && activeEmployees.length > 1) continue;
        }

        picked.push({
          employeeId: employee.id,
          employeeName: employee.name,
          jobFunction: employee.jobFunction || '',
          jobFunctionId: employee.jobFunctionId || '',
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
        if (dayName === 'sunday' && !assignments.some((other) => other !== item && other.employeeId === item.employeeId && other.date === date)) employeeLoad[item.employeeId].sundayCount += 1;
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
    warnings: buildCoverageWarnings(allAssignments, dates, shiftTypes, employees, specialDays),
    specialDayRules: specialDays.filter((rule) => rule.active !== false && dates.some((date) => resolveSpecialDay(date, specialDays)?.id === rule.id)).map((rule) => ({ ...rule, requirements: (rule.requirements || []).map((item) => ({ ...item })) })),
  };
}

module.exports = {
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

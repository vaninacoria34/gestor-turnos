import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

const API_URL = 'http://localhost:4000/api';
const EMPTY_EMPLOYEE = { name: '', active: true, shiftPreference: 'flexible', jobFunctionId: '' };
const EMPTY_SHIFT_TYPE = { name: '', jobFunctionId: '', startTime: '08:00', endTime: '12:00', requiredEmployees: 1, color: '#60a5fa', notes: '', active: true };
const normalizeFunction = (value) => (value || '').trim().toLocaleLowerCase('es-AR');
const matchesFunction = (employee, type) => !normalizeFunction(type.jobFunction) || normalizeFunction(employee?.jobFunction) === normalizeFunction(type.jobFunction);
const SHIFT_PREFERENCES = [
  { value: 'flexible', label: 'Flexible' },
  { value: 'morning', label: 'Mañana' },
  { value: 'afternoon', label: 'Tarde' },
];
const WEEK_DAYS = [
  { key: 'monday', label: 'Lunes' },
  { key: 'tuesday', label: 'Martes' },
  { key: 'wednesday', label: 'Miércoles' },
  { key: 'thursday', label: 'Jueves' },
  { key: 'friday', label: 'Viernes' },
  { key: 'saturday', label: 'Sábado' },
  { key: 'sunday', label: 'Domingo' },
];

function newSpecialDayForm() {
  return { name: '', mode: 'weekday', weekday: 'sunday', date: dateKey(new Date()), active: true, restOthers: true, requirements: [{ shiftTypeId: '', requiredEmployees: 2 }, { shiftTypeId: '', requiredEmployees: 2 }] };
}

function specialDayForDate(date, rules = []) {
  const active = rules.filter((rule) => rule.active !== false);
  const weekday = WEEK_DAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7].key;
  return active.find((rule) => rule.mode === 'date' && rule.date === date) || active.find((rule) => rule.mode === 'weekday' && rule.weekday === weekday) || null;
}

function requiredForDate(type, date, rules) {
  const rule = specialDayForDate(date, rules);
  const requirement = rule?.requirements?.find((item) => item.shiftTypeId === type.id);
  return requirement ? requirement.requiredEmployees : rule?.restOthers ? 0 : Number(type.requiredEmployees || 1);
}

function startOfWeek(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftDate(date, amount) {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + amount);
  return shifted;
}

async function apiRequest(path, options = {}, token) {
  const headers = { ...(options.headers || {}) };

  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }


  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.message || 'Error al consultar la API.');
  }

  return payload;
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  });

  const [authForm, setAuthForm] = useState({
    email: 'admin@gestor-turnos.local',
    password: 'Admin123!',
  });
  const [employees, setEmployees] = useState([]);
  const [jobFunctions, setJobFunctions] = useState([]);
  const [functionForm, setFunctionForm] = useState({ name: '', description: '' });
  const [editingFunctionId, setEditingFunctionId] = useState(null);
  const [editingEmployeeId, setEditingEmployeeId] = useState(null);
  const [editingShiftTypeId, setEditingShiftTypeId] = useState(null);
  const [editingShiftId, setEditingShiftId] = useState(null);
  const [savingEntity, setSavingEntity] = useState(false);
  const [functionSearch, setFunctionSearch] = useState('');
  const [specialDays, setSpecialDays] = useState([]);
  const [specialDayForm, setSpecialDayForm] = useState(newSpecialDayForm);
  const [editingSpecialDayId, setEditingSpecialDayId] = useState(null);
  const [specialDaySearch, setSpecialDaySearch] = useState('');
  const [shiftTypes, setShiftTypes] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [proposal, setProposal] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [coverage, setCoverage] = useState([]);
  const [summary, setSummary] = useState(null);
  const [activeTab, setActiveTab] = useState('calendario');
  const [calendarWeekStart, setCalendarWeekStart] = useState(() => startOfWeek(new Date()));
  const [calendarView, setCalendarView] = useState('month');
  const calendarRef = useRef(null);
  const fullscreenButtonRef = useRef(null);
  const [calendarFullscreen, setCalendarFullscreen] = useState(false);
  const [expandedCalendar, setExpandedCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => dateKey(new Date()).slice(0, 7));
  const [functionFilter, setFunctionFilter] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingPreference, setSavingPreference] = useState(null);
  const [savingAssignment, setSavingAssignment] = useState(null);

  const [employeeForm, setEmployeeForm] = useState({ ...EMPTY_EMPLOYEE });
  const [restDayForm, setRestDayForm] = useState({ employeeId: '', days: [] });
  const [shiftTypeForm, setShiftTypeForm] = useState({ ...EMPTY_SHIFT_TYPE });
  const [shiftForm, setShiftForm] = useState({
    employeeId: '',
    date: new Date().toISOString().slice(0, 10),
    startTime: '08:00',
    endTime: '12:00',
    partial: false,
    notes: '',
  });

  const loadDashboard = async () => {
    if (!token) return;
    setLoading(true);
    try {
      // Import existing free-text functions before reading their stable references.
      const functionsData = await apiRequest('/job-functions', {}, token);
      const [employeesData, shiftTypesData, shiftsData, summaryData, coverageData, proposalsData, specialDaysData] = await Promise.all([
        apiRequest('/employees', {}, token),
        apiRequest('/shiftTypes', {}, token),
        apiRequest('/shifts', {}, token),
        apiRequest('/summary', {}, token),
        apiRequest(`/coverage?month=${calendarMonth}&jobFunction=${encodeURIComponent(functionFilter)}`, {}, token),
        apiRequest('/schedules/proposals', {}, token),
        apiRequest('/special-days', {}, token),
      ]);

      setEmployees(employeesData);
      setJobFunctions(functionsData);
      setShiftTypes(shiftTypesData);
      setShifts(shiftsData);
      setSummary(summaryData);
      setCoverage(coverageData.coverage || []);
      setProposals(proposalsData);
      setSpecialDays(specialDaysData);
      setMessage('');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadDashboard();
    }
  }, [token]);

  useEffect(() => {
    const syncFullscreen = () => {
      const active = document.fullscreenElement === calendarRef.current && Boolean(calendarRef.current);
      setCalendarFullscreen(active || expandedCalendar);
      if (!active && !expandedCalendar) fullscreenButtonRef.current?.focus();
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, [expandedCalendar]);

  useEffect(() => {
    if (!expandedCalendar) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setExpandedCalendar(false);
        setCalendarFullscreen(false);
      }
      if (event.key === 'Tab') {
        const controls = [...(calendarRef.current?.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]') || [])].filter((element) => !element.disabled && element.getClientRects().length);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKey);
      fullscreenButtonRef.current?.focus();
    };
  }, [expandedCalendar]);

  useEffect(() => {
    if (activeTab !== 'calendario' || !token) {
      setExpandedCalendar(false);
      setCalendarFullscreen(false);
    }
  }, [activeTab, token]);

  const toggleCalendarFullscreen = async () => {
    const element = calendarRef.current;
    if (!element) return;
    if (expandedCalendar) {
      setExpandedCalendar(false);
      setCalendarFullscreen(false);
      return;
    }
    try {
      if (document.fullscreenElement === element) {
        await document.exitFullscreen();
      } else if (element.requestFullscreen && document.fullscreenEnabled) {
        await element.requestFullscreen();
      } else {
        setExpandedCalendar(true);
        setCalendarFullscreen(true);
      }
    } catch {
      if (document.fullscreenElement !== element) {
        setExpandedCalendar(true);
        setCalendarFullscreen(true);
      }
    }
  };

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiRequest(`/coverage?month=${calendarMonth}&jobFunction=${encodeURIComponent(functionFilter)}`, {}, token)
      .then((result) => { if (!cancelled) setCoverage(result.coverage || []); })
      .catch((error) => { if (!cancelled) setMessage(error.message); });
    return () => { cancelled = true; };
  }, [token, calendarMonth, functionFilter, employees, shiftTypes]);

  const login = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      const payload = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify(authForm),
      });

      setToken(payload.token);
      setUser(payload.user);
      localStorage.setItem('token', payload.token);
      localStorage.setItem('user', JSON.stringify(payload.user));
      setMessage('Sesión iniciada correctamente.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken('');
    setUser(null);
    setEmployees([]);
    setJobFunctions([]);
    setSpecialDays([]);
    setShiftTypes([]);
    setShifts([]);
    setProposal(null);
    setProposals([]);
    setCoverage([]);
    setSummary(null);
  };

  const createEmployee = async (event) => {
    event.preventDefault();
    if (!employeeForm.name.trim()) {
      setMessage('Ingresá el nombre del empleado.');
      return;
    }

    setSavingEntity(true);
    try {
      await apiRequest(editingEmployeeId ? `/employees/${editingEmployeeId}` : '/employees', {
        method: editingEmployeeId ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: employeeForm.name,
          active: employeeForm.active,
          shiftPreference: employeeForm.shiftPreference,
          jobFunctionId: employeeForm.jobFunctionId,
          ...(!editingEmployeeId ? { restDays: [] } : {}),
        }),
      }, token);

      setEmployeeForm({ ...EMPTY_EMPLOYEE });
      setEditingEmployeeId(null);
      await loadDashboard();
      setMessage(editingEmployeeId ? 'Empleado actualizado.' : 'Empleado agregado.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSavingEntity(false);
    }
  };

  const toggleEmployee = async (employee) => {
    try {
      await apiRequest(`/employees/${employee.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...employee, active: !employee.active }),
      }, token);
      await loadDashboard();
    } catch (error) {
      setMessage(error.message);
    }
  };

  const updateShiftPreference = async (employee, shiftPreference) => {
    setSavingPreference(employee.id);
    try {
      const updated = await apiRequest(`/employees/${employee.id}`, {
        method: 'PUT', body: JSON.stringify({ shiftPreference }),
      }, token);
      setEmployees((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage('Preferencia guardada. Se aplicará al generar nuevas propuestas; los turnos actuales se pueden cambiar desde el calendario.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSavingPreference(null);
    }
  };

  const updateEmployeeFunction = async (employee, jobFunctionId) => {
    if (jobFunctionId === (employee.jobFunctionId || '')) return;
    try {
      const updated = await apiRequest(`/employees/${employee.id}`, { method: 'PUT', body: JSON.stringify({ jobFunctionId }) }, token);
      setEmployees((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage('Función guardada. Se aplicará a las próximas propuestas. Revisá los turnos ya asignados si cambiaste de sector.');
    } catch (error) { setMessage(error.message); }
  };

  const saveFunction = async (event) => {
    event.preventDefault();
    setSavingEntity(true);
    try {
      const previousName = jobFunctions.find((item) => item.id === editingFunctionId)?.name;
      await apiRequest(editingFunctionId ? `/job-functions/${editingFunctionId}` : '/job-functions', { method: editingFunctionId ? 'PUT' : 'POST', body: JSON.stringify(functionForm) }, token);
      if (functionFilter === previousName) setFunctionFilter(functionForm.name.trim());
      setFunctionForm({ name: '', description: '' });
      setEditingFunctionId(null);
      await loadDashboard();
      setMessage(editingFunctionId ? 'Función actualizada. Las asignaciones se conservan.' : 'Función creada. Ya podés asignarla a empleados y tipos de turno.');
    } catch (error) { setMessage(error.message); }
    finally { setSavingEntity(false); }
  };

  const saveSpecialDay = async (event) => {
    event.preventDefault();
    setSavingEntity(true);
    try {
      await apiRequest(editingSpecialDayId ? `/special-days/${editingSpecialDayId}` : '/special-days', { method: editingSpecialDayId ? 'PUT' : 'POST', body: JSON.stringify(specialDayForm) }, token);
      setEditingSpecialDayId(null);
      setSpecialDayForm(newSpecialDayForm());
      await loadDashboard();
      setMessage('Regla guardada. Generá una nueva propuesta mensual para aplicarla; los turnos ya cargados se conservan.');
    } catch (error) { setMessage(error.message); }
    finally { setSavingEntity(false); }
  };

  const deleteSpecialDay = async (rule) => {
    if (!window.confirm(`¿Eliminar la regla “${rule.name}”? Los turnos ya generados se conservan.`)) return;
    setSavingEntity(true);
    try {
      await apiRequest(`/special-days/${rule.id}`, { method: 'DELETE' }, token);
      if (editingSpecialDayId === rule.id) { setEditingSpecialDayId(null); setSpecialDayForm(newSpecialDayForm()); }
      await loadDashboard();
      setMessage('Regla eliminada. Las próximas propuestas usarán la dotación habitual para ese día.');
    } catch (error) { setMessage(error.message); }
    finally { setSavingEntity(false); }
  };

  const toggleSpecialDay = async (rule) => {
    setSavingEntity(true);
    try {
      await apiRequest(`/special-days/${rule.id}`, { method: 'PUT', body: JSON.stringify({ active: !rule.active }) }, token);
      await loadDashboard();
      setMessage('Estado actualizado. El cambio se aplicará al generar una nueva propuesta.');
    } catch (error) { setMessage(error.message); }
    finally { setSavingEntity(false); }
  };

  const deleteFunction = async (jobFunction) => {
    if (!window.confirm(`¿Eliminar la función “${jobFunction.name}”?`)) return;
    setSavingEntity(true);
    try {
      await apiRequest(`/job-functions/${jobFunction.id}`, { method: 'DELETE' }, token);
      if (editingFunctionId === jobFunction.id) { setEditingFunctionId(null); setFunctionForm({ name: '', description: '' }); }
      if (functionFilter === jobFunction.name) setFunctionFilter('');
      await loadDashboard();
      setMessage('Función eliminada.');
    } catch (error) { setMessage(error.message); }
    finally { setSavingEntity(false); }
  };

  const changeCalendarShift = async (assignment, shiftTypeId) => {
    const type = shiftTypes.find((item) => item.id === shiftTypeId);
    if (!type) return;
    const assignmentKey = assignment.source === 'manual' ? assignment.id : `proposal-${assignment.proposalIndex}`;
    const conflict = calendarAssignments.some((item) => {
      const sameAssignment = assignment.source === item.source && (assignment.source === 'manual' ? item.id === assignment.id : item.proposalId === assignment.proposalId && item.proposalIndex === assignment.proposalIndex);
      return !sameAssignment && item.employeeId === assignment.employeeId && item.date === assignment.date && item.startTime < type.endTime && item.endTime > type.startTime;
    });
    if (conflict) { setMessage('Ese horario se superpone con otro turno del empleado.'); return; }
    setSavingAssignment(assignmentKey);
    try {
      if (assignment.source === 'manual') {
        const updated = await apiRequest(`/shifts/${assignment.id}`, {
          method: 'PUT', body: JSON.stringify({ shiftTypeId: type.id, shiftTypeName: type.name, startTime: type.startTime, endTime: type.endTime, partial: false }),
        }, token);
        setShifts((current) => current.map((item) => item.id === updated.id ? updated : item));
      } else {
        const updated = await apiRequest(`/schedules/proposals/${assignment.proposalId || proposal.id}/assignments/${assignment.proposalIndex}`, {
          method: 'PUT', body: JSON.stringify({ shiftTypeId }),
        }, token);
        setProposal(updated);
      }
      await loadDashboard();
      setMessage(assignment.source === 'proposal' ? 'Turno actualizado. Revisá la propuesta y confirmala nuevamente.' : 'Turno actualizado.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSavingAssignment(null);
    }
  };

  const preferenceSelect = (employee) => (
    <select className="preference-select" aria-label={`Preferencia de turno de ${employee.name}`} value={employee.shiftPreference || 'flexible'} disabled={savingPreference !== null} onChange={(event) => updateShiftPreference(employee, event.target.value)}>
      {SHIFT_PREFERENCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );

  const functionSelect = (value, onChange, emptyLabel = 'Sin función asignada') => (
    <select value={value || ''} disabled={savingEntity} onChange={(event) => onChange(event.target.value)}>
      <option value="">{emptyLabel}</option>
      {jobFunctions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
  );

  const deleteEmployee = async (employeeId) => {
    if (!window.confirm('¿Eliminar este empleado?')) return;
    try {
      await apiRequest(`/employees/${employeeId}`, { method: 'DELETE' }, token);
      await loadDashboard();
      if (editingEmployeeId === employeeId) { setEditingEmployeeId(null); setEmployeeForm({ ...EMPTY_EMPLOYEE }); }
    } catch (error) {
      setMessage(error.message);
    }
  };

  const updateEmployeeRestDays = async (event) => {
    event.preventDefault();
    if (!restDayForm.employeeId) {
      setMessage('Seleccioná un empleado.');
      return;
    }

    try {
      await apiRequest(`/employees/${restDayForm.employeeId}/rest-days`, {
        method: 'PUT',
        body: JSON.stringify({ restDays: restDayForm.days }),
      }, token);
      setMessage('Descansos actualizados.');
      await loadDashboard();
    } catch (error) {
      setMessage(error.message);
    }
  };

  const onRestDayToggle = (day) => {
    setRestDayForm((current) => {
      const days = current.days.includes(day)
        ? current.days.filter((item) => item !== day)
        : [...current.days, day];

      return { ...current, days };
    });
  };

  const createShiftType = async (event) => {
    event.preventDefault();
    if (!shiftTypeForm.name.trim()) {
      setMessage('Ingresá un nombre para el tipo de turno.');
      return;
    }

    setSavingEntity(true);
    try {
      await apiRequest(editingShiftTypeId ? `/shiftTypes/${editingShiftTypeId}` : '/shiftTypes', {
        method: editingShiftTypeId ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...shiftTypeForm,
          requiredEmployees: Number(shiftTypeForm.requiredEmployees || 1),
          durationMinutes: Math.max(
            30,
            Math.round(
              (new Date(`1970-01-01T${shiftTypeForm.endTime}:00`) - new Date(`1970-01-01T${shiftTypeForm.startTime}:00`)) / 60000,
            ),
          ),
        }),
      }, token);

      setShiftTypeForm({ ...EMPTY_SHIFT_TYPE });
      setEditingShiftTypeId(null);
      await loadDashboard();
      setMessage(editingShiftTypeId ? 'Tipo de turno actualizado. Los turnos ya asignados conservan sus horarios.' : 'Tipo de turno creado.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSavingEntity(false);
    }
  };

  const toggleShiftType = async (shiftType) => {
    try {
      await apiRequest(`/shiftTypes/${shiftType.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...shiftType, active: !shiftType.active }),
      }, token);
      await loadDashboard();
    } catch (error) {
      setMessage(error.message);
    }
  };

  const deleteShiftType = async (shiftTypeId) => {
    if (!window.confirm('¿Eliminar este tipo de turno? Los turnos ya asignados conservarán sus horarios.')) return;
    try {
      await apiRequest(`/shiftTypes/${shiftTypeId}`, { method: 'DELETE' }, token);
      await loadDashboard();
      if (editingShiftTypeId === shiftTypeId) { setEditingShiftTypeId(null); setShiftTypeForm({ ...EMPTY_SHIFT_TYPE }); }
    } catch (error) {
      setMessage(error.message);
    }
  };

  const createManualShift = async (event) => {
    event.preventDefault();
    if (!shiftForm.employeeId || !shiftForm.date || !shiftForm.startTime || !shiftForm.endTime) {
      setMessage('Completa empleado, fecha, inicio y fin del turno.');
      return;
    }

    setSavingEntity(true);
    try {
      await apiRequest(editingShiftId ? `/shifts/${editingShiftId}` : '/shifts', {
        method: editingShiftId ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...shiftForm,
          partial: Boolean(shiftForm.partial),
          shiftTypeId: '',
          shiftTypeName: '',
        }),
      }, token);

      setShiftForm({
        employeeId: '',
        date: new Date().toISOString().slice(0, 10),
        startTime: '08:00',
        endTime: '12:00',
        partial: false,
        notes: '',
      });
      setEditingShiftId(null);
      await loadDashboard();
      setMessage(editingShiftId ? 'Horario manual actualizado.' : 'Turno creado manualmente.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSavingEntity(false);
    }
  };

  const deleteManualShift = async (shiftId) => {
    if (!window.confirm('¿Eliminar este turno manual?')) return;
    try {
      await apiRequest(`/shifts/${shiftId}`, { method: 'DELETE' }, token);
      await loadDashboard();
      if (editingShiftId === shiftId) setEditingShiftId(null);
    } catch (error) {
      setMessage(error.message);
    }
  };

  const generateProposal = async () => {
    setLoading(true);
    try {
      const nextProposal = await apiRequest('/schedules/generate', {
        method: 'POST',
        body: JSON.stringify({ period: 'month', month: calendarMonth }),
      }, token);

      setProposal(nextProposal);
      await loadDashboard();
      setMessage('Propuesta mensual generada. Revisá la cobertura por función antes de confirmar.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };


  const confirmProposal = async () => {
    if (!proposal?.id) {
      setMessage('Primero genera una propuesta para confirmarla.');
      return;
    }

    setLoading(true);
    try {
      const confirmedProposal = await apiRequest('/schedules/confirm', {
        method: 'POST',
        body: JSON.stringify({ proposalId: proposal.id }),
      }, token);

      setProposal(confirmedProposal);
      await loadDashboard();
      setMessage('Propuesta confirmada correctamente.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };
  const overviewCards = useMemo(
    () => [
      { label: 'Empleados activos', value: summary?.activeEmployees ?? 0 },
      { label: 'Tipos de turno', value: summary?.activeShiftTypes ?? 0 },
      { label: 'Turnos registrados', value: summary?.shifts ?? 0 },
      {
        label: 'Cobertura',
        value: proposal?.status === 'confirmed' ? 'Propuesta confirmada' : proposal ? 'Propuesta pendiente' : 'Pendiente',
      },
    ],
    [summary, proposal],
  );

  const calendarDates = useMemo(
    () => {
      if (calendarView === 'week') return Array.from({ length: 7 }, (_, index) => shiftDate(calendarWeekStart, index));
      const [year, month] = calendarMonth.split('-').map(Number);
      return Array.from({ length: new Date(year, month, 0).getDate() }, (_, index) => new Date(year, month - 1, index + 1));
    },
    [calendarWeekStart, calendarMonth, calendarView],
  );
  useEffect(() => {
    const matching = proposals.filter((item) => item.month === calendarMonth || (!item.month && item.dates?.some((date) => date.startsWith(calendarMonth))));
    setProposal(matching.find((item) => item.period === 'month') || matching[0] || null);
  }, [proposals, calendarMonth]);

  const functionOptions = jobFunctions.map((item) => item.name);
  const filteredEmployees = employees.filter((employee) => !functionFilter || normalizeFunction(employee.jobFunction) === normalizeFunction(functionFilter));
  const sortedEmployees = [...filteredEmployees].sort((a, b) => normalizeFunction(a.jobFunction).localeCompare(normalizeFunction(b.jobFunction), 'es') || a.name.localeCompare(b.name, 'es'));
  const moveCalendar = (amount) => {
    if (calendarView === 'week') {
      const next = shiftDate(calendarWeekStart, amount * 7);
      setCalendarWeekStart(next);
      setCalendarMonth(dateKey(shiftDate(next, 3)).slice(0, 7));
    } else {
      const [year, month] = calendarMonth.split('-').map(Number);
      const next = new Date(year, month - 1 + amount, 1);
      setCalendarMonth(dateKey(next).slice(0, 7));
      setCalendarWeekStart(startOfWeek(next));
    }
  };
  const calendarAssignments = useMemo(
    () => {
      const generated = calendarDates.flatMap((date) => {
        const key = dateKey(date);
        const selected = proposals.find((item) => item.month === key.slice(0, 7)) || proposals.find((item) => item.dates?.includes(key));
        return (selected?.assignments || []).map((assignment, proposalIndex) => ({ ...assignment, source: 'proposal', proposalIndex, proposalId: selected.id, proposalStatus: selected.status })).filter((item) => item.date === key);
      });
      return [...shifts.map((shift) => ({ ...shift, source: 'manual' })), ...generated];
    },
    [shifts, proposals, calendarDates],
  );

  const proposalForDate = (date) => proposals.find((item) => item.month === date.slice(0, 7)) || proposals.find((item) => item.dates?.includes(date));
  const rulesForDate = (date) => {
    const saved = proposalForDate(date);
    return saved ? saved.specialDayRules || [] : specialDays;
  };

  const weeklyAssignments = calendarAssignments.filter((item) => item.date >= dateKey(calendarDates[0]) && item.date <= dateKey(calendarDates[calendarDates.length - 1]));
  const weeklyCoverage = shiftTypes.filter((type) => type.active !== false && (!functionFilter || !type.jobFunction || normalizeFunction(type.jobFunction) === normalizeFunction(functionFilter))).map((type) => {
    const dailyCounts = calendarDates.map((date) => {
      const assignments = weeklyAssignments.filter((item) => item.date === dateKey(date) && matchesFunction(employees.find((employee) => employee.id === item.employeeId) || item, type));
      // Split at every assignment boundary so partial shifts cannot hide a staffing gap.
      const boundaries = [...new Set([type.startTime, type.endTime, ...assignments.flatMap((item) => [item.startTime, item.endTime])])]
        .filter((time) => time >= type.startTime && time <= type.endTime).sort();
      const counts = boundaries.slice(0, -1).map((start, index) => new Set(assignments
        .filter((item) => item.startTime <= start && item.endTime >= boundaries[index + 1])
        .map((item) => item.employeeId)).size);
      return counts.length ? Math.min(...counts) : 0;
    });
    const required = Number(type.requiredEmployees || 1);
    const dailyRequirements = calendarDates.map((date) => requiredForDate(type, dateKey(date), rulesForDate(dateKey(date))));
    const demandedDays = dailyRequirements.filter((count) => count > 0).length;
    const coveredDays = dailyCounts.filter((count, index) => dailyRequirements[index] > 0 && count >= dailyRequirements[index]).length;
    return { ...type, required, dailyCounts, demandedDays, coveredDays, variableStaffing: dailyRequirements.some((count) => count !== required) };
  });
  const uncoveredSlots = weeklyCoverage.reduce((total, type) => total + type.demandedDays - type.coveredDays, 0);
  const proposalInWeek = proposal?.dates?.some((date) => date >= dateKey(calendarDates[0]) && date <= dateKey(calendarDates[calendarDates.length - 1]));

  if (!token || !user) {
    return (
      <div className="auth-shell">
        <form className="auth-card" onSubmit={login}>
          <h1>Gestor de Turnos</h1>
          <p>Ingresá con tus credenciales de administrador.</p>

          <label>
            Email
            <input
              type="email"
              value={authForm.email}
              onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
            />
          </label>

          <label>
            Contraseña
            <input
              type="password"
              value={authForm.password}
              onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
            />
          </label>

          <button type="submit" disabled={loading}>{loading ? 'Ingresando…' : 'Iniciar sesión'}</button>
          {message && <small>{message}</small>}
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setActiveTab('calendario'); }}><span className="brand-mark">▦</span>Gestor de Turnos</a>
        <span className="sidebar-label">ORGANIZACIÓN</span>
        <nav className="tabs" aria-label="Navegación principal">
          {[['calendario', '▦', 'Calendario'], ['empleados', '♧', 'Empleados'], ['funciones', '◇', 'Funciones'], ['turnos', '◷', 'Tipos de turno'], ['dias-especiales', '☆', 'Días especiales'], ['cobertura', '◴', 'Cobertura'], ['propuesta', '▤', 'Propuestas']].map(([tab, icon, label]) => (
            <button key={tab} type="button" className={activeTab === tab ? 'tab active' : 'tab'} aria-current={activeTab === tab ? 'page' : undefined} onClick={() => setActiveTab(tab)}><span aria-hidden="true">{icon}</span>{label}</button>
          ))}
        </nav>
        <div className="sidebar-footer"><span className="employee-avatar">{user.name?.charAt(0).toUpperCase()}</span><div><strong>{user.name}</strong><small>Administración</small></div></div>
      </aside>
      <main className="main-content">
      <header className="topbar">
        <div>
          <span className="eyebrow">TU EQUIPO, BIEN ORGANIZADO</span>
          <h2>{activeTab === 'calendario' ? 'Planificación mensual' : activeTab === 'turnos' ? 'Tipos de turno' : activeTab === 'funciones' ? 'Funciones y sectores' : activeTab === 'dias-especiales' ? 'Días especiales' : activeTab === 'propuesta' ? 'Propuestas mensuales' : activeTab === 'cobertura' ? 'Cobertura del equipo' : 'Empleados'}</h2>
          <small>Gestioná los horarios y descansos de tu equipo.</small>
        </div>
        <button onClick={logout} className="secondary">Cerrar sesión</button>
      </header>

      {activeTab !== 'calendario' && <section className="overview-grid">
        {overviewCards.map((card) => (
          <div key={card.label} className="card overview-card">
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </div>
        ))}
      </section>}

      {message && <div className="status-banner" role="status">{message}</div>}

      {activeTab === 'dias-especiales' && (
        <div className="panel-grid">
          <form id="special-day-form" className="card form-card" onSubmit={saveSpecialDay}>
            <h3>{editingSpecialDayId ? 'Editar día especial' : 'Agregar día especial'}</h3>
            <p className="muted">Definí la dotación de un día recurrente o una fecha puntual. Por ejemplo: domingos con 2 personas de mañana y 2 de tarde.</p>
            <label>Nombre<input required maxLength="100" value={specialDayForm.name} placeholder="Ej. Domingo reducido" onChange={(event) => setSpecialDayForm({ ...specialDayForm, name: event.target.value })} /></label>
            <div className="split-fields">
              <label>Aplicar a<select value={specialDayForm.mode} onChange={(event) => setSpecialDayForm({ ...specialDayForm, mode: event.target.value })}><option value="weekday">Día de la semana</option><option value="date">Fecha puntual</option></select></label>
              {specialDayForm.mode === 'weekday' ? <label>Día<select value={specialDayForm.weekday} onChange={(event) => setSpecialDayForm({ ...specialDayForm, weekday: event.target.value })}>{WEEK_DAYS.map((day) => <option key={day.key} value={day.key}>{day.label}</option>)}</select></label> : <label>Fecha<input type="date" required value={specialDayForm.date} onChange={(event) => setSpecialDayForm({ ...specialDayForm, date: event.target.value })} /></label>}
            </div>
            <div className="special-requirements">
              <h4>Personas necesarias por turno y función</h4>
              {specialDayForm.requirements.map((requirement, index) => (
                <div className="special-requirement-row" key={index}>
                  <label>Turno<select required value={requirement.shiftTypeId} onChange={(event) => setSpecialDayForm({ ...specialDayForm, requirements: specialDayForm.requirements.map((item, position) => position === index ? { ...item, shiftTypeId: event.target.value } : item) })}>
                    <option value="">Seleccionar turno</option>
                    {shiftTypes.map((type) => <option key={type.id} value={type.id} disabled={specialDayForm.requirements.some((item, position) => position !== index && item.shiftTypeId === type.id)}>{type.name} · {type.jobFunction || 'Todas las funciones'} ({type.startTime}–{type.endTime}){type.active === false ? ' · Inactivo' : ''}</option>)}
                  </select></label>
                  <label>Personas<input type="number" required min="0" max="1000" step="1" value={requirement.requiredEmployees} onChange={(event) => setSpecialDayForm({ ...specialDayForm, requirements: specialDayForm.requirements.map((item, position) => position === index ? { ...item, requiredEmployees: Number(event.target.value) } : item) })} /></label>
                  <button type="button" className="danger small" aria-label={`Quitar turno ${index + 1} de la regla`} onClick={() => setSpecialDayForm({ ...specialDayForm, requirements: specialDayForm.requirements.filter((_, position) => position !== index) })}>Quitar</button>
                </div>
              ))}
              <button type="button" className="secondary small" onClick={() => setSpecialDayForm({ ...specialDayForm, requirements: [...specialDayForm.requirements, { shiftTypeId: '', requiredEmployees: 1 }] })}>+ Agregar turno</button>
              <small className="muted">Cero personas indica que ese turno no se trabaja. Se aplican los tipos de turno activos.</small>
            </div>
            <label className="checkbox-row"><input type="checkbox" checked={specialDayForm.restOthers} onChange={(event) => setSpecialDayForm({ ...specialDayForm, restOthers: event.target.checked })} />El resto del personal descansa</label>
            <p className="rule-explanation">{specialDayForm.restOthers ? 'Solo se generan los turnos indicados, con un turno por persona. Los demás empleados descansan. Los tipos de turno que no incluyas quedan cerrados ese día.' : 'Se ajustan las cantidades de los turnos indicados. Los demás mantienen su dotación habitual y una persona puede tener más de un turno.'}</p>
            {specialDayForm.restOthers && !specialDayForm.requirements.some((item) => item.requiredEmployees > 0) && <div className="coverage-notice">Descanso general: no se generarán turnos ese día.</div>}
            <label className="checkbox-row"><input type="checkbox" checked={specialDayForm.active} onChange={(event) => setSpecialDayForm({ ...specialDayForm, active: event.target.checked })} />Regla activa</label>
            <div className="action-row"><button type="submit" disabled={savingEntity}>{savingEntity ? 'Guardando…' : editingSpecialDayId ? 'Guardar cambios' : 'Crear regla'}</button>{editingSpecialDayId && <button type="button" className="secondary" disabled={savingEntity} onClick={() => { setEditingSpecialDayId(null); setSpecialDayForm(newSpecialDayForm()); }}>Cancelar edición</button>}</div>
          </form>
          <section className="card list-card">
            <h3>Reglas de días especiales <span className="muted">({specialDays.length})</span></h3>
            <label>Buscar regla<input type="search" value={specialDaySearch} onChange={(event) => setSpecialDaySearch(event.target.value)} placeholder="Buscar por nombre" /></label>
            <div className="coverage-notice">Las fechas puntuales tienen prioridad sobre las reglas semanales. Creá una nueva propuesta para aplicar los cambios; las propuestas anteriores conservan las reglas con las que se generaron.</div>
            <ul className="list special-day-list">
              {specialDays.filter((rule) => normalizeFunction(rule.name).includes(normalizeFunction(specialDaySearch))).map((rule) => (
                <li key={rule.id}>
                  <div>
                    <strong>{rule.name} <span className={`rule-status${rule.active === false ? ' inactive' : ''}`}>{rule.active === false ? 'Inactiva' : 'Activa'}</span></strong>
                    <small>{rule.mode === 'weekday' ? `Todos los ${WEEK_DAYS.find((day) => day.key === rule.weekday)?.label.toLocaleLowerCase('es-AR')}` : new Date(`${rule.date}T12:00:00`).toLocaleDateString('es-AR')}</small>
                    {rule.requirements.map((item) => { const type = shiftTypes.find((entry) => entry.id === item.shiftTypeId); return <small key={item.shiftTypeId}>{type?.name || 'Turno no disponible'} · {type?.jobFunction || 'Todas las funciones'}: {item.requiredEmployees} personas{type?.active === false ? ' · Inactivo' : ''}</small>; })}
                    <small>{rule.restOthers ? rule.requirements.some((item) => item.requiredEmployees > 0) ? 'Un turno por persona; el resto descansa' : 'Descanso para todo el equipo' : 'Los demás turnos mantienen la dotación habitual'}</small>
                  </div>
                  <div className="action-row">
                    <button type="button" className="secondary small" disabled={savingEntity} onClick={() => { setEditingSpecialDayId(rule.id); setSpecialDayForm({ ...rule, requirements: rule.requirements.map((item) => ({ ...item })), date: rule.date || dateKey(new Date()), weekday: rule.weekday || 'sunday' }); document.getElementById('special-day-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Editar</button>
                    <button type="button" className="secondary small" disabled={savingEntity} onClick={() => toggleSpecialDay(rule)}>{rule.active === false ? 'Activar' : 'Desactivar'}</button>
                    <button type="button" className="danger small" disabled={savingEntity} onClick={() => deleteSpecialDay(rule)}>Eliminar</button>
                  </div>
                </li>
              ))}
            </ul>
            {specialDays.length === 0 && <p className="empty-state">Todavía no hay reglas. Creá una para organizar los domingos, feriados u otros días especiales.</p>}
            {specialDays.length > 0 && !specialDays.some((rule) => normalizeFunction(rule.name).includes(normalizeFunction(specialDaySearch))) && <p className="empty-state">No hay reglas que coincidan con la búsqueda.</p>}
          </section>
        </div>
      )}

      {activeTab === 'funciones' && (
        <div className="panel-grid">
          <form id="function-form" className="card form-card" onSubmit={saveFunction}>
            <h3>{editingFunctionId ? 'Editar función' : 'Agregar función'}</h3>
            <p className="muted">Definí las funciones o sectores de tu organización. Podés crear tantas como necesites.</p>
            <label>Nombre<input required maxLength="80" value={functionForm.name} placeholder="Nombre de la función o sector" onChange={(event) => setFunctionForm({ ...functionForm, name: event.target.value })} /></label>
            <label>Descripción <span className="muted">(opcional)</span><textarea maxLength="500" value={functionForm.description} placeholder="Responsabilidades o tareas de esta función" onChange={(event) => setFunctionForm({ ...functionForm, description: event.target.value })} /></label>
            <div className="action-row"><button type="submit" disabled={savingEntity}>{savingEntity ? 'Guardando…' : editingFunctionId ? 'Guardar cambios' : 'Crear función'}</button>{editingFunctionId && <button type="button" className="secondary" disabled={savingEntity} onClick={() => { setEditingFunctionId(null); setFunctionForm({ name: '', description: '' }); }}>Cancelar edición</button>}</div>
          </form>
          <section className="card list-card">
            <h3>Catálogo de funciones <span className="muted">({jobFunctions.length})</span></h3>
            <label>Buscar función<input type="search" value={functionSearch} onChange={(event) => setFunctionSearch(event.target.value)} placeholder="Buscar por nombre o descripción" /></label>
            <ul className="list">
              {jobFunctions.filter((item) => normalizeFunction(`${item.name} ${item.description || ''}`).includes(normalizeFunction(functionSearch))).map((item) => (
                <li key={item.id}>
                  <div><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}<small>{employees.filter((employee) => employee.jobFunctionId === item.id).length} empleados · {shiftTypes.filter((type) => type.jobFunctionId === item.id).length} tipos de turno</small></div>
                  <div className="action-row"><button type="button" className="secondary small" disabled={savingEntity} onClick={() => { setEditingFunctionId(item.id); setFunctionForm({ name: item.name, description: item.description || '' }); document.getElementById('function-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Editar</button><button type="button" className="danger small" disabled={savingEntity} onClick={() => deleteFunction(item)}>Eliminar</button></div>
                </li>
              ))}
            </ul>
            {jobFunctions.length === 0 && <p className="empty-state">Todavía no hay funciones. Creá la primera y asignala a tu equipo.</p>}
            {jobFunctions.length > 0 && !jobFunctions.some((item) => normalizeFunction(`${item.name} ${item.description || ''}`).includes(normalizeFunction(functionSearch))) && <p className="empty-state">No hay funciones que coincidan con la búsqueda.</p>}
            <small className="muted">Para eliminar una función en uso, primero reasigná sus empleados y tipos de turno.</small>
          </section>
        </div>
      )}

      {activeTab === 'empleados' && (
        <div className="panel-grid">
          <form id="employee-form" className="card form-card" onSubmit={createEmployee}>
            <h3>{editingEmployeeId ? 'Editar empleado' : 'Agregar empleado'}</h3>
            <label>
              Nombre
              <input
                required maxLength="120"
                value={employeeForm.name}
                onChange={(event) => setEmployeeForm({ ...employeeForm, name: event.target.value })}
              />
            </label>
            <label>
              Preferencia de turno
              <select value={employeeForm.shiftPreference} onChange={(event) => setEmployeeForm({ ...employeeForm, shiftPreference: event.target.value })}>
                {SHIFT_PREFERENCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <small className="muted">Mañana: inicio antes de las 12. Tarde: inicio desde las 12. Flexible: cualquier horario.</small>
            </label>
            <label>Función / sector
              {functionSelect(employeeForm.jobFunctionId, (jobFunctionId) => setEmployeeForm({ ...employeeForm, jobFunctionId }))}
            </label>
            <button type="button" className="secondary small" onClick={() => setActiveTab('funciones')}>Administrar funciones</button>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={employeeForm.active}
                onChange={(event) => setEmployeeForm({ ...employeeForm, active: event.target.checked })}
              />
              Activo
            </label>
            <div className="action-row"><button type="submit" disabled={savingEntity}>{savingEntity ? 'Guardando…' : editingEmployeeId ? 'Guardar cambios' : 'Guardar empleado'}</button>{editingEmployeeId && <button type="button" className="secondary" disabled={savingEntity} onClick={() => { setEditingEmployeeId(null); setEmployeeForm({ ...EMPTY_EMPLOYEE }); }}>Cancelar edición</button>}</div>
          </form>

          <div className="card list-card">
            <h3>Equipo</h3>
            <ul className="list">
              {employees.map((employee) => (
                <li key={employee.id}>
                  <div>
                    <strong>{employee.name}</strong>
                    <label className="employee-preference-label">Preferencia de turno{preferenceSelect(employee)}</label>
                    <label className="employee-preference-label">Función / sector{functionSelect(employee.jobFunctionId, (jobFunctionId) => updateEmployeeFunction(employee, jobFunctionId))}</label>
                    <small>{employee.active === false ? 'Inactivo' : 'Activo'} · {employee.restDays?.length ? `Descanso: ${employee.restDays.join(', ')}` : 'Sin descanso semanal definido'}</small>
                  </div>
                  <div className="action-row">
                    <button type="button" className="secondary small" disabled={savingEntity} onClick={() => { setEditingEmployeeId(employee.id); setEmployeeForm({ name: employee.name, active: employee.active !== false, shiftPreference: employee.shiftPreference || 'flexible', jobFunctionId: employee.jobFunctionId || '' }); document.getElementById('employee-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Editar</button>
                    <button type="button" className="secondary small" onClick={() => toggleEmployee(employee)}>
                      {employee.active === false ? 'Activar' : 'Desactivar'}
                    </button>
                    <button type="button" className="danger small" onClick={() => deleteEmployee(employee.id)}>
                      Eliminar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {employees.length === 0 && <p className="empty-state">Agregá el primer empleado de tu organización.</p>}
          </div>

          <form className="card form-card" onSubmit={updateEmployeeRestDays}>
            <h3>Descanso semanal</h3>
            <label>
              Empleado
              <select
                value={restDayForm.employeeId}
                onChange={(event) => {
                  const selectedEmployee = employees.find((employee) => employee.id === event.target.value);
                  setRestDayForm({
                    employeeId: event.target.value,
                    days: selectedEmployee?.restDays || [],
                  });
                }}
              >
                <option value="">Seleccionar</option>
                {employees.map((employee) => (
                  <option value={employee.id} key={employee.id}>{employee.name}</option>
                ))}
              </select>
            </label>
            <div className="day-grid">
              {WEEK_DAYS.map((day) => (
                <label key={day.key} className="checkbox-row compact">
                  <input
                    type="checkbox"
                    checked={restDayForm.days.includes(day.key)}
                    onChange={() => onRestDayToggle(day.key)}
                  />
                  {day.label}
                </label>
              ))}
            </div>
            <button type="submit">Guardar descanso</button>
          </form>
        </div>
      )}

      {activeTab === 'turnos' && (
        <div className="panel-grid">
          <form id="shift-type-form" className="card form-card" onSubmit={createShiftType}>
            <h3>{editingShiftTypeId ? 'Editar tipo de turno' : 'Crear tipo de turno'}</h3>
            <label>Función que debe cubrir el turno
              {functionSelect(shiftTypeForm.jobFunctionId, (jobFunctionId) => setShiftTypeForm({ ...shiftTypeForm, jobFunctionId }), 'Todas las funciones')}
              <small className="muted">Creá horarios y cantidades por sector. Si lo dejás vacío, el turno admite cualquier función.</small>
            </label>
            <button type="button" className="secondary small" onClick={() => setActiveTab('funciones')}>Administrar funciones</button>
            <label>
              Nombre
              <input
                required maxLength="120"
                value={shiftTypeForm.name}
                onChange={(event) => setShiftTypeForm({ ...shiftTypeForm, name: event.target.value })}
              />
            </label>
            <div className="split-fields">
              <label>
                Inicio
                <input
                  type="time"
                  value={shiftTypeForm.startTime}
                  onChange={(event) => setShiftTypeForm({ ...shiftTypeForm, startTime: event.target.value })}
                />
              </label>
              <label>
                Fin
                <input
                  type="time"
                  value={shiftTypeForm.endTime}
                  onChange={(event) => setShiftTypeForm({ ...shiftTypeForm, endTime: event.target.value })}
                />
              </label>
            </div>
            <div className="split-fields">
              <label>
                Empleados necesarios
                <input
                  type="number"
                  min="1"
                  value={shiftTypeForm.requiredEmployees}
                  onChange={(event) => setShiftTypeForm({ ...shiftTypeForm, requiredEmployees: Number(event.target.value) })}
                />
              </label>
              <label>
                Color
                <input
                  type="color"
                  value={shiftTypeForm.color}
                  onChange={(event) => setShiftTypeForm({ ...shiftTypeForm, color: event.target.value })}
                />
              </label>
            </div>
            <label>
              Observaciones
              <textarea
                value={shiftTypeForm.notes}
                onChange={(event) => setShiftTypeForm({ ...shiftTypeForm, notes: event.target.value })}
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={shiftTypeForm.active}
                onChange={(event) => setShiftTypeForm({ ...shiftTypeForm, active: event.target.checked })}
              />
              Activo
            </label>
            <div className="action-row"><button type="submit" disabled={savingEntity}>{savingEntity ? 'Guardando…' : editingShiftTypeId ? 'Guardar cambios' : 'Guardar turno'}</button>{editingShiftTypeId && <button type="button" className="secondary" disabled={savingEntity} onClick={() => { setEditingShiftTypeId(null); setShiftTypeForm({ ...EMPTY_SHIFT_TYPE }); }}>Cancelar edición</button>}</div>
          </form>

          <div className="card list-card">
            <h3>Turnos configurados</h3>
            <ul className="list compact">
              {shiftTypes.map((shiftType) => (
                <li key={shiftType.id}>
                  <div>
                    <strong>{shiftType.name}</strong>
                    <small>{shiftType.jobFunction || 'Todas las funciones'} · {shiftType.requiredEmployees} personas</small>
                    <small>
                      {shiftType.startTime} - {shiftType.endTime}
                    </small>
                  </div>
                  <div className="action-row">
                    <button type="button" className="secondary small" disabled={savingEntity} onClick={() => { setEditingShiftTypeId(shiftType.id); setShiftTypeForm({ ...EMPTY_SHIFT_TYPE, ...shiftType, jobFunctionId: shiftType.jobFunctionId || '' }); document.getElementById('shift-type-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Editar</button>
                    <span className="badge" style={{ background: shiftType.color || '#60a5fa' }} />
                    <button type="button" className="secondary small" onClick={() => toggleShiftType(shiftType)}>
                      {shiftType.active === false ? 'Activar' : 'Desactivar'}
                    </button>
                    <button type="button" className="danger small" onClick={() => deleteShiftType(shiftType.id)}>
                      Eliminar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {shiftTypes.length === 0 && <p className="empty-state">Creá los horarios y las cantidades de personal que necesitás.</p>}
          </div>
        </div>
      )}

      {activeTab === 'calendario' && (
        <div ref={calendarRef} className={`calendar-layout${calendarFullscreen ? ' calendar-fullscreen' : ''}${expandedCalendar ? ' calendar-expanded' : ''}`} role={expandedCalendar ? 'dialog' : undefined} aria-modal={expandedCalendar ? true : undefined} aria-label={expandedCalendar ? 'Calendario en pantalla completa' : undefined}>
          <form id="manual-shift-form" className="card form-card manual-shift-form" onSubmit={createManualShift}>
            <h3>{editingShiftId ? 'Editar horario manual' : 'Agregar turno manual'}</h3>
            <label>
              Empleado
              <select
                value={shiftForm.employeeId}
                onChange={(event) => setShiftForm({ ...shiftForm, employeeId: event.target.value })}
              >
                <option value="">Seleccionar</option>
                {employees.map((employee) => (
                  <option value={employee.id} key={employee.id}>{employee.name}</option>
                ))}
              </select>
            </label>
            <div className="split-fields">
              <label>
                Fecha
                <input
                  type="date"
                  value={shiftForm.date}
                  onChange={(event) => setShiftForm({ ...shiftForm, date: event.target.value })}
                />
              </label>
              <label className="checkbox-row top-gap">
                <input
                  type="checkbox"
                  checked={shiftForm.partial}
                  onChange={(event) => setShiftForm({ ...shiftForm, partial: event.target.checked })}
                />
                Parcial
              </label>
            </div>
            <div className="split-fields">
              <label>
                Inicio
                <input
                  type="time"
                  value={shiftForm.startTime}
                  onChange={(event) => setShiftForm({ ...shiftForm, startTime: event.target.value })}
                />
              </label>
              <label>
                Fin
                <input
                  type="time"
                  value={shiftForm.endTime}
                  onChange={(event) => setShiftForm({ ...shiftForm, endTime: event.target.value })}
                />
              </label>
            </div>
            <label>
              Observaciones
              <textarea
                value={shiftForm.notes}
                onChange={(event) => setShiftForm({ ...shiftForm, notes: event.target.value })}
              />
            </label>
            <div className="action-row"><button type="submit" disabled={savingEntity}>{savingEntity ? 'Guardando…' : editingShiftId ? 'Guardar cambios' : 'Agregar turno'}</button>{editingShiftId && <button type="button" className="secondary" disabled={savingEntity} onClick={() => { setEditingShiftId(null); setShiftForm({ employeeId: '', date: dateKey(new Date()), startTime: '08:00', endTime: '12:00', partial: false, notes: '' }); }}>Cancelar edición</button>}</div>
          </form>

          <section className="card agenda-card" aria-label="Agenda por función y empleado">
            <div className="agenda-toolbar">
              <div>
                <span className="eyebrow">AGENDA DEL EQUIPO</span>
                <h3>
                  {calendarDates[0].toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })}
                  {' – '}
                  {calendarDates[calendarDates.length - 1].toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </h3>
                <p>{weeklyAssignments.filter((item) => !functionFilter || normalizeFunction(employees.find((employee) => employee.id === item.employeeId)?.jobFunction) === normalizeFunction(functionFilter)).length} turnos · agrupados por función</p>
              </div>
              <div className="agenda-navigation">
                <button ref={fullscreenButtonRef} type="button" className="secondary small fullscreen-toggle" aria-pressed={calendarFullscreen} title={calendarFullscreen ? 'Volver a la vista normal (Esc)' : 'Expandir el calendario a pantalla completa'} onClick={toggleCalendarFullscreen}><span aria-hidden="true">{calendarFullscreen ? '↙' : '⛶'}</span> {calendarFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}</button>
                <button type="button" className="secondary small" aria-label="Período anterior" onClick={() => moveCalendar(-1)}>‹</button>
                <button type="button" className="secondary small" onClick={() => { setCalendarWeekStart(startOfWeek(new Date())); setCalendarMonth(dateKey(new Date()).slice(0, 7)); }}>Hoy</button>
                <button type="button" className="secondary small" aria-label="Período siguiente" onClick={() => moveCalendar(1)}>›</button>
              </div>
            </div>
            <div className="calendar-filters">
              <label>Mes a planificar<input type="month" value={calendarMonth} onChange={(event) => { if (event.target.value) { setCalendarMonth(event.target.value); setCalendarWeekStart(startOfWeek(new Date(`${event.target.value}-01T12:00:00`))); } }} /></label>
              <label>Vista<select value={calendarView} onChange={(event) => setCalendarView(event.target.value)}><option value="month">Mes completo</option><option value="week">Semana</option></select></label>
              <label>Función<select value={functionFilter} onChange={(event) => setFunctionFilter(event.target.value)}><option value="">Todas las funciones</option>{functionOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            </div>

            <div className="agenda-legend">
              <span><i className="legend-dot proposed" /> Propuesta</span>
              <span><i className="legend-dot manual" /> Manual</span>
              {proposalInWeek && proposal?.status === 'confirmed' && <span className="confirmed-label">Propuesta confirmada</span>}
            </div>

            <div className="agenda-scroll">
              <div className="agenda-grid" style={{ gridTemplateColumns: `minmax(160px, 1.4fr) repeat(${calendarDates.length}, minmax(100px, 1fr))`, minWidth: 160 + calendarDates.length * 100 }}>
                <div className="agenda-corner">EQUIPO</div>
                {calendarDates.map((date) => {
                  const isToday = dateKey(date) === dateKey(new Date());
                  const specialDay = specialDayForDate(dateKey(date), rulesForDate(dateKey(date)));
                  return (
                    <div key={dateKey(date)} title={specialDay?.name} className={`agenda-day-heading${isToday ? ' today' : ''}${specialDay ? ' special-day' : ''}`}>
                      <span>{date.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '')}</span>
                      <strong>{date.getDate()}</strong>
                      {specialDay && <span className="special-day-marker">Especial</span>}
                    </div>
                  );
                })}
                {sortedEmployees.map((employee, employeeIndex) => (
                  <Fragment key={employee.id}>
                    {(employeeIndex === 0 || normalizeFunction(sortedEmployees[employeeIndex - 1].jobFunction) !== normalizeFunction(employee.jobFunction)) && <div className="agenda-function-heading">{employee.jobFunction || 'Sin función asignada'}<small>{sortedEmployees.filter((person) => normalizeFunction(person.jobFunction) === normalizeFunction(employee.jobFunction)).length} personas</small></div>}
                    <div className={`agenda-employee${employee.active === false ? ' inactive' : ''}`}>
                      <span className="employee-avatar">{employee.name?.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase()}</span>
                      <span>{employee.name}{employee.active === false && <small>Inactivo</small>}{preferenceSelect(employee)}</span>
                    </div>
                    {calendarDates.map((date) => {
                      const key = dateKey(date);
                      const dayKey = WEEK_DAYS[(date.getDay() + 6) % 7].key;
                      const dayAssignments = calendarAssignments
                        .filter((item) => item.employeeId === employee.id && item.date === key)
                        .sort((first, second) => first.startTime.localeCompare(second.startTime));
                      const specialDay = specialDayForDate(key, rulesForDate(key));
                      const isRestDay = employee.restDays?.includes(dayKey) || (specialDay?.restOthers && proposalForDate(key) && dayAssignments.length === 0);
                      return (
                        <div key={`${employee.id}-${key}`} className={`agenda-cell${isRestDay ? ' rest-day' : ''}`}>
                          {dayAssignments.map((assignment, index) => {
                            const shiftType = shiftTypes.find((item) => item.id === assignment.shiftTypeId);
                            const color = shiftType?.color || (assignment.startTime < '12:00' ? '#60a5fa' : assignment.startTime < '18:00' ? '#fb923c' : '#a78bfa');
                            return (
                              <article
                                key={`${assignment.id || assignment.shiftTypeId || assignment.startTime}-${index}`}
                                className={`agenda-event ${assignment.source}`}
                                style={{ '--event-color': color }}
                              >
                                <strong>{assignment.startTime}–{assignment.endTime}</strong>
                                <span>{assignment.shiftTypeName || (assignment.partial ? 'Turno parcial' : 'Turno manual')}</span>
                                <small>{assignment.source === 'manual' ? 'Manual' : assignment.proposalStatus === 'confirmed' ? 'Confirmado' : 'Propuesta'}</small>
                                <select className="calendar-shift-select" aria-label={`Cambiar turno de ${employee.name} el ${key}`} value={assignment.shiftTypeId || ''} disabled={savingAssignment !== null} onChange={(event) => changeCalendarShift(assignment, event.target.value)}>
                                  {!shiftTypes.some((item) => item.id === assignment.shiftTypeId && item.active !== false && matchesFunction(employee, item)) && <option value={assignment.shiftTypeId || ''}>Horario actual</option>}
                                  {shiftTypes.filter((item) => item.active !== false && matchesFunction(employee, item)).map((item) => <option key={item.id} value={item.id}>{item.name} ({item.startTime}–{item.endTime})</option>)}
                                </select>
                                {assignment.source === 'manual' && (
                                  <div className="calendar-event-actions">
                                  <button type="button" className="calendar-edit" aria-label={`Editar horario de ${employee.name} el ${key}`} onClick={() => { setEditingShiftId(assignment.id); setShiftForm({ employeeId: assignment.employeeId, date: assignment.date, startTime: assignment.startTime, endTime: assignment.endTime, partial: Boolean(assignment.partial), notes: assignment.notes || '' }); document.getElementById('manual-shift-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Editar</button>
                                  <button
                                    type="button"
                                    className="agenda-delete"
                                    aria-label={`Eliminar turno de ${employee.name}`}
                                    onClick={() => deleteManualShift(assignment.id)}
                                  >
                                    ×
                                  </button>
                                  </div>
                                )}
                              </article>
                            );
                          })}
                          {isRestDay && dayAssignments.length === 0 && <span className="rest-day-label">Descanso</span>}
                          {dayAssignments.length === 0 && <button type="button" className="calendar-add" aria-label={`Agregar turno de ${employee.name} el ${key}`} onClick={() => {
                            const preferredType = shiftTypes.find((item) => item.active !== false && matchesFunction(employee, item) && (employee.shiftPreference === 'morning' ? item.startTime < '12:00' : employee.shiftPreference === 'afternoon' ? item.startTime >= '12:00' : true));
                            setShiftForm({ employeeId: employee.id, date: key, startTime: preferredType?.startTime || '08:00', endTime: preferredType?.endTime || '12:00', partial: false, notes: '' });
                            setEditingShiftId(null);
                            document.getElementById('manual-shift-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }}>+ Turno</button>}
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
                {sortedEmployees.length === 0 && (
                  <div className="agenda-empty">{employees.length ? 'No hay empleados para esta función.' : 'Agregá empleados y sus funciones para empezar a organizar el mes.'}</div>
                )}
              </div>
            </div>
            {weeklyAssignments.length === 0 && (
              <p className="agenda-empty-note">Todavía no hay turnos para este período. Agregá uno manual o generá el mes completo.</p>
            )}
          </section>
          <aside className="card coverage-card">
            <h3>Cobertura por función</h3>
            <p className="muted">Días con personal suficiente en toda la franja.</p>
            <div className="coverage-items">
              {weeklyCoverage.map((type) => (
                <div className="coverage-item" key={type.id}>
                  <strong>{type.name}</strong>
                  <small>{type.jobFunction || 'Todas las funciones'}</small>
                  <small>{type.startTime} – {type.endTime} · {type.variableStaffing ? 'Dotación según el día' : `${type.required} necesarios`}</small>
                  <progress value={type.demandedDays ? type.coveredDays : 1} max={type.demandedDays || 1} aria-label={`Días cubiertos de ${type.name}`} />
                  <div className="coverage-caption"><span>{type.demandedDays ? `${type.coveredDays} / ${type.demandedDays} días cubiertos` : 'Sin demanda en el período'}</span><span className={type.coveredDays === type.demandedDays ? 'coverage-ok' : 'coverage-warning'}>{type.coveredDays === type.demandedDays ? 'Completo' : `${type.demandedDays - type.coveredDays} pendientes`}</span></div>
                </div>
              ))}
              {weeklyCoverage.length === 0 && <p className="muted">Configurá los tipos de turno para revisar la cobertura.</p>}
            </div>
            <div className="coverage-notice">{weeklyCoverage.length === 0 ? 'Empezá definiendo los horarios y el personal necesario por función.' : uncoveredSlots > 0 ? `${uncoveredSlots} franjas diarias necesitan personal. Podés agregar turnos o generar el mes completo.` : 'Todas las franjas de este período tienen personal suficiente.'}</div>
            <button type="button" onClick={generateProposal} disabled={loading}>{loading ? 'Generando…' : '✧ Generar mes completo'}</button>
            {proposalInWeek && proposal.status !== 'confirmed' && <button type="button" className="secondary" onClick={() => setActiveTab('propuesta')}>Revisar y confirmar</button>}
            <small className="muted">Se genera todo {new Date(`${calendarMonth}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}, para todas las funciones. Revisá la propuesta antes de confirmar.</small>
          </aside>
        </div>
      )}

      {activeTab === 'cobertura' && (
        <div className="panel-grid single-column">
          <div className="card list-card">
            <h3>Cobertura por horas</h3>
            <div className="calendar-filters"><label>Mes<input type="month" value={calendarMonth} onChange={(event) => { if (event.target.value) setCalendarMonth(event.target.value); }} /></label><label>Función<select value={functionFilter} onChange={(event) => setFunctionFilter(event.target.value)}><option value="">Todas las funciones</option>{functionOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label></div>
            <ul className="list compact">
              {coverage.length === 0 ? (
                <li><span>No hay cobertura cargada todavía.</span></li>
              ) : (
                coverage.map((slot, index) => (
                  <li key={`${slot.date}-${slot.time}-${index}`}>
                    <div>
                      <strong>{slot.date}</strong>
                      <small>{slot.time}</small>
                    </div>
                    <span>{slot.employees.map((person) => `${person.employeeName}${person.jobFunction ? ` (${person.jobFunction})` : ''}`).join(', ') || 'Sin personal'}</span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}

      {activeTab === 'propuesta' && (
        <div className="panel-grid single-column">
          <div className="card form-card">
            <h3>Generar mes completo</h3>
            <label>Mes<input type="month" value={calendarMonth} onChange={(event) => { if (event.target.value) setCalendarMonth(event.target.value); }} /></label>
            <p>La propuesta se genera primero para revisarla y confirmar después.</p>
            <div className="action-row">
              <button onClick={generateProposal} disabled={loading}>
                {loading ? 'Generando...' : 'Generar mes completo'}
              </button>
              {proposal?.id && proposal.status !== 'confirmed' && (
                <button type="button" className="secondary" onClick={confirmProposal} disabled={loading}>
                  Confirmar propuesta
                </button>
              )}
            </div>
          </div>

          {proposal && (
            <div className="card list-card">
              <h3>Resumen de propuesta · {proposal.status === 'confirmed' ? 'Confirmada' : 'Pendiente'}</h3>
              {proposal.confirmedAt && (
                <p>Confirmada el {new Date(proposal.confirmedAt).toLocaleString('es-AR')}</p>
              )}
              <ul className="list compact">
                {proposal.assignments?.map((assignment) => (
                  <li key={`${assignment.date}-${assignment.employeeId}-${assignment.startTime}`}>
                    <div>
                      <strong>{assignment.employeeName}</strong>
                      <small>
                        {assignment.date} • {assignment.startTime} - {assignment.endTime}
                      </small>
                    </div>
                    <span>{assignment.jobFunction || 'Sin función asignada'} · {assignment.shiftTypeName}</span>
                  </li>
                ))}
              </ul>

              {proposal.warnings?.length > 0 && (
                <div className="warning-box">
                  <h4>Advertencias de cobertura</h4>
                  <ul>
                    {proposal.warnings.map((warning, index) => (
                      <li key={`${warning.date}-${warning.shiftTypeName}-${index}`}>{warning.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </main>
    </div>
  );
}

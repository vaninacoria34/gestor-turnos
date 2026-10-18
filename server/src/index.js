const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { db, isConfigured, isProduction } = require('./config/firebase');
const { hashPassword, comparePassword, signToken, authMiddleware } = require('./lib/auth');
const { generateWeekProposal, generateMonthProposal, buildCoverageMap, buildCoverageWarnings, normalizeFunction, matchesFunction, SHIFT_PREFERENCES, hoursWorked, overlaps, DAY_KEYS, validateSpecialDayAssignment } = require('./lib/schedule');

const app = express();
const PORT = process.env.PORT || 4000;
const memoryStore = {
  users: [],
  employees: [],
  shiftTypes: [],
  shifts: [],
  sundayHistory: [],
  scheduleProposals: [],
  jobFunctions: [],
  specialDays: [],
};

const defaultShiftTypes = [
  {
    name: 'Mañana',
    startTime: '08:00',
    endTime: '12:00',
    durationMinutes: 240,
    requiredEmployees: 2,
    active: true,
    color: '#60a5fa',
    notes: 'Turno matutino estándar.',
  },
  {
    name: 'Tarde',
    startTime: '12:00',
    endTime: '20:00',
    durationMinutes: 480,
    requiredEmployees: 2,
    active: true,
    color: '#f59e0b',
    notes: 'Turno vespertino estándar.',
  },
  {
    name: '8:00 a 16:00',
    startTime: '08:00',
    endTime: '16:00',
    durationMinutes: 480,
    requiredEmployees: 1,
    active: true,
    color: '#34d399',
    notes: 'Turno completo de 8 a 16.',
  },
];

async function getRawCollection(collectionName) {
  if (!isConfigured || !db) {
    return memoryStore[collectionName] || [];
  }

  try {
    const snapshot = await db.collection(collectionName).get();
    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  } catch (error) {
    if (isProduction) throw error;
    return memoryStore[collectionName] || [];
  }
}

async function getCollection(collectionName) {
  const items = await getRawCollection(collectionName);
  if (!['employees', 'shiftTypes'].includes(collectionName)) return items;
  const functions = await getRawCollection('jobFunctions');
  return items.map((item) => {
    const jobFunction = functions.find((entry) => item.jobFunctionId ? entry.id === item.jobFunctionId : normalizeFunction(entry.name) === normalizeFunction(item.jobFunction));
    return jobFunction ? { ...item, jobFunctionId: jobFunction.id, jobFunction: jobFunction.name } : item;
  });
}

let functionQueue = Promise.resolve();
function withFunctionLock(work) {
  const result = functionQueue.then(work);
  functionQueue = result.catch(() => {});
  return result;
}

async function migrateJobFunctions() {
  return withFunctionLock(async () => {
    const functions = [...await getRawCollection('jobFunctions')];
    for (const collection of ['employees', 'shiftTypes']) {
      for (const item of await getRawCollection(collection)) {
        if (item.jobFunctionId || !normalizeFunction(item.jobFunction)) continue;
        let jobFunction = functions.find((entry) => normalizeFunction(entry.name) === normalizeFunction(item.jobFunction));
        if (!jobFunction) {
          jobFunction = await upsertDocument('jobFunctions', { name: item.jobFunction.trim(), description: '', createdAt: new Date().toISOString() });
          functions.push(jobFunction);
        }
        await upsertDocument(collection, { ...item, jobFunctionId: jobFunction.id, jobFunction: jobFunction.name });
      }
    }
    return functions.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  });
}

async function upsertDocument(collectionName, payload) {
  const { id, ...body } = payload;

  if (!isConfigured || !db) {
    const items = memoryStore[collectionName] || [];
    if (id) {
      const existingIndex = items.findIndex((item) => item.id === id);
      if (existingIndex >= 0) {
        items[existingIndex] = { ...items[existingIndex], ...body, id };
      } else {
        items.push({ ...body, id });
      }
      memoryStore[collectionName] = items;
      return { ...body, id };
    }

    const savedItem = { ...body, id: crypto.randomUUID() };
    memoryStore[collectionName] = [...items, savedItem];
    return savedItem;
  }

  try {
    const collection = db.collection(collectionName);
    if (id) {
      await collection.doc(id).set({ ...body });
      return { ...body, id };
    }

    const ref = await collection.add(body);
    return { ...body, id: ref.id };
  } catch (error) {
    if (isProduction) throw error;
    const items = memoryStore[collectionName] || [];
    if (id) {
      const existingIndex = items.findIndex((item) => item.id === id);
      if (existingIndex >= 0) {
        items[existingIndex] = { ...items[existingIndex], ...body, id };
      } else {
        items.push({ ...body, id });
      }
      memoryStore[collectionName] = items;
      return { ...body, id };
    }

    const savedItem = { ...body, id: crypto.randomUUID() };
    memoryStore[collectionName] = [...items, savedItem];
    return savedItem;
  }
}

async function deleteDocument(collectionName, id) {
  if (!isConfigured || !db) {
    const items = memoryStore[collectionName] || [];
    memoryStore[collectionName] = items.filter((item) => item.id !== id);
    return true;
  }

  try {
    await db.collection(collectionName).doc(id).delete();
    return true;
  } catch (error) {
    if (isProduction) throw error;
    const items = memoryStore[collectionName] || [];
    memoryStore[collectionName] = items.filter((item) => item.id !== id);
    return true;
  }
}

async function ensureSeedData() {
  const users = await getCollection('users');
  const email = (isProduction ? process.env.INITIAL_ADMIN_EMAIL : 'admin@gestor-turnos.local')?.trim().toLowerCase();
  const password = isProduction ? process.env.INITIAL_ADMIN_PASSWORD : 'Admin123!';
  const shouldSeedAdmin = isProduction
    ? users.length === 0
    : !users.some((user) => user.email === email);
  if (isProduction && shouldSeedAdmin && (!email || !password)) {
    throw new Error('Configurá INITIAL_ADMIN_EMAIL e INITIAL_ADMIN_PASSWORD para crear el primer administrador.');
  }
  if (isProduction && shouldSeedAdmin && password.length < 12) {
    throw new Error('INITIAL_ADMIN_PASSWORD debe tener al menos 12 caracteres.');
  }
  if (shouldSeedAdmin) {
    const passwordHash = await hashPassword(password);
    await upsertDocument('users', {
      id: 'admin-user',
      email,
      passwordHash,
      name: 'Administrador',
      role: 'admin',
      active: true,
      createdAt: new Date().toISOString(),
    });
  }

  const shiftTypes = await getCollection('shiftTypes');
  if (shouldSeedAdmin && !shiftTypes.length) {
    for (const shiftType of defaultShiftTypes) {
      await upsertDocument('shiftTypes', {
        ...shiftType,
        createdAt: new Date().toISOString(),
      });
    }
  }
  await migrateJobFunctions();
}

app.use(cors());
app.use(express.json());
app.use(['/api/employees', '/api/shiftTypes'], (req, res, next) => {
  if (req.body.jobFunction !== undefined) {
    if (typeof req.body.jobFunction !== 'string' || req.body.jobFunction.trim().length > 80) return res.status(400).json({ message: 'La función debe ser un texto de hasta 80 caracteres.' });
    req.body.jobFunction = req.body.jobFunction.trim();
  }
  next();
});

app.use(['/api/employees', '/api/shiftTypes'], authMiddleware, async (req, res, next) => {
  if (!['POST', 'PUT'].includes(req.method)) return next();
  if (req.body.jobFunctionId === undefined && req.body.jobFunction === undefined) return next();
  if (req.body.jobFunctionId !== undefined && typeof req.body.jobFunctionId !== 'string') return res.status(400).json({ message: 'Seleccioná una función válida.' });
  try {
    await withFunctionLock(async () => {
      let jobFunction;
      if (req.body.jobFunctionId !== undefined) {
        if (req.body.jobFunctionId) {
          jobFunction = (await getRawCollection('jobFunctions')).find((item) => item.id === req.body.jobFunctionId);
          if (!jobFunction) return res.status(400).json({ message: 'La función seleccionada no existe.' });
        }
      } else if (req.body.jobFunction) {
        // Preserve compatibility with clients that previously sent a free-text function.
        jobFunction = (await getRawCollection('jobFunctions')).find((item) => normalizeFunction(item.name) === normalizeFunction(req.body.jobFunction));
        if (!jobFunction) jobFunction = await upsertDocument('jobFunctions', { name: req.body.jobFunction, description: '', createdAt: new Date().toISOString() });
      }
      req.body.jobFunctionId = jobFunction?.id || '';
      req.body.jobFunction = jobFunction?.name || '';
    });
    if (!res.headersSent) next();
  } catch (error) { next(error); }
});

function validateFunctionBody(body) {
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80) return 'Ingresá un nombre de función de entre 1 y 80 caracteres.';
  if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 500)) return 'La descripción debe tener hasta 500 caracteres.';
  return null;
}

app.get('/api/job-functions', authMiddleware, async (req, res, next) => {
  try { return res.json(await migrateJobFunctions()); } catch (error) { next(error); }
});

app.get('/api/job-functions/:id', authMiddleware, async (req, res, next) => {
  try {
    const jobFunction = (await migrateJobFunctions()).find((item) => item.id === req.params.id);
    if (!jobFunction) return res.status(404).json({ message: 'Función no encontrada.' });
    return res.json(jobFunction);
  } catch (error) { next(error); }
});

app.post('/api/job-functions', authMiddleware, async (req, res, next) => {
  const error = validateFunctionBody(req.body);
  if (error) return res.status(400).json({ message: error });
  try {
    await withFunctionLock(async () => {
      const functions = await getRawCollection('jobFunctions');
      if (functions.some((item) => normalizeFunction(item.name) === normalizeFunction(req.body.name))) return res.status(409).json({ message: 'Ya existe una función con ese nombre.' });
      const created = await upsertDocument('jobFunctions', { name: req.body.name.trim(), description: (req.body.description || '').trim(), createdAt: new Date().toISOString() });
      return res.status(201).json(created);
    });
  } catch (error) { next(error); }
});

app.put('/api/job-functions/:id', authMiddleware, async (req, res, next) => {
  const error = validateFunctionBody(req.body);
  if (error) return res.status(400).json({ message: error });
  try {
    await withFunctionLock(async () => {
      const functions = await getRawCollection('jobFunctions');
      const current = functions.find((item) => item.id === req.params.id);
      if (!current) return res.status(404).json({ message: 'Función no encontrada.' });
      if (functions.some((item) => item.id !== current.id && normalizeFunction(item.name) === normalizeFunction(req.body.name))) return res.status(409).json({ message: 'Ya existe una función con ese nombre.' });
      return res.json(await upsertDocument('jobFunctions', { ...current, name: req.body.name.trim(), description: (req.body.description ?? current.description ?? '').trim(), updatedAt: new Date().toISOString() }));
    });
  } catch (error) { next(error); }
});

app.delete('/api/job-functions/:id', authMiddleware, async (req, res, next) => {
  try {
    await withFunctionLock(async () => {
      const current = (await getRawCollection('jobFunctions')).find((item) => item.id === req.params.id);
      if (!current) return res.status(404).json({ message: 'Función no encontrada.' });
      const employees = (await getCollection('employees')).filter((item) => item.jobFunctionId === current.id);
      const types = (await getCollection('shiftTypes')).filter((item) => item.jobFunctionId === current.id);
      if (employees.length || types.length) return res.status(409).json({ message: `La función está asignada a ${employees.length} empleado(s) y ${types.length} tipo(s) de turno. Reasignalos antes de eliminarla.`, employees: employees.map((item) => item.name), shiftTypes: types.map((item) => item.name) });
      await deleteDocument('jobFunctions', current.id);
      return res.json({ ok: true, id: current.id });
    });
  } catch (error) { next(error); }
});

async function validateSpecialDayRule(body, excludedId) {
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) return 'Ingresá un nombre de hasta 100 caracteres para la regla.';
  if (!['weekday', 'date'].includes(body.mode)) return 'Elegí un día de la semana o una fecha puntual.';
  if (body.mode === 'weekday' && !DAY_KEYS.includes(body.weekday)) return 'Elegí un día de la semana válido.';
  if (body.mode === 'date') {
    if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return 'Elegí una fecha válida.';
    const date = new Date(`${body.date}T12:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== body.date) return 'Elegí una fecha válida.';
  }
  if (body.active !== undefined && typeof body.active !== 'boolean') return 'El estado de la regla debe ser activo o inactivo.';
  if (body.restOthers !== undefined && typeof body.restOthers !== 'boolean') return 'Indicá si el resto del personal descansa.';
  if (!Array.isArray(body.requirements) || body.requirements.length > 100) return 'Definí hasta 100 turnos para el día especial.';
  if (body.restOthers === false && !body.requirements.length) return 'Agregá al menos un turno o seleccioná descanso para el resto.';
  const types = await getCollection('shiftTypes');
  const ids = new Set();
  for (const item of body.requirements) {
    if (!item || typeof item.shiftTypeId !== 'string' || !types.some((type) => type.id === item.shiftTypeId)) return 'Seleccioná un tipo de turno existente para cada fila.';
    if (ids.has(item.shiftTypeId)) return 'Cada tipo de turno debe aparecer una sola vez en la regla.';
    if (!Number.isInteger(item.requiredEmployees) || item.requiredEmployees < 0 || item.requiredEmployees > 1000) return 'La cantidad debe ser un número entero entre 0 y 1000. Cero indica que ese turno no se trabaja.';
    ids.add(item.shiftTypeId);
  }
  const rules = await getCollection('specialDays');
  if (rules.some((item) => item.id !== excludedId && item.mode === body.mode && (body.mode === 'date' ? item.date === body.date : item.weekday === body.weekday))) return 'Ya existe una regla para ese día. Editala o eliminála antes de crear otra.';
  return null;
}

function specialDayPayload(body) {
  return {
    name: body.name.trim(), mode: body.mode, weekday: body.mode === 'weekday' ? body.weekday : '', date: body.mode === 'date' ? body.date : '',
    active: body.active !== false, restOthers: body.restOthers !== false,
    requirements: body.requirements.map((item) => ({ shiftTypeId: item.shiftTypeId, requiredEmployees: item.requiredEmployees })),
  };
}

let specialDayQueue = Promise.resolve();
function withSpecialDayLock(work) {
  const result = specialDayQueue.then(work);
  specialDayQueue = result.catch(() => {});
  return result;
}

app.get('/api/special-days', authMiddleware, async (req, res, next) => {
  try { return res.json((await getCollection('specialDays')).sort((a, b) => a.name.localeCompare(b.name, 'es'))); } catch (error) { next(error); }
});

app.get('/api/special-days/:id', authMiddleware, async (req, res, next) => {
  try {
    const rule = (await getCollection('specialDays')).find((item) => item.id === req.params.id);
    return rule ? res.json(rule) : res.status(404).json({ message: 'Regla no encontrada.' });
  } catch (error) { next(error); }
});

app.post('/api/special-days', authMiddleware, async (req, res, next) => {
  try {
    await withSpecialDayLock(async () => {
      const error = await validateSpecialDayRule(req.body);
      if (error) return res.status(error.startsWith('Ya existe') ? 409 : 400).json({ message: error });
      return res.status(201).json(await upsertDocument('specialDays', { ...specialDayPayload(req.body), createdAt: new Date().toISOString() }));
    });
  } catch (error) { next(error); }
});

app.put('/api/special-days/:id', authMiddleware, async (req, res, next) => {
  try {
    await withSpecialDayLock(async () => {
      const current = (await getCollection('specialDays')).find((item) => item.id === req.params.id);
      if (!current) return res.status(404).json({ message: 'Regla no encontrada.' });
      const body = { ...current, ...req.body };
      const error = await validateSpecialDayRule(body, current.id);
      if (error) return res.status(error.startsWith('Ya existe') ? 409 : 400).json({ message: error });
      return res.json(await upsertDocument('specialDays', { ...current, ...specialDayPayload(body), updatedAt: new Date().toISOString() }));
    });
  } catch (error) { next(error); }
});

app.delete('/api/special-days/:id', authMiddleware, async (req, res, next) => {
  try {
    await withSpecialDayLock(async () => {
      if (!(await getCollection('specialDays')).some((item) => item.id === req.params.id)) return res.status(404).json({ message: 'Regla no encontrada.' });
      await deleteDocument('specialDays', req.params.id);
      return res.json({ ok: true, id: req.params.id });
    });
  } catch (error) { next(error); }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'Gestor de Turnos', status: 'running' });
});

app.post('/api/auth/register', async (req, res) => {
  if (isProduction) {
    return res.status(403).json({ message: 'El registro público está deshabilitado en producción.' });
  }

  try {
    const { name, email, password, role = 'admin' } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email y contraseña son requeridos.' });
    }

    const users = await getCollection('users');
    const existingUser = users.find((user) => user.email === email.toLowerCase());
    if (existingUser) {
      return res.status(409).json({ message: 'Ya existe un usuario con ese email.' });
    }

    const passwordHash = await hashPassword(password);
    const createdUser = await upsertDocument('users', {
      email: email.toLowerCase(),
      passwordHash,
      name: name || 'Usuario',
      role,
      active: true,
      createdAt: new Date().toISOString(),
    });

    const token = signToken(createdUser);
    return res.status(201).json({
      token,
      user: {
        id: createdUser.id,
        name: createdUser.name,
        email: createdUser.email,
        role: createdUser.role,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'No se pudo registrar el usuario.', error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email y contraseña son requeridos.' });
    }

    const users = await getCollection('users');
    const currentUser = users.find((user) => user.email === email.toLowerCase());
    if (!currentUser) {
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    const isValidPassword = await comparePassword(password, currentUser.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    const token = signToken(currentUser);
    return res.json({
      token,
      user: {
        id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email,
        role: currentUser.role,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'No se pudo iniciar sesión.', error: error.message });
  }
});

app.get('/api/employees', authMiddleware, async (req, res) => {
  const employees = await getCollection('employees');
  return res.json(employees);
});

app.post('/api/employees', authMiddleware, async (req, res) => {
  if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 120) return res.status(400).json({ message: 'Ingresá un nombre de empleado de hasta 120 caracteres.' });
  const shiftPreference = req.body.shiftPreference ?? 'flexible';
  if (!SHIFT_PREFERENCES.includes(shiftPreference)) return res.status(400).json({ message: 'Seleccioná flexible, mañana o tarde.' });
  const employee = await upsertDocument('employees', {
    ...req.body,
    shiftPreference,
    jobFunction: req.body.jobFunction || '',
    active: req.body.active !== false,
    deleted: false,
    restDays: req.body.restDays || [],
    createdAt: new Date().toISOString(),
  });
  return res.status(201).json(employee);
});

app.put('/api/employees/:id', authMiddleware, async (req, res) => {
  if (req.body.name !== undefined && (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 120)) return res.status(400).json({ message: 'Ingresá un nombre de empleado de hasta 120 caracteres.' });
  const existing = await getCollection('employees');
  const current = existing.find((item) => item.id === req.params.id);
  if (!current) return res.status(404).json({ message: 'Empleado no encontrado.' });

  const shiftPreference = req.body.shiftPreference ?? current.shiftPreference ?? 'flexible';
  if (!SHIFT_PREFERENCES.includes(shiftPreference)) return res.status(400).json({ message: 'Seleccioná flexible, mañana o tarde.' });

  const employee = await upsertDocument('employees', {
    ...current,
    ...req.body,
    id: req.params.id,
    shiftPreference,
    active: req.body.active === undefined ? current.active !== false : req.body.active !== false,
    restDays: req.body.restDays || current.restDays || [],
    updatedAt: new Date().toISOString(),
  });

  return res.json(employee);
});

app.delete('/api/employees/:id', authMiddleware, async (req, res) => {
  await deleteDocument('employees', req.params.id);
  return res.json({ ok: true, id: req.params.id });
});

app.get('/api/shiftTypes', authMiddleware, async (req, res) => {
  const shiftTypes = await getCollection('shiftTypes');
  return res.json(shiftTypes);
});

function validateShiftType(type) {
  if (typeof type.name !== 'string' || !type.name.trim() || type.name.trim().length > 120) return 'Ingresá un nombre de turno de hasta 120 caracteres.';
  const validTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!validTime.test(type.startTime) || !validTime.test(type.endTime) || type.startTime >= type.endTime) return 'Ingresá un horario válido, con fin posterior al inicio.';
  if (!Number.isInteger(Number(type.requiredEmployees ?? 1)) || Number(type.requiredEmployees ?? 1) < 1) return 'La cantidad de empleados debe ser un número entero mayor a cero.';
  return null;
}

app.post('/api/shiftTypes', authMiddleware, async (req, res) => {
  const error = validateShiftType(req.body);
  if (error) return res.status(400).json({ message: error });
  const shiftType = await upsertDocument('shiftTypes', {
    ...req.body,
    jobFunction: req.body.jobFunction || '',
    active: req.body.active !== false,
    requiredEmployees: Number(req.body.requiredEmployees || 1),
    durationMinutes: Number(req.body.durationMinutes || 60),
    createdAt: new Date().toISOString(),
  });
  return res.status(201).json(shiftType);
});

app.put('/api/shiftTypes/:id', authMiddleware, async (req, res) => {
  const existing = await getCollection('shiftTypes');
  const current = existing.find((item) => item.id === req.params.id);
  if (!current) return res.status(404).json({ message: 'Tipo de turno no encontrado.' });
  const error = validateShiftType({ ...current, ...req.body });
  if (error) return res.status(400).json({ message: error });

  const shiftType = await upsertDocument('shiftTypes', {
    ...current,
    ...req.body,
    id: req.params.id,
    active: req.body.active === undefined ? current.active !== false : req.body.active !== false,
    requiredEmployees: Number(req.body.requiredEmployees || current.requiredEmployees || 1),
    durationMinutes: Number(req.body.durationMinutes || current.durationMinutes || 60),
    updatedAt: new Date().toISOString(),
  });

  return res.json(shiftType);
});

app.delete('/api/shiftTypes/:id', authMiddleware, async (req, res) => {
  const rules = (await getCollection('specialDays')).filter((item) => item.requirements?.some((requirement) => requirement.shiftTypeId === req.params.id));
  if (rules.length) return res.status(409).json({ message: `Este turno se usa en las reglas: ${rules.map((item) => item.name).join(', ')}. Quitalo de esas reglas antes de eliminarlo.` });
  await deleteDocument('shiftTypes', req.params.id);
  return res.json({ ok: true, id: req.params.id });
});

app.get('/api/shifts', authMiddleware, async (req, res) => {
  const shifts = await getCollection('shifts');
  return res.json(shifts);
});

async function validateShiftFunction(employeeId, shiftTypeId) {
  if (!shiftTypeId) return null;
  const [employees, types] = await Promise.all([getCollection('employees'), getCollection('shiftTypes')]);
  const employee = employees.find((item) => item.id === employeeId);
  const type = types.find((item) => item.id === shiftTypeId && item.active !== false);
  if (!type) return 'Tipo de turno no encontrado o inactivo.';
  if (!employee || !matchesFunction(employee, type)) return 'El turno corresponde a otra función del empleado.';
  return null;
}

async function validateManualShift(shift, excludedId) {
  if (typeof shift.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(shift.date)) return 'Seleccioná una fecha válida.';
  const date = new Date(`${shift.date}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== shift.date) return 'Seleccioná una fecha válida.';
  const validTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!validTime.test(shift.startTime) || !validTime.test(shift.endTime) || shift.startTime >= shift.endTime) return 'El fin del turno debe ser posterior al inicio.';
  const employees = await getCollection('employees');
  if (!employees.some((item) => item.id === shift.employeeId)) return 'Seleccioná un empleado existente.';
  const manual = await getCollection('shifts');
  const proposals = (await getCollection('scheduleProposals')).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const currentProposal = proposals.find((item) => item.month === shift.date.slice(0, 7)) || proposals.find((item) => item.dates?.includes(shift.date));
  const assignments = [...manual.filter((item) => item.id !== excludedId), ...(currentProposal?.assignments || [])];
  if (assignments.some((item) => item.employeeId === shift.employeeId && item.date === shift.date && overlaps(item.startTime, item.endTime, shift.startTime, shift.endTime))) return 'El horario se superpone con otro turno del empleado.';
  const specialDays = currentProposal ? currentProposal.specialDayRules || [] : await getCollection('specialDays');
  return validateSpecialDayAssignment(shift, assignments, await getCollection('shiftTypes'), employees, specialDays);
}

app.post('/api/shifts', authMiddleware, async (req, res) => {
  const validationError = await validateManualShift(req.body);
  if (validationError) return res.status(400).json({ message: validationError });
  const error = await validateShiftFunction(req.body.employeeId, req.body.shiftTypeId);
  if (error) return res.status(400).json({ message: error });
  const shift = await upsertDocument('shifts', {
    ...req.body,
    date: req.body.date || new Date().toISOString().slice(0, 10),
    partial: Boolean(req.body.partial),
    createdAt: new Date().toISOString(),
  });
  return res.status(201).json(shift);
});

app.put('/api/shifts/:id', authMiddleware, async (req, res) => {
  const existing = await getCollection('shifts');
  const current = existing.find((item) => item.id === req.params.id);
  if (!current) return res.status(404).json({ message: 'Turno no encontrado.' });
  const validationError = await validateManualShift({ ...current, ...req.body }, current.id);
  if (validationError) return res.status(400).json({ message: validationError });
  const error = await validateShiftFunction(req.body.employeeId || current.employeeId, req.body.shiftTypeId === undefined ? current.shiftTypeId : req.body.shiftTypeId);
  if (error) return res.status(400).json({ message: error });

  const shift = await upsertDocument('shifts', {
    ...current,
    ...req.body,
    id: req.params.id,
    partial: Boolean(req.body.partial),
    updatedAt: new Date().toISOString(),
  });

  return res.json(shift);
});

app.delete('/api/shifts/:id', authMiddleware, async (req, res) => {
  await deleteDocument('shifts', req.params.id);
  return res.json({ ok: true, id: req.params.id });
});

app.get('/api/schedules/proposals', authMiddleware, async (req, res) => {
  const proposals = await getCollection('scheduleProposals');
  return res.json(proposals.sort((first, second) => second.createdAt.localeCompare(first.createdAt)));
});

app.put('/api/schedules/proposals/:id/assignments/:index', authMiddleware, async (req, res) => {
  const proposals = await getCollection('scheduleProposals');
  const current = proposals.find((item) => item.id === req.params.id);
  const index = Number(req.params.index);
  if (!current || !Number.isInteger(index) || index < 0 || !current.assignments?.[index]) return res.status(404).json({ message: 'Turno de propuesta no encontrado.' });
  const types = await getCollection('shiftTypes');
  const type = types.find((item) => item.id === req.body.shiftTypeId && item.active !== false);
  if (!type) return res.status(400).json({ message: 'Seleccioná un tipo de turno activo.' });
  const original = current.assignments[index];
  const employees = await getCollection('employees');
  const employee = employees.find((item) => item.id === original.employeeId);
  if (!employee || !matchesFunction(employee, type)) return res.status(400).json({ message: 'El turno corresponde a otra función del empleado.' });
  const manualShifts = await getCollection('shifts');
  const conflicts = [...manualShifts, ...current.assignments.filter((_, position) => position !== index)];
  if (conflicts.some((item) => item.employeeId === original.employeeId && item.date === original.date && overlaps(item.startTime, item.endTime, type.startTime, type.endTime))) return res.status(409).json({ message: 'El empleado ya tiene un turno que se superpone con ese horario.' });
  const specialDays = current.specialDayRules || [];
  const specialDayError = validateSpecialDayAssignment({ ...original, shiftTypeId: type.id, startTime: type.startTime, endTime: type.endTime }, conflicts, types, employees, specialDays);
  if (specialDayError) return res.status(409).json({ message: specialDayError });
  const assignments = current.assignments.map((item, position) => position === index ? {
    ...item, jobFunction: employee.jobFunction || '', jobFunctionId: employee.jobFunctionId || '', shiftTypeId: type.id, shiftTypeName: type.name, startTime: type.startTime, endTime: type.endTime,
    durationHours: hoursWorked(type.startTime, type.endTime), notes: 'Turno ajustado desde el calendario',
  } : item);
  const allAssignments = [...manualShifts, ...assignments];
  const warnings = buildCoverageWarnings(allAssignments, current.dates || [...new Set(assignments.map((item) => item.date))], types, employees, specialDays);
  const saved = await upsertDocument('scheduleProposals', {
    ...current, assignments, warnings, coverage: buildCoverageMap(allAssignments), status: 'proposed', confirmedAt: null, updatedAt: new Date().toISOString(),
  });
  return res.json(saved);
});

app.post('/api/schedules/generate', authMiddleware, async (req, res) => {
  const period = req.body.period || (req.body.month ? 'month' : 'week');
  if (!['week', 'month'].includes(period)) return res.status(400).json({ message: 'Seleccioná generación por mes o semana.' });
  if (period === 'month' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(req.body.month || '')) return res.status(400).json({ message: 'Seleccioná un mes válido (AAAA-MM).' });
  try {
    const employees = await getCollection('employees');
    const shiftTypes = await getCollection('shiftTypes');
    const shifts = await getCollection('shifts');
    const sundayHistory = await getCollection('sundayHistory');
    const specialDays = await getCollection('specialDays');

    const weekStart = req.body.weekStart || new Date().toISOString().slice(0, 10);
    const proposal = (period === 'month' ? generateMonthProposal : generateWeekProposal)({
      employees,
      shiftTypes,
      manualShifts: shifts,
      weekStart,
      month: req.body.month,
      sundayHistory,
      specialDays,
    });

    const savedProposal = await upsertDocument('scheduleProposals', {
      ...proposal,
      createdAt: new Date().toISOString(),
      status: 'proposed',
    });

    return res.status(201).json(savedProposal);
  } catch (error) {
    return res.status(500).json({ message: 'No se pudo generar la propuesta.', error: error.message });
  }
});

app.post('/api/schedules/confirm', authMiddleware, async (req, res) => {
  const { proposalId } = req.body;
  if (!proposalId) {
    return res.status(400).json({ message: 'Debe indicar la propuesta a confirmar.' });
  }

  const proposals = await getCollection('scheduleProposals');
  const current = proposals.find((item) => item.id === proposalId);
  if (!current) {
    return res.status(404).json({ message: 'La propuesta no existe.' });
  }

  const confirmed = {
    ...current,
    status: 'confirmed',
    confirmedAt: new Date().toISOString(),
  };

  const saved = await upsertDocument('scheduleProposals', confirmed);
  return res.json(saved);
});

app.get('/api/summary', authMiddleware, async (req, res) => {
  const [employees, shiftTypes, shifts] = await Promise.all([
    getCollection('employees'),
    getCollection('shiftTypes'),
    getCollection('shifts'),
  ]);

  return res.json({
    employees: employees.length,
    activeEmployees: employees.filter((employee) => employee.active !== false).length,
    shiftTypes: shiftTypes.length,
    activeShiftTypes: shiftTypes.filter((shiftType) => shiftType.active !== false).length,
    shifts: shifts.length,
  });
});

app.get('/api/coverage', authMiddleware, async (req, res) => {
  const [employees, shifts, proposals] = await Promise.all([
    getCollection('employees'),
    getCollection('shifts'),
    getCollection('scheduleProposals'),
  ]);

  const month = req.query.month;
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ message: 'Mes inválido.' });
  const ordered = proposals.sort((first, second) => (second.createdAt || '').localeCompare(first.createdAt || ''));
  const dates = [...new Set(ordered.flatMap((item) => item.dates || []))].filter((date) => !month || date.startsWith(month));
  const generated = dates.flatMap((date) => {
    const selected = ordered.find((item) => item.month === date.slice(0, 7)) || ordered.find((item) => item.dates?.includes(date));
    return (selected?.assignments || []).filter((item) => item.date === date);
  });
  const sourceAssignments = [...shifts, ...generated].filter((item) => (!month || item.date.startsWith(month)) && (!req.query.jobFunction || matchesFunction(employees.find((employee) => employee.id === item.employeeId) || item, { jobFunction: req.query.jobFunction }))).map((item) => {
    const employee = employees.find((person) => person.id === item.employeeId);
    return { ...item, employeeName: employee?.name || item.employeeName, jobFunction: employee?.jobFunction || item.jobFunction || '' };
  });
  const coverage = buildCoverageMap(sourceAssignments);

  const response = Object.entries(coverage)
    .map(([key, entries]) => {
      const [date, time] = key.split('|');
      return {
        date,
        time,
        employees: entries.map((entry) => ({
          employeeId: entry.employeeId,
          employeeName: entry.employeeName,
          jobFunction: employees.find((employee) => employee.id === entry.employeeId)?.jobFunction || '',
        })),
      };
    })
    .sort((first, second) => `${first.date}-${first.time}`.localeCompare(`${second.date}-${second.time}`));

  return res.json({
    employees,
    coverage: response,
    activeEmployees: employees.filter((employee) => employee.active !== false).length,
  });
});

app.get('/api/sundayHistory', authMiddleware, async (req, res) => {
  const history = await getCollection('sundayHistory');
  return res.json(history);
});

app.post('/api/sundayHistory', authMiddleware, async (req, res) => {
  const payload = {
    ...req.body,
    date: req.body.date || new Date().toISOString().slice(0, 10),
    employeeIds: req.body.employeeIds || [],
    createdAt: new Date().toISOString(),
  };

  const item = await upsertDocument('sundayHistory', payload);
  return res.status(201).json(item);
});

app.put('/api/employees/:id/rest-days', authMiddleware, async (req, res) => {
  const existing = await getCollection('employees');
  const current = existing.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ message: 'Empleado no encontrado.' });
  }

  const employee = await upsertDocument('employees', {
    ...current,
    ...req.body,
    id: req.params.id,
    restDays: Array.isArray(req.body.restDays) ? req.body.restDays : current.restDays || [],
    updatedAt: new Date().toISOString(),
  });

  return res.json(employee);
});

async function startServer() {
  await ensureSeedData();
  return app.listen(PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('No se pudo iniciar el servidor:', error);
    process.exitCode = 1;
  });
}

module.exports = { app, startServer };

// Read-only inventory/export. Does not import the API, seed, migrate or delete.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

function encode(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return { __firestoreType: 'bytes', base64: value.toString('base64') };
  if (typeof value.toDate === 'function' && typeof value.seconds === 'number') return { __firestoreType: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (typeof value.latitude === 'number' && typeof value.longitude === 'number') return { __firestoreType: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  if (value.firestore && typeof value.path === 'string') return { __firestoreType: 'reference', path: value.path };
  if (value instanceof Date) return { __firestoreType: 'date', iso: value.toISOString() };
  if (Array.isArray(value)) return value.map(encode);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
}

async function main() {
  const { db, isConfigured } = require('../server/src/config/firebase');
  if (!isConfigured || !db) throw new Error('Firebase no está configurado. No se creó un respaldo de datos reales.');
  const names = ['users', 'employees', 'shiftTypes', 'shifts', 'sundayHistory', 'scheduleProposals', 'jobFunctions', 'specialDays'];
  const startedAt = new Date().toISOString();
  const documents = [];
  async function exportCollection(collection) {
    const snapshot = await collection.get();
    for (const doc of snapshot.docs) {
      documents.push({ path: doc.ref.path, data: encode(doc.data()) });
      for (const subcollection of await doc.ref.listCollections()) await exportCollection(subcollection);
    }
  }
  for (const name of names) await exportCollection(db.collection(name));
  const completedAt = new Date().toISOString();
  const output = path.resolve(__dirname, '../.audit-backups', completedAt.replace(/[:.]/g, '-'));
  fs.mkdirSync(output, { recursive: true });
  const backup = { format: 'gestor-turnos-firestore-v1', startedAt, completedAt, collections: names, documents };
  const serialized = JSON.stringify(backup, null, 2);
  const backupFile = path.join(output, 'backup.json');
  fs.writeFileSync(backupFile, serialized, { flag: 'wx' });
  const checksum = crypto.createHash('sha256').update(serialized).digest('hex');
  const verified = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  if (verified.documents.length !== documents.length || crypto.createHash('sha256').update(fs.readFileSync(backupFile)).digest('hex') !== checksum) throw new Error('Falló la verificación local del respaldo.');
  const top = (name) => documents.filter((doc) => doc.path.split('/').length === 2 && doc.path.startsWith(`${name}/`));
  const employees = top('employees');
  const candidatePattern = /(^|\W)(test|prueba|demo|ficticio|ficticia|simulaci[oó]n|simulado|simulada)(\W|$)/i;
  const inventory = employees.map(({ path: employeePath, data }) => {
    const id = employeePath.split('/')[1];
    const shifts = top('shifts').filter((doc) => doc.data.employeeId === id).map((doc) => doc.path);
    const assignments = top('scheduleProposals').flatMap((doc) => (doc.data.assignments || []).flatMap((a, index) => a.employeeId === id ? [{ path: doc.path, assignmentIndex: index, date: a.date }] : []));
    const history = top('sundayHistory').filter((doc) => doc.data.employeeIds?.includes(id)).map((doc) => doc.path);
    return { path: employeePath, name: data.name || '', active: data.active !== false, possibleTestData: candidatePattern.test(`${data.name || ''} ${data.notes || ''}`), reason: 'Sólo indicio por texto; requiere confirmación humana. No se propone eliminar por nombre solamente.', shifts, assignments, sundayHistory: history };
  });
  const review = { backupFile, sha256: checksum, consistentSnapshot: false, note: 'Exportación de lectura por colección. Para borrar, repetir con la aplicación sin escrituras y ensayar restauración en un proyecto aislado. Ningún registro tiene eliminación aprobada.', counts: Object.fromEntries(names.map((name) => [name, top(name).length])), inventory, candidates: inventory.filter((row) => row.possibleTestData), approvedDeletions: [] };
  fs.writeFileSync(path.join(output, 'review.json'), JSON.stringify(review, null, 2), { flag: 'wx' });
  fs.writeFileSync(path.join(output, 'sha256.txt'), `${checksum}  backup.json\n`, { flag: 'wx' });
  console.log(JSON.stringify({ output, counts: review.counts, candidates: review.candidates.map((c) => ({ path: c.path, name: c.name, manualShifts: c.shifts.length, proposalAssignments: c.assignments.length, sundayHistory: c.sundayHistory.length })), deleted: 0, verification: 'JSON y SHA-256 verificados; restauración no ensayada' }, null, 2));
}
main().catch((error) => { console.error(error.code ? `No se pudo respaldar Firebase (${error.code}).` : error.message); process.exitCode = 1; });

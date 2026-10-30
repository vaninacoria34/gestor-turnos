const admin = require('firebase-admin');

const isProduction = process.env.NODE_ENV === 'production';
const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;

// FIREBASE_SERVICE_ACCOUNT debe contener el JSON completo de la cuenta de servicio.
// Se acepta el JSON crudo o el mismo codificado en Base64 (formato habitual en Vercel).
let serviceAccount = null;
if (serviceAccountRaw) {
  try {
    serviceAccount = JSON.parse(serviceAccountRaw);
  } catch {
    try {
      serviceAccount = JSON.parse(Buffer.from(serviceAccountRaw, 'base64').toString('utf8'));
    } catch (parseError) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT no es un JSON válido (ni JSON codificado en Base64). Verificá que se copió completo, sin saltos de línea no escapados.');
    }
  }
}
const projectId = process.env.FIRESTORE_PROJECT_ID
  || process.env.GCLOUD_PROJECT
  || process.env.GOOGLE_CLOUD_PROJECT
  || serviceAccount?.project_id
  || (isProduction ? '' : 'gestor-turnos-dev');
const hasCredentials = Boolean(
  serviceAccountRaw
  || process.env.GOOGLE_APPLICATION_CREDENTIALS
  || (isProduction && projectId),
);

let db = null;

if (isProduction && !projectId) {
  throw new Error('Falta FIRESTORE_PROJECT_ID, GCLOUD_PROJECT o GOOGLE_CLOUD_PROJECT para producción.');
}

if (isProduction && !serviceAccount && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.warn('[firebase] Sin FIREBASE_SERVICE_ACCOUNT ni GOOGLE_APPLICATION_CREDENTIALS: se usará applicationDefault(), que NO funciona en Vercel sin credenciales adjuntas.');
}

if (hasCredentials && !admin.apps.length) {
  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId,
    });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId,
    });
  }

  db = admin.firestore();
}

module.exports = { admin, db, isConfigured: hasCredentials, isProduction };

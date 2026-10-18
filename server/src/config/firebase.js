const admin = require('firebase-admin');

const isProduction = process.env.NODE_ENV === 'production';
const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
const serviceAccount = serviceAccountRaw ? JSON.parse(serviceAccountRaw) : null;
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

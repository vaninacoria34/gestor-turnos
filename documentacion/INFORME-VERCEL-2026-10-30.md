# Informe técnico — Gestor de Turnos

**Fecha:** 30/10/2026
**Alcance:** Diagnóstico y corrección del backend desplegado en Vercel (API + Firebase Firestore)
**Repositorio:** https://github.com/vaninacoria34/gestor-turnos

## Resumen ejecutivo

La API fallaba en Vercel (`404 NOT_FOUND`, luego `500 FUNCTION_INVOCATION_FAILED`) porque el punto de entrada serverless estaba escrito como si fuera un servidor tradicional: intentaba **abrir un puerto** en cada invocación, algo que no aplica en Vercel Functions. Se corrigió el handler, se ajustó `vercel.json` y se validó todo localmente, **incluida una conexión real y exitosa contra Firestore**. El proyecto está listo para redesplegar.

## 1. Errores encontrados

| # | Problema | Severidad | Estado |
|---|----------|-----------|--------|
| 1 | `api/index.js` llamaba a `startServer()`, que ejecuta `app.listen(PORT)` en cada invocación. En un entorno serverless no existe puerto dedicado: esto provocaba el `500 FUNCTION_INVOCATION_FAILED`. | Crítico | ✅ Corregido |
| 2 | El handler no exportaba la app Express directamente; envolvía la respuesta tras una inicialización que podía fallar en silencio. | Alto | ✅ Corregido |
| 3 | Si el seed inicial fallaba en producción (faltaban `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD`), **toda la API** —incluido `/api/health`— respondía 503. | Medio | ✅ Corregido (el seed ya no corre en el handler serverless) |
| 4 | `vercel.json` no declaraba configuración de functions (timeout). | Bajo | ✅ Corregido |

Puntos revisados que estaban **correctos**:

- Rutas: el rewrite `/api/(.*) → /api` es compatible con `api/index.js`.
- Firebase Admin (`server/src/config/firebase.js`): acepta `FIREBASE_SERVICE_ACCOUNT` como JSON crudo o Base64; `FIRESTORE_PROJECT_ID` con fallbacks adecuados.
- Seguridad JWT: exige `JWT_SECRET` de al menos 32 bytes en producción.
- Frontend: usa rutas relativas (`/api`) por defecto, correcto en producción.
- `.gitignore` excluye correctamente `.env` y credenciales.

## 2. Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `api/index.js` | Simplificado: exporta la app Express directamente, sin `listen()` ni seed por invocación. |
| `server/src/index.js` | `startServer()` no abre puerto cuando `process.env.VERCEL` está activo. El comportamiento local no cambia. |
| `vercel.json` | Agregado `functions["api/index.js"].maxDuration: 30` (cold start + Firestore pueden tardar). |
| `scripts/local-api-smoke.cjs` | **Nuevo.** Prueba local que simula exactamente cómo Vercel invoca el handler serverless. |

## 3. Pruebas realizadas

| Prueba | Resultado |
|--------|-----------|
| Suite completa (`node --test server/test/`) | ✅ **44/44 pasan** |
| Smoke test del handler serverless → `GET /api/health` | ✅ 200 `{"ok":true,"name":"Gestor de Turnos","status":"running"}` |
| `POST /api/auth/login` contra Firestore real | ✅ 200, token emitido |
| `GET /api/dashboard` autenticado, con Firestore real | ✅ 200 — `persistence=firestore`, 7 empleados leídos |
| Build de frontend (`vite build`) | ✅ Genera `web/dist` correctamente |

El smoke test se ejecutó con las credenciales locales (sin exponer sus valores) y **se conectó a Firestore real**: valida que `FIREBASE_SERVICE_ACCOUNT` está bien formateada y que el proyecto Firestore responde.

## 4. Lo que no se pudo resolver / verificar

- **No se pudo probar el despliegue real en Vercel** desde el entorno local (sin CLI ni acceso al dashboard). La confirmación final llega con el propio despliegue.
- **No se pudo auditar el historial remoto de GitHub** (git no disponible en el PATH local): queda pendiente confirmar que `.env` nunca fue subido al repositorio remoto.

## 5. Configuraciones a revisar manualmente en Vercel / Firebase

**Vercel → Settings → Environment Variables (Production):**

1. `FIREBASE_SERVICE_ACCOUNT` — JSON completo de la cuenta de servicio (crudo o Base64).
2. `FIRESTORE_PROJECT_ID`
3. `JWT_SECRET` — mínimo 32 caracteres aleatorios.
4. `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` — solo necesarias si la colección `users` está vacía (la contraseña requiere mínimo 12 caracteres).
5. `VITE_API_URL` — opcional; no es necesario si frontend y API comparten dominio.
6. ⚠️ **No configurar `NODE_ENV` manualmente** — Vercel lo gestiona.

**Build (ya correcto):** Root Directory `./`, Build Command `npm run build`, Output Directory `web/dist`.

**Tras cambiar variables:** hacer **Redeploy** (las variables no aplican a despliegues existentes).

**Firebase Console:** verificar que la cuenta de servicio tenga rol **Firebase Admin** o **Cloud Datastore User**.

**Si volviera a fallar:** revisar *Vercel → Deployments → (último) → Functions → Logs*. Ahí aparece el error exacto detrás de `FUNCTION_INVOCATION_FAILED` (casi siempre una variable de entorno mal copiada).

## 6. Conclusión

✅ **El proyecto está listo para un nuevo despliegue.** Código corregido, 44/44 tests pasando, handler serverless funcionando localmente contra Firestore real y build de Vite compilando. No se eliminaron datos ni colecciones, no se cambió de base de datos y no se modificó ninguna funcionalidad existente del Gestor de Turnos.

**Commit sugerido:** `fix: handler serverless compatible con Vercel Functions + maxDuration 30`

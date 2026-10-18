# Gestor de Turnos

Aplicación para gestionar empleados por función, tipos de turno, cobertura horaria y propuestas mensuales con Firebase Firestore como base de datos principal. Mantiene compatibilidad con las propuestas semanales anteriores.

## Administración general

- **Funciones:** crear, buscar, consultar, editar nombre y descripción, y eliminar funciones propias para cualquier rubro. No hay funciones específicas predefinidas. Las funciones existentes se incorporan automáticamente al catálogo.
- **Empleados:** crear, listar, editar nombre, función, preferencia y estado, gestionar descansos y eliminar. La edición conserva los descansos ya configurados.
- **Tipos de turno:** crear, listar, editar nombre, función, horarios, cantidad de personas, color, notas y estado, y eliminar. Los turnos ya asignados conservan sus horarios cuando se cambia un tipo.
- **Calendario:** agregar turnos manuales, consultar, editar sus horarios, fechas, empleados y notas, y eliminar. Las tarjetas de propuestas permiten cambiar el tipo de turno y requieren revisar la propuesta nuevamente.
- **Días especiales:** crear, buscar, consultar, editar, activar, desactivar y eliminar reglas para días de la semana o fechas puntuales, con cantidades independientes por turno y función.

Las funciones tienen un identificador estable: renombrarlas mantiene las asignaciones de empleados y tipos de turno. Para eliminar una función en uso hay que reasignar primero sus empleados y tipos, incluidos los inactivos. Las propuestas anteriores conservan sus datos históricos.

Las instalaciones nuevas comienzan sin empleados de ejemplo. Eliminar todos los tipos de turno no los recrea al reiniciar un sistema ya inicializado.

## Planificación mensual por función

1. En **Funciones**, creá las funciones o sectores de tu organización con los nombres que necesites.
2. En **Empleados**, elegí una función para cada persona. Podés cambiarla desde la lista o con **Editar**.
3. En **Tipos de turno**, asigná la función a cada horario y definí cuántas personas necesita. Cada función puede tener horarios y cantidades independientes. Un tipo sin función admite empleados de cualquier sector.
4. En **Calendario**, elegí el mes y pulsá **Generar mes completo**. El filtro permite revisar cada función y la vista semanal permite trabajar con menos días. La generación siempre abarca todas las funciones del mes seleccionado.
5. Revisá las advertencias y confirmá la propuesta. Los cambios puntuales desde el calendario dejan la propuesta pendiente de confirmación nuevamente.

El generador respeta preferencias de mañana/tarde, descansos y funciones; considera los turnos manuales como cobertura y distribuye la carga a lo largo del mes. Si falta personal de una función, lo informa sin reemplazarlo por personal de otra. Los empleados anteriores aparecen sin función asignada hasta que se complete ese dato.

## Días especiales y descanso

Para domingos con dos personas de mañana y dos de tarde:

1. En **Días especiales**, creá una regla para el día de la semana **Domingo**.
2. Elegí el tipo de turno de mañana con **2 personas** y el de tarde con **2 personas**. Cada tipo conserva su función; si usás tipos generales sin función, las cantidades corresponden a todo el equipo.
3. Dejá marcada la opción **El resto del personal descansa**. Solo se generan los turnos indicados, con una asignación por persona ese día; los tipos omitidos no se trabajan.
4. Guardá y generá una nueva propuesta mensual. El calendario señala los días especiales y muestra **Descanso** para quienes no tienen turno.

Una regla de **fecha puntual** reemplaza la regla semanal para esa fecha. Cero personas cierra un turno; una regla sin turnos y con descanso activado deja a todo el equipo de descanso. Al desmarcar el descanso, solo se modifican las cantidades indicadas y los demás turnos conservan su dotación habitual.

Las propuestas guardan una copia de las reglas utilizadas. Crear, modificar, desactivar o eliminar una regla no cambia los turnos existentes. La cobertura usa esa misma copia para evitar advertencias sobre turnos cerrados. Si faltan personas disponibles para cubrir la regla, la propuesta lo informa y conserva preferencias y descansos.

Los turnos manuales previos se conservan y cuentan como cobertura; si contradicen una regla, la nueva propuesta muestra advertencias. Los cambios nuevos desde el calendario respetan los horarios habilitados, la dotación y la asignación única por persona. Para eliminar un tipo de turno referenciado, primero quitá su referencia de las reglas que lo usan.

Pruebas de generación, API y configuración de producción: `node --test server/test/shift-preference.test.js server/test/monthly-schedule.test.js server/test/general-crud.test.js server/test/special-days.test.js server/test/production-config.test.js`.

## Stack

- Backend: Node.js + Express
- Base de datos: Firebase Firestore
- Autenticación: JWT gestionada por el backend
- Frontend: React + Vite

## Requisitos

- Node.js 20+
- Un proyecto Firebase con Firestore habilitado
- Credenciales de Firebase o variables de entorno configuradas

## Configuración

1. Copia `.env.example` a `.env`.
2. Completa `FIRESTORE_PROJECT_ID` o configura las credenciales de Firebase.
3. Instala dependencias:

```bash
npm install
```

4. Inicia la aplicación:

```bash
npm run dev
```

El backend corre en `http://localhost:4000` y el frontend en `http://localhost:5173`.

## Usuario inicial local

En desarrollo local, si el usuario no existe, el sistema crea:

- Email: `admin@gestor-turnos.local`
- Password: `Admin123!`

Estas credenciales son solo para desarrollo y no se usan en producción.

## Producción con Firebase

1. Configurá `NODE_ENV=production` y el ID real del proyecto en `FIRESTORE_PROJECT_ID`, `GCLOUD_PROJECT` o `GOOGLE_CLOUD_PROJECT`.
2. Habilitá Firestore y configurá las credenciales de Firebase con `FIREBASE_SERVICE_ACCOUNT` (JSON de una cuenta de servicio), `GOOGLE_APPLICATION_CREDENTIALS` (ruta al archivo) o Application Default Credentials en una plataforma de Google Cloud.
3. Definí `JWT_SECRET` con al menos 32 bytes aleatorios. Podés generar uno con `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
4. Antes del primer inicio, configurá `INITIAL_ADMIN_EMAIL` y `INITIAL_ADMIN_PASSWORD` (mínimo 12 caracteres). Solo se usan para crear el primer administrador si la colección de usuarios está vacía; después podés quitarlas.
5. Iniciá el backend con `npm run start --workspace server`.

En producción el backend no arranca sin el ID del proyecto Firebase y el secreto JWT. Si Firestore falla, el error se propaga y el proceso no usa datos en memoria. El registro público también está deshabilitado para evitar la creación abierta de cuentas administrativas. En desarrollo local se conserva el respaldo en memoria.

## Convenciones del proyecto

- No se usa SQLite ni archivos `.db`.
- No se mezcla Firestore con otra base de datos.
- La autenticación de usuarios se maneja con JWT desde el backend.
- Las rotaciones de domingos y descansos se resuelven como parte de la lógica de generación semanal.

## Nota de desarrollo

Si no hay credenciales de Firebase configuradas en desarrollo, la app usa un modo de respaldo en memoria para facilitar el arranque local. En producción, Firestore es obligatorio y no hay respaldo en memoria.

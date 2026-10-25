# Gestor de Turnos

Aplicación para gestionar empleados por función, tipos de turno, cobertura horaria y propuestas mensuales con Firebase Firestore como base de datos principal. Mantiene compatibilidad con las propuestas semanales anteriores.

## Manual completo de uso

La documentación para administrar el sistema está en [web/public/manual.html](web/public/manual.html). Con la aplicación iniciada, abrí [el manual](http://localhost:5173/manual.html) o usá **Manual de uso** en el pie de página. Incluye configuración inicial, empleados, horarios diarios, descansos, domingos, turnos nocturnos con personal fijo, calendario, cobertura, generación, confirmación, guardado y resolución de problemas. Se puede imprimir o guardar como PDF desde el navegador. Las instrucciones técnicas de instalación y mantenimiento continúan en este README.

También se entrega una [copia en PDF](documentacion/Manual-Gestor-de-Turnos.pdf) para descargar, imprimir o consultar sin conexión. El HTML es la fuente del manual; si se actualiza, debe regenerarse esta copia.

El menú **Manual de uso** muestra la guía dentro de la aplicación, sin salir del sistema. El enlace del pie sigue disponible para abrirla en otra pestaña.

## Descargar y compartir el calendario

En Calendario elegí el mes o la semana y el sector. **Descargar PDF** genera un documento organizado por semanas, con páginas adicionales para equipos largos y advertencias. **Descargar CSV / Excel** produce un archivo CSV UTF-8 compatible con planillas, con horarios, descansos, estados y observaciones. Las exportaciones incluyen las asignaciones vigentes y los cambios manuales; una propuesta pendiente queda identificada como tal.

**Compartir PDF** prepara el archivo y abre una ventana con el período y el sector. **Elegir aplicación y compartir** invoca el menú del dispositivo desde una nueva acción del usuario. Cuando el navegador no permite compartir archivos, se ofrece descargar y adjuntar el PDF en WhatsApp, correo u otra aplicación. No se envían mensajes ni se eligen destinatarios automáticamente. Los archivos no se actualizan después de prepararlos: si cambia el calendario, generá una copia nueva.

**Enviar por WhatsApp** abre WhatsApp con un mensaje de texto que resume los turnos visibles del período y sector seleccionados; elegí el destinatario y confirmá el envío desde WhatsApp. Para adjuntar el calendario completo como PDF, usá **Compartir PDF** y elegí WhatsApp en el menú del dispositivo, o descargalo y adjuntalo manualmente.

Los PDF se generan localmente con jsPDF, cargado sólo al exportar. No requieren copiar datos al servidor ni enviar el calendario a un servicio de conversión externo. La prueba `node scripts/browser-smoke.cjs --dev --export --fullscreen` usa una API aislada, comprueba descargas reales y simula el menú de compartir sin mensajes externos.

## Administración general

- **Funciones:** crear, buscar, consultar, editar nombre y descripción, y eliminar funciones propias para cualquier rubro. No hay funciones específicas predefinidas. Las funciones existentes se incorporan automáticamente al catálogo.
- **Empleados:** crear, listar, editar nombre, funciones, preferencia y estado, gestionar descansos, turnos fijos semanales, autorización para hasta dos turnos diarios no superpuestos y máximo de horas semanales, y eliminar. La edición conserva los descansos ya configurados.
- **Tipos de turno:** crear, listar, editar nombre, función, horarios, cantidad de personas, color, notas y estado, y eliminar. Los turnos ya asignados conservan sus horarios cuando se cambia un tipo.
- **Calendario:** agregar turnos manuales, consultar, editar sus horarios, fechas, empleados y notas, y eliminar. Las tarjetas de propuestas permiten cambiar el tipo de turno y requieren revisar la propuesta nuevamente.
- **Días especiales:** crear, buscar, consultar, editar, activar, desactivar y eliminar reglas para días de la semana o fechas puntuales, con cantidades independientes por turno y función.

Las funciones tienen un identificador estable: renombrarlas mantiene las asignaciones de empleados y tipos de turno. Para eliminar una función en uso hay que reasignar primero sus empleados y tipos, incluidos los inactivos. Las propuestas anteriores conservan sus datos históricos.

Las instalaciones nuevas comienzan sin empleados de ejemplo. Eliminar todos los tipos de turno no los recrea al reiniciar un sistema ya inicializado.

## Planificación mensual por función

1. En **Funciones**, creá las funciones o sectores de tu organización con los nombres que necesites.
2. En **Empleados**, elegí una o varias funciones para cada persona. Un empleado puede cubrir turnos de cualquiera de sus funciones asignadas.
3. En **Tipos de turno**, asigná la función a cada horario y definí cuántas personas necesita. Cada función puede tener horarios y cantidades independientes. Un tipo sin función admite empleados de cualquier sector.
4. En **Calendario**, elegí el mes y pulsá **Generar mes completo**. El filtro permite revisar cada función y la vista semanal permite trabajar con menos días. La generación siempre abarca todas las funciones del mes seleccionado.
5. Revisá las advertencias y confirmá la propuesta. Los cambios puntuales desde el calendario dejan la propuesta pendiente de confirmación nuevamente.

El generador respeta los tipos permitidos del catálogo, la disponibilidad diaria, los descansos y los sectores. Conserva las preferencias anteriores de mañana/tarde hasta que se configuren tipos dinámicos. Una persona con varias funciones sólo cuenta para el sector de su turno. Los turnos fijos se reservan primero; para los rotativos se consideran puestos pendientes y personal exclusivo antes de usar personas multisector. Las jornadas dobles requieren autorización, no pueden superponerse y respetan el máximo semanal, incluyendo propuestas de meses vecinos. La cobertura se valida contra cada tipo y cantidad configurada. Si faltan personas, se muestra **TURNO SIN CUBRIR** con fecha, sector, horario y cantidad faltante.

En **Editar empleado → Días, horarios y sectores**, elegí por día descanso, disponibilidad automática o un tipo del catálogo, con entrada/salida y sector. **Repetir semanalmente** establece el patrón habitual. **Sólo una semana** permite excepciones desde el lunes elegido; cada día excepcional prevalece sobre el patrón. Un día sin configuración conserva la disponibilidad anterior. Los turnos se mantienen dentro del mismo día: la salida debe ser posterior a la entrada.

Desde **Editar horario** en el calendario también se pueden personalizar las horas de una propuesta. Esas ediciones quedan protegidas y se conservan al regenerar. La propuesta más reciente se aplica por fecha, incluso si es semanal. Confirmar actualiza el historial dominical sin duplicarlo al reconfirmar. Las propuestas anteriores permanecen guardadas. Si una edición protegida contradice una disponibilidad modificada después, se conserva y se advierte para revisión manual.

Equipo se ordena alfabéticamente, permite buscar y filtrar activos/inactivos y bloquea nuevos nombres duplicados. Los registros existentes no se fusionan. Los empleados y tipos con historial o referencias deben desactivarse; su eliminación está bloqueada.

## Días especiales y descanso

Para domingos con dos personas de mañana y dos de tarde:

1. En **Días especiales**, creá una regla para el día de la semana **Domingo**.
2. Elegí el tipo de turno de mañana con **2 personas** y el de tarde con **2 personas**. Cada tipo conserva su función; si usás tipos generales sin función, las cantidades corresponden a todo el equipo.
3. Dejá marcada la opción **El resto del personal descansa**. Solo se generan los turnos indicados, con una asignación por persona ese día; los tipos omitidos no se trabajan.
4. Guardá y generá una nueva propuesta mensual. El calendario señala los días especiales y muestra **Descanso** para quienes no tienen turno.

Una regla de **fecha puntual** reemplaza la regla semanal para esa fecha. Cero personas cierra un turno; una regla sin turnos y con descanso activado deja a todo el equipo de descanso. Al desmarcar el descanso, solo se modifican las cantidades indicadas y los demás turnos conservan su dotación habitual.

Las propuestas guardan una copia de las reglas utilizadas. Crear, modificar, desactivar o eliminar una regla no cambia los turnos existentes. La cobertura usa esa misma copia para evitar advertencias sobre turnos cerrados. Si faltan personas disponibles para cubrir la regla, la propuesta lo informa y conserva preferencias y descansos.

Los turnos manuales previos se conservan y cuentan como cobertura cuando corresponden al sector efectivo y cubren el horario configurado. Para personas multisector, un turno sin tipo requiere elegir su sector. Si contradice una regla o un descanso, la propuesta muestra advertencias. Los tipos usados por historial se desactivan; no se eliminan.

Pruebas de generación, API, transacciones simuladas, persistencia y configuración: `npm test`. Compilación: `npm run build`. Prueba de interfaz con Chrome instalado: `node scripts/browser-smoke.cjs` (API en memoria y perfil temporal, sin acceso a Firebase real; se puede definir `CHROME_PATH`).

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

En producción el backend no arranca sin el ID del proyecto Firebase y el secreto JWT. Si Firestore está configurado y falla, la operación devuelve error y nunca deriva silenciosamente a memoria, tampoco en desarrollo. Las modificaciones de la API se validan y guardan en transacciones Firestore; los errores de commit no se informan como guardados exitosos. El registro público está deshabilitado en producción.

La interfaz usa `/api` en el mismo origen, con proxy local de Vite. Para un backend separado, definí `VITE_API_URL` en el `.env` raíz antes de compilar. El tablero descarga un mes y sus semanas limítrofes, reutiliza consultas por petición y refresca los datos cada 30 segundos o al volver a la ventana. La cifra de turnos del tablero corresponde a ese período.

## Convenciones del proyecto

- No se usa SQLite ni archivos `.db`.
- No se mezcla Firestore con otra base de datos.
- La autenticación de usuarios se maneja con JWT desde el backend.
- Las rotaciones de domingos y descansos se resuelven como parte de la lógica de generación semanal.

## Nota de desarrollo

Sin credenciales Firebase en desarrollo se usa memoria y se muestra un aviso de que los cambios se pierden al reiniciar. En producción Firestore es obligatorio.

## Inventario y respaldo de datos

`scripts/audit-data.cjs` prepara una exportación de sólo lectura de las colecciones de esta aplicación y sus subcolecciones. No importa el servidor ni ejecuta semillas, migraciones o borrados. La ejecución sobre datos reales está pendiente de autorización específica. Guarda el JSON, checksum SHA-256 e inventario con referencias exactas en `.audit-backups/`, excluido de Git. Los indicios por nombre no autorizan ninguna eliminación. La exportación secuencial no constituye una instantánea transaccional; antes de borrar hay que verificarla sin escrituras concurrentes y ensayar restauración en un proyecto aislado.

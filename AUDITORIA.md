# Diagnóstico previo a las modificaciones

Fecha: 24 de octubre de 2026.

## Alcance y estado

Se revisaron la interfaz React, la API Express, el generador, la configuración Firebase, la autenticación, los estilos y las cinco suites de pruebas. El análisis corresponde a la copia local, que ya tenía modificaciones en README.md, server/src/index.js, server/src/lib/schedule.js, tres archivos de pruebas, web/src/App.jsx y web/src/styles.css. Se conservaron esos cambios.

No se modificó el código de la aplicación ni se inició el servidor contra Firebase. No se consultaron empleados reales, no se hicieron migraciones ni eliminaciones y no se publicó nada. Este informe no acredita una auditoría de los documentos existentes en producción.

## Funciones existentes que conviene conservar

- Catálogo editable de tipos de turno, con nombre, inicio, fin, estado, sector y dotación.
- Sectores con identificadores y empleados habilitados para varios sectores.
- Turnos fijos recurrentes por día, descansos, jornadas dobles y máximo semanal.
- Propuestas mensuales/semanales, turnos manuales y reglas para fechas o días especiales.
- Edición de empleado y tipo de turno desde el calendario, alertas de cobertura e indicación de inactivos.
- Estilos adaptables y calendario con desplazamiento horizontal y pantalla completa.

## Hallazgos prioritarios

### 1. Preferencias todavía fijas

`server/src/lib/schedule.js:41`, validaciones de empleados en `server/src/index.js` y selectores en `web/src/App.jsx` mantienen flexible/morning/afternoon. Crear Tarde-Noche incorpora el tipo al catálogo y a los turnos fijos, pero no a esa preferencia. Hay que separar disponibilidad real, preferencias y asignaciones, manteniendo compatibilidad con los empleados anteriores.

### 2. Ediciones de propuesta sin protección frente a regeneración

La edición guarda el cambio dentro de `scheduleProposals`. La generación sólo incorpora como restricciones los documentos de `shifts`; no incorpora las asignaciones editadas de propuestas anteriores. La propuesta anterior permanece guardada, pero sus correcciones dejan de gobernar el calendario cuando se muestra una propuesta nueva. El aviso de confirmación de la interfaz reconoce ese reemplazo. Hace falta una marca explícita y persistente de edición manual y reutilizarla al regenerar.

### 3. Cobertura cruzada entre sectores, reproducida

`assignmentCoversShift` valida los sectores habilitados del empleado, pero no el sector efectivo de una asignación sin tipo. Con una persona habilitada en cocina y atención, una asignación manual de cocina de 08:00 a 12:00 sin `shiftTypeId` hace desaparecer la advertencia de atención de ese mismo horario. `/api/coverage` también filtra por los sectores habilitados de la persona y sustituye el sector del turno por el sector principal del empleado. La cobertura debe usar el sector de cada asignación.

### 4. Falta de cobertura evitable, reproducida

Con tres personas —una habilitada en cocina y atención y dos sólo en atención— y demanda simultánea de dos puestos de atención y uno de cocina, el generador puede asignar la persona multisector a atención, dejar libre una persona de atención y advertir que falta cocina. Existe una solución válida. La selección secuencial por demanda no reconsidera las elecciones; requiere priorizar personal exclusivo/escaso y resolver conflictos de asignación.

### 5. Disponibilidad individual incompleta

Los turnos fijos por día no equivalen a una lista de días disponibles: un día sin turno fijo sigue siendo elegible para generación automática. No existe una configuración completa por día con disponibilidad, entrada/salida personalizada, sector y alcance de una sola semana. El backend admite arrays de turnos fijos, pero el formulario sólo muestra un selector por día. Hay que definir también la prioridad entre una excepción semanal y la regla recurrente.

### 6. Descansos y domingos

El generador respeta los descansos configurados; no se encontró una regla por nombre que fuerce a Vanina a descansar los lunes. Una fixture antigua sí configura ese descanso expresamente; otra prueba cubre cocina de lunes a sábado con domingo libre. Sin consultar los documentos reales no puede determinarse cuál configuración tiene cada persona.

La confirmación de propuestas no registra automáticamente el trabajo dominical en `sundayHistory`; existe un endpoint separado. La rotación usa ese historial, por lo que hay que unificar la actualización al confirmar y evitar duplicaciones al reconfirmar. El máximo semanal de una generación tampoco incorpora las asignaciones automáticas de otros períodos que compartan la semana: debe verificarse especialmente en los límites entre meses.

### 7. Empleados: orden, duplicados y eliminación

La lista Equipo muestra el orden recibido de la API, sin orden alfabético garantizado. El calendario ordena por sectores y después por nombre. Activo/inactivo se identifica, pero no hay un listado separado o filtro dedicado en Equipo. La creación valida nombre, pero no detecta posibles duplicados. No deben fusionarse personas automáticamente por coincidencia de nombre.

El endpoint de eliminación borra físicamente al empleado sin comprobar turnos o propuestas vinculadas. El borrado de tipos de turno comprueba reglas especiales, pero no todas las referencias de empleados. Se recomienda desactivación/archivo y bloqueo del borrado cuando haya historial.

### 8. Persistencia y sincronización

Fuera de producción, los errores de Firestore derivan silenciosamente a memoria en lectura, escritura y eliminación. Una operación puede informarse exitosa sin haber persistido y desaparecer al reiniciar el servidor. En producción los errores se propagan, pero varias rutas async de Express 4 carecen de manejo explícito; deben revisarse las respuestas y recuperación ante fallos.

La interfaz vuelve a cargar los datos tras operaciones propias, pero no tiene suscripción o actualización periódica para cambios de otros navegadores. La validación y escritura de turnos no es transaccional: dos solicitudes concurrentes pueden superar los controles de superposición. La edición de propuestas reescribe el documento completo y puede perder cambios concurrentes.

### 9. Rendimiento y configuración de despliegue

`getRawCollection` lee colecciones completas, incluyendo todo el historial de propuestas y turnos. `/coverage` aplica el filtro mensual en memoria. Cada recarga pide varios recursos que vuelven a consultar los mismos catálogos; `/job-functions` ejecuta además una migración que puede escribir. Hay consultas secuenciales y cálculos repetidos dentro de bucles. Son causas plausibles de lentitud, pendientes de medición con volumen real.

La URL de la API está fijada a `http://localhost:4000/api` en la interfaz. Conviene configurarla por entorno y mantener la configuración de desarrollo.

### 10. Calendario y responsive

Se muestran empleado, fechas, horas, tipo, sector y descansos. Los turnos manuales permiten editar horas; los generados se editan seleccionando otro tipo y empleado, sin un formulario equivalente de horas personalizadas. La vista mensual reserva una columna por día, lo que produce una grilla de más de 3.000 píxeles y mucho desplazamiento en teléfonos. Los estilos responsive existen; falta validación visual en navegador y dispositivos.

## Verificaciones realizadas

- `node --test server/test/general-crud.test.js server/test/monthly-schedule.test.js server/test/production-config.test.js server/test/shift-preference.test.js server/test/special-days.test.js`: 28 pruebas aprobadas, cero fallos. Las APIs usan memoria o fixtures de Firestore; no escriben en la base real.
- Dos reproducciones adicionales ejecutadas sin modificar archivos ni acceder a red: cobertura cruzada de un turno manual de cocina y falta de cobertura evitable con una persona multisector. Ambas confirmaron los defectos descritos.
- `npm.cmd run build`: compilación de producción aprobada (31 módulos; JavaScript 196,04 kB, gzip 59,73 kB). El intento inicial encontró `spawn EPERM` por restricciones de subprocesos del sandbox; el reintento fuera de ese entorno finalizó correctamente.
- Pendientes: navegador/consola, persistencia real tras recarga y reinicio, concurrencia real y prueba visual responsive. Las pruebas existentes no acreditan estos puntos ni cubren todos los requisitos nuevos.

## Correcciones propuestas para la siguiente etapa

1. Mantener React, Express y Firebase; incorporar tipos dinámicos con compatibilidad de datos anteriores.
2. Añadir disponibilidad diaria y excepciones semanales, con sector y horas por día; probar jueves/viernes Tarde-Noche y sábado diferente con datos aislados.
3. Proteger las ediciones manuales del calendario al regenerar y unificar la selección de la propuesta vigente por fecha.
4. Corregir cobertura por sector efectivo, asignación multisector, límites semanales entre períodos y registro dominical idempotente.
5. Ordenar Equipo alfabéticamente, añadir filtros de estado y avisos de duplicados; proteger referencias e historial.
6. Hacer explícitos los fallos de persistencia, controlar escrituras concurrentes y reducir lecturas por período sin cambiar la arquitectura principal.
7. Completar pruebas de regresión, compilación y verificación de interfaz; informar archivos modificados y límites de validación.

## Limpieza de datos de prueba: pendiente, sin eliminación autorizada

No hay un inventario de empleados reales disponible en esta auditoría y no se creó una copia de seguridad de Firebase. Los nombres de fixtures de pruebas no demuestran que existan documentos ficticios en producción. No hay registros concretos propuestos para borrar todavía.

Antes de cualquier eliminación: obtener inventario real sin ejecutar las migraciones de inicio; exportar una copia íntegra y verificar su restaurabilidad; preparar un manifiesto con colección, ID, datos, relaciones y motivo de cada candidato; presentar el listado exacto y esperar la autorización expresa. Eliminar sólo los IDs aprobados, conservando el respaldo y el registro de la operación. La autorización de correcciones locales no implica permiso para borrar ni publicar.

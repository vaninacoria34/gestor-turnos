# Correcciones del Gestor de Turnos

Fecha: 24 de octubre de 2026. Implementación local autorizada después del diagnóstico de `AUDITORIA.md`.

## Resultado

Se conservan React, Express y Firebase, los documentos existentes y los cambios que ya estaban en la copia de trabajo. No se publicó ni se eliminó información real. La aplicación permite configurar horarios y sectores por día, repetirlos o introducir excepciones semanales, y mantener las ediciones manuales al regenerar.

## Problemas corregidos y funciones incorporadas

| Área | Cambio |
| --- | --- |
| Tipos dinámicos | Las preferencias se eligen del catálogo por ID; los horarios nuevos aparecen tras guardarlos. Las preferencias anteriores siguen funcionando hasta que se cambien expresamente. |
| Configuración individual | Por día: descanso, disponibilidad automática con límites horarios/sector o un turno fijo con horas propias. Excepciones desde un lunes, con prioridad sobre la regla recurrente. |
| Calendario | Edición de horas también en propuestas, indicación de cambio protegido y conservación al regenerar. La propuesta vigente se elige por fecha, incluyendo semanas que reemplazan parte de un mes. |
| Cobertura | Se cuenta el sector efectivo del turno. Una persona multisector no cubre atención mientras está asignada a cocina. Un turno manual sin tipo exige sector cuando hay varias posibilidades. |
| Generación | Usa puestos pendientes y personal habilitado/exclusivo para evitar consumir innecesariamente la única persona de otro sector; respeta disponibilidad, descansos y máximo semanal, también entre meses. |
| Domingos | Confirmación del historial por fecha sin duplicar al reconfirmar. Los turnos fijos también respetan la dotación de reglas especiales. |
| Historial incompatible | Se advierte sobre descansos, inactivos, solapamientos, disponibilidad y exceso semanal de turnos conservados; no se borran ni corrigen silenciosamente. |
| Empleados | Orden alfabético en Equipo, búsqueda, filtro de activos/inactivos, aviso de duplicados existentes y bloqueo de nuevos nombres duplicados. |
| Protección de referencias | Se bloquea el borrado de empleados y tipos con historial o referencias. Se utiliza desactivación para conservar información. |
| Persistencia | Un fallo de Firestore devuelve error; no deriva silenciosamente a memoria. Las escrituras se confirman después del commit transaccional y se serializan en el modo local. |
| Rendimiento | Endpoint agrupado del tablero, consultas de turnos y propuestas por período, caché sólo durante cada petición, reutilización local de cobertura y actualización cada 30 segundos/al recuperar foco. |
| Configuración | API por mismo origen o `VITE_API_URL` desde `.env` raíz. Aviso visible cuando se usa memoria sin Firebase. |
| Responsive | Vista semanal inicial en pantallas pequeñas, controles táctiles más grandes y ancho mínimo de la grilla contenido dentro del calendario. |

## Archivos modificados en esta etapa

- `server/src/index.js`: validación, CRUD protegido, cobertura, generación, historial, tablero y manejo de errores.
- `server/src/lib/schedule.js`: reglas diarias, excepciones, sectores, propuestas vigentes, turnos protegidos, selección y advertencias.
- `server/src/lib/request-store.js` (nuevo): contexto/caché por petición, manejo async y escrituras transaccionales con respuesta posterior al commit.
- `web/src/App.jsx`: formularios, tipos dinámicos, filtros, edición del calendario y actualización del tablero.
- `web/src/styles.css`: reglas diarias y ajustes de pantalla pequeña.
- `web/vite.config.js`, `.env.example`: configuración de API y entorno.
- `package.json`: comando `npm test`.
- `server/test/configurable-schedule.test.js`, `server/test/configurable-api.test.js` (nuevos): regresiones y persistencia simulada.
- `server/test/general-crud.test.js`, `server/test/special-days.test.js`: expectativas de protección de historial y uso de los IDs devueltos por la API.
- `scripts/browser-smoke.cjs` (nuevo): comprobación de interfaz con Chrome, API aislada y perfil temporal.
- `scripts/audit-data.cjs` (nuevo): inventario y exportación de sólo lectura, pendiente de autorización para datos reales.
- `.gitignore`: excluye `.audit-backups/`.
- `README.md`: uso, configuración, pruebas y límites.
- `INFORME-MEJORAS.md`: este informe. `AUDITORIA.md` conserva el diagnóstico previo.

`server/test/monthly-schedule.test.js` y `server/test/shift-preference.test.js` ya tenían cambios antes de esta etapa; se utilizaron como regresión sin reescribirlos. También se conservaron los demás cambios previos y `.vscode/`.

## Pruebas

La suite incluye las cinco suites existentes y dos nuevas. Las APIs de pruebas usan memoria o un simulador de Firestore con transacciones, filtros y fallos controlados; nunca acceden al Firebase real.

- Caso Lautaro: jueves/viernes Tarde-Noche, sábado diferente, horas personalizadas y descanso los demás días.
- Excepción semanal, prioridad sobre descanso habitual y retorno a la configuración recurrente la semana siguiente.
- Tipos nuevos/editables, preferencia por ID, validación de sectores y horarios.
- Edición desde calendario, regeneración sin sobrescritura y bloqueo de edición de propuestas reemplazadas.
- Cocina separada de atención y reserva de personal multisector cuando existe una distribución completa.
- Máximo semanal con turnos de meses vecinos y ausencia de turnos superpuestos nuevos.
- Confirmación dominical idempotente y límites de turnos fijos en días especiales.
- Solicitudes concurrentes de turnos: una se acepta y la otra se rechaza por conflicto.
- Reinicio de la API con el mismo almacenamiento simulado: se recuperan documentos y ediciones.
- Fallo de lectura o commit: devuelve error y conserva el documento anterior; no presenta un guardado falso.
- Tablero con consultas acotadas y empleados ordenados; los turnos de otro período no se descargan.

Resultados finales:

- `npm test`: 37 pruebas aprobadas, cero fallos. Tras el último ajuste de compatibilidad de sectores se repitieron las ocho pruebas del generador nuevo: todas aprobadas.
- `npm run build`: aprobado, 31 módulos. JavaScript 204,31 kB (61,89 kB gzip) y CSS 17,95 kB (4,41 kB gzip).
- `node scripts/browser-smoke.cjs`: aprobado con Chrome en escritorio 1366×900 y móvil 390×844. Verificó calendario, presencia de inactivos, tipo dinámico en selector diario, guardado de regla, recuperación tras recarga, edición protegida y vista semanal móvil. Cero errores de consola y sin desbordamiento horizontal de la página; el calendario conserva su desplazamiento interno.
- `git diff --check` y comprobaciones sintácticas de Node: aprobadas. Las advertencias de Git sobre conversión LF/CRLF corresponden a la configuración de Windows.
- Capturas de prueba: `C:/Users/vanin/AppData/Local/Temp/gestor-smoke-HZQ9Pt/desktop.png` y `C:/Users/vanin/AppData/Local/Temp/gestor-smoke-HZQ9Pt/mobile.png`. Sólo contienen datos aislados.

Durante la verificación se corrigió un desbordamiento móvil real. Los mensajes de error del backend durante las pruebas de fallos de Firestore son intencionales y verifican que no se informe éxito ante un commit fallido.

## Límites y pendientes

- No se verificó la conexión ni la persistencia contra el Firebase real. La persistencia de pruebas es simulada; el navegador utiliza una API en memoria para evitar cambios reales.
- Los horarios continúan dentro de una fecha: la salida debe ser posterior a la entrada. Un horario que cruza medianoche requiere una ampliación específica y validación entre fechas.
- El generador utiliza una selección heurística con prioridades. Las alertas siguen siendo necesarias para restricciones incompatibles o personal insuficiente; no promete encontrar el óptimo de cualquier combinación posible.
- La vista mensual conserva desplazamiento horizontal interno; en móviles se inicia en semana.
- La actualización entre navegadores es cada 30 segundos/al volver a la ventana, no una suscripción Firestore en tiempo real.
- Las consultas por período requieren los índices simples habituales de `date` y del array `dates`; los errores de permisos/índices se informan. Debe verificarse la configuración del proyecto real antes de publicar.
- No se creó un respaldo real, no se identificaron documentos reales como ficticios y no hay ningún ID autorizado para eliminar.

## Respaldo e inventario: ejecución bloqueada

Se preparó `scripts/audit-data.cjs`, que no inicia la API ni ejecuta semillas, migraciones o borrados. Exporta las ocho colecciones de la aplicación y sus subcolecciones, preserva tipos Firebase, genera checksum e inventario de relaciones por ID. Incluye `users`, que puede contener información de autenticación; los archivos se guardan en `.audit-backups/`, excluido de Git.

La revisión automática de permisos rechazó su ejecución sobre Firebase real porque considera necesaria una autorización específica para exportar esos datos, incluida la colección de usuarios. No se intentó sortear el rechazo. El inventario y respaldo reales requieren esa autorización. La exportación secuencial no es una instantánea transaccional: antes de cualquier eliminación hay que comprobarla sin escrituras concurrentes, ensayar restauración en un entorno aislado y presentar el manifiesto exacto para autorización separada. El script no elimina datos.

La publicación también permanece pendiente de autorización.

## Ajuste posterior: pantalla completa

Se reprodujo un desbordamiento con doce empleados de prueba: en una ventana de 900 píxeles de alto, la tarjeta del calendario llegaba a más de 3.400 píxeles. Su altura mínima permitía que la tabla creciera sin límite y desplazaba la barra horizontal al final de todo el equipo.

Se limita ahora la tarjeta al alto disponible, con desplazamiento vertical y horizontal dentro de la tabla. Los días permanecen fijos arriba y la columna de empleados a la izquierda. Al ampliar se restablece la posición inicial del contenedor. Se ensanchan las columnas en pantalla completa para que las horas no sobresalgan y se compactan los filtros en pantallas pequeñas. Los formularios y la cobertura siguen disponibles debajo del calendario.

Archivos de esta corrección: `web/src/App.jsx`, `web/src/styles.css` y `scripts/browser-smoke.cjs`. El script admite `--dev --fullscreen` para comprobar con datos aislados el mes en pantalla completa nativa, la semana en la vista alternativa a 1024×600, encabezados fijos, desbordamiento de tarjetas y retorno a la vista normal. No se modificó Firebase ni la lógica de asignaciones.

Resultado: `node scripts/browser-smoke.cjs --dev --fullscreen` aprobado, sin errores de consola. Se comprobó salida con botón en modo nativo y Escape en la vista alternativa, con recuperación del desplazamiento de la página. Captura: `C:/Users/vanin/AppData/Local/Temp/gestor-smoke-nJD1Y3/fullscreen-month.png`.

Compilación final de esta corrección: `npm run build` aprobado, JavaScript 204,47 kB (61,95 kB gzip) y CSS 18,83 kB (4,57 kB gzip).

## Documentación y pie de página

Se agregó `web/public/manual.html`: manual de uso con veinte secciones, índice, navegación interna, diseño adaptable y estilos de impresión. Incluye todos los módulos, reglas recurrentes y semanales, noches con dos personas fijas, generación, confirmación, advertencias, persistencia, límites y resolución de problemas. Se entrega también `documentacion/Manual-Gestor-de-Turnos.pdf`, generado desde ese HTML.

El pie de página de ingreso y de la aplicación indica «Vanina Coria · 2026 · ALFHA Soluciones Digitales» y «Gracias por confiar en nosotros.». Incluye acceso al manual y conserva el contacto existente. Se actualizaron `web/src/App.jsx`, `web/src/styles.css` y `README.md`; no se cambió la lógica de turnos ni los datos.

Se verificaron las veinte secciones, los destinos de todos los enlaces internos y la ausencia de IDs duplicados. El manual respondió correctamente desde el servidor local.

La copia PDF se generó correctamente: 12 páginas, 176.218 bytes. `npm run build` aprobado; la compilación incluye el manual HTML y el pie actualizado.

## Manual integrado y exportación del calendario

El menú «Manual de uso» permite consultar la documentación dentro del sistema. El HTML incorpora una sección sobre descarga y envío; sus 21 secciones y enlaces internos fueron verificados. Se actualizó también la copia PDF (12 páginas, 182.938 bytes).

El calendario ofrece «Descargar PDF», «Descargar CSV / Excel» y «Compartir PDF». Exporta el período y sector elegidos, los turnos manuales y cambios protegidos, descansos y advertencias. Distingue propuestas sin confirmar, confirmadas y planificación parcial. Descarta asignaciones de propuestas anteriores reemplazadas. El PDF se organiza por semanas en hojas A4 horizontales; el CSV incluye BOM para acentos y protección frente a fórmulas de planilla.

Compartir prepara un archivo local y solicita un segundo clic para abrir el menú del dispositivo conservando la activación del usuario. Si el navegador no admite compartir archivos, ofrece descargarlos y adjuntarlos en otra aplicación. No se envía nada automáticamente. Referencias: [jsPDF](https://github.com/parallax/jsPDF) y [Navigator.share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share).

Implementación: `web/src/CalendarExportControls.jsx`, `web/src/lib/calendar-export.js`, `web/src/lib/calendar-pdf.js`, integración en `App.jsx`, estilos y manual. La conversión PDF carga sus bibliotecas cuando se solicita. Se agregaron pruebas de selección de propuestas, filtros, CSV, descansos y paginación PDF en `server/test/calendar-export.test.js`; la suite completa aprobó sus 43 pruebas con datos aislados.

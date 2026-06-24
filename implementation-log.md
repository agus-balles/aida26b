# Implementation log

## 2026-06-17 - Inicio

QUE:
- Se inicia la implementacion del spec de reservas multiempresa sobre el
  proyecto existente.

COMO:
- Se mantiene la API generica `/api/:tableName` para entidades CRUD simples.
- Se agregaran rutas especificas solo para particionado automatico,
  disponibilidad y reservas transaccionales.
- Se mantendra `auth.users` como identidad y se agregara una tabla de permisos
  por empresa dentro del schema `auth`.
- Se usaran migraciones nuevas forward-only; no se modifican migraciones ya
  existentes.
- Se evitara agregar dependencias productivas.

Notas:
- El entorno local no tiene `node` ni `npm`; la verificacion final intentara
  usar Docker si esta disponible.

## 2026-06-17 - Schema de reservas

QUE:
- Se agrego la migracion `20260617_120000_court_reservations.sql`.

COMO:
- Se crearon tablas publicas para empresas, deportes, deportes por empresa,
  canchas, reglas de particionado, precios, timeblocks, reservas y locks.
- Se agrego `auth.user_companies` para permisos por empresa manteniendo la
  identidad en `auth.users`.
- Se sembraron reglas iniciales `soccer_11 -> soccer_8` y
  `soccer_8 -> soccer_5`, cada una con tres subcanchas.
- Se agregaron indices para busquedas por empresa, arbol de canchas y locks.
- No se uso extension PostgreSQL nueva; la defensa contra overlaps se hara con
  transacciones y advisory locks en backend.

## 2026-06-17 - CRUD base y SSOT

QUE:
- Se extendio la SSOT con entidades administrables del dominio de canchas.
- Se ajusto el CRUD generico para soportar IDs autogenerados y PK numericas.

COMO:
- Se agregaron `companies`, `sports`, `company_sports`, `courts`,
  `court_partition_rules`, `court_prices` y `company_time_blocks` a
  `shared/src/ssot/structure.ts`.
- `bookings` queda fuera del CRUD generico para que solo se creen mediante el
  flujo transaccional de reserva.
- `backend/src/helpers.ts` ahora excluye campos `editable: false` de inserts y
  updates genericos; esto permite mostrar `id` sin pedirlo en formularios.
- `shared/src/validation/validate.ts` acepta strings numericos para columnas
  `number`, necesario para IDs que llegan por query params.

## 2026-06-17 - Backend de reservas

QUE:
- Se implementaron las rutas especificas de canchas y reservas.

COMO:
- Se agrego `backend/src/reservations.ts` con:
  - particionado automatico recursivo usando reglas de `court_partition_rules`;
  - validacion de layouts normalizados y sin overlaps;
  - disponibilidad por empresa/deporte/fecha/duracion;
  - holds de reserva con rollback ante error;
  - confirmacion y cancelacion de reservas;
  - expiracion simple de holds vencidos;
  - calculo de locks atomicos para preservar subcanchas hermanas compatibles;
  - regla anti-fragmentacion para llenar primero el grupo padre ya ocupado.
- Se conectaron las rutas en `backend/src/server.ts` antes del CRUD generico:
  - `POST /api/companies/:companyId/courts`
  - `GET /api/companies/:companyId/availability`
  - `POST /api/bookings/hold`
  - `POST /api/bookings/:id/confirm`
  - `POST /api/bookings/:id/cancel`
- Para concurrencia se usa `pg_advisory_xact_lock` por cancha raiz y dia,
  dentro de la misma transaccion que crea el hold y sus locks.

## 2026-06-17 - Frontend de reservas

QUE:
- Se agrego una vista de reservas/disponibilidad dentro del shell existente.

COMO:
- `frontend/src/app.ts` crea una vista dinamica `availability-section` junto a
  la tabla CRUD actual.
- Se agrego un boton de navegacion `Reservas`.
- La vista carga empresas, deportes y bloques de duracion desde la API
  existente.
- El mapa consume `GET /api/companies/:companyId/availability` y dibuja las
  canchas con layout normalizado.
- Los slots disponibles permiten crear un hold con `POST /api/bookings/hold`
  y luego confirmar con `POST /api/bookings/:id/confirm`.
- Al crear una cancha desde el CRUD de `courts`, el submit usa
  `POST /api/companies/:companyId/courts` para que el backend aplique
  particionado automatico en transaccion.

## 2026-06-17 - Tests enfocados

QUE:
- Se agregaron tests unitarios para reglas criticas sin requerir base de datos.

COMO:
- `backend/test/reservations.test.ts` cubre:
  - layouts validos sin solape;
  - rechazo de layouts con solape;
  - calculo de canchas atomicas bajo una cancha grande;
  - compactacion para llenar primero las canchas de 5 hermanas dentro de la
    misma cancha de 8;
  - apertura de otro grupo cuando el primero ya esta lleno.
- `backend/vitest.config.mts` ahora incluye esos tests junto a los de auth.

## 2026-06-17 - Verificacion y launch

QUE:
- Se verifico y se dejo el proyecto corriendo con Docker Compose.

COMO:
- `docker compose build` compilo la imagen frontend correctamente.
- `docker compose run --rm backend npm run build` compilo TypeScript backend.
- Tests backend en contenedor:
  - `test/auth.test.ts`: 6 tests OK.
  - `test/reservations.test.ts`: 5 tests OK.
- Tests frontend en contenedor:
  - `test/menuButtons.test.ts`: 9 tests OK.
- Se agrego `frontend/test/setup.ts` para proveer `localStorage` estable en el
  runtime de Vitest usado por Docker.
- Se levanto el proyecto con `docker compose up -d`.
- Contenedores finales:
  - backend en `0.0.0.0:3000`
  - frontend en `0.0.0.0:8080`
  - database en `0.0.0.0:5432`
- Verificacion HTTP interna:
  - frontend responde HTML en `http://127.0.0.1:8080`.
  - backend responde `401 Unauthorized` en `/api/auth/me` sin cookie, como se
    espera.

Notas:
- El `curl` desde el sandbox del host no pudo conectar a puertos publicados,
  pero las pruebas desde dentro de los contenedores y `docker compose ps`
  confirman que los servicios estan arriba.

## 2026-06-17 - Eliminacion del modelo anterior

QUE:
- Se removio la superficie activa del modelo anterior de alumnos, materias e
  inscripciones.

COMO:
- Se quitaron esas tablas de la SSOT compartida, por lo que ya no aparecen en
  la UI ni en el CRUD generico.
- Se elimino del backend el caso especial que creaba usuarios al crear alumnos.
- Se renombro la guardia de escritura generica de `requireAcademicWrite` a
  `requireBusinessWrite`.
- Se removieron tests, fixtures, datos y prompts del dominio anterior.
- Se actualizo el README y los titulos visibles al producto de reservas de
  canchas.
- Se agrego la migracion forward-only
  `20260617_130000_remove_academic_model.sql`, que elimina `enrollments`,
  `students` y `subjects` del schema final.

Notas:
- Las migraciones historicas anteriores a esta evolucion conservan referencias
  al modelo viejo porque el sistema de migraciones valida checksums y no deben
  editarse despues de aplicadas.

Verificacion:
- Backend TypeScript compila con `npm run build`.
- Tests backend: 11 tests OK.
- Tests frontend: 9 tests OK.
- `docker compose build` OK.
- `docker compose up -d` aplico 1 migracion pendiente.
- Verificacion en DB: `students`, `subjects` y `enrollments` ya no existen en
  el schema `public`; siguen `companies`, `courts` y `bookings`.

## 2026-06-23 - Remocion de accesos de usuarios antiguos

QUE:
- Se removieron los controles "Agregar Profesor" y "Agregar Admin" de la UI.

COMO:
- Se elimino el bloque de acciones del toolbar, sus listeners, textos y estilos.
- Se elimino el formulario frontend que esos controles abrían.
- Los endpoints de administracion de usuarios se mantienen sin cambios para una
  futura pantalla especifica de usuarios.

## 2026-06-23 - Flujo de empresas, deportes y canchas

QUE:
- Se corrigio el alta de deportes por empresa y se reforzo el flujo completo
  desde empresa hasta cancha, precio y bloques horarios.

COMO:
- La validacion compartida ahora compara opciones de selects por su valor
  normalizado. Asi, un ID numerico enviado por el formulario coincide con la
  opcion cargada desde la API aunque el navegador la represente como texto.
- Los formularios muestran mensajes accionables en lugar de errores internos;
  por ejemplo, una opcion invalida ahora indica que se seleccione una opcion
  valida y un duplicado de deporte explica que ya esta asociado a la empresa.
- Se agregaron valores iniciales para zona horaria, moneda, bloque horario,
  prioridad y area util, evitando formularios incompletos en campos con un
  valor natural del dominio.
- Al crear una cancha, la UI limita los deportes a los que la empresa ya ofrece
  y limita el formato al deporte elegido. El backend vuelve a comprobar ambas
  reglas dentro de la transaccion.
- Se agregaron restricciones de base de datos para que una cancha solo pueda
  usar una combinacion empresa/deporte existente y para que un precio conserve
  el mismo deporte de su cancha.
- Se cargaron 5 deportes (futbol, padel, tenis, basquet y voley) y 20 empresas
  de ejemplo en la base local.
- Se verifico por API el alta de una cancha de padel, su precio por hora y un
  bloque de 120 minutos para una empresa que ofrece ese deporte.

Verificacion:
- Backend TypeScript compila con `npm run build`.
- Tests backend: 11 tests OK.
- Tests frontend: 10 tests OK, incluido el caso de IDs numericos en selects.
- Servicios Docker activos en los puertos 3000 (API), 8080 (frontend) y 5432
  (PostgreSQL).

## 2026-06-23 - Orden de dependencias al crear canchas

QUE:
- Se reordeno el formulario de canchas para elegir el deporte antes del
  formato.

COMO:
- La SSOT ahora presenta los campos editables como empresa, nombre, deporte,
  formato y particionado.
- El formato conserva su dependencia del deporte: antes de elegirlo muestra
  una indicacion y despues solo ofrece los formatos compatibles.
- Se agrego una prueba de regresion que confirma que `sport_id` precede a
  `format` en el formulario.

## 2026-06-23 - Deportes disponibles por empresa

QUE:
- Se asociaron todos los deportes activos a todas las empresas activas.

COMO:
- Se inserto la relacion empresa/deporte mediante un producto cartesiano en
  PostgreSQL con `ON CONFLICT DO NOTHING`, por lo que se preservan las
  asociaciones existentes y no se generan duplicados.
- Resultado local: 21 empresas activas, 5 deportes activos y 105 asociaciones.

## 2026-06-23 - Etiquetas en tablas relacionales

QUE:
- La tabla "Deportes por Empresa" ahora muestra los nombres de empresa y
  deporte en lugar de sus IDs.

COMO:
- El renderizador de tablas usa la metadata `foreignKey` existente para cargar
  las filas referenciadas y construir mapas de ID a etiqueta visible.
- Los IDs se mantienen sin cambios para filtros, acciones y persistencia; solo
  se mejora la representacion de las celdas.

## 2026-06-23 - Catalogo y configuracion declarativa de particiones

QUE:
- Se incorporo un catalogo de 13 reglas activas de particion, incluida la
  conversion Tenis a Padel.
- Se reemplazo la edicion manual de `layout_json` por distribuciones nombradas
  y una vista previa visual.

COMO:
- Las nuevas migraciones agregan formatos de futbol 6, 7 y 9, media cancha de
  basquet, zona de entrenamiento de voley y una regla Tenis a Padel con deporte
  destino explicito.
- Al crear una cancha particionable, el formulario carga las reglas activas del
  formato elegido y exige seleccionar una cuando existen alternativas.
- La distribucion elegida determina automaticamente la cantidad de subcanchas
  y se guarda como JSON solo como detalle interno de persistencia.
- El backend valida la regla elegida dentro de la transaccion y mantiene los
  locks de reserva sobre todo el arbol, incluso cuando la regla cambia el
  deporte de una cancha hija.

## 2026-06-24 - Permisos estrictos por empresa y reservas publicas

QUE:
- Se implemento el alcance estricto por empresa, la administracion de roles
  usuario-empresa y el flujo publico de disponibilidad y holds.

COMO:
- `auth.user_companies` sigue separando identidad y pertenencia: el admin
  global accede a todo; los demas usuarios solo ven y operan las empresas que
  tienen asignadas. `owner`, `manager` y `staff` pueden operar; `viewer` solo
  consulta. Los catalogos globales siguen siendo de administracion global.
- El lector del CRUD generico ahora filtra empresas, deportes por empresa,
  bloques horarios, canchas y precios segun los vinculos del usuario. Sin
  vinculos, un no-admin no recibe datos empresariales.
- Se agregaron endpoints publicos de empresas, deportes y bloques activos. La
  disponibilidad y la creacion de holds no requieren sesion; un hold anonimo
  queda sin usuario creador, vence a los diez minutos y espera confirmacion de
  un operador.
- El hold publico usa un limite simple en memoria de 10 intentos por IP cada 10
  minutos, sin dependencias productivas. Confirmar y cancelar mantienen sesion,
  contrasena actualizada y rol operativo para la empresa de la reserva.
- Se agregaron los endpoints `GET /api/admin/users`,
  `GET /api/admin/users/:id/companies`,
  `POST /api/admin/users/:id/companies` y
  `DELETE /api/admin/users/:id/companies/:companyId`. Validan IDs y roles de
  empresa, actualizan `auth.user_companies` y auditan el cambio sin registrar
  secretos.
- Se agrego la pantalla `Permisos` dentro del shell existente. Solo el admin
  global la ve; permite elegir usuario, empresa y rol, consultar vinculos y
  quitarlos. Se reutilizan los patrones actuales de selects, formularios y
  tablas.
- La pantalla de ingreso incluye el mapa publico de reservas. Fuera de sesion
  informa que la empresa debe confirmar el hold; dentro de sesion un operador
  puede crear y confirmar el suyo. El backend conserva la validacion final.
- `auth.md` se conserva localmente, se ignora en Git y deja de participar del
  tracking.

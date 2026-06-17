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

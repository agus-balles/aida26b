# Autenticación y autorización

Este documento resume qué se implementó para el feature de auth y dónde vive cada parte del cambio. Los rangos de líneas corresponden al commit actual de esta rama.

## Modelo de datos

| Feature | Archivo y líneas | Qué implementa |
| --- | --- | --- |
| Esquema lógico `auth` | `database/schema.sql:49-50` | Crea un esquema separado para identidad y sesiones dentro de la misma base PostgreSQL del negocio. |
| Usuarios | `database/schema.sql:52-64` | Define `auth.users` con `username`, `email`, hash/salt de contraseña, rol `admin/editor/reader`, estado activo, flag `must_change_password` y vínculo opcional al alumno académico. |
| Sesiones | `database/schema.sql:66-72` | Define `auth.sessions`, que guarda solo el hash del token opaco enviado en cookie. |
| Auditoría | `database/schema.sql:74-83` | Define `auth.audit_log` para registrar login, logout, cambios de password, permisos denegados y acciones admin relevantes. |
| Seguridad DB | `database/schema.sql:85-100` | Revoca acceso público al esquema `auth`, agrega índices básicos y otorga permisos al usuario de aplicación. |
| Migración incremental | `database/auth-user-password-migration.sql:1-13` | Agrega `must_change_password` y `student_numero_libreta` sobre instalaciones ya existentes, y deja al admin inicial sin cambio obligatorio. |

## Backend

| Feature | Archivo y líneas | Qué implementa |
| --- | --- | --- |
| Helpers de auth | `backend/src/auth.ts:1-88` | Centraliza roles, usuario público, hash de contraseña con `crypto.scrypt`, verificación con comparación segura, generación/hash de tokens y cookies `HttpOnly`. |
| Export para tests | `backend/src/server.ts:23-33`, `backend/src/server.ts:492-496` | Exporta `app` y `pool`, y solo levanta el server cuando el archivo se ejecuta directamente. Esto permite testear sin abrir el puerto fijo. |
| CORS con cookies | `backend/src/server.ts:35-37` | Habilita credenciales para que el frontend pueda usar la cookie de sesión. |
| Auditoría técnica | `backend/src/server.ts:53-62` | Inserta eventos en `auth.audit_log` sin loguear passwords, hashes, salts, cookies ni tokens. |
| Carga de sesión | `backend/src/server.ts:64-77` | Lee la cookie, hashea el token recibido y valida sesión activa contra `auth.sessions` + `auth.users`. |
| Middlewares de autorización | `backend/src/server.ts:79-108` | Implementa `requireAuth`, bloqueo por `must_change_password`, permiso admin y permiso de escritura académica para `admin/editor`. |
| Login | `backend/src/server.ts:110-140` | Valida username/password, crea sesión, audita éxito/fallo y devuelve usuario público. |
| Logout | `backend/src/server.ts:142-157` | Borra la sesión por hash del token, limpia la cookie y audita logout. |
| Sesión actual | `backend/src/server.ts:159-161` | Implementa `GET /api/auth/me`. |
| Cambio obligatorio de contraseña | `backend/src/server.ts:163-196` | Implementa `POST /api/auth/change-password`, valida contraseña actual, actualiza hash/salt y apaga `must_change_password`. |
| Gestión admin de usuarios | `backend/src/server.ts:198-250` | Implementa creación de usuarios y reset de password administrado; ambos requieren sesión lista y rol admin. |
| Protección de alumnos | `backend/src/server.ts:253-334` | Lectura requiere sesión; crear/editar/borrar requiere `admin/editor`. Crear alumno también crea cuenta `reader` con username igual a `numero_libreta`. |
| Protección de materias | `backend/src/server.ts:337-405` | Lectura requiere sesión; crear/editar/borrar requiere `admin/editor`. |
| Protección de inscripciones | `backend/src/server.ts:408-482` | Lectura requiere sesión; crear/editar/borrar requiere `admin/editor`. |
| Seed del admin | `backend/src/seed-admin.ts:1-46` | Crea o actualiza el usuario admin inicial usando `ADMIN_USERNAME`, `ADMIN_PASSWORD` y `ADMIN_EMAIL`. |
| Scripts backend | `backend/package.json:6-14` | Agrega `seed-admin` y `test` sin dependencias productivas nuevas. |
| Variables de ejemplo | `backend/.env-example:11-14` | Documenta las variables necesarias para crear el admin inicial. |

## Frontend

| Feature | Archivo y líneas | Qué implementa |
| --- | --- | --- |
| Estructura visual de auth | `frontend/index.html:112-135` | Estilos mínimos para login, topbar, toolbar, acciones admin y mensajes. |
| Login | `frontend/index.html:142-156` | Formulario de username/password. |
| Cambio de contraseña | `frontend/index.html:158-172` | Formulario requerido para usuarios con `must_change_password`. |
| Shell autenticado | `frontend/index.html:174-198` | Topbar con usuario actual, logout, navegación y botones admin solo dentro de la vista principal. |
| Tipos y estado de sesión | `frontend/src/app.ts:4-14`, `frontend/src/app.ts:203-208` | Define roles, `AuthUser`, usuario actual y helper para saber si puede escribir datos académicos. |
| Control de pantallas | `frontend/src/app.ts:215-244` | Alterna entre login, cambio de contraseña y app según el estado de sesión. |
| Fetch autenticado | `frontend/src/app.ts:246-266` | Envía cookies con cada request y maneja `401`/`403` en un solo lugar. |
| Acciones por rol y sección | `frontend/src/app.ts:268-283`, `frontend/src/app.ts:300-319` | Oculta agregar/editar/borrar para `reader`; muestra agregar profesor/admin solo si el usuario es admin y está en `students`. |
| Form admin de profesor/admin | `frontend/src/app.ts:452-520`, `frontend/src/app.ts:638-639` | Los botones de admin abren un formulario que crea `editor` para profesor o `admin` para admin. |
| Password inicial de alumno | `frontend/src/app.ts:540-570` | El formulario de alta de alumno pide contraseña inicial y la manda al backend. |
| Login/logout/me/change-password | `frontend/src/app.ts:641-728` | Implementa login, cambio de password obligatorio, logout y recuperación de sesión al cargar la app. |

## Tests

| Caso | Archivo y líneas | Qué valida |
| --- | --- | --- |
| Fake DB y server aislado | `backend/test/auth.test.js:7-147` | Simula Postgres en memoria y levanta Express en un puerto aleatorio para probar endpoints reales. |
| Login, me y logout | `backend/test/auth.test.js:149-166` | Login fallido audita error; login correcto crea cookie; `/me` responde; logout invalida sesión. |
| Reader sin escritura | `backend/test/auth.test.js:168-181` | `reader` puede leer pero recibe `403` al intentar crear datos académicos. |
| Editor académico sin admin | `backend/test/auth.test.js:183-198` | `editor` puede crear alumno/cuenta `reader`, pero no crear usuarios admin. |
| Admin gestiona usuarios | `backend/test/auth.test.js:200-215` | `admin` crea usuarios, resetea password y fuerza cambio en el próximo login. |
| Primer login cambia password | `backend/test/auth.test.js:217-237` | Usuario nuevo queda bloqueado hasta cambiar contraseña, luego puede usar la app. |

## Decisiones de alcance

- Los alumnos siguen siendo datos académicos en `students`; las cuentas viven en `auth.users`.
- El username del alumno creado desde el alta es `numero_libreta`.
- Los roles quedan en MVP: `reader` lee, `editor` escribe datos académicos, `admin` escribe datos académicos y gestiona usuarios.
- No se agregaron dependencias productivas para hashing ni sesiones: se usa `crypto` nativo de Node.
- La cookie lleva un token opaco; la base guarda solo su hash.
- El código nuevo evita capas genéricas innecesarias y mantiene la lógica de auth acotada a `auth.ts` + cambios inline en `server.ts`.

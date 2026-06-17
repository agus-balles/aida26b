# Sistema Multiempresa de Reservas de Canchas

Este proyecto implementa una plataforma para gestionar empresas deportivas,
canchas, particiones de canchas, precios, bloques de reserva y reservas con
bloqueo transaccional.

## Características

- **Multiempresa**: cada empresa tiene sus propias canchas, deportes y precios.
- **Multicancha**: una cancha grande puede operar como varias canchas chicas.
- **Particionado automático**: al crear una cancha particionable se generan sus
  subcanchas según reglas configuradas.
- **Disponibilidad interactiva**: vista de mapa con canchas, horarios, precios
  y estados de disponibilidad.
- **Reservas transaccionales**: holds y confirmaciones con rollback ante error.
- **Antioverlap**: bloqueo de canchas atómicas para impedir reservas
  incompatibles.
- **Antifragmentación**: las reservas chicas llenan primero el grupo padre ya
  ocupado antes de abrir otro.
- **Auth existente**: usuarios en `auth.users`, sesiones por cookie HttpOnly y
  permisos por empresa en `auth.user_companies`.

## Tecnologías

- Backend: Node.js, TypeScript, Express.js
- Frontend: Vanilla TypeScript, HTML5, CSS3
- Base de datos: PostgreSQL
- Acceso a datos: SQL directo con `pg`

## Estructura

```text
/
├── backend/              # API REST
│   ├── src/
│   │   ├── server.ts
│   │   └── reservations.ts
│   └── test/
├── frontend/             # Interfaz web
│   ├── src/app.ts
│   └── styles/
├── shared/               # SSOT, tipos y validaciones compartidas
├── database/
│   ├── bootstrap.sql
│   └── migrations/
├── spec.md
└── implementation-log.md
```

## Docker

La forma más rápida de levantar todo:

```bash
docker compose up --build
```

Esto levanta PostgreSQL, backend y frontend. La app queda en
http://localhost:8080.

Para una imagen única backend+frontend:

```bash
docker compose -f docker-compose.combined.yml up --build
```

En ese modo la app queda en http://localhost:3000.

## Base de datos

Setup inicial, una vez por entorno:

```bash
psql -U postgres -f database/bootstrap.sql
```

Aplicar migraciones desde `backend/`:

```bash
npm run migrate
```

Las migraciones son forward-only y se registran con checksum. Para cambiar el
schema se agrega una migración nueva; no se editan migraciones ya aplicadas.

## Backend

Variables principales:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=faculty_management
DB_USER=aida26_user
DB_PASSWORD=CambiaEsta!
PORT=3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=yourpassword
ADMIN_EMAIL=admin@example.com
```

Comandos:

```bash
npm --prefix backend run build
npm --prefix backend run migrate
npm --prefix backend run seed-admin
npm --prefix backend start
```

## Frontend

```bash
npm --prefix frontend run build
npm --prefix frontend run dev
```

El servidor de desarrollo corre en http://localhost:8080 y proxya `/api` al
backend.

## Endpoints principales

CRUD genérico protegido por auth:

- `/api/companies`
- `/api/sports`
- `/api/company_sports`
- `/api/courts`
- `/api/court_partition_rules`
- `/api/court_prices`
- `/api/company_time_blocks`

Endpoints específicos:

- `POST /api/companies/:companyId/courts`
- `GET /api/companies/:companyId/availability`
- `POST /api/bookings/hold`
- `POST /api/bookings/:id/confirm`
- `POST /api/bookings/:id/cancel`

Auth:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/change-password`
- `POST /api/admin/users`
- `POST /api/admin/users/:id/reset-password`

## Tests

```bash
npm --prefix backend test
npm --prefix frontend test
```

En entornos sin Node local se pueden correr dentro de Docker, montando tests y
configs como se documenta en `implementation-log.md`.

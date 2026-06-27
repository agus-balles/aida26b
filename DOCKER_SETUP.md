# Docker Setup Guide

## Quick Start

### Option 1: Separated Services (Recommended for Development)

To build and run with separate containers for backend and frontend:

```bash
docker compose up --build
```

This configuration is ideal for development as it allows independent service management and easier debugging.

**Access the application:**
- Frontend: http://localhost:8080
- Backend API: http://localhost:3000
- Database: localhost:5432

---

### Option 2: Combined Container (Canonical for testing and simplified deploy)

To build and run with both backend and frontend in a single container (canonical):

```bash
docker compose -f docker-compose.combined.yml up --build
```

This configuration combines both services into one container with the frontend served as static files by the backend.

**Access the application:**
- Application: http://localhost:3000 (both frontend and API)
- Database: localhost:5432

---

### Option 3: Plain Docker

The root `Dockerfile` builds the combined app image, so plain Docker works too.
Run Postgres on the same Docker network, then run the app with the same database
environment:

```bash
docker network create aida26_network

docker run -d --name aida26_database --network aida26_network \
  -e POSTGRES_USER=aida26_user \
  -e POSTGRES_PASSWORD=CambiaEsta! \
  -e POSTGRES_DB=faculty_management \
  -v aida26_postgres_data:/var/lib/postgresql \
  -p 5432:5432 \
  postgres:18-alpine

docker build -t aida26-app .

docker run --rm --name aida26_app --network aida26_network \
  -e DB_HOST=aida26_database \
  -e DB_PORT=5432 \
  -e DB_NAME=faculty_management \
  -e DB_USER=aida26_user \
  -e DB_PASSWORD=CambiaEsta! \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=AdminPass1234 \
  -e ADMIN_EMAIL=admin@example.com \
  -p 3000:3000 \
  aida26-app
```

Access the application at http://localhost:3000.

---

## Comparison

| Aspect | Separated | Combined |
|--------|-----------|----------|
| Containers | 3 (database, backend, frontend) | 2 (database, app) |
| Use Case | Development, Microservices | Production, Testing |
| Frontend Port | 8080 | Same as Backend (3000) |
| Scalability | High (independent scaling) | Lower (bound together) |
| Debugging | Easier (separate logs) | More complex |
| Resource Usage | Higher | Lower |
| Build Time | Faster (parallel builds) | Slower (sequential build) |

## Common Commands

### Separated services (default)

Start services in the background:
```bash
docker compose up -d --build
```

### Combined services

Start services in the background:
```bash
docker compose -f docker-compose.combined.yml up -d --build
```

### Both configurations

Stop all services:
```bash
docker compose down                                  # Separated
docker compose -f docker-compose.combined.yml down   # Combined
```

Stop services and remove volumes (clean database):
```bash
docker compose down -v                                  # Separated
docker compose -f docker-compose.combined.yml down -v   # Combined
```

View logs:
```bash
docker compose logs -f                                # All services (separated)
docker compose -f docker-compose.combined.yml logs -f # Combined
docker compose logs -f backend                        # Backend only (separated)
docker compose -f docker-compose.combined.yml logs -f app # App service (combined)
```

Restart a specific service:
```bash
docker compose restart backend                         # Separated
docker compose -f docker-compose.combined.yml restart app # Combined
```

Rebuild a specific service:
```bash
docker compose up -d --build backend                         # Separated
docker compose -f docker-compose.combined.yml up -d --build app # Combined
```

Access the database directly:
```bash
docker compose exec database psql -U aida26_user -d faculty_management
docker compose -f docker-compose.combined.yml exec database psql -U aida26_user -d faculty_management
```

## Services Architecture

### Separated Configuration (docker-compose.yml)

- **database**: PostgreSQL 18 Alpine
  - Container: aida26_database
  - Port: 5432
  - Persistent data in `postgres_data` volume
  - Database and initial user are created from `POSTGRES_*` env vars; schema is applied via backend migrations at app startup

- **backend**: Node.js/Express
  - Container: aida26_backend
  - Port: 3000
  - Language: TypeScript (with tsx)
  - Runs in development mode with hot-reload
  - Depends on database service

- **frontend**: Webpack development server
  - Container: aida26_frontend
  - Port: 8080
  - Language: TypeScript
  - Serves frontend assets and proxies API requests to the backend
  - Depends on backend service

### Combined Configuration (docker-compose.combined.yml)

- **database**: PostgreSQL 18 Alpine
  - Container: aida26_database
  - Port: 5432
  - Persistent data in `postgres_data` volume
  - Database and initial user are created from `POSTGRES_*` env vars; the `app` service runs migrations on startup to create schema

- **app**: Node.js/Express (Backend + Frontend)
  - Container: aida26_app
  - Port: 3000
  - Language: TypeScript (with tsx)
  - Frontend files served as static content from `/app/frontend/dist`
  - Backend API available at `/api/*`
  - Depends on database service
  - Single container simplifies deployment and resource management

## Environment Variables

Environment variables are configured in each compose file:

**Separated configuration (docker-compose.yml):**
```
NODE_ENV: development
PORT: 3000
DB_HOST: database (Docker service name)
DB_PORT: 5432
DB_NAME: faculty_management
DB_USER: aida26_user
DB_PASSWORD: CambiaEsta!
API_URL: http://backend:3000  # Used by frontend
```

**Combined configuration (docker-compose.combined.yml):**
```
NODE_ENV: development
PORT: 3000
DB_HOST: database (Docker service name)
DB_PORT: 5432
DB_NAME: faculty_management
DB_USER: aida26_user
DB_PASSWORD: CambiaEsta!
```

To use different values, create a `.env` file in the project root. An example is provided in `.env.example`:

```bash
cp .env.example .env
# Edit .env and set secure values, especially DB_PASSWORD and ADMIN_PASSWORD.
# ADMIN_PASSWORD must have 12+ chars with uppercase, lowercase and a number.
```

## Troubleshooting

### Database connection refused
- Ensure database service is healthy: `docker compose ps` (separated) or `docker compose -f docker-compose.combined.yml ps` (combined)
- Check database logs: `docker compose logs database`
- Wait for health check to pass (usually 30-60 seconds)

### Backend cannot connect to database
- Verify services are on the same network: `docker network ls`
- Check backend logs: `docker compose logs backend` (separated) or `docker compose -f docker-compose.combined.yml logs app` (combined)
- Ensure DB_HOST is set to `database` (the service name)

### Frontend cannot reach backend (Separated configuration only)
- Check if both services are running: `docker compose ps`
- Verify API_URL is correct in frontend (should be http://backend:3000)
- Check frontend logs: `docker compose logs frontend`

### Port already in use
- Stop existing containers: `docker compose down` or `docker compose -f docker-compose.combined.yml down`
- Or change ports in the respective compose file

### Services won't start (Combined configuration)
- The combined build can take longer due to building both frontend and backend
- Check build logs: `docker compose -f docker-compose.combined.yml up --build` (without -d flag)
- Ensure `Dockerfile` exists in project root

## Development

### Separated Configuration
For active development with separated services, volumes enable hot-reload:

- **Backend**: `/backend/src` is mounted, changes trigger tsx watch reload
- **Frontend**: Source is copied during build; rebuild required for changes

To rebuild after code changes:
```bash
docker compose up -d --build backend  # Rebuild backend
docker compose up -d --build frontend # Rebuild frontend
```

### Combined Configuration
For the combined configuration:

- **Backend**: Changes to `/backend/src` trigger tsx watch reload
- **Frontend**: Changes require rebuilding the container

To rebuild after code changes:
```bash
docker compose -f docker-compose.combined.yml up -d --build app
```

**Note**: The combined configuration is better for production than development since frontend changes require a full rebuild.

## Production Deployment

### When to Use Each Configuration

**Use Separated Configuration (docker-compose.yml) if:**
- You need independent scaling for frontend/backend
- You want to deploy services to different servers/regions
- You need separate CDN/caching strategies per service
- Backend load is significantly higher than frontend

**Use Combined Configuration (docker-compose.combined.yml) if:**
- You want simpler deployment and management
- Resources are limited
- Frontend and backend load is similar
- You don't need independent scaling

### General Production Recommendations

For both configurations, you would typically:

1. Build images once and push to registry
2. Use environment-specific Compose files (e.g., compose.prod.yml)
3. Set `NODE_ENV=production`
4. Use Alpine images for smaller size (already configured)
5. Add reverse proxy (nginx) for SSL/TLS
6. Use secrets management for sensitive data (database passwords)
7. Remove volume mounts and use only the built artifacts
8. Set resource limits and memory constraints
9. Use health checks and restart policies
10. Implement logging aggregation

Example production Compose files can be created upon request.

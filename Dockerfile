FROM node:25-alpine AS frontend-build

WORKDIR /app/frontend

# Install frontend dependencies first for better layer caching
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

# Build frontend assets
COPY frontend/src ./src
COPY frontend/index.html ./
COPY frontend/tsconfig.json ./
COPY frontend/webpack*.js ./
COPY frontend/styles ./styles
COPY tsconfig.base.json /app/tsconfig.base.json
COPY shared/src /app/shared/src
RUN npm run build


FROM node:25-alpine

WORKDIR /app/backend

# Install backend dependencies
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci

# Copy database migration files
COPY database/migrations /app/database/migrations

# Copy backend source
COPY backend/src ./src
COPY backend/tsconfig.json ./
COPY tsconfig.base.json /app/tsconfig.base.json
COPY shared/src /app/shared/src

# Place frontend dist where server.ts expects it: /app/frontend/dist
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

EXPOSE 3000
CMD ["sh", "-c", "npm run migrate && npm run seed-admin && npm run dev"]

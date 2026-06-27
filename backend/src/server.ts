import express from 'express';
import type { Request, RequestHandler } from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

import * as auth from './auth';
import {
  cancelBooking,
  applyCourtPartitionRule,
  confirmBooking,
  createCourtWithPartitions,
  getCompanyAvailability,
  holdBooking,
} from './reservations';

import { getHandler } from './routes/get';
import { putHandler } from './routes/put';
import { postHandler } from './routes/post';
import { deleteHandler } from './routes/delete';
import {
  enforceCompanyScope,
  fetchUserCompanyLinks,
  fetchReadableCompanyIds,
  isCompanyRole,
} from './companyAccess';

// Load environment variables before reading process.env
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Middleware
app.use(cors());
app.use(express.json());

type AuthedRequest = Request & { user?: auth.AuthUser };

function getSessionToken(req: Request) {
  return auth.parseCookies(req.headers.cookie)[auth.SESSION_COOKIE];
}

function readPassword(value: unknown) {
  return auth.isStrongPassword(value) ? value : null;
}

function readUsername(value: unknown) {
  const username = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9._-]{3,80}$/.test(username) ? username : null;
}

function readEmail(value: unknown) {
  const email = typeof value === 'string' ? value.trim() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255
    ? email
    : null;
}

function isCreatableUserRole(value: unknown): value is 'reader' | 'editor' {
  return value === 'reader' || value === 'editor';
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

async function audit(
  req: Request,
  eventType: string,
  outcome: string,
  details: Record<string, unknown> = {}
) {
  try {
    await pool.query(
      `INSERT INTO auth.audit_log
       (actor_user_id, event_type, outcome, ip, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        (req as AuthedRequest).user?.id ?? null,
        eventType,
        outcome,
        req.ip,
        req.get('user-agent') ?? null,
        JSON.stringify(details),
      ]
    );
  } catch (error) {
    console.error('Error writing audit log:', error);
  }
}

async function loadSession(req: Request) {
  const token = getSessionToken(req);

  if (!token) {
    return null;
  }

  const result = await pool.query(
    `SELECT
       s.id AS session_id,
       u.id,
       u.username,
       u.email,
       u.role,
       u.is_active,
       u.must_change_password
     FROM auth.sessions s
     JOIN auth.users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.expires_at > now()
       AND u.is_active = true`,
    [auth.hashToken(token)]
  );

  return result.rows[0] ? auth.publicUser(result.rows[0]) : null;
}

const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const user = await loadSession(req);

    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    (req as AuthedRequest).user = user;
    next();
  } catch (error) {
    next(error);
  }
};

const requireAdmin: RequestHandler = async (req, res, next) => {
  if ((req as AuthedRequest).user?.role === 'admin') {
    return next();
  }

  await audit(req, 'permission_denied', 'denied', {
    path: req.path,
    method: req.method,
  });

  return res.status(403).json({ error: 'Forbidden' });
};

const holdAttemptsByIp = new Map<string, number[]>();
const HOLD_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const HOLD_LIMIT_MAX_ATTEMPTS = 10;
const HOLD_LIMIT_CLEANUP_INTERVAL_MS = 60 * 1000;
let lastHoldAttemptCleanup = 0;

const limitPublicHolds: RequestHandler = (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  if (now - lastHoldAttemptCleanup >= HOLD_LIMIT_CLEANUP_INTERVAL_MS) {
    for (const [knownIp, knownAttempts] of holdAttemptsByIp) {
      if (knownAttempts.every((attempt) => now - attempt >= HOLD_LIMIT_WINDOW_MS)) {
        holdAttemptsByIp.delete(knownIp);
      }
    }
    lastHoldAttemptCleanup = now;
  }

  const attempts = (holdAttemptsByIp.get(ip) ?? []).filter(
    (attempt) => now - attempt < HOLD_LIMIT_WINDOW_MS
  );

  if (attempts.length >= HOLD_LIMIT_MAX_ATTEMPTS) {
    return res.status(429).json({
      error: 'Alcanzaste el límite de intentos de reserva. Esperá unos minutos e intentá nuevamente.',
    });
  }

  attempts.push(now);
  holdAttemptsByIp.set(ip, attempts);
  return next();
};

function readPublicId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function enforceScopedBusinessWrite(
  req: Request,
  res: express.Response,
  tableName: string
): Promise<boolean> {
  const allowed = await enforceCompanyScope(pool, req, res, tableName);

  if (!allowed && res.statusCode === 403) {
    await audit(req, 'permission_denied', 'denied', {
      path: req.path,
      method: req.method,
    });
  }

  return allowed;
}

// Auth routes
app.post('/api/auth/login', async (req, res) => {
  try {
    const username =
      typeof req.body.username === 'string' ? req.body.username.trim() : '';

    const password =
      typeof req.body.password === 'string' ? req.body.password : '';

    const result = await pool.query(
      `SELECT
         id,
         username,
         email,
         password_hash,
         password_salt,
         role,
         is_active,
         must_change_password
       FROM auth.users
       WHERE username = $1`,
      [username]
    );

    const row = result.rows[0];

    const ok =
      row &&
      row.is_active === true &&
      (await auth.verifyPassword(password, row.password_salt, row.password_hash));

    if (!ok) {
      await audit(req, 'login_failed', 'failure', { username });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = auth.publicUser(row);
    const token = auth.newSessionToken();

    await pool.query(
      `INSERT INTO auth.sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '7 days')`,
      [user.id, auth.hashToken(token)]
    );

    (req as AuthedRequest).user = user;

    await audit(req, 'login_success', 'success');

    res.setHeader(
      'Set-Cookie',
      auth.sessionCookie(token, process.env.NODE_ENV === 'production')
    );

    const companyLinks = await fetchUserCompanyLinks(pool, user.id);
    return res.json({ user, company_links: companyLinks });
  } catch (error) {
    console.error('Error logging in:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = getSessionToken(req);

    if (token) {
      const user = await loadSession(req);

      if (user) {
        (req as AuthedRequest).user = user;
      }

      await pool.query('DELETE FROM auth.sessions WHERE token_hash = $1', [
        auth.hashToken(token),
      ]);

      await audit(req, 'logout', 'success');
    }

    res.setHeader(
      'Set-Cookie',
      auth.clearSessionCookie(process.env.NODE_ENV === 'production')
    );

    return res.status(204).send();
  } catch (error) {
    console.error('Error logging out:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = (req as AuthedRequest).user!;
    const companyLinks = await fetchUserCompanyLinks(pool, user.id);
    return res.json({ user, company_links: companyLinks });
  } catch (error) {
    console.error('Error loading current user companies:', error);
    return res.status(500).json({ error: 'No se pudieron cargar los permisos de empresa.' });
  }
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const currentPassword =
      typeof req.body.current_password === 'string'
        ? req.body.current_password
        : '';

    const newPassword = readPassword(req.body.new_password);
    const user = (req as AuthedRequest).user!;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Current password and a valid new password are required',
      });
    }

    const current = await pool.query(
      'SELECT password_hash, password_salt FROM auth.users WHERE id = $1',
      [user.id]
    );

    const row = current.rows[0];

    const ok =
      row &&
      (await auth.verifyPassword(
        currentPassword,
        row.password_salt,
        row.password_hash
      ));

    if (!ok) {
      await audit(req, 'password_change_failed', 'failure');
      return res.status(401).json({ error: 'Invalid current password' });
    }

    const { passwordHash, passwordSalt } = await auth.hashPassword(newPassword);

    const result = await pool.query(
      `UPDATE auth.users
       SET
         password_hash = $1,
         password_salt = $2,
         must_change_password = false,
         updated_at = now()
       WHERE id = $3
       RETURNING id, username, email, role, is_active, must_change_password`,
      [passwordHash, passwordSalt, user.id]
    );

    (req as AuthedRequest).user = auth.publicUser(result.rows[0]);

    await audit(req, 'password_changed', 'success');

    const updatedUser = (req as AuthedRequest).user!;
    const companyLinks = await fetchUserCompanyLinks(pool, updatedUser.id);
    return res.json({ user: updatedUser, company_links: companyLinks });
  } catch (error) {
    console.error('Error changing password:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin routes
app.post(
  '/api/admin/users',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const username = readUsername(req.body.username);
      const email = readEmail(req.body.email);

      const password = readPassword(req.body.password);
      const role = req.body.role;

      if (!username) {
        return res.status(400).json({
          error: 'El nombre de usuario debe tener entre 3 y 80 caracteres y usar solo letras, números, puntos, guiones o guiones bajos.',
        });
      }

      if (!email) {
        return res.status(400).json({ error: 'Ingresá un email válido.' });
      }

      if (!password) {
        return res.status(400).json({
          error: 'La contraseña debe tener al menos 12 caracteres e incluir mayúscula, minúscula y número.',
        });
      }

      if (!isCreatableUserRole(role)) {
        return res.status(400).json({ error: 'Seleccioná Usuario o Empresa como rol.' });
      }

      const { passwordHash, passwordSalt } = await auth.hashPassword(password);

      const result = await pool.query(
        `INSERT INTO auth.users
         (username, email, password_hash, password_salt, role, must_change_password)
         VALUES ($1, $2, $3, $4, $5, false)
         RETURNING id, username, email, role, is_active, must_change_password`,
        [username, email, passwordHash, passwordSalt, role]
      );

      await audit(req, 'user_created', 'success', {
        user_id: result.rows[0].id,
        role,
      });

      return res.status(201).json(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const constraint = (error as { constraint?: string }).constraint;
        return res.status(409).json({
          error: constraint === 'users_email_unique'
            ? 'El email ya está registrado.'
            : 'El nombre de usuario ya está registrado.',
        });
      }

      console.error('Error creating user:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

app.post(
  '/api/admin/users/:id/reset-password',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const userId = Number(req.params.id);
      const password = readPassword(req.body.password);

      if (!Number.isInteger(userId) || !password) {
        return res.status(400).json({
          error: 'Valid user id and password are required',
        });
      }

      const { passwordHash, passwordSalt } = await auth.hashPassword(password);

      const result = await pool.query(
        `UPDATE auth.users
         SET
           password_hash = $1,
           password_salt = $2,
           must_change_password = false,
           updated_at = now()
         WHERE id = $3
         RETURNING id, username, email, role, is_active, must_change_password`,
        [passwordHash, passwordSalt, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      await pool.query('DELETE FROM auth.sessions WHERE user_id = $1', [userId]);

      await audit(req, 'password_reset', 'success', { user_id: userId });

      return res.json({ user: result.rows[0] });
    } catch (error) {
      console.error('Error resetting password:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

app.get(
  '/api/admin/users',
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, username, email, role, is_active, must_change_password
         FROM auth.users
         ORDER BY username`
      );
      return res.json({ data: result.rows });
    } catch (error) {
      console.error('Error loading users:', error);
      return res.status(500).json({ error: 'No se pudieron cargar los usuarios.' });
    }
  }
);

app.get(
  '/api/admin/users/:id/companies',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const userId = readPublicId(req.params.id);

    if (!userId) {
      return res.status(400).json({ error: 'El usuario seleccionado no es válido.' });
    }

    try {
      const result = await pool.query(
        `SELECT uc.user_id, uc.company_id, uc.role, c.name AS company_name
         FROM auth.user_companies uc
         JOIN companies c ON c.id = uc.company_id
         WHERE uc.user_id = $1
         ORDER BY c.name`,
        [userId]
      );
      return res.json({ data: result.rows });
    } catch (error) {
      console.error('Error loading user companies:', error);
      return res.status(500).json({ error: 'No se pudieron cargar las empresas del usuario.' });
    }
  }
);

app.post(
  '/api/admin/users/:id/companies',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const userId = readPublicId(req.params.id);
    const companyId = readPublicId(req.body.company_id);
    const role = req.body.role;

    if (!userId || !companyId || !isCompanyRole(role)) {
      return res.status(400).json({
        error: 'Seleccioná un usuario, una empresa y un rol válidos.',
      });
    }

    try {
      const result = await pool.query(
        `INSERT INTO auth.user_companies (user_id, company_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, company_id)
         DO UPDATE SET role = EXCLUDED.role
         RETURNING user_id, company_id, role`,
        [userId, companyId, role]
      );

      await audit(req, 'user_company_saved', 'success', {
        user_id: userId,
        company_id: companyId,
        role,
      });

      return res.status(201).json({ data: result.rows[0] });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error &&
        (error as { code?: string }).code === '23503') {
        return res.status(404).json({ error: 'El usuario o la empresa seleccionada no existe.' });
      }

      console.error('Error saving user company:', error);
      return res.status(500).json({ error: 'No se pudo guardar el permiso de empresa.' });
    }
  }
);

app.delete(
  '/api/admin/users/:id/companies/:companyId',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const userId = readPublicId(req.params.id);
    const companyId = readPublicId(req.params.companyId);

    if (!userId || !companyId) {
      return res.status(400).json({ error: 'El usuario o la empresa seleccionada no es válido.' });
    }

    try {
      const result = await pool.query(
        `DELETE FROM auth.user_companies
         WHERE user_id = $1 AND company_id = $2
         RETURNING user_id, company_id`,
        [userId, companyId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Ese permiso de empresa no existe.' });
      }

      await audit(req, 'user_company_removed', 'success', {
        user_id: userId,
        company_id: companyId,
      });

      return res.status(200).json({ data: result.rows[0] });
    } catch (error) {
      console.error('Error removing user company:', error);
      return res.status(500).json({ error: 'No se pudo quitar el permiso de empresa.' });
    }
  }
);

// Reservation-specific API routes
app.get('/api/public/companies', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, city
       FROM companies
       WHERE is_active = true
       ORDER BY name`
    );
    return res.json({ data: result.rows });
  } catch (error) {
    console.error('Error loading public companies:', error);
    return res.status(500).json({ error: 'No se pudieron cargar las empresas disponibles.' });
  }
});

app.get('/api/public/companies/:companyId/sports', async (req, res) => {
  const companyId = readPublicId(req.params.companyId);

  if (!companyId) {
    return res.status(400).json({ error: 'La empresa seleccionada no es válida.' });
  }

  try {
    const result = await pool.query(
      `SELECT s.id, s.name, s.slug
       FROM company_sports cs
       JOIN sports s ON s.id = cs.sport_id
       JOIN companies c ON c.id = cs.company_id
       WHERE cs.company_id = $1
         AND s.is_active = true
         AND c.is_active = true
       ORDER BY s.name`,
      [companyId]
    );
    return res.json({ data: result.rows });
  } catch (error) {
    console.error('Error loading public company sports:', error);
    return res.status(500).json({ error: 'No se pudieron cargar los deportes disponibles.' });
  }
});

app.get('/api/public/companies/:companyId/time-blocks', async (req, res) => {
  const companyId = readPublicId(req.params.companyId);

  if (!companyId) {
    return res.status(400).json({ error: 'La empresa seleccionada no es válida.' });
  }

  try {
    const result = await pool.query(
      `SELECT duration_minutes
       FROM company_time_blocks
       WHERE company_id = $1
         AND is_active = true
       ORDER BY duration_minutes`,
      [companyId]
    );
    return res.json({ data: result.rows });
  } catch (error) {
    console.error('Error loading public time blocks:', error);
    return res.status(500).json({ error: 'No se pudieron cargar los bloques horarios.' });
  }
});

app.post(
  '/api/companies/:companyId/courts',
  requireAuth,
  createCourtWithPartitions(pool)
);

app.post(
  '/api/companies/:companyId/courts/:courtId/partition',
  requireAuth,
  applyCourtPartitionRule(pool)
);

app.get(
  '/api/companies/:companyId/availability',
  getCompanyAvailability(pool)
);

app.post(
  '/api/bookings/hold',
  limitPublicHolds,
  holdBooking(pool)
);

app.post(
  '/api/bookings/:id/confirm',
  requireAuth,
  confirmBooking(pool)
);

app.post(
  '/api/bookings/:id/cancel',
  requireAuth,
  cancelBooking(pool)
);

// Generic business API routes
app.get('/api/:tableName', requireAuth, async (req, res) => {
  try {
    const readableCompanyIds = await fetchReadableCompanyIds(
      pool,
      (req as AuthedRequest).user!
    );
    return getHandler(req, res, pool, readableCompanyIds);
  } catch (error) {
    console.error('Error resolving company read scope:', error);
    return res.status(500).json({ error: 'No se pudo verificar los permisos de empresa.' });
  }
});

app.post(
  '/api/:tableName',
  requireAuth,
  async (req, res) => {
    if (req.params.tableName === 'courts') {
      return res.status(405).json({
        error: 'Creá las canchas desde el flujo de empresa para aplicar sus reglas de partición.',
      });
    }

    if (!(await enforceScopedBusinessWrite(req, res, req.params.tableName))) {
      return;
    }

    return postHandler(req, res, pool);
  }
);

app.put(
  '/api/:tableName',
  requireAuth,
  async (req, res) => {
    if (!(await enforceScopedBusinessWrite(req, res, req.params.tableName))) {
      return;
    }

    return putHandler(req, res, pool);
  }
);

app.delete(
  '/api/:tableName',
  requireAuth,
  async (req, res) => {
    if (!(await enforceScopedBusinessWrite(req, res, req.params.tableName))) {
      return;
    }

    return deleteHandler(req, res, pool);
  }
);

// Resolve frontend static files directory
let frontendDistPath = path.join(__dirname, '../../frontend/dist');

if (!fs.existsSync(path.join(frontendDistPath, 'index.html'))) {
  const fallbackPath = path.join(__dirname, '../../../../frontend/dist');

  if (fs.existsSync(path.join(fallbackPath, 'index.html'))) {
    frontendDistPath = fallbackPath;
  }
}

// Serve static files from frontend dist
app.use(express.static(frontendDistPath));

// Catch-all handler for frontend routes
app.get('*', (_req, res) => {
  return res.sendFile(path.join(frontendDistPath, 'index.html'));
});

export { app, pool };

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

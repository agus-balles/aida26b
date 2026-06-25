import type { Pool, PoolClient } from 'pg';
import type { Request, Response } from 'express';
import type { AuthUser } from './auth';

type Queryable = Pool | PoolClient;
type AuthedRequest = Request & { user?: AuthUser };

/**
 * Per-company authorization for the generic CRUD routes.
 *
 * The reservation endpoints already scope writes to a company through
 * `auth.user_companies` (see reservations.ts). The generic `/api/:tableName`
 * routes historically only checked the global role (admin/editor), so a user
 * explicitly tied to one company could still mutate another company's data.
 *
 * Strict model:
 *  - Global admin manages every company and global catalog.
 *  - Every non-admin needs an explicit `auth.user_companies` link to read or
 *    write data belonging to a company.
 *  - `owner`, `manager`, and `staff` may write; `viewer` may only read.
 *  - Global catalogs (`sports`, `court_partition_rules`) are admin-managed.
 */

export const COMPANY_ROLES = ['owner', 'manager', 'staff', 'viewer'] as const;
export const COMPANY_WRITE_ROLES = ['owner', 'manager', 'staff'] as const;
export const COMPANY_READ_ROLES = COMPANY_ROLES;

export type CompanyLink = { company_id: number; role: string };

export function isCompanyRole(value: unknown): value is (typeof COMPANY_ROLES)[number] {
  return typeof value === 'string' && (COMPANY_ROLES as readonly string[]).includes(value);
}

export type CompanyScope =
  | { kind: 'none' } // global catalog, only a global admin may write
  | { kind: 'admin-only' } // only a global admin may write
  | { kind: 'company'; companyId: number };

export type CompanyReadConstraint = {
  condition: string;
  values: number[][];
};

/** Pure decision: does this user pass company scoping for the resolved scope? */
export function decideCompanyScopeAccess(
  user: AuthUser | undefined,
  links: CompanyLink[],
  scope: CompanyScope
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (scope.kind === 'none') return false;
  if (scope.kind === 'admin-only') return false;
  return links.some(
    (link) =>
      Number(link.company_id) === scope.companyId &&
      (COMPANY_WRITE_ROLES as readonly string[]).includes(link.role)
  );
}

function numericParam(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function companyOfRow(
  queryable: Queryable,
  sql: string,
  id: number
): Promise<CompanyScope> {
  const result = await queryable.query<{ company_id: number }>(sql, [id]);
  const companyId = result.rows[0] ? Number(result.rows[0].company_id) : null;
  return companyId ? { kind: 'company', companyId } : { kind: 'admin-only' };
}

/** Resolve which company a generic CRUD write touches. */
export async function resolveCompanyScope(
  queryable: Queryable,
  tableName: string,
  method: string,
  body: Record<string, unknown>,
  query: Record<string, unknown>
): Promise<CompanyScope> {
  switch (tableName) {
    case 'sports':
    case 'court_partition_rules':
      return { kind: 'none' };

    case 'companies': {
      // Creating a brand-new company is an admin action.
      if (method === 'POST') return { kind: 'admin-only' };
      const companyId = numericParam(query.id);
      return companyId ? { kind: 'company', companyId } : { kind: 'admin-only' };
    }

    case 'company_sports': {
      const companyId =
        method === 'POST'
          ? numericParam(body.company_id)
          : numericParam(query.company_id);
      return companyId
        ? { kind: 'company', companyId }
        : { kind: 'admin-only' };
    }

    case 'company_time_blocks': {
      if (method === 'POST') {
        const companyId = numericParam(body.company_id);
        return companyId
          ? { kind: 'company', companyId }
          : { kind: 'admin-only' };
      }
      const id = numericParam(query.id);
      if (!id) return { kind: 'admin-only' };
      return companyOfRow(
        queryable,
        'SELECT company_id FROM company_time_blocks WHERE id = $1',
        id
      );
    }

    case 'courts': {
      // POST is blocked (405) upstream; only PUT/DELETE reach here.
      const id = numericParam(query.id);
      if (!id) return { kind: 'admin-only' };
      return companyOfRow(
        queryable,
        'SELECT company_id FROM courts WHERE id = $1',
        id
      );
    }

    case 'court_prices': {
      if (method === 'POST') {
        const courtId = numericParam(body.court_id);
        if (!courtId) return { kind: 'admin-only' };
        return companyOfRow(
          queryable,
          'SELECT company_id FROM courts WHERE id = $1',
          courtId
        );
      }
      const id = numericParam(query.id);
      if (!id) return { kind: 'admin-only' };
      return companyOfRow(
        queryable,
        `SELECT c.company_id
         FROM court_prices p
         JOIN courts c ON c.id = p.court_id
         WHERE p.id = $1`,
        id
      );
    }

    default:
      return { kind: 'none' };
  }
}

export async function fetchUserCompanyLinks(
  queryable: Queryable,
  userId: number
): Promise<CompanyLink[]> {
  const result = await queryable.query<CompanyLink>(
    'SELECT company_id, role FROM auth.user_companies WHERE user_id = $1',
    [userId]
  );
  return result.rows.map((row) => ({
    company_id: Number(row.company_id),
    role: row.role,
  }));
}

export async function fetchReadableCompanyIds(
  queryable: Queryable,
  user: AuthUser
): Promise<number[] | null> {
  if (user.role === 'admin') return null;

  const links = await fetchUserCompanyLinks(queryable, user.id);
  return links
    .filter((link) => (COMPANY_READ_ROLES as readonly string[]).includes(link.role))
    .map((link) => link.company_id);
}

export function getCompanyReadConstraint(
  tableName: string,
  companyIds: number[] | null,
  parameterIndex: number
): CompanyReadConstraint | null {
  if (companyIds === null) return null;

  const parameter = `$${parameterIndex}::bigint[]`;

  switch (tableName) {
    case 'companies':
      return { condition: `"id" = ANY(${parameter})`, values: [companyIds] };

    case 'company_sports':
    case 'company_time_blocks':
    case 'courts':
      return { condition: `"company_id" = ANY(${parameter})`, values: [companyIds] };

    case 'court_prices':
      return {
        condition: `"court_id" IN (SELECT id FROM courts WHERE company_id = ANY(${parameter}))`,
        values: [companyIds],
      };

    default:
      return null;
  }
}

/**
 * Express guard for generic CRUD writes. Returns true when the write is
 * allowed; otherwise sends a 403/500 response and returns false.
 */
export async function enforceCompanyScope(
  pool: Pool,
  req: Request,
  res: Response,
  tableName: string
): Promise<boolean> {
  const user = (req as AuthedRequest).user;

  if (!user) {
    res.status(403).json({ error: 'No tenés permisos para realizar esta acción.' });
    return false;
  }

  // Global admin manages every company without an extra lookup.
  if (user.role === 'admin') return true;

  try {
    const links = await fetchUserCompanyLinks(pool, user.id);

    const scope = await resolveCompanyScope(
      pool,
      tableName,
      req.method,
      (req.body ?? {}) as Record<string, unknown>,
      (req.query ?? {}) as Record<string, unknown>
    );

    if (decideCompanyScopeAccess(user, links, scope)) return true;
  } catch (error) {
    console.error('Error verifying company scope:', error);
    res
      .status(500)
      .json({ error: 'No se pudo verificar los permisos de empresa.' });
    return false;
  }

  res
    .status(403)
    .json({ error: 'No tenés permisos sobre esta empresa.' });
  return false;
}

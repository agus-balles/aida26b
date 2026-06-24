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
 * Model implemented here (additive, non-breaking):
 *  - Global admin manages everything.
 *  - A user WITHOUT any `auth.user_companies` link is a global business user
 *    (the existing editor behaviour) and keeps writing any company's data.
 *  - A user WITH one or more company links may only write company-scoped
 *    resources of the companies they belong to (with a write role), matching
 *    the spec: "Usuarios asociados a una empresa solo pueden operar sobre su
 *    empresa".
 *
 * Global catalogs (`sports`, `court_partition_rules`) are not company-scoped
 * and remain governed by the global role gate only.
 */

export const COMPANY_WRITE_ROLES = ['owner', 'manager', 'staff'] as const;

export type CompanyLink = { company_id: number; role: string };

export type CompanyScope =
  | { kind: 'none' } // global catalog, no per-company scoping
  | { kind: 'admin-only' } // only a global admin / unlinked user may write
  | { kind: 'company'; companyId: number };

/** Pure decision: does this user pass company scoping for the resolved scope? */
export function decideCompanyScopeAccess(
  user: AuthUser | undefined,
  links: CompanyLink[],
  scope: CompanyScope
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  // Unlinked users keep the historical global-business-writer behaviour.
  if (links.length === 0) return true;
  if (scope.kind === 'none') return true;
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
      // Creating a brand-new company is a global-admin/global-editor action.
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

  // Global admin manages every company without an extra lookup.
  if (user?.role === 'admin') return true;

  try {
    const links = await fetchUserCompanyLinks(pool, user!.id);

    // Unlinked global business users keep the historical behaviour.
    if (links.length === 0) return true;

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

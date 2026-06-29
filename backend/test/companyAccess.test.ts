import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  decideCompanyScopeAccess,
  getCompanyReadConstraint,
  resolveCompanyScope,
  resolveDestinationCompanyScope,
} from '../src/companyAccess';

const admin = { id: 1, username: 'a', email: null, role: 'admin', is_active: true, must_change_password: false } as const;
const editor = { id: 2, username: 'e', email: null, role: 'editor', is_active: true, must_change_password: false } as const;

test('admin bypasses company scoping', () => {
  assert.equal(
    decideCompanyScopeAccess(admin, [{ company_id: 1, role: 'staff' }], { kind: 'company', companyId: 9 }),
    true
  );
});

test('unlinked non-admin users cannot write company data', () => {
  assert.equal(
    decideCompanyScopeAccess(editor, [], { kind: 'company', companyId: 9 }),
    false
  );
});

test('linked users can write only their own company', () => {
  const links = [{ company_id: 1, role: 'manager' }];
  assert.equal(decideCompanyScopeAccess(editor, links, { kind: 'company', companyId: 1 }), true);
  assert.equal(decideCompanyScopeAccess(editor, links, { kind: 'company', companyId: 2 }), false);
});

test('viewer link is not a write role', () => {
  const links = [{ company_id: 1, role: 'viewer' }];
  assert.equal(decideCompanyScopeAccess(editor, links, { kind: 'company', companyId: 1 }), false);
});

test('linked users cannot create new companies (admin-only scope)', () => {
  const links = [{ company_id: 1, role: 'owner' }];
  assert.equal(decideCompanyScopeAccess(editor, links, { kind: 'admin-only' }), false);
});

test('non-admin users cannot edit global catalogs', () => {
  const links = [{ company_id: 1, role: 'staff' }];
  assert.equal(decideCompanyScopeAccess(editor, links, { kind: 'none' }), false);
});

const noopDb = { query: async () => ({ rows: [] }) } as never;

test('resolveCompanyScope reads company_id from body on POST', async () => {
  const scope = await resolveCompanyScope(noopDb, 'company_sports', 'POST', { company_id: 7 }, {});
  assert.deepEqual(scope, { kind: 'company', companyId: 7 });
});

test('resolveCompanyScope treats company creation as admin-only', async () => {
  const scope = await resolveCompanyScope(noopDb, 'companies', 'POST', {}, {});
  assert.deepEqual(scope, { kind: 'admin-only' });
});

test('resolveCompanyScope leaves global catalogs unscoped', async () => {
  assert.deepEqual(await resolveCompanyScope(noopDb, 'sports', 'POST', {}, {}), { kind: 'none' });
  assert.deepEqual(
    await resolveCompanyScope(noopDb, 'court_partition_rules', 'POST', {}, {}),
    { kind: 'none' }
  );
});

test('resolveCompanyScope resolves company via court for court_prices', async () => {
  const db = {
    query: async (_sql: string, params: unknown[]) => {
      assert.deepEqual(params, [42]);
      return { rows: [{ company_id: 5 }] };
    },
  } as never;
  const scope = await resolveCompanyScope(db, 'court_prices', 'POST', { court_id: 42 }, {});
  assert.deepEqual(scope, { kind: 'company', companyId: 5 });
});

test('resolveDestinationCompanyScope reads the target company for a courts PUT', async () => {
  const scope = await resolveDestinationCompanyScope(noopDb, 'courts', { company_id: 9 });
  assert.deepEqual(scope, { kind: 'company', companyId: 9 });
});

test('resolveDestinationCompanyScope resolves the target court owner for court_prices', async () => {
  const db = {
    query: async (_sql: string, params: unknown[]) => {
      assert.deepEqual(params, [42]);
      return { rows: [{ company_id: 8 }] };
    },
  } as never;
  const scope = await resolveDestinationCompanyScope(db, 'court_prices', { court_id: 42 });
  assert.deepEqual(scope, { kind: 'company', companyId: 8 });
});

test('resolveDestinationCompanyScope ignores tables without a body scoping FK', async () => {
  assert.equal(await resolveDestinationCompanyScope(noopDb, 'companies', { id: 1 }), null);
  assert.equal(await resolveDestinationCompanyScope(noopDb, 'sports', { name: 'x' }), null);
});

test('moving a row into another company is denied unless linked to the target', () => {
  // A staff user of company 1 cannot reassign a row to company 2 (the
  // destination scope must also be authorised, not only the source).
  const links = [{ company_id: 1, role: 'staff' }];
  assert.equal(
    decideCompanyScopeAccess(editor, links, { kind: 'company', companyId: 2 }),
    false
  );
});

test('company-scoped reads add an ownership condition', () => {
  assert.deepEqual(
    getCompanyReadConstraint('courts', [1, 4], 1),
    { condition: '"company_id" = ANY($1::bigint[])', values: [[1, 4]] }
  );
  assert.deepEqual(
    getCompanyReadConstraint('court_prices', [4], 2),
    {
      condition: '"court_id" IN (SELECT id FROM courts WHERE company_id = ANY($2::bigint[]))',
      values: [[4]],
    }
  );
});

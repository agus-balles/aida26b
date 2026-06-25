// @ts-nocheck
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'vitest';
import { app, pool } from '../src/server';
import { hashPassword } from '../src/auth';

class FakeDb {
  constructor(users, userCompanies = []) {
    this.users = users;
    this.sessions = [];
    this.audit = [];
    this.companies = [];
    this.userCompanies = userCompanies;
    this.companySports = [];
    this.nextUserId = Math.max(...users.map((user) => user.id)) + 1;
    this.nextCompanyId = 1;
  }

  async query(text, params = []) {
    const sql = text.replace(/\s+/g, ' ').trim();

    // Transaction control statements - just acknowledge (handle variants)
    if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(sql)) {
      return { rows: [] };
    }

    if (sql.startsWith('INSERT INTO auth.audit_log')) {
      this.audit.push({ actor_user_id: params[0], event_type: params[1], outcome: params[2] });
      return { rows: [] };
    }
    if (sql.includes('FROM auth.users WHERE username = $1')) {
      return { rows: this.users.filter((user) => user.username === params[0]) };
    }
    if (sql.startsWith('SELECT password_hash, password_salt FROM auth.users WHERE id')) {
      const user = this.users.find((item) => item.id === params[0]);
      return { rows: user ? [{ password_hash: user.password_hash, password_salt: user.password_salt }] : [] };
    }
    if (sql.startsWith('INSERT INTO auth.sessions')) {
      this.sessions.push({ user_id: params[0], token_hash: params[1], expires_at: Date.now() + 604800000 });
      return { rows: [] };
    }
    if (sql.startsWith('SELECT s.id AS session_id')) {
      const session = this.sessions.find((item) => item.token_hash === params[0] && item.expires_at > Date.now());
      const user = session && this.users.find((item) => item.id === session.user_id && item.is_active);
      return { rows: user ? [{ session_id: 1, ...user }] : [] };
    }
    if (sql.startsWith('DELETE FROM auth.sessions WHERE token_hash')) {
      this.sessions = this.sessions.filter((item) => item.token_hash !== params[0]);
      return { rows: [] };
    }
    if (sql.startsWith('DELETE FROM auth.sessions WHERE user_id')) {
      this.sessions = this.sessions.filter((item) => item.user_id !== params[0]);
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO auth.users')) {
      if (this.users.some((user) => user.username === params[0])) {
        throw Object.assign(new Error('duplicate username'), { code: '23505', constraint: 'users_username_key' });
      }
      if (params[1] && this.users.some((user) => user.email === params[1])) {
        throw Object.assign(new Error('duplicate email'), { code: '23505', constraint: 'users_email_unique' });
      }
      const user = {
        id: this.nextUserId++,
        username: params[0],
        email: params[1],
        password_hash: params[2],
        password_salt: params[3],
        role: sql.includes("'reader'") ? 'reader' : params[4],
        is_active: true,
        must_change_password: false,
      };
      this.users.push(user);
      return { rows: [publicRow(user)] };
    }
    if (sql.startsWith('UPDATE auth.users SET password_hash')) {
      const user = this.users.find((item) => item.id === params[2]);
      if (!user) return { rows: [] };
      user.password_hash = params[0];
      user.password_salt = params[1];
      user.must_change_password = sql.includes('must_change_password = true');
      return { rows: [publicRow(user)] };
    }
    if (sql.startsWith('SELECT id, username, email, role, is_active, must_change_password FROM auth.users')) {
      return { rows: this.users.map(publicRow) };
    }
    if (sql.includes('FROM auth.user_companies uc JOIN companies c')) {
      return {
        rows: this.userCompanies
          .filter((link) => link.user_id === params[0])
          .map((link) => ({
            ...link,
            company_name: this.companies.find((company) => company.id === link.company_id)?.name,
          })),
      };
    }
    if (sql.startsWith('INSERT INTO auth.user_companies')) {
      const existing = this.userCompanies.find(
        (link) => link.user_id === params[0] && link.company_id === params[1]
      );
      if (existing) {
        existing.role = params[2];
      } else {
        this.userCompanies.push({ user_id: params[0], company_id: params[1], role: params[2] });
      }
      return { rows: [{ user_id: params[0], company_id: params[1], role: params[2] }] };
    }
    if (sql.startsWith('DELETE FROM auth.user_companies')) {
      const index = this.userCompanies.findIndex(
        (link) => link.user_id === params[0] && link.company_id === params[1]
      );
      if (index === -1) return { rows: [], rowCount: 0 };
      const [removed] = this.userCompanies.splice(index, 1);
      return { rows: [removed], rowCount: 1 };
    }
    if (sql.startsWith('SELECT * FROM companies ORDER BY')) {
      return { rows: this.companies };
    }

    if (/FROM\s*\(\s*SELECT\s+\*\s+FROM\s+companies/i.test(sql) || /FROM\s+companies/i.test(sql)) {
      if (/SELECT\s+COUNT\(/i.test(sql)) {
        return { rows: [{ count: this.companies.length }] };
      }
      return { rows: this.companies };
    }
    if (sql.includes('FROM auth.user_companies WHERE user_id')) {
      return {
        rows: this.userCompanies
          .filter((link) => link.user_id === params[0])
          .map((link) => ({ company_id: link.company_id, role: link.role })),
      };
    }
    if (sql.startsWith('INSERT INTO company_sports')) {
      this.companySports.push({ company_id: params[0], sport_id: params[1] });
      return { rows: [{ company_id: params[0], sport_id: params[1] }] };
    }
    if (sql.startsWith('INSERT INTO companies')) {
      if (this.companies.some((company) => company.name === params[0] && company.city === params[4])) {
        throw Object.assign(new Error('duplicate company'), { code: '23505' });
      }
      const company = {
        id: this.nextCompanyId++,
        name: params[0],
        email: params[1],
        phone: params[2],
        address: params[3],
        city: params[4],
        timezone: params[5],
        is_active: true,
      };
      this.companies.push(company);
      return { rows: [company] };
    }

    throw new Error(`Unhandled query: ${sql}`);
  }
}

function publicRow(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    is_active: user.is_active,
    must_change_password: user.must_change_password,
  };
}

async function makeDb() {
  const admin = await hashPassword('adminpass');
  const editor = await hashPassword('editorpass');
  const reader = await hashPassword('readerpass');
  return new FakeDb([
    { id: 1, username: 'admin', email: null, role: 'admin', is_active: true, must_change_password: false, password_hash: admin.passwordHash, password_salt: admin.passwordSalt },
    { id: 2, username: 'editor', email: null, role: 'editor', is_active: true, must_change_password: false, password_hash: editor.passwordHash, password_salt: editor.passwordSalt },
    { id: 3, username: 'reader', email: null, role: 'reader', is_active: true, must_change_password: false, password_hash: reader.passwordHash, password_salt: reader.passwordSalt },
  ]);
}

async function withServer(db, run) {
  pool.query = db.query.bind(db);
  pool.connect = async () => ({
    query: db.query.bind(db),
    release: async () => {},
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function request(baseUrl, path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = response.headers.get('set-cookie');
  const text = await response.text();
  return { status: response.status, cookie: setCookie ? setCookie.split(';')[0] : null, body: text ? JSON.parse(text) : null };
}

async function login(baseUrl, username, password) {
  const response = await request(baseUrl, '/api/auth/login', { method: 'POST', body: { username, password } });
  assert.equal(response.status, 200);
  assert.ok(response.cookie.startsWith('aida_session='));
  return response.cookie;
}

test('login, me and logout manage the session cookie', async () => {
  const db = await makeDb();
  await withServer(db, async (baseUrl) => {
    const badLogin = await request(baseUrl, '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrongpass' } });
    assert.equal(badLogin.status, 401);
    assert.equal(db.audit.at(-1).event_type, 'login_failed');

    const cookie = await login(baseUrl, 'admin', 'adminpass');
    const me = await request(baseUrl, '/api/auth/me', { cookie });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.role, 'admin');

    const logout = await request(baseUrl, '/api/auth/logout', { method: 'POST', cookie });
    assert.equal(logout.status, 204);
    const afterLogout = await request(baseUrl, '/api/auth/me', { cookie });
    assert.equal(afterLogout.status, 401);
  });
});

test('reader can read but cannot mutate business data', async () => {
  const db = await makeDb();
  await withServer(db, async (baseUrl) => {
    const cookie = await login(baseUrl, 'reader', 'readerpass');
    assert.equal((await request(baseUrl, '/api/companies', { cookie })).status, 200);
    const write = await request(baseUrl, '/api/companies', {
      method: 'POST',
      cookie,
      body: { name: 'Club Norte', email: '', phone: '', address: '', city: 'Buenos Aires', timezone: 'America/Argentina/Buenos_Aires' },
    });
    assert.equal(write.status, 403);
    assert.equal(db.audit.at(-1).event_type, 'permission_denied');
  });
});

test('admin receives a conflict for duplicate company identity', async () => {
  const db = await makeDb();
  await withServer(db, async (baseUrl) => {
    const cookie = await login(baseUrl, 'admin', 'adminpass');
    const company = { name: 'Club Sur', email: '', phone: '', address: '', city: 'La Plata', timezone: 'America/Argentina/Buenos_Aires' };

    assert.equal((await request(baseUrl, '/api/companies', { method: 'POST', cookie, body: company })).status, 201);
    assert.equal((await request(baseUrl, '/api/companies', { method: 'POST', cookie, body: company })).status, 409);
  });
});

test('unlinked non-admin users cannot create companies or manage users', async () => {
  const db = await makeDb();
  await withServer(db, async (baseUrl) => {
    const cookie = await login(baseUrl, 'editor', 'editorpass');
    const createCompany = await request(baseUrl, '/api/companies', {
      method: 'POST',
      cookie,
      body: { name: 'Club Centro', email: '', phone: '', address: '', city: 'CABA', timezone: 'America/Argentina/Buenos_Aires' },
    });
    assert.equal(createCompany.status, 403);

    const createUser = await request(baseUrl, '/api/admin/users', { method: 'POST', cookie, body: { username: 'other', email: 'other@example.com', password: 'OtherPass123', role: 'reader' } });
    assert.equal(createUser.status, 403);
  });
});

test('admin can create users and reset passwords', async () => {
  const db = await makeDb();
  await withServer(db, async (baseUrl) => {
    const adminCookie = await login(baseUrl, 'admin', 'adminpass');
    const created = await request(baseUrl, '/api/admin/users', { method: 'POST', cookie: adminCookie, body: { username: 'newreader', email: 'newreader@example.com', password: 'FirstPass123', role: 'reader' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.role, 'reader');
    assert.equal(created.body.must_change_password, false);

    const reset = await request(baseUrl, `/api/admin/users/${created.body.id}/reset-password`, { method: 'POST', cookie: adminCookie, body: { password: 'SecondPass123' } });
    assert.equal(reset.status, 200);

    const newCookie = await login(baseUrl, 'newreader', 'SecondPass123');
    const me = await request(baseUrl, '/api/auth/me', { cookie: newCookie });
    assert.equal(me.body.user.must_change_password, false);
  });
});

test('admin validates mandatory user credentials and supports the company role', async () => {
  const db = await makeDb();
  await withServer(db, async (baseUrl) => {
    const adminCookie = await login(baseUrl, 'admin', 'adminpass');

    const missingEmail = await request(baseUrl, '/api/admin/users', {
      method: 'POST',
      cookie: adminCookie,
      body: { username: 'companyuser', password: 'CompanyPass123', role: 'editor' },
    });
    assert.equal(missingEmail.status, 400);
    assert.match(missingEmail.body.error, /email válido/);

    const weakPassword = await request(baseUrl, '/api/admin/users', {
      method: 'POST',
      cookie: adminCookie,
      body: { username: 'companyuser', email: 'company@example.com', password: 'shortpass', role: 'editor' },
    });
    assert.equal(weakPassword.status, 400);
    assert.match(weakPassword.body.error, /12 caracteres/);

    const created = await request(baseUrl, '/api/admin/users', {
      method: 'POST',
      cookie: adminCookie,
      body: { username: 'companyuser', email: 'company@example.com', password: 'CompanyPass123', role: 'editor' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.role, 'editor');

    assert.ok(await login(baseUrl, 'companyuser', 'CompanyPass123'));

    const duplicateEmail = await request(baseUrl, '/api/admin/users', {
      method: 'POST',
      cookie: adminCookie,
      body: { username: 'othercompany', email: 'company@example.com', password: 'OtherCompany123', role: 'editor' },
    });
    assert.equal(duplicateEmail.status, 409);
    assert.equal(duplicateEmail.body.error, 'El email ya está registrado.');
  });
});

test('admin can assign and remove company roles', async () => {
  const db = await makeDb();
  db.companies.push({ id: 1, name: 'Club Norte', city: 'CABA', is_active: true });

  await withServer(db, async (baseUrl) => {
    const adminCookie = await login(baseUrl, 'admin', 'adminpass');
    const saved = await request(baseUrl, '/api/admin/users/2/companies', {
      method: 'POST',
      cookie: adminCookie,
      body: { company_id: 1, role: 'manager' },
    });
    assert.equal(saved.status, 201);

    const links = await request(baseUrl, '/api/admin/users/2/companies', {
      cookie: adminCookie,
    });
    assert.equal(links.status, 200);
    assert.equal(links.body.data[0].role, 'manager');

    const removed = await request(baseUrl, '/api/admin/users/2/companies/1', {
      method: 'DELETE',
      cookie: adminCookie,
    });
    assert.equal(removed.status, 200);
  });
});

test('new users can use the app and change their password voluntarily', async () => {
  const db = await makeDb();
  await withServer(db, async (baseUrl) => {
    const adminCookie = await login(baseUrl, 'admin', 'adminpass');
    await request(baseUrl, '/api/admin/users', { method: 'POST', cookie: adminCookie, body: { username: 'tempuser', email: 'tempuser@example.com', password: 'TempPass1234', role: 'reader' } });

    const tempCookie = await login(baseUrl, 'tempuser', 'TempPass1234');
    assert.equal((await request(baseUrl, '/api/companies', { cookie: tempCookie })).status, 200);

    const changed = await request(baseUrl, '/api/auth/change-password', {
      method: 'POST',
      cookie: tempCookie,
      body: { current_password: 'TempPass1234', new_password: 'NewPass12345' },
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.user.must_change_password, false);
    assert.equal((await request(baseUrl, '/api/companies', { cookie: tempCookie })).status, 200);
  });
});

test('company-scoped users may only write their own company', async () => {
  const staff = await hashPassword('staffpass1');
  const db = new FakeDb(
    [
      { id: 1, username: 'admin', email: null, role: 'admin', is_active: true, must_change_password: false, password_hash: staff.passwordHash, password_salt: staff.passwordSalt },
      { id: 4, username: 'staff1', email: null, role: 'editor', is_active: true, must_change_password: false, password_hash: staff.passwordHash, password_salt: staff.passwordSalt },
    ],
    [{ user_id: 4, company_id: 1, role: 'staff' }]
  );

  await withServer(db, async (baseUrl) => {
    const cookie = await login(baseUrl, 'staff1', 'staffpass1');

    const ownCompany = await request(baseUrl, '/api/company_sports', {
      method: 'POST',
      cookie,
      body: { company_id: 1, sport_id: 1 },
    });
    assert.equal(ownCompany.status, 201);

    const otherCompany = await request(baseUrl, '/api/company_sports', {
      method: 'POST',
      cookie,
      body: { company_id: 2, sport_id: 1 },
    });
    assert.equal(otherCompany.status, 403);
  });
});

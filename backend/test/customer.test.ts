// @ts-nocheck
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'vitest';
import { app, pool } from '../src/server';

// In-memory fake matching the customer-facing SQL emitted by server.ts /
// reservations.ts. Mirrors the FakeDb approach used by auth.test.ts.
class CustomerFakeDb {
  constructor(bookings = []) {
    this.customers = [];
    this.sessions = [];
    this.bookings = bookings;
    this.nextCustomerId = 1;
  }

  async query(text, params = []) {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }

    // --- customers ---
    if (sql.startsWith('SELECT 1 FROM customers WHERE email = $1')) {
      const found = this.customers.filter((c) => c.email === params[0]);
      return { rows: found.map(() => ({ '?column?': 1 })), rowCount: found.length };
    }

    if (sql.startsWith('INSERT INTO customers')) {
      const [email, passwordHash, passwordSalt, name, phone] = params;
      if (this.customers.some((c) => c.email === email)) {
        throw Object.assign(new Error('dup'), { code: '23505', constraint: 'customers_email_key' });
      }
      const customer = {
        id: this.nextCustomerId++,
        email,
        password_hash: passwordHash,
        password_salt: passwordSalt,
        name,
        phone: phone ?? null,
        is_active: true,
      };
      this.customers.push(customer);
      return { rows: [{ id: customer.id, email, name, phone: customer.phone }], rowCount: 1 };
    }

    if (sql.startsWith('SELECT id, email, name, phone, password_hash, password_salt, is_active FROM customers WHERE email = $1')) {
      const found = this.customers.filter((c) => c.email === params[0]);
      return { rows: found, rowCount: found.length };
    }

    // --- customer sessions ---
    if (sql.startsWith('INSERT INTO customer_sessions')) {
      this.sessions.push({ customer_id: params[0], token_hash: params[1], expires_at: Date.now() + 30 * 864e5 });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT c.id, c.email, c.name, c.phone FROM customer_sessions')) {
      const session = this.sessions.find((s) => s.token_hash === params[0] && s.expires_at > Date.now());
      const customer = session && this.customers.find((c) => c.id === session.customer_id && c.is_active);
      return customer
        ? { rows: [{ id: customer.id, email: customer.email, name: customer.name, phone: customer.phone }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('DELETE FROM customer_sessions WHERE token_hash = $1')) {
      this.sessions = this.sessions.filter((s) => s.token_hash !== params[0]);
      return { rows: [], rowCount: 0 };
    }

    // --- bookings: claim, expire, list, cancel ---
    if (sql.includes('SET customer_id = $1') && sql.includes('lower(customer_email) = lower($2)')) {
      let count = 0;
      for (const b of this.bookings) {
        if (b.customer_id == null && String(b.customer_email).toLowerCase() === String(params[1]).toLowerCase()) {
          b.customer_id = params[0];
          count++;
        }
      }
      return { rows: [], rowCount: count };
    }

    if (sql.startsWith('DELETE FROM booking_locks l USING bookings')) {
      return { rows: [], rowCount: 0 }; // expire held: no-op
    }

    if (sql.includes("SET status = 'expired'")) {
      return { rows: [], rowCount: 0 }; // expire held: no-op
    }

    if (sql.startsWith('SELECT b.id, b.company_id, co.name AS company_name')) {
      const rows = this.bookings
        .filter((b) => b.customer_id === params[0] && ['held', 'confirmed', 'cancelled'].includes(b.status))
        .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('SELECT * FROM bookings WHERE id = $1 FOR UPDATE')) {
      const found = this.bookings.filter((b) => b.id === params[0]);
      return { rows: found, rowCount: found.length };
    }

    if (sql.startsWith('DELETE FROM booking_locks WHERE booking_id = $1')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("SET status = 'cancelled'")) {
      const booking = this.bookings.find((b) => b.id === params[0]);
      if (booking) booking.status = 'cancelled';
      return { rows: booking ? [booking] : [], rowCount: booking ? 1 : 0 };
    }

    throw new Error(`Unhandled query: ${sql}`);
  }
}

async function withServer(db, run) {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  pool.query = db.query.bind(db);
  pool.connect = async () => ({ query: db.query.bind(db), release: async () => {} });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    pool.query = originalQuery;
    pool.connect = originalConnect;
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
  return {
    status: response.status,
    cookie: setCookie ? setCookie.split(';')[0] : null,
    body: text ? JSON.parse(text) : null,
  };
}

const validRegister = { email: 'player@example.com', name: 'Jugador Uno', password: 'clave-larga-1', password_confirm: 'clave-larga-1' };

test('email-first flow: check-email reflects registration', async () => {
  await withServer(new CustomerFakeDb(), async (baseUrl) => {
    const before = await request(baseUrl, '/api/customer/auth/check-email', { method: 'POST', body: { email: validRegister.email } });
    assert.equal(before.status, 200);
    assert.equal(before.body.exists, false);

    const reg = await request(baseUrl, '/api/customer/auth/register', { method: 'POST', body: validRegister });
    assert.equal(reg.status, 201);

    const after = await request(baseUrl, '/api/customer/auth/check-email', { method: 'POST', body: { email: validRegister.email } });
    assert.equal(after.body.exists, true);

    const badEmail = await request(baseUrl, '/api/customer/auth/check-email', { method: 'POST', body: { email: 'nope' } });
    assert.equal(badEmail.status, 400);
  });
});

test('register enforces password confirmation, length and unique email', async () => {
  await withServer(new CustomerFakeDb(), async (baseUrl) => {
    const mismatch = await request(baseUrl, '/api/customer/auth/register', {
      method: 'POST',
      body: { ...validRegister, password_confirm: 'otra-cosa-9' },
    });
    assert.equal(mismatch.status, 400);

    const short = await request(baseUrl, '/api/customer/auth/register', {
      method: 'POST',
      body: { ...validRegister, password: 'abc', password_confirm: 'abc' },
    });
    assert.equal(short.status, 400);

    const ok = await request(baseUrl, '/api/customer/auth/register', { method: 'POST', body: validRegister });
    assert.equal(ok.status, 201);
    assert.ok(ok.cookie.startsWith('aida_customer='));
    assert.equal(ok.body.customer.email, validRegister.email);
    assert.equal(ok.body.customer.name, validRegister.name);

    const dup = await request(baseUrl, '/api/customer/auth/register', { method: 'POST', body: validRegister });
    assert.equal(dup.status, 409);
  });
});

test('login, me and logout manage the customer session', async () => {
  await withServer(new CustomerFakeDb(), async (baseUrl) => {
    await request(baseUrl, '/api/customer/auth/register', { method: 'POST', body: validRegister });

    const wrong = await request(baseUrl, '/api/customer/auth/login', {
      method: 'POST',
      body: { email: validRegister.email, password: 'incorrecta-9' },
    });
    assert.equal(wrong.status, 401);

    const login = await request(baseUrl, '/api/customer/auth/login', {
      method: 'POST',
      body: { email: validRegister.email, password: validRegister.password },
    });
    assert.equal(login.status, 200);
    assert.ok(login.cookie.startsWith('aida_customer='));

    const noAuth = await request(baseUrl, '/api/customer/auth/me');
    assert.equal(noAuth.status, 401);

    const me = await request(baseUrl, '/api/customer/auth/me', { cookie: login.cookie });
    assert.equal(me.status, 200);
    assert.equal(me.body.customer.email, validRegister.email);

    const logout = await request(baseUrl, '/api/customer/auth/logout', { method: 'POST', cookie: login.cookie });
    assert.equal(logout.status, 204);

    const afterLogout = await request(baseUrl, '/api/customer/auth/me', { cookie: login.cookie });
    assert.equal(afterLogout.status, 401);
  });
});

test('logging in claims past anonymous bookings made with the same email', async () => {
  const future = new Date(Date.now() + 864e5).toISOString();
  const db = new CustomerFakeDb([
    { id: 10, customer_id: null, customer_email: 'player@example.com', company_id: 1, company_name: 'Club', court_id: 1, court_name: 'Cancha 1', sport_id: 1, starts_at: future, ends_at: future, status: 'confirmed', price_total: 1000, currency: 'ARS', created_at: future },
    { id: 11, customer_id: null, customer_email: 'someone-else@example.com', company_id: 1, company_name: 'Club', court_id: 1, court_name: 'Cancha 1', sport_id: 1, starts_at: future, ends_at: future, status: 'confirmed', price_total: 1000, currency: 'ARS', created_at: future },
  ]);

  await withServer(db, async (baseUrl) => {
    const reg = await request(baseUrl, '/api/customer/auth/register', { method: 'POST', body: validRegister });
    const list = await request(baseUrl, '/api/customer/bookings', { cookie: reg.cookie });
    assert.equal(list.status, 200);
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].id, 10);
  });
});

test('customers cancel only their own future bookings', async () => {
  const future = new Date(Date.now() + 864e5).toISOString();
  const past = new Date(Date.now() - 864e5).toISOString();
  const db = new CustomerFakeDb([
    { id: 20, customer_id: 1, customer_email: 'player@example.com', company_id: 1, company_name: 'Club', court_id: 1, court_name: 'C1', sport_id: 1, starts_at: future, ends_at: future, status: 'confirmed', price_total: 1000, currency: 'ARS', created_at: future },
    { id: 21, customer_id: 1, customer_email: 'player@example.com', company_id: 1, company_name: 'Club', court_id: 1, court_name: 'C1', sport_id: 1, starts_at: past, ends_at: past, status: 'confirmed', price_total: 1000, currency: 'ARS', created_at: past },
    { id: 22, customer_id: 999, customer_email: 'other@example.com', company_id: 1, company_name: 'Club', court_id: 1, court_name: 'C1', sport_id: 1, starts_at: future, ends_at: future, status: 'confirmed', price_total: 1000, currency: 'ARS', created_at: future },
  ]);

  await withServer(db, async (baseUrl) => {
    const reg = await request(baseUrl, '/api/customer/auth/register', { method: 'POST', body: validRegister });
    const cookie = reg.cookie; // registered customer gets id 1

    const noAuth = await request(baseUrl, '/api/customer/bookings/20/cancel', { method: 'POST' });
    assert.equal(noAuth.status, 401);

    const other = await request(baseUrl, '/api/customer/bookings/22/cancel', { method: 'POST', cookie });
    assert.equal(other.status, 404);

    const pastCancel = await request(baseUrl, '/api/customer/bookings/21/cancel', { method: 'POST', cookie });
    assert.equal(pastCancel.status, 409);

    const ok = await request(baseUrl, '/api/customer/bookings/20/cancel', { method: 'POST', cookie });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.booking.status, 'cancelled');
  });
});

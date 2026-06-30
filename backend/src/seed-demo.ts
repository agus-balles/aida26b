/**
 * Demo seed: poblamiento de datos para mostrar TODOS los features del sistema.
 *
 * Reutiliza la lógica real del backend (createChildCourts, getAtomicCourtIds)
 * para que las particiones y los bloqueos de reserva queden idénticos a lo que
 * produce la app en producción.
 *
 * Idempotente: borra y recrea las empresas/usuarios de demo en cada corrida.
 * No toca el catálogo de deportes ni las reglas de partición (vienen de las
 * migraciones) ni al usuario admin.
 *
 *   docker compose exec backend npx tsx src/seed-demo.ts
 */
import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';
import { hashPassword } from './auth';
import { createChildCourts, getAtomicCourtIds } from './reservations';

dotenv.config();

// --- nombres de demo (se usan para limpiar antes de re-seedear) ---
const DEMO_COMPANY_NAMES = [
  'River Park Fútbol & Más',
  'Pádel House Palermo',
  'Madrid Indoor Center',
];
const DEMO_USERNAMES = ['river.owner', 'river.manager', 'padel.staff', 'demo.viewer'];
const DEMO_PASSWORD = 'DemoPass1234'; // fuerte: mayúscula + minúscula + dígito + 12 chars

type AnyRow = Record<string, any>;

function norm(row: AnyRow): AnyRow {
  return {
    ...row,
    id: Number(row.id),
    company_id: Number(row.company_id),
    parent_court_id: row.parent_court_id == null ? null : Number(row.parent_court_id),
    root_court_id: row.root_court_id == null ? null : Number(row.root_court_id),
    sport_id: Number(row.sport_id),
    layout_x: Number(row.layout_x),
    layout_y: Number(row.layout_y),
    layout_width: Number(row.layout_width),
    layout_height: Number(row.layout_height),
  };
}

async function cleanup(client: PoolClient) {
  const companies = await client.query(
    'SELECT id FROM companies WHERE name = ANY($1::text[])',
    [DEMO_COMPANY_NAMES],
  );
  const ids = companies.rows.map((r) => Number(r.id));

  if (ids.length > 0) {
    await client.query(
      'DELETE FROM booking_locks WHERE booking_id IN (SELECT id FROM bookings WHERE company_id = ANY($1::bigint[]))',
      [ids],
    );
    await client.query('DELETE FROM bookings WHERE company_id = ANY($1::bigint[])', [ids]);
    await client.query(
      'DELETE FROM court_prices WHERE court_id IN (SELECT id FROM courts WHERE company_id = ANY($1::bigint[]))',
      [ids],
    );
    await client.query('DELETE FROM courts WHERE company_id = ANY($1::bigint[])', [ids]);
    await client.query('DELETE FROM company_time_blocks WHERE company_id = ANY($1::bigint[])', [ids]);
    await client.query('DELETE FROM company_sports WHERE company_id = ANY($1::bigint[])', [ids]);
    await client.query('DELETE FROM auth.user_companies WHERE company_id = ANY($1::bigint[])', [ids]);
    await client.query('DELETE FROM companies WHERE id = ANY($1::bigint[])', [ids]);
  }

  const users = await client.query(
    "SELECT id FROM auth.users WHERE username = ANY($1::text[]) AND role <> 'admin'",
    [DEMO_USERNAMES],
  );
  const userIds = users.rows.map((r) => Number(r.id));
  if (userIds.length > 0) {
    await client.query('DELETE FROM auth.user_companies WHERE user_id = ANY($1::bigint[])', [userIds]);
    await client.query('DELETE FROM auth.sessions WHERE user_id = ANY($1::bigint[])', [userIds]);
    await client.query('DELETE FROM auth.users WHERE id = ANY($1::bigint[])', [userIds]);
  }
}

async function sportIdsBySlug(client: PoolClient): Promise<Record<string, number>> {
  const r = await client.query('SELECT id, slug FROM sports');
  const map: Record<string, number> = {};
  for (const row of r.rows) map[row.slug] = Number(row.id);
  return map;
}

async function insertCompany(
  client: PoolClient,
  c: { name: string; email: string; phone: string; address: string; city: string; timezone: string },
): Promise<number> {
  const r = await client.query(
    `INSERT INTO companies (name, email, phone, address, city, timezone, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id`,
    [c.name, c.email, c.phone, c.address, c.city, c.timezone],
  );
  return Number(r.rows[0].id);
}

async function addCompanySport(client: PoolClient, companyId: number, sportId: number) {
  await client.query(
    'INSERT INTO company_sports (company_id, sport_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [companyId, sportId],
  );
}

async function addTimeBlock(client: PoolClient, companyId: number, minutes: number) {
  await client.query(
    'INSERT INTO company_time_blocks (company_id, duration_minutes) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [companyId, minutes],
  );
}

async function insertRootCourt(
  client: PoolClient,
  o: { companyId: number; name: string; format: string; sportId: number; partitionable: boolean },
): Promise<AnyRow> {
  const r = await client.query(
    `INSERT INTO courts (company_id, name, format, sport_id, is_partitionable, is_auto_generated)
     VALUES ($1,$2,$3,$4,$5,false) RETURNING *`,
    [o.companyId, o.name, o.format, o.sportId, o.partitionable],
  );
  const row = r.rows[0];
  await client.query('UPDATE courts SET root_court_id = $1 WHERE id = $1', [row.id]);
  row.root_court_id = row.id;
  return norm(row);
}

// Inserta una subcancha "a mano" (para el árbol anidado de antifragmentación,
// que el flujo normal de la app no genera porque sólo particiona un nivel).
async function insertChild(
  client: PoolClient,
  o: {
    companyId: number; parentId: number; rootId: number; name: string;
    format: string; sportId: number; partitionable: boolean;
    x: number; y: number; w: number; h: number;
  },
): Promise<AnyRow> {
  const r = await client.query(
    `INSERT INTO courts
     (company_id, parent_court_id, root_court_id, name, format, sport_id,
      is_partitionable, is_auto_generated, layout_x, layout_y, layout_width, layout_height)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11) RETURNING *`,
    [o.companyId, o.parentId, o.rootId, o.name, o.format, o.sportId, o.partitionable, o.x, o.y, o.w, o.h],
  );
  return norm(r.rows[0]);
}

async function getRule(client: PoolClient, source: string, target: string): Promise<AnyRow> {
  const r = await client.query(
    `SELECT * FROM court_partition_rules
     WHERE source_format = $1 AND target_format = $2 AND is_active = true
     ORDER BY priority DESC, id ASC LIMIT 1`,
    [source, target],
  );
  if (r.rowCount === 0) throw new Error(`No partition rule ${source} -> ${target}`);
  return r.rows[0];
}

async function childrenOf(client: PoolClient, parentId: number): Promise<AnyRow[]> {
  const r = await client.query('SELECT * FROM courts WHERE parent_court_id = $1 ORDER BY id', [parentId]);
  return r.rows.map(norm);
}

async function setPrice(
  client: PoolClient,
  courtId: number,
  sportId: number,
  pricePerHour: number,
  currency = 'ARS',
) {
  await client.query(
    `INSERT INTO court_prices (court_id, sport_id, price_per_hour, currency, is_active)
     VALUES ($1,$2,$3,$4,true)`,
    [courtId, sportId, pricePerHour, currency],
  );
}

async function seedBooking(
  client: PoolClient,
  o: {
    companyId: number; courtId: number; sportId: number; startISO: string; durationMin: number;
    status: 'held' | 'confirmed' | 'cancelled' | 'expired';
    customerName: string; customerEmail?: string | null; customerPhone?: string | null;
    priceTotal: number; currency?: string;
  },
) {
  const start = new Date(o.startISO);
  const end = new Date(start.getTime() + o.durationMin * 60000);
  let holdExpr = 'NULL';
  if (o.status === 'held') holdExpr = "now() + interval '20 minutes'";
  else if (o.status === 'expired') holdExpr = "now() - interval '15 minutes'";

  const ins = await client.query(
    `INSERT INTO bookings
     (company_id, court_id, sport_id, starts_at, ends_at, status,
      customer_name, customer_email, customer_phone, price_total, currency, hold_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, ${holdExpr}) RETURNING id`,
    [
      o.companyId, o.courtId, o.sportId, start.toISOString(), end.toISOString(), o.status,
      o.customerName, o.customerEmail ?? null, o.customerPhone ?? null, o.priceTotal, o.currency ?? 'ARS',
    ],
  );
  const bookingId = Number(ins.rows[0].id);

  if (o.status === 'held' || o.status === 'confirmed') {
    const courtsRes = await client.query('SELECT * FROM courts WHERE company_id = $1', [o.companyId]);
    const courts = courtsRes.rows.map(norm) as any[];
    const atomicIds = getAtomicCourtIds(courts as any, o.courtId);
    for (const aid of atomicIds) {
      await client.query(
        'INSERT INTO booking_locks (booking_id, court_id, starts_at, ends_at) VALUES ($1,$2,$3,$4)',
        [bookingId, aid, start.toISOString(), end.toISOString()],
      );
    }
  }
  return bookingId;
}

async function insertUser(client: PoolClient, username: string, email: string, role: 'editor' | 'reader') {
  const { passwordHash, passwordSalt } = await hashPassword(DEMO_PASSWORD);
  const r = await client.query(
    `INSERT INTO auth.users (username, email, password_hash, password_salt, role, is_active, must_change_password)
     VALUES ($1,$2,$3,$4,$5,true,false) RETURNING id`,
    [username, email, passwordHash, passwordSalt, role],
  );
  return Number(r.rows[0].id);
}

async function grant(client: PoolClient, userId: number, companyId: number, role: string) {
  await client.query(
    `INSERT INTO auth.user_companies (user_id, company_id, role) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, company_id) DO UPDATE SET role = EXCLUDED.role`,
    [userId, companyId, role],
  );
}

const DAY = '2026-06-30'; // fecha "escaparate" para disponibilidad
function ar(time: string) {
  return `${DAY}T${time}:00-03:00`;
} // Buenos Aires (UTC-3)
function es(time: string) {
  return `${DAY}T${time}:00+02:00`;
} // Madrid (CEST, UTC+2)

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await cleanup(client);

    const sport = await sportIdsBySlug(client);
    const SOCCER = sport['soccer'];
    const PADEL = sport['padel'];
    const TENNIS = sport['tennis'];
    const BASKET = sport['basketball'];
    const VOLLEY = sport['volleyball'];

    // ============================================================
    // EMPRESA 1: River Park (Buenos Aires) — fútbol + pádel + básquet
    // ============================================================
    const c1 = await insertCompany(client, {
      name: 'River Park Fútbol & Más',
      email: 'reservas@riverpark.com.ar',
      phone: '+54 11 4555-1000',
      address: 'Av. Libertador 7000',
      city: 'Buenos Aires',
      timezone: 'America/Argentina/Buenos_Aires',
    });
    for (const s of [SOCCER, PADEL, BASKET]) await addCompanySport(client, c1, s);
    await addTimeBlock(client, c1, 60);
    await addTimeBlock(client, c1, 90);

    // (a) Estadio F11 particionable -> 3x F7 (multicancha + particionado de un nivel)
    const estadio = await insertRootCourt(client, {
      companyId: c1, name: 'Estadio Principal', format: 'soccer_11', sportId: SOCCER, partitionable: true,
    });
    await createChildCourts(client, estadio as any, estadio.id, true, await getRule(client, 'soccer_11', 'soccer_7') as any);
    const estadioHijos = await childrenOf(client, estadio.id); // F7 .1 .2 .3
    await setPrice(client, estadio.id, SOCCER, 96000);
    for (const h of estadioHijos) await setPrice(client, h.id, SOCCER, 36000);

    // (b) 2 canchas de pádel atómicas
    const padel1 = await insertRootCourt(client, { companyId: c1, name: 'Pádel Cristal 1', format: 'padel', sportId: PADEL, partitionable: false });
    const padel2 = await insertRootCourt(client, { companyId: c1, name: 'Pádel Cristal 2', format: 'padel', sportId: PADEL, partitionable: false });
    await setPrice(client, padel1.id, PADEL, 14000);
    await setPrice(client, padel2.id, PADEL, 14000);

    // (c) Gimnasio de básquet particionable -> 2 medias canchas
    const basket = await insertRootCourt(client, { companyId: c1, name: 'Polideportivo Básquet', format: 'basketball', sportId: BASKET, partitionable: true });
    await createChildCourts(client, basket as any, basket.id, true, await getRule(client, 'basketball', 'basketball_half') as any);
    const basketHijos = await childrenOf(client, basket.id);
    await setPrice(client, basket.id, BASKET, 40000);
    for (const h of basketHijos) await setPrice(client, h.id, BASKET, 24000);

    // (d) Complejo Modular F11 anidado (2 niveles) -> demo de ANTIFRAGMENTACIÓN
    const modular = await insertRootCourt(client, { companyId: c1, name: 'Complejo Modular F11', format: 'soccer_11', sportId: SOCCER, partitionable: true });
    await setPrice(client, modular.id, SOCCER, 90000);
    const alaA = await insertChild(client, { companyId: c1, parentId: modular.id, rootId: modular.id, name: 'Complejo Modular F11 · Ala A', format: 'soccer_9', sportId: SOCCER, partitionable: true, x: 0, y: 0, w: 0.5, h: 1 });
    const alaB = await insertChild(client, { companyId: c1, parentId: modular.id, rootId: modular.id, name: 'Complejo Modular F11 · Ala B', format: 'soccer_9', sportId: SOCCER, partitionable: true, x: 0.5, y: 0, w: 0.5, h: 1 });
    await setPrice(client, alaA.id, SOCCER, 50000);
    await setPrice(client, alaB.id, SOCCER, 50000);
    // Grupo G1 (bajo Ala A): 3 x F5
    const g1: AnyRow[] = [];
    for (let i = 0; i < 3; i++) {
      g1.push(await insertChild(client, {
        companyId: c1, parentId: alaA.id, rootId: modular.id, name: `Complejo Modular F11 · A${i + 1}`,
        format: 'soccer_5', sportId: SOCCER, partitionable: false, x: 0 + i * 0.166667, y: 0, w: 0.166666, h: 1,
      }));
    }
    // Grupo G2 (bajo Ala B): 3 x F5
    const g2: AnyRow[] = [];
    for (let i = 0; i < 3; i++) {
      g2.push(await insertChild(client, {
        companyId: c1, parentId: alaB.id, rootId: modular.id, name: `Complejo Modular F11 · B${i + 1}`,
        format: 'soccer_5', sportId: SOCCER, partitionable: false, x: 0.5 + i * 0.166667, y: 0, w: 0.166666, h: 1,
      }));
    }
    for (const h of [...g1, ...g2]) await setPrice(client, h.id, SOCCER, 20000);

    // ---- Reservas C1 (fecha escaparate 2026-06-30) ----
    // 1) ANTIOVERLAP: estadio completo confirmado 19:00 -> bloquea sus 3 hijas F7
    await seedBooking(client, { companyId: c1, courtId: estadio.id, sportId: SOCCER, startISO: ar('19:00'), durationMin: 60, status: 'confirmed', customerName: 'Liga Amateur — Final', customerEmail: 'liga@correo.com', customerPhone: '+54 11 4000-0001', priceTotal: 96000 });
    // 2) Subcancha F7 .2 confirmada a otra hora (multicancha independiente)
    await seedBooking(client, { companyId: c1, courtId: estadioHijos[1].id, sportId: SOCCER, startISO: ar('21:00'), durationMin: 60, status: 'confirmed', customerName: 'Los Pibes FC', customerPhone: '+54 11 4000-0002', priceTotal: 36000 });
    // 3) HOLD pendiente en pádel (amarillo, expira pronto)
    await seedBooking(client, { companyId: c1, courtId: padel1.id, sportId: PADEL, startISO: ar('18:00'), durationMin: 60, status: 'held', customerName: 'Sofía Méndez', customerEmail: 'sofia@correo.com', priceTotal: 14000 });
    // 4) CANCELADA en pádel (sin lock, visible en panel del operador)
    await seedBooking(client, { companyId: c1, courtId: padel2.id, sportId: PADEL, startISO: ar('18:00'), durationMin: 60, status: 'cancelled', customerName: 'Grupo del Jueves', priceTotal: 14000 });
    // 5) EXPIRADA en pádel (hold vencido, sin lock)
    await seedBooking(client, { companyId: c1, courtId: padel1.id, sportId: PADEL, startISO: ar('20:00'), durationMin: 60, status: 'expired', customerName: 'Reserva sin confirmar', priceTotal: 14000 });
    // 6) Media cancha de básquet confirmada (multicancha en otro deporte)
    await seedBooking(client, { companyId: c1, courtId: basketHijos[0].id, sportId: BASKET, startISO: ar('20:00'), durationMin: 60, status: 'confirmed', customerName: 'Escuela de Mini Básquet', priceTotal: 24000 });
    // 7) ANTIFRAGMENTACIÓN: confirmamos A1 (grupo G1) 19:00. Deja G1 1/3 ocupado y
    //    G2 0/3 -> reservar en G2 a las 19:00 queda "compaction_blocked".
    await seedBooking(client, { companyId: c1, courtId: g1[0].id, sportId: SOCCER, startISO: ar('19:00'), durationMin: 60, status: 'confirmed', customerName: 'Equipo Modular A', priceTotal: 20000 });

    // ============================================================
    // EMPRESA 2: Pádel House Palermo (Buenos Aires) — sólo pádel
    // ============================================================
    const c2 = await insertCompany(client, {
      name: 'Pádel House Palermo', email: 'hola@padelhouse.com', phone: '+54 11 4777-2000',
      address: 'Honduras 4500', city: 'Buenos Aires', timezone: 'America/Argentina/Buenos_Aires',
    });
    await addCompanySport(client, c2, PADEL);
    await addTimeBlock(client, c2, 60);
    await addTimeBlock(client, c2, 90);
    const pA = await insertRootCourt(client, { companyId: c2, name: 'Cancha Blindex A', format: 'padel', sportId: PADEL, partitionable: false });
    const pB = await insertRootCourt(client, { companyId: c2, name: 'Cancha Blindex B', format: 'padel', sportId: PADEL, partitionable: false });
    const pC = await insertRootCourt(client, { companyId: c2, name: 'Cancha Panorámica', format: 'padel', sportId: PADEL, partitionable: false });
    for (const c of [pA, pB, pC]) await setPrice(client, c.id, PADEL, 15000);
    await seedBooking(client, { companyId: c2, courtId: pA.id, sportId: PADEL, startISO: ar('18:00'), durationMin: 60, status: 'confirmed', customerName: 'Martín y Co.', priceTotal: 15000 });
    await seedBooking(client, { companyId: c2, courtId: pC.id, sportId: PADEL, startISO: ar('20:00'), durationMin: 60, status: 'confirmed', customerName: 'Torneo Interno', priceTotal: 15000 });
    await seedBooking(client, { companyId: c2, courtId: pB.id, sportId: PADEL, startISO: ar('19:00'), durationMin: 60, status: 'held', customerName: 'Reserva web', customerEmail: 'web@correo.com', priceTotal: 15000 });

    // ============================================================
    // EMPRESA 3: Madrid Indoor Center (Madrid, EUR) — fútbol + vóley
    //   Demuestra timezone distinto (Europe/Madrid) y multimoneda (EUR).
    // ============================================================
    const c3 = await insertCompany(client, {
      name: 'Madrid Indoor Center', email: 'info@madridindoor.es', phone: '+34 910 000 000',
      address: 'Calle Gran Vía 80', city: 'Madrid', timezone: 'Europe/Madrid',
    });
    for (const s of [SOCCER, VOLLEY]) await addCompanySport(client, c3, s);
    await addTimeBlock(client, c3, 60);
    await addTimeBlock(client, c3, 90);
    const pistaF9 = await insertRootCourt(client, { companyId: c3, name: 'Pista Central F9', format: 'soccer_9', sportId: SOCCER, partitionable: true });
    await createChildCourts(client, pistaF9 as any, pistaF9.id, true, await getRule(client, 'soccer_9', 'soccer_5') as any);
    const pistaHijos = await childrenOf(client, pistaF9.id);
    await setPrice(client, pistaF9.id, SOCCER, 80, 'EUR');
    for (const h of pistaHijos) await setPrice(client, h.id, SOCCER, 30, 'EUR');
    const voley = await insertRootCourt(client, { companyId: c3, name: 'Vóley Arena', format: 'volleyball', sportId: VOLLEY, partitionable: true });
    await createChildCourts(client, voley as any, voley.id, true, await getRule(client, 'volleyball', 'volleyball_training') as any);
    const voleyHijos = await childrenOf(client, voley.id);
    await setPrice(client, voley.id, VOLLEY, 50, 'EUR');
    for (const h of voleyHijos) await setPrice(client, h.id, VOLLEY, 28, 'EUR');
    // Reservas en horario LOCAL de Madrid
    await seedBooking(client, { companyId: c3, courtId: pistaHijos[0].id, sportId: SOCCER, startISO: es('18:00'), durationMin: 60, status: 'confirmed', customerName: 'Real Aficionados', priceTotal: 30, currency: 'EUR' });
    await seedBooking(client, { companyId: c3, courtId: voleyHijos[0].id, sportId: VOLLEY, startISO: es('19:00'), durationMin: 60, status: 'confirmed', customerName: 'Club Vóley Madrid', priceTotal: 28, currency: 'EUR' });

    // ============================================================
    // USUARIOS + PERMISOS POR EMPRESA (auth / roles)
    // ============================================================
    const owner = await insertUser(client, 'river.owner', 'owner@riverpark.com.ar', 'editor');
    await grant(client, owner, c1, 'owner');
    const manager = await insertUser(client, 'river.manager', 'manager@riverpark.com.ar', 'editor');
    await grant(client, manager, c1, 'manager');
    const staff = await insertUser(client, 'padel.staff', 'staff@padelhouse.com', 'editor');
    await grant(client, staff, c2, 'staff');
    const viewer = await insertUser(client, 'demo.viewer', 'viewer@demo.test', 'reader');
    await grant(client, viewer, c1, 'viewer');
    await grant(client, viewer, c3, 'viewer');

    await client.query('COMMIT');

    // ---- Resumen ----
    const counts = await pool.query(
      `SELECT
         (SELECT count(*) FROM companies) AS companies,
         (SELECT count(*) FROM courts) AS courts,
         (SELECT count(*) FROM bookings) AS bookings,
         (SELECT count(*) FROM booking_locks) AS locks,
         (SELECT count(*) FROM auth.users) AS users`,
    );
    const c = counts.rows[0];
    console.log('\n==================== SEED DE DEMO LISTO ====================');
    console.log(`Empresas: ${c.companies} | Canchas: ${c.courts} | Reservas: ${c.bookings} | Locks: ${c.locks} | Usuarios: ${c.users}`);
    console.log('\nApp:        http://localhost:8080   (frontend)');
    console.log('API:        http://localhost:3000');
    console.log('\nUsuarios de demo (password: ' + DEMO_PASSWORD + '):');
    console.log('  admin         / ' + (process.env.ADMIN_PASSWORD || 'AdminPass1234') + '   (admin global)');
    console.log('  river.owner   / ' + DEMO_PASSWORD + '   (owner   de River Park)');
    console.log('  river.manager / ' + DEMO_PASSWORD + '   (manager de River Park)');
    console.log('  padel.staff   / ' + DEMO_PASSWORD + '   (staff   de Pádel House)');
    console.log('  demo.viewer   / ' + DEMO_PASSWORD + '   (viewer  de River Park y Madrid)');
    console.log('\nEscaparate de disponibilidad: empresa River Park, deporte Fútbol,');
    console.log(`duración 60 min, fecha ${DAY}. El slot de las 19:00 muestra:`);
    console.log('  - Estadio Principal: confirmado (antioverlap: bloquea sus 3 subcanchas F7)');
    console.log('  - Complejo Modular: A1 confirmado; A2/A3 disponibles; B1/B2/B3 bloqueadas');
    console.log('    por antifragmentación (sugiere completar el grupo ya empezado).');
    console.log('===========================================================\n');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

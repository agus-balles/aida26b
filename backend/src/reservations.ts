import type { Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import type { AuthUser } from './auth';

type AuthedRequest = Request & { user?: AuthUser };

type CustomerIdentity = { id: number; name: string; email: string; phone: string | null };
type CustomerRequest = Request & { customer?: CustomerIdentity };

type Queryable = Pool | PoolClient;

type CourtRow = {
  id: number;
  company_id: number;
  parent_court_id: number | null;
  root_court_id: number | null;
  name: string;
  format: string;
  sport_id: number;
  is_partitionable: boolean;
  is_auto_generated: boolean;
  layout_x: number | string;
  layout_y: number | string;
  layout_width: number | string;
  layout_height: number | string;
  is_active: boolean;
};

type LayoutRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PartitionRuleRow = {
  id: number;
  source_format: string;
  target_format: string;
  target_sport_id: number | null;
  child_count: number;
  layout_json: unknown;
};

type SlotLock = {
  court_id: number;
  starts_at: string | Date;
  ends_at: string | Date;
  status: 'held' | 'confirmed';
};

type HttpErrorBody = {
  error: string;
  alternatives?: number[];
};

const formatsBySportSlug: Record<string, string[]> = {
  soccer: ['soccer_11', 'soccer_9', 'soccer_8', 'soccer_7', 'soccer_6', 'soccer_5'],
  padel: ['padel'],
  tennis: ['tennis'],
  basketball: ['basketball', 'basketball_half'],
  volleyball: ['volleyball', 'volleyball_training'],
};

class HttpError extends Error {
  status: number;
  body: HttpErrorBody;

  constructor(status: number, body: HttpErrorBody) {
    super(body.error);
    this.status = status;
    this.body = body;
  }
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function validateCourtFormat(client: PoolClient, sportId: number, format: string): Promise<void> {
  const result = await client.query<{ slug: string }>(
    'SELECT slug FROM sports WHERE id = $1',
    [sportId]
  );
  const allowedFormats = formatsBySportSlug[result.rows[0]?.slug];

  if (!allowedFormats || !allowedFormats.includes(format)) {
    throw new HttpError(400, {
      error: 'El formato elegido no corresponde al deporte seleccionado.',
    });
  }
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function readPositiveInteger(value: unknown, field: string): number {
  const parsed = numberValue(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, { error: `El valor de ${field} debe ser un entero positivo.` });
  }
  return parsed;
}

function readOptionalPositiveInteger(value: unknown, field: string): number | null {
  if (value == null || value === '') return null;
  return readPositiveInteger(value, field);
}

function readDate(value: unknown, field: string): Date {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, { error: `Ingresá una fecha válida para ${field}.` });
  }
  return date;
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

// Reservable window of the day, expressed in each company's local time.
const OPEN_HOUR = 8;
const CLOSE_HOUR = 23;

/** Offset (ms) between UTC and `timeZone` at the given instant. */
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, number> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }

  // en-US renders midnight as hour 24; normalise to 0.
  const hour = parts.hour === 24 ? 0 : parts.hour;
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

/** UTC instant for a wall-clock time interpreted in `timeZone`. */
function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = timeZoneOffsetMs(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offset);
}

/** Local calendar date (YYYY-MM-DD) of an instant in `timeZone`. */
function zonedDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA < endB && endA > startB;
}

function sameDateKey(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function advisoryLockKey(rootCourtId: number, startsAt: Date): string {
  return String(BigInt(rootCourtId) * 100000000n + BigInt(sameDateKey(startsAt)));
}

export function rectsOverlap(a: LayoutRect, b: LayoutRect): boolean {
  return a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
}

export function normalizeLayout(value: unknown, childCount: number): LayoutRect[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;

  if (!Array.isArray(parsed) || parsed.length !== childCount) {
    throw new HttpError(400, { error: 'La regla de partición no coincide con la cantidad de subcanchas.' });
  }

  const rects = parsed.map((item) => {
    const source = item as Record<string, unknown>;
    const rect = {
      x: numberValue(source.x),
      y: numberValue(source.y),
      width: numberValue(source.width),
      height: numberValue(source.height),
    };

    if (
      rect.x === null ||
      rect.y === null ||
      rect.width === null ||
      rect.height === null ||
      rect.x < 0 ||
      rect.y < 0 ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.x + rect.width > 1.000001 ||
      rect.y + rect.height > 1.000001
    ) {
      throw new HttpError(400, { error: 'La regla de partición tiene áreas inválidas.' });
    }

    return rect as LayoutRect;
  });

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j])) {
        throw new HttpError(400, { error: 'Las áreas de la regla de partición se superponen.' });
      }
    }
  }

  return rects;
}

function childrenByParent(courts: CourtRow[]): Map<number, CourtRow[]> {
  const children = new Map<number, CourtRow[]>();

  for (const court of courts) {
    if (court.parent_court_id === null) continue;
    const list = children.get(court.parent_court_id) ?? [];
    list.push(court);
    children.set(court.parent_court_id, list);
  }

  return children;
}

export function getAtomicCourtIds(courts: CourtRow[], courtId: number): number[] {
  const children = childrenByParent(courts);
  const result: number[] = [];

  function visit(id: number) {
    const childCourts = children.get(id) ?? [];
    if (childCourts.length === 0) {
      result.push(id);
      return;
    }

    childCourts.forEach((child) => visit(child.id));
  }

  visit(courtId);
  return result;
}

export function findCompactionAlternatives(
  courts: CourtRow[],
  lockedCourtIds: Set<number>,
  selectedCourtId: number
): number[] {
  const selected = courts.find((court) => court.id === selectedCourtId);
  if (!selected?.parent_court_id) return [];

  const rootId = selected.root_court_id ?? selected.id;
  const groups = new Map<number, CourtRow[]>();

  courts
    .filter((court) =>
      (court.root_court_id ?? court.id) === rootId &&
      court.parent_court_id !== null &&
      court.format === selected.format
    )
    .forEach((court) => {
      const parentId = court.parent_court_id!;
      const list = groups.get(parentId) ?? [];
      list.push(court);
      groups.set(parentId, list);
    });

  const stats = [...groups.entries()]
    .map(([parentId, groupCourts]) => ({
      parentId,
      total: groupCourts.length,
      occupied: groupCourts.filter((court) => lockedCourtIds.has(court.id)).length,
      available: groupCourts.filter((court) => !lockedCourtIds.has(court.id)).map((court) => court.id),
    }))
    .filter((group) => group.occupied > 0 && group.occupied < group.total);

  if (stats.length === 0) return [];

  const maxOccupied = Math.max(...stats.map((group) => group.occupied));
  const targetGroups = stats.filter((group) => group.occupied === maxOccupied);

  if (targetGroups.some((group) => group.parentId === selected.parent_court_id)) {
    return [];
  }

  return targetGroups.flatMap((group) => group.available);
}

async function expireHeldBookings(queryable: Queryable) {
  await queryable.query(
    `DELETE FROM booking_locks l
     USING bookings b
     WHERE l.booking_id = b.id
       AND b.status = 'held'
       AND b.hold_expires_at <= now()`
  );

  await queryable.query(
    `UPDATE bookings
     SET status = 'expired', updated_at = now()
     WHERE status = 'held'
       AND hold_expires_at <= now()`
  );
}

async function hasCompanyAccess(
  queryable: Queryable,
  user: AuthUser | undefined,
  companyId: number,
  write: boolean
): Promise<boolean> {
  if (!user) return false;
  if (user.role === 'admin') return true;

  const roles = write ? ['owner', 'manager', 'staff'] : ['owner', 'manager', 'staff', 'viewer'];
  const result = await queryable.query<{ role: string }>(
    `SELECT role
     FROM auth.user_companies
     WHERE user_id = $1 AND company_id = $2`,
    [user.id, companyId]
  );

  return result.rows.some((row) => roles.includes(row.role));
}

async function requireCompanyAccess(
  queryable: Queryable,
  req: Request,
  companyId: number,
  write: boolean
) {
  if (!(await hasCompanyAccess(queryable, (req as AuthedRequest).user, companyId, write))) {
    throw new HttpError(403, { error: 'No tenés permisos para realizar esta acción.' });
  }
}

async function fetchCourtTree(queryable: Queryable, companyId: number, rootCourtId: number): Promise<CourtRow[]> {
  const result = await queryable.query<CourtRow>(
    `SELECT *
     FROM courts
     WHERE company_id = $1
       AND (id = $2 OR root_court_id = $2)
       AND is_active = true
     ORDER BY id`,
    [companyId, rootCourtId]
  );
  return result.rows.map(normalizeCourtRow);
}

function normalizeCourtRow(row: CourtRow): CourtRow {
  return {
    ...row,
    id: Number(row.id),
    company_id: Number(row.company_id),
    parent_court_id: row.parent_court_id === null ? null : Number(row.parent_court_id),
    root_court_id: row.root_court_id === null ? null : Number(row.root_court_id),
    sport_id: Number(row.sport_id),
    layout_x: toNumber(row.layout_x),
    layout_y: toNumber(row.layout_y),
    layout_width: toNumber(row.layout_width),
    layout_height: toNumber(row.layout_height),
  };
}

async function selectRootRule(
  queryable: Queryable,
  sourceFormat: string,
  requestedRuleId: number | null
): Promise<PartitionRuleRow> {
  const result = await queryable.query<PartitionRuleRow>(
    `SELECT *
     FROM court_partition_rules
     WHERE source_format = $1
       AND is_active = true
     ORDER BY priority DESC, usable_area_ratio DESC, child_count DESC, id ASC`,
    [sourceFormat]
  );

  if (result.rowCount === 0) {
    throw new HttpError(400, {
      error: `No hay una regla de partición activa para ${sourceFormat}.`,
    });
  }

  if (requestedRuleId !== null) {
    const selected = result.rows.find((rule) => Number(rule.id) === requestedRuleId);

    if (!selected) {
      throw new HttpError(400, {
        error: 'La regla de partición elegida no corresponde al formato de la cancha.',
      });
    }

    return selected;
  }

  if ((result.rowCount ?? 0) > 1) {
    throw new HttpError(400, {
      error: 'Elegí una regla de partición para continuar.',
    });
  }

  return result.rows[0];
}

export async function createChildCourts(
  client: PoolClient,
  parent: CourtRow,
  rootCourtId: number,
  required: boolean,
  selectedRule?: PartitionRuleRow
) {
  const rule = selectedRule;

  if (!rule) {
    if (required) {
      throw new HttpError(400, { error: `No hay una regla de partición activa para ${parent.format}.` });
    }
    return;
  }

  const layout = normalizeLayout(rule.layout_json, Number(rule.child_count));
  const parentX = toNumber(parent.layout_x);
  const parentY = toNumber(parent.layout_y);
  const parentWidth = toNumber(parent.layout_width);
  const parentHeight = toNumber(parent.layout_height);
  const childSportId = rule.target_sport_id == null
    ? parent.sport_id
    : Number(rule.target_sport_id);

  if (childSportId !== parent.sport_id) {
    const companySport = await client.query(
      `SELECT 1
       FROM company_sports
       WHERE company_id = $1 AND sport_id = $2`,
      [parent.company_id, childSportId]
    );

    if (companySport.rowCount === 0) {
      throw new HttpError(400, {
        error: 'La empresa debe ofrecer el deporte destino de la regla de partición.',
      });
    }
  }

  for (let index = 0; index < layout.length; index++) {
    const rect = layout[index];
    await client.query<CourtRow>(
      `INSERT INTO courts
       (company_id, parent_court_id, root_court_id, name, format, sport_id,
        is_partitionable, is_auto_generated, layout_x, layout_y, layout_width, layout_height)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11)
       RETURNING *`,
      [
        parent.company_id,
        parent.id,
        rootCourtId,
        `${parent.name} ${rule.target_format.replace('soccer_', '').replace(/_/g, ' ')}.${index + 1}`,
        rule.target_format,
        childSportId,
        false,
        parentX + rect.x * parentWidth,
        parentY + rect.y * parentHeight,
        rect.width * parentWidth,
        rect.height * parentHeight,
      ]
    );
  }
}

export function createCourtWithPartitions(pool: Pool) {
  return async (req: Request, res: Response) => {
    const client = await pool.connect();

    try {
      const companyId = readPositiveInteger(req.params.companyId, 'companyId');
      await requireCompanyAccess(client, req, companyId, true);

      const name = stringValue(req.body.name);
      const format = stringValue(req.body.format);
      const sportId = readPositiveInteger(req.body.sport_id, 'sport_id');
      const isPartitionable = booleanValue(req.body.is_partitionable);
      const partitionRuleId = readOptionalPositiveInteger(
        req.body.partition_rule_id,
        'partition_rule_id'
      );

      if (!name || !format) {
        throw new HttpError(400, { error: 'Completá el nombre y el formato de la cancha.' });
      }

      await client.query('BEGIN');

      const companySport = await client.query(
        `SELECT 1
         FROM company_sports
         WHERE company_id = $1 AND sport_id = $2`,
        [companyId, sportId]
      );

      if (companySport.rowCount === 0) {
        throw new HttpError(400, {
          error: 'Primero asociá este deporte a la empresa antes de crear una cancha.',
        });
      }

      await validateCourtFormat(client, sportId, format);

      const rootRule = isPartitionable
        ? await selectRootRule(client, format, partitionRuleId)
        : null;

      const root = await client.query<CourtRow>(
        `INSERT INTO courts
         (company_id, name, format, sport_id, is_partitionable, is_auto_generated)
         VALUES ($1, $2, $3, $4, $5, false)
         RETURNING *`,
        [companyId, name, format, sportId, isPartitionable]
      );

      const rootCourt = normalizeCourtRow(root.rows[0]);

      await client.query(
        'UPDATE courts SET root_court_id = $1 WHERE id = $1',
        [rootCourt.id]
      );

      if (isPartitionable) {
        await createChildCourts(
          client,
          { ...rootCourt, root_court_id: rootCourt.id },
          rootCourt.id,
          true,
          rootRule ?? undefined
        );
      }

      await client.query('COMMIT');

      const tree = await fetchCourtTree(pool, companyId, rootCourt.id);
      return res.status(201).json({
        success: true,
        message: 'Court created successfully',
        data: tree,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return sendReservationError(res, error, 'Error creating court');
    } finally {
      client.release();
    }
  };
}

export function applyCourtPartitionRule(pool: Pool) {
  return async (req: Request, res: Response) => {
    const client = await pool.connect();

    try {
      const companyId = readPositiveInteger(req.params.companyId, 'companyId');
      const courtId = readPositiveInteger(req.params.courtId, 'cancha_id');
      const partitionRuleId = readPositiveInteger(req.body.partition_rule_id, 'partition_rule_id');
      await requireCompanyAccess(client, req, companyId, true);

      await client.query('BEGIN');

      const courtResult = await client.query<CourtRow>(
        `SELECT *
         FROM courts
         WHERE id = $1 AND company_id = $2 AND is_active = true
         FOR UPDATE`,
        [courtId, companyId]
      );

      if (courtResult.rowCount === 0) {
        throw new HttpError(404, { error: 'La cancha seleccionada no está disponible.' });
      }

      const court = normalizeCourtRow(courtResult.rows[0]);

      if (!court.is_partitionable) {
        throw new HttpError(400, {
          error: 'Marcá la cancha como particionable y guardá el cambio antes de aplicar una regla.',
        });
      }

      const existingChildren = await client.query(
        'SELECT 1 FROM courts WHERE parent_court_id = $1 AND is_active = true LIMIT 1',
        [court.id]
      );

      if (existingChildren.rowCount !== 0) {
        throw new HttpError(409, {
          error: 'Esta cancha ya tiene subcanchas. No se puede aplicar otra regla.',
        });
      }

      const rule = await selectRootRule(client, court.format, partitionRuleId);
      await createChildCourts(client, court, court.root_court_id ?? court.id, true, rule);
      await client.query('COMMIT');

      const tree = await fetchCourtTree(pool, companyId, court.root_court_id ?? court.id);
      return res.status(201).json({
        success: true,
        message: 'Regla de partición aplicada.',
        data: tree,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return sendReservationError(res, error, 'Error applying partition rule');
    } finally {
      client.release();
    }
  };
}

function parseDateParts(date: string): [number, number, number] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpError(400, { error: 'Elegí una fecha válida.' });
  }
  const [year, month, day] = date.split('-').map(Number);
  return [year, month, day];
}

function dateWindow(date: string, timeZone: string): { start: Date; end: Date } {
  const [year, month, day] = parseDateParts(date);
  const start = zonedWallClockToUtc(year, month, day, 0, 0, timeZone);
  return { start, end: addMinutes(start, 24 * 60) };
}

function buildSlots(
  date: string,
  durationMinutes: number,
  timeZone: string
): Array<{ startsAt: Date; endsAt: Date }> {
  const [year, month, day] = parseDateParts(date);
  const first = zonedWallClockToUtc(year, month, day, OPEN_HOUR, 0, timeZone);
  const dayEnd = zonedWallClockToUtc(year, month, day, CLOSE_HOUR, 0, timeZone);
  const slots: Array<{ startsAt: Date; endsAt: Date }> = [];

  for (let startsAt = first; addMinutes(startsAt, durationMinutes) <= dayEnd; startsAt = addMinutes(startsAt, durationMinutes)) {
    slots.push({ startsAt, endsAt: addMinutes(startsAt, durationMinutes) });
  }

  return slots;
}

async function validateTimeBlock(queryable: Queryable, companyId: number, durationMinutes: number) {
  const result = await queryable.query(
    `SELECT 1
     FROM company_time_blocks
     WHERE company_id = $1
       AND duration_minutes = $2
       AND is_active = true`,
    [companyId, durationMinutes]
  );

  if (result.rowCount === 0) {
    throw new HttpError(400, { error: 'La duración elegida no está configurada para esta empresa.' });
  }
}

async function fetchDayLocks(
  queryable: Queryable,
  companyId: number,
  dayStart: Date,
  dayEnd: Date
): Promise<SlotLock[]> {
  const result = await queryable.query<SlotLock>(
    `SELECT l.court_id, l.starts_at, l.ends_at, b.status
     FROM booking_locks l
     JOIN bookings b ON b.id = l.booking_id
     WHERE b.company_id = $1
       AND b.status IN ('held', 'confirmed')
       AND l.starts_at < $3
       AND l.ends_at > $2`,
    [companyId, dayStart, dayEnd]
  );

  return result.rows.map((row) => ({ ...row, court_id: Number(row.court_id) }));
}

function lockedCourtIdsForSlot(locks: SlotLock[], startsAt: Date, endsAt: Date): Set<number> {
  return new Set(
    locks
      .filter((lock) => overlaps(startsAt, endsAt, new Date(lock.starts_at), new Date(lock.ends_at)))
      .map((lock) => Number(lock.court_id))
  );
}

function statusForSlot(
  locks: SlotLock[],
  atomicIds: number[],
  startsAt: Date,
  endsAt: Date
): 'available' | 'held' | 'confirmed' {
  const overlapping = locks.filter((lock) =>
    atomicIds.includes(Number(lock.court_id)) &&
    overlaps(startsAt, endsAt, new Date(lock.starts_at), new Date(lock.ends_at))
  );

  if (overlapping.some((lock) => lock.status === 'confirmed')) return 'confirmed';
  if (overlapping.length > 0) return 'held';
  return 'available';
}

async function fetchPrices(
  queryable: Queryable,
  courtIds: number[],
  sportId: number,
  onDate: string
) {
  if (courtIds.length === 0) return new Map<number, { price: number; currency: string }>();

  const result = await queryable.query<{
    court_id: number;
    price_per_hour: string;
    currency: string;
  }>(
    `SELECT DISTINCT ON (court_id)
       court_id,
       price_per_hour,
       currency
     FROM court_prices
     WHERE court_id = ANY($1::bigint[])
       AND sport_id = $2
       AND is_active = true
       AND (valid_from IS NULL OR valid_from <= $3::date)
       AND (valid_to IS NULL OR valid_to >= $3::date)
     ORDER BY court_id, valid_from DESC NULLS LAST, id DESC`,
    [courtIds, sportId, onDate]
  );

  return new Map(
    result.rows.map((row) => [
      Number(row.court_id),
      { price: Number(row.price_per_hour), currency: row.currency },
    ])
  );
}

function priceForCourt(
  court: CourtRow,
  courts: CourtRow[],
  prices: Map<number, { price: number; currency: string }>,
  durationMinutes: number
): { price_total: number; currency: string } | null {
  let current: CourtRow | undefined = court;

  while (current) {
    const price = prices.get(current.id);
    if (price) {
      return {
        price_total: Number((price.price * durationMinutes / 60).toFixed(2)),
        currency: price.currency,
      };
    }

    current = current.parent_court_id
      ? courts.find((candidate) => candidate.id === current?.parent_court_id)
      : undefined;
  }

  return null;
}

export function getCompanyAvailability(pool: Pool) {
  return async (req: Request, res: Response) => {
    try {
      const companyId = readPositiveInteger(req.params.companyId, 'companyId');

      const date = stringValue(req.query.date);
      const sportId = readPositiveInteger(req.query.sport_id, 'sport_id');
      const durationMinutes = readPositiveInteger(req.query.duration_minutes, 'duration_minutes');

      await expireHeldBookings(pool);
      await validateTimeBlock(pool, companyId, durationMinutes);

      const company = await pool.query(
        'SELECT id, name, city, timezone FROM companies WHERE id = $1 AND is_active = true',
        [companyId]
      );

      if (company.rowCount === 0) {
        throw new HttpError(404, { error: 'La empresa seleccionada no está disponible.' });
      }

      const timeZone = company.rows[0].timezone || 'UTC';
      const { start: dayStart, end: dayEnd } = dateWindow(date, timeZone);

      const courtResult = await pool.query<CourtRow>(
        `SELECT *
         FROM courts
         WHERE company_id = $1
           AND is_active = true
         ORDER BY COALESCE(root_court_id, id), parent_court_id NULLS FIRST, id`,
        [companyId]
      );
      const allCourts = courtResult.rows.map(normalizeCourtRow);
      const courts = allCourts.filter((court) => court.sport_id === sportId);
      const prices = await fetchPrices(pool, courts.map((court) => court.id), sportId, date);
      const locks = await fetchDayLocks(pool, companyId, dayStart, dayEnd);
      const slots = buildSlots(date, durationMinutes, timeZone);

      return res.json({
        company: company.rows[0],
        courts: courts.map((court) => ({
          id: court.id,
          parent_court_id: court.parent_court_id,
          root_court_id: court.root_court_id,
          name: court.name,
          format: court.format,
          layout_x: court.layout_x,
          layout_y: court.layout_y,
          layout_width: court.layout_width,
          layout_height: court.layout_height,
          slots: slots.map((slot) => {
            const atomicIds = getAtomicCourtIds(allCourts, court.id);
            const status = statusForSlot(locks, atomicIds, slot.startsAt, slot.endsAt);
            const lockedIds = lockedCourtIdsForSlot(locks, slot.startsAt, slot.endsAt);
            const alternatives = status === 'available'
              ? findCompactionAlternatives(allCourts, lockedIds, court.id)
              : [];
            const price = priceForCourt(court, allCourts, prices, durationMinutes)
              ?? { price_total: 0, currency: 'ARS' };

            return {
              starts_at: slot.startsAt.toISOString(),
              ends_at: slot.endsAt.toISOString(),
              status: alternatives.length > 0 ? 'compaction_blocked' : status,
              alternatives,
              ...price,
            };
          }),
        })),
      });
    } catch (error) {
      return sendReservationError(res, error, 'Error loading availability');
    }
  };
}

async function fetchCompanyTimeZone(queryable: Queryable, companyId: number): Promise<string> {
  const result = await queryable.query<{ timezone: string }>(
    'SELECT timezone FROM companies WHERE id = $1 AND is_active = true',
    [companyId]
  );

  if (result.rowCount === 0) {
    throw new HttpError(404, { error: 'La empresa seleccionada no está disponible.' });
  }

  return result.rows[0].timezone || 'UTC';
}

async function fetchSelectedCourt(
  queryable: Queryable,
  companyId: number,
  courtId: number,
  sportId: number
): Promise<CourtRow> {
  const result = await queryable.query<CourtRow>(
    `SELECT *
     FROM courts
     WHERE id = $1
       AND company_id = $2
       AND sport_id = $3
       AND is_active = true`,
    [courtId, companyId, sportId]
  );

  if (result.rowCount === 0) {
    throw new HttpError(404, { error: 'La cancha seleccionada no está disponible.' });
  }

  return normalizeCourtRow(result.rows[0]);
}

async function fetchLockedIdsForCourts(
  queryable: Queryable,
  courtIds: number[],
  startsAt: Date,
  endsAt: Date
): Promise<number[]> {
  if (courtIds.length === 0) return [];

  const result = await queryable.query<{ court_id: number }>(
    `SELECT DISTINCT l.court_id
     FROM booking_locks l
     JOIN bookings b ON b.id = l.booking_id
     WHERE b.status IN ('held', 'confirmed')
       AND l.court_id = ANY($1::bigint[])
       AND l.starts_at < $3
       AND l.ends_at > $2`,
    [courtIds, startsAt, endsAt]
  );

  return result.rows.map((row) => Number(row.court_id));
}

type PreparedSlot = {
  court: Awaited<ReturnType<typeof fetchSelectedCourt>>;
  affectedCourtIds: number[];
  endsAt: Date;
  price: NonNullable<ReturnType<typeof priceForCourt>>;
};

// Shared reservation core: validates the slot, serialises overlapping attempts
// with an advisory lock, rejects conflicts/compaction alternatives and resolves
// the price. Callers must already be inside a transaction on `client` and are
// responsible for the INSERT (status/customer differ per caller).
async function prepareSlot(
  client: PoolClient,
  input: {
    companyId: number;
    courtId: number;
    sportId: number;
    durationMinutes: number;
    startsAt: Date;
  }
): Promise<PreparedSlot> {
  const { companyId, courtId, sportId, durationMinutes, startsAt } = input;
  const endsAt = addMinutes(startsAt, durationMinutes);

  await expireHeldBookings(client);
  await validateTimeBlock(client, companyId, durationMinutes);

  // Constrain starts_at to the company's slot grid (local time). Besides
  // rejecting arbitrary times, this keeps every booking inside a single
  // local day, so two overlapping holds on the same court always share the
  // advisory-lock key and serialise even if btree_gist is unavailable.
  const timeZone = await fetchCompanyTimeZone(client, companyId);
  const localDate = zonedDateKey(startsAt, timeZone);
  const gridSlots = buildSlots(localDate, durationMinutes, timeZone);

  if (!gridSlots.some((slot) => slot.startsAt.getTime() === startsAt.getTime())) {
    throw new HttpError(400, { error: 'El horario elegido no está disponible para reservar.' });
  }

  const court = await fetchSelectedCourt(client, companyId, courtId, sportId);
  const rootCourtId = court.root_court_id ?? court.id;

  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [
    advisoryLockKey(rootCourtId, startsAt),
  ]);

  const courts = await fetchCourtTree(client, companyId, rootCourtId);
  const affectedCourtIds = getAtomicCourtIds(courts, court.id);
  const overlapping = await fetchLockedIdsForCourts(client, affectedCourtIds, startsAt, endsAt);

  if (overlapping.length > 0) {
    throw new HttpError(409, { error: 'Ese horario acaba de dejar de estar disponible. Elegí otro.' });
  }

  const allRootAtomicIds = courts.flatMap((candidate) => getAtomicCourtIds(courts, candidate.id));
  const lockedIds = new Set(await fetchLockedIdsForCourts(client, [...new Set(allRootAtomicIds)], startsAt, endsAt));
  const alternatives = findCompactionAlternatives(courts, lockedIds, court.id);

  if (alternatives.length > 0) {
    throw new HttpError(409, {
      error: 'Elegí una de las canchas sugeridas para aprovechar mejor el espacio disponible.',
      alternatives,
    });
  }

  const prices = await fetchPrices(client, courts.map((candidate) => candidate.id), sportId, localDate);
  const price = priceForCourt(court, courts, prices, durationMinutes);

  if (!price) {
    throw new HttpError(400, {
      error: 'La cancha elegida no tiene un precio configurado para ese deporte.',
    });
  }

  return { court, affectedCourtIds, endsAt, price };
}

async function insertBookingLocks(
  client: PoolClient,
  bookingId: number,
  atomicCourtIds: number[],
  startsAt: Date,
  endsAt: Date
): Promise<void> {
  for (const atomicCourtId of atomicCourtIds) {
    await client.query(
      `INSERT INTO booking_locks (booking_id, court_id, starts_at, ends_at)
       VALUES ($1, $2, $3, $4)`,
      [bookingId, atomicCourtId, startsAt, endsAt]
    );
  }
}

export function holdBooking(pool: Pool) {
  return async (req: Request, res: Response) => {
    const client = await pool.connect();

    try {
      const companyId = readPositiveInteger(req.body.company_id, 'company_id');
      const courtId = readPositiveInteger(req.body.court_id, 'court_id');
      const sportId = readPositiveInteger(req.body.sport_id, 'sport_id');
      const durationMinutes = readPositiveInteger(req.body.duration_minutes, 'duration_minutes');
      const startsAt = readDate(req.body.starts_at, 'starts_at');
      const customerName = stringValue(req.body.customer_name);
      const customerEmail = stringValue(req.body.customer_email) || null;
      const customerPhone = stringValue(req.body.customer_phone) || null;

      if (!customerName) {
        throw new HttpError(400, { error: 'Completá el nombre de la persona que reserva.' });
      }

      await client.query('BEGIN');
      const { court, affectedCourtIds, endsAt, price } = await prepareSlot(client, {
        companyId,
        courtId,
        sportId,
        durationMinutes,
        startsAt,
      });

      const createdBy = (req as AuthedRequest).user?.id ?? null;

      const booking = await client.query(
        `INSERT INTO bookings
         (company_id, court_id, sport_id, starts_at, ends_at, status,
          customer_name, customer_email, customer_phone, price_total, currency,
          hold_expires_at, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, 'held', $6, $7, $8, $9, $10,
                 now() + interval '10 minutes', $11)
         RETURNING *`,
        [
          companyId,
          court.id,
          sportId,
          startsAt,
          endsAt,
          customerName,
          customerEmail,
          customerPhone,
          price.price_total,
          price.currency,
          createdBy,
        ]
      );

      await insertBookingLocks(client, booking.rows[0].id, affectedCourtIds, startsAt, endsAt);

      await client.query('COMMIT');

      return res.status(201).json({ booking: booking.rows[0], locked_court_ids: affectedCourtIds });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return sendReservationError(res, error, 'Error holding booking');
    } finally {
      client.release();
    }
  };
}

// A logged-in customer books directly as 'confirmed' (no 10-minute hold): the
// booking is theirs to see/cancel from "Mis reservas". Identity comes from the
// authenticated customer, not the request body.
export function createCustomerBooking(pool: Pool) {
  return async (req: Request, res: Response) => {
    const customer = (req as CustomerRequest).customer;

    if (!customer) {
      return res.status(401).json({ error: 'Necesitás iniciar sesión.' });
    }

    const client = await pool.connect();

    try {
      const companyId = readPositiveInteger(req.body.company_id, 'company_id');
      const courtId = readPositiveInteger(req.body.court_id, 'court_id');
      const sportId = readPositiveInteger(req.body.sport_id, 'sport_id');
      const durationMinutes = readPositiveInteger(req.body.duration_minutes, 'duration_minutes');
      const startsAt = readDate(req.body.starts_at, 'starts_at');

      await client.query('BEGIN');
      const { court, affectedCourtIds, endsAt, price } = await prepareSlot(client, {
        companyId,
        courtId,
        sportId,
        durationMinutes,
        startsAt,
      });

      const booking = await client.query(
        `INSERT INTO bookings
         (company_id, court_id, sport_id, starts_at, ends_at, status,
          customer_name, customer_email, customer_phone, price_total, currency,
          hold_expires_at, created_by_user_id, customer_id)
         VALUES ($1, $2, $3, $4, $5, 'confirmed', $6, $7, $8, $9, $10,
                 NULL, NULL, $11)
         RETURNING *`,
        [
          companyId,
          court.id,
          sportId,
          startsAt,
          endsAt,
          customer.name,
          customer.email,
          customer.phone,
          price.price_total,
          price.currency,
          customer.id,
        ]
      );

      await insertBookingLocks(client, booking.rows[0].id, affectedCourtIds, startsAt, endsAt);

      await client.query('COMMIT');

      return res.status(201).json({ booking: booking.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return sendReservationError(res, error, 'Error creating customer booking');
    } finally {
      client.release();
    }
  };
}

export function listCustomerBookings(pool: Pool) {
  return async (req: Request, res: Response) => {
    const customer = (req as CustomerRequest).customer;

    if (!customer) {
      return res.status(401).json({ error: 'Necesitás iniciar sesión.' });
    }

    try {
      await expireHeldBookings(pool);

      const result = await pool.query(
        `SELECT b.id, b.company_id, co.name AS company_name, b.court_id, c.name AS court_name,
                b.sport_id, b.starts_at, b.ends_at, b.status, b.price_total, b.currency,
                b.created_at
         FROM bookings b
         JOIN courts c ON c.id = b.court_id
         JOIN companies co ON co.id = b.company_id
         WHERE b.customer_id = $1
           AND b.status IN ('held', 'confirmed', 'cancelled')
         ORDER BY b.starts_at DESC`,
        [customer.id]
      );

      return res.json({ data: result.rows });
    } catch (error) {
      return sendReservationError(res, error, 'Error listing customer bookings');
    }
  };
}

// Customers cancel their own future bookings. Ownership is checked against
// customer_id and the slot must still be in the future.
export function cancelCustomerBooking(pool: Pool) {
  return async (req: Request, res: Response) => {
    const customer = (req as CustomerRequest).customer;

    if (!customer) {
      return res.status(401).json({ error: 'Necesitás iniciar sesión.' });
    }

    const client = await pool.connect();

    try {
      const bookingId = readPositiveInteger(req.params.id, 'id');

      await client.query('BEGIN');

      const current = await client.query(
        `SELECT * FROM bookings WHERE id = $1 FOR UPDATE`,
        [bookingId]
      );

      const booking = current.rows[0];

      if (current.rowCount === 0 || Number(booking.customer_id) !== customer.id) {
        throw new HttpError(404, { error: 'La reserva no está disponible.' });
      }

      if (booking.status !== 'held' && booking.status !== 'confirmed') {
        throw new HttpError(409, { error: 'La reserva ya no se puede cancelar.' });
      }

      if (new Date(booking.starts_at).getTime() <= Date.now()) {
        throw new HttpError(409, { error: 'No se puede cancelar una reserva que ya comenzó.' });
      }

      await client.query('DELETE FROM booking_locks WHERE booking_id = $1', [bookingId]);

      const updated = await client.query(
        `UPDATE bookings
         SET status = 'cancelled', updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [bookingId]
      );

      await client.query('COMMIT');
      return res.json({ booking: updated.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return sendReservationError(res, error, 'Error cancelling customer booking');
    } finally {
      client.release();
    }
  };
}

export function confirmBooking(pool: Pool) {
  return async (req: Request, res: Response) => {
    const client = await pool.connect();

    try {
      const bookingId = readPositiveInteger(req.params.id, 'id');

      await client.query('BEGIN');
      await expireHeldBookings(client);

      const current = await client.query(
        `SELECT *
         FROM bookings
         WHERE id = $1
         FOR UPDATE`,
        [bookingId]
      );

      if (current.rowCount === 0) {
        throw new HttpError(404, { error: 'La reserva no está disponible.' });
      }

      const booking = current.rows[0];
      await requireCompanyAccess(client, req, Number(booking.company_id), true);

      if (booking.status !== 'held') {
        throw new HttpError(409, { error: 'La reserva ya no está pendiente de confirmación.' });
      }

      const updated = await client.query(
        `UPDATE bookings
         SET status = 'confirmed',
             hold_expires_at = NULL,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [bookingId]
      );

      await client.query('COMMIT');
      return res.json({ booking: updated.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return sendReservationError(res, error, 'Error confirming booking');
    } finally {
      client.release();
    }
  };
}

export function cancelBooking(pool: Pool) {
  return async (req: Request, res: Response) => {
    const client = await pool.connect();

    try {
      const bookingId = readPositiveInteger(req.params.id, 'id');

      await client.query('BEGIN');

      const current = await client.query(
        `SELECT *
         FROM bookings
         WHERE id = $1
         FOR UPDATE`,
        [bookingId]
      );

      if (current.rowCount === 0) {
        throw new HttpError(404, { error: 'La reserva no está disponible.' });
      }

      const booking = current.rows[0];
      await requireCompanyAccess(client, req, Number(booking.company_id), true);

      await client.query('DELETE FROM booking_locks WHERE booking_id = $1', [bookingId]);

      const updated = await client.query(
        `UPDATE bookings
         SET status = 'cancelled',
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [bookingId]
      );

      await client.query('COMMIT');
      return res.json({ booking: updated.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return sendReservationError(res, error, 'Error cancelling booking');
    } finally {
      client.release();
    }
  };
}

export function listCompanyBookings(pool: Pool) {
  return async (req: Request, res: Response) => {
    try {
      const companyId = readPositiveInteger(req.params.companyId, 'companyId');
      await requireCompanyAccess(pool, req, companyId, false);
      await expireHeldBookings(pool);

      const result = await pool.query(
        `SELECT b.id, b.court_id, c.name AS court_name, b.sport_id,
                b.starts_at, b.ends_at, b.status, b.customer_name,
                b.customer_email, b.customer_phone, b.price_total, b.currency,
                b.hold_expires_at, b.created_at
         FROM bookings b
         JOIN courts c ON c.id = b.court_id
         WHERE b.company_id = $1
           AND b.status IN ('held', 'confirmed')
         ORDER BY b.starts_at`,
        [companyId]
      );

      return res.json({ data: result.rows });
    } catch (error) {
      return sendReservationError(res, error, 'Error listing bookings');
    }
  };
}

/**
 * Cross-company bookings list for operators/admin, with optional filters.
 * Admin sees every company; an operator is scoped to their linked companies.
 * Query: company_id (optional), status (held|confirmed|cancelled|expired|all;
 * default = active = held+confirmed).
 */
export function listBookings(pool: Pool) {
  return async (req: Request, res: Response) => {
    try {
      const user = (req as AuthedRequest).user;
      if (!user) {
        throw new HttpError(401, { error: 'Necesitás iniciar sesión.' });
      }

      await expireHeldBookings(pool);

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (user.role !== 'admin') {
        const links = await pool.query<{ company_id: number }>(
          'SELECT company_id FROM auth.user_companies WHERE user_id = $1',
          [user.id]
        );
        const ids = links.rows.map((row) => Number(row.company_id));
        if (ids.length === 0) return res.json({ data: [] });
        params.push(ids);
        conditions.push(`b.company_id = ANY($${params.length}::bigint[])`);
      }

      const companyId = readOptionalPositiveInteger(req.query.company_id, 'company_id');
      if (companyId !== null) {
        params.push(companyId);
        conditions.push(`b.company_id = $${params.length}`);
      }

      const status = stringValue(req.query.status);
      if (status === 'held' || status === 'confirmed' || status === 'cancelled' || status === 'expired') {
        params.push(status);
        conditions.push(`b.status = $${params.length}`);
      } else if (status !== 'all') {
        conditions.push(`b.status IN ('held', 'confirmed')`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const result = await pool.query(
        `SELECT b.id, b.company_id, co.name AS company_name, b.court_id, c.name AS court_name,
                b.sport_id, b.starts_at, b.ends_at, b.status, b.customer_name, b.customer_email,
                b.customer_phone, b.price_total, b.currency, b.hold_expires_at, b.created_at
         FROM bookings b
         JOIN courts c ON c.id = b.court_id
         JOIN companies co ON co.id = b.company_id
         ${where}
         ORDER BY b.starts_at DESC`,
        params
      );

      return res.json({ data: result.rows });
    } catch (error) {
      return sendReservationError(res, error, 'Error listing bookings');
    }
  };
}

function sendReservationError(res: Response, error: unknown, fallback: string) {
  if (error instanceof HttpError) {
    return res.status(error.status).json(error.body);
  }

  if (error instanceof SyntaxError) {
    return res.status(400).json({ error: 'La regla de partición debe tener un JSON válido.' });
  }

  console.error(fallback, error);
  return res.status(500).json({ error: 'No se pudo completar la operación. Intentá nuevamente.' });
}

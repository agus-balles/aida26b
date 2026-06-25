import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  applyCourtPartitionRule,
  createChildCourts,
  findCompactionAlternatives,
  getAtomicCourtIds,
  normalizeLayout,
} from '../src/reservations';
import { putHandler } from '../src/routes/put';
import { buildListQuery } from '../src/routes/get';
import { structure } from '../../shared/src/ssot/structure';

function court(
  id: number,
  parent_court_id: number | null,
  format: string,
) {
  return {
    id,
    company_id: 1,
    parent_court_id,
    root_court_id: id === 1 ? 1 : 1,
    name: `Court ${id}`,
    format,
    sport_id: 1,
    is_partitionable: format !== 'soccer_5',
    is_auto_generated: id !== 1,
    layout_x: 0,
    layout_y: 0,
    layout_width: 1,
    layout_height: 1,
    is_active: true,
  };
}

function courtTree() {
  return [
    court(1, null, 'soccer_11'),
    court(2, 1, 'soccer_8'),
    court(3, 1, 'soccer_8'),
    court(4, 1, 'soccer_8'),
    court(5, 2, 'soccer_5'),
    court(6, 2, 'soccer_5'),
    court(7, 2, 'soccer_5'),
    court(8, 3, 'soccer_5'),
    court(9, 3, 'soccer_5'),
    court(10, 3, 'soccer_5'),
    court(11, 4, 'soccer_5'),
    court(12, 4, 'soccer_5'),
    court(13, 4, 'soccer_5'),
  ];
}

test('normalizeLayout accepts contained non-overlapping rectangles', () => {
  const layout = normalizeLayout(
    [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.5, height: 1 },
    ],
    2
  );

  assert.equal(layout.length, 2);
});

test('normalizeLayout rejects overlapping rectangles', () => {
  assert.throws(
    () =>
      normalizeLayout(
        [
          { x: 0, y: 0, width: 0.75, height: 1 },
          { x: 0.5, y: 0, width: 0.5, height: 1 },
        ],
        2
      ),
    /superponen/
  );
});

test('getAtomicCourtIds returns leaf courts for a large court', () => {
  assert.deepEqual(
    getAtomicCourtIds(courtTree(), 1),
    [5, 6, 7, 8, 9, 10, 11, 12, 13]
  );
});

test('reserving a subcourt locks only that atomic court, not its siblings', () => {
  // Spec: "Reservar una subcancha bloquea la grande, pero no sus hermanas."
  assert.deepEqual(getAtomicCourtIds(courtTree(), 5), [5]);
});

test('reserving an intermediate court locks its own descendants only', () => {
  // Spec: reserving a soccer_8 blocks its three soccer_5 children (5,6,7)
  // but not the independent soccer_5 courts under the other soccer_8 groups.
  assert.deepEqual(getAtomicCourtIds(courtTree(), 2), [5, 6, 7]);
});

test('compaction keeps filling the already-open parent group', () => {
  const courts = courtTree();

  assert.deepEqual(
    findCompactionAlternatives(courts, new Set([5]), 8),
    [6, 7]
  );

  assert.deepEqual(
    findCompactionAlternatives(courts, new Set([5]), 6),
    []
  );
});

test('compaction allows opening another group once the first one is full', () => {
  assert.deepEqual(
    findCompactionAlternatives(courtTree(), new Set([5, 6, 7]), 8),
    []
  );
});

test('automatic partitioning creates direct children only and leaves them non-partitionable', async () => {
  const insertValues: unknown[][] = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql.includes('INSERT INTO courts')) {
        insertValues.push(values ?? []);
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  await createChildCourts(client as never, court(1, null, 'soccer_11') as never, 1, true, {
    id: 1,
    source_format: 'soccer_11',
    target_format: 'soccer_8',
    target_sport_id: null,
    child_count: 3,
    layout_json: [
      { x: 0, y: 0, width: 0.333333, height: 1 },
      { x: 0.333333, y: 0, width: 0.333334, height: 1 },
      { x: 0.666667, y: 0, width: 0.333333, height: 1 },
    ],
  });

  assert.equal(insertValues.length, 3);
  assert.deepEqual(insertValues.map((values) => values[6]), [false, false, false]);
});

test('saving a partitionable child updates it without creating new children', async () => {
  const queries: string[] = [];
  const pool = {
    query: async (sql: string) => {
      queries.push(sql);
      return { rowCount: 1, rows: [court(2, 1, 'soccer_8')] };
    },
  };
  const response = {
    status: () => response,
    json: () => response,
  };

  await putHandler({
    params: { tableName: 'courts' },
    query: { id: '2' },
    body: {
      company_id: 1,
      name: 'Court 2',
      sport_id: 1,
      format: 'soccer_8',
      is_partitionable: 'true',
    },
  } as never, response as never, pool as never);

  assert.equal(queries.filter((query) => query.includes('UPDATE courts')).length, 1);
  assert.equal(queries.some((query) => query.includes('INSERT INTO courts')), false);
});

test('only the explicit partition action creates children for an existing court', async () => {
  const inserted: unknown[][] = [];
  const parent = { ...court(2, 1, 'soccer_8'), is_partitionable: true };
  const rule = {
    id: 5,
    source_format: 'soccer_8',
    target_format: 'soccer_5',
    target_sport_id: null,
    child_count: 3,
    layout_json: [
      { x: 0, y: 0, width: 0.333333, height: 1 },
      { x: 0.333333, y: 0, width: 0.333334, height: 1 },
      { x: 0.666667, y: 0, width: 0.333333, height: 1 },
    ],
  };
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql.includes('FROM auth.user_companies')) return { rowCount: 1, rows: [{ role: 'manager' }] };
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.includes('FROM courts') && sql.includes('FOR UPDATE')) return { rowCount: 1, rows: [parent] };
      if (sql.includes('INSERT INTO courts')) {
        inserted.push(values ?? []);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('parent_court_id')) return { rowCount: 0, rows: [] };
      if (sql.includes('FROM court_partition_rules')) return { rowCount: 1, rows: [rule] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release: () => undefined,
  };
  const pool = {
    connect: async () => client,
    query: async () => ({ rowCount: 1, rows: [parent] }),
  };
  let status = 0;
  const response = {
    status: (value: number) => {
      status = value;
      return response;
    },
    json: () => response,
  };

  await applyCourtPartitionRule(pool as never)({
    params: { companyId: '1', courtId: '2' },
    body: { partition_rule_id: 5 },
    user: { id: 10, role: 'editor' },
  } as never, response as never);

  assert.equal(status, 201);
  assert.equal(inserted.length, 3);
});

test('company search is server-side and is not limited to the first page', () => {
  const query = buildListQuery(
    'SELECT * FROM companies',
    { page: '1', search: 'Club 37' } as never,
    structure.tables.companies.columns,
    'id'
  );

  assert.match(query.dataQuery, /ILIKE/);
  assert.ok(query.dataValues.slice(0, -2).every((value) => value === '%Club 37%'));
});

test('company-scoped lists reserve one query parameter for the company array', () => {
  const query = buildListQuery(
    'SELECT * FROM courts',
    { page: '1' } as never,
    structure.tables.courts.columns,
    'id',
    { condition: '"company_id" = ANY($1::bigint[])', values: [[1, 4]] }
  );

  assert.match(query.dataQuery, /LIMIT \$2/);
  assert.deepEqual(query.dataValues, [[1, 4], 20, 0]);
});

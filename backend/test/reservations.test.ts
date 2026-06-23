import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  findCompactionAlternatives,
  getAtomicCourtIds,
  normalizeLayout,
} from '../src/reservations';

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

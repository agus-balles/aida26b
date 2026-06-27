import { afterEach, expect, test } from 'vitest';
import { structure } from '@shared/ssot/structure';
import type { ColumnDef } from '@shared/types/types';
import { validateField } from '@shared/validation/validate';

const companyIdColumn = structure.tables.company_sports.columns.company_id as ColumnDef;
const sportIdColumn = structure.tables.company_sports.columns.sport_id as ColumnDef;

afterEach(() => {
  delete companyIdColumn.options;
  delete sportIdColumn.options;
});

test('numeric select values validate against options loaded as strings', () => {
  companyIdColumn.options = [{ value: '1', label: { es: 'Palmeras', en: 'Palmeras' } }];
  sportIdColumn.options = [{ value: '2', label: { es: 'Padel', en: 'Padel' } }];

  expect(validateField('company_sports', 'company_id', 1)).toBeUndefined();
  expect(validateField('company_sports', 'sport_id', 2)).toBeUndefined();
});

test('court forms place sport before the dependent format', () => {
  const fields = Object.keys(structure.tables.courts.columns);

  expect(fields.indexOf('sport_id')).toBeLessThan(fields.indexOf('format'));
});

test('court sport format dependencies come from the SSOT format catalog', () => {
  const formatValues = new Set(
    structure.tables.courts.columns.format.options?.map((option) => option.value)
  );

  Object.values(structure.courtFormatsBySport).flat().forEach((format) => {
    expect(formatValues.has(format)).toBe(true);
  });
});

test('partition rules use named layout templates before the derived child count', () => {
  const columns = structure.tables.court_partition_rules.columns;
  const fields = Object.keys(columns);

  expect(columns.layout_json.input).toBe('select');
  expect(columns.layout_json.label?.es).toBe('Distribución');
  expect(columns.layout_json.options?.every((option) => !option.label.es.includes('JSON'))).toBe(true);
  expect(fields.indexOf('layout_json')).toBeLessThan(fields.indexOf('child_count'));
});

test('operational court views hide internal identifiers and layout coordinates', () => {
  const columns = structure.tables.courts.columns;

  expect(structure.tables.company_sports.showInNavigation).toBe(false);
  expect(columns.id.visible).toBe(false);
  expect(columns.parent_court_id.visible).toBe(false);
  expect(columns.layout_x.visible).toBe(false);
  expect(columns.layout_y.visible).toBe(false);
  expect(columns.layout_width.visible).toBe(false);
  expect(columns.layout_height.visible).toBe(false);
});

test('partition rules use semantic priority and keep usable area internal', () => {
  const columns = structure.tables.court_partition_rules.columns;

  expect(columns.usable_area_ratio.visible).toBe(false);
  expect(columns.usable_area_ratio.editable).toBe(false);
  expect(columns.priority.options?.map((option) => option.label.es)).toEqual([
    'Baja',
    'Media',
    'Alta',
  ]);
});

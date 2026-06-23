INSERT INTO court_partition_rules
  (source_format, target_format, child_count, layout_json, usable_area_ratio, priority)
SELECT
  'soccer_11',
  'soccer_8',
  3,
  '[{"x":0,"y":0,"width":0.333333,"height":1},{"x":0.333333,"y":0,"width":0.333334,"height":1},{"x":0.666667,"y":0,"width":0.333333,"height":1}]',
  1,
  100
WHERE NOT EXISTS (
  SELECT 1
  FROM court_partition_rules
  WHERE source_format = 'soccer_11'
    AND target_format = 'soccer_8'
    AND child_count = 3
);

INSERT INTO court_partition_rules
  (source_format, target_format, child_count, layout_json, usable_area_ratio, priority)
SELECT
  'soccer_8',
  'soccer_5',
  3,
  '[{"x":0,"y":0,"width":0.333333,"height":1},{"x":0.333333,"y":0,"width":0.333334,"height":1},{"x":0.666667,"y":0,"width":0.333333,"height":1}]',
  1,
  100
WHERE NOT EXISTS (
  SELECT 1
  FROM court_partition_rules
  WHERE source_format = 'soccer_8'
    AND target_format = 'soccer_5'
    AND child_count = 3
);

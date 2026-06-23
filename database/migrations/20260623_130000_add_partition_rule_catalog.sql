ALTER TABLE court_partition_rules
  ADD COLUMN target_sport_id BIGINT REFERENCES sports(id) ON DELETE RESTRICT;

INSERT INTO sports (name, slug)
VALUES
  ('Padel', 'padel'),
  ('Tenis', 'tennis'),
  ('Basquet', 'basketball'),
  ('Voley', 'volleyball')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO court_partition_rules
  (source_format, target_format, target_sport_id, child_count, layout_json, usable_area_ratio, priority)
VALUES
  (
    'soccer_11',
    'soccer_5',
    NULL,
    6,
    '[{"x":0,"y":0,"width":0.333333,"height":0.5},{"x":0.333333,"y":0,"width":0.333334,"height":0.5},{"x":0.666667,"y":0,"width":0.333333,"height":0.5},{"x":0,"y":0.5,"width":0.333333,"height":0.5},{"x":0.333333,"y":0.5,"width":0.333334,"height":0.5},{"x":0.666667,"y":0.5,"width":0.333333,"height":0.5}]',
    1,
    90
  ),
  (
    'soccer_11',
    'soccer_7',
    NULL,
    3,
    '[{"x":0,"y":0,"width":0.333333,"height":1},{"x":0.333333,"y":0,"width":0.333334,"height":1},{"x":0.666667,"y":0,"width":0.333333,"height":1}]',
    1,
    80
  ),
  (
    'soccer_11',
    'soccer_9',
    NULL,
    2,
    '[{"x":0,"y":0,"width":0.5,"height":1},{"x":0.5,"y":0,"width":0.5,"height":1}]',
    1,
    70
  ),
  (
    'soccer_9',
    'soccer_7',
    NULL,
    2,
    '[{"x":0,"y":0,"width":0.5,"height":1},{"x":0.5,"y":0,"width":0.5,"height":1}]',
    1,
    100
  ),
  (
    'soccer_9',
    'soccer_5',
    NULL,
    3,
    '[{"x":0,"y":0,"width":0.333333,"height":1},{"x":0.333333,"y":0,"width":0.333334,"height":1},{"x":0.666667,"y":0,"width":0.333333,"height":1}]',
    1,
    90
  ),
  (
    'soccer_8',
    'soccer_6',
    NULL,
    2,
    '[{"x":0,"y":0,"width":0.5,"height":1},{"x":0.5,"y":0,"width":0.5,"height":1}]',
    1,
    90
  ),
  (
    'soccer_7',
    'soccer_5',
    NULL,
    2,
    '[{"x":0,"y":0,"width":0.5,"height":1},{"x":0.5,"y":0,"width":0.5,"height":1}]',
    1,
    100
  ),
  (
    'soccer_6',
    'soccer_5',
    NULL,
    2,
    '[{"x":0,"y":0,"width":0.5,"height":1},{"x":0.5,"y":0,"width":0.5,"height":1}]',
    1,
    100
  ),
  (
    'basketball',
    'basketball_half',
    NULL,
    2,
    '[{"x":0,"y":0,"width":0.5,"height":1},{"x":0.5,"y":0,"width":0.5,"height":1}]',
    1,
    100
  ),
  (
    'volleyball',
    'volleyball_training',
    NULL,
    2,
    '[{"x":0,"y":0,"width":0.5,"height":1},{"x":0.5,"y":0,"width":0.5,"height":1}]',
    1,
    100
  ),
  (
    'tennis',
    'padel',
    (SELECT id FROM sports WHERE slug = 'padel'),
    1,
    '[{"x":0,"y":0,"width":1,"height":1}]',
    1,
    100
  );

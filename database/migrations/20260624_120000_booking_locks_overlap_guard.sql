-- Defence-in-depth anti-overlap guard for booking_locks.
--
-- The backend already serialises holds with pg_advisory_xact_lock(root, day)
-- plus an overlap SELECT (the spec's documented fallback). This migration adds
-- the spec's *preferred* protection — a database-level exclusion constraint —
-- so overlapping locks for the same court are rejected by PostgreSQL itself.
-- That closes edge cases the advisory lock cannot cover (e.g. two holds whose
-- ranges cross the advisory-lock day boundary and therefore take different
-- advisory keys).
--
-- The whole thing is wrapped in a DO/EXCEPTION block: if the btree_gist
-- extension is unavailable, or pre-existing rows would violate the constraint,
-- the migration logs a NOTICE and continues instead of aborting start-up. The
-- advisory-lock fallback keeps protecting bookings in that case.
DO $$
BEGIN
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS btree_gist';

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_locks_no_overlap'
  ) THEN
    EXECUTE $ddl$
      ALTER TABLE booking_locks
        ADD CONSTRAINT booking_locks_no_overlap
        EXCLUDE USING gist (
          court_id WITH =,
          tstzrange(starts_at, ends_at, '[)') WITH &&
        )
    $ddl$;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping booking_locks overlap exclusion constraint: %', SQLERRM;
END
$$;

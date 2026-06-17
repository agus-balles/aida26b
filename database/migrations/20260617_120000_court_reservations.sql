CREATE TABLE companies (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    email       VARCHAR(255),
    phone       VARCHAR(80),
    address     TEXT,
    city        VARCHAR(120),
    timezone    VARCHAR(80) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name, city)
);

CREATE TABLE sports (
    id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name      VARCHAR(120) NOT NULL,
    slug      VARCHAR(80) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE company_sports (
    company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    sport_id   BIGINT NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
    PRIMARY KEY (company_id, sport_id)
);

CREATE TABLE courts (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id         BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    parent_court_id    BIGINT REFERENCES courts(id) ON DELETE CASCADE,
    root_court_id      BIGINT REFERENCES courts(id) ON DELETE CASCADE,
    name               VARCHAR(160) NOT NULL,
    format             VARCHAR(40) NOT NULL,
    sport_id           BIGINT NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
    is_partitionable   BOOLEAN NOT NULL DEFAULT false,
    is_auto_generated  BOOLEAN NOT NULL DEFAULT false,
    layout_x           NUMERIC(8,6) NOT NULL DEFAULT 0,
    layout_y           NUMERIC(8,6) NOT NULL DEFAULT 0,
    layout_width       NUMERIC(8,6) NOT NULL DEFAULT 1,
    layout_height      NUMERIC(8,6) NOT NULL DEFAULT 1,
    is_active          BOOLEAN NOT NULL DEFAULT true,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, name),
    CHECK (layout_x >= 0 AND layout_x <= 1),
    CHECK (layout_y >= 0 AND layout_y <= 1),
    CHECK (layout_width > 0 AND layout_width <= 1),
    CHECK (layout_height > 0 AND layout_height <= 1),
    CHECK (layout_x + layout_width <= 1.000001),
    CHECK (layout_y + layout_height <= 1.000001)
);

CREATE TABLE court_partition_rules (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_format     VARCHAR(40) NOT NULL,
    target_format     VARCHAR(40) NOT NULL,
    child_count       INTEGER NOT NULL CHECK (child_count > 0),
    layout_json       JSONB NOT NULL,
    usable_area_ratio NUMERIC(5,4) NOT NULL DEFAULT 1 CHECK (usable_area_ratio > 0 AND usable_area_ratio <= 1),
    priority          INTEGER NOT NULL DEFAULT 0,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    CHECK (jsonb_typeof(layout_json) = 'array')
);

CREATE TABLE court_prices (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    court_id       BIGINT NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    sport_id       BIGINT NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
    price_per_hour NUMERIC(12,2) NOT NULL CHECK (price_per_hour >= 0),
    currency       VARCHAR(3) NOT NULL DEFAULT 'ARS',
    valid_from     DATE,
    valid_to       DATE,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE TABLE company_time_blocks (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id       BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0 AND duration_minutes % 15 = 0),
    is_active        BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (company_id, duration_minutes)
);

CREATE TABLE bookings (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id         BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    court_id           BIGINT NOT NULL REFERENCES courts(id) ON DELETE RESTRICT,
    sport_id           BIGINT NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
    starts_at          TIMESTAMPTZ NOT NULL,
    ends_at            TIMESTAMPTZ NOT NULL,
    status             VARCHAR(20) NOT NULL CHECK (status IN ('held', 'confirmed', 'cancelled', 'expired')),
    customer_name      VARCHAR(160) NOT NULL,
    customer_email     VARCHAR(255),
    customer_phone     VARCHAR(80),
    price_total        NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency           VARCHAR(3) NOT NULL DEFAULT 'ARS',
    hold_expires_at    TIMESTAMPTZ,
    created_by_user_id BIGINT REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);

CREATE TABLE booking_locks (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    court_id   BIGINT NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    starts_at  TIMESTAMPTZ NOT NULL,
    ends_at    TIMESTAMPTZ NOT NULL,
    CHECK (ends_at > starts_at)
);

CREATE TABLE auth.user_companies (
    user_id    BIGINT NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    role       VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'manager', 'staff', 'viewer')),
    PRIMARY KEY (user_id, company_id)
);

CREATE INDEX idx_company_sports_sport_id ON company_sports(sport_id);
CREATE INDEX idx_courts_company_id ON courts(company_id);
CREATE INDEX idx_courts_parent_court_id ON courts(parent_court_id);
CREATE INDEX idx_courts_root_court_id ON courts(root_court_id);
CREATE INDEX idx_court_prices_court_id ON court_prices(court_id);
CREATE INDEX idx_company_time_blocks_company_id ON company_time_blocks(company_id);
CREATE INDEX idx_bookings_company_starts_at ON bookings(company_id, starts_at);
CREATE INDEX idx_bookings_status_hold_expires_at ON bookings(status, hold_expires_at);
CREATE INDEX idx_booking_locks_court_time ON booking_locks(court_id, starts_at, ends_at);
CREATE INDEX idx_user_companies_company_id ON auth.user_companies(company_id);

GRANT SELECT, UPDATE, INSERT, DELETE ON auth.user_companies TO aida26_user;

INSERT INTO sports (name, slug)
VALUES ('Futbol', 'soccer')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO court_partition_rules
  (source_format, target_format, child_count, layout_json, usable_area_ratio, priority)
VALUES
  (
    'soccer_11',
    'soccer_8',
    3,
    '[{"x":0,"y":0,"width":0.333333,"height":1},{"x":0.333333,"y":0,"width":0.333334,"height":1},{"x":0.666667,"y":0,"width":0.333333,"height":1}]',
    1,
    100
  ),
  (
    'soccer_8',
    'soccer_5',
    3,
    '[{"x":0,"y":0,"width":0.333333,"height":1},{"x":0.333333,"y":0,"width":0.333334,"height":1},{"x":0.666667,"y":0,"width":0.333333,"height":1}]',
    1,
    100
  );

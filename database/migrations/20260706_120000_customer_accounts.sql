-- Customer (end-user) accounts: players who book courts can register with an
-- email + password, see their own bookings, cancel them and make new ones.
-- These are distinct from staff accounts in auth.users; bookings made while
-- logged in are linked back via bookings.customer_id.

CREATE TABLE customers (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    name          VARCHAR(160) NOT NULL,
    phone         VARCHAR(80),
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer_sessions (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bookings
    ADD COLUMN customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX idx_customer_sessions_expires_at ON customer_sessions(expires_at);
CREATE INDEX idx_customer_sessions_token_hash ON customer_sessions(token_hash);
CREATE INDEX idx_bookings_customer_id ON bookings(customer_id);
-- Speeds up claiming past anonymous bookings by (case-insensitive) email.
CREATE INDEX idx_bookings_customer_email_lower ON bookings(lower(customer_email));

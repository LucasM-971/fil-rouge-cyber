#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v db="$POSTGRES_DB" \
  -v app_user="$APP_DB_USER" \
  -v app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE TABLE users (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL UNIQUE CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  role          text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           text PRIMARY KEY CHECK (char_length(id) = 64),
  user_id      integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE notes (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id   integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title      text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body       text NOT NULL DEFAULT '' CHECK (char_length(body) <= 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX notes_owner_created_idx ON notes (owner_id, created_at DESC);

CREATE TABLE files (
  id            uuid PRIMARY KEY,
  owner_id      integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 100),
  mime          text NOT NULL,
  size          integer NOT NULL CHECK (size > 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX files_owner_created_idx ON files (owner_id, created_at DESC);

CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO :"app_user";

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app_user";

GRANT SELECT ON users TO :"app_user";
GRANT INSERT (email, password_hash) ON users TO :"app_user";
GRANT DELETE ON users TO :"app_user";

GRANT SELECT, INSERT, DELETE ON sessions TO :"app_user";
GRANT UPDATE (last_seen_at) ON sessions TO :"app_user";

GRANT SELECT, INSERT, DELETE ON notes TO :"app_user";
GRANT UPDATE (title, body, updated_at) ON notes TO :"app_user";

GRANT SELECT, INSERT, DELETE ON files TO :"app_user";

CREATE TABLE totp_credentials (
  user_id      integer PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  secret       text NOT NULL,
  enabled      boolean NOT NULL DEFAULT false,
  last_counter bigint,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE backup_codes (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz
);
CREATE INDEX backup_codes_user_unused_idx ON backup_codes (user_id) WHERE used_at IS NULL;

CREATE TABLE mfa_challenges (
  token_hash text PRIMARY KEY CHECK (char_length(token_hash) = 64),
  user_id    integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX mfa_challenges_user_idx ON mfa_challenges (user_id);
CREATE INDEX mfa_challenges_expires_idx ON mfa_challenges (expires_at);

GRANT SELECT, INSERT, DELETE ON totp_credentials TO :"app_user";
GRANT UPDATE (secret, enabled, last_counter) ON totp_credentials TO :"app_user";

GRANT SELECT, INSERT, DELETE ON backup_codes TO :"app_user";
GRANT UPDATE (used_at) ON backup_codes TO :"app_user";

GRANT SELECT, INSERT, DELETE ON mfa_challenges TO :"app_user";

GRANT USAGE, SELECT ON SEQUENCE backup_codes_id_seq TO :"app_user";
SQL

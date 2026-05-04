-- ============================================================================
-- DallAudit V3 — Migration complète
-- psql $DATABASE_URL -f migrations/001_init.sql
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---- Utilisateurs -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'tech', -- admin | tech
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- Sites ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  address    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- Audits -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID REFERENCES sites(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'draft',  -- draft | in_progress | completed
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  plan_url    TEXT   -- URL du plan de sol uploadé
);

CREATE INDEX IF NOT EXISTS audits_created_by_idx ON audits(created_by);
CREATE INDEX IF NOT EXISTS audits_status_idx     ON audits(status);

-- ---- Observations -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS observations (
  id               UUID PRIMARY KEY,
  audit_id         UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  ref              TEXT NOT NULL,
  pathology_code   TEXT NOT NULL,
  x                DECIMAL(6,4),
  y                DECIMAL(6,4),
  severity         TEXT NOT NULL DEFAULT 'normal',  -- normal | critical
  description      TEXT NOT NULL DEFAULT '',
  quantity         DECIMAL(10,2) DEFAULT 0,
  photo_ids        TEXT[] DEFAULT '{}',
  created_by_client TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS observations_audit_id_idx  ON observations(audit_id);
CREATE INDEX IF NOT EXISTS observations_updated_at_idx ON observations(updated_at);

-- ---- Trigger updated_at automatique ----------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.updated_at IS NULL OR NEW.updated_at <= OLD.updated_at THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS observations_touch_updated_at ON observations;
CREATE TRIGGER observations_touch_updated_at
  BEFORE UPDATE ON observations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS audits_touch_updated_at ON audits;
CREATE TRIGGER audits_touch_updated_at
  BEFORE UPDATE ON audits
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---- Photos -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photos (
  id             TEXT PRIMARY KEY,
  observation_id UUID NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  bytes          INTEGER NOT NULL,
  sha256         TEXT NOT NULL,
  mime_type      TEXT NOT NULL DEFAULT 'image/jpeg',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS photos_observation_id_idx ON photos(observation_id);
CREATE INDEX IF NOT EXISTS photos_created_at_idx     ON photos(created_at);

-- ---- Audit de mutations (déduplication sync) --------------------------------
CREATE TABLE IF NOT EXISTS applied_mutations (
  id                 BIGSERIAL PRIMARY KEY,
  client_id          TEXT NOT NULL,
  client_mutation_id TEXT NOT NULL,
  op                 TEXT NOT NULL,
  obs_id             TEXT NOT NULL,
  applied_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  status             TEXT NOT NULL,  -- applied | conflict | error | noop
  UNIQUE (client_id, client_mutation_id)
);

CREATE INDEX IF NOT EXISTS applied_mutations_obs_idx ON applied_mutations(obs_id);

-- ---- Données initiales ------------------------------------------------------
-- Utilisateur admin par défaut (mot de passe: Admin123!)
-- Hash généré avec bcrypt rounds=10 pour 'Admin123!'
INSERT INTO users (email, password_hash, name, role)
VALUES (
  'admin@dallaudit.fr',
  '$2b$10$K7R9Y5X3mN8vQ2pL4hU6IOGzJwKc1dEsMfR0tBnAoHiPsSl9Vexyu',
  'Administrateur',
  'admin'
) ON CONFLICT (email) DO NOTHING;

-- Site de démonstration
INSERT INTO sites (id, name, address)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Entrepôt Logistique Lyon-Nord',
  '12 rue des Carriers, 69400 Villefranche-sur-Saône'
) ON CONFLICT DO NOTHING;

-- Audit de démonstration
INSERT INTO audits (id, site_id, title, description, status)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'Audit Dalle Zone A — 2024',
  'Contrôle périodique dalle béton zone stockage A',
  'in_progress'
) ON CONFLICT DO NOTHING;

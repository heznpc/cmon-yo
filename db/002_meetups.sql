CREATE TABLE IF NOT EXISTS meetups (
  id uuid PRIMARY KEY,
  host_id uuid REFERENCES auth_user(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description text NOT NULL CHECK (length(description) <= 2000),
  sport text NOT NULL CHECK (sport IN ('walking','running','cycling')),
  place_id text NOT NULL,
  place_name text NOT NULL,
  region_code text NOT NULL CHECK (region_code ~ '^[0-9]{5}$'),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  capacity integer NOT NULL CHECK (capacity BETWEEN 2 AND 100),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE INDEX IF NOT EXISTS meetups_browse ON meetups (starts_at, id);
CREATE INDEX IF NOT EXISTS meetups_host ON meetups (host_id, starts_at);
CREATE TABLE IF NOT EXISTS participations (
  meetup_id uuid NOT NULL REFERENCES meetups(id),
  user_id uuid NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('joined','cancelled')),
  PRIMARY KEY (meetup_id, user_id)
);
CREATE INDEX IF NOT EXISTS participations_user ON participations (user_id, meetup_id);
CREATE TABLE IF NOT EXISTS meetup_commands (
  user_id uuid NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  fingerprint text NOT NULL,
  meetup_id uuid NOT NULL REFERENCES meetups(id),
  PRIMARY KEY(user_id, command_id)
);
-- Account deletion cancels hosted meetings and invalidates prior versions.
-- Rows are locked in UUID order, matching the mutation lock boundary.
CREATE OR REPLACE FUNCTION cancel_deleted_account_meetups() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM meetups WHERE host_id = OLD.id OR id IN
    (SELECT meetup_id FROM participations WHERE user_id = OLD.id AND status = 'joined') ORDER BY id FOR UPDATE;
  UPDATE meetups SET status = CASE WHEN host_id = OLD.id THEN 'cancelled' ELSE status END,
    version = version + 1 WHERE host_id = OLD.id OR id IN
    (SELECT meetup_id FROM participations WHERE user_id = OLD.id AND status = 'joined');
  RETURN OLD;
END $$;
CREATE OR REPLACE TRIGGER account_meetup_cleanup BEFORE DELETE ON auth_user
  FOR EACH ROW EXECUTE FUNCTION cancel_deleted_account_meetups();

-- Keep existing rows while allowing any standard regional code.
ALTER TABLE meetups DROP CONSTRAINT IF EXISTS meetups_region_code_check;
ALTER TABLE meetups ADD CONSTRAINT meetups_region_code_check CHECK (region_code ~ '^[0-9]{5}$');

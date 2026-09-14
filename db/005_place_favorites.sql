CREATE TABLE IF NOT EXISTS place_favorites (
  user_id uuid NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  place_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, place_id)
);
CREATE INDEX IF NOT EXISTS place_favorites_user_created
  ON place_favorites (user_id, created_at, place_id);

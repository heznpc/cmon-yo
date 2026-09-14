CREATE TABLE IF NOT EXISTS places (
  source text NOT NULL CHECK (source = 'data.go.kr/15012890'),
  source_key text NOT NULL CHECK (source_key ~ '^46840-[0-9]{5}$'),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, source_key),
  CHECK (document->>'id' = 'park-' || source_key),
  CHECK ((document->>'latitude')::double precision BETWEEN -90 AND 90),
  CHECK ((document->>'longitude')::double precision BETWEEN -180 AND 180)
);
CREATE TABLE IF NOT EXISTS facility_import_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  report jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS place_favorites (
  -- Better Auth owns auth_user and is migrated separately. Keeping this key
  -- without a cross-migration FK lets facility-only imports run in isolation.
  user_id uuid NOT NULL,
  place_id text NOT NULL CHECK (place_id ~ '^park-46840-[0-9]{5}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, place_id)
);
CREATE INDEX IF NOT EXISTS place_favorites_user_created ON place_favorites(user_id, created_at, place_id);

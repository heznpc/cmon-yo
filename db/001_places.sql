CREATE TABLE IF NOT EXISTS places (
  source text NOT NULL CHECK (source = 'data.go.kr/15012890'),
  source_key text NOT NULL CHECK (source_key ~ '^[0-9]{5}-[0-9]{5}$'),
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

-- Keep existing rows while allowing any standard regional code.
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_source_key_check;
ALTER TABLE places ADD CONSTRAINT places_source_key_check CHECK (source_key ~ '^[0-9]{5}-[0-9]{5}$');

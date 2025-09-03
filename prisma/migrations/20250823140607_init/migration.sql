-- Daily metrics table aligned with API usage:
-- - 'target' (not 'targetRevenue')
-- - numeric fields nullable (your API often sends nulls)
-- - auto-update 'updatedAt' on UPDATE
-- - occupancy stored as % (0..100), but nullable

CREATE TABLE IF NOT EXISTS "DailyMetric" (
  "id"        SERIAL PRIMARY KEY,
  "date"      TIMESTAMP(3) NOT NULL,
  "revenue"   INTEGER,
  "target"    INTEGER,
  "occupancy" DOUBLE PRECISION,
  "arr"       INTEGER,
  "notes"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyMetric_occupancy_range_chk"
    CHECK ("occupancy" IS NULL OR ("occupancy" >= 0 AND "occupancy" <= 100))
);

-- One row per calendar day
CREATE UNIQUE INDEX IF NOT EXISTS "DailyMetric_date_key" ON "DailyMetric" ("date");

-- Keep updatedAt current on each update (Postgres)
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "DailyMetric_set_updated_at" ON "DailyMetric";
CREATE TRIGGER "DailyMetric_set_updated_at"
BEFORE UPDATE ON "DailyMetric"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- CreateTable
CREATE TABLE "RoomTypeMetric" (
  "id"        SERIAL PRIMARY KEY,
  "date"      TIMESTAMP(3) NOT NULL,
  "type"      TEXT NOT NULL,
  "rooms"     INTEGER,
  "available" INTEGER,
  "sold"      INTEGER,
  "revenue"   INTEGER,           -- consider BIGINT if storing cents
  "rate"      INTEGER,           -- consider DOUBLE PRECISION if fractional
  "occupancy" DOUBLE PRECISION,  -- percent 0..100
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoomTypeMetric_occupancy_range_chk"
    CHECK ("occupancy" IS NULL OR ("occupancy" >= 0 AND "occupancy" <= 100))
);

-- Indexes
CREATE INDEX "RoomTypeMetric_date_idx" ON "RoomTypeMetric" ("date");
CREATE UNIQUE INDEX "RoomTypeMetric_date_type_key" ON "RoomTypeMetric" ("date", "type");

-- (Remove this; a unique index on DailyMetric(date) already exists and doubles as an index)
-- DROP INDEX IF EXISTS "DailyMetric_date_idx";

-- Keep updatedAt current on UPDATE (Postgres)
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "RoomTypeMetric_set_updated_at" ON "RoomTypeMetric";
CREATE TRIGGER "RoomTypeMetric_set_updated_at"
BEFORE UPDATE ON "RoomTypeMetric"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

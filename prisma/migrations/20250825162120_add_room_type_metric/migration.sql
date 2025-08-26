-- CreateTable
CREATE TABLE "RoomTypeMetric" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "rooms" INTEGER,
    "available" INTEGER,
    "sold" INTEGER,
    "revenue" INTEGER,
    "rate" INTEGER,
    "occupancy" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomTypeMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoomTypeMetric_date_idx" ON "RoomTypeMetric"("date");

-- CreateIndex
CREATE UNIQUE INDEX "RoomTypeMetric_date_type_key" ON "RoomTypeMetric"("date", "type");

-- CreateIndex
CREATE INDEX "DailyMetric_date_idx" ON "DailyMetric"("date");

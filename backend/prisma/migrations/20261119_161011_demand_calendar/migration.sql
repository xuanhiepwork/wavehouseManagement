-- CreateEnum
CREATE TYPE "DemandDayType" AS ENUM ('WEEKDAY', 'WEEKEND', 'HOLIDAY');

-- CreateTable
CREATE TABLE "demand_calendar_overrides" (
    "business_date" DATE NOT NULL,
    "day_type" "DemandDayType" NOT NULL,
    "note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demand_calendar_overrides_pkey" PRIMARY KEY ("business_date")
);

-- D.5 additive, nullable device-reported capture metadata for evidence attachments.
-- Do NOT interpret these fields as authenticated GPS or trusted shutter time.
-- Requires migration 20261128000000_evidence_attachments to have been applied first.
ALTER TABLE "evidence_attachments"
  ADD COLUMN "device_captured_at" TIMESTAMPTZ(6),
  ADD COLUMN "location_read_at" TIMESTAMPTZ(6),
  ADD COLUMN "gps_latitude" DECIMAL(9,6),
  ADD COLUMN "gps_longitude" DECIMAL(9,6),
  ADD COLUMN "gps_accuracy_meters" DECIMAL(9,2),
  ADD COLUMN "location_address" VARCHAR(500);

ALTER TABLE "evidence_attachments"
  ADD CONSTRAINT "evidence_attachments_gps_pair_check"
    CHECK (("gps_latitude" IS NULL) = ("gps_longitude" IS NULL)),
  ADD CONSTRAINT "evidence_attachments_gps_range_check"
    CHECK (("gps_latitude" IS NULL OR "gps_latitude" BETWEEN -90 AND 90)
       AND ("gps_longitude" IS NULL OR "gps_longitude" BETWEEN -180 AND 180)
       AND ("gps_accuracy_meters" IS NULL OR "gps_accuracy_meters" BETWEEN 0 AND 100000)),
  ADD CONSTRAINT "evidence_attachments_capture_context_check"
    CHECK (
      ("device_captured_at" IS NULL AND "gps_latitude" IS NULL AND "gps_longitude" IS NULL
       AND "location_read_at" IS NULL AND "gps_accuracy_meters" IS NULL AND "location_address" IS NULL)
      OR
      ("device_captured_at" IS NOT NULL AND "gps_latitude" IS NOT NULL
       AND "gps_longitude" IS NOT NULL AND "location_read_at" IS NOT NULL)
    ),
  ADD CONSTRAINT "evidence_attachments_capture_freshness_check"
    CHECK ("location_read_at" IS NULL OR
       ("location_read_at" >= "device_captured_at" - INTERVAL '30 seconds'
        AND "location_read_at" <= "device_captured_at" + INTERVAL '5 seconds'));

-- W7.2 only. No historical transfer is marked physically received.
BEGIN;

CREATE TYPE "TransferReceiptStatus" AS ENUM ('DRAFT', 'CONFIRMED');

ALTER TABLE "branches" ADD COLUMN "receiving_revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "branches" ADD COLUMN "inventory_revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "shift_stock_counts" ADD COLUMN "submitted_receiving_revision" INTEGER;
ALTER TABLE "shift_stock_counts" ADD COLUMN "submitted_inventory_revision" INTEGER;
-- Existing SUBMITTED counts intentionally have no receiving snapshot and must be resubmitted.

-- Deploy with all old application writers stopped. This only classifies existing
-- posted transfers; it does NOT assert delivery, create receipts or move stock.
ALTER TABLE "stock_documents" ADD COLUMN "legacy_receiving_required" BOOLEAN NOT NULL DEFAULT false;
UPDATE "stock_documents" SET "legacy_receiving_required" = true
WHERE "type" = 'TRANSFER' AND "status" = 'POSTED';
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_legacy_receiving_check"
    CHECK (NOT "legacy_receiving_required" OR ("type" = 'TRANSFER' AND "status" = 'POSTED'));

CREATE TABLE "transfer_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stock_document_id" UUID NOT NULL,
    "status" "TransferReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "note" VARCHAR(500),
    "created_by_id" UUID NOT NULL,
    "received_by_id" UUID,
    "confirmed_at" TIMESTAMPTZ(6),
    "physical_received_at" TIMESTAMPTZ(6),
    "legacy_evidence" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transfer_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transfer_receipts_version_check" CHECK ("version" > 0),
    CONSTRAINT "transfer_receipts_legacy_evidence_check" CHECK (
        ("physical_received_at" IS NULL AND "legacy_evidence" IS NULL)
        OR ("physical_received_at" IS NOT NULL AND "legacy_evidence" IS NOT NULL
            AND length(btrim("legacy_evidence")) > 0
            AND ("confirmed_at" IS NULL OR "physical_received_at" <= "confirmed_at"))
    ),
    CONSTRAINT "transfer_receipts_confirmation_check" CHECK (
        ("status" = 'DRAFT' AND "received_by_id" IS NULL AND "confirmed_at" IS NULL)
        OR ("status" = 'CONFIRMED' AND "received_by_id" IS NOT NULL AND "confirmed_at" IS NOT NULL)
    )
);

CREATE TABLE "transfer_receipt_items" (
    "receipt_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "ingredient_code" VARCHAR(64) NOT NULL,
    "ingredient_name" VARCHAR(200) NOT NULL,
    "unit" "BaseUnit" NOT NULL,
    "planned_quantity" DECIMAL(18,6) NOT NULL,
    "received_quantity" DECIMAL(18,6) NOT NULL,
    "damaged_quantity" DECIMAL(18,6) NOT NULL,
    "discrepancy_reason" VARCHAR(300),
    CONSTRAINT "transfer_receipt_items_pkey" PRIMARY KEY ("receipt_id", "ingredient_id"),
    CONSTRAINT "transfer_receipt_items_quantities_check" CHECK (
        "planned_quantity" > 0 AND "planned_quantity" <> 'NaN'::numeric
        AND "received_quantity" >= 0 AND "received_quantity" <> 'NaN'::numeric
        AND "damaged_quantity" >= 0 AND "damaged_quantity" <> 'NaN'::numeric
        AND "damaged_quantity" <= "received_quantity"
    ),
    CONSTRAINT "transfer_receipt_items_piece_check" CHECK (
        "unit" <> 'piece' OR (
            "received_quantity" = trunc("received_quantity")
            AND "damaged_quantity" = trunc("damaged_quantity")
        )
    ),
    CONSTRAINT "transfer_receipt_items_reason_check" CHECK (
        ("received_quantity" = "planned_quantity" AND "damaged_quantity" = 0)
        OR length(btrim(COALESCE("discrepancy_reason", ''))) > 0
    )
);

CREATE UNIQUE INDEX "transfer_receipts_stock_document_id_key" ON "transfer_receipts"("stock_document_id");
CREATE INDEX "transfer_receipts_status_updated_at_idx" ON "transfer_receipts"("status", "updated_at");
CREATE INDEX "transfer_receipts_created_by_id_idx" ON "transfer_receipts"("created_by_id");
CREATE INDEX "transfer_receipts_received_by_id_idx" ON "transfer_receipts"("received_by_id");
CREATE INDEX "transfer_receipt_items_ingredient_id_idx" ON "transfer_receipt_items"("ingredient_id");

ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_stock_document_id_fkey"
    FOREIGN KEY ("stock_document_id") REFERENCES "stock_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_received_by_id_fkey"
    FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "transfer_receipt_items" ADD CONSTRAINT "transfer_receipt_items_receipt_id_fkey"
    FOREIGN KEY ("receipt_id") REFERENCES "transfer_receipts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "transfer_receipt_items" ADD CONSTRAINT "transfer_receipt_items_ingredient_id_fkey"
    FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;

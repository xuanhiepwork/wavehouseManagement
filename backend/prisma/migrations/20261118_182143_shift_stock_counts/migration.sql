-- CreateEnum
CREATE TYPE "WorkShift" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

-- CreateEnum
CREATE TYPE "ShiftStockCountStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED');

-- CreateTable
CREATE TABLE "shift_stock_counts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "shift" "WorkShift" NOT NULL,
    "status" "ShiftStockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "note" VARCHAR(500),
    "return_reason" VARCHAR(500),
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_stock_count_items" (
    "count_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "counted_quantity" DECIMAL(18,6) NOT NULL,
    "expected_quantity" DECIMAL(18,6),
    "variance" DECIMAL(18,6),

    CONSTRAINT "shift_stock_count_items_pkey" PRIMARY KEY ("count_id","ingredient_id")
);

-- CreateIndex
CREATE INDEX "shift_stock_counts_branch_id_status_business_date_idx" ON "shift_stock_counts"("branch_id", "status", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "shift_stock_counts_branch_id_business_date_shift_key" ON "shift_stock_counts"("branch_id", "business_date", "shift");

-- CreateIndex
CREATE INDEX "shift_stock_count_items_ingredient_id_idx" ON "shift_stock_count_items"("ingredient_id");

-- AddForeignKey
ALTER TABLE "shift_stock_counts" ADD CONSTRAINT "shift_stock_counts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shift_stock_counts" ADD CONSTRAINT "shift_stock_counts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shift_stock_counts" ADD CONSTRAINT "shift_stock_counts_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shift_stock_count_items" ADD CONSTRAINT "shift_stock_count_items_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "shift_stock_counts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shift_stock_count_items" ADD CONSTRAINT "shift_stock_count_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- B6: Manual end-of-shift stock count integrity

ALTER TABLE "shift_stock_count_items"
ADD CONSTRAINT "shift_stock_count_quantity_nonnegative"
CHECK (
    "counted_quantity" >= 0
    AND ("expected_quantity" IS NULL OR "expected_quantity" >= 0)
);

ALTER TABLE "shift_stock_counts"
ADD CONSTRAINT "shift_stock_count_state_valid"
CHECK (
    (
        "status" IN ('DRAFT', 'RETURNED')
        AND "submitted_at" IS NULL
        AND "approved_at" IS NULL
        AND "approved_by_id" IS NULL
    )
    OR
    (
        "status" = 'SUBMITTED'
        AND "submitted_at" IS NOT NULL
        AND "approved_at" IS NULL
        AND "approved_by_id" IS NULL
    )
    OR
    (
        "status" = 'APPROVED'
        AND "submitted_at" IS NOT NULL
        AND "approved_at" IS NOT NULL
        AND "approved_by_id" IS NOT NULL
    )
);

-- Prevent overlapping unfinished counts for one branch.
CREATE UNIQUE INDEX "shift_stock_count_one_open_per_branch_idx"
ON "shift_stock_counts" ("branch_id")
WHERE "status" IN ('DRAFT', 'SUBMITTED', 'RETURNED');

-- CreateEnum
CREATE TYPE "InventoryMovementKind" AS ENUM ('OPENING', 'RECEIPT', 'ISSUE', 'TRANSFER_IN', 'TRANSFER_OUT', 'COUNT_ADJUSTMENT', 'RECIPE_CONSUMPTION');

-- CreateTable
CREATE TABLE "inventory_balances" (
    "branch_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "quantity" DECIMAL(18, 6) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("branch_id", "ingredient_id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid (),
    "branch_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "kind" "InventoryMovementKind" NOT NULL,
    "source_id" UUID NOT NULL,
    "delta" DECIMAL(18, 6) NOT NULL,
    "quantity_after" DECIMAL(18, 6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_balances_ingredient_id_idx" ON "inventory_balances" ("ingredient_id");

-- CreateIndex
CREATE INDEX "inventory_movements_branch_id_ingredient_id_created_at_idx" ON "inventory_movements" (
    "branch_id",
    "ingredient_id",
    "created_at"
);

-- CreateIndex
CREATE INDEX "inventory_movements_actor_id_idx" ON "inventory_movements" ("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_kind_source_id_branch_id_ingredient_id_key" ON "inventory_movements" (
    "kind",
    "source_id",
    "branch_id",
    "ingredient_id"
);

-- AddForeignKey
ALTER TABLE "inventory_balances"
ADD CONSTRAINT "inventory_balances_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_balances"
ADD CONSTRAINT "inventory_balances_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_movements"
ADD CONSTRAINT "inventory_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_movements"
ADD CONSTRAINT "inventory_movements_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_movements"
ADD CONSTRAINT "inventory_movements_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- B3: Inventory data integrity constraints

ALTER TABLE "inventory_balances"
ADD CONSTRAINT "inventory_balance_nonnegative" CHECK ("quantity" >= 0);

ALTER TABLE "inventory_movements"
ADD CONSTRAINT "inventory_movement_nonzero" CHECK ("delta" <> 0);

ALTER TABLE "inventory_movements"
ADD CONSTRAINT "inventory_movement_after_nonnegative" CHECK ("quantity_after" >= 0);

-- B4: Receipt item integrity constraints

ALTER TABLE "goods_receipt_items"
ADD CONSTRAINT "goods_receipt_item_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "goods_receipt_items"
ADD CONSTRAINT "goods_receipt_item_unit_cost_nonnegative" CHECK ("unit_cost" >= 0);

-- B5: Stock document integrity constraints

ALTER TABLE "stock_document_items"
ADD CONSTRAINT "stock_document_item_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "stock_documents"
ADD CONSTRAINT "stock_document_branch_shape" CHECK (
    (
        "type" = 'ISSUE'
        AND "destination_branch_id" IS NULL
    )
    OR (
        "type" = 'TRANSFER'
        AND "destination_branch_id" IS NOT NULL
        AND "destination_branch_id" <> "source_branch_id"
    )
);

-- B5: Stock document integrity constraints

ALTER TABLE "stock_document_items"
ADD CONSTRAINT "stock_document_item_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "stock_documents"
ADD CONSTRAINT "stock_document_branch_shape" CHECK (
    (
        "type" = 'ISSUE'
        AND "destination_branch_id" IS NULL
    )
    OR (
        "type" = 'TRANSFER'
        AND "destination_branch_id" IS NOT NULL
        AND "destination_branch_id" <> "source_branch_id"
    )
);

ALTER TABLE "stock_documents"
ADD CONSTRAINT "stock_document_post_state" CHECK (
    (
        "status" = 'POSTED'
        AND "posted_by_id" IS NOT NULL
        AND "posted_at" IS NOT NULL
    )
    OR (
        "status" <> 'POSTED'
        AND "posted_by_id" IS NULL
        AND "posted_at" IS NULL
    )
);

-- B5: Stock document integrity constraints

ALTER TABLE "stock_document_items"
ADD CONSTRAINT "stock_document_item_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "stock_documents"
ADD CONSTRAINT "stock_document_branch_shape" CHECK (
    (
        "type" = 'ISSUE'
        AND "destination_branch_id" IS NULL
    )
    OR (
        "type" = 'TRANSFER'
        AND "destination_branch_id" IS NOT NULL
        AND "destination_branch_id" <> "source_branch_id"
    )
);

ALTER TABLE "stock_documents"
ADD CONSTRAINT "stock_document_post_state" CHECK (
    (
        "status" = 'POSTED'
        AND "posted_by_id" IS NOT NULL
        AND "posted_at" IS NOT NULL
    )
    OR (
        "status" <> 'POSTED'
        AND "posted_by_id" IS NULL
        AND "posted_at" IS NULL
    )
);
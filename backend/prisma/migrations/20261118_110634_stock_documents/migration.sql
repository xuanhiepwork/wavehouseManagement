-- CreateEnum
CREATE TYPE "StockDocumentType" AS ENUM ('ISSUE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "StockDocumentStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "stock_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "type" "StockDocumentType" NOT NULL,
    "status" "StockDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "source_branch_id" UUID NOT NULL,
    "destination_branch_id" UUID,
    "note" VARCHAR(500),
    "created_by_id" UUID NOT NULL,
    "posted_by_id" UUID,
    "posted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_document_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "stock_document_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_documents_code_key" ON "stock_documents"("code");

-- CreateIndex
CREATE INDEX "stock_documents_type_source_branch_id_status_created_at_idx" ON "stock_documents"("type", "source_branch_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "stock_documents_destination_branch_id_status_created_at_idx" ON "stock_documents"("destination_branch_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "stock_document_items_ingredient_id_idx" ON "stock_document_items"("ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_document_items_document_id_ingredient_id_key" ON "stock_document_items"("document_id", "ingredient_id");

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_source_branch_id_fkey" FOREIGN KEY ("source_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_destination_branch_id_fkey" FOREIGN KEY ("destination_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_document_items" ADD CONSTRAINT "stock_document_items_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "stock_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_document_items" ADD CONSTRAINT "stock_document_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- B5: Stock document integrity constraints

ALTER TABLE "stock_document_items"
ADD CONSTRAINT "stock_document_item_quantity_positive"
CHECK ("quantity" > 0);

ALTER TABLE "stock_documents"
ADD CONSTRAINT "stock_document_branch_shape"
CHECK (
    ("type" = 'ISSUE' AND "destination_branch_id" IS NULL)
    OR
    (
        "type" = 'TRANSFER'
        AND "destination_branch_id" IS NOT NULL
        AND "destination_branch_id" <> "source_branch_id"
    )
);

ALTER TABLE "stock_documents"
ADD CONSTRAINT "stock_document_post_state"
CHECK (
    (
        "status" = 'POSTED'
        AND "posted_by_id" IS NOT NULL
        AND "posted_at" IS NOT NULL
    )
    OR
    (
        "status" <> 'POSTED'
        AND "posted_by_id" IS NULL
        AND "posted_at" IS NULL
    )
);

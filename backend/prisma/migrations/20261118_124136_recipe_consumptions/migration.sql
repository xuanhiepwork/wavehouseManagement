-- CreateTable
CREATE TABLE "recipe_consumptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "units" INTEGER NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_consumption_items" (
    "consumption_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "per_unit_quantity" DECIMAL(18,6) NOT NULL,
    "total_quantity" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "recipe_consumption_items_pkey" PRIMARY KEY ("consumption_id","ingredient_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recipe_consumptions_event_id_key" ON "recipe_consumptions"("event_id");

-- CreateIndex
CREATE INDEX "recipe_consumptions_branch_id_created_at_idx" ON "recipe_consumptions"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "recipe_consumptions_product_variant_id_created_at_idx" ON "recipe_consumptions"("product_variant_id", "created_at");

-- CreateIndex
CREATE INDEX "recipe_consumption_items_ingredient_id_idx" ON "recipe_consumption_items"("ingredient_id");

-- AddForeignKey
ALTER TABLE "recipe_consumptions" ADD CONSTRAINT "recipe_consumptions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "recipe_consumptions" ADD CONSTRAINT "recipe_consumptions_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "recipe_consumptions" ADD CONSTRAINT "recipe_consumptions_recipe_id_product_variant_id_fkey" FOREIGN KEY ("recipe_id", "product_variant_id") REFERENCES "recipes"("id", "product_variant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "recipe_consumptions" ADD CONSTRAINT "recipe_consumptions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "recipe_consumption_items" ADD CONSTRAINT "recipe_consumption_items_consumption_id_fkey" FOREIGN KEY ("consumption_id") REFERENCES "recipe_consumptions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "recipe_consumption_items" ADD CONSTRAINT "recipe_consumption_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- B6: Consumption integrity constraints

ALTER TABLE "recipe_consumptions"
ADD CONSTRAINT "recipe_consumption_units_positive"
CHECK ("units" BETWEEN 1 AND 1000);

ALTER TABLE "recipe_consumption_items"
ADD CONSTRAINT "recipe_consumption_per_unit_positive"
CHECK ("per_unit_quantity" > 0);

ALTER TABLE "recipe_consumption_items"
ADD CONSTRAINT "recipe_consumption_total_positive"
CHECK ("total_quantity" > 0);

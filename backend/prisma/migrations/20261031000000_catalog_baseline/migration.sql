BEGIN;

CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "BaseUnit" AS ENUM ('g', 'ml', 'piece');
CREATE TYPE "ProductSize" AS ENUM ('S', 'M', 'L');

CREATE TABLE "ingredients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "unit" "BaseUnit" NOT NULL,
    "cost_price" DECIMAL(18,4) NOT NULL,
    "min_stock" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_variants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "size" "ProductSize" NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    "active_recipe_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recipes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_variant_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recipe_ingredients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipe_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ingredients_code_key" ON "ingredients"("code");
CREATE INDEX "ingredients_category_is_active_idx" ON "ingredients"("category", "is_active");
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");
CREATE INDEX "products_category_is_available_idx" ON "products"("category", "is_available");
CREATE INDEX "product_variants_active_recipe_id_id_idx" ON "product_variants"("active_recipe_id", "id");
CREATE UNIQUE INDEX "product_variants_product_id_size_key" ON "product_variants"("product_id", "size");
CREATE UNIQUE INDEX "recipes_product_variant_id_version_key" ON "recipes"("product_variant_id", "version");
CREATE UNIQUE INDEX "recipes_id_product_variant_id_key" ON "recipes"("id", "product_variant_id");
CREATE INDEX "recipe_ingredients_ingredient_id_idx" ON "recipe_ingredients"("ingredient_id");
CREATE UNIQUE INDEX "recipe_ingredients_recipe_id_ingredient_id_key" ON "recipe_ingredients"("recipe_id", "ingredient_id");

ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_active_recipe_id_id_fkey" FOREIGN KEY ("active_recipe_id", "id") REFERENCES "recipes"("id", "product_variant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ingredients"
    ADD CONSTRAINT "ingredients_code_check" CHECK (code <> '' AND code = upper(btrim(code))),
    ADD CONSTRAINT "ingredients_name_check" CHECK (btrim(name) <> ''),
    ADD CONSTRAINT "ingredients_category_check" CHECK (btrim(category) <> ''),
    ADD CONSTRAINT "ingredients_cost_price_check" CHECK (cost_price >= 0 AND cost_price <> 'NaN'::numeric),
    ADD CONSTRAINT "ingredients_min_stock_check" CHECK (min_stock >= 0 AND min_stock <> 'NaN'::numeric);

ALTER TABLE "products"
    ADD CONSTRAINT "products_code_check" CHECK (code <> '' AND code = upper(btrim(code))),
    ADD CONSTRAINT "products_name_check" CHECK (btrim(name) <> ''),
    ADD CONSTRAINT "products_category_check" CHECK (btrim(category) <> '');

ALTER TABLE "product_variants"
    ADD CONSTRAINT "product_variants_price_check" CHECK (price >= 0 AND price <> 'NaN'::numeric);

ALTER TABLE "recipes"
    ADD CONSTRAINT "recipes_version_check" CHECK (version > 0);

ALTER TABLE "recipe_ingredients"
    ADD CONSTRAINT "recipe_ingredients_quantity_check" CHECK (quantity > 0 AND quantity <> 'NaN'::numeric);

CREATE FUNCTION public.catalog_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER ingredients_updated_at BEFORE UPDATE ON ingredients
    FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
CREATE TRIGGER product_variants_updated_at BEFORE UPDATE ON product_variants
    FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
CREATE TRIGGER recipes_updated_at BEFORE UPDATE ON recipes
    FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
CREATE TRIGGER recipe_ingredients_updated_at BEFORE UPDATE ON recipe_ingredients
    FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();

COMMIT;

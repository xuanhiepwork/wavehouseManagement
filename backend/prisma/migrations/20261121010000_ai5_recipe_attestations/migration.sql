-- AI5: Add-only provenance attestation, not a rewrite of immutable W7.3 revisions.
-- Draft migration for final QA. DO NOT execute on Aiven until separately reviewed.
-- W7.2 and W7.3 migrations MUST be reviewed and applied first.
BEGIN;
CREATE TABLE "sales_recipe_evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sales_line_id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "recipe_version" INTEGER NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "size" "ProductSize" NOT NULL,
    "ingredient_snapshot" JSONB NOT NULL,
    "recipe_created_at" TIMESTAMPTZ(6) NOT NULL,
    "attested_by_id" UUID NOT NULL,
    "attested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attestation_note" VARCHAR(500) NOT NULL,
    CONSTRAINT "sales_recipe_evidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_recipe_evidence_recipe_version_check" CHECK ("recipe_version" > 0),
    CONSTRAINT "sales_recipe_evidence_note_check" CHECK (length(btrim("attestation_note")) BETWEEN 10 AND 500),
    CONSTRAINT "sales_recipe_evidence_snapshot_check" CHECK (jsonb_typeof("ingredient_snapshot") = 'array' AND jsonb_array_length("ingredient_snapshot") BETWEEN 1 AND 500),
    CONSTRAINT "sales_recipe_evidence_sales_line_id_fkey" FOREIGN KEY ("sales_line_id") REFERENCES "sales_report_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "sales_recipe_evidence_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "sales_recipe_evidence_attested_by_id_fkey" FOREIGN KEY ("attested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "sales_recipe_evidence_sales_line_id_key" ON "sales_recipe_evidence"("sales_line_id");
CREATE INDEX "sales_recipe_evidence_attested_at_idx" ON "sales_recipe_evidence"("attested_at");
CREATE INDEX "sales_recipe_evidence_recipe_id_idx" ON "sales_recipe_evidence"("recipe_id");

-- Integrity check executes on INSERT and prevents direct SQL from claiming a
-- recipe/sale relationship that does not match the approved W7.3 line.
CREATE FUNCTION "ai5_guard_evidence_insert"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE actual_snapshot jsonb;
BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM "sales_report_lines" l
      JOIN "sales_report_revisions" v ON v."id" = l."revision_id"
      JOIN "sales_reports" r ON r."id" = v."report_id"
      JOIN "users" u ON u."id" = NEW."attested_by_id"
      JOIN "recipes" recipe ON recipe."id" = NEW."recipe_id"
      JOIN "product_variants" pv ON pv."id" = recipe."product_variant_id"
      WHERE l."id" = NEW."sales_line_id"
        AND r."status" = 'APPROVED' AND r."approved_revision_number" = v."number"
        AND r."submitted_revision_number" = v."number" AND r."current_revision_number" = v."number"
        AND l."quantity" > 0 AND l."product_id" IS NOT NULL
        AND l."size" = pv."size"::text
        AND l."product_id" = pv."product_id"
        AND NEW."recipe_version" = recipe."version"
        AND NEW."product_variant_id" = pv."id"
        AND NEW."product_id" = l."product_id"
        AND NEW."size" = pv."size"
        AND NEW."recipe_created_at" = recipe."created_at"
        AND recipe."created_at" < (r."business_date"::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND NEW."attested_by_id" <> r."submitted_by_id"
        AND u."is_active" = true AND u."role" = 'ADMIN'
    ) THEN
      RAISE EXCEPTION 'AI5 evidence requires a different active ADMIN and matching approved historical sale' USING ERRCODE = '23514';
    END IF;
    SELECT jsonb_agg(jsonb_build_object('ingredientId', ri."ingredient_id"::text, 'unit', i."unit"::text,
                         'quantity', to_char(ri."quantity", 'FM9999999999990.000000')) ORDER BY ri."ingredient_id")
      INTO actual_snapshot
      FROM "recipe_ingredients" ri JOIN "ingredients" i ON i."id" = ri."ingredient_id"
      WHERE ri."recipe_id" = NEW."recipe_id" AND ri."quantity" > 0
        AND (i."unit" <> 'piece' OR ri."quantity" = trunc(ri."quantity"));
    IF actual_snapshot IS NULL OR actual_snapshot IS DISTINCT FROM NEW."ingredient_snapshot"
       OR (SELECT count(*) FROM "recipe_ingredients" WHERE "recipe_id" = NEW."recipe_id") <> jsonb_array_length(NEW."ingredient_snapshot") THEN
       RAISE EXCEPTION 'AI5 immutable ingredient snapshot differs from the selected recipe' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER "ai5_evidence_insert_guard" BEFORE INSERT ON "sales_recipe_evidence"
    FOR EACH ROW EXECUTE FUNCTION "ai5_guard_evidence_insert"();

CREATE FUNCTION "ai5_reject_evidence_mutation"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AI5 evidence is append-only' USING ERRCODE = '55000'; END; $$;
CREATE TRIGGER "ai5_evidence_append_only" BEFORE UPDATE OR DELETE ON "sales_recipe_evidence"
    FOR EACH ROW EXECUTE FUNCTION "ai5_reject_evidence_mutation"();

COMMIT;

-- W7.3. Review only: this migration has NOT been executed.
-- No inventory, transfer, stock-count, Catalog lifecycle or historical data changes.
BEGIN;

CREATE TYPE "SalesReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED');
CREATE TYPE "SalesPaymentChannel" AS ENUM ('CASH', 'BANK_TRANSFER', 'MOMO', 'GRAB', 'OTHER');
CREATE TYPE "SalesReportEventType" AS ENUM ('CREATED', 'UPDATED', 'SUBMITTED', 'RETURNED', 'APPROVED');

CREATE TABLE "sales_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "shift" "WorkShift" NOT NULL,
    "status" "SalesReportStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "current_revision_number" INTEGER NOT NULL DEFAULT 1,
    "submitted_revision_number" INTEGER,
    "approved_revision_number" INTEGER,
    "created_by_id" UUID NOT NULL,
    "submitted_by_id" UUID,
    "reviewed_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),
    "approved_at" TIMESTAMPTZ(6),
    "return_reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_reports_version_check" CHECK ("version" > 0),
    CONSTRAINT "sales_reports_revision_numbers_check" CHECK (
        "current_revision_number" > 0
        AND ("submitted_revision_number" IS NULL OR "submitted_revision_number" BETWEEN 1 AND "current_revision_number")
        AND ("approved_revision_number" IS NULL OR "approved_revision_number" BETWEEN 1 AND "current_revision_number")
    ),
    CONSTRAINT "sales_reports_state_check" CHECK (
        ("status" <> 'SUBMITTED' OR ("submitted_revision_number" = "current_revision_number"
            AND "submitted_revision_number" IS NOT NULL AND "submitted_by_id" IS NOT NULL AND "submitted_at" IS NOT NULL))
        AND ("status" <> 'RETURNED' OR ("submitted_revision_number" IS NOT NULL
            AND "reviewed_by_id" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "return_reason" IS NOT NULL AND length(btrim("return_reason")) > 0))
        AND (("status" = 'APPROVED' AND "approved_revision_number" IS NOT NULL AND "submitted_revision_number" IS NOT NULL
            AND "approved_revision_number" = "current_revision_number" AND "submitted_revision_number" = "current_revision_number"
            AND "submitted_by_id" IS NOT NULL AND "submitted_at" IS NOT NULL AND "reviewed_by_id" IS NOT NULL
            AND "reviewed_by_id" <> "submitted_by_id" AND "reviewed_at" IS NOT NULL AND "approved_at" IS NOT NULL)
            OR ("status" <> 'APPROVED' AND "approved_revision_number" IS NULL AND "approved_at" IS NULL))
    ),
    CONSTRAINT "sales_reports_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "sales_reports_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "sales_reports_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "sales_reports_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "sales_report_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "report_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" VARCHAR(1500),
    "discounts" DECIMAL(18,0) NOT NULL,
    "recognized_refunds" DECIMAL(18,0) NOT NULL,
    "gross_sales" DECIMAL(18,0) NOT NULL,
    "net_expected" DECIMAL(18,0) NOT NULL,
    "net_recorded" DECIMAL(18,0) NOT NULL,
    "sales_difference" DECIMAL(18,0) NOT NULL,
    "expected_cash" DECIMAL(18,0) NOT NULL,
    "cash_difference" DECIMAL(18,0),
    CONSTRAINT "sales_report_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_report_revisions_number_check" CHECK ("number" > 0),
    CONSTRAINT "sales_report_revisions_amounts_check" CHECK (
        "discounts" >= 0 AND "discounts" < 1000000000000
        AND "recognized_refunds" >= 0 AND "recognized_refunds" < 1000000000000000000
        AND "gross_sales" >= 0 AND "gross_sales" < 1000000000000000000
        AND abs("net_expected") < 1000000000000000000 AND abs("net_recorded") < 1000000000000000000
        AND abs("sales_difference") < 1000000000000000000 AND abs("expected_cash") < 1000000000000000000
        AND ("cash_difference" IS NULL OR abs("cash_difference") < 1000000000000000000)
    ),
    CONSTRAINT "sales_report_revisions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "sales_reports"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "sales_report_revisions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "sales_report_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revision_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "product_id" UUID,
    "product_name_snapshot" VARCHAR(200) NOT NULL,
    "size" VARCHAR(10) NOT NULL,
    "unit_price_snapshot" DECIMAL(18,0) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" VARCHAR(240),
    CONSTRAINT "sales_report_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_report_lines_values_check" CHECK ("position" >= 0 AND "quantity" BETWEEN 0 AND 999999
        AND "unit_price_snapshot" >= 0 AND "unit_price_snapshot" < 1000000000000
        AND length(btrim("product_name_snapshot")) > 0 AND "size" IN ('S','M','L','OTHER')),
    CONSTRAINT "sales_report_lines_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "sales_report_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "sales_report_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "sales_report_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revision_id" UUID NOT NULL,
    "channel" "SalesPaymentChannel" NOT NULL,
    "collected_amount" DECIMAL(18,0) NOT NULL,
    "refunded_amount" DECIMAL(18,0) NOT NULL,
    "platform_fee" DECIMAL(18,0) NOT NULL,
    "settlement_difference" DECIMAL(18,0) NOT NULL,
    "note" VARCHAR(300),
    CONSTRAINT "sales_report_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_report_payments_amounts_check" CHECK (
        "collected_amount" >= 0 AND "collected_amount" < 1000000000000
        AND "refunded_amount" >= 0 AND "refunded_amount" < 1000000000000
        AND "platform_fee" >= 0 AND "platform_fee" < 1000000000000 AND abs("settlement_difference") < 1000000000000),
    CONSTRAINT "sales_report_payments_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "sales_report_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "sales_report_expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revision_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "channel" "SalesPaymentChannel" NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "amount" DECIMAL(18,0) NOT NULL,
    CONSTRAINT "sales_report_expenses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_report_expenses_values_check" CHECK ("position" >= 0 AND "amount" >= 0 AND "amount" < 1000000000000 AND length(btrim("description")) > 0),
    CONSTRAINT "sales_report_expenses_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "sales_report_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "sales_cash_reconciliations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revision_id" UUID NOT NULL,
    "opening_cash" DECIMAL(18,0) NOT NULL,
    "cash_handovers" DECIMAL(18,0) NOT NULL,
    "closing_cash_actual" DECIMAL(18,0),
    CONSTRAINT "sales_cash_reconciliations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_cash_reconciliations_amounts_check" CHECK (
        "opening_cash" >= 0 AND "opening_cash" < 1000000000000 AND "cash_handovers" >= 0 AND "cash_handovers" < 1000000000000
        AND ("closing_cash_actual" IS NULL OR ("closing_cash_actual" >= 0 AND "closing_cash_actual" < 1000000000000))),
    CONSTRAINT "sales_cash_reconciliations_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "sales_report_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "sales_report_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "report_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "actor_id" UUID NOT NULL,
    "type" "SalesReportEventType" NOT NULL,
    "reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_report_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_report_events_reason_check" CHECK ("revision_number" > 0 AND ("type" <> 'RETURNED' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0))),
    CONSTRAINT "sales_report_events_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "sales_reports"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "sales_report_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "sales_reports_branch_id_business_date_shift_key" ON "sales_reports"("branch_id","business_date","shift");
CREATE INDEX "sales_reports_branch_id_status_business_date_idx" ON "sales_reports"("branch_id","status","business_date");
CREATE INDEX "sales_reports_status_business_date_idx" ON "sales_reports"("status","business_date");
CREATE INDEX "sales_reports_created_by_id_idx" ON "sales_reports"("created_by_id");
CREATE INDEX "sales_reports_submitted_by_id_idx" ON "sales_reports"("submitted_by_id");
CREATE INDEX "sales_reports_reviewed_by_id_idx" ON "sales_reports"("reviewed_by_id");
CREATE UNIQUE INDEX "sales_report_revisions_report_id_number_key" ON "sales_report_revisions"("report_id","number");
CREATE INDEX "sales_report_revisions_created_by_id_idx" ON "sales_report_revisions"("created_by_id");
CREATE UNIQUE INDEX "sales_report_lines_revision_id_position_key" ON "sales_report_lines"("revision_id","position");
CREATE INDEX "sales_report_lines_product_id_idx" ON "sales_report_lines"("product_id");
CREATE UNIQUE INDEX "sales_report_payments_revision_id_channel_key" ON "sales_report_payments"("revision_id","channel");
CREATE UNIQUE INDEX "sales_report_expenses_revision_id_position_key" ON "sales_report_expenses"("revision_id","position");
CREATE UNIQUE INDEX "sales_cash_reconciliations_revision_id_key" ON "sales_cash_reconciliations"("revision_id");
CREATE INDEX "sales_report_events_report_id_created_at_idx" ON "sales_report_events"("report_id","created_at");
CREATE INDEX "sales_report_events_actor_id_idx" ON "sales_report_events"("actor_id");
ALTER TABLE "sales_report_events" ADD CONSTRAINT "sales_report_events_report_id_revision_number_fkey"
    FOREIGN KEY ("report_id","revision_number") REFERENCES "sales_report_revisions"("report_id","number") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Scalar revision pointers are checked at commit, allowing creation of the report
-- before its first revision and atomic advancement before the next snapshot insert.
CREATE FUNCTION "w7_sales_check_pointers"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE r "sales_reports"%ROWTYPE;
BEGIN
    SELECT * INTO r FROM "sales_reports" WHERE "id" = NEW."id";
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF NOT EXISTS (SELECT 1 FROM "sales_report_revisions" WHERE "report_id" = r."id" AND "number" = r."current_revision_number")
       OR (r."submitted_revision_number" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sales_report_revisions" WHERE "report_id" = r."id" AND "number" = r."submitted_revision_number"))
       OR (r."approved_revision_number" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sales_report_revisions" WHERE "report_id" = r."id" AND "number" = r."approved_revision_number")) THEN
        RAISE EXCEPTION 'Sales revision pointer does not exist' USING ERRCODE = '23503';
    END IF;
    RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER "sales_reports_revision_pointers_check" AFTER INSERT OR UPDATE ON "sales_reports"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "w7_sales_check_pointers"();

CREATE FUNCTION "w7_sales_report_transition"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Sales reports cannot be deleted' USING ERRCODE = '55000'; END IF;
    IF OLD."status" = 'APPROVED' OR NEW."version" <> OLD."version" + 1
       OR ROW(NEW."id",NEW."branch_id",NEW."business_date",NEW."shift",NEW."created_by_id",NEW."created_at")
          IS DISTINCT FROM ROW(OLD."id",OLD."branch_id",OLD."business_date",OLD."shift",OLD."created_by_id",OLD."created_at") THEN
        RAISE EXCEPTION 'Immutable sales report or invalid version' USING ERRCODE = '55000';
    END IF;
    IF NOT ((OLD."status" IN ('DRAFT','RETURNED') AND NEW."status" = OLD."status" AND NEW."current_revision_number" = OLD."current_revision_number" + 1)
        OR (OLD."status" IN ('DRAFT','RETURNED') AND NEW."status" = 'SUBMITTED' AND NEW."current_revision_number" = OLD."current_revision_number")
        OR (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('RETURNED','APPROVED') AND NEW."current_revision_number" = OLD."current_revision_number")) THEN
        RAISE EXCEPTION 'Invalid sales report transition' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER "sales_reports_transition_guard" BEFORE UPDATE OR DELETE ON "sales_reports"
    FOR EACH ROW EXECUTE FUNCTION "w7_sales_report_transition"();

CREATE FUNCTION "w7_sales_reject_snapshot_mutation"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000'; END; $$;
CREATE TRIGGER "sales_revisions_immutable" BEFORE UPDATE OR DELETE ON "sales_report_revisions" FOR EACH ROW EXECUTE FUNCTION "w7_sales_reject_snapshot_mutation"();
CREATE TRIGGER "sales_lines_immutable" BEFORE UPDATE OR DELETE ON "sales_report_lines" FOR EACH ROW EXECUTE FUNCTION "w7_sales_reject_snapshot_mutation"();
CREATE TRIGGER "sales_payments_immutable" BEFORE UPDATE OR DELETE ON "sales_report_payments" FOR EACH ROW EXECUTE FUNCTION "w7_sales_reject_snapshot_mutation"();
CREATE TRIGGER "sales_expenses_immutable" BEFORE UPDATE OR DELETE ON "sales_report_expenses" FOR EACH ROW EXECUTE FUNCTION "w7_sales_reject_snapshot_mutation"();
CREATE TRIGGER "sales_cash_immutable" BEFORE UPDATE OR DELETE ON "sales_cash_reconciliations" FOR EACH ROW EXECUTE FUNCTION "w7_sales_reject_snapshot_mutation"();
CREATE TRIGGER "sales_events_immutable" BEFORE UPDATE OR DELETE ON "sales_report_events" FOR EACH ROW EXECUTE FUNCTION "w7_sales_reject_snapshot_mutation"();

CREATE FUNCTION "w7_sales_guard_revision_insert"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "sales_reports" r WHERE r."id" = NEW."report_id"
        AND r."status" IN ('DRAFT','RETURNED') AND r."current_revision_number" = NEW."number" AND r."created_by_id" = NEW."created_by_id") THEN
        RAISE EXCEPTION 'Revision requires an editable report and matching creator' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER "sales_revisions_insert_guard" BEFORE INSERT ON "sales_report_revisions" FOR EACH ROW EXECUTE FUNCTION "w7_sales_guard_revision_insert"();

-- Seal child collections when their inserting transaction commits. This prevents
-- even INSERT from changing an already submitted (or older draft) snapshot.
CREATE FUNCTION "w7_sales_guard_detail_insert"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "sales_report_revisions" v JOIN "sales_reports" r ON r."id" = v."report_id"
        WHERE v."id" = NEW."revision_id" AND v.xmin::text::bigint = mod(txid_current(),4294967296::bigint)
        AND v."number" = r."current_revision_number" AND r."status" IN ('DRAFT','RETURNED')) THEN
        RAISE EXCEPTION 'Revision details must be inserted with their new editable snapshot' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER "sales_lines_insert_guard" BEFORE INSERT ON "sales_report_lines" FOR EACH ROW EXECUTE FUNCTION "w7_sales_guard_detail_insert"();
CREATE TRIGGER "sales_payments_insert_guard" BEFORE INSERT ON "sales_report_payments" FOR EACH ROW EXECUTE FUNCTION "w7_sales_guard_detail_insert"();
CREATE TRIGGER "sales_expenses_insert_guard" BEFORE INSERT ON "sales_report_expenses" FOR EACH ROW EXECUTE FUNCTION "w7_sales_guard_detail_insert"();
CREATE TRIGGER "sales_cash_insert_guard" BEFORE INSERT ON "sales_cash_reconciliations" FOR EACH ROW EXECUTE FUNCTION "w7_sales_guard_detail_insert"();

-- Stored totals must match the immutable child rows. This runs after nested
-- inserts, so a missing cash reconciliation also aborts the whole save.
CREATE FUNCTION "w7_sales_check_snapshot_totals"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE g NUMERIC; refunds NUMERIC; recorded NUMERIC; cash_collected NUMERIC; cash_refunded NUMERIC;
    cash_expenses NUMERIC; expected NUMERIC; c "sales_cash_reconciliations"%ROWTYPE;
BEGIN
    SELECT * INTO c FROM "sales_cash_reconciliations" WHERE "revision_id" = NEW."id";
    IF NOT FOUND THEN RAISE EXCEPTION 'Cash reconciliation is required' USING ERRCODE = '23514'; END IF;
    SELECT COALESCE(sum("quantity" * "unit_price_snapshot"),0) INTO g FROM "sales_report_lines" WHERE "revision_id" = NEW."id";
    SELECT COALESCE(sum("refunded_amount"),0), COALESCE(sum("collected_amount" - "refunded_amount"),0),
        COALESCE(sum("collected_amount") FILTER (WHERE "channel" = 'CASH'),0), COALESCE(sum("refunded_amount") FILTER (WHERE "channel" = 'CASH'),0)
        INTO refunds, recorded, cash_collected, cash_refunded FROM "sales_report_payments" WHERE "revision_id" = NEW."id";
    SELECT COALESCE(sum("amount"),0) INTO cash_expenses FROM "sales_report_expenses" WHERE "revision_id" = NEW."id" AND "channel" = 'CASH';
    expected := c."opening_cash" + cash_collected - cash_refunded - cash_expenses - c."cash_handovers";
    IF NEW."gross_sales" <> g OR NEW."recognized_refunds" <> refunds OR NEW."net_expected" <> g - NEW."discounts" - refunds
       OR NEW."net_recorded" <> recorded OR NEW."sales_difference" <> recorded - NEW."net_expected" OR NEW."expected_cash" <> expected
       OR NEW."cash_difference" IS DISTINCT FROM (c."closing_cash_actual" - expected) THEN
        RAISE EXCEPTION 'Sales revision totals do not match snapshot details' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER "sales_revisions_totals_check" AFTER INSERT ON "sales_report_revisions"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "w7_sales_check_snapshot_totals"();

COMMIT;

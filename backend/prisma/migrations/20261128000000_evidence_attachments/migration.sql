-- D2 evidence: private small-image storage, immutable audit metadata.
-- Images are never exposed via public static URLs. Deploy only after a verified Aiven backup.
CREATE TYPE "EvidenceTargetType" AS ENUM ('TRIP', 'STOP', 'COUNT');
CREATE TYPE "EvidenceKind" AS ENUM ('DELIVERY', 'RECEIVING', 'INVENTORY', 'DAMAGE');

CREATE TABLE "evidence_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "target_type" "EvidenceTargetType" NOT NULL,
    "target_id" UUID NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "note" VARCHAR(500),
    "mime_type" VARCHAR(32) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "photo_bytes" BYTEA NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evidence_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "evidence_attachments_created_by_id_fkey"
        FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "evidence_attachments_mime_check"
        CHECK ("mime_type" IN ('image/jpeg','image/png','image/webp')),
    CONSTRAINT "evidence_attachments_size_check"
        CHECK ("byte_size" > 0 AND "byte_size" <= 2097152 AND "byte_size" = octet_length("photo_bytes")),
    CONSTRAINT "evidence_attachments_sha_check"
        CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "evidence_attachments_target_kind_check"
        CHECK (("target_type" = 'TRIP' AND "kind" = 'DELIVERY') OR
               ("target_type" = 'STOP' AND "kind" IN ('RECEIVING','DAMAGE')) OR
               ("target_type" = 'COUNT' AND "kind" IN ('INVENTORY','DAMAGE')))
);
CREATE INDEX "evidence_attachments_target_created_idx"
    ON "evidence_attachments"("target_type","target_id","created_at");
CREATE UNIQUE INDEX "evidence_attachments_target_hash_key"
    ON "evidence_attachments"("target_type","target_id","sha256");
CREATE INDEX "evidence_attachments_creator_created_idx"
    ON "evidence_attachments"("created_by_id","created_at");

-- G8: stock write-off requires a different ADMIN reviewer. No balances change on submission.
-- Applies after G3, G4, G6, G7. All writes remain in the existing ledgers.
ALTER TYPE public."InventoryMovementKind" ADD VALUE IF NOT EXISTS 'WRITE_OFF';

CREATE TABLE public.stock_writeoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_key uuid NOT NULL UNIQUE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reason varchar(24) NOT NULL CHECK (reason IN ('EXPIRED','DAMAGED','SPOILAGE','LOSS','COUNT_VARIANCE')),
  evidence varchar(500) NOT NULL CHECK (char_length(trim(evidence)) >= 10),
  status varchar(16) NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','POSTED','REJECTED')),
  created_by_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reviewed_by_id uuid REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  review_note varchar(500),
  reviewed_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT stock_writeoffs_exactly_one_location CHECK ((branch_id IS NULL) <> (warehouse_id IS NULL)),
  CONSTRAINT stock_writeoffs_review_pair CHECK (
    (status='SUBMITTED' AND reviewed_by_id IS NULL AND reviewed_at IS NULL)
    OR (status<>'SUBMITTED' AND reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT stock_writeoffs_no_self_review CHECK (reviewed_by_id IS NULL OR reviewed_by_id <> created_by_id)
);
CREATE INDEX stock_writeoffs_branch_status_idx ON public.stock_writeoffs(branch_id,status,created_at);
CREATE INDEX stock_writeoffs_warehouse_status_idx ON public.stock_writeoffs(warehouse_id,status,created_at);

CREATE TABLE public.stock_writeoff_items (
  write_off_id uuid NOT NULL REFERENCES public.stock_writeoffs(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY(write_off_id, ingredient_id)
);
CREATE TABLE public.stock_writeoff_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  write_off_id uuid NOT NULL REFERENCES public.stock_writeoffs(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  action varchar(20) NOT NULL CHECK (action IN ('SUBMITTED','POSTED','REJECTED')),
  note varchar(500),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX stock_writeoff_events_writeoff_time_idx ON public.stock_writeoff_events(write_off_id,created_at);

GRANT SELECT, INSERT, UPDATE ON public.stock_writeoffs TO wavehouse_app;
GRANT SELECT, INSERT ON public.stock_writeoff_items TO wavehouse_app;
GRANT SELECT, INSERT ON public.stock_writeoff_events TO wavehouse_app;
-- Existing inventory balance and movement permissions are managed in G0-G4.

-- G11 pre-deployment compatibility fix: allow approved kitchen warehouse write-offs.
-- G4 enabled DISTRIBUTION. G8 service records warehouse WRITE_OFF movements.
ALTER TABLE public.warehouse_inventory_movements
    DROP CONSTRAINT warehouse_inventory_movements_kind_check;
ALTER TABLE public.warehouse_inventory_movements
    ADD CONSTRAINT warehouse_inventory_movements_kind_check
    CHECK (kind IN ('RECEIPT','PRODUCTION_INPUT','PRODUCTION_OUTPUT','DISTRIBUTION','WRITE_OFF'));

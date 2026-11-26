-- G3: central kitchen warehouse inventory and production batches.
-- Additive only: no ALTER/DELETE to branch inventory, sales or G0 scheduling.
-- Migrate with prisma migrate deploy after verified backup.

CREATE TABLE public.warehouses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(32) NOT NULL UNIQUE,
    name varchar(150) NOT NULL,
    address varchar(255),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz(6) NOT NULL DEFAULT now(),
    updated_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE public.warehouse_worker_assignments (
    warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz(6) NOT NULL DEFAULT now(),
    updated_at timestamptz(6) NOT NULL DEFAULT now(),
    PRIMARY KEY (warehouse_id, user_id)
);
CREATE INDEX warehouse_worker_assignments_user_id_is_active_idx ON public.warehouse_worker_assignments(user_id, is_active);

CREATE TABLE public.warehouse_inventory_balances (
    warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    updated_at timestamptz(6) NOT NULL DEFAULT now(),
    PRIMARY KEY (warehouse_id, ingredient_id)
);
CREATE INDEX warehouse_inventory_balances_ingredient_id_idx ON public.warehouse_inventory_balances(ingredient_id);

CREATE TABLE public.warehouse_inventory_movements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    kind varchar(24) NOT NULL CHECK (kind IN ('RECEIPT', 'PRODUCTION_INPUT', 'PRODUCTION_OUTPUT')),
    source_id uuid NOT NULL,
    delta numeric(18,6) NOT NULL CHECK (delta <> 0),
    quantity_after numeric(18,6) NOT NULL CHECK (quantity_after >= 0),
    created_at timestamptz(6) NOT NULL DEFAULT now(),
    UNIQUE (kind, source_id, warehouse_id, ingredient_id)
);
CREATE INDEX warehouse_inventory_movements_warehouse_id_created_at_idx ON public.warehouse_inventory_movements(warehouse_id, created_at);

CREATE TABLE public.warehouse_receipts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(40) NOT NULL UNIQUE,
    warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    supplier_name varchar(160),
    note varchar(500),
    status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED')),
    created_by_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    posted_by_id uuid REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    posted_at timestamptz(6),
    created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX warehouse_receipts_warehouse_id_status_created_at_idx ON public.warehouse_receipts(warehouse_id, status, created_at);

CREATE TABLE public.warehouse_receipt_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id uuid NOT NULL REFERENCES public.warehouse_receipts(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
    unit_cost numeric(18,4) NOT NULL CHECK (unit_cost >= 0),
    UNIQUE (receipt_id, ingredient_id)
);

CREATE TABLE public.production_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(40) NOT NULL UNIQUE,
    warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    note varchar(500),
    status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED')),
    created_by_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    posted_by_id uuid REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    posted_at timestamptz(6),
    created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX production_batches_warehouse_id_status_created_at_idx ON public.production_batches(warehouse_id, status, created_at);

CREATE TABLE public.production_batch_inputs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id uuid NOT NULL REFERENCES public.production_batches(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
    UNIQUE (batch_id, ingredient_id)
);

CREATE TABLE public.production_batch_outputs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id uuid NOT NULL REFERENCES public.production_batches(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
    UNIQUE (batch_id, ingredient_id)
);

-- Application runtime role receives only privileges needed by authenticated APIs.
-- Warehouse movement history is append-only for this role.
GRANT SELECT, INSERT, UPDATE ON public.warehouses TO wavehouse_app;
GRANT SELECT, INSERT, UPDATE ON public.warehouse_worker_assignments TO wavehouse_app;
GRANT SELECT, INSERT, UPDATE ON public.warehouse_inventory_balances TO wavehouse_app;
GRANT SELECT, INSERT ON public.warehouse_inventory_movements TO wavehouse_app;
GRANT SELECT, INSERT, UPDATE ON public.warehouse_receipts TO wavehouse_app;
GRANT SELECT, INSERT ON public.warehouse_receipt_items TO wavehouse_app;
GRANT SELECT, INSERT, UPDATE ON public.production_batches TO wavehouse_app;
GRANT SELECT, INSERT ON public.production_batch_inputs, public.production_batch_outputs TO wavehouse_app;

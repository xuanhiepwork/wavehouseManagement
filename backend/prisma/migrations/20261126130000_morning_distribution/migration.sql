-- G4 distribution: kitchen dispatch -> in-transit -> physical receipt at branch.
-- No existing inventory or sales records are deleted or rewritten.
ALTER TABLE public.warehouse_inventory_movements
    DROP CONSTRAINT warehouse_inventory_movements_kind_check;
ALTER TABLE public.warehouse_inventory_movements
    ADD CONSTRAINT warehouse_inventory_movements_kind_check
        CHECK (kind IN ('RECEIPT', 'PRODUCTION_INPUT', 'PRODUCTION_OUTPUT', 'DISTRIBUTION'));

CREATE TABLE public.delivery_trips (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(40) NOT NULL UNIQUE,
    warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    business_date date NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'IN_TRANSIT', 'COMPLETE')),
    courier_id uuid REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    note varchar(500),
    created_by_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    dispatched_by_id uuid REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    dispatched_at timestamptz(6),
    completed_at timestamptz(6),
    received_stops integer NOT NULL DEFAULT 0 CHECK (received_stops >= 0),
    created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX delivery_trips_warehouse_date_status_idx ON public.delivery_trips(warehouse_id,business_date,status);
CREATE INDEX delivery_trips_courier_date_idx ON public.delivery_trips(courier_id,business_date);

CREATE TABLE public.delivery_stops (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id uuid NOT NULL REFERENCES public.delivery_trips(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    stop_order integer NOT NULL CHECK (stop_order > 0),
    status varchar(16) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','DISPATCHED','RECEIVED')),
    note varchar(500),
    received_by_id uuid REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    received_at timestamptz(6),
    UNIQUE (trip_id, branch_id),
    UNIQUE (trip_id, stop_order)
);
CREATE INDEX delivery_stops_branch_status_idx ON public.delivery_stops(branch_id,status);

CREATE TABLE public.delivery_stop_items (
    stop_id uuid NOT NULL REFERENCES public.delivery_stops(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    planned_quantity numeric(18,6) NOT NULL CHECK (planned_quantity > 0),
    received_quantity numeric(18,6) CHECK (received_quantity >= 0),
    damaged_quantity numeric(18,6) CHECK (damaged_quantity >= 0),
    PRIMARY KEY (stop_id,ingredient_id),
    CONSTRAINT delivery_stop_items_quantity_bounds CHECK (
        COALESCE(received_quantity,0)+COALESCE(damaged_quantity,0) <= planned_quantity
    )
);
CREATE INDEX delivery_stop_items_ingredient_idx ON public.delivery_stop_items(ingredient_id);

-- Scope checking lives in authenticated Backend services; database runtime gets minimal operation grants.
GRANT SELECT, INSERT, UPDATE ON public.delivery_trips TO wavehouse_app;
GRANT SELECT, INSERT, UPDATE ON public.delivery_stops TO wavehouse_app;
GRANT SELECT, INSERT, UPDATE ON public.delivery_stop_items TO wavehouse_app;

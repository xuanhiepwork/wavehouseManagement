-- G6: auditable restock approvals and received-delivery discrepancy cases.
-- Additive only: does not recalculate inventory, alter deliveries, or delete records.
CREATE TABLE public.restock_plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    area_id uuid NOT NULL REFERENCES public.areas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    submission_key uuid NOT NULL UNIQUE,
    business_date date NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'SUBMITTED'
        CHECK (status IN ('SUBMITTED','APPROVED','REJECTED','CONVERTED')),
    note varchar(500),
    created_by_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    reviewed_by_id uuid REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    reviewed_at timestamptz(6),
    review_note varchar(500),
    converted_at timestamptz(6),
    delivery_trip_id uuid UNIQUE REFERENCES public.delivery_trips(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    created_at timestamptz(6) NOT NULL DEFAULT now(),
    CONSTRAINT restock_plans_review_pair CHECK (
      (status='SUBMITTED' AND reviewed_by_id IS NULL AND reviewed_at IS NULL)
      OR (status<>'SUBMITTED' AND reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL)
    ),
    CONSTRAINT restock_plans_conversion_pair CHECK (
      (status='CONVERTED' AND delivery_trip_id IS NOT NULL AND converted_at IS NOT NULL)
      OR (status<>'CONVERTED' AND delivery_trip_id IS NULL AND converted_at IS NULL)
    )
);
CREATE INDEX restock_plans_area_date_status_idx ON public.restock_plans(area_id,business_date,status);
CREATE INDEX restock_plans_warehouse_date_idx ON public.restock_plans(warehouse_id,business_date);

CREATE TABLE public.restock_plan_lines (
    plan_id uuid NOT NULL REFERENCES public.restock_plans(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
    PRIMARY KEY(plan_id,branch_id,ingredient_id)
);
CREATE TABLE public.restock_plan_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES public.restock_plans(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    action varchar(20) NOT NULL CHECK (action IN ('SUBMITTED','APPROVED','REJECTED','CONVERTED')),
    note varchar(500),
    created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX restock_plan_events_plan_time_idx ON public.restock_plan_events(plan_id,created_at);

CREATE TABLE public.delivery_discrepancies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stop_id uuid NOT NULL UNIQUE REFERENCES public.delivery_stops(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
    classification varchar(32) CHECK (classification IN ('SHORTAGE','DAMAGED','COUNT_ERROR','OTHER')),
    resolution_note varchar(500),
    resolved_by_id uuid REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    resolved_at timestamptz(6),
    created_at timestamptz(6) NOT NULL DEFAULT now(),
    CONSTRAINT delivery_discrepancies_resolution_pair CHECK (
       (status='OPEN' AND classification IS NULL AND resolved_by_id IS NULL AND resolved_at IS NULL)
       OR (status='RESOLVED' AND classification IS NOT NULL AND resolved_by_id IS NOT NULL AND resolved_at IS NOT NULL AND resolution_note IS NOT NULL)
    )
);
CREATE INDEX delivery_discrepancies_status_time_idx ON public.delivery_discrepancies(status,created_at);
CREATE TABLE public.delivery_discrepancy_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    discrepancy_id uuid NOT NULL REFERENCES public.delivery_discrepancies(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    action varchar(20) NOT NULL CHECK (action IN ('OPENED','RESOLVED')),
    note varchar(500),
    created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX delivery_discrepancy_events_case_time_idx ON public.delivery_discrepancy_events(discrepancy_id,created_at);

-- Historical discrepancies are identified only from confirmed physical receiving.
-- NO changes to branch balances or recorded received/damaged quantities.
WITH inserted AS (
    INSERT INTO public.delivery_discrepancies(stop_id, status, created_at)
    SELECT s.id, 'OPEN', COALESCE(s.received_at,now())
    FROM public.delivery_stops AS s
    WHERE s.status='RECEIVED' AND EXISTS (
      SELECT 1 FROM public.delivery_stop_items AS i WHERE i.stop_id=s.id
      AND (i.received_quantity IS NULL
        OR COALESCE(i.received_quantity,0) + COALESCE(i.damaged_quantity,0) <> i.planned_quantity
        OR COALESCE(i.damaged_quantity,0) > 0)
    )
    ON CONFLICT(stop_id) DO NOTHING
    RETURNING id,stop_id,created_at
)
INSERT INTO public.delivery_discrepancy_events(discrepancy_id,actor_id,action,note,created_at)
SELECT ins.id, COALESCE(stop.received_by_id,trip.created_by_id), 'OPENED',
       'Backfill G6 từ biên bản nhận hàng G4', ins.created_at
FROM inserted ins
JOIN public.delivery_stops stop ON stop.id=ins.stop_id
JOIN public.delivery_trips trip ON trip.id=stop.trip_id;

-- Minimal runtime DML permissions: audit events are append-only.
GRANT SELECT, INSERT, UPDATE ON public.restock_plans TO wavehouse_app;
GRANT SELECT, INSERT ON public.restock_plan_lines TO wavehouse_app;
GRANT SELECT, INSERT ON public.restock_plan_events TO wavehouse_app;
GRANT SELECT, INSERT, UPDATE ON public.delivery_discrepancies TO wavehouse_app;
GRANT SELECT, INSERT ON public.delivery_discrepancy_events TO wavehouse_app;

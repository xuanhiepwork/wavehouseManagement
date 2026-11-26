-- G7: auditable late recovery of goods previously recorded as missing at a G4 stop.
-- No automatic reversal of G4 delivery balances, damaged stock, or G6 case conclusions.
CREATE TABLE public.delivery_recovery_adjustments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    discrepancy_id uuid NOT NULL REFERENCES public.delivery_discrepancies(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    submission_key uuid NOT NULL UNIQUE,
    status varchar(16) NOT NULL DEFAULT 'SUBMITTED'
        CHECK (status IN ('SUBMITTED','POSTED','REJECTED')),
    evidence varchar(500) NOT NULL CHECK (char_length(trim(evidence)) >= 10),
    created_by_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    reviewed_by_id uuid REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    review_note varchar(500),
    reviewed_at timestamptz(6),
    created_at timestamptz(6) NOT NULL DEFAULT now(),
    CONSTRAINT delivery_recovery_adjustments_review_pair CHECK (
        (status='SUBMITTED' AND reviewed_by_id IS NULL AND reviewed_at IS NULL)
        OR (status<>'SUBMITTED' AND reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL)
    )
);
CREATE INDEX delivery_recovery_adjustments_case_status_idx
    ON public.delivery_recovery_adjustments(discrepancy_id,status,created_at);
CREATE INDEX delivery_recovery_adjustments_branch_status_idx
    ON public.delivery_recovery_adjustments(branch_id,status,created_at);

CREATE TABLE public.delivery_recovery_adjustment_items (
    adjustment_id uuid NOT NULL REFERENCES public.delivery_recovery_adjustments(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
    PRIMARY KEY(adjustment_id,ingredient_id)
);
CREATE TABLE public.delivery_recovery_adjustment_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    adjustment_id uuid NOT NULL REFERENCES public.delivery_recovery_adjustments(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    action varchar(20) NOT NULL CHECK (action IN ('SUBMITTED','POSTED','REJECTED')),
    note varchar(500),
    created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX delivery_recovery_events_adjustment_time_idx
    ON public.delivery_recovery_adjustment_events(adjustment_id,created_at);

-- Application role may append audit events and create/review documents, but never delete.
GRANT SELECT, INSERT, UPDATE ON public.delivery_recovery_adjustments TO wavehouse_app;
GRANT SELECT, INSERT ON public.delivery_recovery_adjustment_items TO wavehouse_app;
GRANT SELECT, INSERT ON public.delivery_recovery_adjustment_events TO wavehouse_app;

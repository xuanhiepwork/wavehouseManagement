-- G0/G2/G3 additive migration: area ownership and flexible staff scheduling.
-- This migration does NOT reset data or change legacy users.branch_id behavior.
-- Apply through prisma migrate deploy after a fresh Aiven backup, NOT by pasting individual lines into the SQL Editor.

CREATE TABLE public.areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(32) NOT NULL UNIQUE,
  name varchar(150) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now()
);

ALTER TABLE public.branches
  ADD COLUMN area_id uuid NULL REFERENCES public.areas(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX branches_area_id_idx ON public.branches(area_id);

ALTER TABLE public.users
  ADD COLUMN area_id uuid NULL REFERENCES public.areas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN work_kind varchar(32) NOT NULL DEFAULT 'SALES';
ALTER TABLE public.users
  ADD CONSTRAINT users_work_kind_check CHECK (work_kind IN ('SALES', 'KITCHEN_DELIVERY'));
CREATE INDEX users_area_id_role_is_active_idx ON public.users(area_id, role, is_active);

CREATE TABLE public.staff_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  business_date date NOT NULL,
  shift "WorkShift" NOT NULL,
  available boolean NOT NULL DEFAULT true,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT staff_availability_unique_slot UNIQUE (user_id, business_date, shift)
);
CREATE INDEX staff_availability_business_date_shift_idx ON public.staff_availability(business_date, shift);

CREATE TABLE public.shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  business_date date NOT NULL,
  shift "WorkShift" NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'SCHEDULED',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  assigned_by_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT shift_assignments_status_check CHECK (status IN ('SCHEDULED', 'CANCELLED')),
  CONSTRAINT shift_assignments_unique_staff_slot UNIQUE (user_id, business_date, shift)
);
CREATE INDEX shift_assignments_branch_date_shift_idx ON public.shift_assignments(branch_id, business_date, shift);

CREATE TABLE public.schedule_change_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.shift_assignments(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  action varchar(32) NOT NULL,
  previous_branch_id uuid NULL,
  next_branch_id uuid NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT schedule_change_logs_action_check CHECK (action IN ('CREATED','UPDATED','CANCELLED','REACTIVATED'))
);
CREATE INDEX schedule_change_logs_assignment_created_at_idx ON public.schedule_change_logs(assignment_id, created_at);

-- Runtime application role needs only the permissions used by these API routes.
GRANT USAGE ON SCHEMA public TO wavehouse_app;
GRANT SELECT, INSERT, UPDATE ON public.areas TO wavehouse_app;
GRANT SELECT ON public.staff_availability, public.shift_assignments, public.schedule_change_logs TO wavehouse_app;
GRANT INSERT, UPDATE ON public.staff_availability, public.shift_assignments TO wavehouse_app;
GRANT INSERT ON public.schedule_change_logs TO wavehouse_app;
GRANT UPDATE (area_id) ON public.branches TO wavehouse_app;
GRANT UPDATE (area_id, work_kind) ON public.users TO wavehouse_app;

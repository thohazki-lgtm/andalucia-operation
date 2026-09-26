create table if not exists outlet_scopes (
  id uuid primary key, scope_key text not null unique check (scope_key ~ '^[a-z][a-z0-9_]*$'),
  display_name text not null check (length(trim(display_name)) > 0), active boolean not null default true,
  outlet_type text, created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists staff_membership_history (
  id uuid primary key, staff_id uuid not null references staff(id) on delete restrict,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  membership_dimension text not null check (length(trim(membership_dimension)) > 0),
  effective_from date not null, effective_to date,
  source text not null check (source in ('baseline_manager_review','transfer','new_hire','resignation','correction','system')),
  reason text not null default '', review_status text not null default 'pending_review' check (review_status in ('pending_review','approved')),
  reviewed_at timestamptz, reviewed_by text, created_by text, updated_by text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check ((review_status='approved' and reviewed_at is not null and reviewed_by is not null) or review_status='pending_review')
);
create unique index if not exists staff_membership_identical_period_unique on staff_membership_history(staff_id,outlet_scope_id,membership_dimension,effective_from,coalesce(effective_to,'9999-12-31'::date));
create index if not exists staff_membership_staff_date_idx on staff_membership_history(staff_id,membership_dimension,effective_from,effective_to);
create index if not exists staff_membership_outlet_date_idx on staff_membership_history(outlet_scope_id,membership_dimension,effective_from,effective_to);
create unique index if not exists staff_membership_one_open_regular_outlet on staff_membership_history(staff_id) where membership_dimension='regular_outlet' and effective_to is null;
create table if not exists staff_membership_baseline_reviews (
  id uuid primary key, outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  baseline_month text not null check (baseline_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'in_review' check (status in ('in_review','approved')),
  approved_at timestamptz, approved_by text, created_by text, updated_by text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(outlet_scope_id,baseline_month),
  check ((status='approved' and approved_at is not null and approved_by is not null) or status='in_review')
);
create table if not exists staff_membership_baseline_selections (
  id uuid primary key, review_id uuid not null references staff_membership_baseline_reviews(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete restrict, included boolean not null default false,
  effective_from date not null, effective_to date, review_note text not null default '', created_by text, updated_by text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(review_id,staff_id),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists staff_membership_baseline_review_status_idx on staff_membership_baseline_reviews(outlet_scope_id,baseline_month,status);
create index if not exists staff_membership_baseline_selection_review_idx on staff_membership_baseline_selections(review_id,included,staff_id);
create or replace function protect_outlet_scope_key() returns trigger language plpgsql as $$
begin if old.scope_key <> new.scope_key then raise exception 'Outlet scope key is immutable.' using errcode='23514'; end if; return new; end $$;
drop trigger if exists outlet_scope_key_immutable on outlet_scopes;
create trigger outlet_scope_key_immutable before update on outlet_scopes for each row execute function protect_outlet_scope_key();
create or replace function prevent_regular_outlet_membership_overlap() returns trigger language plpgsql as $$
begin
  if new.membership_dimension='regular_outlet' and exists(
    select 1 from staff_membership_history existing where existing.staff_id=new.staff_id
      and existing.membership_dimension='regular_outlet' and existing.id<>new.id
      and existing.effective_from<=coalesce(new.effective_to,'9999-12-31'::date)
      and new.effective_from<=coalesce(existing.effective_to,'9999-12-31'::date)
  ) then raise exception 'Regular outlet membership overlaps an existing period.' using errcode='23514'; end if;
  return new;
end $$;
drop trigger if exists staff_regular_outlet_overlap on staff_membership_history;
create trigger staff_regular_outlet_overlap before insert or update on staff_membership_history for each row execute function prevent_regular_outlet_membership_overlap();

create table if not exists duty_roster_month_states (
  id uuid primary key,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  month_start date not null,
  status text not null default 'open' check (status in ('open','locked','reopened')),
  locked_at timestamptz,
  locked_by_user_id uuid references user_accounts(id) on delete set null,
  locked_by_name_snapshot text,
  reopened_at timestamptz,
  reopened_by_user_id uuid references user_accounts(id) on delete set null,
  reopened_by_name_snapshot text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (month_start = date_trunc('month', month_start)::date),
  check (status <> 'locked' or (locked_at is not null and length(trim(locked_by_name_snapshot)) > 0)),
  check (status <> 'reopened' or (reopened_at is not null and reopened_by_user_id is not null and length(trim(reopened_by_name_snapshot)) > 0)),
  unique(outlet_scope_id, month_start)
);

create table if not exists duty_roster_month_audits (
  id uuid primary key,
  month_state_id uuid not null references duty_roster_month_states(id) on delete restrict,
  action text not null check (action in ('automatic_lock','manual_lock','reopen')),
  previous_status text not null check (previous_status in ('open','locked','reopened')),
  new_status text not null check (new_status in ('open','locked','reopened')),
  actor_user_id uuid references user_accounts(id) on delete set null,
  actor_name_snapshot text not null check (length(trim(actor_name_snapshot)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists duty_roster_month_states_month_idx
  on duty_roster_month_states(outlet_scope_id, month_start);

create index if not exists duty_roster_month_audits_state_idx
  on duty_roster_month_audits(month_state_id, created_at);

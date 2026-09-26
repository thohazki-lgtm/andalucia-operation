create table if not exists daily_reports (
  id uuid primary key,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  service_date date not null,
  revision_number integer not null default 1 check(revision_number >= 1),
  status text not null default 'draft' check(status in ('draft','reviewed','approved','superseded')),
  is_current_authority boolean not null default true,
  manual_payload jsonb not null default '{}'::jsonb check(jsonb_typeof(manual_payload)='object'),
  prepared_by_user_id uuid not null references user_accounts(id) on delete restrict,
  prepared_by_name_snapshot text not null check(length(trim(prepared_by_name_snapshot)) > 0),
  reviewed_by_user_id uuid references user_accounts(id) on delete restrict,
  reviewed_by_name_snapshot text,
  approved_by_user_id uuid references user_accounts(id) on delete restrict,
  approved_by_name_snapshot text,
  prepared_at timestamptz not null default now(),
  reviewed_at timestamptz,
  approved_at timestamptz,
  created_by_user_id uuid not null references user_accounts(id) on delete restrict,
  created_by_name_snapshot text not null check(length(trim(created_by_name_snapshot)) > 0),
  created_at timestamptz not null default now(),
  updated_by_user_id uuid not null references user_accounts(id) on delete restrict,
  updated_by_name_snapshot text not null check(length(trim(updated_by_name_snapshot)) > 0),
  updated_at timestamptz not null default now(),
  constraint daily_report_review_identity_check check(
    (status='draft' and reviewed_at is null and reviewed_by_user_id is null and reviewed_by_name_snapshot is null and approved_at is null and approved_by_user_id is null and approved_by_name_snapshot is null)
    or
    (status='reviewed' and reviewed_at is not null and reviewed_by_user_id is not null and length(trim(reviewed_by_name_snapshot)) > 0 and approved_at is null and approved_by_user_id is null and approved_by_name_snapshot is null)
    or
    (status in ('approved','superseded') and reviewed_at is not null and reviewed_by_user_id is not null and length(trim(reviewed_by_name_snapshot)) > 0 and approved_at is not null and approved_by_user_id is not null and length(trim(approved_by_name_snapshot)) > 0)
  ),
  constraint daily_report_superseded_not_current_check check(status<>'superseded' or is_current_authority=false),
  unique(id,outlet_scope_id,service_date,revision_number),
  unique(outlet_scope_id,service_date,revision_number)
);

create unique index if not exists daily_report_current_authority_unique
  on daily_reports(outlet_scope_id,service_date)
  where is_current_authority=true;
create index if not exists daily_report_period_idx
  on daily_reports(outlet_scope_id,service_date,status);

create table if not exists daily_report_snapshots (
  id uuid primary key,
  daily_report_id uuid not null unique,
  outlet_scope_id uuid not null,
  service_date date not null,
  revision_number integer not null check(revision_number >= 1),
  frozen_payload jsonb not null check(jsonb_typeof(frozen_payload)='object'),
  snapshot_sha256 text not null check(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  approval_idempotency_key text not null check(length(trim(approval_idempotency_key)) >= 12),
  approved_by_user_id uuid not null references user_accounts(id) on delete restrict,
  approved_by_name_snapshot text not null check(length(trim(approved_by_name_snapshot)) > 0),
  approved_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key(daily_report_id,outlet_scope_id,service_date,revision_number)
    references daily_reports(id,outlet_scope_id,service_date,revision_number) on delete restrict,
  unique(outlet_scope_id,service_date,revision_number),
  unique(outlet_scope_id,approval_idempotency_key)
);

create index if not exists daily_report_snapshot_period_idx
  on daily_report_snapshots(outlet_scope_id,service_date,revision_number);

create or replace function protect_daily_report_snapshot() returns trigger language plpgsql as $$
begin
  raise exception 'Approved Daily Report snapshots are immutable.' using errcode='23514';
end $$;
drop trigger if exists daily_report_snapshot_immutable on daily_report_snapshots;
create trigger daily_report_snapshot_immutable before update or delete on daily_report_snapshots for each row execute function protect_daily_report_snapshot();

create or replace function validate_daily_report_snapshot_insert() returns trigger language plpgsql as $$
declare parent_status text; parent_approver uuid; parent_approved_at timestamptz;
begin
  select status,approved_by_user_id,approved_at into parent_status,parent_approver,parent_approved_at from daily_reports where id=new.daily_report_id for share;
  if parent_status not in ('approved','superseded') or parent_approver<>new.approved_by_user_id or parent_approved_at<>new.approved_at then
    raise exception 'Snapshot must match an approved Daily Report revision.' using errcode='23514';
  end if;
  return new;
end $$;
drop trigger if exists daily_report_snapshot_parent_guard on daily_report_snapshots;
create trigger daily_report_snapshot_parent_guard before insert on daily_report_snapshots for each row execute function validate_daily_report_snapshot_insert();

create or replace function protect_approved_daily_report_history() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' and old.status in ('approved','superseded') then raise exception 'Approved Daily Report history cannot be deleted.' using errcode='23514'; end if;
  if tg_op='UPDATE' and old.status in ('approved','superseded') then
    if old.status='approved' and new.status='superseded' and new.is_current_authority=false
       and (to_jsonb(new)-array['status','is_current_authority','updated_by_user_id','updated_by_name_snapshot','updated_at'])=(to_jsonb(old)-array['status','is_current_authority','updated_by_user_id','updated_by_name_snapshot','updated_at']) then return new; end if;
    raise exception 'Approved Daily Report history is immutable.' using errcode='23514';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists daily_report_approved_history_immutable on daily_reports;
create trigger daily_report_approved_history_immutable before update or delete on daily_reports for each row execute function protect_approved_daily_report_history();

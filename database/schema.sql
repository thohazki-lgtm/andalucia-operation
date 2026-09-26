-- Legacy complete-schema bootstrap retained for isolated, empty test databases only.
-- Normal application startup must never execute this file; versioned migrations own upgrades and historical backfills.
create table if not exists staff (id uuid primary key, staff_number text unique not null, full_name text not null, position_key text not null, employment_status_key text not null default 'active', join_date date not null, resignation_date date, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (resignation_date is null or resignation_date >= join_date));
alter table staff add column if not exists nationality text not null default '';
alter table staff add column if not exists division text not null default 'Food & Beverage';
alter table staff add column if not exists department text not null default 'F&B Service';
alter table staff add column if not exists outlet text not null default 'Andalucía';
alter table staff add column if not exists identity_document_number text not null default '';
alter table staff add column if not exists created_by text;
alter table staff add column if not exists updated_by text;
create table if not exists user_accounts (
  id uuid primary key,
  login_identifier text not null,
  normalized_login_identifier text not null unique,
  display_name text not null check (length(trim(display_name)) > 0),
  password_hash text not null,
  status text not null default 'active' check (status in ('active','disabled')),
  staff_id uuid references staff(id) on delete set null,
  last_login_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(normalized_login_identifier) between 3 and 254)
);
create table if not exists auth_sessions (
  id uuid primary key,
  token_hash text not null unique,
  user_id uuid not null references user_accounts(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create table if not exists auth_security_events (
  id uuid primary key,
  user_id uuid references user_accounts(id) on delete set null,
  session_id uuid references auth_sessions(id) on delete set null,
  event_type text not null,
  success boolean not null,
  identifier_hash text,
  details jsonb not null default '{}',
  actor_user_id uuid references user_accounts(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists auth_sessions_user_status_idx on auth_sessions(user_id,revoked_at,expires_at);
create index if not exists auth_security_events_user_date_idx on auth_security_events(user_id,created_at);
create table if not exists authorization_roles (
  id uuid primary key,
  role_key text not null unique check (role_key ~ '^[a-z][a-z0-9_]*$'),
  display_name text not null check (length(trim(display_name)) > 0),
  active boolean not null default true,
  global_scope boolean not null default false,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists authorization_permissions (
  id uuid primary key,
  permission_key text not null unique check (permission_key ~ '^[a-z][a-z0-9_]*$'),
  display_name text not null check (length(trim(display_name)) > 0),
  description text not null default '',
  active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists authorization_role_permissions (
  role_id uuid not null references authorization_roles(id) on delete restrict,
  permission_id uuid not null references authorization_permissions(id) on delete restrict,
  created_by text,
  created_at timestamptz not null default now(),
  primary key(role_id,permission_id)
);
create table if not exists authorization_user_roles (
  id uuid primary key,
  user_id uuid not null references user_accounts(id) on delete cascade,
  role_id uuid not null references authorization_roles(id) on delete restrict,
  active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,role_id)
);
create index if not exists authorization_user_roles_user_idx on authorization_user_roles(user_id,active);
create or replace function protect_authorization_role_key() returns trigger language plpgsql as $$
begin
  if old.role_key <> new.role_key then raise exception 'Role key is immutable.' using errcode='23514'; end if;
  return new;
end $$;
create or replace function protect_authorization_permission_key() returns trigger language plpgsql as $$
begin
  if old.permission_key <> new.permission_key then raise exception 'Permission key is immutable.' using errcode='23514'; end if;
  return new;
end $$;
drop trigger if exists authorization_role_key_immutable on authorization_roles;
create trigger authorization_role_key_immutable before update on authorization_roles for each row execute function protect_authorization_role_key();
drop trigger if exists authorization_permission_key_immutable on authorization_permissions;
create trigger authorization_permission_key_immutable before update on authorization_permissions for each row execute function protect_authorization_permission_key();
create table if not exists staff_entitlements (staff_id uuid primary key references staff(id), annual_leave_per_year integer not null default 30 check (annual_leave_per_year >= 0), weekly_off_entitlement integer not null default 1 check (weekly_off_entitlement >= 0), public_holiday_per_year integer not null default 11 check (public_holiday_per_year >= 0), created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists outlet_scopes (
  id uuid primary key,
  scope_key text not null unique check (scope_key ~ '^[a-z][a-z0-9_]*$'),
  display_name text not null check (length(trim(display_name)) > 0),
  active boolean not null default true,
  outlet_type text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists authorization_user_outlet_scopes (
  id uuid primary key,
  user_id uuid not null references user_accounts(id) on delete cascade,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,outlet_scope_id)
);
create index if not exists authorization_user_outlet_user_idx on authorization_user_outlet_scopes(user_id,active);
create table if not exists staff_membership_history (
  id uuid primary key,
  staff_id uuid not null references staff(id) on delete restrict,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  membership_dimension text not null check (length(trim(membership_dimension)) > 0),
  effective_from date not null,
  effective_to date,
  source text not null check (source in ('baseline_manager_review','transfer','new_hire','resignation','correction','system')),
  reason text not null default '',
  review_status text not null default 'pending_review' check (review_status in ('pending_review','approved')),
  reviewed_at timestamptz,
  reviewed_by text,
  baseline_revision_id uuid,
  is_current_baseline boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check ((review_status='approved' and reviewed_at is not null and reviewed_by is not null) or review_status='pending_review')
);
create unique index if not exists staff_membership_identical_period_unique on staff_membership_history(staff_id,outlet_scope_id,membership_dimension,effective_from,coalesce(effective_to,'9999-12-31'::date)) where is_current_baseline=true;
create index if not exists staff_membership_staff_date_idx on staff_membership_history(staff_id,membership_dimension,effective_from,effective_to);
create index if not exists staff_membership_outlet_date_idx on staff_membership_history(outlet_scope_id,membership_dimension,effective_from,effective_to);
create unique index if not exists staff_membership_one_open_regular_outlet on staff_membership_history(staff_id) where membership_dimension='regular_outlet' and effective_to is null and is_current_baseline=true;

create or replace function protect_outlet_scope_key() returns trigger language plpgsql as $$
begin
  if old.scope_key <> new.scope_key then raise exception 'Outlet scope key is immutable.' using errcode='23514'; end if;
  return new;
end $$;
drop trigger if exists outlet_scope_key_immutable on outlet_scopes;
create trigger outlet_scope_key_immutable before update on outlet_scopes for each row execute function protect_outlet_scope_key();

create or replace function prevent_regular_outlet_membership_overlap() returns trigger language plpgsql as $$
begin
  if new.membership_dimension='regular_outlet' and exists(
    select 1 from staff_membership_history existing
    where existing.staff_id=new.staff_id and existing.membership_dimension='regular_outlet' and existing.is_current_baseline=true and new.is_current_baseline=true and existing.id<>new.id
      and existing.effective_from<=coalesce(new.effective_to,'9999-12-31'::date)
      and new.effective_from<=coalesce(existing.effective_to,'9999-12-31'::date)
  ) then raise exception 'Regular outlet membership overlaps an existing period.' using errcode='23514'; end if;
  return new;
end $$;
drop trigger if exists staff_regular_outlet_overlap on staff_membership_history;
create trigger staff_regular_outlet_overlap before insert or update on staff_membership_history for each row execute function prevent_regular_outlet_membership_overlap();
create table if not exists staff_membership_baseline_reviews (
  id uuid primary key,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  baseline_month text not null check (baseline_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'in_review' check (status in ('in_review','correction_in_review','approved','superseded')),
  revision_number integer not null default 1 check (revision_number>=1),
  previous_revision_id uuid references staff_membership_baseline_reviews(id) on delete restrict,
  review_type text not null default 'initial' check (review_type in ('initial','correction')),
  is_current_revision boolean not null default true,
  is_authoritative boolean not null default false,
  approved_at timestamptz,
  approved_by text,
  approved_by_user_id uuid references user_accounts(id) on delete restrict,
  reopened_at timestamptz,
  reopened_by_user_id uuid references user_accounts(id) on delete restrict,
  reopened_by_name text,
  reopen_reason text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(outlet_scope_id,baseline_month,revision_number),
  check ((status in ('approved','superseded') and approved_at is not null and approved_by is not null) or status in ('in_review','correction_in_review'))
);
create table if not exists staff_membership_baseline_selections (
  id uuid primary key,
  review_id uuid not null references staff_membership_baseline_reviews(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete restrict,
  included boolean not null default false,
  effective_from date not null,
  effective_to date,
  review_note text not null default '',
  staff_name_snapshot text,
  staff_number_snapshot text,
  designation_snapshot text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(review_id,staff_id),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists staff_membership_baseline_review_status_idx on staff_membership_baseline_reviews(outlet_scope_id,baseline_month,status);
create unique index if not exists staff_membership_baseline_current_revision_unique on staff_membership_baseline_reviews(outlet_scope_id,baseline_month) where is_current_revision=true;
create unique index if not exists staff_membership_baseline_authoritative_unique on staff_membership_baseline_reviews(outlet_scope_id,baseline_month) where is_authoritative=true;
create unique index if not exists staff_membership_baseline_active_correction_unique on staff_membership_baseline_reviews(outlet_scope_id,baseline_month) where status='correction_in_review';
create index if not exists staff_membership_baseline_selection_review_idx on staff_membership_baseline_selections(review_id,included,staff_id);
do $$ begin
  if not exists(select 1 from pg_constraint where conname='staff_membership_history_baseline_revision_fk') then
    alter table staff_membership_history add constraint staff_membership_history_baseline_revision_fk foreign key (baseline_revision_id) references staff_membership_baseline_reviews(id) on delete restrict;
  end if;
end $$;
create table if not exists public_holidays (id uuid primary key, holiday_name text not null, holiday_date date not null, days integer not null default 1 check (days >= 1), active boolean not null default true, created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists configuration_options (id uuid primary key, group_key text not null, value text not null, label text not null, color text, metadata jsonb not null default '{}', active boolean not null default true, sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(group_key, value));
create table if not exists duty_roster_entries (id uuid primary key, staff_id uuid not null references staff(id), duty_date date not null, duty_code_value text not null, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(staff_id, duty_date));
create table if not exists attendance_records (id uuid primary key, staff_id uuid not null references staff(id), attendance_date date not null, roster_entry_id uuid references duty_roster_entries(id), actual_status text not null, actual_duty_code text, clock_in timestamptz, clock_out timestamptz, notes text, created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(staff_id, attendance_date));
create table if not exists bookings (id uuid primary key, room_number text, guest_name text not null, birth_date date, arrival_date date, departure_date date, meal_period text, booking_number text, booking_status text not null, covers integer not null default 1, booking_source text, booked_by text, guest_notes text, reservation_time time, table_number text, waiter_id uuid references staff(id), imported_batch_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists guest_occasions (id uuid primary key, booking_id uuid references bookings(id), occasion_type text not null, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists chargeable_item_records (id uuid primary key, booking_id uuid references bookings(id), item_value text not null, amount numeric(10,2) not null, waiter_id uuid references staff(id), status text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists maintenance_issues (id uuid primary key, issue text not null, priority text not null, assigned_to text, reported_at timestamptz not null default now(), status text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists training_records (id uuid primary key, staff_id uuid not null references staff(id), training_type text not null, attended_at timestamptz not null, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists training_sessions (id uuid primary key, title text not null, category_value text not null, training_date date not null, training_time time not null, trainer text not null, status_value text not null, notes text not null default '', active boolean not null default true, created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists training_session_attendees (id uuid primary key, training_id uuid not null references training_sessions(id), staff_id uuid not null references staff(id), attendance_status_value text, created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(training_id, staff_id));
create table if not exists training_import_batches (id uuid primary key, file_name text not null, file_hash text not null unique, file_type text not null, imported_at timestamptz not null default now(), created_by text);
create table if not exists audit_logs (id uuid primary key, entity_type text not null, entity_id uuid not null, action text not null, before_data jsonb, after_data jsonb, actor text, created_at timestamptz not null default now());
create index if not exists roster_date_idx on duty_roster_entries(duty_date);
create index if not exists config_group_idx on configuration_options(group_key, active, sort_order);
create index if not exists public_holiday_date_idx on public_holidays(holiday_date, active);
create index if not exists training_session_date_idx on training_sessions(training_date);
create index if not exists training_attendee_staff_idx on training_session_attendees(staff_id);
alter table attendance_records add column if not exists actual_duty_code text;
alter table attendance_records add column if not exists created_by text;
alter table attendance_records add column if not exists updated_by text;
alter table bookings add column if not exists reservation_date date;
alter table bookings add column if not exists import_source text;
alter table bookings add column if not exists created_by text;
alter table bookings add column if not exists updated_by text;
alter table training_sessions add column if not exists end_time time;
alter table training_sessions add column if not exists location text not null default 'Andalucía';
alter table training_sessions add column if not exists source text not null default 'manual';
alter table training_sessions add column if not exists source_file_name text;
alter table training_sessions add column if not exists import_batch_id uuid references training_import_batches(id);
alter table training_sessions add column if not exists imported_at timestamptz;
alter table training_sessions add column if not exists source_data jsonb;
alter table training_sessions add column if not exists manager_corrected boolean not null default false;
alter table training_import_batches add column if not exists active boolean not null default true;
alter table training_import_batches add column if not exists removed_at timestamptz;
alter table training_import_batches add column if not exists removed_by text;
alter table training_import_batches add column if not exists removal_action text;
alter table training_import_batches add column if not exists replacement_batch_id uuid;
alter table training_import_batches drop constraint if exists training_import_batches_file_hash_key;
create unique index if not exists training_import_batches_active_file_hash_unique on training_import_batches(file_hash) where active=true;
create index if not exists training_import_natural_key_idx on training_sessions(training_date, lower(title), training_time, coalesce(end_time, training_time));
update bookings set reservation_date=coalesce(reservation_date, arrival_date, created_at::date) where reservation_date is null;
alter table bookings alter column reservation_date set not null;
create index if not exists booking_reservation_date_idx on bookings(reservation_date);
create index if not exists booking_waiter_idx on bookings(waiter_id);
create table if not exists booking_import_batches (id uuid primary key, original_filename text not null, file_hash text not null unique, report_date date, parser_version text not null, uploaded_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), import_status text not null, summary jsonb not null default '{}', warnings jsonb not null default '[]', created_by text);
create table if not exists booking_guest_members (id uuid primary key, booking_id uuid not null references bookings(id), guest_name text not null, room_number text, accommodation_code text, birth_date date, arrival_date date, departure_date date, meal_plan text, guest_notes text, source_row_order integer not null, raw_source jsonb not null default '{}', created_at timestamptz not null default now(), unique(booking_id, source_row_order));
alter table bookings add column if not exists venue_key text not null default 'andalucia';
alter table bookings add column if not exists source_activity_label text;
alter table bookings add column if not exists source_booking_key text;
alter table bookings add column if not exists parse_confidence numeric(5,4);
alter table bookings add column if not exists review_required boolean not null default false;
alter table bookings add column if not exists raw_import_payload jsonb;
create index if not exists booking_import_batch_hash_idx on booking_import_batches(file_hash);
create index if not exists booking_guest_member_booking_idx on booking_guest_members(booking_id, source_row_order);
create index if not exists booking_source_identity_idx on bookings(venue_key, reservation_date, reservation_time, booking_number);
alter table booking_import_batches add column if not exists preview_payload jsonb not null default '[]';
alter table booking_import_batches add column if not exists import_result jsonb;
alter table booking_import_batches add column if not exists confirmed_at timestamptz;
alter table booking_import_batches add column if not exists confirmed_by text;
alter table bookings add column if not exists source_booking_status text;
alter table bookings add column if not exists source_filename text;
alter table bookings add column if not exists source_report_date date;
alter table bookings add column if not exists source_parser_version text;
alter table bookings add column if not exists source_guest_notes text;
create unique index if not exists booking_import_source_key_unique on bookings(source_booking_key) where source_booking_key is not null;
alter table chargeable_item_records add column if not exists charge_date date;
alter table chargeable_item_records add column if not exists guest_name text;
alter table chargeable_item_records add column if not exists room_number text;
alter table chargeable_item_records add column if not exists table_number text;
alter table chargeable_item_records add column if not exists item_label text;
alter table chargeable_item_records add column if not exists item_category text;
alter table chargeable_item_records add column if not exists quantity integer not null default 1;
alter table chargeable_item_records add column if not exists unit_price numeric(10,2);
alter table chargeable_item_records add column if not exists total_amount numeric(10,2);
alter table chargeable_item_records add column if not exists notes text not null default '';
alter table chargeable_item_records add column if not exists active boolean not null default true;
alter table chargeable_item_records add column if not exists created_by text;
alter table chargeable_item_records add column if not exists updated_by text;
update chargeable_item_records set charge_date=coalesce(charge_date, created_at::date), guest_name=coalesce(guest_name, 'Historical record'), item_label=coalesce(item_label, item_value), item_category=coalesce(item_category, 'Uncategorized'), unit_price=coalesce(unit_price, amount), total_amount=coalesce(total_amount, amount) where charge_date is null or guest_name is null or item_label is null or item_category is null or unit_price is null or total_amount is null;
alter table chargeable_item_records alter column charge_date set not null;
alter table chargeable_item_records alter column guest_name set not null;
alter table chargeable_item_records alter column item_label set not null;
alter table chargeable_item_records alter column item_category set not null;
alter table chargeable_item_records alter column unit_price set not null;
alter table chargeable_item_records alter column total_amount set not null;
create index if not exists chargeable_date_idx on chargeable_item_records(charge_date, active);
create index if not exists chargeable_booking_idx on chargeable_item_records(booking_id);
create index if not exists chargeable_waiter_idx on chargeable_item_records(waiter_id);
alter table guest_occasions add column if not exists status_value text;
alter table guest_occasions add column if not exists source text not null default 'manual';
alter table guest_occasions add column if not exists source_text text not null default '';
alter table guest_occasions add column if not exists manual_guest_name text;
alter table guest_occasions add column if not exists manual_room_number text;
alter table guest_occasions add column if not exists occasion_date date;
alter table guest_occasions add column if not exists occasion_time time;
alter table guest_occasions add column if not exists manual_table_number text;
alter table guest_occasions add column if not exists manual_waiter_id uuid references staff(id);
alter table guest_occasions add column if not exists active boolean not null default true;
alter table guest_occasions add column if not exists created_by text;
alter table guest_occasions add column if not exists updated_by text;
update guest_occasions g set status_value=coalesce(g.status_value, 'pending'), manual_guest_name=coalesce(g.manual_guest_name, b.guest_name, 'Historical guest'), manual_room_number=coalesce(g.manual_room_number, b.room_number), occasion_date=coalesce(g.occasion_date, b.reservation_date, g.created_at::date), occasion_time=coalesce(g.occasion_time, b.reservation_time, '19:00'::time), manual_table_number=coalesce(g.manual_table_number, b.table_number), manual_waiter_id=coalesce(g.manual_waiter_id, b.waiter_id) from bookings b where g.booking_id=b.id and (g.status_value is null or g.manual_guest_name is null or g.occasion_date is null or g.occasion_time is null);
update guest_occasions set status_value=coalesce(status_value, 'pending'), manual_guest_name=coalesce(manual_guest_name, 'Historical guest'), occasion_date=coalesce(occasion_date, created_at::date), occasion_time=coalesce(occasion_time, '19:00'::time) where status_value is null or manual_guest_name is null or occasion_date is null or occasion_time is null;
alter table guest_occasions alter column status_value set not null;
alter table guest_occasions alter column manual_guest_name set not null;
alter table guest_occasions alter column occasion_date set not null;
alter table guest_occasions alter column occasion_time set not null;
create index if not exists guest_occasion_date_idx on guest_occasions(occasion_date, active);
create index if not exists guest_occasion_booking_idx on guest_occasions(booking_id);
create unique index if not exists guest_occasion_booking_type_unique on guest_occasions(booking_id, occasion_type) where booking_id is not null;
alter table maintenance_issues add column if not exists issue_date date;
alter table maintenance_issues add column if not exists area_value text;
alter table maintenance_issues add column if not exists reported_by_staff_id uuid references staff(id);
alter table maintenance_issues add column if not exists notes text not null default '';
alter table maintenance_issues add column if not exists created_by text;
alter table maintenance_issues add column if not exists updated_by text;
update maintenance_issues set issue_date=coalesce(issue_date, reported_at::date), area_value=coalesce(area_value, 'other') where issue_date is null or area_value is null;
alter table maintenance_issues alter column issue_date set not null;
alter table maintenance_issues alter column area_value set not null;
create index if not exists maintenance_issue_date_idx on maintenance_issues(issue_date);
create index if not exists maintenance_issue_status_idx on maintenance_issues(status);
create index if not exists maintenance_issue_reporter_idx on maintenance_issues(reported_by_staff_id);
alter table maintenance_issues add column if not exists outlet_scope_id uuid references outlet_scopes(id) on delete restrict;
alter table maintenance_issues add column if not exists reference_follow_up text;
alter table maintenance_issues add column if not exists completed_at timestamptz;
alter table maintenance_issues add column if not exists completed_by_user_id uuid references user_accounts(id) on delete restrict;
alter table maintenance_issues add column if not exists completed_by_name_snapshot text;
alter table maintenance_issues add column if not exists reporter_name_snapshot text;
alter table maintenance_issues add column if not exists reporter_number_snapshot text;
alter table maintenance_issues add column if not exists revision integer not null default 1;
create index if not exists maintenance_issue_outlet_date_idx on maintenance_issues(outlet_scope_id,issue_date desc,created_at desc);
create index if not exists maintenance_issue_outlet_status_priority_idx on maintenance_issues(outlet_scope_id,status,priority);
create table if not exists report_manager_summaries (id uuid primary key, period_type text not null, start_date date not null, end_date date not null, manager_notes text not null default '', created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(period_type, start_date, end_date));
create index if not exists report_manager_summary_period_idx on report_manager_summaries(start_date, end_date, period_type);

create table if not exists bill_tip_distributions (
  id uuid primary key,
  distribution_month text not null check (distribution_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  pool_amount numeric(14,2) not null default 0 check (pool_amount >= 0),
  status text not null default 'draft' check (status in ('draft','finalized')),
  undistributed_remainder numeric(14,2) not null default 0 check (undistributed_remainder >= 0),
  finalized_at timestamptz,
  finalized_by text,
  reopened_at timestamptz,
  reopened_by text,
  reopen_reason text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(distribution_month)
);
create index if not exists bill_tip_distribution_status_idx on bill_tip_distributions(status, distribution_month);
alter table bill_tip_distributions add column if not exists external_allocation_total numeric(14,2) not null default 0 check (external_allocation_total >= 0);
alter table bill_tip_distributions add column if not exists remaining_team_pool numeric(14,2) not null default 0 check (remaining_team_pool >= 0);
alter table bill_tip_distributions add column if not exists total_eligible_days integer not null default 0 check (total_eligible_days >= 0);
alter table bill_tip_distributions add column if not exists eligible_staff_count integer not null default 0 check (eligible_staff_count >= 0);
alter table bill_tip_distributions add column if not exists value_per_eligible_day numeric(14,6) not null default 0 check (value_per_eligible_day >= 0);
alter table bill_tip_distributions add column if not exists policy_version text not null default 'bill-tip-v1';
alter table bill_tip_distributions add column if not exists policy_metadata jsonb not null default '{}';
alter table bill_tip_distributions add column if not exists calculated_at timestamptz;
alter table bill_tip_distributions add column if not exists calculated_by text;

create table if not exists bill_tip_staff_allocations (
  id uuid primary key,
  distribution_id uuid not null references bill_tip_distributions(id) on delete restrict,
  staff_id uuid not null references staff(id) on delete restrict,
  staff_name_snapshot text not null,
  staff_number_snapshot text not null,
  designation_snapshot text not null,
  eligible_days integer not null default 0 check (eligible_days >= 0),
  excluded_al_days integer not null default 0 check (excluded_al_days >= 0),
  missing_roster_days integer not null default 0 check (missing_roster_days >= 0),
  requires_roster_review boolean not null default false,
  value_per_eligible_day numeric(14,6) not null default 0 check (value_per_eligible_day >= 0),
  calculated_amount numeric(14,6) not null default 0 check (calculated_amount >= 0),
  final_amount numeric(14,2) not null default 0 check (final_amount >= 0),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(distribution_id, staff_id)
);

create table if not exists bill_tip_manual_allocations (
  id uuid primary key,
  distribution_id uuid not null references bill_tip_distributions(id) on delete restrict,
  linked_staff_id uuid references staff(id) on delete restrict,
  helper_name text not null,
  staff_reference text,
  department text,
  outlet text,
  fixed_amount numeric(14,2) not null check (fixed_amount >= 0),
  reason text not null,
  notes text not null default '',
  idempotency_key text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists bill_tip_manual_allocation_retry_unique on bill_tip_manual_allocations(distribution_id, idempotency_key) where idempotency_key is not null;

create table if not exists incentive_rules (
  id uuid primary key,
  rule_key text not null,
  configuration_option_id uuid references configuration_options(id) on delete restrict,
  source_key text not null,
  rule_family text not null check (rule_family in ('no_incentive','food_percentage','wine_spirits_tier')),
  version integer not null check (version >= 1),
  effective_from date not null,
  effective_to date,
  rate_percent numeric(9,4),
  active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check (rate_percent is null or rate_percent >= 0),
  unique(rule_key, version)
);
create unique index if not exists incentive_rule_one_active_version on incentive_rules(rule_key) where active=true;

create table if not exists incentive_rule_tiers (
  id uuid primary key,
  rule_id uuid not null references incentive_rules(id) on delete restrict,
  minimum_amount numeric(14,2) not null check (minimum_amount >= 0),
  maximum_amount numeric(14,2),
  reward_mode text not null check (reward_mode in ('none','fixed','percentage')),
  reward_value numeric(14,4) not null default 0 check (reward_value >= 0),
  sort_order integer not null,
  check (maximum_amount is null or maximum_amount >= minimum_amount),
  unique(rule_id, sort_order)
);

create table if not exists financial_rate_versions (
  id uuid primary key,
  version integer not null unique check (version >= 1),
  effective_from date not null,
  effective_to date,
  service_charge_rate numeric(9,4) not null check (service_charge_rate >= 0),
  gst_rate numeric(9,4) not null check (gst_rate >= 0),
  active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create unique index if not exists financial_rate_one_active_version on financial_rate_versions((true)) where active=true;
create index if not exists financial_rate_effective_date_idx on financial_rate_versions(effective_from, effective_to);

create table if not exists chargeable_incentive_earnings (
  id uuid primary key,
  source_chargeable_item_id uuid not null references chargeable_item_records(id) on delete restrict,
  seller_id uuid not null references staff(id) on delete restrict,
  seller_name_snapshot text not null,
  seller_number_snapshot text not null,
  designation_snapshot text not null,
  service_date date not null,
  package_identity text not null,
  quantity integer not null check (quantity >= 1),
  guest_amount numeric(14,2) not null check (guest_amount >= 0),
  eligible_net_amount numeric(14,2) not null check (eligible_net_amount >= 0),
  incentive_rule_id uuid not null references incentive_rules(id) on delete restrict,
  incentive_rule_version integer not null check (incentive_rule_version >= 1),
  rule_family_snapshot text not null check (rule_family_snapshot in ('no_incentive','food_percentage','wine_spirits_tier')),
  applied_rate_percent numeric(9,4),
  applied_fixed_amount numeric(14,4),
  applied_tier_minimum numeric(14,2),
  applied_tier_maximum numeric(14,2),
  calculated_amount numeric(14,6) not null check (calculated_amount >= 0),
  final_amount numeric(14,2) not null check (final_amount >= 0),
  status text not null default 'draft' check (status in ('draft','finalized','reversed')),
  generation_key text not null unique,
  reversal_of_id uuid references chargeable_incentive_earnings(id) on delete restrict,
  finalized_at timestamptz,
  finalized_by text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists chargeable_incentive_one_current_per_sale on chargeable_incentive_earnings(source_chargeable_item_id) where status in ('draft','finalized');
create unique index if not exists chargeable_incentive_one_reversal on chargeable_incentive_earnings(reversal_of_id) where reversal_of_id is not null;
alter table chargeable_incentive_earnings add column if not exists financial_rate_version_id uuid references financial_rate_versions(id) on delete restrict;
alter table chargeable_incentive_earnings add column if not exists financial_rate_version integer check (financial_rate_version is null or financial_rate_version >= 1);
alter table chargeable_incentive_earnings add column if not exists service_charge_rate numeric(9,4) check (service_charge_rate is null or service_charge_rate >= 0);
alter table chargeable_incentive_earnings add column if not exists gst_rate numeric(9,4) check (gst_rate is null or gst_rate >= 0);

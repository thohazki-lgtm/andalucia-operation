-- Training R2 additive evidence and synchronization foundation.
-- Scheduled source data remains separate from immutable manager-confirmed evidence.

alter table training_sessions add column if not exists outlet_scope_id uuid;
update training_sessions
set outlet_scope_id='00000000-0000-4000-8000-00000000a001'
where outlet_scope_id is null;
alter table training_sessions alter column outlet_scope_id set not null;
alter table training_sessions
  add constraint training_sessions_outlet_scope_fk
  foreign key(outlet_scope_id) references outlet_scopes(id) on delete restrict;
create index if not exists training_sessions_outlet_date_idx
  on training_sessions(outlet_scope_id,training_date,training_time);

create table training_sync_runs (
  id uuid primary key,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  source_type text not null check(source_type in ('sharepoint')),
  source_container_id text not null check(length(trim(source_container_id))>0),
  source_document_id text not null check(length(trim(source_document_id))>0),
  worksheet_identity text not null check(length(trim(worksheet_identity))>0),
  status text not null check(status in ('running','succeeded','failed','partial')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  rows_seen integer not null default 0 check(rows_seen>=0),
  rows_created integer not null default 0 check(rows_created>=0),
  rows_updated integer not null default 0 check(rows_updated>=0),
  rows_unchanged integer not null default 0 check(rows_unchanged>=0),
  rows_requires_review integer not null default 0 check(rows_requires_review>=0),
  error_code text,
  error_summary text,
  triggered_by text not null check(triggered_by in ('manual','scheduled')),
  actor_user_id uuid references user_accounts(id) on delete restrict,
  actor_name_snapshot text,
  created_at timestamptz not null default now(),
  constraint training_sync_run_completion_check check(
    (status='running' and completed_at is null)
    or (status<>'running' and completed_at is not null)
  ),
  constraint training_sync_run_actor_check check(
    (triggered_by='scheduled')
    or (actor_user_id is not null and length(trim(actor_name_snapshot))>0)
  )
);
create index training_sync_runs_source_idx
  on training_sync_runs(outlet_scope_id,source_document_id,started_at desc);

create table training_external_source_records (
  id uuid primary key,
  training_session_id uuid not null references training_sessions(id) on delete restrict,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  source_type text not null check(source_type in ('sharepoint')),
  source_container_id text not null check(length(trim(source_container_id))>0),
  source_document_id text not null check(length(trim(source_document_id))>0),
  worksheet_identity text not null check(length(trim(worksheet_identity))>0),
  external_record_id text not null check(length(trim(external_record_id))>0),
  external_revision text,
  source_row_sha256 text not null check(source_row_sha256 ~ '^[0-9a-f]{64}$'),
  source_payload jsonb not null default '{}'::jsonb check(jsonb_typeof(source_payload)='object'),
  first_seen_sync_run_id uuid not null references training_sync_runs(id) on delete restrict,
  last_seen_sync_run_id uuid not null references training_sync_runs(id) on delete restrict,
  first_synced_at timestamptz not null,
  last_synced_at timestamptz not null,
  source_active boolean not null default true,
  missing_from_source_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(training_session_id),
  unique(outlet_scope_id,source_type,source_container_id,source_document_id,worksheet_identity,external_record_id),
  constraint training_external_source_missing_check check(
    (source_active and missing_from_source_at is null)
    or (not source_active and missing_from_source_at is not null)
  )
);
create index training_external_source_records_sync_idx
  on training_external_source_records(last_seen_sync_run_id,source_active);

create table training_target_versions (
  id uuid primary key,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  version_number integer not null check(version_number>=1),
  effective_month date not null check(effective_month=date_trunc('month',effective_month)::date),
  monthly_target_credited_minutes integer not null check(monthly_target_credited_minutes>0),
  per_head_target_minutes integer not null check(per_head_target_minutes>0),
  participant_credit_cap_minutes integer not null check(participant_credit_cap_minutes>0),
  calculation_policy_version text not null check(length(trim(calculation_policy_version))>0),
  approved_by_user_id uuid references user_accounts(id) on delete restrict,
  approved_by_name_snapshot text not null check(length(trim(approved_by_name_snapshot))>0),
  approved_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(outlet_scope_id,version_number),
  unique(outlet_scope_id,effective_month)
);

insert into training_target_versions(
  id,outlet_scope_id,version_number,effective_month,
  monthly_target_credited_minutes,per_head_target_minutes,
  participant_credit_cap_minutes,calculation_policy_version,
  approved_by_name_snapshot,approved_at
) values (
  '00000000-0000-4000-8000-000000016001',
  '00000000-0000-4000-8000-00000000a001',1,'2026-09-01',
  3600,216,30,'training-credit-v1','Approved Training R2 business policy',now()
);

create table training_session_completion_evidence (
  id uuid primary key,
  training_session_id uuid not null references training_sessions(id) on delete restrict,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  revision_number integer not null check(revision_number>=1),
  outcome text not null check(outcome in ('awaiting_confirmation','completed','cancelled','requires_review')),
  actual_duration_minutes integer,
  credited_minutes_per_participant integer not null default 0 check(credited_minutes_per_participant between 0 and 30),
  calculation_policy_version text not null check(length(trim(calculation_policy_version))>0),
  confirmed_by_user_id uuid not null references user_accounts(id) on delete restrict,
  confirmed_by_name_snapshot text not null check(length(trim(confirmed_by_name_snapshot))>0),
  confirmed_at timestamptz not null,
  correction_reason text,
  supersedes_completion_id uuid references training_session_completion_evidence(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(training_session_id,revision_number),
  unique(supersedes_completion_id),
  constraint training_completion_credit_check check(
    (outcome='completed' and actual_duration_minutes>0
      and credited_minutes_per_participant=least(actual_duration_minutes,30))
    or (outcome<>'completed' and credited_minutes_per_participant=0)
  ),
  constraint training_completion_revision_check check(
    (revision_number=1 and supersedes_completion_id is null)
    or (revision_number>1 and supersedes_completion_id is not null and length(trim(correction_reason))>0)
  )
);
create index training_completion_session_idx
  on training_session_completion_evidence(training_session_id,revision_number desc);

create table training_session_staff_evidence (
  id uuid primary key,
  completion_evidence_id uuid not null references training_session_completion_evidence(id) on delete restrict,
  training_session_id uuid not null references training_sessions(id) on delete restrict,
  staff_id uuid not null references staff(id) on delete restrict,
  staff_name_snapshot text not null check(length(trim(staff_name_snapshot))>0),
  staff_number_snapshot text not null check(length(trim(staff_number_snapshot))>0),
  membership_history_id uuid references staff_membership_history(id) on delete restrict,
  roster_entry_id uuid references duty_roster_entries(id) on delete restrict,
  duty_code_value_snapshot text,
  duty_metadata_snapshot jsonb check(duty_metadata_snapshot is null or jsonb_typeof(duty_metadata_snapshot)='object'),
  eligibility_state text not null check(eligibility_state in ('eligible','excluded_off','excluded_annual_leave','requires_review')),
  participation_state text not null check(participation_state in ('participated','did_not_participate','not_applicable','requires_review')),
  credited_minutes integer not null default 0 check(credited_minutes between 0 and 30),
  evidence_note text,
  confirmed_by_user_id uuid not null references user_accounts(id) on delete restrict,
  confirmed_by_name_snapshot text not null check(length(trim(confirmed_by_name_snapshot))>0),
  confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(completion_evidence_id,staff_id),
  constraint training_staff_evidence_state_check check(
    (eligibility_state='eligible' and participation_state in ('participated','did_not_participate'))
    or (eligibility_state in ('excluded_off','excluded_annual_leave') and participation_state='not_applicable')
    or (eligibility_state='requires_review' and participation_state='requires_review')
  ),
  constraint training_staff_evidence_credit_check check(
    (participation_state='participated' and credited_minutes between 1 and 30)
    or (participation_state<>'participated' and credited_minutes=0)
  )
);
create index training_staff_evidence_staff_idx
  on training_session_staff_evidence(staff_id,training_session_id);

create or replace function validate_training_staff_evidence() returns trigger language plpgsql as $$
declare
  completion_row training_session_completion_evidence%rowtype;
begin
  select * into completion_row from training_session_completion_evidence where id=new.completion_evidence_id;
  if completion_row.id is null or completion_row.training_session_id<>new.training_session_id then
    raise exception 'Training staff evidence must match its completion session.' using errcode='23514';
  end if;
  if new.participation_state='participated' then
    if completion_row.outcome<>'completed' or new.credited_minutes<>completion_row.credited_minutes_per_participant then
      raise exception 'Training credit requires completed evidence and the approved credit cap.' using errcode='23514';
    end if;
  elsif new.credited_minutes<>0 then
    raise exception 'Non-participants cannot receive Training credit.' using errcode='23514';
  end if;
  return new;
end $$;

create trigger training_staff_evidence_validation
  before insert on training_session_staff_evidence
  for each row execute function validate_training_staff_evidence();

create or replace function protect_training_evidence() returns trigger language plpgsql as $$
begin
  raise exception 'Confirmed Training evidence is immutable; create a new revision.' using errcode='23514';
end $$;

create trigger training_completion_evidence_immutable
  before update or delete on training_session_completion_evidence
  for each row execute function protect_training_evidence();
create trigger training_staff_evidence_immutable
  before update or delete on training_session_staff_evidence
  for each row execute function protect_training_evidence();
create trigger training_target_version_immutable
  before update or delete on training_target_versions
  for each row execute function protect_training_evidence();

create view training_completed_session_metrics as
select
  completion.id completion_evidence_id,
  completion.training_session_id,
  completion.outlet_scope_id,
  session.training_date,
  completion.revision_number,
  completion.outcome,
  completion.actual_duration_minutes,
  completion.credited_minutes_per_participant,
  count(staff.id) filter(where staff.eligibility_state='eligible')::integer eligible_staff_count,
  count(staff.id) filter(where staff.participation_state='participated')::integer participant_count,
  coalesce(sum(staff.credited_minutes),0)::integer credited_minutes,
  count(staff.id) filter(where staff.eligibility_state='requires_review')::integer requires_review_count
from training_session_completion_evidence completion
join training_sessions session on session.id=completion.training_session_id
left join training_session_staff_evidence staff on staff.completion_evidence_id=completion.id
where not exists (
  select 1 from training_session_completion_evidence later
  where later.training_session_id=completion.training_session_id
    and later.revision_number>completion.revision_number
)
group by completion.id,session.training_date;

create table training_monthly_metric_snapshots (
  id uuid primary key,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  month_start date not null check(month_start=date_trunc('month',month_start)::date),
  snapshot_revision integer not null check(snapshot_revision>=1),
  target_version_id uuid not null references training_target_versions(id) on delete restrict,
  membership_baseline_revision_id uuid references staff_membership_baseline_reviews(id) on delete restrict,
  calculation_policy_version text not null check(length(trim(calculation_policy_version))>0),
  sessions_scheduled integer not null check(sessions_scheduled>=0),
  sessions_completed integer not null check(sessions_completed>=0),
  confirmed_participants integer not null check(confirmed_participants>=0),
  credited_minutes integer not null check(credited_minutes>=0),
  eligible_headcount integer check(eligible_headcount>=0),
  staff_covered integer not null check(staff_covered>=0),
  requires_review boolean not null,
  evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  staff_coverage_payload jsonb not null default '[]'::jsonb check(jsonb_typeof(staff_coverage_payload)='array'),
  approved_report_reference text,
  frozen_by_user_id uuid not null references user_accounts(id) on delete restrict,
  frozen_by_name_snapshot text not null check(length(trim(frozen_by_name_snapshot))>0),
  frozen_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(outlet_scope_id,month_start,snapshot_revision),
  constraint training_monthly_headcount_check check(
    not (eligible_headcount=0 and not requires_review)
  )
);
create index training_monthly_snapshot_period_idx
  on training_monthly_metric_snapshots(outlet_scope_id,month_start desc,snapshot_revision desc);
create trigger training_monthly_snapshot_immutable
  before update or delete on training_monthly_metric_snapshots
  for each row execute function protect_training_evidence();

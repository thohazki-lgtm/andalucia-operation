-- Booking Intelligence Engine R1 additive persistence foundation.
-- This migration creates no findings and does not reinterpret existing bookings.

create table booking_intelligence_findings (
  id uuid primary key,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  booking_id uuid not null references bookings(id) on delete restrict,
  import_batch_id uuid references booking_import_batches(id) on delete restrict,
  guest_member_id uuid references booking_guest_members(id) on delete restrict,
  finding_type text not null check(finding_type ~ '^[a-z][a-z0-9_]*$'),
  normalized_key text not null check(normalized_key ~ '^[A-Z][A-Z0-9_]*$'),
  raw_evidence_text text not null check(length(trim(raw_evidence_text))>0),
  detected_phrase text,
  evidence_location text not null check(length(trim(evidence_location))>0),
  evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  rule_key text not null check(length(trim(rule_key))>0),
  rule_version text not null check(length(trim(rule_version))>0),
  source_payload jsonb not null default '{}'::jsonb check(jsonb_typeof(source_payload)='object'),
  detected_payload jsonb not null default '{}'::jsonb check(jsonb_typeof(detected_payload)='object'),
  effective_payload jsonb not null default '{}'::jsonb check(jsonb_typeof(effective_payload)='object'),
  resolution_method text not null check(length(trim(resolution_method))>0),
  confidence numeric(5,4) check(confidence between 0 and 1),
  review_state text not null default 'not_required'
    check(review_state in ('not_required','required','in_review','resolved','dismissed')),
  review_required boolean not null default false,
  manager_override_payload jsonb check(manager_override_payload is null or jsonb_typeof(manager_override_payload)='object'),
  manager_correction_reason text,
  active boolean not null default true,
  superseded_by_id uuid unique references booking_intelligence_findings(id) on delete restrict,
  created_by_user_id uuid references user_accounts(id) on delete restrict,
  created_by_actor text not null check(length(trim(created_by_actor))>0),
  updated_by_user_id uuid references user_accounts(id) on delete restrict,
  updated_by_actor text not null check(length(trim(updated_by_actor))>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(booking_id,finding_type,normalized_key,evidence_sha256,rule_version),
  constraint booking_intelligence_review_state_check check(
    not review_required or review_state in ('required','in_review')
  ),
  constraint booking_intelligence_override_check check(
    manager_override_payload is null
    or (length(trim(manager_correction_reason))>0 and updated_by_user_id is not null)
  ),
  constraint booking_intelligence_supersession_check check(
    superseded_by_id is null or not active
  )
);

create index booking_intelligence_booking_idx
  on booking_intelligence_findings(booking_id,active,created_at desc);
create index booking_intelligence_type_idx
  on booking_intelligence_findings(outlet_scope_id,finding_type,normalized_key,active);
create index booking_intelligence_review_idx
  on booking_intelligence_findings(outlet_scope_id,review_state,review_required)
  where review_required or review_state in ('required','in_review');
create index booking_intelligence_lifecycle_idx
  on booking_intelligence_findings(outlet_scope_id,active,superseded_by_id);

create or replace function validate_booking_intelligence_finding() returns trigger language plpgsql as $$
declare
  booking_venue text;
  outlet_key text;
  member_booking uuid;
  superseding_booking uuid;
begin
  select venue_key into booking_venue from bookings where id=new.booking_id;
  select scope_key into outlet_key from outlet_scopes where id=new.outlet_scope_id;
  if booking_venue is null or outlet_key is null or lower(trim(booking_venue))<>lower(trim(outlet_key)) then
    raise exception 'Booking intelligence must use the Booking outlet scope.' using errcode='23514';
  end if;

  if new.guest_member_id is not null then
    select booking_id into member_booking from booking_guest_members where id=new.guest_member_id;
    if member_booking is null or member_booking<>new.booking_id then
      raise exception 'Booking intelligence guest evidence must belong to the same Booking.' using errcode='23514';
    end if;
  end if;

  if new.superseded_by_id is not null then
    select booking_id into superseding_booking from booking_intelligence_findings where id=new.superseded_by_id;
    if superseding_booking is null or superseding_booking<>new.booking_id then
      raise exception 'A superseding intelligence finding must belong to the same Booking.' using errcode='23514';
    end if;
  end if;
  return new;
end $$;

create trigger booking_intelligence_finding_validation
  before insert or update on booking_intelligence_findings
  for each row execute function validate_booking_intelligence_finding();

create or replace function protect_booking_intelligence_source_evidence() returns trigger language plpgsql as $$
begin
  if old.outlet_scope_id is distinct from new.outlet_scope_id
    or old.booking_id is distinct from new.booking_id
    or old.import_batch_id is distinct from new.import_batch_id
    or old.guest_member_id is distinct from new.guest_member_id
    or old.finding_type is distinct from new.finding_type
    or old.normalized_key is distinct from new.normalized_key
    or old.raw_evidence_text is distinct from new.raw_evidence_text
    or old.detected_phrase is distinct from new.detected_phrase
    or old.evidence_location is distinct from new.evidence_location
    or old.evidence_sha256 is distinct from new.evidence_sha256
    or old.rule_key is distinct from new.rule_key
    or old.rule_version is distinct from new.rule_version
    or old.source_payload is distinct from new.source_payload
    or old.detected_payload is distinct from new.detected_payload
    or old.resolution_method is distinct from new.resolution_method
    or old.created_by_user_id is distinct from new.created_by_user_id
    or old.created_by_actor is distinct from new.created_by_actor
    or old.created_at is distinct from new.created_at then
    raise exception 'Booking intelligence source and detection evidence is immutable.' using errcode='23514';
  end if;
  return new;
end $$;

create trigger booking_intelligence_source_evidence_immutable
  before update on booking_intelligence_findings
  for each row execute function protect_booking_intelligence_source_evidence();

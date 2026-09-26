do $$
declare andalucia_id uuid;
begin
  select id into andalucia_id from outlet_scopes where scope_key='andalucia' and active=true;
  if andalucia_id is null then
    raise exception 'Migration 018 requires the active canonical Andalucia OutletScope.' using errcode='23514';
  end if;
  if (select count(*) from outlet_scopes where scope_key='andalucia' and active=true)<>1 then
    raise exception 'Migration 018 requires exactly one active canonical Andalucia OutletScope.' using errcode='23514';
  end if;
end $$;

alter table maintenance_issues add column if not exists outlet_scope_id uuid;
alter table maintenance_issues add column if not exists reference_follow_up text;
alter table maintenance_issues add column if not exists completed_at timestamptz;
alter table maintenance_issues add column if not exists completed_by_user_id uuid;
alter table maintenance_issues add column if not exists completed_by_name_snapshot text;
alter table maintenance_issues add column if not exists reporter_name_snapshot text;
alter table maintenance_issues add column if not exists reporter_number_snapshot text;
alter table maintenance_issues add column if not exists revision integer not null default 1;

update maintenance_issues issue
set outlet_scope_id=scope.id
from outlet_scopes scope
where issue.outlet_scope_id is null and scope.scope_key='andalucia' and scope.active=true;

alter table maintenance_issues alter column outlet_scope_id set not null;
alter table maintenance_issues add constraint maintenance_issue_outlet_scope_fk foreign key(outlet_scope_id) references outlet_scopes(id) on delete restrict;
alter table maintenance_issues add constraint maintenance_issue_completed_by_fk foreign key(completed_by_user_id) references user_accounts(id) on delete restrict;
alter table maintenance_issues add constraint maintenance_issue_revision_check check(revision>=1);
alter table maintenance_issues add constraint maintenance_issue_completion_evidence_check check(
  (completed_at is null and completed_by_user_id is null and completed_by_name_snapshot is null)
  or (completed_at is not null and completed_by_user_id is not null and length(trim(completed_by_name_snapshot))>0)
);
create index if not exists maintenance_issue_outlet_date_idx on maintenance_issues(outlet_scope_id,issue_date desc,created_at desc);
create index if not exists maintenance_issue_outlet_status_priority_idx on maintenance_issues(outlet_scope_id,status,priority);
create index if not exists maintenance_issue_completed_at_idx on maintenance_issues(outlet_scope_id,completed_at) where completed_at is not null;

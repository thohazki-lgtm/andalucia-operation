alter table user_accounts
  add column if not exists must_change_password boolean not null default false;

create unique index if not exists user_accounts_one_active_per_staff
  on user_accounts(staff_id)
  where staff_id is not null and status = 'active';

insert into authorization_roles(id,role_key,display_name,active,global_scope,created_by,updated_by)
values('00000000-0000-4000-8000-000000001005','employee_self_service','Employee Self Service',true,false,'migration 023','migration 023')
on conflict(role_key) do nothing;

insert into authorization_permissions(id,permission_key,display_name,description,active,created_by,updated_by) values
  ('00000000-0000-4000-8000-000000002023','view_own_roster','View Own Roster','View only the roster assigned to the linked Staff profile.',true,'migration 023','migration 023'),
  ('00000000-0000-4000-8000-000000002024','view_own_timesheet','View Own Timesheet','View only timesheets belonging to the linked Staff profile.',true,'migration 023','migration 023'),
  ('00000000-0000-4000-8000-000000002025','edit_own_timesheet','Edit Own Timesheet','Edit only draft timesheets belonging to the linked Staff profile.',true,'migration 023','migration 023'),
  ('00000000-0000-4000-8000-000000002026','confirm_own_timesheet_days','Confirm Own Timesheet Days','Confirm only timesheet days belonging to the linked Staff profile.',true,'migration 023','migration 023'),
  ('00000000-0000-4000-8000-000000002027','submit_own_timesheet_month','Submit Own Timesheet Month','Submit only a monthly timesheet belonging to the linked Staff profile.',true,'migration 023','migration 023')
on conflict(permission_key) do nothing;

insert into authorization_role_permissions(role_id,permission_id,created_by)
select role.id,permission.id,'migration 023'
from authorization_roles role
cross join authorization_permissions permission
where role.role_key='employee_self_service'
  and permission.permission_key in ('view_own_roster','view_own_timesheet','edit_own_timesheet','confirm_own_timesheet_days','submit_own_timesheet_month')
on conflict(role_id,permission_id) do nothing;

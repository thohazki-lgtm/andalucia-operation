create table if not exists authorization_roles (
  id uuid primary key, role_key text not null unique check (role_key ~ '^[a-z][a-z0-9_]*$'),
  display_name text not null check (length(trim(display_name)) > 0), active boolean not null default true,
  global_scope boolean not null default false, created_by text, updated_by text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists authorization_permissions (
  id uuid primary key, permission_key text not null unique check (permission_key ~ '^[a-z][a-z0-9_]*$'),
  display_name text not null check (length(trim(display_name)) > 0), description text not null default '',
  active boolean not null default true, created_by text, updated_by text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists authorization_role_permissions (
  role_id uuid not null references authorization_roles(id) on delete restrict,
  permission_id uuid not null references authorization_permissions(id) on delete restrict,
  created_by text, created_at timestamptz not null default now(), primary key(role_id,permission_id)
);
create table if not exists authorization_user_roles (
  id uuid primary key, user_id uuid not null references user_accounts(id) on delete cascade,
  role_id uuid not null references authorization_roles(id) on delete restrict, active boolean not null default true,
  created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,role_id)
);
create table if not exists authorization_user_outlet_scopes (
  id uuid primary key, user_id uuid not null references user_accounts(id) on delete cascade,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict, active boolean not null default true,
  created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,outlet_scope_id)
);
create index if not exists authorization_user_roles_user_idx on authorization_user_roles(user_id,active);
create index if not exists authorization_user_outlet_user_idx on authorization_user_outlet_scopes(user_id,active);
create or replace function protect_authorization_role_key() returns trigger language plpgsql as $$
begin if old.role_key <> new.role_key then raise exception 'Role key is immutable.' using errcode='23514'; end if; return new; end $$;
create or replace function protect_authorization_permission_key() returns trigger language plpgsql as $$
begin if old.permission_key <> new.permission_key then raise exception 'Permission key is immutable.' using errcode='23514'; end if; return new; end $$;
drop trigger if exists authorization_role_key_immutable on authorization_roles;
create trigger authorization_role_key_immutable before update on authorization_roles for each row execute function protect_authorization_role_key();
drop trigger if exists authorization_permission_key_immutable on authorization_permissions;
create trigger authorization_permission_key_immutable before update on authorization_permissions for each row execute function protect_authorization_permission_key();

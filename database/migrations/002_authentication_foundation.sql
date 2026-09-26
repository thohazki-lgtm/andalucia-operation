create table if not exists user_accounts (
  id uuid primary key, login_identifier text not null, normalized_login_identifier text not null unique,
  display_name text not null check (length(trim(display_name)) > 0), password_hash text not null,
  status text not null default 'active' check (status in ('active','disabled')),
  staff_id uuid references staff(id) on delete set null, last_login_at timestamptz,
  created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (length(normalized_login_identifier) between 3 and 254)
);
create table if not exists auth_sessions (
  id uuid primary key, token_hash text not null unique, user_id uuid not null references user_accounts(id) on delete cascade,
  expires_at timestamptz not null, revoked_at timestamptz, last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(), check (expires_at > created_at)
);
create table if not exists auth_security_events (
  id uuid primary key, user_id uuid references user_accounts(id) on delete set null,
  session_id uuid references auth_sessions(id) on delete set null, event_type text not null, success boolean not null,
  identifier_hash text, details jsonb not null default '{}', actor_user_id uuid references user_accounts(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists auth_sessions_user_status_idx on auth_sessions(user_id,revoked_at,expires_at);
create index if not exists auth_security_events_user_date_idx on auth_security_events(user_id,created_at);

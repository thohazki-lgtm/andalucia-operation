create table if not exists schema_migrations (
  version text primary key,
  name text not null,
  checksum text not null,
  status text not null check (status in ('applied')),
  actor_source text not null,
  notes text not null default '',
  applied_at timestamptz not null default now()
);

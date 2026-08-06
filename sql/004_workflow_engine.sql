-- Phase 4: configurable workflow stages + status history.
-- Adding a future stage (e.g. "Quality Check") is just a row insert here -
-- no code or table changes needed; it appears automatically in the
-- bill-detail "change status" dropdown.

create table if not exists workflow_stages (
  id text primary key,
  name text not null,
  sort_order integer not null,
  is_active boolean not null default true,
  color text
);

insert into workflow_stages (id, name, sort_order, color) values
  ('received', 'Received', 1, 'amber'),
  ('processing', 'Processing', 2, 'accent'),
  ('packed', 'Packed', 3, 'accent'),
  ('dispatched', 'Dispatched', 4, 'green'),
  ('delivered', 'Delivered', 5, 'green'),
  ('returned', 'Returned', 6, 'red'),
  ('cancelled', 'Cancelled', 7, 'red')
on conflict (id) do nothing;

alter table workflow_stages enable row level security;
drop policy if exists "authenticated full access" on workflow_stages;
create policy "authenticated full access" on workflow_stages
  for all to authenticated using (true) with check (true);

create table if not exists status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  stage text not null,
  changed_by text,
  remarks text,
  created_at timestamptz not null default now()
);

alter table status_history enable row level security;
drop policy if exists "authenticated full access" on status_history;
create policy "authenticated full access" on status_history
  for all to authenticated using (true) with check (true);

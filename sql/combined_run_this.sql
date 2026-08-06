-- Base: transfer notes (in case this wasn't created earlier)
create table if not exists transfer_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null references customers(id),
  transfer_no text not null,
  transfer_date date not null default current_date,
  order_ids jsonb not null default '[]',
  total_pieces numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table transfer_notes enable row level security;
drop policy if exists "authenticated full access" on transfer_notes;
create policy "authenticated full access" on transfer_notes
  for all to authenticated using (true) with check (true);

alter table orders add column if not exists transfer_note_id uuid;

-- Phase 1: bill identity fields + sequential unique code generator (e.g. SH00000001)

alter table orders add column if not exists bill_number text;
alter table orders add column if not exists guest_name text;
alter table orders add column if not exists customer_mobile text;
alter table orders add column if not exists room_number text;
alter table orders add column if not exists packing_method text;
alter table orders add column if not exists unique_code text;
alter table orders add column if not exists receipt_number text;
alter table orders add column if not exists packet_count integer;
alter table orders add column if not exists packed_by text;
alter table orders add column if not exists packed_at timestamptz;

create unique index if not exists orders_unique_code_idx on orders(unique_code);

create table if not exists code_counters (
  customer_id text primary key references customers(id),
  next_seq integer not null default 1
);

alter table code_counters enable row level security;
drop policy if exists "authenticated full access" on code_counters;
create policy "authenticated full access" on code_counters
  for all to authenticated using (true) with check (true);

create or replace function next_unique_code(p_customer_id text)
returns text
language plpgsql
as $$
declare
  v_seq integer;
  v_prefix text;
begin
  insert into code_counters (customer_id, next_seq) values (p_customer_id, 1)
  on conflict (customer_id) do nothing;

  update code_counters set next_seq = next_seq + 1
  where customer_id = p_customer_id
  returning next_seq - 1 into v_seq;

  select code into v_prefix from customers where id = p_customer_id;
  return v_prefix || lpad(v_seq::text, 8, '0');
end;
$$;

create or replace function next_unique_codes(p_customer_id text, p_count integer)
returns text[]
language plpgsql
as $$
declare
  v_start integer;
  v_prefix text;
  v_codes text[] := '{}';
  i integer;
begin
  insert into code_counters (customer_id, next_seq) values (p_customer_id, 1)
  on conflict (customer_id) do nothing;

  update code_counters set next_seq = next_seq + p_count
  where customer_id = p_customer_id
  returning next_seq - p_count into v_start;

  select code into v_prefix from customers where id = p_customer_id;
  for i in 0..p_count-1 loop
    v_codes := array_append(v_codes, v_prefix || lpad((v_start + i)::text, 8, '0'));
  end loop;
  return v_codes;
end;
$$;

-- Phase 3: Dispatch screen fields

alter table transfer_notes add column if not exists driver_name text;
alter table transfer_notes add column if not exists vehicle_number text;
alter table transfer_notes add column if not exists destination_outlet text;
alter table transfer_notes add column if not exists total_packets numeric;

alter table orders add column if not exists dispatched_by text;
alter table orders add column if not exists dispatched_at timestamptz;

-- Phase 4: configurable workflow stages + status history

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

-- Phase 5: user roles (label/audit only - not used to restrict screens)

create table if not exists user_roles (
  email text primary key,
  role text not null default 'operator'
);

alter table user_roles enable row level security;
drop policy if exists "authenticated full access" on user_roles;
create policy "authenticated full access" on user_roles
  for all to authenticated using (true) with check (true);

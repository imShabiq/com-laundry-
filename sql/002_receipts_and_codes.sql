-- Phase 1: bill identity fields + sequential unique code generator (e.g. SH00000001)

-- Note: orders.customer_name already exists and holds the HOTEL/account name (e.g. "Sheraton").
-- guest_name below is the separate, per-bill customer name from the spec ("Customer Name" on the receipt).
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

-- Bulk variant for Excel import (one round trip for N bills instead of N round trips).
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

-- Phase 3: Dispatch screen fields

alter table transfer_notes add column if not exists driver_name text;
alter table transfer_notes add column if not exists vehicle_number text;
alter table transfer_notes add column if not exists destination_outlet text;
alter table transfer_notes add column if not exists total_packets numeric;

alter table orders add column if not exists dispatched_by text;
alter table orders add column if not exists dispatched_at timestamptz;

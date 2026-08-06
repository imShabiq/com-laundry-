-- Phase 5: user roles (label/audit only, per your choice - not used to restrict screens)

create table if not exists user_roles (
  email text primary key,
  role text not null default 'operator'
);

alter table user_roles enable row level security;
drop policy if exists "authenticated full access" on user_roles;
create policy "authenticated full access" on user_roles
  for all to authenticated using (true) with check (true);

-- To promote someone to admin or dispatcher later, just update their row, e.g.:
-- update user_roles set role = 'admin' where email = 'someone@example.com';

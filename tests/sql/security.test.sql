-- v7.30.0 (Batch M · M-1): the database rules of supabase/security.sql, tried on a plain PostgreSQL that imitates Supabase's
-- roles and sign-in claims. Run by tests/security-sql.cjs (skipped where no PostgreSQL is reachable). Each check raises on failure.
\set ON_ERROR_STOP on
drop schema if exists public cascade; create schema public; drop schema if exists auth cascade; create schema auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public, auth to anon, authenticated, service_role;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant execute on function auth.jwt() to anon, authenticated, service_role;
-- the shared store, exactly as docs/SHARED_STORE_SETUP.md sets it up
create table public.stores (key text primary key, data jsonb not null default '[]'::jsonb, version bigint not null default 1, updated_at timestamptz not null default now(), updated_by text);
alter table public.stores enable row level security;
create policy "marianna read" on public.stores for select to authenticated using (true);
create policy "marianna insert" on public.stores for insert to authenticated with check (true);
create policy "marianna update" on public.stores for update to authenticated using (true) with check (true);
grant select, insert, update on public.stores to authenticated;
\i supabase/security.sql
-- helpers: act as a signed-in user, and expect a refusal
create or replace function public.t_expect_refused(sql text, what text) returns void language plpgsql as $$
declare n int;
begin
begin execute sql; get diagnostics n = row_count;
exception when insufficient_privilege or check_violation then raise notice 'OK refused: %', what; return;
when others then if sqlerrm like '%row-level security%' or sqlerrm like '%MARIANNA%' then raise notice 'OK refused: %', what; return; end if; raise; end;
-- a row the policy hides is simply not changed (0 rows) — the API answers with nothing changed
if n = 0 then raise notice 'OK refused (nothing changed): %', what; return; end if;
raise exception 'FAILED — should have been refused: %', what;
end $$;
create or replace function public.t_expect_ok(sql text, what text) returns void language plpgsql as $$
begin execute sql; raise notice 'OK allowed: %', what; end $$;
grant execute on function public.t_expect_refused(text, text), public.t_expect_ok(text, text) to authenticated;

-- 1. a fresh copy: nobody is owner yet — the first setup is open
set role authenticated; select set_config('request.jwt.claims', '{"email":"anna@firm.pl"}', false);
select public.t_expect_ok($q$insert into public.stores(key, data) values ('users', '[{"id":1,"name":"Owner","email":"","isOwner":true}]')$q$, 'a fresh copy: anyone sets up the users');
select public.t_expect_ok($q$update public.stores set data = '[{"id":1,"name":"Owner","email":"owner@firm.pl","isOwner":true},{"id":2,"name":"Anna","email":"anna@firm.pl","isOwner":false}]' where key = 'users'$q$, 'a fresh copy: the owner entry linked to its e-mail');
-- 2. an owner exists: a non-owner cannot change the protected lists, but works on the business lists as before
select public.t_expect_refused($q$update public.stores set data = '[{"id":2,"name":"Anna","email":"anna@firm.pl","isOwner":true}]' where key = 'users'$q$, 'a non-owner makes herself owner');
select public.t_expect_refused($q$insert into public.stores(key, data) values ('closedPeriods', '[]')$q$, 'a non-owner writes the closed months');
select public.t_expect_refused($q$insert into public.stores(key, data) values ('roles', '[]')$q$, 'a non-owner writes the roles');
select public.t_expect_refused($q$insert into public.stores(key, data) values ('company', '{"name":"X"}')$q$, 'a non-owner writes the company profile');
select public.t_expect_ok($q$insert into public.stores(key, data) values ('orders', '[{"number":"SO-1"}]')$q$, 'a non-owner saves a sale');
select public.t_expect_ok($q$update public.stores set data = '[{"number":"SO-1"},{"number":"SO-2"}]' where key = 'orders'$q$, 'a non-owner adds a sale');
select public.t_expect_refused($q$delete from public.stores where key = 'orders'$q$, 'anyone deletes a list');
select public.t_expect_refused($q$update public.stores set key = 'users_old' where key = 'users'$q$, 'a non-owner renames the users list away');
select public.t_expect_refused($q$update public.stores set key = 'users' where key = 'orders'$q$, 'a non-owner renames a list into the users list');
select public.t_expect_refused($q$update public.stores set key = 'orders_old' where key = 'orders'$q$, 'a list renamed');
-- 3. the owner changes them
select set_config('request.jwt.claims', '{"email":"OWNER@firm.pl"}', false);
select public.t_expect_ok($q$insert into public.stores(key, data) values ('closedPeriods', '["2026-09"]')$q$, 'the owner closes a month (e-mail case does not matter)');
select public.t_expect_ok($q$update public.stores set data = '[{"id":1,"name":"Owner","email":"owner@firm.pl","isOwner":true},{"id":2,"name":"Anna","email":"anna@firm.pl","isOwner":false},{"id":3,"name":"Tom","email":"tom@firm.pl","isOwner":false}]' where key = 'users'$q$, 'the owner adds a user');
-- 4. the audit trail only grows
select set_config('request.jwt.claims', '{"email":"anna@firm.pl"}', false);
select public.t_expect_ok($q$insert into public.stores(key, data) values ('auditLog', '[{"id":"a1","summary":"one"},{"id":"a2","summary":"two"}]'), ('auditArchive', '[]')$q$, 'the audit log starts');
select public.t_expect_ok($q$update public.stores set data = data || '[{"id":"a3","summary":"three"}]' where key = 'auditLog'$q$, 'an event is added');
select public.t_expect_refused($q$update public.stores set data = '[{"id":"a2","summary":"two"},{"id":"a3","summary":"three"}]' where key = 'auditLog'$q$, 'an event is removed');
select public.t_expect_refused($q$update public.stores set data = '[{"id":"a1","summary":"EDITED"},{"id":"a2","summary":"two"},{"id":"a3","summary":"three"}]' where key = 'auditLog'$q$, 'an event is edited');
select public.t_expect_refused($q$update public.stores set data = '[]' where key = 'auditLog'$q$, 'the log is emptied');
select public.t_expect_ok($q$update public.stores set data = '[{"id":"a1","summary":"one"}]' where key = 'auditArchive'$q$, 'the oldest event is copied to the archive first');
select public.t_expect_ok($q$update public.stores set data = '[{"id":"a2","summary":"two"},{"id":"a3","summary":"three"}]' where key = 'auditLog'$q$, '... then leaves the log');
select set_config('request.jwt.claims', '{"email":"OWNER@firm.pl"}', false);
select public.t_expect_refused($q$update public.stores set data = '[]' where key = 'auditArchive'$q$, 'even the owner cannot empty the archive');
reset role;
select 'SECURITY SQL: all checks passed' as result;

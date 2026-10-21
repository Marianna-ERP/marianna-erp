-- MARIANNA ERP — v7.30.0 (Batch M · M-1, external audit 21 Oct 2026: F-01, F-11; owner approved 21 Oct)
-- RULES THE DATABASE ITSELF ENFORCES ON THE SHARED LISTS.
-- Run once in the Supabase SQL editor of EACH project the app uses — first TEST, then the real copy.
-- Safe to run again (it replaces the functions, the two policies and the trigger it owns).
--
-- What it does, in plain words:
--   1. Only the OWNER — the user marked owner in Settings › Users, recognised by the sign-in e-mail — can change the users,
--      the roles, the closed months and the company profile. While no owner is set yet (a fresh copy), the first setup is open.
--   2. The AUDIT TRAIL only grows: no event can be changed or removed, except moved from the log to its archive.
--   3. Nothing else changes: every signed-in user keeps reading and writing the business lists as today, and nobody can delete
--      a list (there has never been a delete rule).
-- Until the database step gives each list its own table, these rules are what stands between a signed-in user and a change
-- made around the screens.

-- ── 1. Who is the owner ──────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.marianna_users_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select case when jsonb_typeof(s.data) = 'array' then s.data else '[]'::jsonb end
                   from public.stores s where s.key = 'users'), '[]'::jsonb);
$$;

create or replace function public.marianna_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from jsonb_array_elements(public.marianna_users_list()) u
    where coalesce((u->>'isOwner')::boolean, false)
      and lower(coalesce(u->>'email', '')) <> ''
      and lower(u->>'email') = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.marianna_has_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from jsonb_array_elements(public.marianna_users_list()) u
    where coalesce((u->>'isOwner')::boolean, false) and lower(coalesce(u->>'email', '')) <> ''
  );
$$;

revoke all on function public.marianna_users_list() from public, anon, authenticated;
revoke all on function public.marianna_is_owner()  from public, anon;
revoke all on function public.marianna_has_owner() from public, anon;
grant execute on function public.marianna_is_owner()  to authenticated;
grant execute on function public.marianna_has_owner() to authenticated;

-- ── 2. The owner-only lists ─────────────────────────────────────────────────────────────────────────────────────────────────
drop policy if exists "marianna insert" on public.stores;
drop policy if exists "marianna update" on public.stores;
create policy "marianna insert" on public.stores for insert to authenticated
  with check (key not in ('users', 'roles', 'closedPeriods', 'company')
              or public.marianna_is_owner() or not public.marianna_has_owner());
create policy "marianna update" on public.stores for update to authenticated
using (key not in ('users', 'roles', 'closedPeriods', 'company')
or public.marianna_is_owner() or not public.marianna_has_owner())
with check (key not in ('users', 'roles', 'closedPeriods', 'company')
or public.marianna_is_owner() or not public.marianna_has_owner());

-- ── 3. The audit trail only grows ───────────────────────────────────────────────────────────────────────────────────────────
-- Every event the log or the archive held must still be there, unchanged, in the log or in the archive. The app moves the
-- oldest events to the archive past 5,000; it writes the archive first, so the move passes.
create or replace function public.marianna_audit_only_grows() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  other_key text; other jsonb; gone int;
begin
  -- a list keeps its name: renaming the users list away (or another list into it) would undo the rules above
  if new.key is distinct from old.key then
  raise exception 'MARIANNA: a shared list cannot be renamed' using errcode = '42501';
  end if;
  if new.key not in ('auditLog', 'auditArchive') then return new; end if;
  other_key := case when new.key = 'auditLog' then 'auditArchive' else 'auditLog' end;
  select case when jsonb_typeof(s.data) = 'array' then s.data else '[]'::jsonb end into other from public.stores s where s.key = other_key;
  select count(*) into gone from (
    select e from jsonb_array_elements(case when jsonb_typeof(old.data) = 'array' then old.data else '[]'::jsonb end) e
    except select e from jsonb_array_elements(case when jsonb_typeof(new.data) = 'array' then new.data else '[]'::jsonb end) e
    except select e from jsonb_array_elements(coalesce(other, '[]'::jsonb)) e
  ) x;
  if gone > 0 then
    raise exception 'MARIANNA: the audit trail only grows — % event(s) would be changed or removed', gone using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists marianna_audit_only_grows on public.stores;
create trigger marianna_audit_only_grows before update on public.stores
  for each row execute function public.marianna_audit_only_grows();

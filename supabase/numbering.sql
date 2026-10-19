-- MARIANNA ERP — v7.27.8 (A-W5, owner ruling 19 Oct 2026): ONE SHARED COUNTER PER DOCUMENT TYPE AND YEAR.
-- Run once in the Supabase SQL editor of EACH project the app uses — first TEST, then the real copy.
-- Safe to run again (it only creates what is missing and replaces the two functions).
--
-- What it does: every new PO, SO, shipment, lot, claim, loading protocol and settlement takes its number from
-- this counter when it is saved, so two browsers can never give out the same number. The first time a type is
-- used in a year, the counter starts from the highest number the app already holds (the "floor"), so existing
-- numbers are never reused and nothing has to be migrated.

create table if not exists public.doc_counters (
  kind  text not null,           -- PO, SO, SHP, LOT, CLM, LP, SET
  year  int  not null,
  last  int  not null default 0, -- the last number given out
  primary key (kind, year)
);
alter table public.doc_counters enable row level security;
-- No policies on purpose: nobody reads or writes the table directly; only the two functions below do.

create or replace function public.next_doc_numbers(p_kind text, p_year int, p_floor int, p_count int default 1)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_last int;
begin
  if p_kind !~ '^[A-Z]{2,6}$' or p_year < 2000 or p_year > 2100 or p_count < 1 or p_count > 500 or p_floor < 0 then
    raise exception 'next_doc_numbers: bad request';
  end if;
  insert into public.doc_counters as c (kind, year, last)
  values (p_kind, p_year, p_floor + p_count)
  on conflict (kind, year) do update set last = greatest(c.last, p_floor) + p_count
  returning c.last into v_last;
  return v_last - p_count + 1;   -- the first of the p_count consecutive numbers now reserved
end $$;

create or replace function public.doc_counters_ready()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select true $$;

revoke all on function public.next_doc_numbers(text, int, int, int) from public, anon;
grant execute on function public.next_doc_numbers(text, int, int, int) to authenticated;
revoke all on function public.doc_counters_ready() from public, anon;
grant execute on function public.doc_counters_ready() to authenticated;

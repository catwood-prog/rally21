-- IL1 job 3, 6 Aug — the pre-auth invite open, counted.
--
-- WHAT WAS INVISIBLE. Until job 1 there was nothing to count: the invite
-- message sent a bare rally21.com with the code typed beside it, so an
-- open was an open of the home page, attributable to nobody — which is
-- exactly why AN1 refused to count it. `rally21.com/j/<code>` changes that:
-- the arrival now names a circle, and therefore an inviter. This table is
-- the missing denominator under memberships.join_source = 'invite'.
--
-- THIS IS THE PROJECT'S FIRST DELIBERATE anon EXECUTE GRANT, and it is
-- being made the day after HD4 closed the authenticated faucet, so the
-- reasoning is written down rather than assumed. CLAUDE.md's rule is not
-- "never anon" — it is "anon is the exception, granted deliberately and
-- only when a signed-out screen actually calls one". A signed-out screen
-- actually calls this one: app/j/[code].tsx, which a stranger holding an
-- invite link reaches with no account at all. HD1's generated sweep is the
-- control, and it is designed for exactly this: the name goes into
-- ANON_EXECUTE_ALLOWED in security-hardening.integration.test.ts with its
-- call site named, so the next anon grant is still loud.
--
-- HOW IT IS MADE BORING, which is the condition the section set:
--
--   * IT RETURNS void. No row, no count, no error text — a caller learns
--     nothing it did not already know, so this is not a circle-existence
--     oracle for anyone sweeping the code space.
--   * NO IDS. No user id (there is no session), no IP, no device, no
--     session token. An open is a tally mark, never a person.
--   * NO TEXT, HELD BY SCHEMA (AN1's law). The only text column is the
--     code itself, CHECK-constrained to exactly six characters of the
--     generator's own shape, so no free text can land here even from a
--     careless future caller.
--   * ROW GROWTH IS BOUNDED. A code that matches no circle writes nothing
--     at all, so the table can never exceed (real circles x days) — a
--     stranger enumerating six-character codes cannot inflate it.
--   * THE COUNT IS CAPPED, and the cap is the rate limit. Past
--     DAILY_OPEN_CAP the upsert's WHERE makes the statement a genuine
--     no-op: no row version, no lock churn, nothing to hammer. (A
--     WHERE-less UPDATE here is the RE2 shape, and this is not it.)
--   * THE TABLE LIVES IN `analytics`, which is not PostgREST-exposed and
--     is granted to no role (AN1). Only the definer function writes it;
--     the dashboard SQL editor, connecting as postgres, reads it.
--
-- WHAT IT STILL COSTS, stated rather than buried: anyone holding a real
-- code can inflate that code's daily number, up to the cap. The number is
-- founder-only analytics, so the cost is data quality, not access — and
-- knowing a code already buys the far larger privilege of joining the
-- circle. The alternative that needs no new surface at all is Vercel's own
-- request log for /j/<code>, which is real but not durable (retention) and
-- cannot be joined to a membership; noted for Cat rather than chosen here.

create table analytics.invite_link_opens (
  invite_code text  not null,
  open_date   date  not null,
  opens       integer not null default 0,
  primary key (invite_code, open_date),
  -- The generator's own shape (create_circle draws 6 from a 31-character
  -- alphabet). This is AN1's no-text law made structural for this table:
  -- the column cannot hold a sentence, a name, or anything a person wrote.
  constraint invite_link_opens_code_shape check (invite_code ~ '^[A-Z0-9]{6}$'),
  -- The ceiling, asserted as well as enforced — if a future writer ever
  -- drops the WHERE below, this fails loudly instead of counting forever.
  constraint invite_link_opens_capped check (opens >= 0 and opens <= 200)
);

comment on table analytics.invite_link_opens is
  'IL1 job 3 — pre-auth opens of rally21.com/j/<code>, one row per code per '
  'day. Tally marks only: no ids, no text beyond the CHECK-shaped code, '
  'capped per day. Written solely by public.record_invite_link_open(); read '
  'from the dashboard as postgres. Counts, not conclusions.';

revoke all on table analytics.invite_link_opens from public;
revoke all on table analytics.invite_link_opens from anon;
revoke all on table analytics.invite_link_opens from authenticated;

create or replace function public.record_invite_link_open(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Kept in step with invite_link_opens_capped above.
  c_daily_open_cap constant integer := 200;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  -- Shape first, so a garbage path segment costs one regex and no lookup.
  if v_code !~ '^[A-Z0-9]{6}$' then
    return;
  end if;

  -- Only real codes get a row. This is what bounds the table, and it is
  -- safe to do here precisely because nothing about the answer escapes:
  -- both branches return void, identically.
  if not exists (select 1 from public.circles where invite_code = v_code) then
    return;
  end if;

  insert into analytics.invite_link_opens as o (invite_code, open_date, opens)
  values (v_code, current_date, 1)
  on conflict (invite_code, open_date) do update
    set opens = o.opens + 1
    where o.opens < c_daily_open_cap;
end;
$$;

comment on function public.record_invite_link_open(text) is
  'IL1 job 3 — tallies one pre-auth open of an invite link. Returns void '
  'for every input, including a code that matches no circle, so it is not '
  'an existence oracle. anon EXECUTE is deliberate: app/j/[code].tsx is a '
  'signed-out screen.';

-- S1's per-function block in the shape HD4 settled (5 Aug): revoke all
-- three, then state the one grant that is meant. The revoke from `anon` is
-- not ceremony even here — it clears whatever the default ACL merged on,
-- so the line below is the ONLY source of anon's privilege on this
-- function, which is what makes the grant reviewable.
revoke all on function public.record_invite_link_open(text) from public;
revoke all on function public.record_invite_link_open(text) from anon;
revoke all on function public.record_invite_link_open(text) from authenticated;
grant execute on function public.record_invite_link_open(text) to anon;

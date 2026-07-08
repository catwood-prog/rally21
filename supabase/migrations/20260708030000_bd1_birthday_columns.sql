-- BD1 — birthdays. Collect day + month (+ optional year) and a per-user
-- celebrate toggle on public.users.
--
-- Visibility: circle-mates can already read a user's row via S1's
-- shares_circle_with SELECT policy, so these new columns ride along on that
-- same row-level rule — that shared visibility IS the feature (the sign-up
-- copy says so). The existing UPDATE policy (id = auth.uid()) already lets a
-- user write their own new columns. No new function is introduced here, so
-- there is nothing to grant/revoke (S1/G5 conventions apply to functions).

alter table public.users
  add column birth_month smallint,
  add column birth_day smallint,
  add column birth_year smallint,
  add column celebrate_birthday boolean not null default true;

-- month + day are a pair (both set or both null); day must be valid for the
-- month. February allows 29 (leap-day birthdays are real and yearless);
-- Feb 30/31 and day 31 in 30-day months are rejected. year is independent
-- and optional, never required anywhere by design.
alter table public.users
  add constraint users_birth_month_range
    check (birth_month is null or birth_month between 1 and 12),
  add constraint users_birth_year_range
    check (birth_year is null or birth_year between 1900 and 2100),
  add constraint users_birthday_day_valid check (
    (birth_month is null and birth_day is null)
    or (
      birth_month is not null
      and birth_day between 1 and (
        case
          when birth_month = 2 then 29
          when birth_month in (4, 6, 9, 11) then 30
          else 31
        end
      )
    )
  );

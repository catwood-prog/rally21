-- BD1 fix — the original users_birthday_day_valid CHECK let a month set
-- with a null day slip through: `birth_day between 1 and N` evaluates to
-- NULL when birth_day is null, and a CHECK constraint treats NULL as
-- satisfied (only an explicit FALSE fails). So (birth_month=3, birth_day=null)
-- passed, breaking the both-or-neither pairing. Add an explicit
-- `birth_day is not null` so a half-set birthday is rejected.

alter table public.users drop constraint users_birthday_day_valid;

alter table public.users add constraint users_birthday_day_valid check (
  (birth_month is null and birth_day is null)
  or (
    birth_month is not null
    and birth_day is not null
    and birth_day between 1 and (
      case
        when birth_month = 2 then 29
        when birth_month in (4, 6, 9, 11) then 30
        else 31
      end
    )
  )
);
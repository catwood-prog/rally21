-- Personal-only override: Cat's two accounts (main + test) get a higher
-- circle cap while every other user keeps the product default of 3.
-- This is deliberately a narrow allowlist, not a global cap change --
-- the 3-circle cap stays the product default for the friends cohort.
create or replace function public.app_caps()
returns table(max_circles_per_user int, max_members_per_circle int)
language sql
stable
as $$
  select
    case
      when auth.uid() in (
        '75ec0d88-27de-4227-ab62-3d049b369960', -- catherine.f.harwood@gmail.com
        '149bac2f-6557-403b-bf05-f830d42fc2e4'   -- catherine.harwood@korefusion.com (test)
      ) then 10
      else 3
    end,
    12;
$$;

-- Security spec S1's account-deletion design (F5) deliberately SET NULLs
-- completions.covered_by when the coverer's account is deleted — "days
-- the user covered for friends persist as gifts, name gone" — but the
-- pre-existing check constraint required kind='covered' to always carry
-- a non-null covered_by, so a real deletion involving any cover would
-- have failed outright. A covered day with covered_by now null means
-- exactly that: covered by someone whose account no longer exists.
alter table public.completions drop constraint completions_covered_by_matches_kind;
alter table public.completions add constraint completions_covered_by_matches_kind
  check (
    (kind = 'self' and covered_by is null) or (kind = 'covered')
  );

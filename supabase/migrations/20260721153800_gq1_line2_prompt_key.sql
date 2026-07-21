-- GQ1 (Rally21-Goals-Set-Spec.md): the check-in's second line becomes a
-- fixed ten-question daily cycle. This column records WHICH question was
-- asked on the row's day — written whether or not it was answered, since
-- an empty line2 next to a recorded key IS the skip log (skips are
-- signal; the cohort's most-skipped questions are the primary thing the
-- feature exists to learn). Nullable, no backfill: old rows (null key)
-- render under the historical "learned" label. Question selection is
-- deterministic and client-side (days since account creation in the
-- user's own timezone, mod 10) — no server surface, no new RLS: the
-- column rides reflections' existing owner-only policies.
alter table public.reflections
  add column if not exists line2_prompt_key text;

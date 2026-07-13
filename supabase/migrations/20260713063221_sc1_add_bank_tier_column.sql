-- SC1 re-seed (13 July, evening) — the bank grew to 155 entries across
-- four tiers, including a new modern-voices tier (MV-*) that's
-- deliberately IN COPYRIGHT (Cat's call, short-attributed-quote risk
-- posture) rather than public domain like everything else. `tier`
-- makes that distinguishable in the data itself, not just inferable
-- from the ID prefix.
alter table public.share_card_bank
  add column tier text not null default 'classic_public_domain'
  check (tier in ('classic_public_domain', 'original_unattributed', 'fact', 'modern_voice_in_copyright'));

comment on column public.share_card_bank.tier is
  'classic_public_domain (QB-*) | original_unattributed (AN-*, Rally''s own voice) | fact (NF-*) | modern_voice_in_copyright (MV-*, deliberately not public domain — Cat''s call, short-attributed-quote risk posture)';

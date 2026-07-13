-- Fix: NF-13/14/15's source_note got truncated mid-citation when the
-- seed migration was typed by hand instead of piped from the generated
-- file — restoring the exact text from Rally21-Quote-Bank.md.
update public.share_card_bank set source_note =
  'Emperor penguins trek roughly 50-120km (some colonies further) from open sea to breeding sites, then males fast through courtship and incubation (about 4 months total) while holding the egg on their feet under a brood… — Australian Antarctic Program; Wikipedia (Emperor penguin); multiple zoology sources cross-checked.'
where id = 'NF-13';

update public.share_card_bank set source_note =
  'Emperor penguins huddle in groups (sometimes thousands strong) to conserve heat in temperatures down to -60C and winds up to 200km/h; individuals rotate from the exposed outer edge toward the warmer centre over time. — Australian Antarctic Program; British Antarctic Survey; Wikipedia (Emperor penguin) - huddling/rotation behaviour is well documented.'
where id = 'NF-14';

update public.share_card_bank set source_note =
  'Emperor penguins are unique among penguin species (and among Antarctic animals generally) in beginning their breeding cycle at the start of the Antarctic winter, marching inland to colonies as conditions worsen rather… — Australian Antarctic Program; British Antarctic Survey.'
where id = 'NF-15';

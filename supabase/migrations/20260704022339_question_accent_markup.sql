-- Mark the "personal word" in each question with *asterisks* so the
-- client can render just that word/phrase in Instrument Serif italic,
-- matching the adaptive spec's design note and the mockup's check-in
-- screen ("What time of day did you feel *sharpest*?").
update public.questions set prompt = 'How''s your *energy* right now?' where prompt = 'How''s your energy right now?';
update public.questions set prompt = 'What time of day did you feel *sharpest* today?' where prompt = 'What time of day did you feel sharpest today?';
update public.questions set prompt = 'Did last night''s *sleep* set you up well?' where prompt = 'Did last night''s sleep set you up well?';
update public.questions set prompt = 'What *drained* you most — people, work, screens, or your own head?' where prompt = 'What drained you most — people, work, screens, or your own head?';
update public.questions set prompt = 'When your body says rest, what do you usually *do*?' where prompt = 'When your body says rest, what do you usually do?';
update public.questions set prompt = 'One word for today''s *weather* inside?' where prompt = 'One word for today''s weather inside?';
update public.questions set prompt = 'What gave you the biggest *lift* today?' where prompt = 'What gave you the biggest lift today?';
update public.questions set prompt = 'Was today''s mood mostly *yours*, or caught from someone else?' where prompt = 'Was today''s mood mostly yours, or caught from someone else?';
update public.questions set prompt = 'What *emotion* have you been avoiding this week?' where prompt = 'What emotion have you been avoiding this week?';
update public.questions set prompt = 'Where does *stress* show up first — body, sleep, temper, focus?' where prompt = 'Where does stress show up first — body, sleep, temper, focus?';
update public.questions set prompt = 'What''s sitting on your *shoulders* right now?' where prompt = 'What''s sitting on your shoulders right now?';
update public.questions set prompt = 'What reliably *restores* you in under 20 minutes?' where prompt = 'What reliably restores you in under 20 minutes?';
update public.questions set prompt = 'When did you last feel genuinely *calm*?' where prompt = 'When did you last feel genuinely calm?';
update public.questions set prompt = 'Today, did you show up for *yourself* or for your circle?' where prompt = 'Today, did you show up for yourself or for your circle?';
update public.questions set prompt = 'What works better on you — not breaking the chain, or *building something*?' where prompt = 'What works better on you — not breaking the chain, or building something?';
update public.questions set prompt = 'When you skip a day, what''s usually the *real reason*?' where prompt = 'When you skip a day, what''s usually the real reason?';
update public.questions set prompt = 'What would make this practice feel *worth it* in 90 days?' where prompt = 'What would make this practice feel worth it in 90 days?';
update public.questions set prompt = 'After today''s session — what did you say to *yourself*?' where prompt = 'After today''s session — what did you say to yourself?';
update public.questions set prompt = 'When you miss a day, is your inner voice a *coach or a critic*?' where prompt = 'When you miss a day, is your inner voice a coach or a critic?';
update public.questions set prompt = 'What would you tell a circle-mate who had *your week*?' where prompt = 'What would you tell a circle-mate who had your week?';
update public.questions set prompt = 'When did you last feel *properly proud* of yourself?' where prompt = 'When did you last feel properly proud of yourself?';
update public.questions set prompt = 'Who made today *better*?' where prompt = 'Who made today better?';
update public.questions set prompt = 'Do you feel your circle would notice if you went *quiet*?' where prompt = 'Do you feel your circle would notice if you went quiet?';
update public.questions set prompt = 'Are you more *giver or receiver* of encouragement lately?' where prompt = 'Are you more giver or receiver of encouragement lately?';
update public.questions set prompt = 'When did you last have a conversation that actually *fed you*?' where prompt = 'When did you last have a conversation that actually fed you?';
update public.questions set prompt = 'What did you do today that was *actually you*?' where prompt = 'What did you do today that was actually you?';
update public.questions set prompt = 'If this week had a *title*, what would it be?' where prompt = 'If this week had a title, what would it be?';
update public.questions set prompt = 'What are you doing mostly because *someone else* expects it?' where prompt = 'What are you doing mostly because someone else expects it?';
update public.questions set prompt = 'Twenty-one days from now, what do you want to be *true*?' where prompt = 'Twenty-one days from now, what do you want to be true?';
update public.questions set prompt = 'Where were you when you did *today''s practice*?' where prompt = 'Where were you when you did today''s practice?';
update public.questions set prompt = 'What *nearly stopped* you today?' where prompt = 'What nearly stopped you today?';
update public.questions set prompt = 'Which day of the week is *hardest* for you, honestly?' where prompt = 'Which day of the week is hardest for you, honestly?';
update public.questions set prompt = 'What''s the *one thing* that, when it happens, your whole day works?' where prompt = 'What''s the one thing that, when it happens, your whole day works?';

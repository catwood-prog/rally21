-- Q1: the adaptive question engine (Rally21-Question-Engine-Spec.md,
-- Rally21-Question-Bank.md — 120 questions + 10 follow-up templates,
-- transcribed verbatim). Additive schema changes only; the ~30 existing
-- rows are archived (is_archived = true), never deleted — real
-- reflections.question_id foreign keys point at them and must keep
-- resolving for journal/history display.

alter table public.questions
  add column code text unique,
  add column pool text not null default 'any' check (pool in ('any', 'weekday', 'weekend')),
  add column is_followup_template boolean not null default false,
  add column secondary_dimension text check (
    secondary_dimension is null or secondary_dimension in ('ENR','MOOD','STR','MOT','SELF','CON','VAL','HAB')
  );

-- Archive the existing ~30-question simple rotation. Left in place (not
-- deleted) so historical reflections.question_id / getQuestionById()
-- keep resolving correctly for journal display.
update public.questions set is_archived = true where code is null;

-- One active rest per (user, dimension) — upserted by get_daily_question()
-- when two consecutive same-dimension skips trigger a 14-day rest.
create table public.question_dimension_rests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  dimension text not null check (dimension in ('ENR','MOOD','STR','MOT','SELF','CON','VAL','HAB')),
  rested_until date not null,
  updated_at timestamptz not null default now(),
  unique (user_id, dimension)
);

alter table public.question_dimension_rests enable row level security;

create policy "a user can read their own dimension rests"
  on public.question_dimension_rests for select
  to authenticated
  using (user_id = auth.uid());

create policy "a user can write their own dimension rests"
  on public.question_dimension_rests for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "a user can update their own dimension rests"
  on public.question_dimension_rests for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- The fully-rendered prompt text as actually served that day, frozen at
-- selection time. Two jobs: (1) invariant "bank edits never change an
-- already-served day" survives even a future edit to questions.prompt;
-- (2) follow-up templates interpolate {answer}/{weekday} with real
-- per-user data at selection time — this is where that final text lives
-- so a closed-and-reopened day renders identically, not the raw template.
alter table public.reflections add column question_prompt_snapshot text;

insert into public.questions (code, dimension, prompt, format, depth, options, pool, is_followup_template)
values
('ENR-01', 'ENR', 'How''s your *energy* right now?', 'scale', 'L1', null, 'any', false),
('ENR-02', 'ENR', 'What time of day did you feel *sharpest* today?', 'chips', 'L1', '["early morning", "late morning", "afternoon", "evening"]'::jsonb, 'any', false),
('ENR-03', 'ENR', 'Did last night''s *sleep* set you up well?', 'scale', 'L1', null, 'any', false),
('ENR-04', 'ENR', 'What drained you most today — *people, work, screens, or your own head*?', 'chips', 'L2', '["people", "work", "screens", "my own head"]'::jsonb, 'any', false),
('ENR-05', 'ENR', 'When your body says *rest*, what do you usually do?', 'chips', 'L2', '["rest", "push through", "scroll", "move instead"]'::jsonb, 'any', false),
('ENR-06', 'ENR', 'How is your body *carrying* today?', 'chips', 'L1', '["light", "steady", "heavy"]'::jsonb, 'any', false),
('ENR-07', 'ENR', 'What gave you a real *second wind* today?', 'short_text', 'L1', null, 'any', false),
('ENR-08', 'ENR', 'Did you get outside in *daylight* today?', 'binary', 'L1', '["yes", "not today"]'::jsonb, 'any', false),
('ENR-09', 'ENR', 'What refills you faster — *quiet, movement, people, or sleep*?', 'chips', 'L2', '["quiet", "movement", "people", "sleep"]'::jsonb, 'any', false),
('ENR-10', 'ENR', 'How rested do you *actually* feel this weekend?', 'scale', 'L1', null, 'weekend', false),
('ENR-11', 'ENR', 'When do you usually run out of *steam*?', 'chips', 'L2', '["mid-morning", "mid-afternoon", "evening", "I don''t, quite"]'::jsonb, 'any', false),
('ENR-12', 'ENR', 'What''s one thing that reliably *wakes your body up*?', 'short_text', 'L2', null, 'any', false),
('ENR-13', 'ENR', 'Did work today run on *good fuel or fumes*?', 'chips', 'L2', '["good fuel", "fumes", "a bit of both"]'::jsonb, 'weekday', false),
('ENR-14', 'ENR', 'If your energy could talk, what would it be *asking you for* lately?', 'short_text', 'L3', null, 'any', false),
('ENR-15', 'ENR', 'What are you trading *sleep* for, most nights?', 'chips', 'L3', '["work", "screens", "worry", "time to myself"]'::jsonb, 'any', false),
('MOOD-01', 'MOOD', 'One word for today''s *weather inside*?', 'short_text', 'L1', null, 'any', false),
('MOOD-02', 'MOOD', 'What gave you the biggest *lift* today?', 'short_text', 'L1', null, 'any', false),
('MOOD-03', 'MOOD', 'Was today''s mood mostly *yours, or caught from someone else*?', 'chips', 'L2', '["mostly mine", "caught", "half and half"]'::jsonb, 'any', false),
('MOOD-04', 'MOOD', 'What emotion have you been *avoiding* this week?', 'short_text', 'L3', null, 'any', false),
('MOOD-05', 'MOOD', 'Pick today''s *color*.', 'chips', 'L1', '["bright", "soft", "grey", "stormy"]'::jsonb, 'any', false),
('MOOD-06', 'MOOD', 'What made you *smile* when you didn''t expect to?', 'short_text', 'L1', null, 'any', false),
('MOOD-07', 'MOOD', 'When a low mood shows up, what''s your usual *first move*?', 'chips', 'L2', '["distract", "talk it out", "move", "sit with it"]'::jsonb, 'any', false),
('MOOD-08', 'MOOD', 'How *steady* did today feel?', 'scale', 'L1', null, 'any', false),
('MOOD-09', 'MOOD', 'What lifts you faster — *being heard, being busy, being outside, being alone*?', 'chips', 'L2', '["heard", "busy", "outside", "alone"]'::jsonb, 'any', false),
('MOOD-10', 'MOOD', 'Name something small that *shifted the whole day*.', 'short_text', 'L2', null, 'any', false),
('MOOD-11', 'MOOD', 'What''s the *flavor* of this weekend so far?', 'chips', 'L1', '["restful", "full", "flat", "free"]'::jsonb, 'weekend', false),
('MOOD-12', 'MOOD', 'Which moods do you let people *see*?', 'chips', 'L2', '["most of them", "the good ones", "almost none"]'::jsonb, 'any', false),
('MOOD-13', 'MOOD', 'When today dipped, what was happening *right before*?', 'short_text', 'L2', null, 'any', false),
('MOOD-14', 'MOOD', 'Did you laugh *properly* today?', 'binary', 'L1', '["yes", "not really"]'::jsonb, 'any', false),
('MOOD-15', 'MOOD', 'What''s a feeling you''ve had lately that doesn''t have a *name* yet?', 'short_text', 'L3', null, 'any', false),
('STR-01', 'STR', 'Where does stress show up *first* for you?', 'chips', 'L2', '["body", "sleep", "temper", "focus"]'::jsonb, 'any', false),
('STR-02', 'STR', 'What''s sitting on your *shoulders* right now?', 'short_text', 'L2', null, 'any', false),
('STR-03', 'STR', 'What reliably *restores* you in under 20 minutes?', 'short_text', 'L2', null, 'any', false),
('STR-04', 'STR', 'When did you last feel genuinely *calm*?', 'chips', 'L2', '["today", "this week", "a while ago", "can''t remember"]'::jsonb, 'any', false),
('STR-05', 'STR', 'How *full* is your plate today?', 'scale', 'L1', null, 'any', false),
('STR-06', 'STR', 'Today''s pressure — *pushing you forward or pressing you down*?', 'chips', 'L1', '["pushing me forward", "pressing me down", "both", "no pressure today"]'::jsonb, 'any', false),
('STR-07', 'STR', 'Did you get a real *pause* today — even five minutes?', 'binary', 'L1', '["yes", "not really"]'::jsonb, 'any', false),
('STR-08', 'STR', 'When you finally stop, can your mind *stop too*?', 'chips', 'L2', '["usually", "sometimes", "rarely"]'::jsonb, 'any', false),
('STR-09', 'STR', 'What would take *one thing* off your plate this week?', 'short_text', 'L2', null, 'any', false),
('STR-10', 'STR', 'What''s the heaviest part of a workday for you?', 'chips', 'L2', '["the work", "the people", "the pace", "the noise"]'::jsonb, 'weekday', false),
('STR-11', 'STR', 'What did you *let go of* today, even a little?', 'short_text', 'L1', null, 'any', false),
('STR-12', 'STR', 'Is this weekend *recharging* you, or just pausing the week?', 'chips', 'L1', '["recharging", "pausing", "bit of both"]'::jsonb, 'weekend', false),
('STR-13', 'STR', 'What''s the worry underneath the *busy*?', 'short_text', 'L3', null, 'any', false),
('STR-14', 'STR', 'What actually counts as *rest* for you?', 'chips', 'L2', '["stillness", "play", "people", "making something"]'::jsonb, 'any', false),
('STR-15', 'STR', 'If next week could be *lighter* in one specific way, what would you change?', 'short_text', 'L3', null, 'any', false),
('MOT-01', 'MOT', 'What actually got you here today — *you, or the others*?', 'chips', 'L1', '["me", "the others", "both"]'::jsonb, 'any', false),
('MOT-02', 'MOT', 'What keeps you coming back — *protecting the streak, or building toward something*?', 'chips', 'L2', '["protecting the streak", "building something"]'::jsonb, 'any', false),
('MOT-03', 'MOT', 'When you skip a day, what''s usually the *real reason*?', 'chips', 'L2', '["time", "energy", "mood", "I forget"]'::jsonb, 'any', false),
('MOT-04', 'MOT', 'What would make this practice feel *worth it* in 90 days?', 'short_text', 'L3', null, 'any', false),
('MOT-05', 'MOT', 'What got you to today''s practice?', 'chips', 'L1', '["habit", "mood", "people", "stubbornness"]'::jsonb, 'any', false),
('MOT-06', 'MOT', 'Did today''s practice feel like *want to, or have to*?', 'binary', 'L1', '["want to", "have to"]'::jsonb, 'any', false),
('MOT-07', 'MOT', 'What kills your momentum fastest?', 'chips', 'L2', '["boredom", "doubt", "busyness", "no one noticing"]'::jsonb, 'any', false),
('MOT-08', 'MOT', 'How much *pull* did the practice have today?', 'scale', 'L1', null, 'any', false),
('MOT-09', 'MOT', 'When you''re at your most consistent, what''s *different*?', 'short_text', 'L2', null, 'any', false),
('MOT-10', 'MOT', '*Praise or progress* — which one actually moves you?', 'chips', 'L2', '["praise", "progress", "both, honestly"]'::jsonb, 'any', false),
('MOT-11', 'MOT', 'Who are you becoming *consistent* for?', 'short_text', 'L2', null, 'any', false),
('MOT-12', 'MOT', 'Did today run on *discipline or momentum*?', 'chips', 'L1', '["discipline", "momentum", "neither, I scraped by"]'::jsonb, 'weekday', false),
('MOT-13', 'MOT', 'A day you nearly skip but don''t — what usually *tips it*?', 'chips', 'L2', '["the streak", "my circle", "the feeling after", "routine"]'::jsonb, 'any', false),
('MOT-14', 'MOT', 'What did you use to love doing that quietly *slipped away*?', 'short_text', 'L3', null, 'any', false),
('MOT-15', 'MOT', 'When something''s hard, do you move *toward it or around it*?', 'chips', 'L2', '["toward it", "around it", "depends on the thing"]'::jsonb, 'any', false),
('SELF-01', 'SELF', 'After today''s session — what did you *say to yourself*?', 'short_text', 'L2', null, 'any', false),
('SELF-02', 'SELF', 'When you miss a day, is your inner voice a *coach or a critic*?', 'chips', 'L2', '["coach", "critic", "silent"]'::jsonb, 'any', false),
('SELF-03', 'SELF', 'What would you tell a circle-mate who had *your week*?', 'short_text', 'L3', null, 'any', false),
('SELF-04', 'SELF', 'When did you last feel properly *proud of yourself*?', 'short_text', 'L3', null, 'any', false),
('SELF-05', 'SELF', 'How did you treat yourself today?', 'chips', 'L1', '["like a friend", "like a stranger", "like a drill sergeant"]'::jsonb, 'any', false),
('SELF-06', 'SELF', 'What did you do *well* today — small counts?', 'short_text', 'L2', null, 'any', false),
('SELF-07', 'SELF', 'When you get something right, what do you do with it?', 'chips', 'L2', '["savor it", "shrug it off", "move the goalposts"]'::jsonb, 'any', false),
('SELF-08', 'SELF', 'Did you give yourself any *credit* today?', 'binary', 'L1', '["yes", "not really"]'::jsonb, 'any', false),
('SELF-09', 'SELF', 'The last thing that went wrong — did it feel more like *a bad move, or a bad you*?', 'chips', 'L2', '["a bad move", "a bad me", "a bit of both"]'::jsonb, 'any', false),
('SELF-10', 'SELF', 'What''s something you''re *better at* than six months ago?', 'short_text', 'L2', null, 'any', false),
('SELF-11', 'SELF', 'Today''s inner soundtrack — *kind, quiet, nagging, or loud*?', 'chips', 'L1', '["kind", "quiet", "nagging", "loud"]'::jsonb, 'any', false),
('SELF-12', 'SELF', 'What do you do with a *compliment*?', 'chips', 'L2', '["take it in", "deflect it", "negotiate it down"]'::jsonb, 'any', false),
('SELF-13', 'SELF', 'Write or say one sentence to yourself the way *a good coach* would.', 'short_text', 'L2', null, 'any', false),
('SELF-14', 'SELF', 'What are you more scared of — *failing, or being seen failing*?', 'chips', 'L3', '["failing", "being seen failing", "neither, really"]'::jsonb, 'any', false),
('SELF-15', 'SELF', 'How much *patience* did you have for yourself today?', 'scale', 'L1', null, 'any', false),
('CON-01', 'CON', 'Who made today *better*?', 'short_text', 'L1', null, 'any', false),
('CON-02', 'CON', 'Do you feel your circle would *notice* if you went quiet?', 'scale', 'L2', null, 'any', false),
('CON-03', 'CON', 'Are you more *giver or receiver* of encouragement lately?', 'chips', 'L2', '["giver", "receiver", "balanced", "neither lately"]'::jsonb, 'any', false),
('CON-04', 'CON', 'When did you last have a conversation that actually *fed* you?', 'chips', 'L3', '["today", "this week", "a while ago", "can''t remember"]'::jsonb, 'any', false),
('CON-05', 'CON', 'Who did you *think of* today but didn''t reach out to?', 'short_text', 'L1', null, 'any', false),
('CON-06', 'CON', 'Did you have a real *hello* today — an actual one, not a transaction?', 'binary', 'L1', '["yes", "not today"]'::jsonb, 'any', false),
('CON-07', 'CON', 'Who gets your *realest* self?', 'chips', 'L2', '["family", "friends", "my circle", "almost no one"]'::jsonb, 'any', false),
('CON-08', 'CON', 'Who''s someone you''d like *more* of in your life?', 'short_text', 'L2', null, 'any', false),
('CON-09', 'CON', 'Today felt more — *crowded, connected, quiet, or lonely*?', 'chips', 'L1', '["crowded", "connected", "quiet", "lonely"]'::jsonb, 'any', false),
('CON-10', 'CON', 'What''s the easiest way for someone to *support* you?', 'short_text', 'L2', null, 'any', false),
('CON-11', 'CON', 'After time with people, do you usually feel *filled up or emptied out*?', 'chips', 'L2', '["filled up", "emptied out", "depends who"]'::jsonb, 'any', false),
('CON-12', 'CON', 'Who are you *sharing* this weekend with?', 'short_text', 'L1', null, 'weekend', false),
('CON-13', 'CON', 'What do you wish someone would *ask* you?', 'short_text', 'L3', null, 'any', false),
('CON-14', 'CON', 'When you''re struggling, your instinct is to —', 'chips', 'L2', '["reach out", "go quiet", "get busy", "joke it away"]'::jsonb, 'any', false),
('CON-15', 'CON', 'Tell me about someone who *believes* in you.', 'short_text', 'L2', null, 'any', false),
('VAL-01', 'VAL', 'What did you do today that was *actually you*?', 'short_text', 'L2', null, 'any', false),
('VAL-02', 'VAL', 'If this week had a *title*, what would it be?', 'short_text', 'L1', null, 'any', false),
('VAL-03', 'VAL', 'What are you doing mostly because *someone else* expects it?', 'short_text', 'L3', null, 'any', false),
('VAL-04', 'VAL', 'Twenty-one days from now, what do you want to be *true*?', 'short_text', 'L3', null, 'any', false),
('VAL-05', 'VAL', 'What mattered most today — *people, progress, peace, or play*?', 'chips', 'L1', '["people", "progress", "peace", "play"]'::jsonb, 'any', false),
('VAL-06', 'VAL', 'What''s something you *stood for* this week, even quietly?', 'short_text', 'L2', null, 'any', false),
('VAL-07', 'VAL', 'Your time lately — *spent, invested, or leaking*?', 'chips', 'L2', '["spent", "invested", "leaking"]'::jsonb, 'any', false),
('VAL-08', 'VAL', 'What would you do more of if *nobody was watching*?', 'short_text', 'L2', null, 'any', false),
('VAL-09', 'VAL', 'Did today move you toward *what matters*, even an inch?', 'binary', 'L1', '["yes", "not today"]'::jsonb, 'any', false),
('VAL-10', 'VAL', 'What''s one thing you *refuse to rush*?', 'short_text', 'L2', null, 'any', false),
('VAL-11', 'VAL', 'What does a weekend *well spent* look like for you?', 'chips', 'L1', '["rest", "people", "making things", "adventure"]'::jsonb, 'weekend', false),
('VAL-12', 'VAL', 'What would you *reach for* if you knew you''d have the time?', 'short_text', 'L3', null, 'any', false),
('VAL-13', 'VAL', 'What made you feel *useful* lately?', 'short_text', 'L2', null, 'any', false),
('VAL-14', 'VAL', 'Which compliment would land deepest — *kind, brave, wise, or steady*?', 'chips', 'L2', '["kind", "brave", "wise", "steady"]'::jsonb, 'any', false),
('VAL-15', 'VAL', 'What part of your life deserves a *bigger yes*?', 'short_text', 'L2', null, 'any', false),
('HAB-01', 'HAB', 'Where were you when you did today''s practice?', 'chips', 'L1', '["home", "work", "outside", "on the move"]'::jsonb, 'any', false),
('HAB-02', 'HAB', 'What nearly *stopped* you today?', 'short_text', 'L1', null, 'any', false),
('HAB-03', 'HAB', 'Which day of the week is *hardest* for you, honestly?', 'chips', 'L2', '["Monday", "midweek", "Friday", "the weekend"]'::jsonb, 'any', false),
('HAB-04', 'HAB', 'What''s the one thing that, when it happens, your whole day *works*?', 'short_text', 'L2', null, 'any', false),
('HAB-05', 'HAB', 'When did the practice happen today?', 'chips', 'L1', '["first thing", "squeezed in", "last minute"]'::jsonb, 'any', false),
('HAB-06', 'HAB', 'Same *place* as yesterday?', 'binary', 'L1', '["same place", "somewhere new"]'::jsonb, 'any', false),
('HAB-07', 'HAB', 'On smooth days, what happens *right before* the practice?', 'short_text', 'L2', null, 'any', false),
('HAB-08', 'HAB', 'Your phone during practice — *away, nearby, or in hand*?', 'chips', 'L2', '["away", "nearby", "in hand"]'::jsonb, 'any', false),
('HAB-09', 'HAB', 'Finish the sentence: it''s easiest when *…*', 'short_text', 'L2', null, 'any', false),
('HAB-10', 'HAB', 'Where does the practice fit a workday?', 'chips', 'L1', '["before work", "in the cracks", "after work", "barely"]'::jsonb, 'weekday', false),
('HAB-11', 'HAB', 'What could *tomorrow-you* thank tonight-you for setting up?', 'short_text', 'L2', null, 'any', false),
('HAB-12', 'HAB', 'When the routine breaks — travel, guests, chaos — what *survives*?', 'short_text', 'L2', null, 'any', false),
('HAB-13', 'HAB', 'How *automatic* did today feel?', 'scale', 'L1', null, 'any', false),
('HAB-14', 'HAB', 'What habit are you *done with* — the one that costs more than it gives?', 'short_text', 'L3', null, 'any', false),
('HAB-15', 'HAB', 'Weekends — do they *protect* the practice or *swallow* it?', 'chips', 'L2', '["protect it", "swallow it", "depends on the weekend"]'::jsonb, 'weekend', false),
('FU-01', 'HAB', 'Last {weekday} you said "{answer}" nearly stopped you — did it show up again today?', 'short_text', 'L2', null, 'any', true),
('FU-02', 'STR', 'A while back, "{answer}" was sitting on your shoulders. Lighter, heavier, or still there?', 'short_text', 'L2', null, 'any', true),
('FU-03', 'MOOD', 'You said "{answer}" gave you a lift recently. Had any more of it?', 'short_text', 'L2', null, 'any', true),
('FU-04', 'CON', 'You mentioned wanting more of {answer} in your life. Any movement there?', 'short_text', 'L2', null, 'any', true),
('FU-05', 'VAL', 'You wanted this to be true by day 21: "{answer}". Closer or further today?', 'short_text', 'L2', null, 'any', true),
('FU-06', 'SELF', 'You once said you''d tell a circle-mate: "{answer}". Would you take that advice yourself this week?', 'short_text', 'L2', null, 'any', true),
('FU-07', 'STR', '"{answer}" reliably restores you. When did you last actually do it?', 'short_text', 'L2', null, 'any', true),
('FU-08', 'MOT', 'You said what tips a near-skip for you is {answer}. Did it come to the rescue this week?', 'short_text', 'L2', null, 'any', true),
('FU-09', 'HAB', '"It''s easiest when {answer}." Was today one of those days?', 'short_text', 'L2', null, 'any', true),
('FU-10', 'VAL', 'You gave last week the title "{answer}". What''s this week earning so far?', 'short_text', 'L2', null, 'any', true);

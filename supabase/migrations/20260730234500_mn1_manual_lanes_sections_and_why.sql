-- MN1 — the self-manual, part 1: bank cleanup + lane/section tagging.
--
-- Adds the three columns the manual needs and loads Cat's 30 July pass into
-- them. NO UI, no engine-logic change; get_daily_question is untouched.
--
-- What the live schema actually is, checked before this was written: the text
-- column is `prompt` (not `text_template`), there is no `active` column, and
-- `is_archived` is the retire mechanism. The serif-italic accent device is
-- `*word*`, parsed by components/AccentedText.tsx -- NOT `{braces}`. The only
-- braces in this table are the ten follow-up templates' substitution slots,
-- which get_daily_question gates on (`like '%{answer}%'`) and expands to
-- `*answer*`; they are load-bearing and are preserved exactly.
--
-- Cat's rulings, 30 July, in session:
--   * all ten follow-up templates ship alongside the 120 (her pass covers
--     130 rows). Required: FU-01 was the last non-archived em dash, and four
--     templates quoted wording their source question no longer uses.
--   * register: the twelve Tier A rows keep their ORIGINAL wording, where the
--     rewrite read survey-voiced; Tiers B and C ship as rewritten.
--   * chips: eleven chip sets re-worded to match the rewritten questions.
--
-- Not fixed here, reported instead (out of MN1's scope, both recorded for the
-- docs session): the journal and Today's teaser render `prompt` as plain text
-- so the accent asterisks show literally; and the cold-start arc / day-14
-- follow-up / VAL-09 fallback paths select by `code` without an is_archived
-- filter, so archiving one of those questions would not stop it being served.

alter table public.questions
  add column if not exists answer_lane text
    check (answer_lane in ('evidence', 'declaration')),
  add column if not exists manual_section text
    check (manual_section in
      ('energy-recovery', 'connection', 'overwhelm-restore', 'misread')),
  add column if not exists why_we_ask text;

comment on column public.questions.answer_lane is
  'Which manual lane this answer feeds: evidence = a fact about today; '
  'declaration = self-description. Null only on archived (retired) rows.';
comment on column public.questions.manual_section is
  'v1 manual section, or null where no section clearly fits (honest and fine).';
comment on column public.questions.why_we_ask is
  'Cat''s per-question "why we ask this" line, verbatim. Surfaced by MN2.';

-- The 120-question bank: text (except the twelve reverted rows), lane,
-- section and why_we_ask.
update public.questions q set
  prompt        = coalesce(v.prompt, q.prompt),
  answer_lane   = v.lane,
  manual_section = v.section,
  why_we_ask    = v.why
from (values
  ('ENR-01', null::text, 'evidence', 'energy-recovery', 'Your current energy level can shape how everything else feels today.'),
  ('ENR-02', 'At what point today did you feel *most alert*?', 'evidence', 'energy-recovery', 'Noticing when you feel most alert can reveal your natural daily rhythm.'),
  ('ENR-03', 'How well did last night''s *sleep* prepare you for today?', 'evidence', 'energy-recovery', 'Sleep often sets the tone for your energy, focus, and mood.'),
  ('ENR-04', 'What drained the most energy from you today: *people, work, screens, or your own thoughts*?', 'evidence', 'energy-recovery', 'Knowing what drains you makes it easier to protect and restore your energy.'),
  ('ENR-05', 'When your body tells you to *rest*, what do you usually do?', 'declaration', 'energy-recovery', 'How you respond to tiredness shows whether you tend to honor or override your body''s needs.'),
  ('ENR-06', 'How does your body *feel* today?', 'evidence', 'energy-recovery', 'Physical sensations can be an early signal that you need movement, rest, or care.'),
  ('ENR-07', 'What gave you a *second wind* today?', 'evidence', 'energy-recovery', 'Small energy boosts can reveal what reliably helps you recover.'),
  ('ENR-08', 'Did you spend any time outside in *daylight* today?', 'evidence', 'energy-recovery', 'Daylight can influence energy, mood, and sleep, so it is useful to notice.'),
  ('ENR-09', 'What restores your energy fastest: *quiet, movement, being around people, or sleep*?', 'declaration', 'energy-recovery', 'Knowing what restores you fastest helps you recover more intentionally.'),
  ('ENR-10', 'How *rested* do you feel this weekend?', 'evidence', 'energy-recovery', 'Weekends do not always bring recovery; this checks how rested you actually feel.'),
  ('ENR-11', null::text, 'declaration', 'energy-recovery', 'Your usual energy dip can help you plan demanding tasks and breaks.'),
  ('ENR-12', 'What''s one thing that reliably helps you *feel more awake*?', 'declaration', 'energy-recovery', 'Recognizing what wakes you up gives you a practical way to reset.'),
  ('ENR-13', 'Did work today feel fueled by *good energy* or like you were running on *fumes*?', 'evidence', 'energy-recovery', 'This helps distinguish sustainable energy from simply pushing through.'),
  ('ENR-14', 'If your energy could speak, what would it *ask you for* right now?', 'declaration', 'energy-recovery', 'Treating energy as a signal can make unmet needs easier to notice.'),
  ('ENR-15', null::text, 'declaration', 'energy-recovery', 'Late nights often protect something important; this helps identify what you choose over sleep.'),
  ('MOOD-01', null::text, 'evidence', null::text, 'A simple metaphor can make your emotional state easier to name.'),
  ('MOOD-02', 'What *lifted your mood* the most today?', 'evidence', null::text, 'Noticing what improves your mood helps you recognize sources of wellbeing.'),
  ('MOOD-03', 'Did today''s mood feel like *your own*, or did you *pick it up from someone else*?', 'evidence', null::text, 'Other people''s emotions can influence us; this helps you notice when that happens.'),
  ('MOOD-04', 'What emotion have you been *avoiding* this week?', 'evidence', 'overwhelm-restore', 'Avoided feelings often keep asking for attention, even when they stay in the background.'),
  ('MOOD-05', null::text, 'evidence', null::text, 'Color offers a low-pressure way to describe a mood that may be hard to name.'),
  ('MOOD-06', 'What made you *smile* unexpectedly today?', 'evidence', null::text, 'Unexpected smiles highlight small moments of joy that are easy to overlook.'),
  ('MOOD-07', 'When you feel low, what''s the *first thing you usually do*?', 'declaration', 'overwhelm-restore', 'Your first response to a low mood reveals your usual coping pattern.'),
  ('MOOD-08', 'How *emotionally steady* did today feel?', 'evidence', null::text, 'Emotional steadiness can matter as much as whether the day felt good or bad.'),
  ('MOOD-09', 'What lifts your mood fastest: *being heard, staying busy, getting outside, or spending time alone*?', 'declaration', 'overwhelm-restore', 'Knowing what lifts your mood gives you practical options when you feel low.'),
  ('MOOD-10', 'What small thing *changed the course of your day*?', 'evidence', null::text, 'Small events can have an outsized effect; noticing them reveals what shapes your day.'),
  ('MOOD-11', null::text, 'evidence', null::text, 'This captures the overall emotional tone of your weekend.'),
  ('MOOD-12', 'Which of your moods do you let other people *see*?', 'declaration', 'connection', 'What you show or hide can reveal how emotionally safe you feel with others.'),
  ('MOOD-13', 'What was happening *just before* your mood dipped today?', 'evidence', 'overwhelm-restore', 'Looking at what came before a mood dip can help identify triggers and patterns.'),
  ('MOOD-14', 'Did you have a *good laugh* today?', 'evidence', null::text, 'Genuine laughter can be a useful signal of ease, connection, and release.'),
  ('MOOD-15', 'What feeling have you experienced lately that you don''t quite have a *name* for?', 'evidence', null::text, 'Not every feeling has a ready-made label; describing it can still help you understand it.'),
  ('STR-01', 'Where do you notice stress *first*?', 'declaration', 'overwhelm-restore', 'Stress often appears in the body or behavior before we consciously name it.'),
  ('STR-02', 'What''s *weighing on you* right now?', 'evidence', 'overwhelm-restore', 'Naming what feels heavy can make an unclear sense of pressure more specific.'),
  ('STR-03', 'What reliably helps you *recharge* in 20 minutes or less?', 'declaration', 'overwhelm-restore', 'Short, reliable ways to recharge are especially useful when time is limited.'),
  ('STR-04', 'When was the last time you felt truly *calm*?', 'evidence', 'overwhelm-restore', 'Remembering calm helps you notice how available or distant it currently feels.'),
  ('STR-05', 'How much do you have on your *plate* today?', 'evidence', 'overwhelm-restore', 'Your sense of capacity provides context for your mood, energy, and choices today.'),
  ('STR-06', 'Is today''s pressure *pushing you forward, weighing you down, doing both, or not really there*?', 'evidence', 'overwhelm-restore', 'Pressure can motivate or overwhelm; distinguishing the two helps you respond appropriately.'),
  ('STR-07', 'Did you take a real *break* today, even for five minutes?', 'evidence', 'overwhelm-restore', 'Even a short pause can interrupt stress and give your system room to reset.'),
  ('STR-08', 'When you finally stop, does your mind *slow down too*?', 'declaration', 'overwhelm-restore', 'Stopping physically does not always mean your mind has stopped working.'),
  ('STR-09', 'What could help take *one thing* off your plate this week?', 'evidence', 'overwhelm-restore', 'Identifying one source of relief can make an overloaded week feel more manageable.'),
  ('STR-10', 'Which part of a workday feels heaviest to you?', 'declaration', 'overwhelm-restore', 'Knowing which part of work feels heaviest helps pinpoint the real source of strain.'),
  ('STR-11', 'What were you able to *let go of* today, even a little?', 'evidence', 'overwhelm-restore', 'Letting go, even slightly, is a meaningful part of recovery.'),
  ('STR-12', 'Is this weekend helping you *recharge*, or is it simply putting the week on pause?', 'evidence', 'energy-recovery', 'Time away from work only helps if it actually gives you some recovery.'),
  ('STR-13', 'What worry is hiding beneath all the *busyness*?', 'declaration', 'overwhelm-restore', 'Busyness can sometimes protect us from a deeper worry that needs attention.'),
  ('STR-14', 'What genuinely feels like *rest* to you?', 'declaration', 'energy-recovery', 'Rest is personal; knowing what counts for you makes recovery more effective.'),
  ('STR-15', 'If you could make next week *lighter* in one specific way, what would you change?', 'declaration', 'overwhelm-restore', 'A specific change is easier to act on than a general wish for less stress.'),
  ('MOT-01', 'What got you to show up today: *your own motivation, other people, or both*?', 'evidence', null::text, 'This reveals whether today''s motivation came mainly from within, from other people, or from both.'),
  ('MOT-02', 'What keeps you coming back: *maintaining your streak or working toward something*?', 'declaration', null::text, 'Knowing what brings you back shows whether consistency is driven by momentum or meaning.'),
  ('MOT-03', 'When you skip a day, what''s usually *behind it*?', 'declaration', null::text, 'Understanding what interrupts a habit makes the barrier easier to address.'),
  ('MOT-04', 'What would need to happen for this practice to feel *worthwhile* 90 days from now?', 'declaration', null::text, 'A clear picture of the desired benefit gives the practice a purpose.'),
  ('MOT-05', 'What brought you to today''s practice?', 'evidence', null::text, 'Today''s reason for showing up can reveal which motivators work in real life.'),
  ('MOT-06', 'Did today''s practice feel like something you *wanted to do* or something you *had to do*?', 'evidence', null::text, 'The difference between choice and obligation can strongly affect motivation.'),
  ('MOT-07', 'What causes you to lose momentum fastest?', 'declaration', null::text, 'Knowing what breaks your momentum helps you protect it.'),
  ('MOT-08', 'How strongly did you feel *drawn* to do the practice today?', 'evidence', null::text, 'This checks how naturally appealing or effortful the practice felt today.'),
  ('MOT-09', 'What''s *different* when you''re at your most consistent?', 'declaration', null::text, 'Your most consistent periods can reveal the conditions that help you succeed.'),
  ('MOT-10', 'Which motivates you more: *praise or progress*?', 'declaration', null::text, 'People respond differently to recognition and visible progress; this helps identify yours.'),
  ('MOT-11', 'Who or what are you trying to become more *consistent* for?', 'declaration', null::text, 'Connecting consistency to a person or purpose can make it feel more meaningful.'),
  ('MOT-12', 'What got you through today: *discipline, momentum, or simply scraping by*?', 'evidence', null::text, 'This distinguishes steady effort from days when momentum carries you.'),
  ('MOT-13', 'On days when you almost skip the practice but don''t, what usually gets you to *follow through*?', 'declaration', null::text, 'The moment you choose not to skip can reveal your strongest follow-through cue.'),
  ('MOT-14', 'What did you once love doing that gradually *slipped out of your life*?', 'declaration', null::text, 'Lost interests can point to parts of yourself that may need more room again.'),
  ('MOT-15', 'When something feels difficult, do you *face it directly or find a way around it*?', 'declaration', null::text, 'How you respond to difficulty can reveal patterns of persistence and avoidance.'),
  ('SELF-01', 'What did you *say to yourself* after today''s session?', 'evidence', null::text, 'What you say after making an effort reveals the tone of your everyday self-talk.'),
  ('SELF-02', 'When you miss a day, does your inner voice sound more like a *coach or a critic*?', 'declaration', null::text, 'Missing a day often brings out the clearest version of your inner voice.'),
  ('SELF-03', 'What would you say to someone in your circle who had *a week like yours*?', 'declaration', null::text, 'Comparing your advice to others with your advice to yourself reveals the compassion gap.'),
  ('SELF-04', 'When was the last time you felt truly *proud of yourself*?', 'evidence', null::text, 'Moments of pride show what you recognize and value in yourself.'),
  ('SELF-05', null::text, 'evidence', null::text, 'How you treat yourself on an ordinary day shapes resilience and wellbeing.'),
  ('SELF-06', 'What did you do *well* today, however small?', 'evidence', null::text, 'Noticing small successes helps keep them from disappearing beneath what went wrong.'),
  ('SELF-07', 'When you get something right, do you savor it, shrug it off, or move the goalposts?', 'declaration', null::text, 'Your response to success shows whether you can absorb it or quickly discount it.'),
  ('SELF-08', 'Did you give yourself *credit* for anything today?', 'evidence', null::text, 'Giving yourself credit helps effort and progress register emotionally.'),
  ('SELF-09', 'When something last went wrong, did you see it as *a bad decision* or as *something wrong with you*?', 'declaration', null::text, 'Separating a poor decision from your identity protects against turning mistakes into self-judgment.'),
  ('SELF-10', 'What can you do *better* now than you could six months ago?', 'declaration', null::text, 'Looking back provides concrete evidence of growth that can be hard to notice day to day.'),
  ('SELF-11', 'What did your inner voice sound like today: *kind, quiet, nagging, or loud*?', 'evidence', null::text, 'The tone of your inner voice affects how safe and supported you feel within yourself.'),
  ('SELF-12', 'How do you usually respond to a *compliment*?', 'declaration', 'misread', 'How you receive praise reveals how comfortable you are letting positive feedback land.'),
  ('SELF-13', 'What''s one thing you could say to yourself in the voice of *a good coach*?', 'declaration', null::text, 'A supportive inner voice can help you respond to difficulty with clarity instead of criticism.'),
  ('SELF-14', 'Which scares you more: *failing or being seen failing*?', 'declaration', 'misread', 'This separates fear of the outcome from fear of other people''s judgment.'),
  ('SELF-15', 'How *patient* were you with yourself today?', 'evidence', null::text, 'Patience with yourself affects how you handle mistakes, effort, and slow progress.'),
  ('CON-01', 'Who made your day *better* today?', 'evidence', 'connection', 'Noticing who improved your day highlights the relationships that nourish you.'),
  ('CON-02', 'How confident are you that the people close to you would *notice* if you went quiet?', 'declaration', 'connection', 'This explores how seen and supported you feel by the people close to you.'),
  ('CON-03', 'Lately, have you mostly been *giving encouragement, receiving it, doing both equally, or neither*?', 'declaration', 'connection', 'Healthy support can involve giving and receiving; this checks how balanced it feels lately.'),
  ('CON-04', 'When was the last time you had a conversation that left you feeling *genuinely connected*?', 'evidence', 'connection', 'Meaningful conversation is one way to gauge the depth of connection in your life.'),
  ('CON-05', 'Who *came to mind* today that you didn''t reach out to?', 'evidence', 'connection', 'People who come to mind may point to connections you miss or want to strengthen.'),
  ('CON-06', 'Did you have a *genuine interaction* with someone today, rather than just a practical exchange?', 'evidence', 'connection', 'A genuine interaction can create belonging in a way that practical exchanges do not.'),
  ('CON-07', null::text, 'declaration', 'connection', 'Who sees your authentic self can reveal where you feel safest and most understood.'),
  ('CON-08', 'Who would you like to have *more* of in your life?', 'declaration', 'connection', 'Wanting more of someone can signal a relationship you value or miss.'),
  ('CON-09', 'Which word best describes how today felt: *crowded, connected, quiet, or lonely*?', 'evidence', 'connection', 'This helps distinguish peaceful solitude from disconnection or loneliness.'),
  ('CON-10', 'What''s the most helpful way for someone to *support* you?', 'declaration', 'connection', 'Knowing your support preferences makes it easier for others to show up in ways that help.'),
  ('CON-11', 'After spending time with people, do you usually feel *energized or drained*?', 'declaration', 'connection', 'Social time affects people differently; this helps you notice your own energy pattern.'),
  ('CON-12', 'Who are you *spending* this weekend with?', 'evidence', 'connection', 'Who you spend free time with can reflect your current balance of connection and solitude.'),
  ('CON-13', 'What''s something you wish someone would *ask* you about?', 'declaration', 'connection', 'An unasked question may point to something important that you want seen or understood.'),
  ('CON-14', 'When you''re struggling, what''s your first instinct?', 'declaration', 'connection', 'Your first response to difficulty reveals how you seek, avoid, or manage support.'),
  ('CON-15', null::text, 'declaration', 'connection', 'Recognizing who believes in you makes an important source of support more visible.'),
  ('VAL-01', 'What did you do today that felt *most true to who you are*?', 'evidence', null::text, 'Actions that feel authentic show where your daily life matches who you are.'),
  ('VAL-02', 'If you gave this week a *title*, what would it be?', 'evidence', null::text, 'Giving the week a title helps you step back and notice its overall theme.'),
  ('VAL-03', 'What are you doing mainly because *someone else* expects it of you?', 'declaration', null::text, 'External expectations can quietly shape choices; naming them creates room to reconsider.'),
  ('VAL-04', 'What would you like to be *true* 21 days from now?', 'declaration', null::text, 'A short-term intention gives you a meaningful direction to move toward.'),
  ('VAL-05', 'What mattered most to you today: *people, progress, peace, or play*?', 'evidence', null::text, 'What mattered today offers a simple snapshot of the values most present in your life.'),
  ('VAL-06', 'What is something you *stood up for* this week, even quietly?', 'evidence', null::text, 'Small acts of conviction show how your values appear in everyday behavior.'),
  ('VAL-07', 'Lately, does your time feel *spent, invested, or as though it''s slipping away*?', 'declaration', null::text, 'How your time feels can reveal whether it matches your priorities.'),
  ('VAL-08', 'What would you do more often if *no one were watching*?', 'declaration', null::text, 'What you choose without an audience can reveal intrinsic interests and motivations.'),
  ('VAL-09', 'Did today move you even a little closer to *what matters most*?', 'evidence', null::text, 'This checks whether your day felt aligned with what matters most to you.'),
  ('VAL-10', 'What is one thing you *refuse to rush*?', 'declaration', null::text, 'What you refuse to rush often points to something you deeply value.'),
  ('VAL-11', 'What does a *well-spent* weekend look like to you?', 'declaration', null::text, 'Your ideal weekend reveals what restoration and meaning look like for you.'),
  ('VAL-12', 'What would you *choose to spend time on* if you knew you had enough time?', 'declaration', null::text, 'The things you postpone can reveal desires that are not getting enough space.'),
  ('VAL-13', 'What has made you feel *useful* lately?', 'evidence', null::text, 'Feeling useful can show where you experience contribution, competence, or purpose.'),
  ('VAL-14', 'Which compliment would mean the most to you: *kind, brave, wise, or steady*?', 'declaration', null::text, 'The compliment that matters most can reveal the quality you most want recognized.'),
  ('VAL-15', null::text, 'declaration', null::text, 'A part of life that deserves more attention may be pointing to an unmet value or need.'),
  ('HAB-01', 'Where did you do today''s practice?', 'evidence', null::text, 'Where a habit happens can reveal which environments make it easier to begin.'),
  ('HAB-02', 'What almost *stopped* you from doing the practice today?', 'evidence', null::text, 'The obstacle you nearly encountered shows where the practice currently has friction.'),
  ('HAB-03', 'Which part of the week do you find *hardest*?', 'declaration', null::text, 'Weekly patterns can help you prepare for the times when consistency is hardest.'),
  ('HAB-04', 'What one thing tends to make the rest of your day *fall into place*?', 'declaration', null::text, 'A keystone condition can influence how smoothly the rest of your day unfolds.'),
  ('HAB-05', 'When did you fit in today''s practice?', 'evidence', null::text, 'Timing helps reveal where the practice fits most naturally into your day.'),
  ('HAB-06', null::text, 'evidence', null::text, 'Repeating a location can make a habit easier by strengthening the environmental cue.'),
  ('HAB-07', 'On days when the practice feels easy, what usually happens *just beforehand*?', 'declaration', null::text, 'What happens immediately beforehand may be the cue that helps the practice begin.'),
  ('HAB-08', 'Where was your phone during the practice: *away, nearby, or in your hand*?', 'evidence', null::text, 'Your phone''s location can reveal how much distraction or attention surrounds the practice.'),
  ('HAB-09', 'Complete the sentence: The practice is easiest when *…*', 'declaration', null::text, 'Naming ideal conditions helps you make the practice easier to repeat.'),
  ('HAB-10', 'When do you usually fit the practice into a workday?', 'declaration', null::text, 'Understanding where the practice fits on workdays helps make the routine realistic.'),
  ('HAB-11', null::text, 'declaration', null::text, 'A small amount of preparation can reduce tomorrow''s friction.'),
  ('HAB-12', 'When your routine is disrupted by travel, guests, or chaos, which part of it *remains*?', 'declaration', null::text, 'What survives disruption reveals the smallest sustainable version of your routine.'),
  ('HAB-13', 'How *automatic* did doing the practice feel today?', 'evidence', null::text, 'Automaticity shows whether the practice is becoming a habit or still requires active effort.'),
  ('HAB-14', 'Which habit are you *ready to leave behind* because it takes more than it gives?', 'declaration', null::text, 'Naming a costly habit is often the first step toward choosing a better alternative.'),
  ('HAB-15', 'On weekends, is it easier to *protect* the practice or *let it slip*?', 'declaration', null::text, 'Weekends change structure; this shows whether that supports or disrupts the practice.')
) as v(code, prompt, lane, section, why)
where q.code = v.code;

-- Tier A: text deliberately unchanged, so the update above passed null and
-- coalesce kept the original. Nothing further to do for those twelve rows.

-- Chips re-worded to match the rewritten question text (Cat's ruling).
update public.questions set options = '["people", "work", "screens", "my own thoughts"]'::jsonb where code = 'ENR-04';
update public.questions set options = '["mostly mine", "picked it up", "half and half"]'::jsonb where code = 'MOOD-03';
update public.questions set options = '["pushing me forward", "weighing me down", "both", "no pressure today"]'::jsonb where code = 'STR-06';
update public.questions set options = '["my own motivation", "other people", "both"]'::jsonb where code = 'MOT-01';
update public.questions set options = '["maintaining the streak", "working toward something"]'::jsonb where code = 'MOT-02';
update public.questions set options = '["face it", "around it", "depends on the thing"]'::jsonb where code = 'MOT-15';
update public.questions set options = '["a bad decision", "something wrong with me", "a bit of both"]'::jsonb where code = 'SELF-09';
update public.questions set options = '["giving", "receiving", "both equally", "neither lately"]'::jsonb where code = 'CON-03';
update public.questions set options = '["energized", "drained", "depends who"]'::jsonb where code = 'CON-11';
update public.questions set options = '["spent", "invested", "slipping away"]'::jsonb where code = 'VAL-07';
update public.questions set options = '["protect it", "let it slip", "depends on the weekend"]'::jsonb where code = 'HAB-15';

-- The ten follow-up templates: braces re-placed exactly, why + lane + the
-- section inherited from each template's source question.
update public.questions set prompt = 'Last {weekday}, you said "{answer}" nearly stopped you. Did the same thing come up again today?', answer_lane = 'evidence', manual_section = null::text, why_we_ask = 'Revisiting the same obstacle shows whether it is becoming a recurring pattern.' where code = 'FU-01';
update public.questions set prompt = 'A while ago, you said "{answer}" was weighing on you. Does it feel lighter, heavier, or about the same now?', answer_lane = 'evidence', manual_section = 'overwhelm-restore', why_we_ask = 'Checking again helps you notice whether a source of stress is changing over time.' where code = 'FU-02';
update public.questions set prompt = 'You recently said "{answer}" lifted your mood. Have you experienced more of that since then?', answer_lane = 'evidence', manual_section = null::text, why_we_ask = 'Returning to a positive influence helps identify whether it can support you again.' where code = 'FU-03';
update public.questions set prompt = 'You mentioned wanting more of "{answer}" in your life. Has anything changed?', answer_lane = 'evidence', manual_section = 'connection', why_we_ask = 'Following up turns a wish for connection into something you can notice and act on.' where code = 'FU-04';
update public.questions set prompt = 'You hoped that by day 21, "{answer}" would be true. Do you feel closer to it today?', answer_lane = 'evidence', manual_section = null::text, why_we_ask = 'Revisiting your intention helps you see progress that may otherwise be easy to miss.' where code = 'FU-05';
update public.questions set prompt = 'You once said you would tell someone in your circle, "{answer}." Would you take that advice yourself this week?', answer_lane = 'declaration', manual_section = null::text, why_we_ask = 'This checks whether the compassion you offer others is also available to you.' where code = 'FU-06';
update public.questions set prompt = 'You said "{answer}" reliably helps you recharge. When did you last do it?', answer_lane = 'evidence', manual_section = 'overwhelm-restore', why_we_ask = 'Knowing what restores you matters most when you actually make room to use it.' where code = 'FU-07';
update public.questions set prompt = 'You said "{answer}" helps you follow through when you''re about to skip. Did it help this week?', answer_lane = 'evidence', manual_section = null::text, why_we_ask = 'Testing a known motivator shows whether it reliably helps you follow through.' where code = 'FU-08';
update public.questions set prompt = 'You said, "It''s easiest when {answer}." Was today one of those days?', answer_lane = 'evidence', manual_section = null::text, why_we_ask = 'Comparing today with your ideal conditions helps you learn what makes the practice easier.' where code = 'FU-09';
update public.questions set prompt = 'You called last week "{answer}." What title is this week earning so far?', answer_lane = 'evidence', manual_section = null::text, why_we_ask = 'A new weekly title helps you notice how your experience is shifting over time.' where code = 'FU-10';

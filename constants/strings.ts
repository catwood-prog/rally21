import { stripAccentMarkers } from '@/lib/accentMarkup';
import { buildInviteLink } from '@/lib/invite-link';

// Seeded practices follow the verb-phrase convention (see CLAUDE.md), but
// a custom practice can be any free-form name — nothing validates that at
// save time (see CLAUDE.md's "resilient headline" rule). Any sentence
// built from a practice name (the Today headline, the check-in headline's
// accent word) must check this first and degrade gracefully rather than
// assume a verb start.
export const PRACTICE_VERB_STARTERS = [
  'meditate',
  'walk',
  'run',
  'write',
  'stretch',
  'sit',
  'breathe',
  'read',
  'journal',
  'draw',
  'move',
  'practice',
  'do',
];

export function isVerbPhrasePractice(practiceName: string): boolean {
  const firstWord = practiceName
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase()
    .replace(/[^a-z]/g, '');
  return !!firstWord && PRACTICE_VERB_STARTERS.includes(firstWord);
}

// No i18n setup exists in this project yet — user-facing copy lives here
// instead of inline, so it has one place to move into a real localization
// system later. Strings that take values are small formatter functions
// rather than raw templates, so call sites can't typo a `{n}` token.
// OD1 job 9d — the closing beat's count words. Mirrors today.tsx's
// CIRCLE_COUNT_WORD (words to three, numeral beyond) so the app has one
// habit for counting circles rather than two.
const CLOSING_BEAT_COUNT_WORD: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three' };

// LC2 (the casing law, split by function — Cat's ruling 25 July, amending
// LC1). Screen titles are lowercase, except a title that is a NAME. Body
// copy splits by FUNCTION: lowercase for labels, buttons, chrome and short
// fragments; sentence case for anything that is a full sentence of prose.
// User-created content is NEVER re-cased.
//
// SUB-RULE (Cat, 27 July): A STRING THAT QUOTES A UI LABEL INHERITS THAT
// LABEL'S CASING. Where a sentence opens on the name of a button, the
// button's casing wins over sentence case — printing "Rally on," when the
// button beneath says "rally on" is worse than the inconsistency it fixes.
// Two strings live under this rule today: journeyGateCardBody and
// askRallyDeleteConfirm, each marked at its own entry.
//
// Dialog and confirm TITLES are titles, so they take rule 1, not rule 2
// (Cat, 27 July) — hostRemoveMemberConfirm, journeyCompleteConfirmTitle
// and checkinSuccessTitle came lowercase with that ruling. The one standing
// exception is emptyGroupTitle, a deliberate hero headline.
//
// HC1 (27 July) released the last two families LC2 had to hold back. Both
// were blocked on the same thing — user-facing labels hardcoded in screens
// instead of living here, so a label here could be re-cased and its
// hardcoded twin on the same screen could not. HC1 moved the twins in, so
// those families are now cased by the law like everything else. Nothing in
// this file is held back from the casing law any more.
export const STRINGS = {
  // HC1 (27 July) — the shared button labels. These are the plain verbs
  // that appear on more than one screen; every screen that had one typed
  // inline now reads it from here, so the casing law reaches all of them
  // at once. Context-specific buttons keep their own named key below
  // (birthdaySave, hostRemoveMemberCta, journeyGateRallyOnCta, …).
  saveCta: 'save',
  cancelCta: 'cancel',
  removeCta: 'remove',
  signOutCta: 'sign out',
  gotItCta: 'got it',
  continueCta: 'continue',
  joinCta: 'join',
  backLink: '← back',

  // O1 (Google slice, 8/12 July) — sign-in screen, web only.
  // "Google" and "Apple" keep their capitals — they are names, the same
  // exception the law makes for "Rally".
  signInWithGoogleCta: 'continue with Google',
  signInOrDivider: 'or',
  signInGoogleError: "couldn't sign in with Google — try again",
  // NAV1: the "check your email" state's way back — a typo'd address
  // must not strand the screen.
  signInUseDifferentEmail: '← use a different email',

  // O1 (Apple slice, 12 July) — Apple sits above Google per Apple's own
  // button-prominence guideline. The hint line addresses the live-proven
  // "Hide My Email" trap: an existing member choosing Hide gets a private
  // relay address that can never match their real account, so the copy
  // nudges them toward Share before they tap.
  signInWithAppleCta: 'continue with Apple',
  // HC1 — was hardcoded at sign-in.tsx:162, the primary button in the same
  // stack as the two above; that split is why they were held back.
  signInSendMagicLinkCta: 'send magic link',
  signInAppleShareEmailHint: 'already have Rally? choose share my email so we can find your account',
  signInAppleError: "couldn't sign in with Apple — try again",

  // NR1 Job 1 — the top-level error-recovery screen (a caught render
  // crash, not a normal error surface). Warmth-law voice: apologises
  // without alarm, blames nobody, never a stack or code, one way back.
  // Title lowercase per LC1. PROPOSED copy — Cat to confirm/adjust.
  errorBoundaryTitle: 'well, that came loose',
  errorBoundaryBody:
    "Something on our side slipped — nothing you've done is lost. Let's get you back to solid ground.",
  errorBoundaryCta: 'take me back',

  // DD1 (5 Aug, Cat's ruling from her 03:48 screenshot) — "done" is a
  // claim about the DAY, not about this check-in, so it waits for the
  // day's LAST one. The screenshot is the whole argument: "day 12 done"
  // sitting directly above a button reading "one more today". Two lines,
  // eight pixels apart, disagreeing about the same fact.
  //
  // So the headline splits in two. `checkinSuccessTitle` keeps the full
  // claim and is now reached only when nothing else is still waiting;
  // every earlier check-in of a multi-circle day gets the count alone.
  // A solo or single-circle person never sees the open variant — their
  // one check-in IS the day's last, and getDayCloseState short-circuits
  // them to complete without so much as a presence fetch.
  //
  // Bare is Cat's own wording ("we can just remove 'done'") and it is
  // also the conservative shape: the body line ("You showed up again.")
  // was already carrying the warmth, and adding a second sentence here
  // would be inventing copy to fill a hole the removal didn't leave.
  // NODDED in-session, 5 Aug, against two alternatives (a quiet "day 12
  // ✓" and a warmer "day 12, one down" — the second was the weaker one
  // anyway, since it says what the button two lines below already says,
  // which is the exact doubling DD1 exists to remove).
  checkinSuccessTitleOpen: (n: number) => `day ${n}`,
  checkinSuccessTitle: (n: number) => `day ${n} done`,
  checkinSuccessBody: 'You showed up again.',
  // OD1 job 9d — kept as the DEFERRAL label, no longer the everyday one.
  // It still shows in exactly two places: before the day-close state has
  // resolved (never guess at a farewell), and on a glow-beat day, where
  // checkin-complete is not the last screen so the goodbye is not its to
  // say. See the three ruled labels below.
  checkinSuccessCta: 'nice',

  // OD1 job 9d (Cat's ruling, 26 July) — the daily closing beat. The
  // check-in success screen fires on EVERY check-in, so its button has to
  // branch, and the goodbye belongs to the LAST screen in the sequence,
  // never to two.
  //   (a) day not done  -> checkinMoreTodayCta(n)   work remaining
  //   (b) day done      -> dayDoneCta farewell
  //   (c) card day      -> checkinCardComingCta     gift, defers to the
  //                        share card's own "see you tomorrow" (job 8)
  //
  // SC4 (31 July) — (c) is now shared by TWO screens, because the card
  // follows the glow beat instead of losing to it: whichever screen
  // immediately precedes the card says this line, so on a glow-beat card
  // day it is glow-beat.tsx, and on any other card day it is still
  // checkin-complete.tsx. The key keeps its original name; what it means
  // is "a card comes next", not "this particular screen". Only ever one
  // screen per sequence says it, so the copy never repeats.
  // Same shape, same length, all lowercase — three registers doing three
  // jobs, which is what makes them one rhythm rather than three
  // decisions. Lowercase is correct under LC2: button labels are
  // fragments, not prose.
  //
  // The count is REQUIRED, not decorative: "one more today" is only true
  // when exactly one practice remains, and with a default cap of 3 (and
  // MAX_CIRCLES up to 10) two or three open is ordinary. Words to three
  // then numerals, matching today.tsx's own CIRCLE_COUNT_WORD fallback
  // rather than inventing a second rule.
  checkinMoreTodayCta: (remaining: number) =>
    `${CLOSING_BEAT_COUNT_WORD[remaining] ?? remaining} more today`,
  dayDoneCta: 'see you tomorrow',
  checkinCardComingCta: 'something for you',

  // ON1 (23 July) — the two-question Day-0 intake. Q1 options ARE the five
  // PT1 domains + connection; Q2 options are the fixed obstacle set. Titles
  // + labels lowercase (LC1); the reassurance lines are the section's
  // mechanic map verbatim (each names a mechanic we already shipped, so no
  // answer is fake). The Day-0 sentence is PROPOSED — Cat's wording wins.
  onboardingQ1Title: 'what would you most like these\n21 days to change?',
  onboardingQ1Subtitle: 'this just points us at the right practices — you can still browse anything.',
  onboardingQ2Title: 'what usually makes it hard\nto keep going?',
  onboardingQ2Subtitle: 'so we can show you the part of Rally that answers it.',
  onboardingSkip: 'skip for now',
  // Q1 option labels, keyed by the stored key (five domains + connection).
  onboardingDesiredChangeLabels: {
    move: 'my body — move more',
    mind: 'my inner life — calmer, clearer',
    learn: 'growing — learn something',
    make: 'creating — make something',
    care: 'the basics — eat, rest, self-care',
    connection: 'with my people — feel less alone',
  } as Record<string, string>,
  // Q2 option labels, keyed by the stored obstacle key.
  onboardingObstacleLabels: {
    forget: 'i forget',
    no_time: 'no time',
    lose_motivation: 'i lose motivation',
    miss_once: 'i miss once and give up',
    alone: 'doing it alone',
  } as Record<string, string>,
  // The reassurance each obstacle earns — the section's mechanic map,
  // verbatim; "Rally" keeps its capital (a name).
  onboardingReassurance: {
    forget: 'Rally learns when you show up and nudges just before.',
    no_time: "we'll start you small; doing less still counts.",
    lose_motivation: "your circle is the point — you'll see each other.",
    miss_once: "a missed day dims, it doesn't reset, and a friend can cover you the next day.",
    alone: "Rally only works with people — let's get your circle in.",
  } as Record<string, string>,
  // The obstacle restated in the person's own voice for the Day-0 sentence.
  onboardingObstacleReflected: {
    forget: 'you forget',
    no_time: "there's never time",
    lose_motivation: 'your motivation fades',
    miss_once: 'one miss usually ends it',
    alone: 'doing it alone is hard',
  } as Record<string, string>,
  // The Day-0 reflected sentence (PROPOSED). Self-reported voice — "you
  // said", never "we noticed". `reflected` + `mechanic` come from the two
  // records above; `desiredPhrase` (optional) weaves Q1 in when present.
  onboardingDayZeroDesiredPhrase: {
    move: 'to move more',
    mind: 'a calmer mind',
    learn: 'to grow',
    make: 'to make something',
    care: 'to look after yourself',
    connection: 'to feel less alone',
  } as Record<string, string>,
  onboardingDayZeroSentence: (reflected: string, mechanic: string) => `you said ${reflected}. here, ${mechanic}`,
  onboardingDayZeroWithDesired: (desiredPhrase: string, reflected: string, mechanic: string) =>
    `you came in wanting ${desiredPhrase}, and you said ${reflected}. here, ${mechanic}`,
  // ON1 — the 'connection' desired-change emphasis on the practice browse.
  onboardingConnectionNote: 'your circle is the answer to this — pick any practice, then invite your people right after.',

  // PN1 (13 July) — the earned-moment pre-permission ask, shown once ever
  // on the check-in-success screen before the real iOS system dialog.
  // PN1B (16 July, Cat's exact copy): the primer is one line + one green
  // action — "not now" is gone; continuing without enabling dismisses it.
  // YD1 (21 July) — the line carries the 2-a-day promise (Cat's ruling;
  // semantics verified in send-notifications, see notificationsCapPromise).
  pushAskLine: 'Want a little nudge if you forget to check in? Never more than 2 a day.',
  pushAskCta: 'turn on notifications',

  // Glow milestones (Rally21-Glow-Spec.md §4) — a variant of the same
  // check-in success screen, no new assets or badges.
  glowMilestoneTitle: (n: number) => `${n} days glowing 🔥`,
  glowMilestoneBody: "That's a real run. Keep it warm.",

  // Today's per-circle CTA — bold-on-fill only while the day is still
  // open; once checked in, the glow is the reward and editing is a quiet,
  // occasional correction, not the day's main action.
  // HC1 — the two siblings that fill the SAME slot on a timed circle came
  // in from today.tsx here, so the whole primary-CTA family moves together
  // and a multi-circle Today can no longer render two casings at once.
  checkInCta: 'check in',
  markDoneCta: 'just mark as done',
  startTimerCta: 'start timer',
  editCheckinCta: 'edit check-in',
  // HC1 — Today's two quiet links, also typed inline until now.
  addCircleLink: '+ add a circle',
  todayInviteHintLink: 'even better with your people →',

  // PA1 job 3 — the two numbers are visibly different things, and the
  // "of 21" is gone from both. A circle has an AGE, not a deadline
  // (memo §3), so it counts up forever; the member's own progress is the
  // separate rally line below. They are never summed, never compared and
  // never merged into one number. Before PA1 this read "day 23 of 21" on
  // every live circle in the cohort, which is what a deadline that has
  // stopped meaning anything looks like.
  //
  // HC1 job 1 kept SignalMeter's pill and this header status in step
  // ("day 1 of 21 · 1 of 2 checked in … Day 1 of 21" was two counters);
  // they still agree on the NUMBER, and the pill carries the "together".
  //
  // RETIRED by AU1 (3 Aug, Cat's job-4 ruling). Keeping them "in step"
  // was always a way of managing a duplicate rather than removing it:
  // the circle screen printed its age twice, once here and once in the
  // pill. The age now has one labelled home (signalCircleAge, "circle
  // day 30") and the circle header renders the shared headcount line
  // instead — see lib/headcount.ts.
  // AU1 job 4 (Cat's ruling, 3 Aug) — the circle's age is OFF Today
  // entirely, nothing replacing it there, and lives only on the circle
  // screen, RELABELLED from a clock to a birthday. "day 30" sitting
  // unlabelled beside "your rally: 7 of 21" and a 🔥 13 glow gave Today
  // three numbers of three different kinds with nothing saying so; naming
  // whose day it is costs one word and settles it. Same label solo and
  // group (Cat, 3 Aug): a solo circle is one nobody has joined YET, and
  // the chip must not rename itself the moment someone does — which is
  // also why signalCircleAgeSolo is gone rather than duplicated.
  //
  // "Together" leaves this string for good: that vocabulary is now
  // reserved for the pair metric (pairDaysTogetherLabel), the one number
  // in the app that is actually about two people.
  signalCircleAge: (n: number) => `circle day ${n}`,
  // PA1 job 3 — the member's OWN clock, counted in practices. Labels and
  // short fragments are lowercase under LC2 rule 2, and both of these
  // are fragments, not sentences of prose.
  signalRallyProgress: (count: number, target: number) => `your rally: ${count} of ${target}`,
  signalRallyLeg: (count: number, legLabel: string) => `your rally: ${count} · ${legLabel}`,
  signalStateLabelCircle: 'your circle is',
  signalStateLabelSolo: 'your practice is',
  signalStateGlowing: 'glowing 🔥',
  signalStateWarm: 'warm',
  signalStateResting: 'resting',
  signalCaptionCircle: "kept warm together — it can't break, only glow brighter",
  signalCaptionSolo: "kept warm — it can't break, only glow brighter",
  // AU1 job 2 (3 Aug) — the headcount family. The render decision that
  // picks between them is lib/headcount.ts, shared by all three call
  // sites; see there for the mis-assembly this replaced.
  cardLinkStatus: (x: number, y: number) => `${x} of ${y} in today`,
  // The circle NAME is gone from this line: it was the mis-assembly.
  // "you" is the group-of-people noun the count was always reaching for,
  // and the name is already on screen directly above every call site
  // (the stack card's title, the circle header) — it was redundant even
  // when it read correctly.
  groupAllInCelebration: (count: number) => `that's all ${count} of you in today 🔥`,
  // An active roster of exactly one: "all 1 of you" is not a sentence at
  // any phrasing, so the count drops out rather than being bent around.
  // Still a celebration — the day IS done, and the members who have gone
  // quiet are never the subject (warmth law: shame costs nothing).
  groupAllInCelebrationLone: "that's everyone in today 🔥",
  // An empty active roster. Before AU1 this hit the all-in branch too
  // ("that's all 0 of {circle} in today 🔥" — a celebration of nobody);
  // "yet" is what keeps it an open door instead of a verdict.
  cardLinkNobodyIn: 'nobody in yet today',

  wallHeaderTitle: (circleName: string) => `the ${circleName} wall`,

  // OD1 job 14 (22 July) — the re-entry moment must not say "no streak
  // lost" to everyone. This pair branches on the person's OWN glow
  // (getMyGlow().state), not just a declared away pause — a gap fully
  // covered by a friend is just as truly "nothing lost" as an away
  // pause, and a genuinely uncovered gap is not, regardless of which
  // produced it. Written for welcome-back, MIGRATED to Today's
  // notification spot by TN1 and read there now (lib/notificationSpot.ts);
  // CL1 retired the screen and its own strings, never this branch.
  // AU1 job 3d (3 Aug) — the em dash goes from both halves of the pair.
  welcomeBackSubtitleHeld: (circleCount: number) =>
    `no streak lost, no guilt. ${circleCount === 1 ? "your circle's" : 'your circles are'} still glowing.`,
  // Cat's wording, verbatim, 22 July — SUPERSEDED by her 3 Aug ruling.
  //
  // The old line ("no guilt — your own glow reset while you were away.
  // one check-in starts it fresh.") predates PA3. "Reset" describes a
  // counter going back to zero, which is what the glow used to do and no
  // longer is: since the pebbles memo (§5.1) a run ENDS, and the longest
  // rally is kept permanently as a record — "you return to a live number
  // of 1 and a permanent record of 40". Telling someone their glow reset
  // while the app is holding their longest rally for them describes a
  // loss that did not happen.
  //
  // "that run ended" names the end honestly (warmth law: misses cost
  // something) and the same sentence hands back what survives it (shame
  // costs nothing). Nothing here scolds, and nothing here references how
  // long they were away.
  welcomeBackSubtitleReset:
    'no guilt. that run ended, and your longest rally is kept. one check-in starts the next one.',

  // IL1 (6 Aug) — the invite becomes one tap. The old line sent a bare
  // https://rally21.com with the code beside it ("sign in … and enter code
  // ABC123"), so the first thing a cold arrival did was carry six
  // characters across a sign-in by hand. The code now rides IN the link,
  // which means it is still visible in plain text if a channel mangles the
  // URL — nothing is hidden, one step is removed. PROPOSED wording, Cat
  // nods in session.
  inviteShareMessage: (circleName: string | null, inviteCode: string) =>
    circleName
      ? `Join ${circleName} on Rally21! Tap ${buildInviteLink(inviteCode)} to hop in.`
      : `Join my Rally21 circle! Tap ${buildInviteLink(inviteCode)} to hop in.`,

  // IL1 job 1 — the /j/<code> landing, which a signed-out visitor sees
  // before the sign-in screen. THE FIRST REAL SEAM DATUM (Soraya, 5 Aug,
  // n=1): the first outside tester got through signup and circle creation
  // and stalled on "didn't quite understand the point" — so this landing
  // is a cold arrival's one chance to hear what Rally21 IS, in one plain
  // line, before being asked for an email address. One line only; this is
  // not an onboarding redesign. PROPOSED wording, Cat nods in session.
  inviteLandingTitle: "you've been invited",
  inviteLandingPurpose:
    'a friend has asked you to do one small daily practice together — a few minutes a day, side by side.',
  inviteLandingCodeLabel: 'your code',
  inviteLandingCta: 'sign in to join',
  // Says what happens next without promising the code is real — this
  // screen deliberately never asks the server whether the circle exists.
  inviteLandingReassurance: "we'll keep this code for you — no need to write it down",

  // IN1 (15 July) — "Share invite" opens a channel chooser instead of
  // silently copying. The message a channel carries is always
  // inviteShareMessage above (one source of truth — lib/sharing.ts only
  // encodes it); these strings are the chooser's own chrome plus the
  // mail channel's subject line.
  inviteMailSubject: (circleName: string | null) =>
    circleName ? `come join ${circleName} on Rally21` : 'come join my Rally21 circle',
  inviteChooserTitle: 'send it your way',
  inviteChooserSubtitle: 'the invite message is ready to go',
  inviteChannelMail: 'Mail',
  inviteChannelWhatsApp: 'WhatsApp',
  inviteChannelSms: 'Messages',
  inviteChannelCopy: 'copy instead',
  inviteChooserDismiss: 'not right now',
  inviteCopiedNotice: 'copied — paste it to your people',

  emptyGroupTitle: 'Penguins huddle better together',
  emptyGroupBody: 'Invite a friend to start your rally.',
  // OD1 job 22b (Cat, 23 July): the gold card CTA IS the invite action on
  // a solo circle — labelled as what it does, lowercase per LC1.
  emptyGroupCta: 'invite someone',

  chatTabLabel: 'Rally',
  // TB1 — the icon-only floating bar's a11y labels (icons only on
  // screen; every tab keeps a spoken name).
  tabTodayLabel: 'Today',
  tabCircleLabel: 'Circle',
  tabJournalLabel: 'Journal',
  tabPrivateMapLabel: 'Private Map',

  voiceDictationDeniedHint: 'you can also dictate with the keyboard mic 🎤',
  voiceMicDiscoveryHint: 'you can speak your answers 🎤 — often easier than typing',
  // OD1 job 1a (22 July) — VoiceMicButton is Web Speech API only and
  // renders null by design on native (see its own docstring); this app
  // was still promising it there via the WEB copy above with no platform
  // gate. Native's real path is the system keyboard's own dictation key,
  // which is what this line points at instead. PROPOSED — Cat's wording
  // wins over this draft.
  voiceMicDiscoveryHintNative: 'you can speak instead of typing — tap the 🎤 on your keyboard',
  // OD1 job 19 (22 July) — an N1 leftover: this screen still said "private
  // picture" from before N1 renamed the inner-life layer "your private
  // map" everywhere else. First contact a new user has with that layer,
  // so it's the one place the old name mattered most. The audit's own
  // draft; accent goes plum (inner-life colour), the green lock treatment
  // above it is untouched (that one is genuinely a confirmation, not a
  // private-map reference).
  checkinIntroTitleLead: 'this builds your',
  checkinIntroTitleAccent: 'private map',
  checkinQuestionInputPlaceholder: 'your answer',
  // Q3 (12 July) — binary questions render their own two options from the
  // DB (e.g. "want to" / "have to"); this pair is only a fallback for a
  // null/malformed options array, never the normal path.
  checkinBinaryFallbackYes: 'yes',
  checkinBinaryFallbackNo: 'no',

  // T1 (8 July) — timer resilience. The done-state label stays the same
  // whether the sit finished in the foreground or was caught up on
  // return from a backgrounded tab; timerCatchUpNote is the one extra
  // line that appears only for the latter, never a stale countdown or a
  // scolding tone.
  timerDoneLabel: 'nice — you showed up',
  timerCatchUpNote: 'your sit ended while you were away — it still counts',
  timerBackgroundHint: "keep this screen open to hear the chime — we'll keep it awake for you.",
  // HC1 job 1 — the timer screen's own chrome, hardcoded until now. Its
  // day pill is the same counter SignalMeter renders (signalDayCounter
  // below); both were capitalized while groupHeaderStatus was not.
  // Takes string|number: on this screen the day arrives as a route param,
  // so it is already a string and was interpolated as one before the move.
  timerDayLabel: (n: number | string) => `day ${n}`,
  timerCircleFallback: 'your circle',
  timerSettlePrompt: 'breathe, and let it settle',
  // The foot note reads "timed practice · or just mark as done", with the
  // second half bolded in place — two strings because it is one sentence
  // with one emphasized fragment, not two labels.
  timerFootNotePrefix: 'timed practice · or just ',
  timerFootNoteAction: 'mark as done',
  timerResumeCta: 'resume',
  timerPauseCta: 'pause',
  timerMarkDoneCta: 'mark as done',

  // BR1 (16 July) — the breathing pacer on the timer screen. The two
  // phase labels crossfade with the circle's swell/settle; the toggle is
  // a quiet text link, remembered per device, on by default.
  pacerBreatheIn: 'breathe in',
  pacerBreatheOut: 'breathe out',
  pacerTurnOff: 'just the timer',
  pacerTurnOn: 'breathe with the timer',

  practiceStepQuestion: 'what will you do each day?',
  // CF2 — the rebuilt circle flow's copy. Governing mental model,
  // verbatim from Cat's approved redesign: choose the practice, then
  // choose how to practise it. Titles lowercase per LC1.
  choosePracticeTitle: 'choose a practice',
  // CH5 conventions sweep — user-facing copy that had drifted inline
  // across the flow screens, moved home. Same words, one place.
  joinCircleTitle: 'got a code?',
  joinCircleSubtitle: 'enter the 6-character code your friend sent you',
  circleNameLabel: 'name your circle',
  circleNamePlaceholder: "your circle's name",
  resourceLinkLabel: 'add a link (optional)',
  resourceLinkPlaceholder: 'a video, article, or playlist your circle follows',
  checkinGratefulPlaceholder: 'one small thing today',
  checkinLearnedFallbackLabel: 'learned (optional)',
  checkinLearnedFallbackPlaceholder: 'anything you noticed',
  practiceNamePlaceholder: 'e.g. Walk 20 minutes',
  practiceDurationPlaceholder: 'duration in minutes (optional)',
  findPracticePlaceholder: 'find a practice',
  profileNamePlaceholder: 'your name',
  createPracticeRow: '+ create a practice',
  inviteCodeRow: 'have an invite code?',
  createPracticeTitle: 'create a practice',
  suggestedGroupingLabel: 'suggested grouping',
  suggestedGroupingProvenance: 'Rally suggested this from your practice name',
  createPracticeContinue: 'continue',
  hubHowQuestion: 'how do you want to practise?',
  hubGoSoloTitle: 'go solo',
  hubGoSoloBody: 'just you, for now — your circle can grow later',
  hubStartCircleTitle: 'start a circle',
  hubStartCircleBody: 'do it together — invite friends, or open it up',
  hubOpenCirclesLabel: 'open public circles',
  soloSetupAccent: 'a circle of one',
  // RF1 job 1 — the "21 days" duration now lives in firstRallyHeader
  // below the summary card, so this caption only needs to carry cadence.
  soloSetupSummaryDays: 'daily',
  soloStartCta: 'start my first 21 days',
  circleSetupTitle: 'start a circle',
  // RF1 job 1 — the commitment frame at solo-setup and start-circle
  // (Cat's wording, verbatim, 22 July): 21 is the first rung of the
  // journey ladder, never the whole thing. The supporting line stays
  // short on purpose — the milestone strip below it already shows
  // 50/100/365, so naming them again here would say it twice.
  firstRallyHeader: 'your first rally: 21 days',
  firstRallySupportingLine: '21 is the first stop, not the last',
  durationLabel: 'how long each day? (optional)',
  durationSuggestedHelper: 'a timer helps this one — change or clear it freely',
  // The chosen dose's one rendering shape, everywhere it appears
  // ("Walk · 15 min").
  practiceDose: (name: string, minutes: number) => `${name} · ${minutes} min`,
  visibilityQuestion: 'who can join?',
  visibilityPrivateTitle: '🔒 private',
  visibilityPrivateBody: 'invite link or code only · not searchable',
  visibilityPublicTitle: '🌍 public',
  visibilityPublicBody: 'listed under this practice · anyone can join',
  // PT1's is_shared model: creating a PUBLIC circle on a private custom
  // practice makes the practice itself visible to others — its own
  // explicit confirm step, never buried in visibility copy.
  shareFlipConfirmTitle: 'one thing before you open it up',
  shareFlipConfirmBody: (practiceName: string) =>
    `A public circle lists “${practiceName}” for other people to find and use — right now only you can see it. All good?`,
  shareFlipConfirmCta: 'yes, share my practice',
  shareFlipCancel: 'keep it private',
  // PT1 guided creation — the classifier's one editable chip line, and
  // the warm manual-pick prompt when nothing matches. Never a blocker.
  practiceTypeSoundRight: 'sound right? tap to change',
  practiceTypePickPrompt: 'where does this live? pick a shelf so your circle can find it',
  practiceTypePickDomain: 'pick a shelf',
  practiceTypePickType: 'and what kind?',
  circleNameHelper: "this is your team's name — make it yours",
  // Solo-only "when's your first one?" choice on the commitment screen
  // (SF1, Cat 7 July). Neither option is judged; "right now" is default so
  // an evening signup can reach the timer/question/confetti in session one.
  soloFirstWhenLabel: "when's your first one?",
  soloFirstNow: 'right now',
  soloFirstTomorrow: (timeLabel: string) => `tomorrow ${timeLabel}`,

  // O1 (Apple slice, 12 July) — shown on profile setup for any brand-new
  // Apple-created account, private-relay email or not: Apple IDs often
  // live on an old address that won't match a member's real Rally email,
  // so a warm sign-out nudge here catches that case even when Hide My
  // Email isn't involved. No merge feature exists yet (deferred), so this
  // is prevention, not a fix — see DEFERRED.md.
  onboardingAppleRescueLine:
    'this looks like a brand new account — if you already use Rally somewhere else, sign out above and sign back in the way you did before',

  // BD1 — birthdays. Collected at sign-up (optional) and editable in
  // settings; celebrated in circles on the day. The year, if given, is
  // never shown and never turned into an age. Copy states the visibility
  // plainly (circle-mates can see the day) per the spec.
  birthdayLabel: "when's your birthday?",
  birthdayOptionalTag: '(optional)',
  // WB1 job 2 (4 Aug) — the em dash goes, per Cat's ruled Option B copy.
  birthdayWhy: 'so your circle can celebrate you on the day. the year stays private, and you can skip this',
  birthdayMonthSubLabel: 'month',
  birthdayDaySubLabel: 'day',
  birthdayYearSubLabel: 'year (optional)',
  birthdayYearPlaceholder: 'e.g. 1990',
  birthdayDayPlaceholder: 'e.g. 14',
  // WB1 job 2 — the month is typed now, so its placeholder is a NUMBER,
  // and the numeral is the point: the labelled boxes exist precisely so
  // nobody has to guess whether 03/04 is March or April.
  birthdayMonthPlaceholder: 'e.g. 4',
  // WB1 job 2 — the quiet hint set. Every one of these states a range or
  // asks for the missing half; none of them tells anybody off (warmth
  // law), and none appears until there is something real to say about
  // what was typed. "add a month too" replaced "pick a month too" with
  // the chips it referred to: nothing is picked on this block any more.
  birthdayPickMonthFirst: 'add a month too',
  birthdayAddDayToo: 'add a day too',
  birthdayDayOutOfRange: 'days go from 1 to 31',
  birthdayMonthOutOfRange: 'months go from 1 to 12',
  birthdayYearOutOfRange: (min: number, max: number) => `years go from ${min} to ${max}`,
  birthdayDayNotInMonth: (monthFull: string, max: number) => `${monthFull} only has ${max} days`,
  birthdayInvalid: "that day isn't in that month — pick another",
  settingsBirthdayLabel: 'your birthday',
  birthdayCelebrateLabel: 'celebrate my birthday',
  birthdayCelebrateHelper:
    'when on, your circles see your birthday and can celebrate you on the day. off means it stays hidden — nothing shows anywhere.',
  // HC1 — settings.tsx's plain "Save" and "Sign out" moved in below
  // (saveCta / signOutCta), which is what unblocked this one and the other
  // two settings-screen buttons (unblockCta, shareCardReEnableCta).
  birthdaySave: 'save birthday',
  // YD1 — each save on the settings screen confirms what it actually
  // saved: the birthday save was reusing the name-save toast ("your name
  // has been updated" after saving a birthday, Cat's on-device find).
  settingsNameSaved: 'your name has been updated',
  settingsBirthdaySaved: 'your birthday has been saved',
  birthdaySelfLine: (name: string | null) => `happy birthday${name ? `, ${name}` : ''} 🎂`,
  birthdayMemberLine: (name: string) => `it's ${name}'s birthday today 🎂`,
  // GS1 — the glow goes social. The wall line itself is composed
  // SERVER-SIDE in check_glow_milestone (S1's rule: a definer function
  // never accepts client copy); this reference copy documents it and
  // must stay verbatim-identical to the migration — lib/glowWallLine.test.ts
  // reads the migration and fails if they drift.
  //
  // AU1 job 1 (3 Aug) — PAST TENSE, and the tense is the whole fix. This
  // is a wall row: written once, frozen, read for months. "has been
  // glowing 7 days" asserts a state that holds NOW, so it began lying
  // the day after it was written and by day 13 was contradicting the
  // flame on the same screen. "hit 7 days glowing" records a moment,
  // which is what a wall row is, and matches the journal fact the same
  // function writes in the same transaction ("hit 7 days glowing on
  // July 29, 2026"). A moment cannot drift.
  glowSocialWallLine: (name: string, days: number) => `${name} hit ${days} days glowing 🔥`,
  // NOT changed, and deliberately so: this label is spoken over the LIVE
  // flame, which re-reads get_glow_for_user on every load. A present-tense
  // claim is correct for a number that is recomputed every time it is
  // shown — the drift above came from freezing one, not from the tense
  // itself.
  glowFlameA11yLabel: (name: string, days: number) => `${name} has been glowing ${days} days`,
  publicShareDisclosure: 'Public circles share their practice to the library, so others can start their own',
  myPracticesSubtitle: 'your practice library — reuse them in new circles. shared ones can be picked by others.',
  practicePillShared: 'shared',
  // CF2: "only you" reworded warmer — same logic (a custom practice
  // visible to nobody else), the badge just reads as belonging, not
  // exclusion.
  practicePillOnlyYou: 'your practice',

  // Cover a friend — covering is a celebrated gift, never a debt. No
  // copy anywhere should read as a score, an "owed", or guilt (see
  // CLAUDE.md's cover-a-friend rule).
  coverAffordance: '🧡 cover',
  // HW1 (15 July): every circle-mate offers BOTH gestures, always —
  // send a heart or a wave, checked in or not. The heart is an even
  // lighter gesture than the wave: pure warmth, no ask attached. In a
  // fuller huddle the pills shrink to their glyphs (never dropping a
  // gesture); the words move to the accessibility labels.
  heartAffordance: '🧡 heart',
  waveAffordance: '👋 wave',
  heartAffordanceCompact: '🧡',
  waveAffordanceCompact: '👋',
  heartPillA11yLabel: (name: string) => `send ${name} a heart`,
  wavePillA11yLabel: (name: string) => `wave at ${name}`,
  coverHintDiscovery: "you can log a friend's day for them — a gift, never a debt.",
  coverHeadline: (name: string) => `${name}'s been quiet`,
  // CV1 (23 July) — cover is a next-day rescue of the missed day, so the
  // affordance and note name yesterday, not today.
  coverSubtitle: "cover yesterday — it's a gift, not a debt 🧡",
  coverNotePreview: (covererName: string) =>
    `They'll get a warm note: "${covererName} covered you for yesterday. No pressure, we've got you."`,
  // W1: shown instead of coverHeadline/coverSubtitle/coverNotePreview
  // when the member has already checked in — "they've been quiet" would
  // be factually wrong, and there's no cover note to preview.
  waveHeadline: (name: string) => `say hi to ${name}`,
  waveSubtitle: 'a wave is always welcome, even after they\'ve shown up',
  waveNotePreview: (waverName: string, name: string) =>
    `${name} will see: "${waverName} waved at ${name} 👋" on the circle wall.`,
  coverActionLabel: '🧡 cover & send love',
  waveActionLabel: '👋 just a wave hello',
  coverCta: (name: string) => `cover ${name} for yesterday`,
  waveCta: (name: string) => `wave hello to ${name}`,
  waveCapReachedError: "you've sent a lot of waves today — give it a little rest and try again tomorrow 🧡",
  waveOptedOutError: (name: string) => `${name} isn't taking waves right now`,
  // HW1 — the heart's warm outcomes, mirroring the wave's patterns
  // above. A gesture never fails socially; every designed rejection
  // maps to warm copy.
  // WL3 (23 July) — per-sender dedupe means this now only fires when I
  // repeat MY OWN heart to the same friend the same day; another friend's
  // heart lands fine. So the copy speaks to me, not "someone else".
  alreadyHeartedError: (name: string) => `you already sent ${name} a heart today 🧡`,
  heartCapReachedError: "you've sent a lot of love today — give it a little rest and try again tomorrow 🧡",
  heartOptedOutError: (name: string) => `${name} isn't taking hearts right now`,
  heartNotDeliveredError: "this heart couldn't go through right now",
  // The heart's wall line — composed server-side in send_friend_nudge
  // from this exact template (same S1 F4 pattern as the wave's line);
  // this entry is the copy's source of truth and must stay verbatim in
  // sync with the migration.
  wallHeartEntry: (senderName: string, name: string) => `${senderName} sent ${name} a heart 🧡`,

  // AV1 — placeholder penguin avatars (Cat's rulings, 20 July; design
  // record in Rally21-Mascot-Brief.md → "Placeholder penguin avatars").
  // The ask copy is Cat's own, verbatim. Dismissing marks it seen
  // forever — the dismiss label is honest about that (never a "later"
  // that secretly means never).
  photoAskBody: "your circle's cheering for this little penguin. add your photo so they can cheer you instead?",
  photoAskCta: 'add your photo',
  photoAskDismiss: 'keep the penguin',
  ownPenguinTapA11yLabel: 'add your photo',

  // TN1 (24 July, Cat's ruling — mockup APPROVED) — Today's ONE
  // notification surface. WL2's whisper lines are RETIRED into it: the
  // same recipient-private warmth now reads inside the spot, alongside
  // the welcome-back moment and the everyday cover. Never a badge,
  // never a count that accumulates guilt — warmth or absence.
  todaySpotKickerWelcomeBack: 'welcome back',
  todaySpotKickerEveryday: 'from your circle',
  // Carries the retired welcome-back screen's shipped title as one plain
  // line — the spot has no serif hero. Since CL1 (28 July) this is the
  // only surviving copy of that sentence; the screen's own two-part
  // lead/accent strings were deleted with it. This is the
  // NEUTRAL welcome line: what everyone saw before ON2 and what everyone
  // who never answered Q2 still sees.
  todaySpotWelcomeHeadline: 'your place is still here',
  // ON2 job C (28 July) — the lean. The Day-0 obstacle biases WHICH
  // EXISTING welcome-back line surfaces after a miss, and nothing else:
  // no new copy, no recomputation, NS1's timing math untouched. Every
  // line here is drawn verbatim from the NQ1 pools below
  // (NUDGE_RESTART_LINES first — restart-framed is the right voice after
  // a miss — and NUDGE_WARM_LINES where the restart half has no line for
  // that obstacle); onboardingIntake.test.ts pins each one to its pool so
  // this map can never quietly become a new copy surface. An unanswered
  // (or unrecognised) obstacle falls back to todaySpotWelcomeHeadline.
  //
  // PROPOSED pairings — Cat's wording wins, as with the Day-0 sentence.
  // RULED 28 July (Cat, on the docs recommendation): the four other
  // pairings STAND as shipped, and 'alone' borrowing the warm half's
  // circle line is BLESSED as correct by design — the obstacle is
  // answered only by the circle, which the restart half never mentions.
  // 'forget' was the one honest compromise (no line in either pool named
  // the nudge mechanic, so it took the closest "you haven't lost the
  // thread" line); FF2 job D1 gave the restart pool a line that names the
  // mechanic, and the lean now points at it.
  todaySpotWelcomeLineByObstacle: {
    forget: 'no need to hold it in your head, your nudge comes just before your usual time.',
    no_time: 'no catching up required — just a little something today.',
    lose_motivation: 'day one energy is good energy.',
    miss_once: "starting again is a skill — and you're already practicing it.",
    alone: 'the circle keeps a light on for you.',
  } as Record<string, string>,
  // AU1 job 3c (Cat's ruling, 3 Aug) — ONE CARD PER PERSON, everything
  // they sent merged into its sentence.
  //
  // WHAT THIS REPLACES: waves grouped ACROSS people into one line
  // ("Russ and Catherine sent you a wave") while hearts, covers and
  // pebbles each took a line of their own. Two consequences, both live:
  // the same person waving in two of your circles rendered "Cathy S and
  // Cathy S sent you a wave 👋" (the wave list was the one moment list
  // never deduped by sender), and someone who waved AND hearted you
  // occupied two of the three slots on their own.
  //
  // Per-person is also what the ruled Option B look requires: each
  // sender's white inner card carries THEIR avatar, and a line grouped
  // across senders would leave that slot ownerless.
  //
  // The gift fragments compose; the single-kind sentences below stay
  // byte-identical to the shipped ones, which notificationSpot.test.ts
  // pins.
  todaySpotGiftWave: 'a wave 👋',
  todaySpotGiftHeart: 'a heart 🧡',
  todaySpotGiftPebble: 'a pebble 🪨',
  todaySpotSentLine: (senderName: string, gifts: string) => `${senderName} sent you ${gifts}`,
  todaySpotCoverLine: (covererName: string) => `${covererName} covered you yesterday`,
  // A cover is not a thing that was "sent", so it takes its own clause
  // rather than being flattened into the gift list.
  todaySpotCoverAndSentLine: (covererName: string, gifts: string) =>
    `${covererName} covered you yesterday and sent you ${gifts}`,
  // Now counts PEOPLE folded away rather than moments, because a card is
  // a person. Still never a badge and never a total that accumulates.
  todaySpotOverflow: (count: number) => `and ${count} more from your circle`,
  // The check-in echo — one warm line in the completion screen's quiet
  // zone (below the CTA, above the push ask), once, never stale.
  warmthEchoHeart: (senderName: string) => `while you were away — a heart from ${senderName} 🧡`,
  warmthEchoWave: (senderName: string) => `while you were away — a wave from ${senderName} 👋`,
  // The wall teaser — one quiet line per circle under the members, only
  // when the wall holds something newer than the user's last visit.
  // Celebration lines already carry their sender's name in the body, so
  // only human posts get the name prefix.
  wallTeaserPost: (senderName: string, snippet: string) => `${senderName}: ${snippet} →`,
  wallTeaserCelebration: (snippet: string) => `${snippet} →`,

  // coveredNoteToCoveredMember retired with TN1 (24 July): Today's
  // next-day cover note folded into the notification spot, whose
  // approved wording is todaySpotCoverLine. Its "No pressure, we've got
  // you" reassurance lives on verbatim in circleCoveredYouCardBody
  // below, which the circle screen still renders.
  // wallCoveredEntry retired with WL1: the wall no longer renders
  // check-in rows, covered or plain — the cover screen and next-day note
  // carry the gift's copy now.
  // The wave's wall line (was wallWaveEntry) now composes server-side in
  // send_friend_nudge (security spec S1, F4) — the copy is unchanged,
  // just no longer client-composed.

  circleYouCoveredCard: (name: string) => `You covered ${name} for yesterday 🧡`,
  circleYouCoveredCardBody: "The signal stays warm for everyone. That's the whole point.",
  circleCoveredYouCard: (covererName: string) => `${covererName} covered you for yesterday 🧡`,
  circleCoveredYouCardBody: "No pressure, we've got you.",

  // App sounds (mascot brief) — the single toggle governing both sounds
  // in the app: the check-in timer's completion chime and the check-in
  // success chime.
  soundsSectionLabel: 'sounds',
  soundsToggleLabel: 'app sounds',
  soundsToggleHelper: 'a soft chime when you finish a timed practice or complete a check-in.',

  // Notifications settings (Notifications spec §5) — an invitation, never
  // an obligation. No streak/urgency language in any of these labels.
  notificationsSectionLabel: 'notifications',
  nudgeToggleLabel: 'daily nudge',
  nudgeToggleHelper: "one small reminder when today's practice is still open — never if you've already shown up.",
  nudgeTimeLabel: 'remind me',
  nudgeTimeEarliest: "circle's usual time",
  // NS1 (13 July): once there's enough check-in history, the actual send
  // time quietly learns your own rhythm instead — this chip is honestly
  // just the starting point until then, never an exact alarm.
  nudgeTimeHelper: 'a starting point — once we learn your rhythm, nudges land a little before your usual time instead.',
  friendNudgeToggleLabel: 'nudges from circle-mates',
  friendNudgeToggleHelper: "let someone in your circle send you a quiet wave if you've been quiet — never more than one a day.",
  digestToggleLabel: 'evening digest',
  digestToggleHelper: "a short recap if something warm happened and you haven't seen it yet.",
  // PN1 (13 July) — push is an OS-level permission, not a plain prefs
  // toggle, so this row's pill/tap behavior differs by state: undetermined
  // shows the real system dialog on tap; granted is a static "on" (only
  // iOS Settings can revoke it); denied deep-links to iOS Settings since
  // re-requesting silently does nothing once already decided.
  pushToggleLabel: 'push notifications',
  pushToggleHelperUndetermined: 'get nudges on your phone instead of by email, when your circle needs you.',
  pushToggleHelperDenied: 'turned off in iOS Settings — tap to open and turn it back on.',
  pushToggleHelperGranted: "you're all set — nudges arrive right on your phone.",
  quietHoursLabel: 'quiet hours',
  // YD1 — pre-push copy said "no emails"; quiet hours gate EVERY channel
  // in send-notifications (the quiet-hours hold sits above both the push
  // attempt and the email fallback), so the words name push, the channel
  // people actually think in.
  quietHoursHelper: 'no push notifications between these hours, your local time.',
  // YD1 — the 2-a-day promise (Cat's ruling, 21 July). Verified real in
  // send-notifications before wording it: every kind passes the generic
  // deliveredToday >= 2 gate before either channel fires, counted per
  // recipient local day, so ≤2 total/day is enforced, not aspirational.
  // Keep the numeral "2" in every home of this promise — no
  // numerals-vs-words drift (pushAskLine, remindersAskBody carry it too).
  notificationsCapPromise: 'never more than 2 a day — and none during your quiet hours.',
  quietHoursFromLabel: 'from',
  quietHoursUntilLabel: 'until',

  // AL1 (30 July, Cat's ruling 27 July) — a reminder at a time YOU choose,
  // rather than a time the app infers. NEVER the word "alarm" anywhere a
  // person can read it: an app cannot ring through a silenced iPhone (only
  // Apple's Clock app can), so calling it one would be a promise the
  // feature cannot keep. Native only — see alarmReminderWebHidden's
  // absence: there is deliberately no "not available on web" line, because
  // on web the control does not render at all.
  alarmToggleLabel: 'remind me at my own time',
  alarmToggleHelperOff:
    'pick a time that fits your day, and get one quiet reminder then. off unless you turn it on.',
  alarmToggleHelperOn: (time: string) => `one quiet reminder at ${time}, and none once you've checked in.`,
  // Shown when iOS has notifications switched off for Rally21: the
  // preference saved fine, the phone is what is silent. Same deep-link
  // instruction as PN1's push row, which is the pattern people already met.
  alarmPermissionDenied: 'notifications are off for Rally21 in iOS Settings, so this cannot reach you yet.',
  alarmTimeMinuteLabel: 'minute',
  alarmTimeMorningLabel: 'morning',
  alarmTimeAfternoonLabel: 'afternoon and evening',
  // The prefill rule's one visible consequence: when every circle a person
  // is in agrees on a time, that time is offered rather than guessed at.
  alarmPrefillNote: (time: string) => `your circles all meet at ${time}, so we started you there.`,
  // The scheduled notification itself. Generic by design, not by omission:
  // one personal reminder covers every circle, so it cannot name a
  // practice (AL1's stated trade). Commas, not em dashes.
  alarmReminderTitle: 'Your practice time',
  alarmReminderBody: "you chose this moment, and it's here whenever you're ready.",
  alarmReminderChannelName: 'Practice reminders',

  // RS2 (13 July, Rally21-Glow-Spec.md §9) — the away pause. Self-serve,
  // never advertised with absence math: circle-mates just see a calm
  // sleeping penguin at the huddle's edge, never "away for N days".
  awaySectionLabel: '😴 taking a break',
  awayToggleLabel: 'away pause',
  awayToggleHelperOff:
    "heading out for a while? pause everything — no nudges, no digest, nothing decays. come back anytime, even just by checking in.",
  awayToggleHelperOn: "you're paused — nothing will nudge you, and nothing's decaying while you're gone.",

  // Friend nudge (Notifications spec §4b) — pre-written only, so every
  // nudge is safe to receive. This absorbs the cover-a-friend "wave"
  // gesture. The subject/message pool and wall-line template all compose
  // server-side now (security spec S1, F4) — send-notifications and
  // send_friend_nudge keep their own copies of this copy, same pattern as
  // NUDGE_WARM_LINES below.
  // WL3 (23 July) — per-sender dedupe: this now only fires when I repeat
  // MY OWN wave to the same friend the same day (another friend's wave
  // lands fine), so the copy speaks to me. Glyph fixed to 👋 (was 🧡, a
  // pre-existing wave/heart mismatch noted 22 July).
  alreadyNudgedError: (name: string) => `you already sent ${name} a wave today 👋`,

  // Open circles — wall permissions + host controls (multi-circle spec,
  // "Open circles" section). Members react until they've earned free-text
  // posting (7 completions in that circle) or unless they're the creator;
  // private circles are unchanged. Warm copy, no shaming (see CLAUDE.md).
  openCircleReactOnlyHint: 'react now, write after 7 check-ins',
  openCircleVoiceUnlockedTitle: '7 days in — your voice is welcome on the wall.',
  joinDisclosure:
    'Others here will see your name, photo, and daily check-ins — your reflections stay private.',
  hostRemoveMemberConfirm: (name: string) => `remove ${name} from this circle?`,
  hostRemoveMemberBody: 'They can rejoin later with the invite code — this just clears a spot for now.',
  // HC1 — circle.tsx's five hardcoded "Cancel" buttons and its "Remove"
  // now read cancelCta/removeCta, so this whole confirm-row family (here
  // and the report/block set below) could move together as LC2 required.
  hostRemoveMemberCta: 'remove',
  // HC1 — the circle screen's own buttons and quiet links, typed inline
  // until now. The confirm bodies are prose and keep sentence case; every
  // label and link takes the law's lowercase.
  circleLeaveLink: 'leave this circle',
  circleLeaveConfirmCta: 'leave circle',
  circleLeaveConfirmBody: (circleName: string) =>
    `Leave ${circleName}? Your check-ins stay yours, and you can always come back with an invite.`,
  circleInviteSomeoneCta: '✨ invite someone',
  circleManageMembersLink: 'manage members',
  circleHideMembersLink: 'hide members',
  circleMemberFallbackName: 'circle-mate',
  circleEditLinkLink: 'edit link',
  circleAddLinkPrompt: '+ add a link your circle follows',
  circleOpenWallLink: 'open the circle wall →',
  hostCloseToJoinsLabel: 'closed to new joins',
  hostCloseToJoinsHelperOpen: 'anyone with the code or browsing open circles can join',

  // CF1 — one pluralization for every open-circle count surface:
  // "1 open circle", "N open circles", "no open circles yet". The number
  // itself is the caller-scoped joinable count (one server rule feeds
  // both the tiles and the hub list — see the cf1 migration).
  openCirclesCount: (n: number) =>
    n === 0 ? 'no open circles yet' : n === 1 ? '1 open circle' : `${n} open circles`,
  // PB1 — the browse safety net: a domain (or a search within one) with
  // no practices never renders as a bare create-your-own card; this warm
  // line sits above it instead.
  // CF2: the create row moved ABOVE the grid, so the pointer moved with it.
  browseEmptyShelf: 'nothing here yet — tap “+ create a practice” above and yours can be the first.',
  // ER1 — every screen-level load failure renders this one warm shape,
  // never a raw error message or status code (AR1's warmth rule,
  // generalized app-wide; raw errors still go to Sentry, not the user).
  loadFailedLine: (what: string) => `${what} couldn't load just now — give it a moment and try again`,
  // HY1 job 7 — the load that never ANSWERED, as opposed to the one that
  // failed. SUP1's 15s deadline had no sentence of its own, so a timeout
  // borrowed loadFailedLine, which says "couldn't load" — true enough,
  // but it points at the app when the honest thing to point at is the
  // connection. YD1's register: say the small true thing rather than the
  // reassuring general one. Pairs with retryCta, because "try again" is
  // only fair advice when there is something to tap.
  // PROPOSED — Cat's wording wins, as with every other line here.
  loadTimedOutLine: (what: string) => `${what} is taking longer than it should — the connection may be slow`,
  retryCta: 'try again',
  // FF2 (28 July) — ER1's other half: a WRITE that didn't land. Today had
  // no such line, so the two fixes that must say "your tap didn't save"
  // (the reminders card, the Day-0 obstacle answer) would otherwise have
  // had to borrow loadFailedLine and claim something failed to LOAD.
  // Same register, same shape as reflectionsToggleFailed below.
  // PROPOSED — Cat's wording wins, as with every other line here.
  saveFailedLine: "that didn't save just now — give it a moment and try again",
  hostCloseToJoinsHelperClosed: "you're not taking new members right now",

  // EC1 (16 July) — hosts edit their circle from Host Controls or the ✎
  // manage entry by the title. One quiet informative line (Cat's ruling:
  // never scolding, never a confirmation maze); nothing on this screen
  // can touch the day counter.
  editCircleTitle: 'edit your circle',
  editCircleQuietNote: 'your circle will see this change',
  editCirclePracticeLabel: 'the practice',
  editCirclePracticeHelper: 'what your circle does each day',
  editCirclePracticeDurationPlaceholder: 'duration in minutes (optional)',
  editCircleSaveCta: 'save changes',
  hostEditCircleLabel: 'edit circle',
  hostEditCircleHelper: 'name, time of day, link, or the practice itself',
  // PI1 — practice instructions: an optional routine + link, tucked
  // behind a quiet action on setup/edit and a quiet link on the circle
  // screen. Titles lowercase per LC1. Copy carries the warmth voice:
  // never a required step, never nagged.
  practiceInstructionsActionAdd: 'add practice instructions (optional)',
  practiceInstructionsActionEdit: 'practice instructions',
  practiceInstructionsActionEditHint: 'added — tap to edit',
  practiceInstructionsTitle: 'practice instructions',
  practiceInstructionsHelper:
    'a routine your circle follows — sets and reps, a breathing pattern, a warm-up. optional, and only your circle sees it.',
  practiceInstructionsLabel: 'the routine',
  practiceInstructionsPlaceholder: 'e.g. 3 rounds — 10 slow breaths, then rest a minute',
  practiceInstructionsSaveCta: 'save',
  practiceInstructionsBackToSetup: 'back',
  // The quiet link on the circle screen, shown only when instructions exist.
  practiceInstructionsLink: 'practice instructions →',
  practiceInstructionsViewBack: 'your circle',
  practiceInstructionsViewLinkLabel: 'the link',
  manageCircleAffordance: '✎ manage',
  manageCircleA11yLabel: 'manage circle',

  // Pre-sign-in onboarding (rev-7 mockup screens 1–3) — signed-in users
  // never see these; a signed-out visit to the app starts here.
  introSplashTagline: 'do it together',
  introSplashSubtitle: 'a few lines a day · paid back as a gift',
  introWelcomeTitleLead: "don't do it alone.\ndo it ",
  introWelcomeTitleAccent: 'together',
  introWelcomeBody:
    'Pick a small daily practice with a circle of friends. Show up for each other, a couple of lines a day.',
  // A quiet solo-inclusive line under the body — the huddle is still the
  // headline, but a stranger arriving alone shouldn't feel out of place
  // (SF1, Cat 7 July).
  introWelcomeSoloLine: 'Start alone if you like — the huddle can come later.',
  introWelcomeNext: 'next',
  introWelcomeSignInLink: 'I already have an account',
  introPrivacyTitleLead: 'your inner life,',
  introPrivacyTitleAccent: 'yours alone',
  introPrivacyBullets: [
    'Only you ever see your reflections. Your circle sees just what you choose.',
    'We never sell your data. No ads, ever.',
    // YD1 (21 July) — "correct or delete anything" leaned on the
    // single-check-in delete (gone, Cat's 20 July ruling); this names
    // what the your-data screen actually offers so it never overpromises.
    'You can see, export, or delete your data, anytime.',
  ],
  introPrivacyCta: 'sounds good',
  introPrivacyReadFullLink: 'read the full privacy policy',

  // RM1 (13 July) — the reminders ask (mockup screen 6, rev-7): a new
  // sign-up sees this once, in flow, between profile and circle-setup;
  // an existing user with the flag unset sees a compact version of the
  // same copy as a one-time dismissible Today card (components/
  // RemindersAskCard.tsx renders both).
  remindersAskTitleLead: "don't leave your ",
  remindersAskTitleAccent: 'circle',
  remindersAskTitleTrail: ' hanging',
  // YD1 (21 July) — gains the 2-a-day promise, same numeral as
  // notificationsCapPromise and pushAskLine.
  remindersAskBody:
    "A gentle nudge when it's time to check in, and when your circle could use you. No noise, no spam — never more than 2 a day.",
  remindersAskCta: 'turn on reminders',
  remindersAskMaybeLater: 'maybe later',
  // AL1 job 4 — the personal practice time rides RM1's ask rather than
  // getting a second onboarding step, so notifications stay ONE
  // conversation. Native only, and genuinely optional: the row starts off,
  // and "turn on reminders" saves it only if the person turned it on.
  remindersAskAlarmRowLabel: '⏰ and remind me at my own time',

  // WB1 job 1a (4 Aug, from Cat's fresh-account walk) — THE ANSWER TO
  // YES. "turn on reminders" wrote the prefs and the card vanished, so
  // the tap read as nothing having happened, and on Today the next
  // one-time ask slid into the same slot on the same render, which read
  // as a segue into a photo pitch. The card now swaps in place to a
  // one-line confirm that names what actually turned on.
  //
  // PLATFORM-SPLIT, and the split is the honesty (the voice-hint
  // precedent, OD1 job 1a/c/d). A LOCAL SCHEDULED REMINDER DOES NOT
  // EXIST ON WEB — expo-notifications' scheduler is native-only, which is
  // why AL1 hides the row there rather than disabling it — so a web yes
  // enables exactly two things, the daily nudge and the evening digest,
  // and both reach a browser user as EMAIL. A shared line saying "we'll
  // remind you" would be a promise the web build cannot keep. On native
  // the same two go out as push when a device token exists and as email
  // otherwise (PN1), so the native lines name the nudge without naming a
  // channel — which is true on both of that platform's paths.
  //
  // ALL OF THIS COPY IS PROPOSED, FOR CAT'S NOD. Warmth laws, commas
  // rather than em dashes, and never the word "alarm" (AL1's standing
  // rule: an app cannot ring through a silenced iPhone, so calling it one
  // would promise something the feature cannot do).
  remindersConfirmWeb: "reminders are on, by email: a gentle nudge when it's time, and an evening recap.",
  remindersConfirmNative: "reminders are on. we'll nudge you when it's time, and when your circle could use you.",
  remindersConfirmNativeWithTime: (time: string) =>
    `reminders are on, and your own quiet reminder comes at ${time}.`,
  // The one-time settings pointer, shown only on native and only when the
  // person left their own time OFF. AL1's default-off is a RULING and is
  // untouched here: this points at the door, it does not open it. One-time
  // by construction rather than by a new flag — the ask it rides is
  // itself once-per-account-ever.
  remindersConfirmTimePointer: 'you can pick your own reminder time in settings whenever you like.',
  remindersConfirmContinueCta: 'continue',

  // Today's reflection teaser (D4 design review) — an invitation, never a
  // reminder of something missed. Only shows before today's reflection is
  // written; disappears the moment it is (see CLAUDE.md's color-roles
  // convention — this earns plum as inner-life content).
  // MN2 ride-along (Cat's ruling, 30 July) — the teaser prints the question
  // as ordinary text, so the `*accent*` markers are stripped HERE rather
  // than at the two call sites. Deliberate: today.tsx is outside MN2's
  // scope, and the composition of this sentence is this function's job
  // anyway, so the fix belongs to the string, not the screen.
  reflectionTeaser: (questionPrompt: string) =>
    `tonight: "${stripAccentMarkers(questionPrompt)}"`,

  // ── SK1 (24 July): reflections are optional ──────────────────────────
  // Cat's ruling (23 July, from the live check-in screen): the reflection
  // step must never be the reason someone drops off. TWO of these are
  // Cat's own verbatim wordings and beat any rewrite: "skip for now" and
  // "just check-ins for me" (picked over "skip always" / "not interested"
  // — a positive choice, never a rejection). Everything else here is
  // PROPOSED, for Cat to accept or strike.
  //
  // The NO-NAG LAW governs all of it: once someone has opted out, the
  // confirm card is the last unprompted word the app ever says about
  // reflections. These strings only ever render where the person walked
  // in themselves.
  checkinSkipForNow: 'skip for now',
  checkinReflectionsOffLink: 'just check-ins for me',
  // The one gentle confirm. Comma, not an em dash (Cat's standing
  // preference), and it names every way back so the choice never feels
  // like a door locking.
  // CASING RULED 27 July: sentence case, because this is prose and the
  // other four confirm bodies moved with LC2 — leaving this one lowercase
  // was visible drift, not a preserved ruling. Cat's 24 July ruling was
  // about the WORDS, and every word here is still hers.
  checkinReflectionsOffConfirmBody:
    'You can turn these back on anytime, from your journal, your private map, or settings.',
  checkinReflectionsOffConfirmCta: 'just check-ins for me',
  checkinReflectionsOffConfirmCancel: 'keep reflections',
  // The inline toggle (components/ReflectionsToggleRow.tsx), worn
  // identically by journal, private map, ask Rally and settings. Helper
  // is the mockup's line: what it costs, and who it belongs to.
  reflectionsToggleLabel: 'daily reflections',
  reflectionsToggleHelper: 'a minute at check-in, only ever yours',
  reflectionsSectionLabel: 'reflections',
  // A failed flip, wherever the toggle lives. The row snaps back to the
  // truth, so this only has to say "not saved, try again".
  reflectionsToggleFailed: "that didn't save just now, give it a moment and try again",
  // THE CURIOSITY LAW (Cat, 23 July): show what is dormant TRUTHFULLY.
  // Never invent, never guilt. This line CLAIMS check-ins are stacking
  // up, which is false for someone with none, so SK2 (Cat's ruling, 24
  // July) dropped the second variant rather than write a line about
  // nothing: the journal renders NO LINE AT ALL under the ghost cards
  // for a person with zero check-ins. Silence is honest; the case is
  // rare. Do not reintroduce a no-check-ins variant.
  journalReflectionsOffLine:
    'Your check-ins are stacking up. The lines that go with them would live here.',
  // The map may cite real check-in patterns because check-ins still flow
  // — that is exactly what makes this honest rather than a tease. SK2:
  // deliberately second person and deliberately echoing blueprintFooter
  // ("built only from your own check-ins") and blueprintGrowsText ("your
  // map gets a lot richer"). The private map says "we" nowhere else —
  // blueprintTitle, blueprintSubline, blueprintFooter and
  // blueprintGrowsText are all second person or make the patterns the
  // subject — so do not "improve" this back into a we-sentence.
  blueprintReflectionsOffLine:
    'This map is built from your check-ins. Reflections would make it a lot richer.',
  // Ask Rally's honest quiet line, in Rally's own first-person voice
  // (it replaces askRallyGreetingP2, which pitches reflections). SK2:
  // Cat's own wording, shortened to state the fact and the way back and
  // stop there.
  askRallyGreetingP2ReflectionsOff:
    'Reflections are off right now, turn them back on anytime in settings.',

  // THE FIRST-RALLY CEREMONY (PA2, 27 July). It is PERSONAL now: it fires
  // on the member's OWN 21st practice (PA1's count), it celebrates what
  // THEY did, and nothing they tap here decides anything for anyone else.
  //
  // COPY PROVENANCE, so nobody re-litigates it: these are Cat's verbatim
  // rulings from RF1 job 3 (22-23 July), which PA2 inherits — the trigger
  // changed, the wording did not. Where a ruled string made a claim that
  // the personal model turns FALSE, the false clause is DELETED rather
  // than rewritten, because inventing Cat's voice is worse than saying
  // less (the same call SK2 made when it dropped the journal's zero-state
  // line instead of shipping a false one).
  //
  // CY1 (28 July) — CAT HAS NOW RULED EVERY ONE OF THEM, from the live
  // screens at 390px. Nothing in this block is PROPOSED any more; the
  // markers are gone because there is no longer an open question behind
  // them. Each ruling is recorded beside the string it governs.
  journeyGateTitle: '21 days, your first rally!',
  // CAT'S 3b BODY, MINUS ITS FIRST CLAUSE — RULED 28 July (CY1): the
  // deletion STANDS and there is NO replacement opener. Her words: "keep
  // it honest". She ruled it having seen the shipped-vs-ruled diff.
  //
  // The cut clause was "You showed up for each other for three weeks."
  // It is false twice over under the personal model — the rally is one
  // person's, not "for each other", and 21 practices span any stretch of
  // calendar (in the live cohort, about eight weeks for Cathy S). Saying
  // less beats inventing a replacement in her voice. The other two
  // clauses were already personal ("yours") and are untouched.
  //
  // Do not restore the clause, and do not write a new opener.
  journeyGateBody: "A strong first rally, and the momentum's yours now. Keep it going.",
  journeyGateRallyOnCta: 'rally on, next stop 50',
  journeyGateRallyOnHelper: 'same circle, same practice. nothing resets.',
  // 3e — the gate's own opener, at secondaryButton prominence. PA2 gives
  // it a NEW MEANING that finally matches its words: it finishes YOUR
  // rally (memberships.finished_at), it is not the creator archiving the
  // circle for everyone. So it is no longer host-gated, which resolves
  // 3e's open HOST GATING question in the direction the personal model
  // forces. The circle keeps running; you have simply finished here.
  journeyGateCompleteOpener: 'finish here',
  journeyGateCompleteCta: 'complete this circle',
  // 3d — "Today" keeps its capital: it names the tab.
  journeyGateNotNow: 'decide later, back to Today',
  // DELETED 28 July (CY1), on Cat's explicit authorisation: journeyGate-
  // CompleteHelper, journeyGateCardTitle and journeyGateCardBody had no
  // call site left anywhere in the app — PA2 removed the surfaces that
  // rendered them (the circle-level gate card, and the standing archive
  // explanation that moved into the revealed confirm card). They were not
  // junk: the two card strings carried Cat's 27 July casing rulings. But a
  // ruled string with no surface is a trap — the next section to need a
  // gate card would have found copy that says "your host can complete it"
  // and a circle-level "{circle} hit 21 days", both of which the personal
  // model made false. Deleted rather than left to be picked up.

  // PA2 — FINISHING YOUR OWN RALLY. PA2 authored these outright, because
  // the personal finish did not exist when Cat ruled RF1 job 3 (whose 3k
  // outcome described the creator ARCHIVING a circle — "what you built
  // together is archived, not lost" — which is false here, since the
  // circle carries on without you).
  //
  // ACCEPTED 28 July (CY1): Cat read all of them on the live screens and
  // accepted them as written, with the single exception recorded on
  // journeyFinishedBody below. They are hers now, not drafts.
  journeyFinishConfirmTitle: 'finish your rally here?',
  journeyFinishConfirmBody:
    'The circle keeps going, and so does everything you did in it. You can pick your rally back up whenever you want.',
  journeyFinishConfirmCta: 'finish my rally',
  // 3k, translated from circle-archive to personal-finish. Title is
  // Cat's verbatim; the rest she accepted on 28 July (CY1).
  journeyFinishedTitle: 'your first rally, complete',
  journeyFinishedSubline: (circleName: string, practices: number) =>
    `${circleName} · ${practices} practices`,
  // REWORDED 28 July (CY1) — Cat's one change to this group. It ended
  // "...and the circle carries on without missing you", which was written
  // to mean "nothing breaks" and can land as "you won't be missed". She
  // ruled: drop the clause. Nothing replaces it, same call as 3b above.
  // Do not add a reassurance back on the end of this sentence.
  journeyFinishedBody:
    'Great work on your first rally. Nothing you did is going anywhere, and the circle carries on.',
  journeyFinishedResumeCta: 'pick it back up',
  // DELETED 28 July (CY1), on Cat's explicit authorisation: journeyFinished-
  // ExitCta ("I'll choose later") had no call site — the finished screen
  // has ONE exit (journeyCompletedCta, "back to today"), so a second,
  // softer way out was copy for a choice the screen does not offer.
  // The settled state a finished member wears in the huddle (memo §10 Q1
  // — visible, never vanished). Accepted 28 July (CY1).
  journeyFinishedMemberBadge: 'rally complete',
  journeyFinishedCardTitle: 'your rally here is complete',
  journeyFinishedCardBody: (practices: number) =>
    `${practices} practices, and the circle is still here whenever you want it.`,

  // PA2 — OUTCOME A, after "rally on, next stop 50". Cat LOCKED the title
  // and the button (3j). The body is her 3c helper in sentence case: her
  // ruled 3j body ended "Day 22 starts tomorrow", which the personal
  // model makes false — your 22nd practice starts when you do it, not
  // tomorrow. Cat accepted that recombination on 28 July (CY1), from the
  // live screen.
  //
  // THE 50 IN THE STRIP BESIDE THIS IS INK, AND STAYS INK — see the
  // ruling recorded on MilestoneStrip in components/CircleFormFields.tsx.
  journeyNextStopTitle: 'next stop, 50',
  journeyNextStopBody: 'Same circle, same practice. Nothing resets.',
  journeyNextStopCta: "let's go",
  // Shared by journey-gate.tsx and celebration.tsx — both resolve a circle
  // by id from route params and show this if it's missing/inaccessible.
  circleNotFound: "couldn't find that circle",

  // DELETED 28 July (CY1), on Cat's explicit authorisation: journeyRallied-
  // OnCard ("{circle} rallied on 🔥") had no call site — it announced a
  // CIRCLE-level decision, which PA2 removed when rallying on stopped
  // being something one member could spend on everyone's behalf.
  journeyRallyMarkerTitle: (rallyNum: number) => `rally ${rallyNum} complete`,
  journeyRallyMarkerBody: (circleName: string, day: number) => `day ${day} with ${circleName}`,
  journeyMajorStopTitle: (day: number) => `${day} days together`,
  journeyMajorStopBody: (circleName: string) => `${circleName} made it — still climbing.`,

  journeyCompletedBadge: 'completed',
  // HY1 job 8 (Cat RULED YES, 4 Aug late night) — the circle picker's
  // per-row mark for YOU. Two states, because a mark that only ever
  // appears when you are done leaves "no mark" meaning both "not yet"
  // and "still loading", and the whole point of the row is telling those
  // apart at a glance. Same three words the member badge already speaks
  // in glyphs (✓ done, 🧡 covered, nothing pending) — this just says
  // them where you can read them without hunting for your own avatar,
  // which on a full circle may be inside the "+N" overflow.
  // PROPOSED — Cat's wording wins, as with every other line here.
  circlePickerYouDoneBadge: "you're in",
  circlePickerYouCoveredBadge: 'held for you',
  circlePickerYouPendingBadge: 'not yet',
  journeyCompletedTitle: (circleName: string) => `${circleName}, complete`,
  // B3 step 3 — when the completing circle was born from a blueprint want,
  // the archive banner names it; the review beat, nothing more.
  journeyCompletedWantTitle: (wantPhrase: string) => `21 days toward ${wantPhrase}`,
  journeyCompletedBody: 'This circle is now a warm piece of your history — read-only, always yours.',
  journeyCompletedCta: 'back to today',
  journeyCompleteHostControlLabel: 'complete this circle',
  journeyCompleteHostControlHelper: 'archives it warmly for everyone — this can be undone only by us, so take a moment first.',
  journeyCompleteConfirmTitle: (circleName: string) => `complete ${circleName}?`,
  journeyCompleteConfirmBody: "Everyone keeps their history. The circle becomes read-only — a finished thing, not a lost one.",

  // The personal glow (Rally21-Glow-Spec.md §1-2, §6).
  glowGlowingLabel: (n: number) => `${n} day${n === 1 ? '' : 's'} glowing`,
  // RULED 27 July: stays LOWERCASE. It is a full sentence by form but a
  // badge LABEL by function (GlowBadge's label slot, sharing it with
  // glowGlowingLabel), and the casing law splits by function.
  glowEmbersLabel: 'your glow is down to embers — one small thing today rekindles it.',
  glowHeldTodayNote: (name: string) => `${name} kept your glow warm today 🧡`,
  glowDetailTitle: 'your glow',
  // PROPOSED, PA3 — rewritten because the old body described a mechanic
  // that no longer runs, and §9 forbids a string that misstates how a
  // person's own number behaves. What it used to say ("miss a day
  // uncovered and it dims to embers for 48 hours") is now false in the
  // ordinary case: a missed day is held by a pebble and the flame stays
  // lit. Embers survives only for an empty nest, so it is deliberately
  // not promised here as the normal path.
  glowDetailBody:
    "Your glow is the run of days you've shown up — anywhere, for anyone. Miss a day and a pebble from your nest holds your place, up to five days at a time. Your nest starts with three and fills up again on its own, and friends can send you one of theirs.",
  glowDetailCta: 'got it',

  // ── PA3 · pebbles (memo §5.2, §5.3) ──────────────────────────────
  // EVERY STRING IN THIS BLOCK IS **PROPOSED** — Cat owns the words. The
  // law owns the case (LC2's precedent): these are badge labels and
  // moment lines by function, so they are lowercase, and a lawful result
  // that grates is evidence the WORD is wrong, not the law.
  //
  // THE HONESTY GUARDRAIL (§9) applies to every line here: a pebble
  // protects the GLOW, which counts continuity, and it must never read as
  // a count of practices done. Nothing below states a practice count —
  // the nest is a stock, "held your place" is a statement about the run,
  // and the rally number these must never impersonate lives in its own
  // strings and is untouched by pebbles.
  //
  // THE MARKER is 🪨 — the pebble sitting where the practice would have
  // been (memo §5.3). Deliberately NOT 🧡: the heart is a friend covering
  // you, warmth between people, and a pebble from your own nest is your
  // own reserve. Deliberately not a snowflake either — "freezing" is a
  // cold word for a warm act and would drag cold blue into a warm palette
  // (memo §5).
  pebbleMark: '🪨',
  pebbleNestLabel: (n: number) => `${n} pebble${n === 1 ? '' : 's'} in your nest`,
  pebbleNestFull: 'your nest is full',
  pebbleNestEmpty: 'your nest is empty',
  /** The flame's held-today note, the pebble twin of glowHeldTodayNote. */
  glowHeldTodayPebbleNote: 'a pebble from your nest held your place today 🪨',
  /** Job 2's warm telling-afterwards, reusing TN1's own sentence — the
   * memo names this line explicitly ("a pebble held your place, it's
   * still here, which is the sentence TN1 is already writing"). */
  todaySpotPebbleHeldLine: 'a pebble held your place 🪨',
  // RETIRED by AU1 job 3c (3 Aug) — the spot composes per PERSON now, so
  // a pebble is a gift FRAGMENT (todaySpotGiftPebble) that joins whatever
  // else that friend sent. The sentence it used to produce survives
  // byte-for-byte for a friend who sent only a pebble:
  // todaySpotSentLine(name, todaySpotGiftPebble) === this string.
  // Kept here as the reference the notificationSpot test asserts against.
  todaySpotPebbleGiftLine: (senderName: string) => `${senderName} sent you a pebble 🪨`,
  // Same, for the two warmth kinds. All three exist ONLY as the
  // no-drift reference for that test now — nothing renders them.
  todaySpotWaveLine: (senderName: string) => `${senderName} sent you a wave 👋`,
  todaySpotHeartLine: (senderName: string) => `${senderName} sent you a heart 🧡`,
  /** Job 3's give-a-pebble surface, alongside cover and wave. */
  pebbleActionLabel: 'send a pebble',
  pebbleCta: (name: string) => `send ${name} a pebble`,
  pebbleNotePreview: (senderName: string) => `${senderName} sent you a pebble for your nest 🪨`,
  pebbleEmptyNestError: "your nest is empty right now — it fills up again on its own",
  pebbleAlreadySentError: (name: string) => `you already sent ${name} a pebble today`,
  pebbleNotDeliveredError: "that didn't send — try again in a moment",
  /** The run that ended keeps its record (memo §5.1). Never a scold: the
   * loss is made structural rather than emotional, and the number that
   * survives is the point of the sentence. */
  glowLongestRallyKept: (n: number) => `your longest rally: ${n} day${n === 1 ? '' : 's'}, kept`,

  // The glow moment — G5, Duolingo-style post-check-in beat (7 July).
  // Only shown on the check-in that earns the day (never a milestone
  // day, never a second circle, never an edit).
  glowBeatRekindledLine: 'the fire came back — that counts double',
  glowBeatContinueCta: 'keep it glowing',

  // Friend streaks (Rally21-Glow-Spec.md §3, Personal-Arc memo §5.1) —
  // shown near who's-here, only the single best friendship, N >= 3.
  // Never a list: see lib/pairStreaks.ts for why that is a law.
  //
  // PA4 — the headline is the CUMULATIVE number and carries no flame:
  // the 🔥 is the live run's mark, and putting it on a number that
  // survives a broken run would claim a fire that may not be lit.
  // RULED 28 July (CY1), from the live circle screen at 390px, on two
  // points Cat was asked to separate:
  //   WORD — "days", not the memo's "mornings". A practice is not
  //   necessarily a morning; this one string renders for every circle
  //   whatever its time_of_day, and "days" is also what
  //   shareCardWrappedKicker and journeyMajorStopTitle already say.
  //   PUNCTUATION — the colon PA4 shipped becomes a COMMA, which is the
  //   memo's own shape and Cat's standing preference.
  // No emoji here, deliberately (see the flame rule below).
  pairDaysTogetherLabel: (name: string, n: number) => `you and ${name}, ${n} days together`,
  /** The small live flourish beside the headline, only when the run is
   * genuinely running (>= 2). Never rendered as a zero.
   *
   * THE ONLY 🔥 IN THE PAIR FAMILY, and that is the law working rather
   * than an exception: the flame marks the LIVE RUN, so it can never sit
   * on a cumulative number that survives a broken run (CY1, 28 July). */
  pairRunFlourish: (n: number) => `${n} in a row 🔥`,
  /** Digest only — the shared milestones, on the CUMULATIVE number. A
   * digest line, never its own send (Glow-Spec §3).
   *
   * REFERENCE COPY. The sentence that actually goes out is composed
   * SERVER-side in supabase/functions/compose-digest/index.ts (S1 — a
   * definer function never accepts client-composed content destined for
   * another user's surface), so these two must be kept in step BY HAND,
   * exactly as wallRallyMilestoneLine is.
   *
   * RULED 28 July (CY1). Cat set the ladder to [21, 50, 75, 100] and
   * ruled 🎉 across ALL of it, replacing PA4's 🔥 — the flame belongs to
   * the live run alone, and with 🎉 here there is no cumulative number
   * anywhere carrying a fire that may not be lit. She explicitly ruled
   * that NO law exception needs noting, because none is being made.
   *
   * The 21 rung gets its own sentence: 21 days together IS the first
   * rally, the same meaning the personal ladder's 21 carries, and the
   * copy says so. KNOWN AND ACCEPTED by Cat, not a bug: a perfectly
   * daily pair can fire their personal 21 and their pair 21 on one day. */
  pairMilestoneDigestLine: (name: string, n: number) =>
    n === 21
      ? `you and ${name}, 21 days together. your first rally together 🎉`
      : `you and ${name}, ${n} days together 🎉`,

  // PA4 JOB 3 (memo §6) — the rally milestone's wall line. REFERENCE
  // COPY: the live sentence is composed SERVER-side inside
  // mark_celebration_seen (S1 — a definer function never accepts
  // client-composed content destined for another user's surface), and
  // these two must be kept in step with that migration by hand, exactly
  // as glowSocialWallLine is with GS1's.
  wallRallyMilestoneLine: (name: string, n: number) =>
    `${name} has rallied ${n} practices 🎉`,
  /** JOB 4 — synchronised rallies. Named only when the co-starters have
   * ALSO reached this milestone: naming someone who is behind would
   * publish a comparison between two members' counts, which is the
   * leaderboard §5 forbids arriving by the back door. */
  wallRallyMilestoneTogetherLine: (names: string, n: number, startedOn: string) =>
    `${names} have each rallied ${n} practices 🎉 — they started the same day, ${startedOn}`,

  // Blueprint v0 (Rally21-Blueprint-Notes.md) — deterministic pattern
  // cards, day-14 observation's visual grammar. Renamed "your blueprint"
  // → "your private map" (Cat's call, 7 July, N1) — user-facing copy
  // only, every internal name (tables, RPCs, this file's own keys)
  // stays "blueprint".
  blueprintTitle: 'your private map',
  blueprintSubline: "patterns you can't see alone",
  blueprintFooter: 'built only from your own check-ins.',
  blueprintEmptyText: 'your patterns need a little more time to show themselves',
  // OD1 job 19c — same N1 leftover as checkin-intro's title: "picture"
  // meaning the private map, on the day-14 observation card's grow state.
  blueprintGrowsText: 'This grows as you go. In a month, your map gets a lot richer.',
  // ── MN2 (30 July): "how you work", the self-manual ───────────────────
  // Name chosen by Cat in session over "your manual" and "your field
  // notes" — it takes the memo's operating-systems framing (§5.3) without
  // sounding mechanical. The two LANE LABELS are fixed by the memo (§3)
  // and MN3 is specced to match them, so they are not free copy: "in your
  // words" is what the person declared, "what we've seen" is observed
  // behaviour, and the memo's law is that they are never merged.
  //
  // Register note, deliberate: SK2 left a standing instruction that the
  // private map says "we" nowhere else and must not be "improved" back
  // into a we-sentence. That instruction is scoped to
  // blueprintReflectionsOffLine. "what we've seen" is a LANE LABEL fixed
  // by the memo and named again in MN3, so it stays — but every other
  // line on this screen keeps the map's second-person voice.
  manualTitle: 'how you work',
  manualSubline: "built from what you've told us, and what we've seen",
  // The way in, on the private map.
  manualLinkLabel: 'how you work',
  manualSectionLabels: {
    'energy-recovery': 'energy and recovery',
    connection: 'how you connect',
    'overwhelm-restore': 'when things get heavy',
    misread: 'what people misread',
  } as Record<string, string>,
  manualLaneDeclared: 'in your words',
  manualLaneObserved: "what we've seen",
  manualEarlierExpander: (count: number) =>
    count === 1 ? 'one earlier answer' : `${count} earlier answers`,
  manualEarlierCollapse: 'hide earlier answers',
  // JOB 2 — the honest empty state, and for the beta's first month this is
  // the REAL screen, not an edge case: of the 13 cold-start-arc days only
  // day 10 asks a declaration question, so a tester reaches day 14 with one
  // entry at most. Two lines, and neither promises an insight — they
  // describe the mechanism and stop, which is the private map's law.
  manualEmptyTitle: 'nothing here yet',
  manualEmptyText:
    'This page builds itself from your daily question, one answer at a time.',
  // SK1's no-nag law: state the fact, offer the door, never pitch. The
  // toggle row below it is the way back, same as the journal and the map.
  manualReflectionsOffLine:
    'This page fills in from your daily question, which is off right now.',
  // JOB 3 — the one exit. No share surface exists on this screen by
  // ruling 2; a download is the only way anything leaves.
  manualExportCta: 'download a copy',
  manualExportFooter: '— exported from Rally21',
  manualExportCopiedNotice: 'copied — paste it wherever you like',
  // JOB 4 — the quiet affordance on the check-in question card. Cat's
  // wording, from her own workbook column header.
  whyWeAskLabel: 'why we ask this',

  // MN3 — the contrast card. Cat approved VARIANT A in session, 31 July,
  // and rejected variant C firmly: its framing line ("you said one thing,
  // and we saw another") was "the one sentence that makes a claim rather
  // than showing two facts, exactly what the tone review exists to keep
  // out." So the card has NO framing line — a label, two labelled blocks,
  // and the evidence behind an expander. The person draws the conclusion,
  // or doesn't.
  //
  // The two lane labels are NOT redeclared here: they are MN2's
  // manualLaneDeclared / manualLaneObserved, reused verbatim, because the
  // memo's §3 lanes must read identically wherever they appear.
  contrastCardLabel: 'WORTH A LOOK',
  contrastEvidenceExpander: 'what this is built from',
  contrastEvidenceCollapse: 'hide',
  // The provenance line under the evidence, same promise the private map's
  // footer already makes: this came from your own check-ins and nothing else.
  contrastEvidenceSource: 'from your own check-ins, nothing else.',

  blueprintPatternLabel: 'A GENTLE PATTERN',
  blueprintSoundsRight: 'sounds right',
  blueprintNotQuite: 'not quite',
  blueprintNotePlaceholder: 'what was it really? (optional)',
  blueprintNoteSubmit: 'save',
  blueprintNoteSkip: 'skip',
  blueprintConfirmedText: '✓ you said this sounds right',
  blueprintSeeYourBlueprint: 'see your private map →',
  somethingWeNoticedLinkLabel: 'something we noticed',
  // HC1 — the day-14 observation screen's own copy, typed inline in
  // reflection.tsx until now. Its two response chips are the same pair the
  // private map already read from blueprintSoundsRight/blueprintNotQuite,
  // which is why the two screens disagreed on casing. Prose keeps sentence
  // case; the chips take the map's lowercase.
  observationSubtitle: 'Based on your check-ins so far ✨',
  observationBasis: (agreed: number, total: number) =>
    `Based on ${agreed} of your last ${total} check-ins.`,
  observationRejectedText: 'noted — thanks for the correction',
  observationFooter: 'Built only from your check-ins.',
  observationFooterSecondLine: 'You can correct or delete anything.',

  // Blueprint v2 (B3, Rally21-Blueprint-Notes.md wants layer) — traits,
  // the evolution view, and the wants act flow.
  blueprintTraitsLabel: 'what I’m noticing about you',
  blueprintEvolutionLabel: 'how your private map’s grown',
  blueprintWantLabel: 'WHAT YOU’RE REACHING FOR',
  blueprintWantActCta: 'make this your next 21 days',
  blueprintWantNowPractice: 'now your practice — find it with your circles',
  blueprintWantBecame: (circleName: string) =>
    circleName ? `became "${circleName}"` : 'became a practice',

  // Ask Rally, part 1 (A1, Rally21-Ask-Rally-Spec.md) — entry points.
  askRallyLinkLabel: 'ask Rally',
  askRallyAboutThis: 'ask Rally about this',
  askRallyStartFresh: 'start fresh',
  askRallyDelete: 'delete',
  askRallyComposerPlaceholder: 'ask Rally anything…',
  askRallySendCta: 'send',
  // AR1 (21 July) — failure copy, warmth law: warm words only, never a
  // status code or a raw error message at a user.
  askRallyUnavailable: "Rally couldn't answer just now — try again in a moment",
  askRallyLoadFailed: 'could not load your conversation — try again in a moment',
  askRallyDeleteFailed: 'could not delete that — try again',
  // OD1 job 11a (26 July) — the inline confirm on the conversation
  // delete, which until now fired on one tap. It says what is actually
  // lost and that nothing brings it back, because that is the whole
  // reason this action earns friction and 'start fresh' (which destroys
  // nothing) does not. The confirm CTA reuses askRallyDelete above.
  // RULED 27 July under the quoted-label sub-rule (see the law at the top):
  // prose, but sentence two opens on "start fresh", which is
  // askRallyStartFresh's own lowercase label. The label's casing wins.
  askRallyDeleteConfirm:
    'this deletes the whole conversation for good — nothing brings it back. start fresh just opens a new one and keeps this.',
  askRallyDeleteCancelCta: 'cancel',

  // EX1 (22 July) — "export chat": shares the on-screen conversation only,
  // via the OS share sheet (Cat's ruling — plain text, this conversation
  // only). Turn labels + footer are the exact transcript format Cat
  // specified: "you:" / "Rally:" (Rally keeps its capital, the LC1
  // exception), a blank line between turns, closed with a quiet footer —
  // no markdown, no JSON, no timestamps. lib/exportChat.ts is the one
  // place that assembles them.
  askRallyExportChat: 'export chat',
  askRallyExportYouLabel: 'you',
  askRallyExportRallyLabel: 'Rally',
  askRallyExportFooter: '— exported from Rally21',
  // Shown only on the copy-to-clipboard fallback (Web Share unavailable,
  // or a genuine native share-sheet failure) — the OS share sheet itself
  // is its own confirmation, so this never doubles up on native's happy
  // path.
  askRallyExportCopiedNotice: 'copied — paste it wherever you like',

  // PM1 (15 July) — the private map's starter-chip invitation into Ask
  // Rally. A chip is the user's own question: it lands in the composer
  // as plain text (the `prefill` param — never the pattern cards'
  // About-this context wrapper) and is never sent on their behalf.
  // PM1B (21 July) — rev 2 chip set, Cat-approved verbatim (including
  // lowercase style and "of myself"). Order matters: slot 2 is the one
  // the missed-day recovery chip displaces (lib/starterChips.ts).
  blueprintAskLabel: 'ASK RALLY',
  blueprintAskLead: 'wonder what all this means?',
  blueprintAskLeadEmpty: 'while your patterns form, Rally’s here to talk',
  blueprintAskChips: [
    'what are you noticing about me?',
    "what's getting in my way lately?",
    'am I expecting too much of myself?',
    "I want to talk about how I'm feeling",
  ],
  // PM1B — the missed-day recovery chip: swaps into slot 2 only on a
  // genuinely missed-yesterday day (never for a checked-in or covered
  // yesterday, never for a user with no yesterday to miss). The one
  // failure mode this cannot have is a false "you lapsed" signal.
  askRallyRecoveryChip: 'how do I get back on track?',

  // PM1C — the personal chip's transparency label and its template
  // table: one fixed phrasing per deterministic pattern type (lowercase
  // style, first-person, always a question), filled only from the
  // blueprint's own structured fields — never free-composed from raw
  // data, never another person's name, never a mood number. Synthesis
  // patterns have no entry here on purpose: their statements are
  // model-written prose, so a template can't ask about them without
  // free-composing.
  personalChipLabel: 'from your check-ins',
  personalChipWeekdayLow: (weekdayPlural: string) => `why do ${weekdayPlural} run me down?`,
  personalChipWeekdayHigh: (weekdayPlural: string) => `why do ${weekdayPlural} lift me up?`,
  personalChipBeforeNoon: 'why am I brighter before noon?',
  personalChipAfterNoon: 'why am I brighter later in the day?',
  personalChipConsistency: (hourLabel: string) => `why does checking in before ${hourLabel} work for me?`,

  // AR5 (5 Aug) — the cold-start set, shown BELOW PM1C's evidence floors
  // where the two retrieval chips ("what are you noticing about me?",
  // "what's getting in my way lately?") ask a question of a file the
  // honesty law correctly reports empty. The shrug that came back was
  // the law working; the defect was the promise, and each shrug cost one
  // of the day's five messages. This chip is episode-anchored rather
  // than state-anchored (the Day Reconstruction Method's move: a
  // concrete today beats a general how-are-you), and it works on day
  // one because the person, not the file, holds the answer. Cat's nod,
  // 5 Aug.
  askRallyTodayChip: "here's what today was like",
  // The obstacle chip's template table, keyed by the STORED
  // users.keep_going_obstacle value — ON2's five fixed options, restated
  // first-person under one uniform tail. Template-only, exactly as the
  // personal chip above: the key IS the answer this person tapped at
  // Day 0, so nothing here is paraphrased, inferred, or free-composed,
  // and an absent or unrecognised key renders NO chip rather than a
  // guess (PM1C's creepy-inference law, same failure mode). Second
  // person elsewhere (onboardingObstacleReflected) because there Rally
  // speaks; here the CHIP is the person's own question, so it is first
  // person — the two tables are deliberately not shared.
  askRallyObstacleChips: {
    forget: "I forget — let's talk about it",
    no_time: "there's never time — let's talk about it",
    lose_motivation: "my motivation fades — let's talk about it",
    miss_once: "one miss usually ends it — let's talk about it",
    alone: "doing it alone is hard — let's talk about it",
  } as Record<string, string>,

  // PM1B — the Ask Rally screen itself (REV 4, Cat's final layout).
  // Title: lowercase per the casing law, but Rally is a NAME and keeps
  // its capital (Cat's ruling, 21 July — LC1 carries the same exception
  // app-wide).
  askRallyScreenTitle: 'ask Rally',
  // The context line's two tap targets: "🔒 private" (green,
  // safety-assurance — a conscious small use of green, noted for CH5's
  // conventions sweep) opens /privacy; "using {N} reflections ›" (plum,
  // the what-Rally-draws-from surface) opens the private map. Below
  // N < 3 the private link renders alone, no count.
  // OD1 job 21 (Cat, 23 July): ONE privacy mark, worn identically by all
  // five private surfaces — journal, private map, ask Rally, reflection,
  // checkin-intro. On ask Rally it stays a tap target opening /privacy.
  // (visibilityPrivateTitle is the visibility TOGGLE — different meaning.)
  privateBadge: '🔒 for your eyes only',
  askRallyReflectionsLink: (n: number) => `using ${n} reflections ›`,
  // Rally speaks the greeting — Cat's copy VERBATIM (21 July), two short
  // paragraphs, rendered as Rally's first message-style bubble with the
  // listener penguin beside it.
  askRallyGreetingP1: 'Hi there, feel free to come and chat anytime, about your practice or life in general.',
  askRallyGreetingP2: 'The more you share in your daily reflections, the more personal my insights can be.',
  // The safety line under the composer + the learn-more sheet it opens
  // (REV 3 ruling 5's sheet): the safe-place line and the full
  // companion-not-a-therapist disclaimer, both Cat's original verbatim
  // copy relocated from the old empty-state explainer.
  askRallySafetyLine: 'Rally is a companion, not a therapist.',
  askRallySafetyLearnMore: 'learn more',
  askRallySheetTitle: 'about ask Rally',
  askRallySheetSafePlace:
    'This is a totally safe place, our chats are completely private and never shared.',
  // RULED 27 July: this stays LOWERCASE. It reads as a fragment, so the
  // function split treats it as one — and that is the answer to the clash
  // SK2's audit named, this line sitting beside askRallySheetSafePlace's
  // prose. Different KINDS, so two styles here is correct, not drift.
  askRallySheetScope: 'private to you — nothing here shapes your private map or circle',
  askRallySheetDisclaimer:
    "One thing to be clear about: I'm a companion, not a therapist. If things feel heavy, please talk to someone qualified — and in a crisis, contact emergency services or a crisis line right away.",
  askRallySheetCta: 'okay',

  // PM2 (17 July) — the private map's liked-quotes section. "quotes you
  // love" is Cat's own wording (15 July). The section simply doesn't
  // render with no likes — never an empty-state nag.
  blueprintQuotesLabel: 'quotes you love',
  blueprintQuotesSeeAll: (n: number) => `see all ${n}`,
  blueprintQuotesRemove: 'remove',

  wallComposerPlaceholder: 'message your circle…',
  hostDeleteWallMessageCancel: 'cancel',
  hostDeleteWallMessageLink: 'remove',

  // MOD1 (7 July) — report + block, the safety floor. Quiet, dignified
  // affordances; no drama styling, matching how the app treats
  // destructive actions elsewhere.
  reportLink: 'report',
  reportReasonPlaceholder: 'say what happened (optional)',
  // HC1 released this button set and the block set below with the rest of
  // the family — see the note at hostRemoveMemberCta.
  reportCancelCta: 'cancel',
  reportSubmitCta: 'send report',
  reportedConfirmationTitle: 'thank you',
  reportedConfirmationBody: "We'll take a look. You won't see this again.",
  blockLink: 'block',
  blockConfirmTitle: (name: string) => `block ${name}?`,
  blockConfirmBody: "You won't see their wall messages or reactions anymore, and waves stop both ways. They won't be told.",
  blockConfirmCta: 'block',
  blockCancelCta: 'cancel',
  unblockCta: 'unblock',
  blockedPeopleSectionLabel: 'blocked people',
  // W2 (13 July) — send_friend_nudge returns 'blocked' for BOTH directions
  // of a block (the blocked person waving at their blocker included), so
  // this copy must never assert who blocked whom — the client genuinely
  // can't tell, and a block must never be inferable from what's shown.
  waveNotDeliveredError: "this wave couldn't go through right now",

  // DC1 (7 July) — "your data & privacy" screen (MVP Screens mockup #23):
  // the privacy-promise screen's three promises (see, correct, or delete
  // anytime) made operable.
  yourDataSettingsRow: 'your data & privacy',
  yourDataTitle: 'your data & privacy',
  // YD1 (21 July) — "picture" here was pre-N1 drift; the decided
  // user-facing term is "your private map" (N1; Cat re-confirmed 20
  // July). "photo" is reserved for the profile photo so the two can
  // never read as the same thing on this screen.
  yourDataReassurance:
    'Your reflections are yours. Only you see your private map. Your circle sees only what you choose. We never sell your data.',
  yourDataSectionLabel: 'you can, anytime:',
  yourDataSeeEverything: 'see everything we keep',
  yourDataExport: 'export it all',
  yourDataDeletePhoto: 'delete my photo',
  yourDataDeletePhotoNote: '(keep streaks)',
  yourDataFooterNote: 'Deletions and exports happen right away — nothing is queued or delayed.',

  yourDataSummaryJoined: (date: string) => `joined ${date}`,
  yourDataSummaryCircles: (n: number) => `${n} circle${n === 1 ? '' : 's'}`,
  yourDataSummaryCheckins: (n: number) => `${n} check-in${n === 1 ? '' : 's'} logged`,
  yourDataSummaryReflections: (n: number) => `${n} reflection${n === 1 ? '' : 's'} written`,
  yourDataSummaryPrivateMapBuilt: 'building from your patterns',
  yourDataSummaryPrivateMapEmpty: 'nothing yet — keep checking in',
  yourDataSummaryConversations: (n: number) =>
    n === 0 ? 'no messages yet' : `${n} message${n === 1 ? '' : 's'} with Rally`,
  yourDataSummaryNotificationsOn: 'on',
  yourDataSummaryNotificationsOff: 'off',

  yourDataExportError: 'could not export right now — try again',

  // YD1 (21 July) — the "Delete a single check-in" section is gone (Cat's
  // ruling, 20 July); its strings family went with it. The completions
  // DELETE RLS policy stays — the ruling was about the UI surface, not
  // the schema.

  // PH1 — a failed avatar upload must speak (it shipped silent once: the
  // native path was landing zero-byte objects with a "success"). Shown
  // inline by both saveProfile callers (onboarding profile, settings);
  // the name always still saves.
  profilePhotoUploadFailed:
    "your photo didn't upload, but your name is saved — try again later from settings",

  // The fact, corrected 27 July: this said "your initials will show
  // instead", which AV1 made false on 20 July — there is no initials
  // fallback any more, a photo-less member is always their penguin
  // (components/Avatar.tsx). "your penguin" is the term the app already
  // uses to the same person (photoAskDismiss: 'keep the penguin').
  yourDataDeletePhotoConfirm: "Remove your photo? Your penguin will show instead — nothing else changes.",
  yourDataDeletePhotoConfirmCta: 'remove photo',
  yourDataDeletePhotoCancelCta: 'cancel',
  yourDataDeletePhotoError: 'could not remove that — try again',

  yourDataDangerZoneLabel: 'danger zone',
  yourDataDeleteAccountCta: 'delete my account',
  yourDataDeleteAccountConfirmIntro:
    "This deletes your profile, check-ins, and reflections for good — it can't be undone. Circles you started stay with your circle-mates.",
  yourDataDeleteAccountTypeToConfirmLabel: 'type DELETE to confirm',
  yourDataDeleteAccountConfirmCta: 'delete forever',
  yourDataDeleteAccountCancelCta: 'cancel',
  yourDataDeleteAccountError: 'could not delete your account — try again',

  // Public /privacy route (13 July) — a real policy, not marketing, for
  // the TestFlight/App Store Connect "privacy policy URL" field. Tone
  // matches the privacy-promise screen (plain language, warm, no legalese
  // padding) but every claim here must be checked against the actual
  // code/DB — see the section-by-section audit in the commit that added
  // this file. Signed-out accessible by design; never gate this route.
  privacyPolicyTitle: 'privacy policy',
  privacyPolicyEffectiveDate: 'Last updated 13 July 2026',
  privacyPolicyIntro:
    "Rally21 is a small app for showing up on a practice with a few people who matter to you. This page says plainly what we collect, what your circle can see, who we share anything with, and how to see, correct, or delete your own data — no legal padding, just what's actually true in the code.",
  privacyPolicySections: [
    {
      heading: 'What we collect when you sign up',
      body: 'Your email address (from however you sign in — magic link, Apple, or Google), the name you give us, an optional profile photo, and your device\'s timezone, so nudges land at the right local time. You can optionally add your birthday (month and day; the year is entirely optional and, if you give it, we never display it or calculate your age from it anywhere).',
    },
    {
      heading: 'What you create while using Rally21',
      body: "Your check-ins (that you did your practice on a given day), your reflections (a mood and a couple of short private lines about your day), any messages or reactions you post to a circle's wall, and your notification preferences (when you're nudged, quiet hours, which digests you get). If you use Ask Rally, we keep that conversation so it has continuity; if you build a private map, we keep the patterns it's found.",
    },
    {
      heading: "What your circle-mates can see",
      body: "Circles are the whole point, so some things are shared by design: anyone in a circle with you can see your name, profile photo, and birthday (if you set one), plus whether you checked in on a given day and anything you post to that circle's wall. Your reflections, your Ask Rally conversations, and your private map are never shared — those stay yours alone, always, with no setting that can change that.",
    },
    {
      heading: 'Reporting and blocking',
      body: "You can report a wall message, a member, or a circle, and you can block someone — they're never told you did either. Reports go to us for review; blocking hides that person's posts from you and stops nudges between you both, without changing what your circle can see about attendance.",
    },
    {
      heading: 'Who we share data with',
      body: "We use a handful of processors to actually run the app, and nothing else: Supabase (our database, sign-in, and file storage), Resend (sending the emails you've opted into), Anthropic (only when you use Ask Rally or when your private map is built — your relevant data is sent to generate that reply or summary), Vercel (hosting the web app), and Apple/Expo (building and distributing the iOS app). We don't run ads, and we've never sold, rented, or traded anyone's data — not to advertisers, not to anyone.",
    },
    {
      heading: 'Your profile photo',
      body: "Profile photos are stored in a straightforward file bucket rather than behind a login check, so if you know the exact file address you could view an image directly — it isn't searchable or listed anywhere, but it isn't access-controlled either. Worth knowing if you'd rather not use a real photo.",
    },
    {
      heading: 'Seeing, correcting, or deleting your data',
      body: "Open Settings → Your data & privacy any time you're signed in to: see a plain summary of what we hold, export everything as a file, remove your profile photo, or delete your account entirely (which removes your profile, check-ins, and reflections for good — circles you started stay with whoever's left in them). All of it happens immediately, nothing is queued or reviewed first.",
    },
    {
      heading: 'Questions',
      body: 'Email rally21@amsadvisory.uk and a real person (not a bot) will read it.',
    },
  ],

  // SC1 (13 July) — share cards, phase 1a. Quiet, dignified actions
  // matching the app's established confirm-inline pattern; no drama
  // styling, no frown/emoji-face iconography for "not for me" (spec §3).
  shareCardLikeCta: 'like',
  shareCardShareCta: 'share',
  shareCardNotForMeCta: 'not for me',
  // OD1 Job 8a (22 July) — the card's big, warm, obvious neutral exit: it
  // records 'dismissed' (never 'passed'), actively closing out the
  // practice instead of leaving the person hunting for a ✕. Job 9 gates
  // the card so this only appears once the day is genuinely done, which is
  // what makes "see you tomorrow" true here. PROPOSED, Cat to confirm —
  // final wording is hers, lowercase per her 8a ruling.
  shareCardCloseCta: 'see you tomorrow',
  // SC1C (15 July) removed the on-card Save button and the "Not my kind
  // of thing" flavor-mute entry point (with its confirm dialog), so
  // shareCardSaveCta / shareCardMuteCta / shareCardMuteConfirm* are gone.
  // The flavor-mute pref infra + the settings "muted card flavors" list
  // (labels below) stay — they just have no on-card mute-ON path anymore.
  shareCardMutedFlavorsLabel: 'muted card flavors',
  shareCardFlavorCuratedQuote: 'quote cards',
  shareCardFlavorWarmJourney: 'journey cards',
  shareCardFlavorWrapped: 'day-21 keepsake cards',
  shareCardFlavorDotStrip: 'week-strip cards',
  shareCardReEnableCta: 'turn back on',
  shareCardShareError: 'could not share that — try again',
  // SC2 (18 July) — the two new flavors' screen chrome. The journey
  // card's day header ("12 / DAYS") and the dot strip's kicker are card
  // content; the toggle strings are preview-only chrome (never captured)
  // implementing Cat's 17 July §9-Q3 ruling: practice name on the
  // dot-strip card by default, generic one tap away, decided in the
  // preview before anything leaves the app.
  shareCardJourneyDayKicker: (day: number) => (day === 1 ? 'DAY' : 'DAYS'),
  shareCardDotStripKicker: 'THIS WEEK',
  // SC3 — the day-21 mini-Wrapped (spec §4.5). Warmth law: every line
  // celebrates what happened; nothing ever counts what didn't. The held
  // line simply doesn't render at zero.
  shareCardWrappedKicker: (days: number) => `${days} DAYS TOGETHER`,
  wrappedShownUpLine: (n: number) => (n === 1 ? 'showed up 1 day' : `showed up ${n} days`),
  wrappedHeldLine: (n: number) =>
    n === 1 ? 'a friend held your place once' : `a friend held your place ${n} times`,
  // The quiet offer inside the ceremony, after the decision.
  wrappedOfferTitle: 'your 21 days, as a keepsake',
  wrappedOfferBody: 'one card — your dots, your days, and (only if you choose) a line of yours.',
  wrappedOfferCta: 'see your card',
  // The line picker. Never pre-filled, never suggested — the card is
  // complete without a line.
  wrappedPickerTitle: 'add a line of yours? (optional)',
  wrappedPickerHint: 'from your own reflections — only you can put one here.',
  wrappedPickerNone: 'no line — the card is complete without one',
  wrappedShareCta: 'share',
  wrappedDone: 'done',
  shareCardHidePracticeName: 'hide practice name',
  shareCardShowPracticeName: 'show practice name',

  // HC1 (27 July) — the rest of the labels that were typed inline in
  // screens rather than living here. Grouped by screen. Every one is a
  // MOVE plus the casing law applied; not a word of any of them changed.
  // Card TITLES on a tappable card (circle-setup) are labels, not prose,
  // so they take the law's lowercase; the card bodies beneath them are
  // full sentences and keep sentence case exactly as they were.
  celebrationDismissCta: 'nice',
  coverPickPill: 'pick',
  practiceRestoreCta: 'restore',
  practiceEditCta: 'edit',
  practiceArchiveCta: 'archive',
  practiceCreateCta: '+ create a new practice',
  weeklySeeJournalCta: 'see full journal',
  notFoundHomeLink: 'go back home',
  linkCardOpenCta: 'open link →',
  circleCapBackToTodayCta: 'back to today',
  circleCapManageCircleCta: 'manage my circles',
  circleSetupStartCardTitle: 'start or join a circle',
  circleSetupInviteCardTitle: 'use an invite code',
  circleSetupSoloCardTitle: 'go solo',
  inviteShareCta: 'share invite',
  inviteCopyCodeCta: 'copy code only',
  inviteContinueCta: 'continue to my circle',
  joinCircleCta: 'join circle',
  joinCircleFullChip: 'full',
  profileSignOutLink: 'sign out',
  startCircleSetItCta: 'set it',
  reportsDismissCta: 'dismiss',
  reportsDeleteMessageCta: 'delete message',
  reportsRemoveMemberCta: 'remove from circle',
  reportsHideCircleCta: 'hide from browse',
} as const;

// The daily nudge's rotating warm-line pool (Notifications spec §3) — one
// line picked per send, alongside the practice(s) and an open-app button.
// Canonical source for the copy itself; the send-notifications edge
// function (a standalone Deno file with no access to this module graph)
// keeps its own literal copy of this exact array in sync by hand — see
// the comment at its definition there.
// NQ1 (16 July) — the pool grows to 31 warm / 12 restart lines, Cat's
// final spreadsheet-approved copy (../Rally21-Nudge-Copy-Draft.md). The
// compose-nudges edge function keeps a byte-identical copy in its own
// nudge-lines.ts (Deno, no access to this module graph); nudge-lines.test.ts
// pins the two arrays equal so they can never silently drift.
export const NUDGE_WARM_LINES = [
  'just a reminder to check in with your circle.',
  "there's a warm spot for you in the circle — come take it.",
  "small and steady is the point, today's step can be tiny.",
  'keep up and you will be kept up.',
  "a couple of minutes, a couple of lines — that's all for today.",
  'your circle is quietly rooting for you, with no pressure attached.',
  "today's version of you only needs to do today's version of the thing.",
  'messy is most welcome here, showing up is what matters.',
  "it doesn't have to be perfect, it just has to be yours.",
  'the kettle takes longer to boil than this will.',
  "you don't need the perfect moment, this one will do.",
  'your future self is quietly cheering you on.',
  "the huddle's warmer with you in it.",
  "today's ask is small on purpose.",
  'one small yes is enough for today.',
  "penguins don't overthink the huddle. they just waddle in.",
  'a wobbly little effort is still a lovely effort.',
  "the little thing is little, that's the whole idea.",
  "you don't need to feel ready, just a couple of minutes is enough.",
  'the circle keeps a light on for you.',
  'a quiet little win is waiting for you.',
  'it fits in the gap between two scrolls.',
  'a friendly wave from us — your practice is ready when you are.',
  'your spot in the circle is always yours — come fill it today.',
  'little things have a lovely way of adding up.',
  'a couple of minutes can be its own little win.',
  'consider this a wave from across the room.',
  "you'll be glad you did it. you always are.",
  'five minutes from now, this could already be done.',
  "the hardest part is opening the app. you're basically there.",
  'done today beats perfect someday.',
] as const;

// Restart-framed only — never references a miss. Used instead of a warm
// line when yesterday had no completion, so the copy never reads as guilt.
export const NUDGE_RESTART_LINES = [
  'day ones are always welcome, tonight is a fine time to begin again.',
  'any day is a good day to begin again.',
  'no catching up required — just a little something today.',
  "today is a clean page. that's all it needs to be.",
  'a fresh start, zero paperwork.',
  'beginning again is still a beginning.',
  'day one energy is good energy.',
  'no run-up needed, step in whenever you like.',
  "starting again is a skill — and you're already practicing it.",
  'clean page, small pen, plenty of possibility.',
  'a fresh start begins with one small check-in.',
  'today welcomes you just as you are — one small check-in starts it.',
  // FF2 job D1 (Cat's ruling, 28 July) — the 13th restart line, added so
  // the 'forget' obstacle has a line that actually NAMES the mechanic
  // that answers it, instead of borrowing the pool's closest
  // "you haven't lost the thread" line. It claims only what NS1 already
  // does (the nudge lands just before the circle's usual time); no timing
  // maths was touched to add it. PROPOSED wording — Cat may reword.
  'no need to hold it in your head, your nudge comes just before your usual time.',
] as const;

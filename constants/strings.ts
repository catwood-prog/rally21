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
export const STRINGS = {
  // O1 (Google slice, 8/12 July) — sign-in screen, web only.
  signInWithGoogleCta: 'Continue with Google',
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
  signInWithAppleCta: 'Continue with Apple',
  signInAppleShareEmailHint: 'already have Rally? choose share my email so we can find your account',
  signInAppleError: "couldn't sign in with Apple — try again",

  checkinSuccessTitle: (n: number) => `Day ${n} done`,
  checkinSuccessBody: 'You showed up again.',
  checkinSuccessCta: 'Nice',

  // PN1 (13 July) — the earned-moment pre-permission ask, shown once ever
  // on the check-in-success screen before the real iOS system dialog.
  // PN1B (16 July, Cat's exact copy): the primer is one line + one green
  // action — "not now" is gone; continuing without enabling dismisses it.
  pushAskLine: 'Want a little nudge if you forget to check in?',
  pushAskCta: 'Turn on notifications',

  // Glow milestones (Rally21-Glow-Spec.md §4) — a variant of the same
  // check-in success screen, no new assets or badges.
  glowMilestoneTitle: (n: number) => `${n} days glowing 🔥`,
  glowMilestoneBody: "That's a real run. Keep it warm.",

  // Today's per-circle CTA — bold-on-fill only while the day is still
  // open; once checked in, the glow is the reward and editing is a quiet,
  // occasional correction, not the day's main action.
  checkInCta: 'Check in',
  editCheckinCta: 'edit check-in',

  groupHeaderStatus: (n: number, x: number, y: number) => `Day ${n} of 21 · ${x} of ${y} checked in`,
  cardLinkStatus: (x: number, y: number) => `${x} of ${y} in today`,
  groupAllInCelebration: (count: number, circleName: string) => `that's all ${count} of ${circleName} in today 🔥`,

  wallHeaderTitle: (circleName: string) => `the ${circleName} wall`,

  reentryKeptLightOn: (circleName: string) => `${circleName} kept the light on for you`,

  inviteShareMessage: (circleName: string | null, inviteCode: string) =>
    circleName
      ? `Join ${circleName} on Rally21! Sign in at https://rally21.vercel.app and enter code ${inviteCode} to hop in.`
      : `Join my Rally21 circle! Sign in at https://rally21.vercel.app and enter code ${inviteCode} to hop in.`,

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
  emptyGroupCta: 'Join the huddle',

  chatTabLabel: 'Rally',
  // TB1 — the icon-only floating bar's a11y labels (icons only on
  // screen; every tab keeps a spoken name).
  tabTodayLabel: 'Today',
  tabCircleLabel: 'Circle',
  tabJournalLabel: 'Journal',
  tabPrivateMapLabel: 'Private Map',

  voiceDictationDeniedHint: 'you can also dictate with the keyboard mic 🎤',
  voiceMicDiscoveryHint: 'you can speak your answers 🎤 — often easier than typing',
  checkinQuestionInputPlaceholder: 'your answer',
  // Q3 (12 July) — binary questions render their own two options from the
  // DB (e.g. "want to" / "have to"); this pair is only a fallback for a
  // null/malformed options array, never the normal path.
  checkinBinaryFallbackYes: 'Yes',
  checkinBinaryFallbackNo: 'No',

  // T1 (8 July) — timer resilience. The done-state label stays the same
  // whether the sit finished in the foreground or was caught up on
  // return from a backgrounded tab; timerCatchUpNote is the one extra
  // line that appears only for the latter, never a stale countdown or a
  // scolding tone.
  timerDoneLabel: 'nice — you showed up',
  timerCatchUpNote: 'your sit ended while you were away — it still counts',
  timerBackgroundHint: "keep this screen open to hear the chime — we'll keep it awake for you.",

  // BR1 (16 July) — the breathing pacer on the timer screen. The two
  // phase labels crossfade with the circle's swell/settle; the toggle is
  // a quiet text link, remembered per device, on by default.
  pacerBreatheIn: 'breathe in',
  pacerBreatheOut: 'breathe out',
  pacerTurnOff: 'just the timer',
  pacerTurnOn: 'breathe with the timer',

  practiceStepQuestion: 'what will you do each day?',
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
  birthdayWhy: 'so your circle can celebrate you on the day — the year stays private, and you can skip this',
  birthdayMonthSubLabel: 'month',
  birthdayDaySubLabel: 'day',
  birthdayYearSubLabel: 'year (optional)',
  birthdayYearPlaceholder: 'e.g. 1990',
  birthdayDayPlaceholder: 'e.g. 14',
  birthdayPickMonthFirst: 'pick a month too',
  birthdayDayNotInMonth: (monthFull: string, max: number) => `${monthFull} only has ${max} days`,
  birthdayInvalid: "that day isn't in that month — pick another",
  settingsBirthdayLabel: 'your birthday',
  birthdayCelebrateLabel: 'celebrate my birthday',
  birthdayCelebrateHelper:
    'when on, your circles see your birthday and can celebrate you on the day. off means it stays hidden — nothing shows anywhere.',
  birthdaySave: 'Save birthday',
  birthdaySelfLine: (name: string | null) => `happy birthday${name ? `, ${name}` : ''} 🎂`,
  birthdayMemberLine: (name: string) => `it's ${name}'s birthday today 🎂`,
  // GS1 — the glow goes social. The wall line itself is composed
  // SERVER-SIDE in check_glow_milestone (S1's rule: a definer function
  // never accepts client copy); this reference copy documents it and
  // must stay verbatim-identical to the migration. The flame label is
  // the Who's Here ride-along's own a11y text.
  glowSocialWallLine: (name: string, days: number) => `${name} has been glowing ${days} days 🔥`,
  glowFlameA11yLabel: (name: string, days: number) => `${name} has been glowing ${days} days`,
  publicShareDisclosure: 'public circles share their practice to the library, so others can start their own',
  myPracticesSubtitle: 'your practice library — reuse them in new circles. Shared ones can be picked by others.',
  practicePillShared: 'shared',
  practicePillOnlyYou: 'only you',

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
  coverSubtitle: "cover today — it's a gift, not a debt 🧡",
  coverNotePreview: (covererName: string) =>
    `They'll get a warm note: "${covererName} covered you today. No pressure, we've got you."`,
  // W1: shown instead of coverHeadline/coverSubtitle/coverNotePreview
  // when the member has already checked in — "they've been quiet" would
  // be factually wrong, and there's no cover note to preview.
  waveHeadline: (name: string) => `say hi to ${name}`,
  waveSubtitle: 'a wave is always welcome, even after they\'ve shown up',
  waveNotePreview: (waverName: string, name: string) =>
    `${name} will see: "${waverName} waved at ${name} 👋" on the circle wall.`,
  coverActionLabel: '🧡 Cover & send love',
  waveActionLabel: '👋 Just a wave hello',
  coverCta: (name: string) => `Cover ${name} today`,
  waveCta: (name: string) => `Wave hello to ${name}`,
  waveCapReachedError: "you've sent a lot of waves today — give it a little rest and try again tomorrow 🧡",
  waveOptedOutError: (name: string) => `${name} isn't taking waves right now`,
  // HW1 — the heart's warm outcomes, mirroring the wave's patterns
  // above. A gesture never fails socially; every designed rejection
  // maps to warm copy.
  alreadyHeartedError: (name: string) => `someone's already sent ${name} a heart today 🧡`,
  heartCapReachedError: "you've sent a lot of love today — give it a little rest and try again tomorrow 🧡",
  heartOptedOutError: (name: string) => `${name} isn't taking hearts right now`,
  heartNotDeliveredError: "this heart couldn't go through right now",
  // The heart's wall line — composed server-side in send_friend_nudge
  // from this exact template (same S1 F4 pattern as the wave's line);
  // this entry is the copy's source of truth and must stay verbatim in
  // sync with the migration.
  wallHeartEntry: (senderName: string, name: string) => `${senderName} sent ${name} a heart 🧡`,

  coveredNoteToCoveredMember: (covererName: string) =>
    `${covererName} covered you today. No pressure, we've got you.`,
  wallCoveredEntry: (covererName: string, coveredName: string) =>
    `${covererName} covered ${coveredName} today 🧡`,
  // The wave's wall line (was wallWaveEntry) now composes server-side in
  // send_friend_nudge (security spec S1, F4) — the copy is unchanged,
  // just no longer client-composed.

  circleYouCoveredCard: (name: string) => `You covered ${name} today 🧡`,
  circleYouCoveredCardBody: "The signal stays warm for everyone. That's the whole point.",
  circleCoveredYouCard: (covererName: string) => `${covererName} covered you today 🧡`,
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
  quietHoursHelper: 'no emails between these hours, your local time.',
  quietHoursFromLabel: 'from',
  quietHoursUntilLabel: 'until',

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
  alreadyNudgedError: (name: string) => `someone's already waved at ${name} today 🧡`,

  // Open circles — wall permissions + host controls (multi-circle spec,
  // "Open circles" section). Members react until they've earned free-text
  // posting (7 completions in that circle) or unless they're the creator;
  // private circles are unchanged. Warm copy, no shaming (see CLAUDE.md).
  openCircleReactOnlyHint: 'react now, write after 7 check-ins',
  openCircleVoiceUnlockedTitle: '7 days in — your voice is welcome on the wall.',
  joinDisclosure:
    'others here will see your name, photo, and daily check-ins — your reflections stay private.',
  hostRemoveMemberConfirm: (name: string) => `Remove ${name} from this circle?`,
  hostRemoveMemberBody: 'They can rejoin later with the invite code — this just clears a spot for now.',
  hostRemoveMemberCta: 'Remove',
  hostCloseToJoinsLabel: 'closed to new joins',
  hostCloseToJoinsHelperOpen: 'anyone with the code or browsing open circles can join',

  // CF1 — one pluralization for every open-circle count surface:
  // "1 open circle", "N open circles", "no open circles yet". The number
  // itself is the caller-scoped joinable count (one server rule feeds
  // both the tiles and the hub list — see the cf1 migration).
  openCirclesCount: (n: number) =>
    n === 0 ? 'no open circles yet' : n === 1 ? '1 open circle' : `${n} open circles`,
  openCirclesNoneYetStartFirst: 'no open circles yet — start the first one',
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
  editCircleSaveCta: 'Save changes',
  hostEditCircleLabel: 'edit circle',
  hostEditCircleHelper: 'name, time of day, link, or the practice itself',
  manageCircleAffordance: '✎ manage',
  manageCircleA11yLabel: 'manage circle',
  hostDeleteWallMessageConfirm: 'Remove this from the wall?',

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
  introWelcomeSoloLine: 'start alone if you like — the huddle can come later.',
  introWelcomeNext: 'Next',
  introWelcomeSignInLink: 'I already have an account',
  introPrivacyTitleLead: 'your inner life,',
  introPrivacyTitleAccent: 'yours alone',
  introPrivacyBullets: [
    'Only you ever see your reflections. Your circle sees just what you choose.',
    'We never sell your data. No ads, ever.',
    'You can correct or delete anything, anytime.',
  ],
  introPrivacyCta: 'Sounds good',
  introPrivacyReadFullLink: 'Read the full privacy policy',

  // RM1 (13 July) — the reminders ask (mockup screen 6, rev-7): a new
  // sign-up sees this once, in flow, between profile and circle-setup;
  // an existing user with the flag unset sees a compact version of the
  // same copy as a one-time dismissible Today card (components/
  // RemindersAskCard.tsx renders both).
  remindersAskTitleLead: "don't leave your ",
  remindersAskTitleAccent: 'circle',
  remindersAskTitleTrail: ' hanging',
  remindersAskBody: "A gentle nudge when it's time to check in, and when your circle could use you. No noise, no spam.",
  remindersAskCta: 'Turn on reminders',
  remindersAskMaybeLater: 'Maybe later',

  // Today's reflection teaser (D4 design review) — an invitation, never a
  // reminder of something missed. Only shows before today's reflection is
  // written; disappears the moment it is (see CLAUDE.md's color-roles
  // convention — this earns plum as inner-life content).
  reflectionTeaser: (questionPrompt: string) => `tonight: "${questionPrompt}"`,

  // The journey ladder (Rally21-Glow-Spec.md §8) — circles stop ending at
  // day 21. Ceremonies reward, never interrogate: the app never re-asks.
  journeyGateTitle: '21 days together',
  journeyGateBody: 'You showed up for each other for three weeks. What now?',
  journeyGateRallyOnCta: 'rally on — through to 50',
  journeyGateRallyOnHelper: 'keep the same circle climbing — day 22, day 34, and on.',
  journeyGateCompleteCta: 'complete this circle',
  journeyGateCompleteHelper: 'celebrate what you built and archive it warmly.',
  journeyGateWaitingOnHost: "your host can complete the circle whenever they're ready.",
  // NAV1: the gate must never dead-end — deciding later is always allowed
  // (the circle screen carries the same choice as a card).
  journeyGateNotNow: 'not now — back to Today',
  journeyGateCardTitle: (circleName: string) => `${circleName} hit 21 days`,
  journeyGateCardBody: 'rally on, or your host can complete it — whenever feels right.',
  // Shared by journey-gate.tsx and celebration.tsx — both resolve a circle
  // by id from route params and show this if it's missing/inaccessible.
  circleNotFound: "couldn't find that circle",

  journeyRalliedOnCard: (circleName: string) => `${circleName} rallied on 🔥`,
  journeyRallyMarkerTitle: (rallyNum: number) => `rally ${rallyNum} complete`,
  journeyRallyMarkerBody: (circleName: string, day: number) => `day ${day} with ${circleName}`,
  journeyMajorStopTitle: (day: number) => `${day} days together`,
  journeyMajorStopBody: (circleName: string) => `${circleName} made it — still climbing.`,

  journeyCompletedBadge: 'completed',
  journeyCompletedTitle: (circleName: string) => `${circleName}, complete`,
  // B3 step 3 — when the completing circle was born from a blueprint want,
  // the archive banner names it; the review beat, nothing more.
  journeyCompletedWantTitle: (wantPhrase: string) => `21 days toward ${wantPhrase}`,
  journeyCompletedBody: 'This circle is now a warm piece of your history — read-only, always yours.',
  journeyCompletedCta: 'Back to today',
  journeyCompleteHostControlLabel: 'complete this circle',
  journeyCompleteHostControlHelper: 'archives it warmly for everyone — this can be undone only by us, so take a moment first.',
  journeyCompleteConfirmTitle: (circleName: string) => `Complete ${circleName}?`,
  journeyCompleteConfirmBody: "Everyone keeps their history. The circle becomes read-only — a finished thing, not a lost one.",

  // The personal glow (Rally21-Glow-Spec.md §1-2, §6).
  glowGlowingLabel: (n: number) => `${n} day${n === 1 ? '' : 's'} glowing`,
  glowEmbersLabel: 'your glow is down to embers — one small thing today rekindles it.',
  glowHeldTodayNote: (name: string) => `${name} kept your glow warm today 🧡`,
  glowDetailTitle: 'your glow',
  glowDetailBody:
    "your glow is the run of days you've shown up — anywhere, for anyone. a friend can cover you and it holds, up to a few times a month depending how far you've come. miss a day uncovered and it dims to embers for 48 hours — one small thing brings it right back.",
  glowDetailCta: 'Got it',

  // The glow moment — G5, Duolingo-style post-check-in beat (7 July).
  // Only shown on the check-in that earns the day (never a milestone
  // day, never a second circle, never an edit).
  glowBeatRekindledLine: 'the fire came back — that counts double',
  glowBeatContinueCta: 'keep it glowing',

  // Friend streaks (Rally21-Glow-Spec.md §3) — shown near who's-here,
  // only the single best active pair streak, N >= 3.
  pairStreakLabel: (name: string, n: number) => `you and ${name}: ${n} days both in 🔥`,

  // Blueprint v0 (Rally21-Blueprint-Notes.md) — deterministic pattern
  // cards, day-14 observation's visual grammar. Renamed "your blueprint"
  // → "your private map" (Cat's call, 7 July, N1) — user-facing copy
  // only, every internal name (tables, RPCs, this file's own keys)
  // stays "blueprint".
  blueprintTitle: 'your private map',
  blueprintSubline: "patterns you can't see alone",
  blueprintFooter: 'built only from your own check-ins.',
  blueprintEmptyText: 'your patterns need a little more time to show themselves',
  blueprintPatternLabel: 'A GENTLE PATTERN',
  blueprintSoundsRight: 'Sounds right',
  blueprintNotQuite: 'Not quite',
  blueprintNotePlaceholder: 'what was it really? (optional)',
  blueprintNoteSubmit: 'Save',
  blueprintNoteSkip: 'Skip',
  blueprintConfirmedText: '✓ you said this sounds right',
  blueprintSeeYourBlueprint: 'see your private map →',
  blueprintLinkLabel: 'Your private map',
  somethingWeNoticedLinkLabel: 'Something we noticed',

  // Blueprint v2 (B3, Rally21-Blueprint-Notes.md wants layer) — traits,
  // the evolution view, and the wants act flow.
  blueprintTraitsLabel: 'what I’m noticing about you',
  blueprintEvolutionLabel: 'how your private map’s grown',
  blueprintWantLabel: 'WHAT YOU’RE REACHING FOR',
  blueprintWantActCta: 'Make this your next 21 days',
  blueprintWantNowPractice: 'now your practice — find it with your circles',
  blueprintWantBecame: (circleName: string) =>
    circleName ? `became "${circleName}"` : 'became a practice',

  // Ask Rally, part 1 (A1, Rally21-Ask-Rally-Spec.md) — entry points.
  askRallyLinkLabel: 'Ask Rally',
  askRallyAboutThis: 'ask Rally about this',
  askRallyStartFresh: 'start fresh',
  askRallyDelete: 'delete',
  askRallyComposerPlaceholder: 'ask Rally anything…',
  askRallySendCta: 'Send',
  // AR1 (21 July) — failure copy, warmth law: warm words only, never a
  // status code or a raw error message at a user.
  askRallyUnavailable: "Rally couldn't answer just now — try again in a moment",
  askRallyLoadFailed: 'could not load your conversation — try again in a moment',
  askRallyDeleteFailed: 'could not delete that — try again',

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
  askRallyPrivateLink: '🔒 private',
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
  askRallySheetTitle: 'about Ask Rally',
  askRallySheetSafePlace:
    'This is a totally safe place, our chats are completely private and never shared.',
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

  wallComposerPlaceholder: 'Message your circle…',
  hostDeleteWallMessageCancel: 'Cancel',
  hostDeleteWallMessageLink: 'remove',

  // MOD1 (7 July) — report + block, the safety floor. Quiet, dignified
  // affordances; no drama styling, matching how the app treats
  // destructive actions elsewhere.
  reportLink: 'report',
  reportReasonPlaceholder: 'say what happened (optional)',
  reportCancelCta: 'Cancel',
  reportSubmitCta: 'Send report',
  reportedConfirmationTitle: 'thank you',
  reportedConfirmationBody: "we'll take a look. you won't see this again.",
  blockLink: 'block',
  blockConfirmTitle: (name: string) => `block ${name}?`,
  blockConfirmBody: "you won't see their wall messages or reactions anymore, and waves stop both ways. they won't be told.",
  blockConfirmCta: 'Block',
  blockCancelCta: 'Cancel',
  unblockCta: 'Unblock',
  blockedPeopleSectionLabel: 'blocked people',
  blockedPeopleEmpty: "you haven't blocked anyone",
  // W2 (13 July) — send_friend_nudge returns 'blocked' for BOTH directions
  // of a block (the blocked person waving at their blocker included), so
  // this copy must never assert who blocked whom — the client genuinely
  // can't tell, and a block must never be inferable from what's shown.
  waveNotDeliveredError: "this wave couldn't go through right now",

  // DC1 (7 July) — "your data & privacy" screen (MVP Screens mockup #23):
  // the privacy-promise screen's three promises (see, correct, or delete
  // anytime) made operable.
  yourDataSettingsRow: 'Your data & privacy',
  yourDataTitle: 'Your data & privacy',
  yourDataReassurance:
    'Your reflections are yours. Only you see your picture. Your circle sees only what you choose. We never sell your data.',
  yourDataSectionLabel: 'You can, anytime:',
  yourDataSeeEverything: 'See everything we keep',
  yourDataExport: 'Export it all',
  yourDataDeleteCheckin: 'Delete a single check-in',
  yourDataDeletePicture: 'Delete my picture',
  yourDataDeletePictureNote: '(keep streaks)',
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

  yourDataExportPreparing: 'preparing your export…',
  yourDataExportError: 'could not export right now — try again',

  yourDataDeleteCheckinEmpty: 'no check-ins yet to delete',
  yourDataDeleteCheckinRowLabel: (circleName: string, dateLabel: string) => `${circleName} — ${dateLabel}`,
  yourDataDeleteCheckinConfirm:
    "delete this check-in? this may change your glow — it recomputes from what's left. reflections from that day stay put.",
  yourDataDeleteCheckinConfirmCta: 'Delete',
  yourDataDeleteCheckinCancelCta: 'Cancel',
  yourDataDeleteCheckinError: 'could not delete that — try again',

  // PH1 — a failed avatar upload must speak (it shipped silent once: the
  // native path was landing zero-byte objects with a "success"). Shown
  // inline by both saveProfile callers (onboarding profile, settings);
  // the name always still saves.
  profilePhotoUploadFailed:
    "your photo didn't upload, but your name is saved — try again later from settings",

  yourDataDeletePictureNoneYet: 'no photo to remove yet',
  yourDataDeletePictureConfirm: "remove your photo? your initials will show instead — nothing else changes.",
  yourDataDeletePictureConfirmCta: 'Remove photo',
  yourDataDeletePictureCancelCta: 'Cancel',
  yourDataDeletePictureError: 'could not remove that — try again',

  yourDataDangerZoneLabel: 'danger zone',
  yourDataDeleteAccountCta: 'Delete my account',
  yourDataDeleteAccountConfirmIntro:
    "This deletes your profile, check-ins, and reflections for good — it can't be undone. Circles you started stay with your circle-mates.",
  yourDataDeleteAccountTypeToConfirmLabel: 'type DELETE to confirm',
  yourDataDeleteAccountConfirmCta: 'Delete forever',
  yourDataDeleteAccountCancelCta: 'Cancel',
  yourDataDeleteAccountError: 'could not delete your account — try again',

  // Public /privacy route (13 July) — a real policy, not marketing, for
  // the TestFlight/App Store Connect "privacy policy URL" field. Tone
  // matches the privacy-promise screen (plain language, warm, no legalese
  // padding) but every claim here must be checked against the actual
  // code/DB — see the section-by-section audit in the commit that added
  // this file. Signed-out accessible by design; never gate this route.
  privacyPolicyTitle: 'Privacy policy',
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
      body: "Open Settings → Your data & privacy any time you're signed in to: see a plain summary of what we hold, export everything as a file, delete a single check-in, remove your profile photo, or delete your account entirely (which removes your profile, check-ins, and reflections for good — circles you started stay with whoever's left in them). All of it happens immediately, nothing is queued or reviewed first.",
    },
    {
      heading: 'Questions',
      body: 'Email rally21@amsadvisory.uk and a real person (not a bot) will read it.',
    },
  ],

  // SC1 (13 July) — share cards, phase 1a. Quiet, dignified actions
  // matching the app's established confirm-inline pattern; no drama
  // styling, no frown/emoji-face iconography for "not for me" (spec §3).
  shareCardLikeCta: 'Like',
  shareCardShareCta: 'Share',
  shareCardNotForMeCta: 'Not for me',
  // SC1C (15 July) removed the on-card Save button and the "Not my kind
  // of thing" flavor-mute entry point (with its confirm dialog), so
  // shareCardSaveCta / shareCardMuteCta / shareCardMuteConfirm* are gone.
  // The flavor-mute pref infra + the settings "muted card flavors" list
  // (labels below) stay — they just have no on-card mute-ON path anymore.
  shareCardMutedFlavorsLabel: 'muted card flavors',
  shareCardMutedFlavorsEmpty: "you haven't muted any card flavors",
  shareCardFlavorCuratedQuote: 'quote cards',
  shareCardFlavorWarmJourney: 'journey cards',
  shareCardFlavorWrapped: 'day-21 keepsake cards',
  shareCardFlavorDotStrip: 'week-strip cards',
  shareCardReEnableCta: 'Turn back on',
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
  wrappedShareCta: 'Share',
  wrappedDone: 'done',
  shareCardHidePracticeName: 'hide practice name',
  shareCardShowPracticeName: 'show practice name',
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
] as const;

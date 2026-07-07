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
  checkinSuccessTitle: (n: number) => `Day ${n} done`,
  checkinSuccessBody: 'You showed up again.',
  checkinSuccessCta: 'Nice',

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

  emptyGroupTitle: 'Penguins huddle better together',
  emptyGroupBody: 'Invite a friend to start your rally.',
  emptyGroupCta: 'Join the huddle',

  chatTabLabel: 'Chat',
  chatIntroMessage:
    "Hi there, feel free to come chat anytime you want to talk something through, about your practice or from life in general. The more time we spend together, and the more detailed your daily reflections, the more insightful I'll become.\n\n" +
    "This is a totally safe place, our chats are completely private and never shared.\n\n" +
    "One thing to be clear about: I'm a companion, not a therapist. If things feel heavy, please talk to someone qualified — and in a crisis, contact emergency services or a crisis line right away.",
  chatComingSoonPill: 'Coming soon',
  chatPlaceholderReply: "I'm not quite ready yet — coming soon.",

  voiceDictationDeniedHint: 'you can also dictate with the keyboard mic 🎤',
  voiceMicDiscoveryHint: 'you can speak your answers 🎤 — often easier than typing',

  practiceStepQuestion: 'what will you do each day?',
  circleNameHelper: "this is your team's name — make it yours",
  publicShareDisclosure: 'public circles share their practice to the library, so others can start their own',
  myPracticesSubtitle: 'your practice library — reuse them in new circles. Shared ones can be picked by others.',
  practicePillShared: 'shared',
  practicePillOnlyYou: 'only you',

  // Cover a friend — covering is a celebrated gift, never a debt. No
  // copy anywhere should read as a score, an "owed", or guilt (see
  // CLAUDE.md's cover-a-friend rule).
  coverAffordance: '💛 cover',
  coverHintDiscovery: "you can log a friend's day for them — a gift, never a debt.",
  coverHeadline: (name: string) => `${name}'s been quiet`,
  coverSubtitle: "cover today — it's a gift, not a debt 💛",
  coverNotePreview: (covererName: string) =>
    `They'll get a warm note: "${covererName} covered you today. No pressure, we've got you."`,
  coverActionLabel: '💛 Cover & send love',
  waveActionLabel: '👋 Just a wave hello',
  coverCta: (name: string) => `Cover ${name} today`,
  waveCta: (name: string) => `Wave hello to ${name}`,

  coveredNoteToCoveredMember: (covererName: string) =>
    `${covererName} covered you today. No pressure, we've got you.`,
  wallCoveredEntry: (covererName: string, coveredName: string) =>
    `${covererName} covered ${coveredName} today 💛`,
  // The wave's wall line (was wallWaveEntry) now composes server-side in
  // send_friend_nudge (security spec S1, F4) — the copy is unchanged,
  // just no longer client-composed.

  presenceCoveredLabel: 'covered 💛',
  circleYouCoveredCard: (name: string) => `You covered ${name} today 💛`,
  circleYouCoveredCardBody: "The signal stays warm for everyone. That's the whole point.",
  circleCoveredYouCard: (covererName: string) => `${covererName} covered you today 💛`,
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
  friendNudgeToggleLabel: 'nudges from circle-mates',
  friendNudgeToggleHelper: "let someone in your circle send you a quiet wave if you've been quiet — never more than one a day.",
  digestToggleLabel: 'evening digest',
  digestToggleHelper: "a short recap if something warm happened and you haven't seen it yet.",
  quietHoursLabel: 'quiet hours',
  quietHoursHelper: 'no emails between these hours, your local time.',

  // Friend nudge (Notifications spec §4b) — pre-written only, so every
  // nudge is safe to receive. This absorbs the cover-a-friend "wave"
  // gesture. The subject/message pool and wall-line template all compose
  // server-side now (security spec S1, F4) — send-notifications and
  // send_friend_nudge keep their own copies of this copy, same pattern as
  // NUDGE_WARM_LINES below.
  alreadyNudgedError: (name: string) => `someone's already waved at ${name} today 💛`,

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
  hostCloseToJoinsHelperClosed: "you're not taking new members right now",
  hostDeleteWallMessageConfirm: 'Remove this from the wall?',

  // Pre-sign-in onboarding (rev-7 mockup screens 1–3) — signed-in users
  // never see these; a signed-out visit to the app starts here.
  introSplashTagline: 'do it together',
  introSplashSubtitle: 'a few lines a day · paid back as a gift',
  introWelcomeTitleLead: "don't do it alone.\ndo it ",
  introWelcomeTitleAccent: 'together',
  introWelcomeBody:
    'Pick a small daily practice with a circle of friends. Show up for each other, a couple of lines a day.',
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
  journeyGateCardTitle: (circleName: string) => `${circleName} hit 21 days`,
  journeyGateCardBody: 'rally on, or your host can complete it — whenever feels right.',

  journeyRalliedOnCard: (circleName: string) => `${circleName} rallied on 🔥`,
  journeyRallyMarkerTitle: (rallyNum: number) => `rally ${rallyNum} complete`,
  journeyRallyMarkerBody: (circleName: string, day: number) => `day ${day} with ${circleName}`,
  journeyMajorStopTitle: (day: number) => `${day} days together`,
  journeyMajorStopBody: (circleName: string) => `${circleName} made it — still climbing.`,

  journeyCompletedBadge: 'completed',
  journeyCompletedTitle: (circleName: string) => `${circleName}, complete`,
  journeyCompletedBody: 'This circle is now a warm piece of your history — read-only, always yours.',
  journeyCompletedCta: 'Back to today',
  journeyCompleteHostControlLabel: 'complete this circle',
  journeyCompleteHostControlHelper: 'archives it warmly for everyone — this can be undone only by us, so take a moment first.',
  journeyCompleteConfirmTitle: (circleName: string) => `Complete ${circleName}?`,
  journeyCompleteConfirmBody: "Everyone keeps their history. The circle becomes read-only — a finished thing, not a lost one.",

  // The personal glow (Rally21-Glow-Spec.md §1-2, §6).
  glowGlowingLabel: (n: number) => `${n} day${n === 1 ? '' : 's'} glowing`,
  glowEmbersLabel: 'your glow is down to embers — one small thing today rekindles it.',
  glowHeldTodayNote: (name: string) => `${name} kept your glow warm today 💛`,
  glowDetailTitle: 'your glow',
  glowDetailBody:
    "your glow is the run of days you've shown up — anywhere, for anyone. a friend can cover you and it holds, up to a few times a month depending how far you've come. miss a day uncovered and it dims to embers for 48 hours — one small thing brings it right back.",
  glowDetailCta: 'Got it',

  // Friend streaks (Rally21-Glow-Spec.md §3) — shown near who's-here,
  // only the single best active pair streak, N >= 3.
  pairStreakLabel: (name: string, n: number) => `you and ${name}: ${n} days both in 🔥`,

  // Blueprint v0 (Rally21-Blueprint-Notes.md) — deterministic pattern
  // cards, day-14 observation's visual grammar.
  blueprintTitle: 'your blueprint',
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
  blueprintSeeYourBlueprint: 'see your blueprint →',
  blueprintLinkLabel: 'Your blueprint',
} as const;

// The daily nudge's rotating warm-line pool (Notifications spec §3) — one
// line picked per send, alongside the practice(s) and an open-app button.
// Canonical source for the copy itself; the send-notifications edge
// function (a standalone Deno file with no access to this module graph)
// keeps its own literal copy of this exact array in sync by hand — see
// the comment at its definition there.
export const NUDGE_WARM_LINES = [
  "no pressure — just today's little thing, whenever you get to it.",
  'your circle showed up for you before. today, maybe you show up for them.',
  "small and steady beats big and never. today's a small day.",
  'nobody is keeping score. this is just an invitation.',
  "a couple minutes, a couple lines — that's the whole ask.",
  'the circle is quietly rooting for you, no pressure attached.',
  "today's version of you only needs to do today's version of the thing.",
  'showing up messy still counts as showing up.',
] as const;

// Restart-framed only — never references a miss. Used instead of a warm
// line when yesterday had no completion, so the copy never reads as guilt.
export const NUDGE_RESTART_LINES = [
  'Day 1s are allowed. Tonight counts.',
  'every day is a fine day to start again.',
  'no catching up required — just today.',
  "today's a clean page. that's all it needs to be.",
] as const;

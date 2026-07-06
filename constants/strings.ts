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
  wallWaveEntry: (waverName: string, targetName: string) => `${waverName} waved at ${targetName} 👋`,

  presenceCoveredLabel: 'covered 💛',
  circleYouCoveredCard: (name: string) => `You covered ${name} today 💛`,
  circleYouCoveredCardBody: "The signal stays warm for everyone. That's the whole point.",
  circleCoveredYouCard: (covererName: string) => `${covererName} covered you today 💛`,
  circleCoveredYouCardBody: "No pressure, we've got you.",

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
  // gesture; wallWaveEntry above still renders the wall line.
  friendNudgeMessages: [
    'thinking of you today 💛',
    "the circle's warmer with you",
    'no pressure — just waving',
    'sending a little sunshine your way ☀️',
    'just popped by to say hi 👋',
  ],
  friendNudgeSubject: (waverName: string) => `${waverName} is waving at you 👋`,
  friendNudgeEmailBody: (waverName: string, message: string) =>
    `<p>${waverName}: "${message}"</p>`,
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

// No i18n setup exists in this project yet — user-facing copy lives here
// instead of inline, so it has one place to move into a real localization
// system later. Strings that take values are small formatter functions
// rather than raw templates, so call sites can't typo a `{n}` token.
export const STRINGS = {
  checkinSuccessTitle: (n: number) => `Day ${n} done`,
  checkinSuccessBody: 'You showed up again.',
  checkinSuccessCta: 'Nice',

  groupHeaderStatus: (n: number, x: number, y: number) => `Day ${n} of 21 · ${x} of ${y} checked in`,

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
} as const;

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
  chatEmptyIntro: "Hi! I'm here if you need a hand.",
  chatPlaceholderReply: "I'm not quite ready yet — coming soon.",
} as const;

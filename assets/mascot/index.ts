// Single require() point for the mascot images actually used in the app —
// consumers import from here instead of relative-pathing into assets/
// from wherever they happen to live in the tree.
//
// Placement, motion, and sound rules live in
// '../../../Rally21-Mascot-Brief.md' — that brief is the spec; don't add a
// new placement without checking it first (the whole point is scarcity —
// a user sees the penguin at most once per normal day). The full asset
// inventory below exists per the brief even though four of them (below
// the placed ones) aren't placed anywhere yet — day21CelebrationHuddle
// ships for R1's day-21 ceremony; pureWelcome/threeQuarterView are
// general-purpose spares; gentlyEncouraging/sleepyButTrying are
// deliberately benched (nudge/guilt-adjacent — see the brief).
export const MASCOT = {
  // M2 (17 July) — the restyled set (Rally21-Mascot-Brief.md → "The
  // restyle"): same character, one notch more grown up; smaller head,
  // plain dot eyes, softly shaded 2D, two green stripes on the scarf.
  // Check-in success now uses proudAfterShowingUp (confetti-free — the
  // celebration confetti comes from code, always green); the old
  // penguin-confetti.png and baked-confetti day21 art are gone.
  proudAfterShowingUp: require('./proud-after-showing-up.png'),
  theRestart: require('./the-restart.png'),
  invitationHuddle: require('./invitation-huddle.png'),
  coverAFriend: require('./cover-a-friend.png'),
  apologeticSlip: require('./apologetic-slip.png'),
  journalCompanion: require('./journal-companion.png'),
  cozyAndContent: require('./cozy-and-content.png'),
  day21CelebrationHuddle: require('./day21-celebration-huddle-no-confetti.png'),
  pureWelcome: require('./pure-welcome.png'),
  threeQuarterView: require('./three-quarter-view.png'),
  gentlyEncouraging: require('./gently-encouraging.png'),
  sleepyButTrying: require('./sleepy-but-trying.png'),
  // Ask Rally's empty state only (A2, 7 July) — text-first once a
  // conversation exists, per the brief's scarcity principle.
  theListener: require('./the-listener.png'),
  // BD2 (8 July) — the once-a-year birthday moment on Today
  // (components/BirthdayBanner.tsx).
  birthdayPenguin: require('./birthday-penguin.png'),
  // M2 gesture frames — each pairs with its base art above for a
  // ONE-SHOT gesture (quick swaps for wink/wave, a small cropped-patch
  // crossfade for flame/steam — see lib/mascotFx.ts). Never idle loops.
  proudAfterShowingUpWink: require('./proud-after-showing-up-wink.png'),
  birthdayPenguinFlicker: require('./birthday-penguin-flicker.png'),
  theListenerSteam: require('./the-listener-steam.png'),
  apologeticSlipWave: require('./apologetic-slip-wave.png'),
};

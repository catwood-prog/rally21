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
  proudAfterShowingUp: require('./proud-after-showing-up.png'),
  theRestart: require('./the-restart.png'),
  invitationHuddle: require('./invitation-huddle.png'),
  coverAFriend: require('./cover-a-friend.png'),
  apologeticSlip: require('./apologetic-slip.png'),
  journalCompanion: require('./journal-companion.png'),
  cozyAndContent: require('./cozy-and-content.png'),
  day21CelebrationHuddle: require('./day21-celebration-huddle.png'),
  pureWelcome: require('./pure-welcome.png'),
  threeQuarterView: require('./three-quarter-view.png'),
  gentlyEncouraging: require('./gently-encouraging.png'),
  sleepyButTrying: require('./sleepy-but-trying.png'),
};

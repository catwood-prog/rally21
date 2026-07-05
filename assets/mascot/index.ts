// Single require() point for the mascot images actually used in the app —
// consumers import from here instead of relative-pathing into assets/
// from wherever they happen to live in the tree.
//
// penguin-confetti.png (static confetti baked into the image) is an
// intentionally unused fallback — the check-in success screen animates its
// own confetti in code over penguin-confetti-body.png instead.
export const MASCOT = {
  confettiBody: require('./penguin-confetti-body.png'),
  huddle: require('./penguin-huddle.png'),
  waving: require('./penguin-waving.png'),
};

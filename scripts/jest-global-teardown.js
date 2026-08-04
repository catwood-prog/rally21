// jest `globalTeardown` — see scripts/jest-db-guard.js for why this exists.
// Reprints the banner after the last suite so it lands next to the summary
// rather than scrolled off the top.
const { guard } = require('./jest-db-guard');

module.exports = async () => {
  guard('teardown');
};

// jest `globalSetup` — see scripts/jest-db-guard.js for why this exists.
const { guard } = require('./jest-db-guard');

module.exports = async () => {
  guard('setup');
};

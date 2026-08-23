const { withInfoPlist } = require('expo/config-plugins');

/**
 * AK1 job 4 — the Info.plist key, without which AlarmKit does nothing.
 *
 * Apple, verbatim: "If the NSAlarmKitUsageDescription key is missing or
 * its value is an empty string, apps can't schedule alarms with
 * AlarmKit." So this is not a nicety — a missing key is a feature that
 * silently never works, which is exactly the failure class job 7 exists
 * to prevent.
 *
 * A config plugin rather than a hand-edited Info.plist because this
 * project uses CNG (there is no ios/ directory in the repo; prebuild
 * generates it), so a hand edit would be erased on the next prebuild.
 * We would have had to write this plugin for ANY of the community
 * modules too — none of them ships one — which is part of why job 1b
 * recommended our own module.
 *
 * The string is what the person reads in the system prompt at the earned
 * moment, so it follows the warmth laws: it says what it is for, it
 * promises the thing they just asked for, and it claims nothing else.
 */
const USAGE_DESCRIPTION =
  'Rally21 uses alarms only for the circle alarms you set yourself, at the times you choose.';

module.exports = function withRallyAlarmKit(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.NSAlarmKitUsageDescription = USAGE_DESCRIPTION;
    return cfg;
  });
};

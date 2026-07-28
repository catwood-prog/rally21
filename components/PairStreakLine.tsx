import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { PairStreak } from '@/lib/glow';
import { bestPairForCircle, shouldShowPairRun } from '@/lib/pairStreaks';

/**
 * PA4 (Personal-Arc memo §5.1) — the friendship line beside who's-here.
 *
 * The headline is the CUMULATIVE number and never falls; the live run
 * sits beside it as a small flourish that may break without taking the
 * friendship's worth with it. Before PA4 this rendered the run alone,
 * which on 27 July meant every real pair in the cohort showed a zero.
 *
 * Extracted from circle.tsx so the rendered sentence can be asserted
 * directly (the JourneyGateExitButton precedent), and so the "one pair,
 * never a list" law of Glow-Spec §5 lives behind a component boundary
 * rather than inside a 1900-line screen where a future `.slice(0, 3)`
 * would not look like a product decision.
 */
export function PairStreakLine({ pairs }: { pairs: PairStreak[] }) {
  const best = bestPairForCircle(pairs);
  if (!best) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.headline}>
        {STRINGS.pairDaysTogetherLabel(best.otherName, best.daysTogether)}
      </Text>
      {shouldShowPairRun(best) && (
        <Text style={styles.run}>{STRINGS.pairRunFlourish(best.streak)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Headline + flourish share a baseline, and WRAP rather than squeeze:
  // at accessibility text sizes a long name plus "12 in a row" overflows
  // a phone-width row, and the flourish dropping to its own line is the
  // correct degradation.
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    columnGap: 6,
    marginTop: -4,
    marginBottom: 10,
  },
  headline: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
  },
  run: {
    fontSize: 11.5,
    fontWeight: '600',
    // mutedStrong (5.01:1), never muted (3.00:1) — OD1 job 10's rule:
    // this is small print a person actually reads.
    color: colors.mutedStrong,
  },
});

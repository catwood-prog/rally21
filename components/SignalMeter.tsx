import { StyleSheet, Text, View } from 'react-native';

import { chipShape, chipTextShape, colors } from '@/constants/theme';
import { getJourneyLeg } from '@/lib/journey';
import { SignalState } from '@/lib/signal';

/** The milestone just below the current journey leg's target — used to
 * anchor the ladder progress bar's 0% end (21 for the 50-leg, 50 for the
 * 100-leg, 100 for the 365-leg). Past 365 there's no further named stop,
 * so the bar just shows full. */
function legStartDay(targetDay: number | null): number {
  if (targetDay === 50) return 21;
  if (targetDay === 100) return 50;
  if (targetDay === 365) return 100;
  return 365;
}

const STATE_LABEL: Record<SignalState, string> = {
  glowing: 'glowing 🔥',
  warm: 'warm',
  resting: 'resting',
};

const STATE_COLOR: Record<SignalState, string> = {
  glowing: colors.green,
  warm: colors.gold,
  resting: colors.muted,
};

export function SignalMeter({
  state,
  dailyRates,
  dayNumber,
  durationDays,
  isSolo = false,
  size = 'default',
  isRallied = false,
}: {
  state: SignalState;
  dailyRates: number[];
  dayNumber?: number;
  durationDays?: number;
  isSolo?: boolean;
  size?: 'default' | 'large';
  /** Circle has rallied on past day 21 (Rally21-Glow-Spec.md §8) — the
   * day pill switches from "Day N of 21" to the journey ladder ("day N ·
   * rallying to 50") with its own progress bar for the current leg. */
  isRallied?: boolean;
}) {
  const barHeight = size === 'large' ? 46 : 28;
  const leg = isRallied && dayNumber ? getJourneyLeg(dayNumber) : null;
  const legStart = leg ? legStartDay(leg.targetDay) : 0;
  const legProgress =
    leg && leg.targetDay
      ? Math.min(1, Math.max(0, (dayNumber! - legStart) / (leg.targetDay - legStart)))
      : 1;

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.label}>
          {isSolo ? 'Your practice is' : 'Your circle is'}{' '}
          <Text style={[styles.labelState, { color: STATE_COLOR[state] }]}>
            {STATE_LABEL[state]}
          </Text>
        </Text>
        {leg ? (
          <View style={styles.dayBadge}>
            <Text style={styles.dayBadgeText}>
              day {dayNumber} · {leg.label}
            </Text>
          </View>
        ) : (
          !!dayNumber &&
          !!durationDays && (
            <View style={styles.dayBadge}>
              <Text style={styles.dayBadgeText}>
                Day {Math.min(dayNumber, durationDays)} of {durationDays}
              </Text>
            </View>
          )
        )}
      </View>
      {leg && (
        <View style={styles.legProgressTrack}>
          <View style={[styles.legProgressFill, { width: `${legProgress * 100}%` }]} />
        </View>
      )}
      <View style={[styles.bars, { height: barHeight }]}>
        {dailyRates.map((rate, i) => (
          <View key={i} style={styles.barTrack}>
            <View style={[styles.barFill, { height: `${Math.max(rate * 100, 8)}%` }]} />
          </View>
        ))}
      </View>
      <Text style={styles.caption}>
        {isSolo
          ? "kept warm — it can't break, only glow brighter"
          : "kept warm together — it can't break, only glow brighter"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.ink,
  },
  labelState: {
    fontWeight: '800',
  },
  // Demoted from a solid-gold pill — this is pure information (which day
  // it is), not an action, so gold on this screen stays reserved for the
  // check-in CTA and the warmth status word (see CLAUDE.md's color-roles
  // convention).
  dayBadge: {
    ...chipShape,
    backgroundColor: colors.cream,
  },
  dayBadgeText: {
    ...chipTextShape,
    color: colors.muted,
  },
  legProgressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.greenSoft,
    overflow: 'hidden',
    marginBottom: 8,
  },
  legProgressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: colors.green,
  },
  bars: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'flex-end',
    marginBottom: 8,
  },
  barTrack: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
    backgroundColor: colors.greenSoft,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: 3,
    backgroundColor: colors.green,
  },
  caption: {
    fontSize: 10.5,
    color: colors.muted,
    lineHeight: 14,
  },
});

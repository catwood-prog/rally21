import { StyleSheet, Text, View } from 'react-native';

import { STRINGS } from '@/constants/strings';
import { chipShape, chipTextShape, colors } from '@/constants/theme';
import { GATE_DAY, getJourneyLeg } from '@/lib/journey';
import { SignalState } from '@/lib/signal';

/** The milestone just below the current journey leg's target — used to
 * anchor the ladder progress bar's 0% end (21 for the 50-leg, 50 for the
 * 100-leg, 100 for the 365-leg). Past 365 there's no further named stop,
 * so the bar just shows full. */
function legStartCount(targetDay: number | null): number {
  if (targetDay === 50) return 21;
  if (targetDay === 100) return 50;
  if (targetDay === 365) return 100;
  return 365;
}

const STATE_LABEL: Record<SignalState, string> = {
  glowing: STRINGS.signalStateGlowing,
  warm: STRINGS.signalStateWarm,
  resting: STRINGS.signalStateResting,
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
  rallyCount,
  isSolo = false,
  size = 'default',
}: {
  state: SignalState;
  dailyRates: number[];
  /** PA1 — THE CIRCLE'S AGE. Counts up forever from the start date: a
   * circle is a place, not an arc (memo §3), so it is never capped at a
   * duration and never carries an "of 21". */
  dayNumber?: number;
  /** PA1 — THE MEMBER'S OWN RALLY, counted in practices they actually
   * did in THIS circle (`countRallyDays`). Rendered on its own line
   * under the circle's age, never beside it and never folded into it:
   * memo §4's three clocks are "never summed, never compared, and never
   * presented as one number". Omitted (welcome-back) = no rally line. */
  rallyCount?: number;
  isSolo?: boolean;
  size?: 'default' | 'large';
}) {
  const barHeight = size === 'large' ? 46 : 28;
  // PA1 — the ladder is the PERSONAL rally ladder now (memo §11
  // supersedes Glow-Spec §8), so it opens on the member's own 21st
  // practice rather than on the circle's rallied_on_at flag. That flag
  // is PA2's to delete; nothing here reads it any more.
  const leg =
    rallyCount !== undefined && rallyCount >= GATE_DAY ? getJourneyLeg(rallyCount) : null;
  const legStart = leg ? legStartCount(leg.targetDay) : 0;
  const legProgress =
    leg && leg.targetDay
      ? Math.min(1, Math.max(0, (rallyCount! - legStart) / (leg.targetDay - legStart)))
      : 1;

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.label}>
          {isSolo ? STRINGS.signalStateLabelSolo : STRINGS.signalStateLabelCircle}{' '}
          <Text style={[styles.labelState, { color: STATE_COLOR[state] }]}>
            {STATE_LABEL[state]}
          </Text>
        </Text>
        {!!dayNumber && (
          <View style={styles.dayBadge}>
            <Text style={styles.dayBadgeText}>
              {isSolo ? STRINGS.signalCircleAgeSolo(dayNumber) : STRINGS.signalCircleAge(dayNumber)}
            </Text>
          </View>
        )}
      </View>
      {rallyCount !== undefined && (
        // Its own full-width row rather than a second pill in the header:
        // at 1.35× Dynamic Type two chips on one line collide, and more
        // importantly two numbers side by side invite exactly the
        // comparison §4 forbids.
        <Text style={styles.rallyLine}>
          {leg
            ? STRINGS.signalRallyLeg(rallyCount, leg.label)
            : STRINGS.signalRallyProgress(rallyCount, GATE_DAY)}
        </Text>
      )}
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
        {isSolo ? STRINGS.signalCaptionSolo : STRINGS.signalCaptionCircle}
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
  // PA1 job 3 — deliberately NOT a chip. The circle's age is chrome (a
  // muted pill); your rally is yours, so it is plain ink text on its own
  // line. Different position, different shape, different weight — three
  // ways of saying "these are not the same number". No fixed lineHeight,
  // so it grows properly at accessibility text sizes.
  rallyLine: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: 8,
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

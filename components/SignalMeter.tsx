import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';
import { SignalState } from '@/lib/signal';

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
}: {
  state: SignalState;
  dailyRates: number[];
  dayNumber?: number;
  durationDays?: number;
  isSolo?: boolean;
  size?: 'default' | 'large';
}) {
  const barHeight = size === 'large' ? 46 : 28;

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.label}>
          {isSolo ? 'Your practice is' : 'Your circle is'}{' '}
          <Text style={[styles.labelState, { color: STATE_COLOR[state] }]}>
            {STATE_LABEL[state]}
          </Text>
        </Text>
        {!!dayNumber && !!durationDays && (
          <View style={styles.dayBadge}>
            <Text style={styles.dayBadgeText}>
              Day {Math.min(dayNumber, durationDays)} of {durationDays}
            </Text>
          </View>
        )}
      </View>
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
  dayBadge: {
    backgroundColor: colors.gold,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 99,
  },
  dayBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#3A2E06',
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
    backgroundColor: '#EAF3EA',
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

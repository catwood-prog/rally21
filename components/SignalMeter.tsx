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
  size = 'default',
}: {
  state: SignalState;
  dailyRates: number[];
  size?: 'default' | 'large';
}) {
  const barHeight = size === 'large' ? 46 : 28;

  return (
    <View>
      <Text style={styles.label}>
        Your circle is{' '}
        <Text style={[styles.labelState, { color: STATE_COLOR[state] }]}>
          {STATE_LABEL[state]}
        </Text>
      </Text>
      <View style={[styles.bars, { height: barHeight }]}>
        {dailyRates.map((rate, i) => (
          <View key={i} style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  height: `${Math.max(rate * 100, 8)}%`,
                  backgroundColor: STATE_COLOR[state],
                },
              ]}
            />
          </View>
        ))}
      </View>
      <Text style={styles.caption}>
        Kept together over the trailing 7 days. It can&apos;t break — just glow brighter.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: 10,
  },
  labelState: {
    fontWeight: '800',
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
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: 3,
  },
  caption: {
    fontSize: 10.5,
    color: colors.muted,
    lineHeight: 14,
  },
});

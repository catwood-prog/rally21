import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brandmark } from '@/components/Brandmark';
import { FONT_HEADER } from '@/constants/fonts';
import { cardShadow, colors } from '@/constants/theme';

export default function CircleSetup() {
  const router = useRouter();
  // NAV1 job 0 — no AppHeader on pre-signed-in-chrome screens, but the
  // safe-area inset still applies.
  const insets = useSafeAreaInsets();
  const { fromToday, wantKey, wantStatement, suggestedName } = useLocalSearchParams<{
    fromToday?: string;
    wantKey?: string;
    wantStatement?: string;
    suggestedName?: string;
  }>();

  // The wants act flow ("make this your next 21 days") lands here first —
  // same solo/circle fork everyone else gets, just carrying the want's
  // details through so create-circle can prefill a custom practice.
  const wantParams = wantKey ? { wantKey, wantStatement: wantStatement ?? '', suggestedName: suggestedName ?? '' } : {};

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity
        style={styles.back}
        onPress={() => router.push(fromToday === 'true' ? '/today' : '/onboarding/profile')}
      >
        <Text style={styles.backText}>{fromToday === 'true' ? '← Today' : '← Back'}</Text>
      </TouchableOpacity>

      <Text style={styles.title}>
        how do you{'\n'}want to begin?
      </Text>
      <Text style={styles.subtitle}>you can always add more circles later</Text>

      <TouchableOpacity
        style={[styles.card, styles.cardHighlighted]}
        onPress={() =>
          router.push({
            pathname: '/onboarding/create-circle',
            params: { ...(fromToday === 'true' ? { fromToday: 'true' } : {}), ...wantParams },
          })
        }
      >
        <Text style={styles.cardEmoji}>✨</Text>
        <Text style={styles.cardTitle}>Start or join a circle</Text>
        <Text style={styles.cardBody}>
          Find a practice, then start your own or hop into one that&apos;s already running.
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() =>
          router.push({
            pathname: '/onboarding/join-circle',
            params: fromToday === 'true' ? { fromToday: 'true' } : {},
          })
        }
      >
        <Text style={styles.cardEmoji}>🤝</Text>
        <Text style={styles.cardTitle}>Use an invite code</Text>
        <Text style={styles.cardBody}>
          Got a code from a friend? Hop straight into their circle.
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() =>
          router.push({
            pathname: '/onboarding/create-circle',
            params: {
              solo: 'true',
              ...(fromToday === 'true' ? { fromToday: 'true' } : {}),
              ...wantParams,
            },
          })
        }
      >
        <Text style={styles.cardEmoji}>🌱</Text>
        <Text style={styles.cardTitle}>Go solo</Text>
        <Text style={styles.cardBody}>
          just you, for now — your circle can grow later
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brandmark: {
    marginBottom: 18,
  },
  back: {
    marginBottom: 20,
  },
  backText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 25,
    lineHeight: 30,
    color: colors.ink,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 8,
    marginBottom: 22,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    ...cardShadow,
  },
  cardHighlighted: {
    borderWidth: 1.5,
    borderColor: colors.green,
  },
  cardEmoji: {
    fontSize: 24,
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.ink,
  },
  cardBody: {
    fontSize: 11.5,
    color: colors.muted,
    lineHeight: 16,
    marginTop: 4,
  },
});

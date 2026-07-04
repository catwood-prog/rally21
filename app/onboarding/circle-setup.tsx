import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { FONT_HEADER } from '@/constants/fonts';
import { colors } from '@/constants/theme';

export default function CircleSetup() {
  const router = useRouter();
  const { fromToday } = useLocalSearchParams<{ fromToday?: string }>();

  return (
    <View style={styles.container}>
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
        onPress={() => router.push('/onboarding/create-circle')}
      >
        <Text style={styles.cardEmoji}>✨</Text>
        <Text style={styles.cardTitle}>Start or join a circle</Text>
        <Text style={styles.cardBody}>
          Find a practice, then start your own or hop into one that&apos;s already running.
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.card} onPress={() => router.push('/onboarding/join-circle')}>
        <Text style={styles.cardEmoji}>🤝</Text>
        <Text style={styles.cardTitle}>Use an invite code</Text>
        <Text style={styles.cardBody}>
          Got a code from a friend? Hop straight into their circle.
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.soloCard}
        onPress={() => router.push({ pathname: '/onboarding/create-circle', params: { solo: 'true' } })}
      >
        <Text style={styles.soloCardTitle}>Go solo</Text>
        <Text style={styles.soloCardBody}>
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
  soloCard: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  soloCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.muted,
  },
  soloCardBody: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
});

import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { FONT_HEADER } from '@/constants/fonts';
import { colors } from '@/constants/theme';

export default function CircleSetup() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => router.push('/onboarding/profile')}>
        <Text style={styles.backText}>← Back</Text>
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
        <Text style={styles.cardTitle}>Start a circle</Text>
        <Text style={styles.cardBody}>
          Pick a practice, set the time, and invite your people.
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.card} onPress={() => router.push('/onboarding/join-circle')}>
        <Text style={styles.cardEmoji}>🤝</Text>
        <Text style={styles.cardTitle}>Join a circle</Text>
        <Text style={styles.cardBody}>
          Got an invite code? Hop into a circle that&apos;s already running.
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
});

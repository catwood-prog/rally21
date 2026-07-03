import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors } from '@/constants/theme';

// The two paths here (start / join) get wired up to real circle creation
// next — this screen just needs to exist as somewhere for a fresh profile
// to land.
const comingSoon = () =>
  Alert.alert('almost there', "circle creation is next — you'll be able to do this very soon");

export default function CircleSetup() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        how do you{'\n'}want to begin?
      </Text>
      <Text style={styles.subtitle}>you can always add more circles later</Text>

      <TouchableOpacity style={[styles.card, styles.cardHighlighted]} onPress={comingSoon}>
        <Text style={styles.cardEmoji}>✨</Text>
        <Text style={styles.cardTitle}>Start a circle</Text>
        <Text style={styles.cardBody}>
          Pick a practice, set the commitment, and invite your people.
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.card} onPress={comingSoon}>
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
  title: {
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '800',
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

import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getLocalDateString } from '@/lib/date';

export default function Today() {
  const { session, signOut } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>you&apos;re in</Text>
      <Text style={styles.subtitle}>signed in as {session?.user.email}</Text>
      <Text style={styles.subtitle}>today, locally, is {getLocalDateString()}</Text>

      <TouchableOpacity style={styles.button} onPress={signOut}>
        <Text style={styles.buttonText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.ink,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
  },
  button: {
    marginTop: 20,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  buttonText: {
    fontWeight: '700',
    color: colors.ink,
  },
});

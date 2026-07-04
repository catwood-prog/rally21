import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER } from '@/constants/fonts';
import { colors } from '@/constants/theme';
import { joinCircleByCode } from '@/lib/circles';

export default function JoinCircle() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = async () => {
    if (!code.trim()) return;
    setIsJoining(true);
    try {
      await joinCircleByCode(code);
      // "/" re-checks profile + membership and lands on Today
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : "that code didn't work — double check it");
      setIsJoining(false);
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.push('/onboarding/circle-setup')}>
        <Text style={styles.back}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>got a code?</Text>
      <Text style={styles.subtitle}>enter the 6-character code your friend sent you</Text>

      <TextInput
        style={styles.input}
        placeholder="ABC123"
        placeholderTextColor={colors.muted}
        value={code}
        onChangeText={(text) => setCode(text.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={6}
        onSubmitEditing={handleJoin}
      />

      <TouchableOpacity
        style={[styles.button, !code.trim() && styles.buttonDisabled]}
        onPress={handleJoin}
        disabled={!code.trim() || isJoining}
      >
        {isJoining ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text style={styles.buttonText}>Join circle</Text>
        )}
      </TouchableOpacity>

      <MessageDialog
        visible={!!error}
        title="hmm"
        message={error ?? ''}
        onDismiss={() => setError(null)}
      />
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
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 16,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 25,
    color: colors.ink,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 22,
    lineHeight: 19,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 16,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
    color: colors.ink,
    marginBottom: 16,
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
});

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brandmark } from '@/components/Brandmark';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

export default function SignIn() {
  const router = useRouter();
  // NAV1 — a plain intro-style back on both states, and the safe-area
  // inset for the absolute-positioned top-left chrome.
  const insets = useSafeAreaInsets();
  const { signInWithEmail, signInWithGoogle, signInWithApple } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isAppleLoading, setIsAppleLoading] = useState(false);

  const handleSend = async () => {
    if (!email.trim()) return;
    setStatus('sending');
    const { error } = await signInWithEmail(email.trim());
    if (error) {
      setErrorMessage(error);
      setStatus('error');
    } else {
      setStatus('sent');
    }
  };

  const handleGoogle = async () => {
    setIsGoogleLoading(true);
    // signInWithOAuth navigates the whole page away to Google on success —
    // this only resolves with an error if the redirect itself couldn't be
    // started (e.g. offline), so isGoogleLoading only needs to reset then.
    const { error } = await signInWithGoogle();
    if (error) {
      setErrorMessage(STRINGS.signInGoogleError);
      setStatus('error');
      setIsGoogleLoading(false);
    }
  };

  const handleApple = async () => {
    setIsAppleLoading(true);
    const { error } = await signInWithApple();
    // Web navigates the whole page away to Apple on success, same as
    // handleGoogle above. Native (GN1) resolves normally instead — no
    // page navigation happens, so the loading state always needs
    // resetting there; doing it unconditionally is harmless on web too
    // (the reset just lands a beat before the redirect fires).
    if (error) {
      setErrorMessage(STRINGS.signInAppleError);
      setStatus('error');
    }
    setIsAppleLoading(false);
  };

  if (status === 'sent') {
    return (
      <View style={styles.container}>
        <Brandmark style={[styles.brandmark, { top: 20 + insets.top }]} />
        {/* NAV1: a typo'd address must not strand this state — back
            returns to the form with everything still filled in. */}
        <TouchableOpacity
          style={[styles.back, { top: 52 + insets.top }]}
          onPress={() => setStatus('idle')}
        >
          <Text style={styles.backText}>{STRINGS.signInUseDifferentEmail}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>check your email</Text>
        <Text style={styles.subtitle}>
          we sent a link to{'\n'}
          <Text style={styles.email}>{email}</Text>
          {'\n'}tap it to jump back in
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Brandmark style={[styles.brandmark, { top: 20 + insets.top }]} />
      <TouchableOpacity
        style={[styles.back, { top: 52 + insets.top }]}
        onPress={() => router.replace('/welcome')}
      >
        <Text style={styles.backText}>← back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>let&apos;s get your circle going</Text>
      <Text style={styles.subtitle}>no password — just a link to your email</Text>

      {/* O1: Apple sits above Google (Apple's own guideline wants their
          button at least as prominent when both providers are offered). */}
      <View style={styles.oauthButtons}>
        <TouchableOpacity style={styles.appleButton} onPress={handleApple} disabled={isAppleLoading}>
          {isAppleLoading ? (
            <ActivityIndicator color={colors.card} />
          ) : (
            <>
              <Ionicons name="logo-apple" size={18} color={colors.card} />
              <Text style={styles.appleButtonText}>{STRINGS.signInWithAppleCta}</Text>
            </>
          )}
        </TouchableOpacity>
        <Text style={styles.appleHint}>{STRINGS.signInAppleShareEmailHint}</Text>

        <TouchableOpacity style={styles.googleButton} onPress={handleGoogle} disabled={isGoogleLoading}>
          {isGoogleLoading ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <>
              <Ionicons name="logo-google" size={18} color={colors.ink} />
              <Text style={styles.googleButtonText}>{STRINGS.signInWithGoogleCta}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>{STRINGS.signInOrDivider}</Text>
        <View style={styles.dividerLine} />
      </View>

      <TextInput
        style={styles.input}
        placeholder="you@example.com"
        placeholderTextColor={colors.muted}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        onSubmitEditing={handleSend}
      />

      {status === 'error' && <Text style={styles.errorText}>{errorMessage}</Text>}

      <TouchableOpacity style={styles.button} onPress={handleSend} disabled={status === 'sending'}>
        {status === 'sending' ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text style={styles.buttonText}>Send magic link</Text>
        )}
      </TouchableOpacity>
    </KeyboardAvoidingView>
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
    position: 'absolute',
    top: 20,
    left: 24,
  },
  back: {
    position: 'absolute',
    left: 24,
    zIndex: 1,
    paddingVertical: 8,
  },
  backText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 26,
    color: colors.ink,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    marginBottom: 24,
    lineHeight: 20,
  },
  oauthButtons: {
    gap: 10,
    marginBottom: 18,
  },
  appleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.ink,
    borderRadius: 14,
    paddingVertical: 14,
  },
  appleButtonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.card,
  },
  appleHint: {
    fontSize: 11.5,
    color: colors.muted,
    textAlign: 'center',
    marginTop: -2,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    paddingVertical: 14,
  },
  googleButtonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 18,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.line,
  },
  dividerText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  email: {
    fontWeight: '700',
    color: colors.ink,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 12,
  },
  errorText: {
    color: colors.errorRed,
    fontSize: 12.5,
    marginBottom: 8,
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
});

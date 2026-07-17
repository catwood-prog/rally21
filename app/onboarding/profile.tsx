import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BirthdayPicker, BirthdayValue } from '@/components/BirthdayPicker';
import { Brandmark } from '@/components/Brandmark';
import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { isValidBirthday } from '@/lib/birthday';
import { saveProfile } from '@/lib/profile';

// O1 (Google slice, 8/12 July): a brand-new Google signup arrives with a
// profile name already on the session (verified live — Supabase's
// raw_user_meta_data for a real Google identity carries `full_name`/`name`,
// no separate `given_name`, since only the basic email+profile scopes are
// granted here) — prefill it into the single "your name" field this screen
// already has, rather than leaving a blank field for something Google
// already told us. Still just a starting value in a normal TextInput:
// nothing saves until she taps Continue, same as every other field here.
function initialNameFromSession(session: { user: { user_metadata?: Record<string, unknown> } } | null): string {
  const metadata = session?.user.user_metadata;
  const fullName = metadata?.full_name ?? metadata?.name;
  return typeof fullName === 'string' ? fullName : '';
}

// O1 (Apple slice, 12 July) — live-verified this session that Apple's
// "Hide My Email" produces a genuinely disconnected duplicate account, not
// a linking failure that's otherwise recoverable client-side. This screen
// is only ever reached by a brand-new signup (an existing member's session
// routes straight to /today), so any Apple-provider session landing here
// IS a brand-new Apple-created account — checked regardless of whether the
// email looks like a private relay, since a real Apple ID's own address is
// just as likely to be one nobody recognizes as their Rally email.
function isNewAppleAccount(session: { user: { app_metadata?: Record<string, unknown> } } | null): boolean {
  return session?.user.app_metadata?.provider === 'apple';
}

export default function ProfileSetup() {
  const router = useRouter();
  // NAV1 job 0 — the safe-area inset still applies without an AppHeader.
  const insets = useSafeAreaInsets();
  const { session, signOut } = useAuth();
  const [name, setName] = useState(() => initialNameFromSession(session));
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [birthday, setBirthday] = useState<BirthdayValue>({ month: null, day: null, year: null });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [avatarWarning, setAvatarWarning] = useState<string | null>(null);
  const showAppleRescueLine = isNewAppleAccount(session);

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const handleContinue = async () => {
    if (!session?.user || !name.trim()) return;
    // Birthday is optional, but if a partial/invalid pair was somehow set,
    // catch it with a friendly message before the DB constraint would.
    if (!isValidBirthday(birthday.month, birthday.day, birthday.year)) {
      setError(STRINGS.birthdayInvalid);
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      const { avatarWarning: warning } = await saveProfile(session.user.id, {
        name,
        avatarUri: photoUri,
        birthday,
      });
      if (warning) {
        setAvatarWarning(warning);
      } else {
        router.replace('/onboarding/circle-setup');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'something went wrong — try again');
    } finally {
      setIsSaving(false);
    }
  };

  const initial = name.trim().charAt(0).toUpperCase();

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Brandmark style={[styles.brandmark, { top: 20 + insets.top }]} />
      <TouchableOpacity style={[styles.back, { top: 52 + insets.top }]} onPress={signOut}>
        <Text style={styles.backText}>← Sign out</Text>
      </TouchableOpacity>

      <Text style={styles.title}>your profile</Text>

      {showAppleRescueLine && (
        <View style={styles.appleRescueCard}>
          <Text style={styles.appleRescueText}>{STRINGS.onboardingAppleRescueLine}</Text>
        </View>
      )}

      <TouchableOpacity style={styles.photoWrap} onPress={pickPhoto}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder]}>
            <Text style={styles.photoInitial}>{initial || '?'}</Text>
          </View>
        )}
        <View style={styles.photoBadge}>
          <Text style={styles.photoBadgeText}>+</Text>
        </View>
      </TouchableOpacity>
      <Text style={styles.hint}>add a photo so your circle knows it&apos;s you</Text>

      <TextInput
        style={styles.input}
        placeholder="your name"
        placeholderTextColor={colors.muted}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoCorrect={false}
        onSubmitEditing={handleContinue}
      />

      <View style={styles.birthdaySection}>
        <Text style={styles.birthdayLabel}>
          {STRINGS.birthdayLabel} <Text style={styles.birthdayOptional}>{STRINGS.birthdayOptionalTag}</Text>
        </Text>
        <Text style={styles.birthdayWhy}>{STRINGS.birthdayWhy}</Text>
        <BirthdayPicker value={birthday} onChange={setBirthday} />
      </View>

      {!!error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity
        style={[styles.button, !name.trim() && styles.buttonDisabled]}
        onPress={handleContinue}
        disabled={!name.trim() || isSaving}
      >
        {isSaving ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text style={styles.buttonText}>Continue</Text>
        )}
      </TouchableOpacity>

      <MessageDialog
        visible={!!avatarWarning}
        title="almost there"
        message={avatarWarning ?? ''}
        onDismiss={() => {
          setAvatarWarning(null);
          router.replace('/onboarding/circle-setup');
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flexGrow: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 96,
    paddingBottom: 48,
  },
  brandmark: {
    position: 'absolute',
    top: 20,
    left: 24,
  },
  back: {
    position: 'absolute',
    top: 52,
    left: 24,
  },
  backText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 24,
    color: colors.ink,
    marginBottom: 20,
  },
  appleRescueCard: {
    width: '100%',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
  },
  appleRescueText: {
    fontSize: 12.5,
    color: colors.muted,
    lineHeight: 17,
  },
  photoWrap: {
    width: 104,
    height: 104,
    marginBottom: 10,
  },
  photo: {
    width: 104,
    height: 104,
    borderRadius: 52,
  },
  photoPlaceholder: {
    backgroundColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoInitial: {
    fontSize: 36,
    fontWeight: '800',
    color: colors.muted,
  },
  photoBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.gold,
    borderWidth: 3,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBadgeText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.ink,
    lineHeight: 18,
  },
  hint: {
    fontSize: 12.5,
    color: colors.muted,
    marginBottom: 22,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 12,
  },
  birthdaySection: {
    width: '100%',
    marginTop: 8,
    marginBottom: 20,
  },
  birthdayLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
  },
  birthdayOptional: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  birthdayWhy: {
    fontSize: 12.5,
    color: colors.muted,
    lineHeight: 17,
    marginTop: 4,
    marginBottom: 14,
  },
  errorText: {
    color: colors.errorRed,
    fontSize: 12.5,
    marginBottom: 8,
  },
  button: {
    width: '100%',
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

import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BirthdayPicker, BirthdayValue } from '@/components/BirthdayPicker';
import { Brandmark } from '@/components/Brandmark';
import { KeyboardFriendlyScrollView } from '@/components/KeyboardFriendlyScrollView';
import { MicTextInput } from '@/components/MicTextInput';
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
    <KeyboardFriendlyScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
    >
      <Brandmark style={[styles.brandmark, { top: 20 + insets.top }]} />
      {/* SO1 (27 July) — this ends your session; it is not navigation, and
          it used to be dressed as navigation. It sat in the back slot
          (absolute, left: 24, under the brandmark) wearing a back link's
          arrow and its muted 13/600 styling — which is exactly where and
          how "go back" is drawn everywhere else in this app (sign-in,
          privacy-promise and reminders all put "← back" at left: 24).
          Restyling it in place would have left the positional lie intact,
          so it moves to the top RIGHT: the corner AppHeader already gives
          to account chrome (its row is space-between, brandmark left, the
          gear right), and it takes settings.tsx's sign-out treatment
          verbatim (card fill, line border, 13/700 ink) so the app's two
          sign-outs read as the same control. It stays in the top band
          rather than moving below Continue because onboardingAppleRescueLine,
          rendered just under the title, tells an Apple duplicate account to
          "sign out above" — a bottom-of-screen sign-out would falsify copy
          Cat ruled in O1. No confirm: see the handoff. */}
      <TouchableOpacity
        style={[styles.signOut, { top: 12 + insets.top }]}
        onPress={signOut}
        accessibilityRole="button"
      >
        <Text style={styles.signOutText}>{STRINGS.profileSignOutLink}</Text>
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

      <MicTextInput
        style={styles.input}
        placeholder={STRINGS.profileNamePlaceholder}
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
          <Text style={styles.buttonText}>{STRINGS.continueCta}</Text>
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
    </KeyboardFriendlyScrollView>
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
  signOut: {
    position: 'absolute',
    right: 24,
    // A real 44px target — the owed half of OD1 job 13's family C. The
    // control itself is 44 tall rather than 13px text with padding around
    // it, because react-native-web 0.21.2 does not implement hitSlop at
    // all (job 13's finding), so a slop-based target would measure correct
    // on device and stay 16px on web. `top` is 12 rather than the
    // brandmark's 20 so this 44px box centres on the brandmark's line.
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
  },
  signOutText: {
    // settings.tsx's signOutText exactly. Ink on card, not the old
    // colors.muted, which was 3.00:1 and under the 4.5:1 small-text bar.
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
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
    color: colors.mutedStrong,
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
    backgroundColor: colors.placeholderGrey,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoInitial: {
    fontSize: 36,
    fontWeight: '800',
    color: colors.mutedStrong,
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
    color: colors.mutedStrong,
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
    color: colors.mutedStrong,
  },
  birthdayWhy: {
    fontSize: 12.5,
    color: colors.mutedStrong,
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

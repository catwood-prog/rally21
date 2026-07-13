import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Avatar } from '@/components/Avatar';
import { AppHeader } from '@/components/AppHeader';
import { BirthdayPicker, BirthdayValue } from '@/components/BirthdayPicker';
import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, chipShape, chipTextShape, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { isValidBirthday } from '@/lib/birthday';
import { BlockedPerson, getMyBlocks, unblockUser } from '@/lib/moderation';
import { getMyNotificationPrefs, NotificationPrefs, updateNotificationPrefs } from '@/lib/notifications';
import { getMyProfile, saveBirthday, saveProfile, setCelebrateBirthday, setSoundsEnabled } from '@/lib/profile';

const NUDGE_TIME_OPTIONS: { label: string; time: string | null }[] = [
  { label: STRINGS.nudgeTimeEarliest, time: null },
  { label: 'Morning', time: '08:00:00' },
  { label: 'Midday', time: '12:00:00' },
  { label: 'Evening', time: '18:00:00' },
  { label: 'Night', time: '21:00:00' },
];

const QUIET_START_OPTIONS = [
  { label: '8pm', time: '20:00:00' },
  { label: '9pm', time: '21:00:00' },
  { label: '10pm', time: '22:00:00' },
  { label: '11pm', time: '23:00:00' },
];

const QUIET_END_OPTIONS = [
  { label: '6am', time: '06:00:00' },
  { label: '7am', time: '07:00:00' },
  { label: '8am', time: '08:00:00' },
  { label: '9am', time: '09:00:00' },
];

export default function Settings() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [newPhotoUri, setNewPhotoUri] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [soundsEnabled, setSoundsEnabledState] = useState(true);
  const [birthday, setBirthday] = useState<BirthdayValue>({ month: null, day: null, year: null });
  const [celebrateBirthday, setCelebrateBirthdayState] = useState(true);
  const [isSavingBirthday, setIsSavingBirthday] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedPeople, setBlockedPeople] = useState<BlockedPerson[]>([]);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    try {
      const [profile, notificationPrefs, myBlocks] = await Promise.all([
        getMyProfile(session.user.id),
        getMyNotificationPrefs(session.user.id),
        getMyBlocks().catch(() => []),
      ]);
      setName(profile?.name ?? '');
      setAvatarUrl(profile?.avatar_url ?? null);
      setSoundsEnabledState(profile?.sounds_enabled ?? true);
      setBirthday({
        month: profile?.birth_month ?? null,
        day: profile?.birth_day ?? null,
        year: profile?.birth_year ?? null,
      });
      setCelebrateBirthdayState(profile?.celebrate_birthday ?? true);
      setPrefs(notificationPrefs);
      setBlockedPeople(myBlocks);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load your profile');
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id]);

  const handleUnblock = async (blockedId: string) => {
    setUnblockingId(blockedId);
    try {
      await unblockUser(blockedId);
      setBlockedPeople((prev) => prev.filter((p) => p.blockedId !== blockedId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not unblock — try again');
    } finally {
      setUnblockingId(null);
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled) {
      setNewPhotoUri(result.assets[0].uri);
    }
  };

  const handleSaveName = async () => {
    if (!session?.user || !name.trim()) return;
    setIsSaving(true);
    try {
      const { avatarWarning } = await saveProfile(session.user.id, { name, avatarUri: newPhotoUri });
      if (avatarWarning) {
        setError(avatarWarning);
      } else {
        setSavedNotice(true);
      }
      setNewPhotoUri(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save that — try again');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleSounds = async () => {
    if (!session?.user) return;
    const next = !soundsEnabled;
    setSoundsEnabledState(next);
    try {
      await setSoundsEnabled(session.user.id, next);
    } catch (e) {
      setSoundsEnabledState(!next);
      setError(e instanceof Error ? e.message : 'could not save that — try again');
    }
  };

  const handleSaveBirthday = async () => {
    if (!session?.user) return;
    if (!isValidBirthday(birthday.month, birthday.day, birthday.year)) {
      setError(STRINGS.birthdayInvalid);
      return;
    }
    setIsSavingBirthday(true);
    try {
      await saveBirthday(session.user.id, birthday);
      setSavedNotice(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save that — try again');
    } finally {
      setIsSavingBirthday(false);
    }
  };

  const handleToggleCelebrate = async () => {
    if (!session?.user) return;
    const next = !celebrateBirthday;
    setCelebrateBirthdayState(next);
    try {
      await setCelebrateBirthday(session.user.id, next);
    } catch (e) {
      setCelebrateBirthdayState(!next);
      setError(e instanceof Error ? e.message : 'could not save that — try again');
    }
  };

  const savePrefs = async (patch: Partial<NotificationPrefs>) => {
    if (!session?.user) return;
    const previous = prefs;
    setPrefs((p) => (p ? { ...p, ...patch } : p));
    try {
      await updateNotificationPrefs(session.user.id, patch);
    } catch (e) {
      setPrefs(previous);
      setError(e instanceof Error ? e.message : 'could not save that — try again');
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <AppHeader style={styles.header} hideGear />

      <Text style={styles.title}>Settings</Text>

      <TouchableOpacity style={styles.photoWrap} onPress={pickPhoto}>
        <Avatar name={name} avatarUrl={newPhotoUri ?? avatarUrl} size={84} />
        <View style={styles.photoBadge}>
          <Text style={styles.photoBadgeText}>+</Text>
        </View>
      </TouchableOpacity>
      <Text style={styles.photoHint}>tap to change your photo</Text>

      <Text style={styles.label}>your name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoCorrect={false}
      />
      <TouchableOpacity
        style={[styles.saveButton, !name.trim() && styles.buttonDisabled]}
        onPress={handleSaveName}
        disabled={!name.trim() || isSaving}
      >
        {isSaving ? (
          <ActivityIndicator size="small" color={colors.ink} />
        ) : (
          <Text style={styles.saveButtonText}>Save</Text>
        )}
      </TouchableOpacity>

      <Text style={[styles.label, styles.sectionSpacing]}>{STRINGS.settingsBirthdayLabel}</Text>
      <Text style={styles.birthdayWhy}>{STRINGS.birthdayWhy}</Text>
      <BirthdayPicker value={birthday} onChange={setBirthday} />
      <TouchableOpacity
        style={[styles.saveButton, styles.birthdaySaveButton]}
        onPress={handleSaveBirthday}
        disabled={isSavingBirthday}
      >
        {isSavingBirthday ? (
          <ActivityIndicator size="small" color={colors.ink} />
        ) : (
          <Text style={styles.saveButtonText}>{STRINGS.birthdaySave}</Text>
        )}
      </TouchableOpacity>

      <View style={[styles.prefRow, styles.birthdayToggleRow]}>
        <View style={styles.prefRowText}>
          <Text style={styles.prefRowLabel}>{STRINGS.birthdayCelebrateLabel}</Text>
          <Text style={styles.prefRowHelper}>{STRINGS.birthdayCelebrateHelper}</Text>
        </View>
        <TouchableOpacity
          style={[styles.prefPill, celebrateBirthday && styles.prefPillOn]}
          onPress={handleToggleCelebrate}
        >
          <Text style={[styles.prefPillText, celebrateBirthday && styles.prefPillTextOn]}>
            {celebrateBirthday ? 'on' : 'off'}
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.signOutButton, styles.sectionSpacing]}
        onPress={() => router.push('/my-practices')}
      >
        <Text style={styles.signOutText}>My practices</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.signOutButton} onPress={() => router.push('/your-data')}>
        <Text style={styles.signOutText}>{STRINGS.yourDataSettingsRow}</Text>
      </TouchableOpacity>

      <Text style={[styles.label, styles.sectionSpacing]}>{STRINGS.soundsSectionLabel}</Text>

      <View style={styles.prefRow}>
        <View style={styles.prefRowText}>
          <Text style={styles.prefRowLabel}>{STRINGS.soundsToggleLabel}</Text>
          <Text style={styles.prefRowHelper}>{STRINGS.soundsToggleHelper}</Text>
        </View>
        <TouchableOpacity
          style={[styles.prefPill, soundsEnabled && styles.prefPillOn]}
          onPress={handleToggleSounds}
        >
          <Text style={[styles.prefPillText, soundsEnabled && styles.prefPillTextOn]}>
            {soundsEnabled ? 'on' : 'off'}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.label, styles.sectionSpacing]}>{STRINGS.notificationsSectionLabel}</Text>

      <View style={styles.prefCard}>
        <View style={styles.prefToggleRow}>
          <View style={styles.prefRowText}>
            <Text style={styles.prefRowLabel}>{STRINGS.nudgeToggleLabel}</Text>
            <Text style={styles.prefRowHelper}>{STRINGS.nudgeToggleHelper}</Text>
          </View>
          <TouchableOpacity
            style={[styles.prefPill, prefs?.nudgeEnabled && styles.prefPillOn]}
            onPress={() => savePrefs({ nudgeEnabled: !prefs?.nudgeEnabled })}
          >
            <Text style={[styles.prefPillText, prefs?.nudgeEnabled && styles.prefPillTextOn]}>
              {prefs?.nudgeEnabled ? 'on' : 'off'}
            </Text>
          </TouchableOpacity>
        </View>

        {prefs?.nudgeEnabled && (
          <>
            <Text style={[styles.subLabel, styles.prefCardInlineLabel]}>{STRINGS.nudgeTimeLabel}</Text>
            <View style={styles.chipRow}>
              {NUDGE_TIME_OPTIONS.map((option) => {
                const selected = option.time === prefs.nudgeTime;
                return (
                  <TouchableOpacity
                    key={option.label}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => savePrefs({ nudgeTime: option.time })}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.prefRowHelper}>{STRINGS.nudgeTimeHelper}</Text>
          </>
        )}
      </View>

      <View style={[styles.prefRow, styles.sectionSpacing]}>
        <View style={styles.prefRowText}>
          <Text style={styles.prefRowLabel}>{STRINGS.friendNudgeToggleLabel}</Text>
          <Text style={styles.prefRowHelper}>{STRINGS.friendNudgeToggleHelper}</Text>
        </View>
        <TouchableOpacity
          style={[styles.prefPill, prefs?.friendNudgeEnabled && styles.prefPillOn]}
          onPress={() => savePrefs({ friendNudgeEnabled: !prefs?.friendNudgeEnabled })}
        >
          <Text style={[styles.prefPillText, prefs?.friendNudgeEnabled && styles.prefPillTextOn]}>
            {prefs?.friendNudgeEnabled ? 'on' : 'off'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.prefRow, styles.sectionSpacing]}>
        <View style={styles.prefRowText}>
          <Text style={styles.prefRowLabel}>{STRINGS.digestToggleLabel}</Text>
          <Text style={styles.prefRowHelper}>{STRINGS.digestToggleHelper}</Text>
        </View>
        <TouchableOpacity
          style={[styles.prefPill, prefs?.digestEnabled && styles.prefPillOn]}
          onPress={() => savePrefs({ digestEnabled: !prefs?.digestEnabled })}
        >
          <Text style={[styles.prefPillText, prefs?.digestEnabled && styles.prefPillTextOn]}>
            {prefs?.digestEnabled ? 'on' : 'off'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.prefCard, styles.sectionSpacing]}>
        <Text style={styles.prefRowLabel}>{STRINGS.quietHoursLabel}</Text>
        <Text style={styles.prefRowHelper}>{STRINGS.quietHoursHelper}</Text>

        <Text style={[styles.subLabel, styles.prefCardInlineLabel]}>{STRINGS.quietHoursFromLabel}</Text>
        <View style={styles.chipRow}>
          {QUIET_START_OPTIONS.map((option) => {
            const selected = option.time === prefs?.quietStart;
            return (
              <TouchableOpacity
                key={option.label}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => savePrefs({ quietStart: option.time })}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.subLabel, styles.prefCardInlineLabel]}>{STRINGS.quietHoursUntilLabel}</Text>
        <View style={styles.chipRow}>
          {QUIET_END_OPTIONS.map((option) => {
            const selected = option.time === prefs?.quietEnd;
            return (
              <TouchableOpacity
                key={option.label}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => savePrefs({ quietEnd: option.time })}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {blockedPeople.length > 0 && (
        <>
          <Text style={[styles.label, styles.sectionSpacing]}>{STRINGS.blockedPeopleSectionLabel}</Text>
          <View style={styles.prefCard}>
            {blockedPeople.map((person) => (
              <View key={person.blockedId} style={styles.blockedRow}>
                <Text style={styles.blockedRowName}>{person.name}</Text>
                <TouchableOpacity onPress={() => handleUnblock(person.blockedId)} disabled={unblockingId === person.blockedId}>
                  <Text style={styles.blockedRowUnblock}>
                    {unblockingId === person.blockedId ? '…' : STRINGS.unblockCta}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </>
      )}

      <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>

      <MessageDialog
        visible={savedNotice}
        title="saved"
        message="your name has been updated"
        onDismiss={() => setSavedNotice(false)}
      />
      <MessageDialog
        visible={!!error}
        title="hmm"
        message={error ?? ''}
        onDismiss={() => setError(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  content: {
    padding: 20,
    paddingBottom: 64,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 24,
    color: colors.ink,
    marginBottom: 20,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.green,
    marginBottom: 8,
  },
  photoWrap: {
    alignSelf: 'center',
    width: 84,
    height: 84,
    marginBottom: 8,
  },
  photoBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.gold,
    borderWidth: 3,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBadgeText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.ink,
    lineHeight: 16,
  },
  photoHint: {
    fontSize: 11.5,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 20,
  },
  sectionSpacing: {
    marginTop: 28,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
    color: colors.ink,
    marginBottom: 10,
  },
  saveButton: {
    backgroundColor: colors.gold,
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: 'center',
  },
  birthdayWhy: {
    fontSize: 12.5,
    color: colors.muted,
    lineHeight: 17,
    marginTop: -4,
    marginBottom: 14,
  },
  birthdaySaveButton: {
    marginTop: 16,
  },
  birthdayToggleRow: {
    marginTop: 14,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.ink,
  },
  subLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 6,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    gap: 12,
    ...cardShadow,
  },
  // A card that holds more than one row of content (a toggle plus its
  // own time chips, or quiet hours' from/until chips) — same surface
  // treatment as prefRow, but stacks vertically instead of being the
  // row itself.
  prefCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    ...cardShadow,
  },
  prefToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  // Same gap as the nudge card's own "remind me" label-to-chips rhythm
  // (subLabel's marginBottom) — used for every inline chip-row label
  // inside a prefCard (remind me, from, until).
  prefCardInlineLabel: {
    marginTop: 14,
  },
  prefRowText: {
    flex: 1,
  },
  blockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  blockedRowName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
  },
  blockedRowUnblock: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.green,
  },
  prefRowLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  prefRowHelper: {
    fontSize: 11.5,
    color: colors.muted,
    lineHeight: 16,
    marginTop: 2,
  },
  prefPill: {
    ...chipShape,
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  prefPillOn: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  prefPillText: {
    ...chipTextShape,
    color: colors.muted,
  },
  prefPillTextOn: {
    color: '#fff',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    ...chipShape,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  chipSelected: {
    backgroundColor: colors.greenSoft,
    borderColor: colors.green,
  },
  chipText: {
    ...chipTextShape,
    color: colors.muted,
  },
  chipTextSelected: {
    color: colors.green,
  },
  signOutButton: {
    marginTop: 28,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  signOutText: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.ink,
  },
});

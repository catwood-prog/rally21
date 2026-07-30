import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RemindersAskAlarmChoice, RemindersAskCard } from '@/components/RemindersAskCard';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { resolvePrefillAlarmTime, syncDailyReminder } from '@/lib/alarmReminder';
import { useAuth } from '@/lib/auth-context';
import { updateNotificationPrefs } from '@/lib/notifications';
import { markRemindersAskSeen, setAlarmReminder } from '@/lib/profile';
import { captureError } from '@/lib/sentry';

/** RM1 — onboarding step between profile and circle-setup, shown once,
 * ever, per account (gated by hooks/use-onboarding-status.ts's
 * 'needs-reminders-ask' status). "Turn on reminders" leaves the existing
 * prefs defaults as they already are (nudge/digest already default true —
 * see notifications_foundations_schema.sql); "Maybe later" changes
 * nothing but the seen flag. Either way always continues to circle-setup,
 * since this step only ever exists in the gap between profile and
 * circle-setup.
 *
 * AL1 job 4 — the card now also carries the optional personal practice
 * time, so notifications are asked about ONCE. Worth knowing when reading
 * the prefill below: this step runs BEFORE circle-setup, so a brand-new
 * account is in no circles yet and the prefill rule's agree-branch can
 * never fire here — it correctly declines to guess and opens the picker
 * at 08:00. The rule is still called rather than hard-coded, because the
 * same card renders on Today for existing accounts, where circles exist. */
export default function RemindersAsk() {
  const router = useRouter();
  const { session } = useAuth();
  // NAV1 job 0 — the safe-area inset still applies without an AppHeader.
  const insets = useSafeAreaInsets();
  const [alarmPrefill, setAlarmPrefill] = useState<{ time: string; prefilled: boolean } | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web' || !session?.user) return;
    const userId = session.user.id;
    resolvePrefillAlarmTime(userId)
      .then(setAlarmPrefill)
      .catch((e) => {
        // FF1 — the prefill is a courtesy, and its failure branch is the
        // rule's own no-guess branch: the card falls back to its 08:00
        // default. Reported so a persistently failing read is visible;
        // never surfaced, because nothing about this ask is broken.
        captureError(e, { screen: 'onboarding/reminders', op: 'resolvePrefillAlarmTime' });
      });
  }, [session?.user?.id]);

  const finish = () => {
    router.replace('/onboarding/circle-setup');
  };

  const handleTurnOn = async (alarm: RemindersAskAlarmChoice) => {
    if (!session?.user) return finish();
    const userId = session.user.id;
    await Promise.all([
      updateNotificationPrefs(userId, { nudgeEnabled: true, digestEnabled: true }),
      markRemindersAskSeen(userId),
      // Only written when they actually turned the row on — the personal
      // reminder is opt-in inside an opt-in, never a rider on the CTA.
      alarm.enabled ? setAlarmReminder(userId, alarm) : Promise.resolve(),
    ]);
    if (alarm.enabled) {
      // The turn-it-on tap IS the earned moment, so this is the one place
      // in the reminder's life that may ask the OS for permission.
      await syncDailyReminder({ enabled: true, alarmTime: alarm.time, requestPermission: true });
    }
    finish();
  };

  const handleMaybeLater = async () => {
    if (!session?.user) return finish();
    await markRemindersAskSeen(session.user.id);
    finish();
  };

  return (
    <View style={styles.container}>
      {/* NAV1: every onboarding step gets a visible way back to its
          previous step — profile stays editable, so backing into it is
          harmless (this step's one-shot flag only marks on continue). */}
      <TouchableOpacity
        style={[styles.back, { top: 20 + insets.top }]}
        onPress={() => router.push('/onboarding/profile')}
      >
        <Text style={styles.backText}>{STRINGS.backLink}</Text>
      </TouchableOpacity>
      {/* OD1 job 17a — the ask was a non-scrolling centred card, so at
          large Dynamic Type the bell, the headline, the CTA and "maybe
          later" competed for one viewport and the bottom of the stack
          became unreachable. The back-link is absolutely positioned
          against the screen and deliberately stays outside the scroll.
          Only the real insets are added, so web is unchanged (17d). */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <RemindersAskCard
          variant="full"
          onTurnOn={handleTurnOn}
          onMaybeLater={handleMaybeLater}
          alarmPrefillTime={alarmPrefill?.time}
          alarmPrefilled={alarmPrefill?.prefilled}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  back: {
    position: 'absolute',
    left: 24,
    zIndex: 1,
    // SO1 (27 July) — the 44px target OD1 job 13 left owed on family C.
    // These float at a per-screen `top` with no flow to preserve, so the
    // box just grows from 32 to 44 (14 + 16 + 14) and marginTop hands the
    // 6px back upward, leaving the link's text exactly where it was.
    // hitSlop is not the mechanism: RNW 0.21.2 does not implement it.
    paddingVertical: 14,
    marginTop: -6,
  },
  backText: {
    fontSize: 13,
    // Pinned so the -6 above is exact on every platform — an unset
    // lineHeight resolves to ~1.2em on RNW and to their own metrics on
    // iOS and Android: three answers, three different offsets.
    lineHeight: 16,
    fontWeight: '600',
    color: colors.mutedStrong,
  },
});

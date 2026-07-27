import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RemindersAskCard } from '@/components/RemindersAskCard';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { updateNotificationPrefs } from '@/lib/notifications';
import { markRemindersAskSeen } from '@/lib/profile';

/** RM1 — onboarding step between profile and circle-setup, shown once,
 * ever, per account (gated by hooks/use-onboarding-status.ts's
 * 'needs-reminders-ask' status). "Turn on reminders" leaves the existing
 * prefs defaults as they already are (nudge/digest already default true —
 * see notifications_foundations_schema.sql); "Maybe later" changes
 * nothing but the seen flag. Either way always continues to circle-setup,
 * since this step only ever exists in the gap between profile and
 * circle-setup. */
export default function RemindersAsk() {
  const router = useRouter();
  const { session } = useAuth();
  // NAV1 job 0 — the safe-area inset still applies without an AppHeader.
  const insets = useSafeAreaInsets();

  const finish = () => {
    router.replace('/onboarding/circle-setup');
  };

  const handleTurnOn = async () => {
    if (!session?.user) return finish();
    await Promise.all([
      updateNotificationPrefs(session.user.id, { nudgeEnabled: true, digestEnabled: true }),
      markRemindersAskSeen(session.user.id),
    ]);
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
        <Text style={styles.backText}>← back</Text>
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
        <RemindersAskCard variant="full" onTurnOn={handleTurnOn} onMaybeLater={handleMaybeLater} />
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
    color: colors.muted,
  },
});

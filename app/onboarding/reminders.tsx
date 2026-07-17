import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
      <RemindersAskCard variant="full" onTurnOn={handleTurnOn} onMaybeLater={handleMaybeLater} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
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
});

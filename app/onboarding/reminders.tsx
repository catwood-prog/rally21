import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

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
      <RemindersAskCard variant="full" onTurnOn={handleTurnOn} onMaybeLater={handleMaybeLater} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});

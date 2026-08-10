import { Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Brandmark } from '@/components/Brandmark';
import { WarmOpen } from '@/components/WarmOpen';
import { colors } from '@/constants/theme';
import { useOnboardingStatus } from '@/hooks/use-onboarding-status';
import { useAuth } from '@/lib/auth-context';
import { takePendingInviteCode } from '@/lib/invite-link';

export default function Index() {
  const { session, isLoading: isAuthLoading } = useAuth();
  const { status } = useOnboardingStatus();
  const [warmOpenDone, setWarmOpenDone] = useState(false);

  /**
   * IL3 (10 Aug) — WHERE AN INVITE CODE LANDS FOR SOMEONE WHO ALREADY HAS
   * AN ACCOUNT, which until now was nowhere at all.
   *
   * `app/j/[code].tsx` saves the code on tap and hands off to /sign-in.
   * Its only reader was circle-setup's day-zero branch, and an existing
   * account never reaches that screen — line 30 below sent it straight to
   * Today. So the code was written to storage and never read, and the
   * invite link worked ONLY for people who had never used Rally21 while
   * failing silently for everyone who had: no error, no message, they
   * landed on Today and assumed they'd done it wrong.
   *
   * This is the arrival every RETURNING account passes through, and
   * circle-setup is still the arrival every COLD one passes through
   * (profile.tsx replaces straight there and never comes back via "/",
   * so a single reader here would strand every new signup instead).
   * Both now read through the same freshness-stamped helper, which is
   * what lets the day-zero guard stay where it is correct: the guard was
   * never wrong about its hazard, it just had no way to tell a stale code
   * from one tapped thirty seconds ago. `takePendingInviteCode` can.
   *
   * Gated on 'ready' so a half-finished signup keeps its code for the
   * fork; ONE-SHOT via a ref rather than a cancel flag, because a
   * consumed code that gets discarded by an effect re-run is the same
   * silent loss this section exists to end.
   */
  const isReady = !!session && status === 'ready';
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [pendingChecked, setPendingChecked] = useState(false);
  const hasReadPending = useRef(false);

  useEffect(() => {
    if (!isReady || hasReadPending.current) return;
    hasReadPending.current = true;
    takePendingInviteCode().then((code) => {
      setPendingCode(code);
      setPendingChecked(true);
    });
  }, [isReady]);

  // Folded into the loading gate that is already on screen rather than
  // given a spinner of its own: this is a local storage read, it resolves
  // in the same beat, and it starts only once the two profile/membership
  // queries above it have already finished.
  if (isAuthLoading || (session && status === 'loading') || (isReady && !pendingChecked)) {
    return (
      <View style={styles.container}>
        <Brandmark size={33} style={styles.brandmark} />
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  if (!session) return <Redirect href="/splash" />;
  if (status === 'needs-profile') return <Redirect href="/onboarding/profile" />;
  if (status === 'needs-reminders-ask') return <Redirect href="/onboarding/reminders" />;
  if (status === 'needs-circle') return <Redirect href="/onboarding/circle-setup" />;
  // `fromToday` because this person HAS circles — status 'ready' means at
  // least one — so backing out of the join screen belongs on Today, not at
  // the setup fork a returning account has no business seeing.
  if (pendingCode) {
    return (
      <Redirect
        href={{ pathname: '/onboarding/join-circle', params: { code: pendingCode, fromToday: 'true' } }}
      />
    );
  }
  if (!warmOpenDone) return <WarmOpen onDone={() => setWarmOpenDone(true)} />;
  return <Redirect href="/today" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  brandmark: {
    marginBottom: 20,
  },
});

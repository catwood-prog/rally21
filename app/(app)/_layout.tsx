import { Redirect, Stack } from 'expo-router';

import { useNotificationDeepLink } from '@/hooks/use-notification-deep-link';
import { useOnboardingStatus } from '@/hooks/use-onboarding-status';
import { useAuth } from '@/lib/auth-context';

export default function AppLayout() {
  const { session, isLoading: isAuthLoading } = useAuth();
  const { status } = useOnboardingStatus();
  // EM1 job 2 — a tapped ember ask opens the cover flow. Called before
  // the guards below so the hook order never changes between renders,
  // and gated on the SAME condition those guards use: a tap must never
  // race a redirect to sign-in or to an unfinished onboarding step.
  useNotificationDeepLink(!!session && status === 'ready');

  if (isAuthLoading || (session && status === 'loading')) return null;
  if (!session) return <Redirect href="/sign-in" />;
  if (status === 'needs-profile') return <Redirect href="/onboarding/profile" />;
  if (status === 'needs-reminders-ask') return <Redirect href="/onboarding/reminders" />;
  if (status === 'needs-circle') return <Redirect href="/onboarding/circle-setup" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}

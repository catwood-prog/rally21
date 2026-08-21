import { Redirect, Stack, useSegments } from 'expo-router';

import { useNotificationDeepLink } from '@/hooks/use-notification-deep-link';
import { useOnboardingStatus } from '@/hooks/use-onboarding-status';
import { useAuth } from '@/lib/auth-context';
import { isNeedsCircleAllowedRoute } from '@/lib/onboardingRouteGuard';

export default function AppLayout() {
  const { session, isLoading: isAuthLoading } = useAuth();
  const { status } = useOnboardingStatus();
  // DA1 — read with the other hooks, above every early return, for the
  // same reason the deep-link hook is: the hook order must not change
  // between renders.
  const segments = useSegments();
  // EM1 job 2 — a tapped ember ask opens the cover flow. Called before
  // the guards below so the hook order never changes between renders,
  // and gated on the SAME condition those guards use: a tap must never
  // race a redirect to sign-in or to an unfinished onboarding step.
  useNotificationDeepLink(!!session && status === 'ready');

  if (isAuthLoading || (session && status === 'loading')) return null;
  if (!session) return <Redirect href="/sign-in" />;
  if (status === 'needs-profile') return <Redirect href="/onboarding/profile" />;
  if (status === 'needs-reminders-ask') return <Redirect href="/onboarding/reminders" />;
  // DA1 — the needs-circle redirect is NARROWED, not lifted: settings and
  // your-data (where account deletion lives) stay reachable without a
  // circle, and every other route in the group still goes to the fork.
  // See lib/onboardingRouteGuard.ts for why this route was unreachable.
  if (status === 'needs-circle' && !isNeedsCircleAllowedRoute(segments)) {
    return <Redirect href="/onboarding/circle-setup" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

import { Redirect, Stack } from 'expo-router';

import { useOnboardingStatus } from '@/hooks/use-onboarding-status';
import { useAuth } from '@/lib/auth-context';

export default function AppLayout() {
  const { session, isLoading: isAuthLoading } = useAuth();
  const { status } = useOnboardingStatus();

  if (isAuthLoading || (session && status === 'loading')) return null;
  if (!session) return <Redirect href="/sign-in" />;
  if (status === 'needs-profile') return <Redirect href="/onboarding/profile" />;
  if (status === 'needs-circle') return <Redirect href="/onboarding/circle-setup" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}

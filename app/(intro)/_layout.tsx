import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/lib/auth-context';

/** The pre-sign-in intro screens (splash, welcome, privacy promise) —
 * signed-in users never see these, even if they navigate here directly. */
export default function IntroLayout() {
  const { session, isLoading } = useAuth();

  if (isLoading) return null;
  if (session) return <Redirect href="/" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}

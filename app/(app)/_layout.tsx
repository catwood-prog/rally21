import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/lib/auth-context';

export default function AppLayout() {
  const { session, isLoading } = useAuth();

  if (isLoading) return null;
  if (!session) return <Redirect href="/sign-in" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}

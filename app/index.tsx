import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Brandmark } from '@/components/Brandmark';
import { colors } from '@/constants/theme';
import { useOnboardingStatus } from '@/hooks/use-onboarding-status';
import { useAuth } from '@/lib/auth-context';

export default function Index() {
  const { session, isLoading: isAuthLoading } = useAuth();
  const { status } = useOnboardingStatus();

  if (isAuthLoading || (session && status === 'loading')) {
    return (
      <View style={styles.container}>
        <Brandmark size={33} style={styles.brandmark} />
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;
  if (status === 'needs-profile') return <Redirect href="/onboarding/profile" />;
  if (status === 'needs-circle') return <Redirect href="/onboarding/circle-setup" />;
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

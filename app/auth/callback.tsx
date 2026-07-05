import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Brandmark } from '@/components/Brandmark';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

export default function AuthCallback() {
  const { session, isLoading } = useAuth();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 6000);
    return () => clearTimeout(timer);
  }, []);

  if (session) {
    // "/" carries the new-vs-returning-user routing logic
    return <Redirect href="/" />;
  }

  if (timedOut && !isLoading) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <View style={styles.container}>
      <Brandmark size={33} style={styles.brandmark} />
      <ActivityIndicator color={colors.green} />
      <Text style={styles.text}>signing you in…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    gap: 12,
  },
  brandmark: {
    marginBottom: 8,
  },
  text: {
    color: colors.muted,
    fontSize: 13,
  },
});

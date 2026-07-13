import { getQueryParams } from 'expo-auth-session/build/QueryParams';
import * as Linking from 'expo-linking';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';

import { Brandmark } from '@/components/Brandmark';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

// GN1 (13 July): web's Supabase client has detectSessionInUrl: true, so a
// tapped magic-link URL is picked up automatically. Native has
// detectSessionInUrl: false (there's no browser URL for it to read), so a
// rally21://auth/callback deep link needs to be turned into a session by
// hand here — this is Supabase's own documented native pattern verbatim:
// Linking.useLinkingURL() for the incoming URL, expo-auth-session's
// getQueryParams to pull tokens out of the query string OR hash fragment
// (magic links put them in the fragment), then setSession. Native OAuth
// (Apple/Google) never reaches this screen at all — both call
// signInWithIdToken directly and never redirect through a URL — so this
// path is magic-link-only, exactly as GN1's own prompt scoped it.
function useNativeDeepLinkSession() {
  const url = Linking.useLinkingURL();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web' || !url) return;
    const { params, errorCode } = getQueryParams(url);
    if (errorCode) {
      setError(errorCode);
      return;
    }
    const { access_token, refresh_token } = params;
    if (!access_token || !refresh_token) return;
    supabase.auth.setSession({ access_token, refresh_token }).then(({ error: sessionError }) => {
      if (sessionError) setError(sessionError.message);
    });
  }, [url]);

  return error;
}

export default function AuthCallback() {
  const { session, isLoading } = useAuth();
  const [timedOut, setTimedOut] = useState(false);
  const deepLinkError = useNativeDeepLinkSession();

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 6000);
    return () => clearTimeout(timer);
  }, []);

  if (deepLinkError) {
    return <Redirect href="/sign-in" />;
  }

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

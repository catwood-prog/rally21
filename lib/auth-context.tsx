import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { createContext, PropsWithChildren, useContext, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { getDeviceTimeZone } from './date';
import { markSeenNow } from './notifications';
import { supabase } from './supabase';

type AuthContextValue = {
  session: Session | null;
  isLoading: boolean;
  signInWithEmail: (email: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signInWithApple: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function getRedirectUrl() {
  if (Platform.OS === 'web') {
    return typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined;
  }
  return Linking.createURL('auth/callback');
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    supabase
      .from('users')
      .update({ timezone: getDeviceTimeZone() })
      .eq('id', session.user.id)
      .then(({ error }) => {
        if (error) console.warn('Could not save timezone:', error.message);
      });
    markSeenNow(session.user.id);
  }, [session?.user?.id]);

  // The social digest's suppression check depends on last_seen_at staying
  // fresh across the whole session, not just at sign-in — a user who signs
  // in once and returns to the tab hours later should still count as
  // "seen it" for anything queued in between (spec §2/§4).
  useEffect(() => {
    if (!session?.user) return;
    const userId = session.user.id;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') markSeenNow(userId);
    });
    return () => subscription.remove();
  }, [session?.user?.id]);

  const signInWithEmail = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: getRedirectUrl() },
    });
    return { error: error?.message ?? null };
  };

  // O1 (Google slice, 8/12 July) — web only, same redirect route and same
  // detectSessionInUrl pickup as the magic-link flow above; there is no
  // native build yet, so this never needs a platform branch. Live-verified
  // against the deployed project: an existing magic-link account signing
  // in with Google using the same (verified) email resolves to the SAME
  // user id via Supabase's automatic identity linking — never a duplicate.
  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: getRedirectUrl() },
    });
    return { error: error?.message ?? null };
  };

  // O1 (Apple slice, 12 July) — web only, same redirect route as Google.
  // Live-verified against the deployed project on disposable/throwaway
  // accounts: an existing email account signing in with Apple and choosing
  // "Share My Email" resolves to the SAME user id (auto-linking works when
  // the email actually matches). But Apple's "Hide My Email" gives a
  // private relay address that can never match an existing account — that
  // path was reproduced live and genuinely creates a disconnected duplicate
  // account, exactly as O1's own hard-rule warning predicted. There is no
  // account-merge feature yet (deferred to a follow-up prompt), so the
  // mitigation here is entirely preventive: signInAppleShareEmailHint on
  // the button, and onboardingAppleRescueLine on profile setup for any
  // brand-new Apple account. On the NATIVE iOS build, Sign in with Apple
  // must use the native sheet (expo-apple-authentication →
  // signInWithIdToken), never this web redirect — there is no native build
  // yet, so that path is GN1's job, not this one.
  const signInWithApple = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: getRedirectUrl() },
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ session, isLoading, signInWithEmail, signInWithGoogle, signInWithApple, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

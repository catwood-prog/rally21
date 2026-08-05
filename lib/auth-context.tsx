import type { Session } from '@supabase/supabase-js';
import { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import { createContext, PropsWithChildren, useContext, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { syncDailyReminder } from './alarmReminder';
import { getDeviceTimeZone } from './date';
import { markSeenNow } from './notifications';
import { getMyProfile } from './profile';
import { clearPushToken } from './pushNotifications';
import { captureError } from './sentry';
import { supabase } from './supabase';

// GN1 (13 July) — configured once at module load, not per sign-in attempt,
// matching the library's own documented usage. Google BLOCKS OAuth inside
// embedded webviews, so unlike Apple there's no web-redirect fallback to
// borrow from — the native library is the only way in on iOS. webClientId
// is the SAME client O1's web redirect flow already uses; Supabase's
// signInWithIdToken verifies the token's `aud` claim against whichever
// client id it came from, so both must stay registered on the Supabase
// side (already true — this reuses O1's existing web client, adds nothing
// new there).
if (Platform.OS !== 'web') {
  GoogleSignin.configure({
    iosClientId: '848724239201-3cd4s610pvlcog6cq81sp3urabeag4ob.apps.googleusercontent.com',
    webClientId: '848724239201-nasn5s5qtv36milsq9rrt8sp1ae2k91a.apps.googleusercontent.com',
  });
}

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
    // HY1 job 7 — FF1 rule 3, and the one that gates the whole app: until
    // this resolves, `isLoading` stays true and every screen sits on the
    // splash. A rejection here (an expired refresh token whose /token
    // call hits SUP1's 15s deadline is the realistic one) used to leave
    // it true FOREVER and surface as an unhandled rejection tagged with
    // whatever route was last open — which is the shape Sentry c726f818
    // has. Resolving to "signed out" is the honest failure: the sign-in
    // screen is a place a person can act from; a permanent splash is not.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
        setIsLoading(false);
      })
      .catch((e) => {
        captureError(e, { op: 'auth.getSession', at: 'app-start' });
        setIsLoading(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    // HY1 job 7 — both writes below are FIRE-AND-FORGET on the session,
    // which is right (neither is worth blocking a sign-in on), but
    // neither had a rejection handler at all, so a failure escaped the
    // React tree entirely as an unhandled rejection carrying whatever
    // screen the person happened to be on.
    //
    // FF1 rule 3 for both: silent for the USER, reported for us. A lost
    // timezone quietly sends every nudge and digest at the wrong hour,
    // and a lost last_seen_at makes the digest's suppression check think
    // someone never came back — two failures that are invisible from
    // inside the app by construction.
    //
    // `Promise.resolve(...)` around the builder is not decoration:
    // postgrest's query builder is a PromiseLike with `then` only — it
    // has no `.catch`, which is precisely why this one had no rejection
    // handler. Adopting it into a real promise gives it one.
    Promise.resolve(
      supabase.from('users').update({ timezone: getDeviceTimeZone() }).eq('id', session.user.id)
    )
      .then(({ error }) => {
        if (error) captureError(error, { op: 'saveTimezone', at: 'session-change' });
      })
      .catch((e: unknown) => captureError(e, { op: 'saveTimezone', at: 'session-change' }));
    markSeenNow(session.user.id).catch((e) =>
      captureError(e, { op: 'markSeenNow', at: 'session-change' })
    );
  }, [session?.user?.id]);

  // AL1 job 2 — reschedule the personal practice reminder at app start, so
  // a reinstall, an OS notification clear-out, or simply drifting past the
  // rolling window's far edge all recover on the next open. Idempotent by
  // construction (syncDailyReminder cancels and re-arms from scratch), and
  // a no-op on web and for the default-off account.
  //
  // NEVER PROMPTS: requestPermission is left false here, so this can only
  // ever schedule against a permission the person already granted at an
  // earned moment (PN1's law). A denied phone quietly schedules nothing.
  useEffect(() => {
    if (Platform.OS === 'web' || !session?.user) return;
    const userId = session.user.id;
    (async () => {
      const profile = await getMyProfile(userId);
      await syncDailyReminder({
        enabled: profile?.alarm_enabled ?? false,
        alarmTime: profile?.alarm_time ?? null,
      });
    })().catch((e) => {
      // FF1 — reported, not swallowed: the whole feature is invisible when
      // this fails (the person believes they have a reminder and never
      // gets one), and there is no other surface that would notice.
      // Silence for the USER is right — nothing here is worth a startup
      // error — but silence for us is not.
      captureError(e, { op: 'syncDailyReminder', at: 'app-start' });
    });
  }, [session?.user?.id]);

  // The social digest's suppression check depends on last_seen_at staying
  // fresh across the whole session, not just at sign-in — a user who signs
  // in once and returns to the tab hours later should still count as
  // "seen it" for anything queued in between (spec §2/§4).
  useEffect(() => {
    if (!session?.user) return;
    const userId = session.user.id;
    const subscription = AppState.addEventListener('change', (state) => {
      // HY1 job 7 — THE ONE THAT FIRES ON ANY SCREEN. This runs every
      // time the app comes back to the foreground, so it is the app's
      // most route-agnostic Supabase call and its rejections arrive
      // tagged with wherever the person happened to be. `markSeenNow`
      // awaits with no try/catch of its own (lib/notifications.ts), so
      // without this the whole thing floated. Reported, never surfaced:
      // a person reopening their phone must not be met with an error.
      if (state === 'active') {
        markSeenNow(userId).catch((e) =>
          captureError(e, { op: 'markSeenNow', at: 'app-foreground' })
        );
      }
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

  // O1 (Google slice, 8/12 July) — web redirect flow. Live-verified
  // against the deployed project: an existing magic-link account signing
  // in with Google using the same (verified) email resolves to the SAME
  // user id via Supabase's automatic identity linking — never a duplicate.
  //
  // GN1 (13 July) — native branch. Google blocks its own OAuth inside an
  // embedded webview, so the web redirect above can't be reused in the
  // native app at all — @react-native-google-signin/google-signin (the
  // library Supabase's own docs recommend) drives the real native account
  // picker instead, then hands the resulting ID token to the same
  // signInWithIdToken path Apple's native branch uses.
  const signInWithGoogle = async () => {
    if (Platform.OS !== 'web') {
      try {
        const response = await GoogleSignin.signIn();
        if (!isSuccessResponse(response)) {
          return { error: null }; // user cancelled — not a real error
        }
        const idToken = response.data.idToken;
        if (!idToken) {
          return { error: 'Google sign-in did not return a token — try again' };
        }
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        });
        return { error: error?.message ?? null };
      } catch (e) {
        if (isErrorWithCode(e) && e.code === statusCodes.SIGN_IN_CANCELLED) {
          return { error: null };
        }
        return { error: e instanceof Error ? e.message : 'Google sign-in failed — try again' };
      }
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: getRedirectUrl() },
    });
    return { error: error?.message ?? null };
  };

  // O1 (Apple slice, 12 July) — web redirect flow. Live-verified against
  // the deployed project on disposable/throwaway accounts: an existing
  // email account signing in with Apple and choosing "Share My Email"
  // resolves to the SAME user id (auto-linking works when the email
  // actually matches). But Apple's "Hide My Email" gives a private relay
  // address that can never match an existing account — that path was
  // reproduced live and genuinely creates a disconnected duplicate
  // account, exactly as O1's own hard-rule warning predicted. There is no
  // account-merge feature yet (deferred to a follow-up prompt), so the
  // mitigation here is entirely preventive: signInAppleShareEmailHint on
  // the button, and onboardingAppleRescueLine on profile setup for any
  // brand-new Apple account — both still apply on native.
  //
  // GN1 (13 July) — native branch. Apple REJECTS an in-app web-redirect
  // Apple sign-in (App Review guideline 4.8), so iOS uses the native
  // ASAuthorizationController sheet via expo-apple-authentication instead,
  // feeding the identity token straight to Supabase's signInWithIdToken —
  // no nonce needed (matching Supabase's own documented Expo/React Native
  // example verbatim; the web OIDC nonce dance doesn't apply here).
  // Apple's fullName is sent ONLY on a user's very first-ever authorization
  // for this app — signInWithIdToken doesn't populate user_metadata from
  // it the way the web redirect flow does (Supabase captures that from
  // Apple's own form POST, which a native token exchange never sees), so
  // it's bridged by hand into the same `full_name` field
  // initialNameFromSession (onboarding/profile.tsx) already reads — no
  // change needed there, this just feeds it the shape it already expects.
  const signInWithApple = async () => {
    if (Platform.OS !== 'web') {
      try {
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
        });
        if (!credential.identityToken) {
          return { error: 'Apple sign-in did not return a token — try again' };
        }
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
        });
        if (error) return { error: error.message };

        const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
          .filter(Boolean)
          .join(' ');
        if (fullName) {
          await supabase.auth.updateUser({ data: { full_name: fullName } });
        }
        return { error: null };
      } catch (e) {
        // The user dismissing Apple's own sheet isn't an error to surface.
        if (e && typeof e === 'object' && 'code' in e && e.code === 'ERR_REQUEST_CANCELED') {
          return { error: null };
        }
        return { error: e instanceof Error ? e.message : 'Apple sign-in failed — try again' };
      }
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: getRedirectUrl() },
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    // Must run before signOut() clears the session — the delete is
    // RLS-scoped to the caller's own row.
    //
    // FF1's highest-person-loss finding (FF2, 28 July): a swallowed failure
    // here leaves a SIGNED-OUT device still holding a live token, so the
    // account's pushes keep arriving on a phone nobody is signed in on. It
    // still must not block the sign-out — but it is reported, never silent.
    await clearPushToken().catch((e) => captureError(e, { op: 'clearPushToken' }));
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

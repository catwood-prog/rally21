import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { captureError } from './sentry';
import { supabase } from './supabase';

export type PushPermissionStatus = 'granted' | 'denied' | 'undetermined';

// Web has no APNs/FCM push path here (PN1 is iOS-only) — every function
// below is a safe no-op on web rather than gating the import itself,
// matching the existing GoogleSignin.configure() convention (lib/auth-
// context.tsx): the native module resolves fine at import time, only its
// calls are platform-guarded.
export async function getPushPermissionStatus(): Promise<PushPermissionStatus> {
  if (Platform.OS === 'web') return 'denied';
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

const LAST_TOKEN_KEY = 'rally21_push_token';

/** Requests the OS permission (a no-op UI-wise if already decided — iOS
 * itself only ever shows the real system dialog once, so calling this
 * repeatedly can never violate the "never re-prompt in a loop" rule) and,
 * if granted, registers this device's ExpoPushToken into device_tokens.
 *
 * PN2 (6 Aug) — THE TWO FAILURES HERE ARE NOT THE SAME FAILURE, and one
 * catch around both is what let a live account carry
 * `has_seen_push_prompt = true` with no device_tokens row and nobody
 * knowing. The token FETCH throwing is usually the iOS Simulator, which
 * has no real APNs credentials: expected, permanent in dev, and not worth
 * reporting. The UPSERT failing is OUR write failing on a real phone, and
 * that is FF1 rule 3 territory — silence for the person is still right
 * (nothing is broken at the check-in moment they are standing in), but
 * silence for US means a person who accepted push never receives one and
 * no surface anywhere could tell either of us. */
export async function registerForPushNotificationsAsync(userId: string): Promise<PushPermissionStatus> {
  if (Platform.OS === 'web') return 'denied';

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return status;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;

  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    token = result.data;
  } catch (e) {
    // FF1 rule 1 — silence is right, and this is the ONLY half of the old
    // catch it was ever right for: the simulator throws here on every
    // call, so reporting it would report our own dev environment forever.
    // A real phone failing here still ends up unregistered, which the
    // settings row now renders honestly as off (PN2 job 2) instead of on.
    console.warn('No push token available (simulator, or a transient error):', e);
    return status;
  }

  try {
    const { error } = await supabase
      .from('device_tokens')
      .upsert(
        { user_id: userId, token, platform: 'apns', last_seen_at: new Date().toISOString() },
        { onConflict: 'token' }
      );
    if (error) throw error;
    await AsyncStorage.setItem(LAST_TOKEN_KEY, token);
  } catch (e) {
    // FF1 rule 3 — REPORTED, never swallowed. Tags only: the user id says
    // WHOSE pipe is dead (the whole point — otherwise the report cannot
    // be acted on), the token itself never leaves the phone.
    captureError(e, { lib: 'pushNotifications', op: 'registerDeviceToken', userId });
  }
  return status;
}

/** PN2 — WOULD A NOTIFICATION ACTUALLY ARRIVE ON THIS DEVICE? The OS
 * permission answers a different question: 'granted' means the phone
 * would DISPLAY one, not that we hold a token to send one to. Answering
 * the real question needs both halves — the local marker naming the token
 * THIS device registered, and a live read proving that row still exists.
 *
 * The read is RLS-scoped twice over: the select policy on device_tokens is
 * `user_id = auth.uid()`, so it can only ever see the caller's own rows,
 * and the token filter narrows that to this device. A leftover marker from
 * another account on a shared phone therefore reads as NOT registered,
 * which is the conservative direction.
 *
 * A stale marker self-heals: send-notifications deletes a token APNs
 * rejects, so the next read here returns false, the pill flips to off, and
 * a tap re-registers.
 *
 * THROWS rather than substituting a value — the caller decides what an
 * unreadable answer renders as (FF2: 'unknown' never becomes a claim). */
export async function isThisDeviceRegisteredForPush(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const token = await AsyncStorage.getItem(LAST_TOKEN_KEY);
  if (!token) return false;
  const { data, error } = await supabase
    .from('device_tokens')
    .select('token')
    .eq('token', token)
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Removes THIS device's token on sign-out (not every token the user has
 * ever registered — a shared account could still be signed in elsewhere).
 * Must run before supabase.auth.signOut() clears the session, since the
 * delete is RLS-scoped to the caller's own row. */
export async function clearPushToken(): Promise<void> {
  const token = await AsyncStorage.getItem(LAST_TOKEN_KEY);
  if (!token) return;
  try {
    const { error } = await supabase.from('device_tokens').delete().eq('token', token);
    if (error) throw error;
  } finally {
    // FF1/FF2 — the local marker clears whether or not the row went: this
    // device is signing out either way, and a marker left pointing at a
    // token the next account's registration then overwrites is how one
    // failure cascades into a second. The delete failing is the caller's
    // to report (auth-context), never something the marker hides.
    await AsyncStorage.removeItem(LAST_TOKEN_KEY);
  }
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

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
 * The iOS Simulator has no real APNs credentials and throws fetching a
 * token — caught and treated as "permission granted, no token yet"
 * rather than crashing. */
export async function registerForPushNotificationsAsync(userId: string): Promise<PushPermissionStatus> {
  if (Platform.OS === 'web') return 'denied';

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return status;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const { error } = await supabase
      .from('device_tokens')
      .upsert(
        { user_id: userId, token, platform: 'apns', last_seen_at: new Date().toISOString() },
        { onConflict: 'token' }
      );
    if (error) throw error;
    await AsyncStorage.setItem(LAST_TOKEN_KEY, token);
  } catch (e) {
    console.warn('Could not register push token (simulator, or a transient error):', e);
  }
  return status;
}

/** Removes THIS device's token on sign-out (not every token the user has
 * ever registered — a shared account could still be signed in elsewhere).
 * Must run before supabase.auth.signOut() clears the session, since the
 * delete is RLS-scoped to the caller's own row. */
export async function clearPushToken(): Promise<void> {
  const token = await AsyncStorage.getItem(LAST_TOKEN_KEY);
  if (!token) return;
  await supabase.from('device_tokens').delete().eq('token', token);
  await AsyncStorage.removeItem(LAST_TOKEN_KEY);
}

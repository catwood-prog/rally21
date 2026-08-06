/**
 * PN2 job 1 — THE TWO FAILURES THAT WERE HIDING EACH OTHER.
 *
 * The live find: a native account carrying `has_seen_push_prompt = true`
 * with no `device_tokens` row. Registration had run and produced nothing,
 * and one `console.warn`-only catch around BOTH the token fetch and the
 * upsert is why nobody could have known. The simulator case is real, so
 * the catch was not wrong — it was too wide.
 *
 * These are the forced runs VERIFY step 2 asks for, not a reading of the
 * source: the upsert is made to fail (both ways it can — a PostgrestError
 * in the response, and a thrown one) and captureError is asserted to have
 * fired with the user id and WITHOUT the token; the simulator's thrown
 * token fetch is asserted to report nothing.
 *
 * Runs under jest-expo's default Platform.OS ('ios'). `lib/supabase`,
 * `lib/sentry`, AsyncStorage and expo-notifications are all mocked
 * globally in jest.setup.js.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import {
  isThisDeviceRegisteredForPush,
  registerForPushNotificationsAsync,
} from './pushNotifications';
import { captureError } from './sentry';
import { supabase } from './supabase';

const USER = '8174d14d-01d4-4371-8b3e-c0647ce2f23f';
const TOKEN = 'ExponentPushToken[pn2-forced-run]';
const TOKEN_KEY = 'rally21_push_token';

const notifications = Notifications as unknown as {
  requestPermissionsAsync: jest.Mock;
  getExpoPushTokenAsync: jest.Mock;
};
const mockedCaptureError = captureError as jest.Mock;
const mockedFrom = supabase.from as unknown as jest.Mock;

/** The chain shape `registerForPushNotificationsAsync` uses. */
function upsertReturning(result: { error: unknown }) {
  const upsert = jest.fn().mockResolvedValue(result);
  mockedFrom.mockReturnValue({ upsert });
  return upsert;
}

/** The chain shape `isThisDeviceRegisteredForPush` uses. */
function selectReturning(result: { data: { token: string }[] | null; error: unknown }) {
  const limit = jest.fn().mockResolvedValue(result);
  const eq = jest.fn(() => ({ limit }));
  const select = jest.fn(() => ({ eq }));
  mockedFrom.mockReturnValue({ select });
  return { select, eq, limit };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  notifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
  notifications.getExpoPushTokenAsync.mockResolvedValue({ data: TOKEN });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  (console.warn as jest.Mock).mockRestore();
});

describe('registerForPushNotificationsAsync — the upsert failing is OURS', () => {
  it('FORCED: a PostgrestError in the response is reported, with the user id and no token', async () => {
    const upsert = upsertReturning({
      error: { message: 'new row violates row-level security policy', code: '42501' },
    });

    const status = await registerForPushNotificationsAsync(USER);

    // The person sees nothing: no throw, and the caller (checkin-complete's
    // primer, settings' row) gets the permission answer it asked for.
    expect(status).toBe('granted');
    expect(upsert).toHaveBeenCalledTimes(1);

    // FF1 rule 3 — silence for us ENDS.
    expect(mockedCaptureError).toHaveBeenCalledTimes(1);
    const [error, context] = mockedCaptureError.mock.calls[0];
    expect(error).toMatchObject({ code: '42501' });
    expect(context).toEqual({
      lib: 'pushNotifications',
      op: 'registerDeviceToken',
      userId: USER,
    });
    // The token never leaves the phone in a report.
    expect(JSON.stringify(mockedCaptureError.mock.calls)).not.toContain(TOKEN);

    // And the local marker is NOT written, so the settings row cannot
    // later mistake this device for a registered one.
    expect(await AsyncStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('FORCED: a thrown upsert (network) is reported the same way', async () => {
    const upsert = jest.fn().mockRejectedValue(new Error('Network request failed'));
    mockedFrom.mockReturnValue({ upsert });

    const status = await registerForPushNotificationsAsync(USER);

    expect(status).toBe('granted');
    expect(mockedCaptureError).toHaveBeenCalledTimes(1);
    expect(mockedCaptureError.mock.calls[0][1]).toMatchObject({ op: 'registerDeviceToken' });
  });

  it('the happy path reports nothing and leaves the marker for this device', async () => {
    const upsert = upsertReturning({ error: null });

    expect(await registerForPushNotificationsAsync(USER)).toBe('granted');

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: USER, token: TOKEN, platform: 'apns' }),
      { onConflict: 'token' }
    );
    expect(mockedCaptureError).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(TOKEN_KEY)).toBe(TOKEN);
  });
});

describe('registerForPushNotificationsAsync — the token fetch failing is the SIMULATOR', () => {
  it('FORCED: a thrown token fetch reports nothing and never reaches the upsert', async () => {
    notifications.getExpoPushTokenAsync.mockRejectedValue(
      new Error('Fetching the token failed: no valid "aps-environment" entitlement string')
    );
    const upsert = upsertReturning({ error: null });

    expect(await registerForPushNotificationsAsync(USER)).toBe('granted');

    // The whole point of splitting the catch: this one stays quiet, and
    // it does not drag the write's failure into its silence.
    expect(mockedCaptureError).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('a refused permission never asks for a token at all', async () => {
    notifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });

    expect(await registerForPushNotificationsAsync(USER)).toBe('denied');

    expect(notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mockedCaptureError).not.toHaveBeenCalled();
  });
});

describe('isThisDeviceRegisteredForPush — the question the app never asked', () => {
  it('no local marker: not registered, and no query is spent asking', async () => {
    const { select } = selectReturning({ data: [], error: null });

    expect(await isThisDeviceRegisteredForPush()).toBe(false);
    expect(select).not.toHaveBeenCalled();
  });

  it('marker present and the row is live: registered', async () => {
    await AsyncStorage.setItem(TOKEN_KEY, TOKEN);
    const { eq, limit } = selectReturning({ data: [{ token: TOKEN }], error: null });

    expect(await isThisDeviceRegisteredForPush()).toBe(true);
    // Scoped to THIS device's token — RLS already scopes it to this user.
    expect(eq).toHaveBeenCalledWith('token', TOKEN);
    expect(limit).toHaveBeenCalledWith(1);
  });

  it('THE LIVE STATE: marker present, row gone — granted, and nothing would arrive', async () => {
    await AsyncStorage.setItem(TOKEN_KEY, TOKEN);
    selectReturning({ data: [], error: null });

    expect(await isThisDeviceRegisteredForPush()).toBe(false);
  });

  it('an unreadable answer THROWS rather than substituting one', async () => {
    await AsyncStorage.setItem(TOKEN_KEY, TOKEN);
    selectReturning({ data: null, error: { message: 'JWT expired' } });

    // FF2 — false here would render "off" for a person who is registered
    // fine; the caller turns this into 'unknown' and renders no row.
    await expect(isThisDeviceRegisteredForPush()).rejects.toMatchObject({
      message: 'JWT expired',
    });
  });
});

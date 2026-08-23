import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

/**
 * AK1 job 3 — the JS face of Rally21's AlarmKit binding, and the OUTER
 * half of the platform fence.
 *
 * THE FENCE IS THREE DEEP, deliberately, because AL1 job 4's precedent is
 * that a feature which does not exist on a platform must NOT EXIST there
 * rather than exist-but-fail:
 *   1. the module is built for `apple` only (expo-module.config.json), so
 *      on Android and web there is no native module to find at all;
 *   2. `requireOptionalNativeModule` returns null instead of throwing when
 *      it isn't there, so importing this file is safe everywhere —
 *      including in Jest and in the web bundle;
 *   3. `isAvailable()` is false on any iOS below 26 even though the module
 *      IS present, because AlarmKit itself is 26+.
 * The render layer adds a fourth (the control does not draw), and the
 * Swift adds a fifth (`#available` at every call).
 */

type NativeAlarmKit = {
  isAvailable: () => boolean;
  getAuthorizationState: () => Promise<AlarmAuthorizationState>;
  requestAuthorization: () => Promise<AlarmAuthorizationState>;
  scheduleWeeklyAlarm: (
    id: string,
    hour: number,
    minute: number,
    weekdays: number[],
    title: string,
    stopButtonText: string
  ) => Promise<void>;
  cancelAlarm: (id: string) => Promise<void>;
  listAlarmIds: () => Promise<string[]>;
};

export type AlarmAuthorizationState =
  | 'authorized'
  | 'denied'
  | 'notDetermined'
  | 'unavailable';

const native = requireOptionalNativeModule<NativeAlarmKit>('RallyAlarmKit');

/** The one error JS has to be able to tell apart (job 7). Matches the
 * Swift exception's class name, which is what ExpoModulesCore puts in the
 * thrown error's `code`. */
export const MAX_ALARMS_ERROR = 'ERR_MAX_ALARMS_REACHED';

/** True only where a real AlarmKit alarm can actually be scheduled:
 * native iOS 26+, with the module linked in. Everything else — web,
 * Android, iOS 15-25, Expo Go, Jest — is false, and every caller in the
 * app checks this before rendering a control or writing a row. */
export function isAlarmKitAvailable(): boolean {
  if (Platform.OS !== 'ios') return false;
  if (!native) return false;
  try {
    return native.isAvailable();
  } catch {
    return false;
  }
}

export async function getAuthorizationState(): Promise<AlarmAuthorizationState> {
  if (!isAlarmKitAvailable()) return 'unavailable';
  return native!.getAuthorizationState();
}

/** PN1's law: only ever called from the turn-it-ON tap, never on launch. */
export async function requestAuthorization(): Promise<AlarmAuthorizationState> {
  if (!isAlarmKitAvailable()) return 'unavailable';
  return native!.requestAuthorization();
}

/**
 * Arm (or re-arm) ONE recurring alarm. Scheduling an id that already
 * exists REPLACES it, which is what makes the whole-set recompute in
 * lib/circleAlarm.ts idempotent.
 *
 * `weekdays` uses JS `Date.getDay()` numbering, 0 = Sunday.
 */
export async function scheduleWeeklyAlarm(params: {
  id: string;
  hour: number;
  minute: number;
  weekdays: number[];
  title: string;
  stopButtonText: string;
}): Promise<void> {
  if (!isAlarmKitAvailable()) return;
  await native!.scheduleWeeklyAlarm(
    params.id,
    params.hour,
    params.minute,
    params.weekdays,
    params.title,
    params.stopButtonText
  );
}

export async function cancelAlarm(id: string): Promise<void> {
  if (!isAlarmKitAvailable()) return;
  await native!.cancelAlarm(id);
}

/** The system's own list, used to reconcile away alarms the database has
 * forgotten (a circle left while offline). */
export async function listAlarmIds(): Promise<string[]> {
  if (!isAlarmKitAvailable()) return [];
  return native!.listAlarmIds();
}

/** Job 7 — did iOS refuse because it will not hold another alarm? */
export function isMaxAlarmsError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  const message = e instanceof Error ? e.message : '';
  return code === MAX_ALARMS_ERROR || /maximumLimitReached/i.test(message);
}

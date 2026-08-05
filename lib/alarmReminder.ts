import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { STRINGS } from '@/constants/strings';

import { getLocalDateString } from './date';
import { supabase } from './supabase';

/**
 * AL1 phase 1 — the reminder at a time you CHOOSE.
 *
 * ONE per PERSON per day, whatever their circle count (users.alarm_enabled
 * / users.alarm_time, not memberships — Cat's ruling, 27 July). If you
 * find yourself writing per-circle scheduling or a coalescing pass in
 * here, stop: you have drifted off the shape this feature was ruled into.
 *
 * LOCAL, not push: no server, no outbox, no edge function, and it works
 * with the phone in flight mode. The one server-side consequence of the
 * feature lives in compose-nudges (the HOLD, AL1 job 3), and it reads the
 * same two columns rather than talking to this file.
 *
 * NEVER CALLED AN ALARM in copy, because it cannot behave like one: only
 * Apple's Clock app rings through a silenced iPhone. This is a scheduled
 * local notification with sound. Breaking through Focus modes needs the
 * time-sensitive entitlement, which is a NATIVE change and therefore AL1
 * phase 2 / build 10 — deliberately not here.
 *
 * WHY A ROLLING WINDOW OF ONE-SHOTS, and not the DAILY repeating trigger.
 * The daily trigger never lapses, which is its whole appeal, but neither
 * iOS nor expo-notifications can cancel a SINGLE occurrence of it — and
 * "cancel today's the moment they check in" is the rule that keeps this
 * feature from becoming the fastest way to get notifications turned off.
 * Cancelling and re-arming the daily trigger cannot express "skip today,
 * resume tomorrow" either, since its next fire is still today. So the
 * backbone is REMINDER_WINDOW_DAYS one-shot DATE triggers, topped back up
 * on every app start, on every preference change, and after every
 * check-in. THE COST, stated rather than hidden: someone who does not
 * open Rally21 at all for REMINDER_WINDOW_DAYS consecutive days stops
 * getting the local reminder until they next open it, at which point it
 * self-heals in full. RS1's rejoin email is the surface that exists for
 * that person; a reminder is not.
 *
 * The window sits well inside iOS's 64-pending-local-notification ceiling
 * (this is the app's only local scheduling — everything else is remote
 * push through PN1's outbox), so a top-up can never silently evict.
 */

/** Days of reminders kept armed ahead. See the file header for the
 * tradeoff this number expresses. */
export const REMINDER_WINDOW_DAYS = 30;

/** Tags our own scheduled notifications so a cancel pass can tell them
 * apart from anything else that ever gets scheduled locally. */
export const REMINDER_DATA_TYPE = 'al1_daily_reminder';

/** The local date whose reminder a check-in already cancelled. Local, not
 * a column: it is a fact about THIS device's schedule, and keeping it on
 * the device means the check-in cancel path costs no network and works
 * offline like the rest of the feature. Self-expiring — tomorrow it
 * simply stops matching today. */
const SKIP_DATE_KEY = 'rally21_reminder_skip_date';

export type ReminderSlot = { localDate: string; fireAt: Date };

export type ReminderSyncResult = 'scheduled' | 'off' | 'permission-denied' | 'unsupported';

/** "HH:MM" or "HH:MM:SS" (Postgres `time`) into components. Null for
 * anything that isn't a real time of day, so a corrupt value can never be
 * turned into a notification at some arbitrary hour. */
export function parseTimeOfDay(value: string | null | undefined): { hour: number; minute: number } | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** Components back to the "HH:MM:00" shape Postgres `time` round-trips. */
export function formatTimeOfDay(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

/** The human form, for labels and helper copy: "8:00am", "9:30pm",
 * "12:00am". Deliberately 12-hour and lowercase-suffixed to match how the
 * rest of the app writes times to people (settings' quiet-hours chips read
 * "8pm", "6am"). Returns null for anything unparseable, so a caller never
 * renders half a sentence around a missing time. */
export function formatTimeForDisplay(value: string | null | undefined): string | null {
  const parsed = parseTimeOfDay(value);
  if (!parsed) return null;
  const suffix = parsed.hour < 12 ? 'am' : 'pm';
  const hour12 = parsed.hour % 12 === 0 ? 12 : parsed.hour % 12;
  return `${hour12}:${String(parsed.minute).padStart(2, '0')}${suffix}`;
}

/**
 * THE PREFILL RULE (AL1 job 1). When someone turns the reminder on, look
 * at circles.time_of_day across the circles they are currently in. If
 * every one of them agrees, prefill that time. If they disagree, or they
 * are in none, do NOT guess — the caller opens the picker unprefilled at
 * PREFILL_FALLBACK_TIME and lets them choose.
 *
 * A circle with no declared time is not agreement, so it forces the
 * no-guess branch too: "some of your circles say 8am and the rest say
 * nothing" is exactly the ambiguity the rule exists to refuse.
 */
export function prefillAlarmTime(circleTimesOfDay: (string | null)[]): string | null {
  if (circleTimesOfDay.length === 0) return null;
  if (circleTimesOfDay.some((t) => !t)) return null;
  const first = circleTimesOfDay[0] as string;
  if (!circleTimesOfDay.every((t) => t === first)) return null;
  const parsed = parseTimeOfDay(first);
  return parsed ? formatTimeOfDay(parsed.hour, parsed.minute) : null;
}

/** Where the picker opens when the prefill rule declines to guess. */
export const PREFILL_FALLBACK_TIME = '08:00:00';

/**
 * The prefill rule against the live data, in one place so the three
 * surfaces that turn the reminder on (settings, the onboarding ask,
 * Today's compact ask) cannot drift into three different guesses.
 *
 * Returns the agreed time, or PREFILL_FALLBACK_TIME when the circles
 * disagree or there are none — and `prefilled` says which happened, so a
 * caller can tell the person we started them somewhere for a reason
 * instead of silently presenting 08:00 as if it were their idea.
 *
 * ACTIVE, UNFINISHED circles only: a warmly-archived completed circle
 * (Rally21-Glow-Spec.md §8) is history, and history should not vote on
 * when you practise tomorrow.
 */
export async function resolvePrefillAlarmTime(
  userId: string
): Promise<{ time: string; prefilled: boolean }> {
  const { data, error } = await supabase
    .from('memberships')
    .select('circles!inner(time_of_day, is_active, completed_at)')
    .eq('user_id', userId)
    .eq('circles.is_active', true)
    .is('circles.completed_at', null)
    // supabase-js types an embedded relation as an array regardless of its
    // cardinality; this one is to-one and arrives as an object, so the row
    // shape is declared here the same way listMyCircles declares its own.
    .returns<{ circles: { time_of_day: string | null } | null }[]>();

  if (error) throw error;

  const times = (data ?? []).map((row) => row.circles?.time_of_day ?? null);
  const agreed = prefillAlarmTime(times);
  return agreed ? { time: agreed, prefilled: true } : { time: PREFILL_FALLBACK_TIME, prefilled: false };
}

/**
 * The exact instants to arm, given the preference and the moment we are
 * asked. Pure, so the whole schedule/reschedule/cancel story is unit
 * tested without a notification module in sight.
 *
 * Built from local wall-clock components (`new Date(y, m, d + n, h, min)`)
 * rather than millisecond arithmetic, so a day that is 23 or 25 hours long
 * across a DST boundary still fires at the hour the person chose.
 */
export function buildReminderPlan(params: {
  enabled: boolean;
  alarmTime: string | null;
  now: Date;
  /** True when today's reminder has already been cancelled by a check-in
   * (or would be redundant for any other reason the caller knows). */
  skipToday?: boolean;
  windowDays?: number;
}): ReminderSlot[] {
  const time = parseTimeOfDay(params.alarmTime);
  if (!params.enabled || !time) return [];

  const windowDays = params.windowDays ?? REMINDER_WINDOW_DAYS;
  const { now } = params;
  const slots: ReminderSlot[] = [];

  for (let offset = 0; offset < windowDays; offset++) {
    const fireAt = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
      time.hour,
      time.minute,
      0,
      0
    );
    if (offset === 0) {
      // Today's slot is dropped when it has already passed (the OS would
      // refuse a past date anyway) and when a check-in has already made
      // it unwanted. Every later day is unconditional.
      if (params.skipToday || fireAt.getTime() <= now.getTime()) continue;
    }
    slots.push({ localDate: getLocalDateString(fireAt), fireAt });
  }

  return slots;
}

/** The device-local marker read by syncDailyReminder to keep a
 * post-check-in top-up from re-arming the day it just cancelled. */
// HY1 job 2 (R7) — module-private: syncDailyReminder in this file is
// the only reader, and the marker is an internal detail of it.
async function getReminderSkipDate(): Promise<string | null> {
  return AsyncStorage.getItem(SKIP_DATE_KEY);
}

async function cancelAllOurs(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => (n.content?.data as { type?: string } | undefined)?.type === REMINDER_DATA_TYPE)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
  );
}

/**
 * Android 8+ drops a notification with no channel, and a channel's
 * importance is what decides whether it makes a sound at all — so the
 * channel is part of "schedule it with sound", not decoration. iOS ignores
 * channels entirely and takes its sound from the content.
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(REMINDER_DATA_TYPE, {
    name: STRINGS.alarmReminderChannelName,
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  });
}

/**
 * Bring the device's scheduled reminders in line with the preference.
 * Idempotent — it cancels every reminder it previously armed and re-arms
 * the window from scratch, so "the time changed", "the toggle changed",
 * "the app started" and "they just checked in" are all the same call.
 *
 * PERMISSION IS ONLY EVER REQUESTED AT AN EARNED MOMENT (PN1's law):
 * `requestPermission` defaults to false so the app-start call can never
 * cold-prompt, and only the explicit turn-it-on tap passes true.
 */
export async function syncDailyReminder(params: {
  enabled: boolean;
  alarmTime: string | null;
  requestPermission?: boolean;
  now?: Date;
}): Promise<ReminderSyncResult> {
  // Local scheduled notifications are native-only. On web the feature does
  // not exist rather than existing-but-broken (AL1 job 4) — no control
  // renders there, and this is the belt-and-braces half of that.
  if (Platform.OS === 'web') return 'unsupported';

  await cancelAllOurs();

  const now = params.now ?? new Date();
  const skipDate = await getReminderSkipDate();
  const plan = buildReminderPlan({
    enabled: params.enabled,
    alarmTime: params.alarmTime,
    now,
    skipToday: skipDate === getLocalDateString(now),
  });

  if (plan.length === 0) return 'off';

  const { status } = params.requestPermission
    ? await Notifications.requestPermissionsAsync()
    : await Notifications.getPermissionsAsync();
  if (status !== 'granted') return 'permission-denied';

  await ensureAndroidChannel();

  for (const slot of plan) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: STRINGS.alarmReminderTitle,
        body: STRINGS.alarmReminderBody,
        sound: 'default',
        data: { type: REMINDER_DATA_TYPE, localDate: slot.localDate },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: slot.fireAt,
        channelId: REMINDER_DATA_TYPE,
      },
    });
  }

  return 'scheduled';
}

/**
 * Cancel TODAY'S reminder, because the person just checked in.
 *
 * DECIDED, and it is deliberate rather than an oversight: ONE check-in
 * cancels the day's reminder even for someone with three circles still
 * open. The reminder is one personal prompt to practise, not a per-circle
 * chase — compose-nudges' held nudge (AL1 job 3) is what covers the rest
 * of the day. Do not "improve" this into per-circle tracking.
 *
 * The marker is written before the cancel so a failure to reach the
 * notification module still leaves the next sync knowing today is spoken
 * for; the reverse order could re-arm a reminder for a day already done.
 */
export async function cancelTodaysReminder(now: Date = new Date()): Promise<void> {
  if (Platform.OS === 'web') return;
  const today = getLocalDateString(now);
  await AsyncStorage.setItem(SKIP_DATE_KEY, today);
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => {
        const data = n.content?.data as { type?: string; localDate?: string } | undefined;
        return data?.type === REMINDER_DATA_TYPE && data?.localDate === today;
      })
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
  );
}

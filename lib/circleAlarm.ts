import {
  cancelAlarm,
  getAuthorizationState,
  isAlarmKitAvailable,
  isMaxAlarmsError,
  listAlarmIds,
  requestAuthorization,
  scheduleWeeklyAlarm,
  type AlarmAuthorizationState,
} from '@/modules/rally-alarm-kit';

import { getLocalDateString } from './date';
import { captureError } from './sentry';
import { supabase } from './supabase';
import { STRINGS } from '@/constants/strings';

/**
 * AK1 — A REAL ALARM, PER CIRCLE, OPT-IN (Cat's rulings, 8 Aug).
 *
 * THIS IS NOT AL1. AL1 phase 1 (lib/alarmReminder.ts) is ONE personal
 * LOCAL NOTIFICATION per calendar day, user-level, and it is untouched by
 * everything in this file — different columns, different scheduler,
 * different copy law. This is Apple's AlarmKit: a real alarm that rings
 * through Silent AND Focus, per circle, default off. Because it genuinely
 * IS an alarm it is CALLED one in copy; AL1's never-say-alarm rule does
 * not carry across.
 *
 * THE ALARM ID IS THE MEMBERSHIP ID. Not a random UUID we would then have
 * to store and keep in step: the membership row is exactly the thing the
 * alarm belongs to, it already has a stable uuid, and it disappears when
 * the person leaves. That makes reconciliation possible with no local
 * bookkeeping at all — the system's alarm list and the database's
 * membership list are directly comparable.
 *
 * THE INVARIANT, and it is what makes suppression safe: THE FULL WEEKDAY
 * SET IS RECOMPUTED FROM SCRATCH AND RE-ARMED on every app start, every
 * preference change and after every check-in. AlarmKit cannot skip a
 * single occurrence (Apple: cancel "deletes the alarm from the system even
 * if the alarm has a repeating schedule"), so "already checked in today"
 * is expressed by REMOVING TODAY'S WEEKDAY from the recurrence set — never
 * by cancelling and re-arming, which would still fire today, and never by
 * falling back to one-shots, which would reintroduce the 90-alarm trap.
 *
 * WHY THE TRAP CANNOT SPRING HERE, stated because it is the single most
 * important property in the section. Suppression reads ONLY today's
 * check-ins; nothing accumulates. So the set computed for a person with
 * perfect adherence loses exactly one weekday — today's — and tomorrow's
 * recompute puts it back and takes a different one. Seven days of perfect
 * adherence therefore leaves a SIX-day set every single day, never an
 * empty one. If a future edit ever makes suppression cumulative, the most
 * consistent user in the app silently loses every alarm, which is the
 * warmth laws inverted. circleAlarm.test.ts pins this.
 *
 * THE FAILURE MODE WE DO ACCEPT, stated rather than hidden: somebody who
 * checks in and then never opens Rally21 again keeps missing THAT ONE
 * WEEKDAY while every other day still fires. It is bounded and
 * self-announcing — the feature visibly keeps working, so there is a
 * reason to open the app, which is what restores it. Compare AL1's rolling
 * window, which fails to TOTAL silence after 30 quiet days.
 */

/** JS `Date.getDay()` numbering, 0 = Sunday, handed straight to the native
 * module so there is no boundary arithmetic to get wrong. */
export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export type CircleAlarmMembership = {
  /** The membership row id — and therefore the alarm id. */
  membershipId: string;
  circleId: string;
  circleName: string;
  alarmEnabled: boolean;
  /** 'HH:MM:SS' or 'HH:MM'. */
  alarmTime: string | null;
  /** PA2 — a finished member is off the active roster and gets no alarm. */
  finishedAt: string | null;
  /** A completed or archived circle never rings again. */
  circleIsActive: boolean;
  circleCompletedAt: string | null;
};

export type CircleAlarmSlot = {
  alarmId: string;
  circleId: string;
  hour: number;
  minute: number;
  weekdays: number[];
  title: string;
};

export type CircleAlarmSyncResult =
  | 'scheduled'
  | 'off'
  | 'permission-denied'
  | 'unsupported';

/** Shared with AL1's parser in spirit but kept local: this file must not
 * import lib/alarmReminder, because the two features are deliberately
 * independent and an import would be the first thread of a merge. */
export function parseAlarmTime(
  value: string | null | undefined
): { hour: number; minute: number } | null {
  if (!value) return null;
  const m = /^(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/**
 * THE PURE PLANNER. Given every membership and the circles this person has
 * ALREADY checked into today, produce the exact set of alarms that should
 * exist right now. Pure and total — no clock reads beyond `now`, no
 * network, no native module — so the trap above is testable without a
 * device in sight, which is the whole point of splitting it out.
 */
export function buildCircleAlarmPlan(params: {
  memberships: CircleAlarmMembership[];
  /** circle_ids with at least one completion for the person TODAY. */
  checkedInCircleIdsToday: readonly string[];
  now: Date;
}): CircleAlarmSlot[] {
  const checkedIn = new Set(params.checkedInCircleIdsToday);
  const todayWeekday = params.now.getDay();
  const slots: CircleAlarmSlot[] = [];

  for (const m of params.memberships) {
    if (!m.alarmEnabled) continue;
    // Every one of these is a cancellation trigger in job 3's language:
    // the row still exists but must hold no alarm.
    if (m.finishedAt) continue;
    if (!m.circleIsActive) continue;
    if (m.circleCompletedAt) continue;

    const time = parseAlarmTime(m.alarmTime);
    // The check constraint makes "enabled with no time" unrepresentable in
    // the database, so reaching here means a corrupt read rather than a
    // real state. Drop the alarm rather than guess a time.
    if (!time) continue;

    const weekdays = checkedIn.has(m.circleId)
      ? ALL_WEEKDAYS.filter((d) => d !== todayWeekday)
      : [...ALL_WEEKDAYS];

    // Cannot happen with a 7-day base set minus one day, but if a future
    // edit ever narrows the base set, an empty recurrence must become a
    // CANCEL rather than a silently-armed one-shot (Apple's Recurrence has
    // no case that means "never" other than `never` itself).
    if (weekdays.length === 0) continue;

    slots.push({
      alarmId: m.membershipId,
      circleId: m.circleId,
      hour: time.hour,
      minute: time.minute,
      weekdays,
      title: STRINGS.circleAlarmTitle(m.circleName),
    });
  }

  return slots;
}

/** Read every membership this person holds, with the two AK1 columns. */
export async function readCircleAlarmMemberships(
  userId: string
): Promise<CircleAlarmMembership[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select(
      'id, circle_id, alarm_enabled, alarm_time, finished_at, circles!inner(name, is_active, completed_at)'
    )
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    membershipId: row.id as string,
    circleId: row.circle_id as string,
    circleName: (row.circles?.name as string | undefined) ?? 'your circle',
    alarmEnabled: row.alarm_enabled === true,
    alarmTime: (row.alarm_time as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    circleIsActive: row.circles?.is_active === true,
    circleCompletedAt: (row.circles?.completed_at as string | null) ?? null,
  }));
}

/** The one membership this circle's alarm card needs. Returns null when
 * the person is not (or no longer) a member. */
export async function readCircleAlarm(
  userId: string,
  circleId: string
): Promise<CircleAlarmMembership | null> {
  const all = await readCircleAlarmMemberships(userId);
  return all.find((m) => m.circleId === circleId) ?? null;
}

async function readCheckedInCircleIdsToday(userId: string, now: Date): Promise<string[]> {
  const { data, error } = await supabase
    .from('completions')
    .select('circle_id')
    .eq('user_id', userId)
    .eq('local_date', getLocalDateString(now));
  if (error) throw error;
  return (data ?? []).map((r: any) => r.circle_id as string);
}

/**
 * BRING THE DEVICE IN LINE WITH WHAT IS TRUE. Idempotent by construction:
 * it recomputes the whole plan, cancels every alarm the plan does not
 * contain, and re-arms every alarm it does. "The toggle changed", "the app
 * started", "they checked in" and "they left a circle" are all this one
 * call.
 *
 * NEVER REQUESTS PERMISSION (PN1's law). The app-start path must not be
 * able to cold-prompt, so this only ever schedules against permission the
 * person has already granted; the ASK lives in setCircleAlarm below, on
 * the turn-it-on tap.
 *
 * THE CANCEL PASS READS THE SYSTEM, not our own bookkeeping, which is what
 * makes it self-healing: an alarm whose membership vanished while the app
 * was offline is still in AlarmKit's list and is cancelled here.
 */
export async function syncCircleAlarms(params: {
  userId: string;
  now?: Date;
}): Promise<CircleAlarmSyncResult> {
  if (!isAlarmKitAvailable()) return 'unsupported';

  const now = params.now ?? new Date();
  const [memberships, checkedInCircleIdsToday] = await Promise.all([
    readCircleAlarmMemberships(params.userId),
    readCheckedInCircleIdsToday(params.userId, now),
  ]);

  const plan = buildCircleAlarmPlan({ memberships, checkedInCircleIdsToday, now });
  const planIds = new Set(plan.map((s) => s.alarmId));

  // Cancel first, so a device at its alarm ceiling frees a slot before we
  // ask for one (job 7's refusal is likelier when we are near the cap).
  const existing = await listAlarmIds();
  for (const id of existing) {
    if (!planIds.has(id)) await cancelAlarm(id);
  }

  if (plan.length === 0) return 'off';

  const state = await getAuthorizationState();
  if (state !== 'authorized') {
    return state === 'unavailable' ? 'unsupported' : 'permission-denied';
  }

  for (const slot of plan) {
    try {
      await scheduleWeeklyAlarm({
        id: slot.alarmId,
        hour: slot.hour,
        minute: slot.minute,
        weekdays: slot.weekdays,
        title: slot.title,
        stopButtonText: STRINGS.circleAlarmStopButton,
      });
    } catch (e) {
      // A refusal DURING a background re-arm cannot be shown to anyone —
      // there is no toggle being tapped — so it is reported and the rest
      // of the plan still gets armed. The toggle path (setCircleAlarm)
      // is where a refusal becomes a sentence a person reads.
      captureError(e, {
        op: 'syncCircleAlarms.schedule',
        circleId: slot.circleId,
        refusedForLimit: String(isMaxAlarmsError(e)),
      });
    }
  }

  return 'scheduled';
}

/**
 * The app-wide "something changed, make the phone true again" call.
 *
 * ALL THREE CANCELLATION TRIGGERS RUN THROUGH THIS ONE PATH rather than
 * three bespoke cancels, and that is deliberate: the alarm id IS the
 * membership id, so leaving a circle (the row is hard-deleted), finishing
 * a rally (finished_at is set) and toggling off (alarm_enabled is false)
 * all express themselves as "this id is no longer in the plan" — and the
 * reconcile pass in syncCircleAlarms cancels exactly those. One mechanism
 * with one test surface beats three that can drift apart.
 *
 * Resolves the signed-in user itself so callers in lib/ do not have to
 * thread a userId they do not already hold. FF1 shape: never throws at
 * its caller — a check-in must not fail because an alarm could not be
 * re-armed — but never silent either.
 */
export async function resyncCircleAlarms(reason: string): Promise<void> {
  if (!isAlarmKitAvailable()) return;
  try {
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return;
    await syncCircleAlarms({ userId });
  } catch (e) {
    captureError(e, { op: 'resyncCircleAlarms', reason });
  }
}

/** Cancel one circle's alarm outright — leaving, finishing, or toggling
 * off. Safe to call for an alarm that was never armed. */
export async function cancelCircleAlarm(membershipId: string): Promise<void> {
  if (!isAlarmKitAvailable()) return;
  await cancelAlarm(membershipId);
}

export type SetCircleAlarmResult =
  | { status: 'on' }
  | { status: 'off' }
  | { status: 'permission-denied' }
  | { status: 'refused-limit' }
  | { status: 'unsupported' };

/**
 * JOB 7 — THE TOGGLE'S WRITER, and the ORDER HERE IS THE WHOLE RULE.
 *
 * The on-state is driven by THE SCHEDULE SUCCEEDING, never by the write
 * succeeding and never optimistically. iOS caps alarms per app at a number
 * no one can see (`maximumLimitReached` is the only documented case of
 * AlarmManager.AlarmError, and Apple publishes no ceiling), so a person
 * turning on their eighth circle alarm can simply be refused. If that
 * refusal were swallowed they would walk away believing an alarm is set
 * and it would never fire — PN2's granted-but-unregistered trap in a new
 * costume, which is why this is inverted relative to AL1's saveAlarm (that
 * one writes first, because a local notification cannot be refused).
 *
 * So: ask → schedule → and only if the device really took it, write. If
 * the write then fails, the alarm is cancelled again rather than left
 * ringing for a preference the server does not hold.
 */
export async function setCircleAlarm(params: {
  membershipId: string;
  circleId: string;
  circleName: string;
  enabled: boolean;
  time: string | null;
  now?: Date;
}): Promise<SetCircleAlarmResult> {
  if (!isAlarmKitAvailable()) return { status: 'unsupported' };

  // TURNING OFF is the easy direction and must stay the easy direction:
  // cancel first so the alarm is silenced even if the write fails, then
  // record it. An off switch that can be defeated by a flaky network is
  // not an off switch, and this is the most aggressive surface in the app.
  if (!params.enabled) {
    await cancelAlarm(params.membershipId);
    const { error } = await supabase.rpc('set_circle_alarm', {
      p_circle_id: params.circleId,
      p_enabled: false,
      p_time: null,
    });
    if (error) throw error;
    return { status: 'off' };
  }

  const time = parseAlarmTime(params.time);
  if (!time) throw new Error('an alarm that is on must know when to ring');

  // THE EARNED MOMENT (job 4 / PN1's law): the ask happens here, on the
  // turn-it-on tap, and nowhere else in the app.
  let state: AlarmAuthorizationState = await getAuthorizationState();
  if (state === 'notDetermined') state = await requestAuthorization();
  if (state === 'unavailable') return { status: 'unsupported' };
  if (state !== 'authorized') return { status: 'permission-denied' };

  const now = params.now ?? new Date();
  // A person who has ALREADY checked into this circle today gets the same
  // suppressed set the recompute would give them, so turning the alarm on
  // after checking in does not ring at them tonight for work already done.
  let checkedInToday: string[] = [];
  try {
    checkedInToday = await readCheckedInCircleIdsToday(
      (await supabase.auth.getUser()).data.user?.id ?? '',
      now
    );
  } catch (e) {
    // The suppression is a courtesy, not a fact about the alarm: a failed
    // read means the full week is armed, which is the safe direction (it
    // rings when they asked it to). Reported so a persistent failure is
    // visible.
    captureError(e, { op: 'setCircleAlarm.checkedInToday', circleId: params.circleId });
  }
  const weekdays = checkedInToday.includes(params.circleId)
    ? ALL_WEEKDAYS.filter((d) => d !== now.getDay())
    : [...ALL_WEEKDAYS];

  try {
    await scheduleWeeklyAlarm({
      id: params.membershipId,
      hour: time.hour,
      minute: time.minute,
      weekdays,
      title: STRINGS.circleAlarmTitle(params.circleName),
      stopButtonText: STRINGS.circleAlarmStopButton,
    });
  } catch (e) {
    if (isMaxAlarmsError(e)) {
      // Reported WITH the circle id, per job 7, so a real ceiling in the
      // wild is visible rather than inferred from a confused message.
      captureError(e, { op: 'setCircleAlarm.maximumLimitReached', circleId: params.circleId });
      return { status: 'refused-limit' };
    }
    throw e;
  }

  const { error } = await supabase.rpc('set_circle_alarm', {
    p_circle_id: params.circleId,
    p_enabled: true,
    p_time: params.time,
  });
  if (error) {
    // The device took it but the server did not. Leaving it armed would
    // mean an alarm ringing for a preference nothing records — and the
    // next recompute, reading the server, would cancel it anyway. Undo it
    // now so the toggle and the phone agree.
    await cancelAlarm(params.membershipId).catch(() => {});
    throw error;
  }

  return { status: 'on' };
}

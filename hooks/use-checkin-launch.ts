import { useRouter } from 'expo-router';
import { useState } from 'react';

import { STRINGS } from '@/constants/strings';
import { unlockAudioContext } from '@/lib/chime';
import { recordCheckinWithoutReflection, resolveCheckinRoute } from '@/lib/checkin';
import { MyCircle } from '@/lib/circle';
import { getLocalDateString } from '@/lib/date';

/**
 * WB1 job 3 (4 Aug) — WHERE A "check in" TAP GOES, for every screen that
 * offers one.
 *
 * This is Today's `goToCheckin` and `recordOneTapCheckin`, lifted verbatim
 * and unchanged, because the circle screen now offers a check-in too and
 * job 3's requirement is "no second engine, no duplicated logic". The
 * decision itself has lived in `resolveCheckinRoute` since SK1; what had
 * not been shared was the COMPOSITION around it — the activity-screen
 * test, the audio unlock, the params each destination expects, and the
 * one-tap write. Re-typing that on a second screen is how the two would
 * have drifted, and it is exactly the divergence lib/headcount.ts was
 * created to end for the headcount line.
 *
 * The hook owns only what has to be per-screen state (which circle has a
 * one-tap write in flight); failures are handed BACK to the caller via
 * `onError` rather than rendered here, because Today and the circle screen
 * each already have their own error surface and this must not invent a
 * third.
 */
export function useCheckinLaunch(params: {
  userId: string | undefined;
  hasSeenCheckinConsent: boolean;
  reflectionsOptOut: boolean;
  /** ER1's warm line, never a raw message — the caller decides where it
   * appears. A one-tap check-in has no screen of its own to fail on, so
   * silence here would read as "the button doesn't work". */
  onError: (message: string) => void;
}): {
  launchCheckin: (circle: MyCircle, wantsTimer: boolean, dayNumber: number) => void;
  /** The circle whose one-tap write is in flight, for disabling its CTA. */
  oneTapCircleId: string | null;
} {
  const router = useRouter();
  const [oneTapCircleId, setOneTapCircleId] = useState<string | null>(null);

  const recordOneTapCheckin = async (circle: MyCircle) => {
    if (!params.userId || oneTapCircleId) return;
    setOneTapCircleId(circle.id);
    try {
      const { earnedToday } = await recordCheckinWithoutReflection({
        userId: params.userId,
        circleId: circle.id,
        localDate: getLocalDateString(),
      });
      router.push({
        pathname: '/checkin-complete',
        params: { circleId: circle.id, ...(earnedToday ? { earnedToday: 'true' } : {}) },
      });
    } catch {
      params.onError(STRINGS.loadFailedLine('your check-in'));
    } finally {
      setOneTapCircleId(null);
    }
  };

  const launchCheckin = (circle: MyCircle, wantsTimer: boolean, dayNumber: number) => {
    const wantsTimerWithDuration = wantsTimer && !!circle.durationMinutes;
    // A circle's resource link (video or otherwise) always routes through
    // the activity screen — it's the hero of that screen regardless of
    // whether the user tapped "start timer" or not (see checkin-timer.tsx).
    const goesToActivityScreen = !!circle.resourceUrl || wantsTimerWithDuration;

    const route = resolveCheckinRoute({
      hasSeenCheckinConsent: params.hasSeenCheckinConsent,
      goesToActivityScreen,
      reflectionsOptOut: params.reflectionsOptOut,
    });

    // Must happen synchronously inside this tap — iOS Safari only unlocks
    // audio playback for an AudioContext created/resumed directly inside a
    // user gesture, not after any awaited work. SK1: the one-tap flow
    // lands straight on checkin-complete, which plays the check-in pop (or
    // hands off to the glow beat's bowl), so it needs the unlock too.
    if (goesToActivityScreen || route === 'one-tap') unlockAudioContext();

    const activityParams = goesToActivityScreen
      ? {
          startTimer: 'true',
          ...(circle.durationMinutes ? { durationMinutes: String(circle.durationMinutes) } : {}),
          circleName: circle.name,
          // PA1 — the timer's "day N" is the CIRCLE'S AGE, and a circle
          // has no deadline to cap it against (memo §3). The old
          // Math.min pinned every live circle at "day 21" forever, which
          // is the same stopped clock the pill carried.
          dayNumber: String(dayNumber),
          ...(circle.resourceUrl ? { resourceUrl: circle.resourceUrl } : {}),
        }
      : {};

    if (route === 'intro') {
      router.push({ pathname: '/checkin-intro', params: { circleId: circle.id, ...activityParams } });
    } else if (route === 'activity') {
      router.push({ pathname: '/checkin-timer', params: { circleId: circle.id, ...activityParams } });
    } else if (route === 'one-tap') {
      recordOneTapCheckin(circle);
    } else {
      router.push({ pathname: '/checkin', params: { circleId: circle.id } });
    }
  };

  return { launchCheckin, oneTapCircleId };
}

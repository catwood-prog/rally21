import { AppState } from 'react-native';

/** RT1 (15 July) — realtime timeouts are weather, not bugs. A suspended
 * or long-idle tab (or a network blip) makes a channel join exceed its
 * ~10s timeout; supabase-js rejoins automatically, so a single TIMED_OUT
 * is expected and not worth a Sentry report. The real cost of a
 * disconnect is any INSERT missed while the channel was down — which,
 * before RT1, stayed missing until a full reload. This module owns both
 * halves of the fix, shared by subscribeToCirclePresence (lib/circle.ts)
 * and subscribeToWall (lib/wall.ts):
 * - a pure per-channel status gate deciding when to refetch (the channel
 *   just recovered) and when a failure streak is finally worth reporting;
 * - a wake listener that refetches once when the app/tab comes back to
 *   the foreground, since react-navigation's focus events never fire for
 *   a browser tab going hidden→visible (useFocusEffect only covers
 *   in-app navigation). */

/** How many consecutive failed joins a channel gets before the failure
 * is reported to Sentry. Below this, supabase-js's automatic rejoin is
 * trusted to sort it out quietly. */
export const REALTIME_REPORT_AFTER_FAILURES = 3;

export type RealtimeStatusAction = {
  /** The channel just reached SUBSCRIBED again after one or more
   * failures — refetch once, anything inserted while disconnected was
   * never delivered. Always false on a clean first join. */
  refetch: boolean;
  /** Set to the consecutive-failure count exactly when the streak
   * reaches the reporting threshold — once per streak, so a channel
   * that keeps failing doesn't re-report every retry. Null otherwise. */
  reportFailureCount: number | null;
};

/** Pure state machine over the statuses supabase-js hands the
 * `.subscribe()` callback ('SUBSCRIBED' | 'TIMED_OUT' | 'CHANNEL_ERROR'
 * | 'CLOSED'). One instance per channel — the streak is per-channel
 * state. CLOSED (deliberate removeChannel) is neutral: neither a
 * failure nor a recovery; only SUBSCRIBED resets the streak.
 *
 * Which failures actually repeat (verified live against the project's
 * realtime server, 15 July): a join that keeps exceeding its ~10s
 * timeout on a live socket — the original Sentry alert's shape — emits
 * TIMED_OUT per retry, so a persistent one crosses the threshold and
 * reports once. A full transport outage is different: phoenix fires
 * CHANNEL_ERROR once per channel, then stays silent until the socket
 * reconnects (errored channels are skipped by triggerChanError), so a
 * simply-offline device never accumulates a reportable streak — which
 * is right, offline isn't a bug worth a report. */
export function createRealtimeStatusGate(
  reportAfterFailures: number = REALTIME_REPORT_AFTER_FAILURES
): (status: string) => RealtimeStatusAction {
  let consecutiveFailures = 0;

  return (status) => {
    if (status === 'SUBSCRIBED') {
      const recovered = consecutiveFailures > 0;
      consecutiveFailures = 0;
      return { refetch: recovered, reportFailureCount: null };
    }
    if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
      consecutiveFailures += 1;
      return {
        refetch: false,
        reportFailureCount: consecutiveFailures === reportAfterFailures ? consecutiveFailures : null,
      };
    }
    return { refetch: false, reportFailureCount: null };
  };
}

/** Calls `refetch` once each time the app returns to the foreground —
 * on web that's the tab going hidden→visible (react-native-web backs
 * AppState with document.visibilitychange, the same cross-platform
 * pattern auth-context's markSeenNow already relies on), on native it's
 * background→active. No polling; AppState only emits on changes, so a
 * tab that was never hidden never refetches. May land close to the
 * gate's own recovery refetch when a hidden tab's channel timed out —
 * harmless (both hand the same data to the same setState), and the wake
 * refetch covers the window before the rejoin completes. Returns an
 * unsubscribe function; callers tie it to the channel's lifecycle. */
export function subscribeToAppWake(refetch: () => void): () => void {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') refetch();
  });
  return () => subscription.remove();
}

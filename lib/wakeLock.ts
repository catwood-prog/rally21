import { useEffect } from 'react';
import { Platform } from 'react-native';

import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

const KEEP_AWAKE_TAG = 'rally21-checkin-timer';

/** Keeps the screen on for as long as `active` is true.
 *
 * GN1 (13 July): the web Wake Lock API below has no native equivalent —
 * `navigator.wakeLock` simply doesn't exist in React Native's JS runtime,
 * so without this branch a native timed sit would silently let the screen
 * sleep mid-countdown. Native uses expo-keep-awake's own
 * activateKeepAwakeAsync/deactivateKeepAwake instead, which needs none of
 * the web branch's visibilitychange re-acquire dance (the native module
 * handles backgrounding itself). The already-shipped, unit-tested web path
 * below is untouched — this only adds a sibling branch, never replaces it. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (Platform.OS !== 'web') {
      if (!active) return;
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {
        // unsupported or denied — the timer still runs without it
      });
      return () => {
        deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
      };
    }

    if (!active) return;
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
    if (!nav?.wakeLock?.request) return;

    let sentinel: { release: () => Promise<void>; addEventListener?: (type: string, cb: () => void) => void } | null =
      null;
    let cancelled = false;

    const requestLock = () => {
      nav.wakeLock
        .request('screen')
        .then((s: NonNullable<typeof sentinel>) => {
          if (cancelled) {
            s.release().catch(() => {});
            return;
          }
          sentinel = s;
          s.addEventListener?.('release', () => {
            sentinel = null;
          });
        })
        .catch(() => {
          // denied, unsupported, or the page isn't visible — degrade silently
        });
    };

    requestLock();

    const handleVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'visible' && !sentinel) requestLock();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      cancelled = true;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
      sentinel?.release().catch(() => {});
    };
  }, [active]);
}

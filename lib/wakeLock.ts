import { useEffect } from 'react';

/** Keeps the screen on for as long as `active` is true, using the web Wake
 * Lock API where the browser supports it. Feature-detected and wrapped in
 * try/catch — on unsupported browsers (or if permission is denied) the
 * timer just runs without it, no user-facing error.
 *
 * T1 (8 July): confirmed against current MDN docs, not recalled from
 * training data — the platform automatically releases a held wake lock
 * whenever the document becomes hidden (backgrounding the tab), and does
 * NOT automatically re-acquire it when the document becomes visible
 * again; the caller must do that itself via a visibilitychange listener.
 * Without this, a sit that gets backgrounded even briefly would silently
 * lose its wake lock for the rest of the sit. The sentinel also emits its
 * own 'release' event whenever the platform releases it out from under
 * us (not just on hidden — MDN also lists low battery / power-save mode),
 * so that's tracked too rather than assuming `active` alone means we
 * still hold it. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
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

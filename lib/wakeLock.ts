import { useEffect } from 'react';

/** Keeps the screen on for as long as `active` is true, using the web Wake
 * Lock API where the browser supports it. Feature-detected and wrapped in
 * try/catch — on unsupported browsers (or if permission is denied) the
 * timer just runs without it, no user-facing error. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
    if (!nav?.wakeLock?.request) return;

    let sentinel: { release: () => Promise<void> } | null = null;
    let cancelled = false;

    nav.wakeLock
      .request('screen')
      .then((s: { release: () => Promise<void> }) => {
        if (cancelled) {
          s.release().catch(() => {});
          return;
        }
        sentinel = s;
      })
      .catch(() => {
        // denied, unsupported, or the page isn't visible — degrade silently
      });

    return () => {
      cancelled = true;
      sentinel?.release().catch(() => {});
    };
  }, [active]);
}

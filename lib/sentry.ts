import * as Sentry from '@sentry/react';
import { Platform } from 'react-native';

import appConfig from '../app.json';

/** Free-tier crash reporting — web only for now (this app has no native
 * build target yet; native init via @sentry/react-native is a separate
 * task at go-native, see DEFERRED.md). No-ops if EXPO_PUBLIC_SENTRY_DSN
 * isn't set, so local dev and any environment without a DSN configured
 * just skip silently — the app never depends on Sentry being present.
 *
 * Privacy: only ever reports errors we explicitly capture or genuinely
 * unhandled exceptions/rejections (via Sentry's default GlobalHandlers
 * integration) — never reflection text, wall messages, or other
 * user-written content, and no request/response bodies (Sentry's default
 * breadcrumb integrations log method/url/status only, never bodies). */
export function initSentry() {
  if (Platform.OS !== 'web') return;
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    release: appConfig.expo.version,
    tracesSampleRate: 0,
  });
}

/** Reports a caught-but-serious error (realtime subscription failure, RPC
 * error) that the app recovered from but is still worth knowing about.
 * `context` should be small, structured tags (e.g. screen/table name) —
 * never free-text content. */
export function captureError(error: unknown, context?: Record<string, string>): void {
  if (Platform.OS !== 'web' || !process.env.EXPO_PUBLIC_SENTRY_DSN) return;
  Sentry.captureException(error, context ? { tags: context } : undefined);
}

/** Tags subsequent events with the current screen so a crash/report is
 * traceable to where it happened. */
export function setSentryScreen(screen: string): void {
  if (Platform.OS !== 'web' || !process.env.EXPO_PUBLIC_SENTRY_DSN) return;
  Sentry.setTag('screen', screen);
}

/** NR1 Job 1d — route native uncaught errors + unhandled promise
 * rejections into the SAME reporting path (captureError), so there is one
 * path, not a parallel system. Web is a no-op: @sentry/react's default
 * GlobalHandlers integration already catches window errors/rejections
 * there. On native the web SDK's globals never run, so we register with
 * React Native's ErrorUtils (uncaught errors) and Hermes' rejection
 * tracker (unhandled rejections), CHAINING the prior handler so dev's
 * RedBox and prod's native crash behaviour are preserved — this reports
 * IN ADDITION to, never INSTEAD of, the platform default. captureError
 * still no-ops on native until Job 2 wires the OTA-servable transport;
 * this establishes the plumbing so that switch-on needs no change here.
 * Privacy is unchanged: only a small `source` tag is added, never the
 * error text as a payload. Safe to call once at startup; guarded so a
 * missing ErrorUtils/Hermes never throws. */
export function registerGlobalErrorHandlers(): void {
  if (Platform.OS === 'web') return;

  const g = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
      setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
    };
    HermesInternal?: {
      enablePromiseRejectionTracker?: (options: {
        allRejections?: boolean;
        onUnhandled?: (id: number, error: unknown) => void;
      }) => void;
    };
  };

  try {
    const prior = g.ErrorUtils?.getGlobalHandler?.();
    g.ErrorUtils?.setGlobalHandler?.((error, isFatal) => {
      captureError(error, { source: 'globalHandler', fatal: String(!!isFatal) });
      prior?.(error, isFatal);
    });
  } catch {
    // Best-effort: never let handler registration itself break startup.
  }

  try {
    g.HermesInternal?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (_id, error) => {
        captureError(error, { source: 'unhandledRejection' });
      },
    });
  } catch {
    // Rejection tracking is best-effort (absent off Hermes); never throw.
  }
}

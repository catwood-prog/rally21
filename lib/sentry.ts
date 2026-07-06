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

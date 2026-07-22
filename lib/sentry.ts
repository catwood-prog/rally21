import * as Sentry from '@sentry/react';
import { Platform } from 'react-native';

import appConfig from '../app.json';

/** Free-tier crash reporting, ONE reporting path for both platforms
 * (captureError / setSentryScreen below):
 *
 * - WEB: the @sentry/react SDK, initialized in initSentry(). Its default
 *   GlobalHandlers integration catches window errors/rejections.
 * - NATIVE: NR1 Job 2's minimal envelope transport (below) over the app's
 *   own fetch — no native dependency, so it ships in the OTA lane.
 *   Uncaught errors reach it via registerGlobalErrorHandlers().
 *
 * No-ops everywhere if EXPO_PUBLIC_SENTRY_DSN isn't set, so local dev and
 * any environment without a DSN configured just skip silently — the app
 * never depends on Sentry being present.
 *
 * Privacy: only ever reports errors we explicitly capture or genuinely
 * unhandled exceptions/rejections — never reflection text, wall messages,
 * Ask Rally content, practice names, or any user-written string, and no
 * request/response bodies. On web that's the SDK's defaults (breadcrumbs
 * log method/url/status only, never bodies; tracesSampleRate 0). On native
 * the entire event is assembled in buildNativeEvent(), so the payload is
 * enumerable and pinned by unit test. */

/** THE OTA-SERVABLE NATIVE PATH (NR1 Job 2a) — chosen deliberately:
 * a hand-rolled Sentry envelope POSTed to the SAME DSN/project the web SDK
 * reports to, via React Native's own fetch.
 *
 * - Not @sentry/react-native: a native dependency means build 10 through
 *   Beta App Review — fenced until after the ceremonies (NR1 Job 3).
 * - Not the web SDK on native: unsupported environment (its transport and
 *   integrations assume window/document), and its payload assembly is
 *   exactly the surface the privacy bar wants auditable.
 * - Hand-rolled envelope: Sentry's ingest envelope format is small and
 *   stable; building it here means the WHOLE event is one pure function's
 *   return value, so "tags only, no free text" is structurally provable.
 *
 * What a native event contains, exhaustively: event_id, timestamp,
 * platform, release, level, tags (call-site context + screen + os), and
 * one exception {type, value, mechanism}. `value` is the error's own
 * message, truncated. DELIBERATELY ABSENT: stacktrace (Hermes frames in a
 * minified OTA bundle are useless without source-map upload — Job 3's
 * territory), breadcrumbs, user (not even the uid), request data, and —
 * privacy-critical — PostgrestError's `details`/`hint` fields, which can
 * carry the offending row's values (user text).
 *
 * Flood control (NR1 Job 2d): NATIVE_REPORT_LIMIT events per rolling
 * window, and a consecutive-duplicate drop (same type+value+screen within
 * the window), so a render-loop error reports once, not per frame. Web
 * keeps the SDK's built-in Dedupe integration. */

const NATIVE_REPORT_LIMIT = 5;
const NATIVE_REPORT_WINDOW_MS = 60_000;
const MAX_EXCEPTION_VALUE_LENGTH = 300;

export type NativeSentryEvent = {
  event_id: string;
  timestamp: number;
  platform: 'javascript';
  release: string;
  level: 'error';
  tags: Record<string, string>;
  exception: {
    values: [{ type: string; value: string; mechanism: { type: string; handled: boolean } }];
  };
};

/** Parses a Sentry DSN into the envelope ingest URL, or null if the DSN
 * doesn't look like one (a malformed env var must disable reporting, never
 * break the app). */
export function parseDsn(dsn: string): { envelopeUrl: string } | null {
  const match = /^(https?):\/\/([a-f0-9]+)@([^/@]+)\/(\d+)$/.exec(dsn);
  if (!match) return null;
  const [, protocol, publicKey, host, projectId] = match;
  const client = encodeURIComponent(`rally21-native/${appConfig.expo.version}`);
  return {
    envelopeUrl: `${protocol}://${host}/api/${projectId}/envelope/?sentry_key=${publicKey}&sentry_version=7&sentry_client=${client}`,
  };
}

/** The whole native event, in one place — everything that can ever leave
 * the phone is a field this function returns. `context` and `screen` are
 * structured tags; the only free-ish text is the error's own message
 * (never PostgrestError details/hint, never a stack). */
export function buildNativeEvent(
  error: unknown,
  options: {
    context?: Record<string, string>;
    screen?: string;
    os: string;
    nowMs: number;
    eventId: string;
  }
): NativeSentryEvent {
  let type = 'Error';
  let value: string;
  const asObject = error && typeof error === 'object' ? (error as Record<string, unknown>) : null;
  if (error instanceof Error) {
    type = error.name || 'Error';
    value = error.message;
  } else if (typeof error === 'string') {
    value = error;
  } else if (asObject && typeof asObject.message === 'string') {
    // Error-shaped plain objects (some supabase failures) — take the
    // message field ONLY, never details/hint.
    if (typeof asObject.name === 'string' && asObject.name) type = asObject.name;
    value = asObject.message;
  } else {
    try {
      value = String(error);
    } catch {
      value = 'Unknown error';
    }
  }
  const source = options.context?.source;
  return {
    event_id: options.eventId,
    timestamp: Math.floor(options.nowMs / 1000),
    platform: 'javascript',
    release: appConfig.expo.version,
    level: 'error',
    tags: {
      os: options.os,
      ...(options.screen ? { screen: options.screen } : {}),
      ...options.context,
    },
    exception: {
      values: [
        {
          type,
          value: value.slice(0, MAX_EXCEPTION_VALUE_LENGTH),
          mechanism: {
            type: 'generic',
            handled: source !== 'globalHandler' && source !== 'unhandledRejection',
          },
        },
      ],
    },
  };
}

/** Sentry envelope wire format: three newline-separated JSON lines
 * (envelope header, item header, the event). */
export function serializeEnvelope(event: NativeSentryEvent, dsn: string, sentAtIso: string): string {
  return (
    JSON.stringify({ event_id: event.event_id, sent_at: sentAtIso, dsn }) +
    '\n' +
    JSON.stringify({ type: 'event' }) +
    '\n' +
    JSON.stringify(event) +
    '\n'
  );
}

/** Flood control (Job 2d): at most `limit` accepted reports per fixed
 * window, and a consecutive-duplicate drop — the same signature as the
 * last ACCEPTED report is dropped for the rest of its window, so a
 * render-loop crash reports once. After the window passes, the same error
 * may report again (a recurring failure isn't silenced forever). */
export function createReportBudget(limit: number, windowMs: number) {
  let windowStart = -Infinity;
  let count = 0;
  let lastSignature: string | null = null;
  let lastAcceptedAt = -Infinity;
  return {
    take(nowMs: number, signature: string): boolean {
      if (signature === lastSignature && nowMs - lastAcceptedAt < windowMs) return false;
      if (nowMs - windowStart >= windowMs) {
        windowStart = nowMs;
        count = 0;
      }
      if (count >= limit) return false;
      count += 1;
      lastSignature = signature;
      lastAcceptedAt = nowMs;
      return true;
    },
  };
}

const nativeReportBudget = createReportBudget(NATIVE_REPORT_LIMIT, NATIVE_REPORT_WINDOW_MS);

// The screen tag on native (web goes through Sentry.setTag instead).
let currentNativeScreen: string | undefined;

function randomEventId(): string {
  let id = '';
  for (let i = 0; i < 32; i += 1) {
    id += Math.floor(Math.random() * 16).toString(16);
  }
  return id;
}

function sendNativeErrorEvent(dsn: string, error: unknown, context?: Record<string, string>): void {
  try {
    const parsed = parseDsn(dsn);
    if (!parsed) return;
    const nowMs = Date.now();
    const event = buildNativeEvent(error, {
      context,
      screen: currentNativeScreen,
      os: Platform.OS,
      nowMs,
      eventId: randomEventId(),
    });
    const { type, value } = event.exception.values[0];
    if (!nativeReportBudget.take(nowMs, `${type}|${value}|${event.tags.screen ?? ''}`)) return;
    fetch(parsed.envelopeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: serializeEnvelope(event, dsn, new Date(nowMs).toISOString()),
    }).catch(() => {
      // Fire-and-forget: a failed report is just a lost report.
    });
  } catch {
    // Reporting must never break the app.
  }
}

export function initSentry() {
  // Native needs no init — its transport (above) is stateless.
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
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  if (Platform.OS === 'web') {
    Sentry.captureException(error, context ? { tags: context } : undefined);
    return;
  }
  sendNativeErrorEvent(dsn, error, context);
}

/** Tags subsequent events with the current screen so a crash/report is
 * traceable to where it happened. */
export function setSentryScreen(screen: string): void {
  currentNativeScreen = screen;
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
 * IN ADDITION to, never INSTEAD of, the platform default. Since Job 2,
 * captureError is live on native via the envelope transport above.
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

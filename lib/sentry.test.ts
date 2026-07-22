// jest.setup.js stubs ./lib/sentry globally (because @sentry/react is
// untransformable ESM) — this suite tests the REAL module, so unmock it
// and stub the ESM package instead.
jest.unmock('./sentry');
jest.mock('@sentry/react', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  setTag: jest.fn(),
}));

import {
  buildNativeEvent,
  createReportBudget,
  parseDsn,
  serializeEnvelope,
  type NativeSentryEvent,
} from './sentry';

// NR1 Job 2 — pin the native transport's payload and flood control. The
// privacy bar (§2c) is structural here: buildNativeEvent returns the WHOLE
// event, so pinning its key inventory proves nothing else can ever leave
// the phone through this path.

const baseOptions = {
  os: 'ios',
  nowMs: 1_753_200_000_000,
  eventId: 'ab'.repeat(16),
};

describe('parseDsn', () => {
  it('turns a real-shaped DSN into the envelope ingest URL', () => {
    const parsed = parseDsn('https://abc123def@o123456.ingest.us.sentry.io/987654');
    expect(parsed).not.toBeNull();
    expect(parsed!.envelopeUrl).toContain('https://o123456.ingest.us.sentry.io/api/987654/envelope/');
    expect(parsed!.envelopeUrl).toContain('sentry_key=abc123def');
    expect(parsed!.envelopeUrl).toContain('sentry_version=7');
  });

  it('rejects anything that does not look like a DSN', () => {
    expect(parseDsn('')).toBeNull();
    expect(parseDsn('not a dsn')).toBeNull();
    expect(parseDsn('https://sentry.io/123')).toBeNull();
  });
});

describe('buildNativeEvent — privacy pinning', () => {
  it('the event contains EXACTLY the documented fields, nothing else', () => {
    const event = buildNativeEvent(new Error('boom'), {
      ...baseOptions,
      context: { rpc: 'join_circle_by_code' },
      screen: '/today',
    });
    expect(Object.keys(event).sort()).toEqual(
      ['event_id', 'exception', 'level', 'platform', 'release', 'tags', 'timestamp'].sort()
    );
    const exception = event.exception.values[0];
    expect(event.exception.values).toHaveLength(1);
    expect(Object.keys(exception).sort()).toEqual(['mechanism', 'type', 'value'].sort());
    // The leak surfaces the web SDK would add are structurally absent:
    const serialized = JSON.stringify(event);
    for (const banned of ['breadcrumbs', 'user', 'request', 'extra', 'contexts', 'stacktrace']) {
      expect(serialized).not.toContain(banned);
    }
  });

  it('tags are the call-site context + screen + os and nothing more', () => {
    const event = buildNativeEvent(new Error('boom'), {
      ...baseOptions,
      context: { rpc: 'create_circle' },
      screen: '/circle',
    });
    expect(event.tags).toEqual({ os: 'ios', screen: '/circle', rpc: 'create_circle' });
  });

  it('never lifts PostgrestError details/hint — the fields that can carry row values', () => {
    const err = new Error('duplicate key value violates unique constraint') as Error & {
      details: string;
      hint: string;
      code: string;
    };
    err.details = 'Failing row contains (MARKER-A-REFLECTION-LINE, more user text)';
    err.hint = 'MARKER-HINT-TEXT';
    err.code = '23505';
    const event = buildNativeEvent(err, { ...baseOptions, context: { rpc: 'checkin' } });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('MARKER-A-REFLECTION-LINE');
    expect(serialized).not.toContain('MARKER-HINT-TEXT');
    expect(serialized).not.toContain('23505');
    expect(event.exception.values[0].value).toBe('duplicate key value violates unique constraint');
  });

  it('truncates the message and survives non-Error throwables', () => {
    const long = buildNativeEvent(new Error('x'.repeat(1000)), baseOptions);
    expect(long.exception.values[0].value).toHaveLength(300);

    expect(buildNativeEvent('plain string', baseOptions).exception.values[0]).toMatchObject({
      type: 'Error',
      value: 'plain string',
    });
    expect(buildNativeEvent({ weird: true }, baseOptions).exception.values[0].value).toBe(
      '[object Object]'
    );
    expect(buildNativeEvent(undefined, baseOptions).exception.values[0].value).toBe('undefined');

    // Error-shaped plain objects keep their message but NOTHING else.
    const shaped = buildNativeEvent(
      { name: 'AuthApiError', message: 'Invalid login', details: 'MARKER-OBJECT-DETAILS' },
      baseOptions
    );
    expect(shaped.exception.values[0]).toMatchObject({ type: 'AuthApiError', value: 'Invalid login' });
    expect(JSON.stringify(shaped)).not.toContain('MARKER-OBJECT-DETAILS');
  });

  it('marks globalHandler/unhandledRejection sources unhandled, everything else handled', () => {
    const handled = (context?: Record<string, string>) =>
      buildNativeEvent(new Error('x'), { ...baseOptions, context }).exception.values[0].mechanism
        .handled;
    expect(handled({ source: 'globalHandler', fatal: 'true' })).toBe(false);
    expect(handled({ source: 'unhandledRejection' })).toBe(false);
    expect(handled({ rpc: 'edit_circle' })).toBe(true);
    expect(handled()).toBe(true);
  });
});

describe('serializeEnvelope', () => {
  it('produces the three-line envelope wire format', () => {
    const event: NativeSentryEvent = buildNativeEvent(new Error('boom'), baseOptions);
    const dsn = 'https://abc@o1.ingest.sentry.io/2';
    const lines = serializeEnvelope(event, dsn, '2026-07-22T21:00:00.000Z').trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toEqual({
      event_id: event.event_id,
      sent_at: '2026-07-22T21:00:00.000Z',
      dsn,
    });
    expect(JSON.parse(lines[1])).toEqual({ type: 'event' });
    expect(JSON.parse(lines[2])).toEqual(event);
  });
});

describe('createReportBudget — flood control (Job 2d)', () => {
  it('a render-loop error (same signature, rapid fire) reports exactly once per window', () => {
    const budget = createReportBudget(5, 60_000);
    expect(budget.take(0, 'Error|boom|/today')).toBe(true);
    for (let ms = 16; ms < 60_000; ms += 16 * 100) {
      expect(budget.take(ms, 'Error|boom|/today')).toBe(false);
    }
    // A new window lets a genuinely recurring failure report again.
    expect(budget.take(60_001, 'Error|boom|/today')).toBe(true);
  });

  it('distinct errors are capped at the per-window limit', () => {
    const budget = createReportBudget(5, 60_000);
    for (let i = 0; i < 5; i += 1) {
      expect(budget.take(1000 + i, `Error|boom-${i}|/today`)).toBe(true);
    }
    expect(budget.take(1010, 'Error|boom-5|/today')).toBe(false);
    expect(budget.take(1011, 'Error|boom-6|/today')).toBe(false);
    // Window rolls over → budget refills.
    expect(budget.take(62_000, 'Error|boom-7|/today')).toBe(true);
  });

  it('an alternating pair still burns the count, not the dedupe', () => {
    const budget = createReportBudget(2, 60_000);
    expect(budget.take(0, 'A')).toBe(true);
    expect(budget.take(1, 'B')).toBe(true);
    expect(budget.take(2, 'A')).toBe(false);
    expect(budget.take(3, 'C')).toBe(false);
  });
});

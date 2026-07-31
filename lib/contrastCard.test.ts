import { ContrastCard, describeBlueprintPattern, describeContrastEvidence, parseContrastCard } from './blueprint';

/** MN3's client half. Two things are worth pinning here: a half-arrived
 * card must render as NOTHING rather than as a partial claim, and the
 * evidence line must be composed from the stored numbers on this device
 * (hallucination law clause 4) rather than trusted from server text. */

const raw = {
  question_code: 'HAB-15',
  metric_key: 'weekend_vs_weekday_checkin_rate',
  declared_quote: 'let it slip',
  declared_date: '2026-09-13',
  observed_line: 'your weekends have been holding about as well as your weekdays lately.',
  window_start: '2026-06-23',
  window_end: '2026-09-20',
  weekend_days: 26,
  weekend_checkins: 22,
  weekday_days: 64,
  weekday_checkins: 35,
};

const card = (): ContrastCard => parseContrastCard(raw)!;

describe('parseContrastCard', () => {
  it('reads a complete card', () => {
    expect(card().declaredQuote).toBe('let it slip');
    expect(card().weekendCheckins).toBe(22);
  });

  it('treats a card missing ANY field as absent, never as half a claim', () => {
    expect(parseContrastCard(null)).toBeNull();
    expect(parseContrastCard(undefined)).toBeNull();
    for (const key of Object.keys(raw)) {
      const missing = { ...raw } as Record<string, unknown>;
      delete missing[key];
      expect(parseContrastCard(missing)).toBeNull();
    }
  });

  it('rejects a zeroed-out number only when it is missing, not when it is genuinely zero', () => {
    // Nobody checked in at the weekend at all is a real, sayable fact.
    expect(parseContrastCard({ ...raw, weekend_checkins: 0 })?.weekendCheckins).toBe(0);
  });
});

describe('describeContrastEvidence', () => {
  it('composes counts on the device, from the stored numbers only', () => {
    const line = describeContrastEvidence(card(), (d) => d);
    expect(line).toBe(
      'you checked in on 22 of 26 weekend days, and 35 of 64 weekdays, since 2026-06-23.'
    );
  });

  it('names counts, never a list of the days someone missed', () => {
    const line = describeContrastEvidence(card(), (d) => d);
    expect(line).not.toContain('missed');
    expect(line).not.toContain('2026-09');
  });
});

describe('describeBlueprintPattern on a contrast', () => {
  it('yields the observed half, so generic pattern copy is never blank', () => {
    const copy = describeBlueprintPattern({
      patternKey: 'contrast_hab_15_let_it_slip_weekend_vs_weekday_checkin_rate',
      patternType: 'contrast',
      weekday: null,
      direction: null,
      cutoffHour: null,
      agreementCount: 0,
      totalCount: 0,
      evidenceRate: 0.75,
      statement: raw.observed_line,
      contrast: card(),
    });
    expect(copy.headline).toBe(raw.observed_line);
    expect(copy.accent).toBe('');
  });
});

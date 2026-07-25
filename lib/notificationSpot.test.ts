import { STRINGS } from '@/constants/strings';

import { buildNotificationSpot, CoverMoment, joinNames, SPOT_MAX_LINES } from './notificationSpot';
import { FreshWarmth } from './warmth';

function wave(senderName: string, createdAt: string): FreshWarmth {
  return { kind: 'wave', senderName, createdAt };
}
function heart(senderName: string, createdAt: string): FreshWarmth {
  return { kind: 'heart', senderName, createdAt };
}
function cover(covererName: string, at: string): CoverMoment {
  return { covererName, at };
}

const QUIET = { isReentry: false, warmth: [], covers: [], glowHeld: true, circleCount: 1 };

// The spot inherits WL2's whisper laws (empty in = absent surface, a cap
// with a quiet overflow line, newest first) plus TN1's own: welcome-back
// is a MODE of the same card, the glow sentence must be true or absent,
// and one marker value consumes warmth and covers together.
describe('the spot is warmth or it is absent (mockup frame B)', () => {
  it('nothing to say and no re-entry → null, Today is exactly its live layout', () => {
    expect(buildNotificationSpot(QUIET)).toBeNull();
  });

  it('a re-entry with a totally quiet circle still renders — the moment IS the message', () => {
    const spot = buildNotificationSpot({ ...QUIET, isReentry: true });
    expect(spot).not.toBeNull();
    expect(spot?.kicker).toBe(STRINGS.todaySpotKickerWelcomeBack);
    expect(spot?.headline).toBe(STRINGS.todaySpotWelcomeHeadline);
    expect(spot?.lines).toEqual([]);
    // Nothing to consume, so the seen-marker must not move.
    expect(spot?.newestAt).toBeNull();
  });
});

describe('everyday moments (mockup frame C)', () => {
  it('a heart and a cover read as their own lines under the everyday kicker', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: [heart('Russ', '2026-07-24T09:00:00.222222+00:00')],
      covers: [cover('Catherine', '2026-07-24T08:00:00.111111+00:00')],
    });
    expect(spot?.kicker).toBe(STRINGS.todaySpotKickerEveryday);
    expect(spot?.headline).toBeNull();
    expect(spot?.footnote).toBeNull();
    expect(spot?.lines.map((l) => l.text)).toEqual([
      STRINGS.todaySpotHeartLine('Russ'),
      STRINGS.todaySpotCoverLine('Catherine'),
    ]);
  });

  it('newest first, across event types', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: [heart('Russ', '2026-07-24T08:00:00Z')],
      covers: [cover('Catherine', '2026-07-24T09:00:00Z')],
    });
    expect(spot?.lines.map((l) => l.text)).toEqual([
      STRINGS.todaySpotCoverLine('Catherine'),
      STRINGS.todaySpotHeartLine('Russ'),
    ]);
  });

  it('the same friend covering you in two circles is ONE moment, not two identical lines', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      covers: [cover('Catherine', '2026-07-24T08:00:00Z'), cover('Catherine', '2026-07-24T09:00:00Z')],
    });
    expect(spot?.lines).toHaveLength(1);
    // The marker still clears the newer of the two rows.
    expect(spot?.newestAt).toBe('2026-07-24T09:00:00Z');
  });

  it('keys are stable and unique so React never collapses two moments', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: [heart('Russ', '2026-07-24T09:00:00Z'), heart('Bo', '2026-07-24T08:00:00Z')],
    });
    const keys = spot!.lines.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('the cap and its quiet overflow line (WL2 whisper law, retargeted)', () => {
  it(`renders ${SPOT_MAX_LINES} moments individually, no overflow marker below the cap`, () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: Array.from({ length: SPOT_MAX_LINES }, (_, i) =>
        heart(`friend-${i}`, `2026-07-2${i + 1}T10:00:00Z`)
      ),
    });
    expect(spot?.lines).toHaveLength(SPOT_MAX_LINES);
    expect(spot?.overflowCount).toBe(0);
  });

  it('beyond the cap folds into one count — never a scrolling feed', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: Array.from({ length: SPOT_MAX_LINES + 3 }, (_, i) =>
        heart(`friend-${i}`, `2026-07-1${i}T10:00:00Z`)
      ),
    });
    expect(spot?.lines).toHaveLength(SPOT_MAX_LINES);
    expect(spot?.overflowCount).toBe(3);
  });

  it('the marker clears the folded moments too — the overflow line IS the acknowledgement', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: Array.from({ length: SPOT_MAX_LINES + 2 }, (_, i) =>
        heart(`friend-${i}`, `2026-07-1${9 - i}T10:00:00Z`)
      ),
    });
    // Rows arrive newest-first, so the newest of ALL of them is row 0.
    expect(spot?.newestAt).toBe('2026-07-19T10:00:00Z');
  });

  it('a dropped GROUPED line contributes its whole group to the count', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      // Three hearts are newer than any wave, so the (older) grouped
      // wave line is the one that falls off the cap.
      warmth: [
        heart('a', '2026-07-24T12:00:00Z'),
        heart('b', '2026-07-24T11:00:00Z'),
        heart('c', '2026-07-24T10:00:00Z'),
        wave('d', '2026-07-24T09:00:00Z'),
        wave('e', '2026-07-24T08:00:00Z'),
      ],
    });
    expect(spot?.lines).toHaveLength(SPOT_MAX_LINES);
    expect(spot?.overflowCount).toBe(2);
  });
});

describe('the welcome-back mode (mockup frame A)', () => {
  it('waves group into ONE line: after days away the point is "your people missed you"', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      isReentry: true,
      warmth: [wave('Russ', '2026-07-24T09:00:00Z'), wave('Catherine', '2026-07-24T08:00:00Z')],
    });
    expect(spot?.lines.map((l) => l.text)).toEqual([
      STRINGS.todaySpotWaveLine('Russ and Catherine'),
    ]);
  });

  it('the wave line is PINNED on re-entry — a flurry of newer hearts can never bury it', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      isReentry: true,
      warmth: [
        heart('a', '2026-07-24T12:00:00Z'),
        heart('b', '2026-07-24T11:00:00Z'),
        heart('c', '2026-07-24T10:00:00Z'),
        wave('Russ', '2026-07-24T09:00:00Z'),
        wave('Catherine', '2026-07-24T08:00:00Z'),
      ],
    });
    expect(spot?.lines[0].text).toBe(STRINGS.todaySpotWaveLine('Russ and Catherine'));
    expect(spot?.lines).toHaveLength(SPOT_MAX_LINES);
    // The pin costs a heart, not the wave: one heart folds instead.
    expect(spot?.overflowCount).toBe(1);
    // …and the marker still clears the genuinely newest moment.
    expect(spot?.newestAt).toBe('2026-07-24T12:00:00Z');
  });

  it('on an ORDINARY day the wave line is just another moment, newest-first', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      warmth: [heart('a', '2026-07-24T12:00:00Z'), wave('Russ', '2026-07-24T09:00:00Z')],
    });
    expect(spot?.lines[0].text).toBe(STRINGS.todaySpotHeartLine('a'));
  });

  it('a glowing person is told the truth: no streak lost', () => {
    const spot = buildNotificationSpot({ ...QUIET, isReentry: true, glowHeld: true, circleCount: 2 });
    expect(spot?.footnote).toBe(STRINGS.welcomeBackSubtitleHeld(2));
  });

  it('a genuinely reset glow is told the OTHER truth, guilt-free (OD1 job 14)', () => {
    const spot = buildNotificationSpot({ ...QUIET, isReentry: true, glowHeld: false });
    expect(spot?.footnote).toBe(STRINGS.welcomeBackSubtitleReset);
    expect(spot?.footnote).not.toMatch(/missed nothing/i);
  });

  it('an UNKNOWN glow says nothing rather than guessing — both branches are factual claims', () => {
    const spot = buildNotificationSpot({ ...QUIET, isReentry: true, glowHeld: null });
    expect(spot?.footnote).toBeNull();
    expect(spot?.headline).toBe(STRINGS.todaySpotWelcomeHeadline);
  });

  it('no line anywhere is a badge, a count or an alarm — warmth only', () => {
    const spot = buildNotificationSpot({
      ...QUIET,
      isReentry: true,
      warmth: [wave('Russ', '2026-07-24T09:00:00Z')],
      covers: [cover('Catherine', '2026-07-24T08:00:00Z')],
    });
    const all = [spot?.kicker, spot?.headline, spot?.footnote, ...spot!.lines.map((l) => l.text)].join(' ');
    expect(all).not.toMatch(/\d+ (new|unread)|\bunread\b|\(\d+\)/i);
  });
});

describe('joinNames', () => {
  it('warms up to three names, then stops counting people at you', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Russ'])).toBe('Russ');
    expect(joinNames(['Russ', 'Catherine'])).toBe('Russ and Catherine');
    expect(joinNames(['Russ', 'Catherine', 'Bo'])).toBe('Russ, Catherine and Bo');
    expect(joinNames(['Russ', 'Catherine', 'Bo', 'Ada'])).toBe('Russ, Catherine and 2 others');
  });
});

/**
 * EM1 job 2 — where a tapped notification lands.
 *
 * The property that matters is the REFUSAL: a payload missing any value
 * the cover flow actually writes with must navigate nowhere, because the
 * alternative is a cover screen that cannot cover.
 */
import { routeForNotificationData } from './notificationDeepLink';

const ASK = {
  type: 'ember_ask',
  circleId: 'circle-1',
  memberId: 'member-1',
  memberName: 'Russ',
  myName: 'Cat',
  missedDate: '2026-08-08',
};

describe('routeForNotificationData — the ember ask', () => {
  it('opens the cover flow with the circle, the member and the missed day', () => {
    expect(routeForNotificationData(ASK)).toEqual({
      pathname: '/cover',
      params: {
        circleId: 'circle-1',
        memberId: 'member-1',
        memberName: 'Russ',
        myName: 'Cat',
        missedDate: '2026-08-08',
      },
    });
  });

  it('uses a clean path, never group syntax (CLAUDE.md)', () => {
    expect(routeForNotificationData(ASK)?.pathname).toBe('/cover');
  });

  it.each(['circleId', 'memberId', 'missedDate'])(
    'navigates nowhere when %s is missing — a half-built cover screen is worse than Today',
    (key) => {
      const partial = { ...ASK } as Record<string, unknown>;
      delete partial[key];
      expect(routeForNotificationData(partial)).toBeNull();
    }
  );

  it.each(['circleId', 'memberId', 'missedDate'])(
    'navigates nowhere when %s is empty',
    (key) => {
      expect(routeForNotificationData({ ...ASK, [key]: '' })).toBeNull();
    }
  );

  it('still opens when the NAMES are missing — the cover screen has its own fallbacks', () => {
    const { memberName: _dropped, myName: _alsoDropped, ...noNames } = ASK;
    expect(routeForNotificationData(noNames)).toEqual({
      pathname: '/cover',
      params: {
        circleId: 'circle-1',
        memberId: 'member-1',
        memberName: '',
        myName: '',
        missedDate: '2026-08-08',
      },
    });
  });

  it('ignores a non-string value where a string is required', () => {
    expect(routeForNotificationData({ ...ASK, memberId: 42 })).toBeNull();
  });
});

describe('routeForNotificationData — the covered notice', () => {
  it('lands on Today, where the in-app record of a cover already lives (TN1)', () => {
    expect(routeForNotificationData({ type: 'covered_notice' })).toEqual({
      pathname: '/today',
      params: {},
    });
  });
});

describe('routeForNotificationData — everything else', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'ember_ask'],
    ['an empty object', {}],
    ['an unknown type', { type: 'nudge_daily' }],
  ])('navigates nowhere for %s', (_label, data) => {
    expect(routeForNotificationData(data)).toBeNull();
  });
});

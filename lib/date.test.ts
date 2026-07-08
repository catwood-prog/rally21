import { getLocalDateString, localDateStringInTimeZone } from './date';

describe('localDateStringInTimeZone', () => {
  it('resolves a birthday against the subject timezone across a UTC clock edge', () => {
    // 05:00 UTC on 8 July is still 7 July, 22:00 in Los Angeles — a birthday
    // must fire on the celebrant's OWN local date, not the UTC/viewer date.
    const instant = new Date('2026-07-08T05:00:00Z');
    expect(localDateStringInTimeZone('America/Los_Angeles', instant)).toBe('2026-07-07');
    expect(localDateStringInTimeZone('UTC', instant)).toBe('2026-07-08');
    // And the far side: 23:00 UTC on 7 July is already 8 July in Tokyo.
    const instant2 = new Date('2026-07-07T23:00:00Z');
    expect(localDateStringInTimeZone('Asia/Tokyo', instant2)).toBe('2026-07-08');
  });

  it('falls back to the device-local date when tz is missing or invalid', () => {
    const instant = new Date('2026-07-08T05:00:00Z');
    expect(localDateStringInTimeZone(null, instant)).toBe(getLocalDateString(instant));
    expect(localDateStringInTimeZone('Not/AZone', instant)).toBe(getLocalDateString(instant));
  });
});

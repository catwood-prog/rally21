import AsyncStorage from '@react-native-async-storage/async-storage';

import { STRINGS } from '@/constants/strings';

import {
  buildInviteLink,
  normalizeInviteCode,
  PENDING_CODE_FRESH_MS,
  savePendingInviteCode,
  takePendingInviteCode,
} from './invite-link';

const PENDING_KEY = 'rally21_pending_invite_code';

// IL1 (6 Aug). normalizeInviteCode has three call sites already (the
// landing, the join field, the link builder), which is the CLAUDE.md
// threshold for a test: a regression in it breaks the prefill, the link
// and the field at once, and only one of those is visible on screen.

describe('normalizeInviteCode — repairing what a URL did to a code', () => {
  it('uppercases, because join_circle_by_code matches on upper(code)', () => {
    expect(normalizeInviteCode('abc123')).toBe('ABC123');
  });

  it('strips whatever a channel or a pair of thumbs added', () => {
    expect(normalizeInviteCode('ABC-123')).toBe('ABC123');
    expect(normalizeInviteCode(' abc 123 ')).toBe('ABC123');
    expect(normalizeInviteCode('ABC123/')).toBe('ABC123');
    expect(normalizeInviteCode('ABC123?utm=x')).toBe('ABC123');
  });

  it('takes the first six characters and no more', () => {
    expect(normalizeInviteCode('ABC123XYZ')).toBe('ABC123');
  });

  it('is empty for anything that carries no code at all', () => {
    expect(normalizeInviteCode('')).toBe('');
    expect(normalizeInviteCode(null)).toBe('');
    expect(normalizeInviteCode(undefined)).toBe('');
    expect(normalizeInviteCode('---')).toBe('');
  });

  it('does NOT invent characters the generator never draws', () => {
    // create_circle's alphabet excludes I/L/O/0/1 to keep codes readable.
    // Normalising must not "helpfully" map O to 0 or l to 1 — a wrong
    // guess turns a typo into a valid-looking code for someone else's
    // circle. Whatever survives is handed to the server exactly as-is.
    expect(normalizeInviteCode('O0Il1')).toBe('O0IL1');
  });
});

describe('buildInviteLink — one source of truth for the link shape', () => {
  it('is rally21.com/j/<code>', () => {
    expect(buildInviteLink('ABC123')).toBe('https://rally21.com/j/ABC123');
  });

  it('normalises, so a malformed code never gets baked into a shared link', () => {
    expect(buildInviteLink('abc 123')).toBe('https://rally21.com/j/ABC123');
  });

  it('is the link the share message actually carries (drift guard)', () => {
    // The message is what a stranger receives; the route is what the app
    // answers. If these two ever stop agreeing, every invite sent in
    // between lands on +not-found and nobody finds out from a screen.
    const message = STRINGS.inviteShareMessage('Morning Movers', 'ABC123');
    expect(message).toContain(buildInviteLink('ABC123'));
    expect(STRINGS.inviteShareMessage(null, 'ABC123')).toContain(buildInviteLink('ABC123'));
  });
});

describe('the pending code — carrying an invite across sign-in', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('round-trips a saved code', async () => {
    await savePendingInviteCode('abc123');
    expect(await takePendingInviteCode()).toBe('ABC123');
  });

  it('is consumed by the first read, never left to hijack a later visit', async () => {
    await savePendingInviteCode('ABC123');
    expect(await takePendingInviteCode()).toBe('ABC123');
    expect(await takePendingInviteCode()).toBeNull();
  });

  it('is null when nothing was ever saved', async () => {
    expect(await takePendingInviteCode()).toBeNull();
  });

  it('never stores a code that normalises to nothing', async () => {
    await savePendingInviteCode('///');
    expect(await takePendingInviteCode()).toBeNull();
  });
});

/**
 * IL3 (10 Aug) — THE FRESHNESS WINDOW.
 *
 * The old design could not tell a stale code from one tapped thirty
 * seconds ago, so it protected itself with a day-zero guard — and that
 * guard is why the invite link worked only for people who had never used
 * Rally21. The stamp is what buys the guard's job back without its cost.
 *
 * These write the stored value directly rather than mocking the clock:
 * the contract under test is "what does `take` do with a value of age N",
 * and a planted value states N exactly, at any age, with no timer to
 * leak into a neighbouring test.
 */
describe('the pending code is consumable only while it is FRESH (IL3)', () => {
  const plant = (value: unknown) =>
    AsyncStorage.setItem(PENDING_KEY, typeof value === 'string' ? value : JSON.stringify(value));

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('stamps the save, so age is knowable at all', async () => {
    const before = Date.now();
    await savePendingInviteCode('abc123');
    const stored = JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) as string);
    expect(stored.code).toBe('ABC123');
    expect(stored.savedAt).toBeGreaterThanOrEqual(before);
    expect(stored.savedAt).toBeLessThanOrEqual(Date.now());
  });

  it('hands back a code saved a moment ago — the whole round trip is minutes', async () => {
    await plant({ code: 'ZUG25J', savedAt: Date.now() - 4 * 60 * 1000 });
    expect(await takePendingInviteCode()).toBe('ZUG25J');
  });

  it('hands back a code at the very edge of the window', async () => {
    await plant({ code: 'ZUG25J', savedAt: Date.now() - (PENDING_CODE_FRESH_MS - 1000) });
    expect(await takePendingInviteCode()).toBe('ZUG25J');
  });

  it('REFUSES a code older than the window — the stale-code hazard the guard named', async () => {
    await plant({ code: 'ZUG25J', savedAt: Date.now() - (PENDING_CODE_FRESH_MS + 1000) });
    expect(await takePendingInviteCode()).toBeNull();
  });

  it('refuses a code from another day entirely', async () => {
    await plant({ code: 'ZUG25J', savedAt: Date.now() - 30 * 24 * 60 * 60 * 1000 });
    expect(await takePendingInviteCode()).toBeNull();
  });

  it('CLEARS a stale code rather than leaving it to be re-tested forever', async () => {
    // The refusal above must not also mean the value survives: a code left
    // in storage is re-read on every arrival for the life of the account.
    await plant({ code: 'ZUG25J', savedAt: Date.now() - (PENDING_CODE_FRESH_MS + 1000) });
    await takePendingInviteCode();
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('refuses a bare pre-IL3 string, whose age is unknowable', async () => {
    // What a build older than this one wrote. Not fresh, because nothing
    // about it can be called fresh — cleared and refused, not trusted.
    await plant('ZUG25J');
    expect(await takePendingInviteCode()).toBeNull();
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('refuses anything malformed, and still clears it', async () => {
    for (const junk of ['{not json', '{"code":"ZUG25J"}', '{"savedAt":123}', '"ZUG25J"', 'null']) {
      await plant(junk);
      expect(await takePendingInviteCode()).toBeNull();
      expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();
    }
  });

  it('accepts a stamp in the FUTURE — that is a device clock, not an old code', async () => {
    // Refusing would make the fix silently not work for someone whose
    // clock moved backwards; accepting costs nothing, because the worst
    // case is joining the circle they just asked to join.
    await plant({ code: 'ZUG25J', savedAt: Date.now() + 60 * 1000 });
    expect(await takePendingInviteCode()).toBe('ZUG25J');
  });

  it('is still ONE-SHOT: a fresh code fires once and is gone', async () => {
    await savePendingInviteCode('ZUG25J');
    expect(await takePendingInviteCode()).toBe('ZUG25J');
    expect(await takePendingInviteCode()).toBeNull();
  });

  it('still normalises on the way out', async () => {
    await plant({ code: 'zug-25j', savedAt: Date.now() });
    expect(await takePendingInviteCode()).toBe('ZUG25J');
  });
});

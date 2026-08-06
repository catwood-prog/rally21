import AsyncStorage from '@react-native-async-storage/async-storage';

import { STRINGS } from '@/constants/strings';

import { buildInviteLink, normalizeInviteCode, savePendingInviteCode, takePendingInviteCode } from './invite-link';

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

import {
  buildEchoLine,
  buildWhisperLines,
  FreshWarmth,
  getFreshWarmth,
  getWallTeaser,
  isWallTeaserFresh,
  markWallSeen,
  markWarmthSeen,
  WHISPER_MAX_LINES,
} from './warmth';
import { supabase } from './supabase';

function warmthRow(overrides: Partial<FreshWarmth> = {}): FreshWarmth {
  return { kind: 'heart', senderName: 'Louise', createdAt: '2026-07-22T10:00:00.123456+00:00', ...overrides };
}

function chainableQuery(result: unknown) {
  const builder: any = {};
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'maybeSingle', 'update']) {
    builder[m] = jest.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

// WL2's seen-marker gate lives SERVER-side (get_my_fresh_warmth filters
// on users.warmth_seen_at, so stale warmth never crosses the API). The
// client contract these tests pin: rows returned = fresh (surface
// renders), empty = stale-or-none (surface absent entirely, null out).
describe('whisper gate (buildWhisperLines)', () => {
  it('none/stale: empty rows → null, the surface is absent entirely', () => {
    expect(buildWhisperLines([])).toBeNull();
  });

  it('fresh: one line per row, no overflow marker', () => {
    const rows = [warmthRow(), warmthRow({ kind: 'wave', senderName: 'Alex' })];
    expect(buildWhisperLines(rows)).toEqual({ lines: rows, overflowCount: 0 });
  });

  it('stacks compactly: beyond the cap folds into one overflow count', () => {
    const rows = Array.from({ length: WHISPER_MAX_LINES + 3 }, (_, i) =>
      warmthRow({ senderName: `friend-${i}`, createdAt: `2026-07-2${i}T10:00:00Z` })
    );
    const decision = buildWhisperLines(rows);
    expect(decision?.lines).toHaveLength(WHISPER_MAX_LINES);
    expect(decision?.overflowCount).toBe(3);
  });
});

describe('echo gate (buildEchoLine)', () => {
  it('none/stale: empty rows → null, no echo renders', () => {
    expect(buildEchoLine([])).toBeNull();
  });

  it('fresh: exactly one line, the newest row (rows arrive newest-first)', () => {
    const newest = warmthRow({ senderName: 'Louise' });
    const older = warmthRow({ senderName: 'Alex', createdAt: '2026-07-20T10:00:00Z' });
    expect(buildEchoLine([newest, older])).toBe(newest);
  });
});

describe('wall teaser newer-than gate (isWallTeaserFresh)', () => {
  const item = { kind: 'post' as const, userId: 'u1', body: 'hi', createdAt: '2026-07-22T10:00:00Z' };

  it('no wall item at all → nothing to tease', () => {
    expect(isWallTeaserFresh(null, null)).toBe(false);
    expect(isWallTeaserFresh(null, '2026-07-21T10:00:00Z')).toBe(false);
  });

  it('never-visited wall (null marker) → everything is newer, teaser shows', () => {
    expect(isWallTeaserFresh(item, null)).toBe(true);
    expect(isWallTeaserFresh(item, undefined)).toBe(true);
  });

  it('item newer than the last visit → shows', () => {
    expect(isWallTeaserFresh(item, '2026-07-21T10:00:00Z')).toBe(true);
  });

  it('item at or before the last visit → silent', () => {
    expect(isWallTeaserFresh(item, '2026-07-22T10:00:00Z')).toBe(false);
    expect(isWallTeaserFresh(item, '2026-07-23T10:00:00Z')).toBe(false);
  });
});

describe('warmth fetches and markers', () => {
  const rpcMock = supabase.rpc as jest.Mock;
  const fromMock = supabase.from as jest.Mock;

  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it('getFreshWarmth reads the recipient-scoped RPC and maps rows', async () => {
    rpcMock.mockResolvedValue({
      data: [{ kind: 'heart', sender_name: 'Louise', created_at: '2026-07-22T10:00:00.123456+00:00' }],
      error: null,
    });
    const rows = await getFreshWarmth();
    expect(rpcMock).toHaveBeenCalledWith('get_my_fresh_warmth');
    expect(rows).toEqual([warmthRow()]);
  });

  it('markWarmthSeen passes the newest SHOWN timestamp through verbatim — no Date round-trip may truncate the microseconds the server gate compares', async () => {
    const builder = chainableQuery({ error: null });
    fromMock.mockReturnValue(builder);
    await markWarmthSeen('user-1', '2026-07-22T10:00:00.123456+00:00');
    expect(fromMock).toHaveBeenCalledWith('users');
    expect(builder.update).toHaveBeenCalledWith({ warmth_seen_at: '2026-07-22T10:00:00.123456+00:00' });
    expect(builder.eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it("getWallTeaser reads the latest wall line someone ELSE left (posts + celebrations only — a teaser for your own post is noise)", async () => {
    const builder = chainableQuery({
      data: { kind: 'celebration', user_id: 'u2', body: 'Bo has been glowing 7 days 🔥', created_at: '2026-07-22T09:00:00Z' },
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const item = await getWallTeaser('circle-1', 'me');
    expect(fromMock).toHaveBeenCalledWith('wall_messages');
    expect(builder.in).toHaveBeenCalledWith('kind', ['post', 'celebration']);
    expect(builder.neq).toHaveBeenCalledWith('user_id', 'me');
    expect(builder.limit).toHaveBeenCalledWith(1);
    expect(item).toEqual({ kind: 'celebration', userId: 'u2', body: 'Bo has been glowing 7 days 🔥', createdAt: '2026-07-22T09:00:00Z' });
  });

  it('markWallSeen stamps via the RPC (memberships has no client UPDATE policy)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await markWallSeen('circle-1');
    expect(rpcMock).toHaveBeenCalledWith('mark_wall_seen', { p_circle_id: 'circle-1' });
  });
});

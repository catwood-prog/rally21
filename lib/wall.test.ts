import {
  displayReactionEmoji,
  getMyCircleCompletionCount,
  getWallMessages,
  getWallPreview,
  sendFriendNudge,
  subscribeToWall,
} from './wall';
import { supabase } from './supabase';

/** A minimal supabase query-builder stand-in: every method chains, and
 * awaiting the chain resolves to `result`. */
function chainableQuery(result: unknown) {
  const builder: any = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'returns']) {
    builder[m] = jest.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

// HW1: sendFriendNudge gained a second caller (the circle screen's
// gesture pills, alongside cover.tsx's wave) and a gesture kind — pin
// down that the RPC always receives an explicit p_kind, and that the
// default stays 'wave' so the untouched cover flow keeps its exact
// pre-HW1 behavior.
describe('sendFriendNudge gesture kinds', () => {
  const rpcMock = supabase.rpc as jest.Mock;

  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: 'sent', error: null });
  });

  it("defaults to kind 'wave' when no kind is given (the cover flow's call shape)", async () => {
    const result = await sendFriendNudge({
      circleId: 'circle-1',
      recipientId: 'user-2',
      localDate: '2026-07-15',
    });
    expect(result).toBe('sent');
    expect(rpcMock).toHaveBeenCalledWith('send_friend_nudge', {
      p_circle_id: 'circle-1',
      p_recipient_id: 'user-2',
      p_local_date: '2026-07-15',
      p_kind: 'wave',
    });
  });

  it("passes kind 'heart' through to the same RPC", async () => {
    await sendFriendNudge({
      circleId: 'circle-1',
      recipientId: 'user-2',
      localDate: '2026-07-15',
      kind: 'heart',
    });
    expect(rpcMock).toHaveBeenCalledWith('send_friend_nudge', {
      p_circle_id: 'circle-1',
      p_recipient_id: 'user-2',
      p_local_date: '2026-07-15',
      p_kind: 'heart',
    });
  });

  it('returns the designed warm outcomes untouched', async () => {
    rpcMock.mockResolvedValue({ data: 'already_nudged', error: null });
    await expect(
      sendFriendNudge({
        circleId: 'circle-1',
        recipientId: 'user-2',
        localDate: '2026-07-15',
        kind: 'heart',
      })
    ).resolves.toBe('already_nudged');
  });
});

// WL1: the wall is human posts + celebration lines only. Warmth
// (wave/heart) rows are recipient-private at the database; these pins
// keep the client from ever re-rendering them — including the
// recipient's own — and keep the retired checkin_reactions table out of
// every read path.
describe('WL1 wall visibility', () => {
  const fromMock = supabase.from as jest.Mock;

  beforeEach(() => {
    fromMock.mockReset();
  });

  it('getWallMessages requests only post + celebration kinds', async () => {
    const builder = chainableQuery({ data: [], error: null });
    fromMock.mockReturnValue(builder);

    await getWallMessages('circle-1');

    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith('wall_messages');
    expect(builder.in).toHaveBeenCalledWith('kind', ['post', 'celebration']);
  });

  it('getWallPreview reads only wall_messages (never checkin_reactions), same kind filter', async () => {
    const builder = chainableQuery({
      data: [
        { id: 'm2', user_id: 'u1', body: 'newer', created_at: '2026-07-21T10:00:00Z' },
        { id: 'm1', user_id: 'u2', body: 'older', created_at: '2026-07-20T10:00:00Z' },
      ],
      error: null,
    });
    fromMock.mockReturnValue(builder);

    const preview = await getWallPreview('circle-1', 3);

    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith('wall_messages');
    expect(builder.in).toHaveBeenCalledWith('kind', ['post', 'celebration']);
    // oldest first, so the newest reads last (bottom of the preview card)
    expect(preview.map((p) => p.id)).toEqual(['m1', 'm2']);
  });

  it('getMyCircleCompletionCount counts ALL kinds — covered days earn voice, mirroring the RLS gate', async () => {
    const builder = chainableQuery({ count: 7, error: null });
    fromMock.mockReturnValue(builder);

    const count = await getMyCircleCompletionCount('circle-1', 'user-1');

    expect(count).toBe(7);
    expect(fromMock).toHaveBeenCalledWith('completions');
    // scoped by circle + user and NOTHING else — no kind='self' filter
    expect(builder.eq.mock.calls).toEqual([
      ['circle_id', 'circle-1'],
      ['user_id', 'user-1'],
    ]);
  });

  it('subscribeToWall no longer listens to the retired checkin_reactions table', () => {
    const channel: any = {
      on: jest.fn(() => channel),
      subscribe: jest.fn(() => channel),
    };
    (supabase.channel as jest.Mock).mockReturnValue(channel);

    const unsubscribe = subscribeToWall('circle-1', jest.fn());

    const tables = channel.on.mock.calls.map(([, filter]: [string, { table: string }]) => filter.table);
    expect(tables).toContain('wall_messages');
    expect(tables).toContain('wall_message_reactions');
    expect(tables).not.toContain('checkin_reactions');
    unsubscribe();
  });
});

describe('displayReactionEmoji', () => {
  it('maps a historic gold-heart reaction to the new orange heart', () => {
    expect(displayReactionEmoji('💛')).toBe('🧡');
  });

  it('leaves every other stored emoji untouched', () => {
    expect(displayReactionEmoji('🎉')).toBe('🎉');
    expect(displayReactionEmoji('👏')).toBe('👏');
    expect(displayReactionEmoji('🔥')).toBe('🔥');
    expect(displayReactionEmoji('👋')).toBe('👋');
    expect(displayReactionEmoji('🧡')).toBe('🧡');
  });
});

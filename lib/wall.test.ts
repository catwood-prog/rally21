import { displayReactionEmoji, sendFriendNudge } from './wall';
import { supabase } from './supabase';

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

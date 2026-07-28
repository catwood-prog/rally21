import { getMyBlocks } from './moderation';
import { supabase } from './supabase';

/**
 * FF2 (28 July), from FF1's inventory — the blocks read is the one place in
 * this app where a swallowed failure is a SAFETY failure, not a cosmetic
 * one. Both call sites (the circle tab's who's-here, settings' blocked
 * list) used to write `getMyBlocks().catch(() => [])`, and an empty list
 * renders a blocked person as an ordinary member of the huddle — the exact
 * thing a block exists to prevent, produced by a network hiccup.
 *
 * The fix is FAIL CLOSED: the screens dropped their `.catch`, so a failed
 * read throws into each screen's existing outer catch and the screen shows
 * ER1's line instead of a wrong roster. That only holds if this function
 * genuinely REJECTS rather than resolving to an empty list, which is what
 * these pin — the contract both screens now depend on.
 */
describe('getMyBlocks fails closed', () => {
  const from = supabase.from as jest.Mock;

  beforeEach(() => {
    from.mockReset();
  });

  function mockBlocksQuery(result: { data: unknown; error: unknown }) {
    const returns = jest.fn().mockResolvedValue(result);
    const order = jest.fn().mockReturnValue({ returns });
    const select = jest.fn().mockReturnValue({ order });
    from.mockReturnValue({ select });
    return { select, order, returns };
  }

  it('REJECTS on a read error — it never resolves to "nobody is blocked"', async () => {
    mockBlocksQuery({ data: null, error: { message: 'network' } });
    await expect(getMyBlocks()).rejects.toEqual({ message: 'network' });
  });

  it('returns the blocked people when the read succeeds', async () => {
    mockBlocksQuery({
      data: [{ blocked_id: 'u-1', users: { name: 'Russ' } }],
      error: null,
    });
    await expect(getMyBlocks()).resolves.toEqual([{ blockedId: 'u-1', name: 'Russ' }]);
  });

  it('a nameless row degrades to "someone", never to being left out of the list', async () => {
    mockBlocksQuery({ data: [{ blocked_id: 'u-2', users: null }], error: null });
    await expect(getMyBlocks()).resolves.toEqual([{ blockedId: 'u-2', name: 'someone' }]);
  });
});

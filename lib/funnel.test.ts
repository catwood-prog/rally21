import { recordFunnelEvent } from './funnel';
import { supabase } from './supabase';

/**
 * AN1 job 2 — the emit helper has four call sites (profile, reminders,
 * circle-setup, invite), which is CLAUDE.md's "second caller" threshold
 * for a lib/ test. The behaviour worth pinning is not the insert itself
 * but the two ways it must refuse to matter: no session id means no row,
 * and a rejected insert must never surface as an unhandled rejection.
 * The funnel is a lens, never a gate.
 */
describe('recordFunnelEvent', () => {
  const insert = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    insert.mockReturnValue(Promise.resolve({ error: null }));
    (supabase.from as jest.Mock).mockReturnValue({ insert });
  });

  test('writes the caller id and the event key, and nothing else', () => {
    recordFunnelEvent('user-1', 'invite_share_opened');

    expect(supabase.from).toHaveBeenCalledWith('funnel_events');
    expect(insert).toHaveBeenCalledWith({ user_id: 'user-1', event: 'invite_share_opened' });
  });

  test('a signed-out or still-loading session writes nothing at all', () => {
    recordFunnelEvent(undefined, 'onboarding_profile_opened');

    expect(supabase.from).not.toHaveBeenCalled();
  });

  test('a rejected insert is swallowed, never thrown and never unhandled', async () => {
    insert.mockReturnValue(Promise.reject(new Error('offline')));

    expect(() => recordFunnelEvent('user-1', 'onboarding_profile_saved')).not.toThrow();
    // Let the rejection settle: an unhandled one here would fail the run.
    await new Promise((resolve) => setImmediate(resolve));
  });
});

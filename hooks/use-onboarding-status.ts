import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

export type OnboardingStatus = 'loading' | 'needs-profile' | 'needs-reminders-ask' | 'needs-circle' | 'ready';

/**
 * Where a signed-in user should land: straight to Today if they already
 * have a name and a circle, otherwise back into whichever onboarding step
 * they hadn't finished (covers someone who closed the app mid-setup, not
 * just first-time signups). 'needs-reminders-ask' only applies to someone
 * still mid-onboarding (no circle yet) who closed the app before finishing
 * RM1's reminders-ask step — an existing user (already has a circle) with
 * the flag unset instead sees Today's own dismissible card, never this
 * redirect (see today.tsx).
 */
export function useOnboardingStatus() {
  const { session } = useAuth();
  const [status, setStatus] = useState<OnboardingStatus>('loading');

  const refresh = useCallback(async () => {
    if (!session?.user) return;
    setStatus('loading');

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('name, reminders_ask_seen_at')
      .eq('id', session.user.id)
      .maybeSingle();

    if (profileError) console.warn('Could not load profile:', profileError.message);

    if (!profile?.name) {
      setStatus('needs-profile');
      return;
    }

    const { count, error: membershipError } = await supabase
      .from('memberships')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', session.user.id);

    if (membershipError) console.warn('Could not load memberships:', membershipError.message);

    if (count) {
      setStatus('ready');
    } else if (!profile.reminders_ask_seen_at) {
      setStatus('needs-reminders-ask');
    } else {
      setStatus('needs-circle');
    }
  }, [session?.user?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, refresh };
}

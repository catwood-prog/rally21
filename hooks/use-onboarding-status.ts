import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

export type OnboardingStatus = 'loading' | 'needs-profile' | 'needs-circle' | 'ready';

/**
 * Where a signed-in user should land: straight to Today if they already
 * have a name and a circle, otherwise back into whichever onboarding step
 * they hadn't finished (covers someone who closed the app mid-setup, not
 * just first-time signups).
 */
export function useOnboardingStatus() {
  const { session } = useAuth();
  const [status, setStatus] = useState<OnboardingStatus>('loading');

  const refresh = useCallback(async () => {
    if (!session?.user) return;
    setStatus('loading');

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('name')
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

    setStatus(count ? 'ready' : 'needs-circle');
  }, [session?.user?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, refresh };
}

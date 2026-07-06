import { supabase } from './supabase';

export type NotificationPrefs = {
  nudgeEnabled: boolean;
  /** null means "earliest committed time among the user's active circles" —
   * see Notifications spec §3. */
  nudgeTime: string | null;
  digestEnabled: boolean;
  friendNudgeEnabled: boolean;
  quietStart: string;
  quietEnd: string;
};

function mapRow(row: {
  nudge_enabled: boolean;
  nudge_time: string | null;
  digest_enabled: boolean;
  friend_nudge_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
}): NotificationPrefs {
  return {
    nudgeEnabled: row.nudge_enabled,
    nudgeTime: row.nudge_time,
    digestEnabled: row.digest_enabled,
    friendNudgeEnabled: row.friend_nudge_enabled,
    quietStart: row.quiet_start,
    quietEnd: row.quiet_end,
  };
}

export async function getMyNotificationPrefs(userId: string): Promise<NotificationPrefs | null> {
  const { data, error } = await supabase
    .from('notification_prefs')
    .select('nudge_enabled, nudge_time, digest_enabled, friend_nudge_enabled, quiet_start, quiet_end')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data) : null;
}

export async function updateNotificationPrefs(
  userId: string,
  patch: Partial<NotificationPrefs>
): Promise<void> {
  const { error } = await supabase
    .from('notification_prefs')
    .update({
      ...(patch.nudgeEnabled !== undefined ? { nudge_enabled: patch.nudgeEnabled } : {}),
      ...(patch.nudgeTime !== undefined ? { nudge_time: patch.nudgeTime } : {}),
      ...(patch.digestEnabled !== undefined ? { digest_enabled: patch.digestEnabled } : {}),
      ...(patch.friendNudgeEnabled !== undefined ? { friend_nudge_enabled: patch.friendNudgeEnabled } : {}),
      ...(patch.quietStart !== undefined ? { quiet_start: patch.quietStart } : {}),
      ...(patch.quietEnd !== undefined ? { quiet_end: patch.quietEnd } : {}),
    })
    .eq('user_id', userId);

  if (error) throw error;
}

/** Stamps `users.last_seen_at` — the social digest's "have they opened the
 * app since?" suppression check reads this (spec §4/§2), so it must be
 * fresh every time the app comes to the foreground, not just at sign-in. */
export async function markSeenNow(userId: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) console.warn('Could not update last_seen_at:', error.message);
}

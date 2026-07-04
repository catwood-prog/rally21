import { supabase } from './supabase';

export type Profile = {
  id: string;
  name: string | null;
  avatar_url: string | null;
  has_seen_checkin_consent: boolean;
  last_reentry_ack_date: string | null;
  timer_sound_muted: boolean;
};

export async function getMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, avatar_url, has_seen_checkin_consent, last_reentry_ack_date, timer_sound_muted')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function setTimerSoundMuted(userId: string, muted: boolean): Promise<void> {
  const { error } = await supabase.from('users').update({ timer_sound_muted: muted }).eq('id', userId);
  if (error) throw error;
}

/** First-ever check-in only shows the "this builds your private picture"
 * intro once — this flips the flag for good. */
export async function markCheckinConsentSeen(userId: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ has_seen_checkin_consent: true })
    .eq('id', userId);

  if (error) throw error;
}

/** Records which gap (identified by the completion date right before it)
 * the re-entry screen has been acknowledged for, so it shows once per gap
 * rather than every time Today loads until the next check-in. */
export async function markReentryAcknowledged(userId: string, lastCompletionDate: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ last_reentry_ack_date: lastCompletionDate })
    .eq('id', userId);

  if (error) throw error;
}

async function uploadAvatar(userId: string, imageUri: string): Promise<string> {
  const response = await fetch(imageUri);
  const blob = await response.blob();
  const fileExt = blob.type.split('/')[1] ?? 'jpg';
  const path = `${userId}/avatar.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, blob, { upsert: true, contentType: blob.type });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  // cache-bust so a replaced photo shows up immediately instead of the old
  // cached image at the same path
  return `${data.publicUrl}?t=${Date.now()}`;
}

export async function saveProfile(
  userId: string,
  { name, avatarUri }: { name: string; avatarUri?: string | null }
): Promise<{ avatarWarning: string | null }> {
  let avatarUrl: string | undefined;
  let avatarWarning: string | null = null;

  if (avatarUri) {
    try {
      avatarUrl = await uploadAvatar(userId, avatarUri);
    } catch {
      // photo is optional — never let a failed upload block saving the name
      avatarWarning = "your photo didn't upload, but your name is saved — try again later from settings";
    }
  }

  const { error } = await supabase
    .from('users')
    .update({
      name: name.trim(),
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    })
    .eq('id', userId);

  if (error) throw error;

  return { avatarWarning };
}

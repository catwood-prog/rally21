import { supabase } from './supabase';

export type Profile = {
  id: string;
  name: string | null;
  avatar_url: string | null;
};

export async function getMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, avatar_url')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
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

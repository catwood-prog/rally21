import { Platform } from 'react-native';

import { supabase } from './supabase';

export type Profile = {
  id: string;
  name: string | null;
  avatar_url: string | null;
  has_seen_checkin_consent: boolean;
  last_reentry_ack_date: string | null;
  sounds_enabled: boolean;
  has_seen_voice_hint: boolean;
  has_seen_cover_hint: boolean;
};

export async function getMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('users')
    .select(
      'id, name, avatar_url, has_seen_checkin_consent, last_reentry_ack_date, sounds_enabled, has_seen_voice_hint, has_seen_cover_hint'
    )
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** The single "App sounds" toggle (mascot brief) — governs both the
 * check-in timer's completion chime and the check-in success chime.
 * Default true; surfaced both in Settings and as the timer screen's own
 * quick-access mute icon, both reading/writing this same flag. */
export async function setSoundsEnabled(userId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.from('users').update({ sounds_enabled: enabled }).eq('id', userId);
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

/** The one-time "you can speak your answers" hint on the check-in screen
 * only shows until the user dismisses it or dictates once — this flips
 * the flag for good. */
export async function markVoiceHintSeen(userId: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ has_seen_voice_hint: true })
    .eq('id', userId);

  if (error) throw error;
}

/** The one-time "you can log a friend's day for them" hint under Who's
 * Here only shows until the user dismisses it or completes their first
 * cover — this flips the flag for good. */
export async function markCoverHintSeen(userId: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ has_seen_cover_hint: true })
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

const AVATAR_MAX_DIMENSION = 512;

/** Re-encodes any browser-decodable image blob into a square JPEG capped
 * at AVATAR_MAX_DIMENSION px, center-cropped to a square first. This is
 * what actually fixes HEIC photos (iPhone's default camera format):
 * Safari can decode a HEIC blob into a canvas today, but no browser can
 * ever *display* a stored .heic file directly — the uploader would see
 * their own photo fine (their browser decodes it) while every other
 * circle member saw a broken image, since re-uploading doesn't change
 * what format is sitting in storage. Re-encoding once at upload time
 * fixes it for every future viewer, not just the uploader.
 *
 * Web only — this app has no native build target yet; native
 * re-encoding would use expo-image-manipulator instead (a go-native
 * task, see DEFERRED.md). Falls back to the original blob on any
 * failure (e.g. a browser that can't decode the source format either)
 * rather than blocking the upload — callers already treat a failed
 * avatar save as non-fatal. */
async function reencodeAsJpeg(blob: Blob): Promise<Blob> {
  if (Platform.OS !== 'web') return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const cropSize = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - cropSize) / 2;
    const sy = (bitmap.height - cropSize) / 2;
    const outputSize = Math.min(cropSize, AVATAR_MAX_DIMENSION);

    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bitmap, sx, sy, cropSize, cropSize, 0, 0, outputSize, outputSize);

    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return jpeg ?? blob;
  } catch {
    return blob;
  }
}

async function uploadAvatar(userId: string, imageUri: string): Promise<string> {
  const response = await fetch(imageUri);
  const rawBlob = await response.blob();
  const blob = await reencodeAsJpeg(rawBlob);
  // Always the same path/extension now (re-encode always produces a JPEG,
  // or falls back to whatever the source was) — upsert overwrites the
  // same object on every re-upload instead of scattering avatar.heic,
  // avatar.png, etc. next to each other in storage.
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

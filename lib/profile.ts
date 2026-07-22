import { File as NativeFile } from 'expo-file-system';
import { Platform } from 'react-native';

import { STRINGS } from '@/constants/strings';

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
  has_seen_timer_background_hint: boolean;
  reminders_ask_seen_at: string | null;
  // AV1 — the one-shot photo ask (RM1's pattern): non-null once the
  // card has been interacted with, ever; it never returns.
  photo_ask_seen_at: string | null;
  has_seen_push_prompt: boolean;
  blueprint_surfaced_pattern_key: string | null;
  blueprint_surfaced_at: string | null;
  // BD1 — birthday is fully optional; birth_year (if given) is never
  // displayed or turned into an age anywhere.
  birth_month: number | null;
  birth_day: number | null;
  birth_year: number | null;
  celebrate_birthday: boolean;
  // RS2 (13 July) — non-null while self-serve paused (Rally21-Glow-
  // Spec.md §9).
  away_since: string | null;
};

export async function getMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('users')
    .select(
      'id, name, avatar_url, has_seen_checkin_consent, last_reentry_ack_date, sounds_enabled, has_seen_voice_hint, has_seen_cover_hint, has_seen_timer_background_hint, reminders_ask_seen_at, photo_ask_seen_at, has_seen_push_prompt, blueprint_surfaced_pattern_key, blueprint_surfaced_at, birth_month, birth_day, birth_year, celebrate_birthday, away_since'
    )
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export type BirthdayInput = { month: number | null; day: number | null; year: number | null };

/** BD1 — write the caller's own birthday (day + month, optional year).
 * Passing all-null clears it. The DB check constraint is the backstop for
 * an invalid pair (e.g. Feb 31); callers should also validate with
 * isValidBirthday for a friendly message first. */
export async function saveBirthday(userId: string, { month, day, year }: BirthdayInput): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ birth_month: month, birth_day: day, birth_year: year })
    .eq('id', userId);
  if (error) throw error;
}

/** BD1 — the celebrate toggle. Off means no birthday surface shows
 * anywhere (own Today, circle who's-here, digest), and circle-mates see
 * nothing — no trace. */
export async function setCelebrateBirthday(userId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ celebrate_birthday: enabled })
    .eq('id', userId);
  if (error) throw error;
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

/** T1 — the timer's "keep this screen open to hear the chime" hint only
 * shows the first time someone backgrounds the tab mid-sit, ever — this
 * flips the flag for good, same one-shot pattern as the voice/cover
 * hints above. */
export async function markTimerBackgroundHintSeen(userId: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ has_seen_timer_background_hint: true })
    .eq('id', userId);

  if (error) throw error;
}

/** RM1 — the reminders ask (onboarding step or Today card) shows at most
 * once, ever, regardless of which action (turn on / maybe later) the
 * user took — this flips the flag for good, same one-shot pattern as the
 * voice/cover/timer hints above. */
export async function markRemindersAskSeen(userId: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ reminders_ask_seen_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) throw error;
}

/** AV1 — the photo ask is one-shot forever: any interaction (add a
 * photo, keep the penguin) stamps this and the card never returns. */
export async function markPhotoAskSeen(userId: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ photo_ask_seen_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) throw error;
}

/** PN1 — the check-in-success "turn on notifications?" why-line only
 * shows once, ever, regardless of whether the user tapped Turn On or
 * dismissed it — this flips the flag for good. The real OS permission
 * decision is tracked by iOS itself (see lib/pushNotifications.ts); this
 * only gates OUR OWN soft ask card. */
export async function markPushPromptSeen(userId: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ has_seen_push_prompt: true })
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
 * Web only — native never reaches this (uploadAvatar gates to
 * uploadAvatarNative first): the picker's allowsEditing crop already
 * hands native a square JPEG, so there's nothing to re-encode there.
 * Falls back to the original blob on any failure (e.g. a browser that
 * can't decode the source format either) rather than blocking the
 * upload — callers already treat a failed avatar save as non-fatal. */
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

function cacheBustedPublicUrl(path: string): string {
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  // cache-bust so a replaced photo shows up immediately instead of the old
  // cached image at the same path
  return `${data.publicUrl}?t=${Date.now()}`;
}

/** PH1 — storage path/contentType for a native upload, straight from the
 * picked asset's uri (there's no re-encoded blob to read a type from on
 * native). Only formats every browser can display pass through; anything
 * else (heic, no extension) defaults to jpeg, which is what the picker's
 * allowsEditing crop actually emits. 'jpg' normalizes to 'jpeg' so the
 * object path matches the web path's blob-derived extension — upsert then
 * overwrites the same `avatar.jpeg` object across platforms instead of
 * leaving a stale sibling behind. */
export function avatarFilePartsFromUri(uri: string): { ext: string; contentType: string } {
  const ext = /\.([A-Za-z0-9]+)(?:[?#]|$)/.exec(uri)?.[1]?.toLowerCase();
  if (ext === 'png') return { ext: 'png', contentType: 'image/png' };
  if (ext === 'webp') return { ext: 'webp', contentType: 'image/webp' };
  return { ext: 'jpeg', contentType: 'image/jpeg' };
}

/** PH1 — the native upload path. `fetch(uri).blob()` on iOS silently
 * yields a zero-byte blob for the picker's file:// uris, and storage
 * happily accepts it — confirmed live: a 0-byte avatar.jpeg in the
 * avatars bucket from the 21 July on-device attempt. So native reads the
 * real bytes via expo-file-system (already in build 9's runtime — it
 * ships with the expo package) and an empty read throws, so the caller's
 * inline warning shows instead of a blank photo "saving" successfully. */
async function uploadAvatarNative(userId: string, imageUri: string): Promise<string> {
  const { ext, contentType } = avatarFilePartsFromUri(imageUri);
  const bytes = await new NativeFile(imageUri).bytes();
  if (bytes.byteLength === 0) {
    throw new Error('picked image read back empty');
  }

  const path = `${userId}/avatar.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, bytes.buffer, { upsert: true, contentType });

  if (uploadError) throw uploadError;
  return cacheBustedPublicUrl(path);
}

async function uploadAvatar(userId: string, imageUri: string): Promise<string> {
  if (Platform.OS !== 'web') return uploadAvatarNative(userId, imageUri);

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
  return cacheBustedPublicUrl(path);
}

/** DC1 — "delete my picture (keep streaks)": removes the stored avatar
 * object(s) and clears avatar_url, reverting to the initials fallback.
 * Never touches completions/reflections — the glow/history stay intact,
 * only the photo goes. */
export async function removeAvatar(userId: string): Promise<void> {
  const { data: files, error: listError } = await supabase.storage.from('avatars').list(userId);
  if (listError) throw listError;

  if (files && files.length > 0) {
    const paths = files.map((f) => `${userId}/${f.name}`);
    const { error: removeError } = await supabase.storage.from('avatars').remove(paths);
    if (removeError) throw removeError;
  }

  const { error } = await supabase.from('users').update({ avatar_url: null }).eq('id', userId);
  if (error) throw error;
}

export async function saveProfile(
  userId: string,
  { name, avatarUri, birthday }: { name: string; avatarUri?: string | null; birthday?: BirthdayInput }
): Promise<{ avatarWarning: string | null }> {
  let avatarUrl: string | undefined;
  let avatarWarning: string | null = null;

  if (avatarUri) {
    try {
      avatarUrl = await uploadAvatar(userId, avatarUri);
    } catch {
      // photo is optional — never let a failed upload block saving the name
      avatarWarning = STRINGS.profilePhotoUploadFailed;
    }
  }

  const { error } = await supabase
    .from('users')
    .update({
      name: name.trim(),
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      // BD1 — birthday is optional; only written when the caller passes it
      // (onboarding). All-null clears it, which is the "skipped" outcome.
      ...(birthday ? { birth_month: birthday.month, birth_day: birthday.day, birth_year: birthday.year } : {}),
    })
    .eq('id', userId);

  if (error) throw error;

  return { avatarWarning };
}

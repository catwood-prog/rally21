import AsyncStorage from '@react-native-async-storage/async-storage';

import { APP_LINK } from '@/constants/sharing';

/**
 * IL1 (6 Aug) — the coded invite link, `rally21.com/j/<code>`.
 *
 * Until now the invite message carried a bare `https://rally21.com` with
 * the code typed out beside it, so the first thing a cold arrival did was
 * copy six characters across a sign-in. This module owns the two halves of
 * removing that: BUILDING the link (one source of truth for the shape, so
 * `app/j/[code].tsx` and `STRINGS.inviteShareMessage` can never drift) and
 * CARRYING the code across the sign-in round trip, which is the only part
 * that needs storage — a magic link leaves the app entirely and comes back
 * through `auth/callback`, and an OAuth redirect leaves the origin, so a
 * code held only in React state does not survive the trip.
 *
 * The code is a shareable secret by design (anyone holding it can join),
 * which is what makes a plain path segment an acceptable place to put it —
 * but that is a posture, not an absence of consequence, so: nothing here
 * logs a code, nothing here asks the server whether a code exists, and the
 * pending code is CONSUMED (read-and-cleared) rather than left lying in
 * storage to hijack a later, unrelated visit to the setup fork.
 */

const CODE_LENGTH = 6;

// `create_circle` draws codes from 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' — 31
// unambiguous characters, no I/L/O/0/1. Normalising to [A-Z0-9] is
// deliberately WIDER than that alphabet: this is repairing what a URL, a
// messaging app or a person's thumbs did to a code, not validating it.
// Whether a code is real is the server's answer to give (join_circle_by_code
// upper()s and matches exactly), and this module never asks it early —
// answering "is this a circle?" before sign-in is a lookup oracle the
// existing join flow doesn't hand out either.
const CODE_CHARS = /[^A-Z0-9]/g;

const PENDING_CODE_KEY = 'rally21_pending_invite_code';

/** Uppercase, strip anything that isn't a code character, take the first 6. */
export function normalizeInviteCode(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.toUpperCase().replace(CODE_CHARS, '').slice(0, CODE_LENGTH);
}

/** The invite link a share message carries. Normalised so a malformed code
 * can never be baked into a link someone else has to fix by hand. */
export function buildInviteLink(code: string): string {
  return `${APP_LINK}/j/${normalizeInviteCode(code)}`;
}

/** Hold the code across sign-in. Silent on failure by FF1 rule 1: this is
 * a convenience, and the person can still type the code — a storage error
 * must not stop them reaching the sign-in screen they came here for. */
export async function savePendingInviteCode(code: string): Promise<void> {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return;
  try {
    await AsyncStorage.setItem(PENDING_CODE_KEY, normalized);
  } catch {
    // The link still shows the code on screen and the join field still
    // accepts it typed — losing this costs one prefill, never the join.
  }
}

/** Read-and-clear. One-shot on purpose: the code is spent the moment it is
 * handed to the join flow, so a code left over from an abandoned invite
 * can never redirect a later visit to the setup fork. */
export async function takePendingInviteCode(): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    if (stored) await AsyncStorage.removeItem(PENDING_CODE_KEY);
    return normalizeInviteCode(stored) || null;
  } catch {
    // Same reason as above — no pending code just means the ordinary
    // fork, which is exactly what everyone without an invite link sees.
    return null;
  }
}

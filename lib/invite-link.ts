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

/**
 * IL3 (10 Aug) — HOW LONG A SAVED CODE STAYS CONSUMABLE.
 *
 * The stamp exists because the old design could not tell "a stale code
 * lying around" from "the code they tapped thirty seconds ago", and paid
 * for the difference with a day-zero guard that made the invite link work
 * for strangers and fail silently for everyone with an account.
 *
 * THE WINDOW IS THE ROUND TRIP IT EXISTS TO BRIDGE, and nothing more: tap
 * the link, reach /sign-in, wait for an email, open it, land back in the
 * app. Its ceiling is the magic link's own lifetime — a code that has
 * outlived the link it was waiting for cannot be the code someone tapped
 * on the way to this sign-in, and this project sits at or under GoTrue's
 * recommended 1-hour email OTP expiry (no `auth_otp_long_expiry` advisory
 * against it, measured 10 Aug). Thirty minutes is comfortably inside that
 * ceiling and comfortably outside a real trip, where the email arrives in
 * seconds and the slow part is a distracted person.
 *
 * It is deliberately not hours. The hazard the day-zero guard named is
 * real — an old code must never steer an unrelated later visit — and half
 * an hour is short enough that a visit inside it is the SAME visit.
 */
export const PENDING_CODE_FRESH_MS = 30 * 60 * 1000;

type StoredPendingCode = { code: string; savedAt: number };

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

/** Hold the code across sign-in, STAMPED with the moment it was tapped.
 * Silent on failure by FF1 rule 1: this is a convenience, and the person
 * can still type the code — a storage error must not stop them reaching
 * the sign-in screen they came here for. */
export async function savePendingInviteCode(code: string): Promise<void> {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return;
  try {
    const stamped: StoredPendingCode = { code: normalized, savedAt: Date.now() };
    await AsyncStorage.setItem(PENDING_CODE_KEY, JSON.stringify(stamped));
  } catch {
    // The link still shows the code on screen and the join field still
    // accepts it typed — losing this costs one prefill, never the join.
  }
}

/**
 * Read-and-clear, and hand back the code ONLY while it is fresh.
 *
 * ONE-SHOT, unchanged: the code is spent the moment it is read, so it can
 * never fire twice. The clear happens BEFORE the freshness test, so a code
 * that has gone stale is thrown away rather than left to rot in storage
 * and be re-tested on every arrival for the rest of the account's life.
 *
 * A value with NO STAMP is a code saved by a build older than IL3, and its
 * age is unknowable. Unknowable is not fresh: it is cleared and refused.
 * That costs a prefill to anyone holding one at the moment this ships —
 * the link still works on the next tap, and it fails toward the safe side,
 * which is the whole reason the stamp exists.
 */
export async function takePendingInviteCode(): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    if (!stored) return null;
    await AsyncStorage.removeItem(PENDING_CODE_KEY);

    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      // A bare pre-IL3 string, or anything else that isn't ours.
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { code, savedAt } = parsed as Partial<StoredPendingCode>;
    if (typeof code !== 'string' || typeof savedAt !== 'number' || !Number.isFinite(savedAt)) {
      return null;
    }
    // A NEGATIVE age (a stamp in the future) means the device clock moved
    // backwards between the tap and the arrival, not that the code is old.
    // Refusing it would make the fix silently not work for that person;
    // allowing it costs nothing, since the worst case is joining the
    // circle they just asked to join with a code they already hold.
    if (Date.now() - savedAt > PENDING_CODE_FRESH_MS) return null;

    return normalizeInviteCode(code) || null;
  } catch {
    // Same reason as above — no pending code just means the ordinary
    // fork, which is exactly what everyone without an invite link sees.
    return null;
  }
}

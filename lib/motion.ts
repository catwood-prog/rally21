import { Easing } from 'react-native-reanimated';

/**
 * P1 — the feel pass (8 July 2026). Every timing/easing/amplitude number
 * touched by this pass lives here, named, so Cat's polish-iteration loop
 * can point at a name instead of hunting through component files. Nothing
 * here is itself an animation — components still own their own
 * useSharedValue/useAnimatedStyle wiring, reusing M1/G5's existing
 * reanimated mechanism (no new animation library).
 */

// The one warm ease-out MascotEntrance/G5 already use for arrivals.
export const WARM_EASE_OUT = Easing.out(Easing.cubic);
export const WARM_EASE_IN_OUT = Easing.inOut(Easing.ease);
// A gentler, sine-based ease for the ember's continuous idle breathing —
// distinct from the one-shot arrivals above, which all use cubic/back.
export const BREATHE_EASE = Easing.inOut(Easing.sin);

// --- 1. Glow beat choreography (app/(app)/glow-beat.tsx) ---
// Composed as one sequence: flame blooms -> number counts up + settles ->
// week row stagger-pops left to right -> trailing copy fades in. Total
// lands at ~1.8s, then holds completely still.
export const GLOW_BEAT = {
  FLAME_BLOOM_DURATION_MS: 380,
  FLAME_BLOOM_RISE_PX: 14,
  // The count-up doesn't start at 0 — it waits for the flame to be
  // most of the way through its own bloom, so the two read as one beat
  // rather than two unrelated things firing at once.
  NUMBER_START_DELAY_MS: 300,
  NUMBER_COUNT_UP_MS: 550,
  NUMBER_OVERSHOOT_SCALE: 1.05,
  NUMBER_SETTLE_MS: 140,
  WEEK_ROW_STAGGER_MS: 80,
  WEEK_ROW_DOT_POP_MS: 200,
  // Today's own dot (last in the row) lands slightly bigger than the
  // rest, and its check/heart mark fades in just after the pill pops.
  TODAY_DOT_SCALE: 1.08,
  TODAY_DOT_FILL_DELAY_MS: 60,
  TODAY_DOT_FILL_DURATION_MS: 160,
  COPY_FADE_MS: 250,
  // Buffer after the last dot BEGINS its pop (not after it finishes)
  // before the trailing copy line starts fading in.
  COPY_START_BUFFER_MS: 100,
} as const;

const GLOW_BEAT_LAST_DOT_INDEX = 6; // a 7-day week row, 0-indexed

/** When the number's own settle animation lands — the earliest moment
 * the week row is allowed to start, measured from the screen's own
 * mount/sequence start. */
export const GLOW_BEAT_NUMBER_LANDS_MS =
  GLOW_BEAT.NUMBER_START_DELAY_MS + GLOW_BEAT.NUMBER_COUNT_UP_MS + GLOW_BEAT.NUMBER_SETTLE_MS; // 990

export const GLOW_BEAT_WEEK_ROW_START_MS = GLOW_BEAT_NUMBER_LANDS_MS;

/** When the trailing copy (the rekindle line) may start fading in —
 * after every week-row dot has at least BEGUN its own pop. */
export const GLOW_BEAT_COPY_START_MS =
  GLOW_BEAT_WEEK_ROW_START_MS + GLOW_BEAT_LAST_DOT_INDEX * GLOW_BEAT.WEEK_ROW_STAGGER_MS + GLOW_BEAT.COPY_START_BUFFER_MS; // 1550

// --- 2. Ember breathing (components/GlowBadge.tsx) ---
// Cat's one deliberate exception to "no idle motion after arrival" — the
// ember flame breathes to mean "still alive, tend it." Amended into
// Rally21-Mascot-Brief.md's motion rules.
export const EMBER_BREATHE = {
  CYCLE_MS: 3600, // one full inhale + exhale
  SCALE_PEAK: 1.03, // <=3% amplitude, kept deliberately subtle
  OPACITY_PEAK_MULTIPLIER: 1.03,
} as const;

// --- 3. Today one-shots (today.tsx, GlowBadge.tsx, TodayFooter.tsx) ---
// State-change-only, never ambient — gated by an in-memory "already
// played today" flag (see lib/todayOneShot.ts), never replayed per visit.
export const TODAY_ONE_SHOT = {
  FLAME_FLICKER_DIM_MS: 90,
  FLAME_FLICKER_RECOVER_MS: 160,
  FLAME_FLICKER_DIM_OPACITY: 0.4,
  DOT_POP_DURATION_MS: 220,
  DOT_POP_SCALE: 1.2,
} as const;

// --- 4. Mascot one-shot gestures (checkin-complete.tsx, journey-gate.tsx,
// components/BirthdayBanner.tsx) ---
// CSS transforms layered on top of the existing M1 entrance, never a
// replacement for it. Plays once per surface visit, then holds still.
export const MASCOT_GESTURE = {
  // Starts right as check-in success's existing bouncy entrance settles
  // (that entrance's own withSequence totals 220 + 160 = 380ms).
  CHECKIN_PUFF_DELAY_MS: 380,
  CHECKIN_PUFF_UP_MS: 160,
  CHECKIN_PUFF_DOWN_MS: 220,
  CHECKIN_PUFF_SCALE: 1.06,
  CHECKIN_PUFF_HOP_PX: 6,
  // Starts once the day-21 hero's own 600ms entrance lands.
  DAY21_BOW_DELAY_MS: 600,
  DAY21_BOW_DURATION_MS: 600,
  DAY21_BOW_ROTATE_DEG: 8,
  DAY21_BOW_DIP_PX: 6,
  // BD2 (8 July) — the once-a-year birthday moment. The entrance itself
  // borrows day-21's own slower ~600ms feel (bigger than the standard
  // 350ms MascotEntrance, smaller a moment than day-21's full ceremony);
  // the hop + wiggle then starts once that entrance lands, mirroring the
  // bow's own "starts once the entrance lands" pattern above. Hop and
  // wiggle run concurrently (one combined happy bounce), each finishing
  // well under the ≤600ms budget.
  BIRTHDAY_ENTRANCE_MS: 600,
  BIRTHDAY_ENTRANCE_RISE_PX: 12,
  BIRTHDAY_HOP_DELAY_MS: 600,
  BIRTHDAY_HOP_UP_MS: 180,
  BIRTHDAY_HOP_DOWN_MS: 220,
  BIRTHDAY_HOP_HEIGHT_PX: 10,
  BIRTHDAY_WIGGLE_ROTATE_DEG: 6,
  BIRTHDAY_WIGGLE_STEP_MS: 110,
} as const;

// --- 5. Sound (lib/chime.ts) ---
// A deeper single bowl strike replaces checkin-pop on an earning
// check-in — G3 is a musical note (~196Hz), a full register below
// checkin-pop's D4 (~294Hz), timed to the glow number's settle.
export const GLOW_BEAT_BOWL_SOUND = {
  FREQUENCY_HZ: 196.0, // G3
  OVERTONE_HZ: 293.66, // D4 — a fifth above, same interval as checkin-pop's own two tones
  OVERTONE_DELAY_S: 0.06,
  DURATION_S: 1.5,
  PEAK_VOLUME: 0.09,
  OVERTONE_PEAK_VOLUME: 0.045,
} as const;

// --- 6. Haptics foundation (lib/haptics.ts) ---
export const HAPTICS = {
  TICK_MS: 8,
  THUMP_MS: 25,
  SUCCESS_MS: 40,
} as const;

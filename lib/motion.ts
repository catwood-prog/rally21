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

// --- 4b. M2 mascot gesture layer (17 July) — one-shot gestures on the
// restyled set. Quick swaps for two-frame gestures (the frame pairs
// carry slight generation jitter, so a crossfade would shimmer the whole
// penguin); the candle flame and mug steam are the two sanctioned patch
// CROSSFADES — only a small cropped region ever changes (rects +
// geometry in lib/mascotFx.ts), so the body never moves. Everything
// plays once per surface visit, then holds still; static under
// prefers-reduced-motion; the ember breathe stays the app's only idle
// loop.
export const MASCOT_FX = {
  // (a) Check-in success wink — P3 (21 July, Cat's on-device review:
  // "it flashes so fast we don't really see it"). The ~120ms swap
  // becomes a readable beat: the entrance (380ms) + puff/hop (380ms
  // more) settle at ~760ms, then a ~300ms beat so the eye is already on
  // the penguin, then the wink frame HOLDS ~400ms before swapping back.
  // Still one shot, still stacked pre-mounted frames.
  WINK_DELAY_MS: 1060,
  WINK_HOLD_MS: 400,
  WINK_SWAPS: 1,
  // (a) The small banner-scoped green burst replacing the confetti that
  // used to be baked into the art — deliberately smaller than the
  // screen's own P2 depth layers so it reads as the penguin's own
  // sparkle, not a second storm.
  CHECKIN_BANNER_CONFETTI_COUNT: 10,
  // (c) Birthday candle flicker: the cropped flame patch crossfades
  // between the two frames for ~2s once the entrance lands, then holds
  // on the base frame.
  CANDLE_FLICKER_DELAY_MS: 600, // = BIRTHDAY_HOP_DELAY_MS, the entrance's landing
  CANDLE_FLICKER_STEP_MS: 250,
  CANDLE_FLICKER_CYCLES: 4, // 4 in/out crossfades ≈ 2000ms total
  // (d) Ask Rally listener steam: the patch fades in once and holds on
  // the steam frame.
  STEAM_DELAY_MS: 350, // after the standard MascotEntrance settles
  STEAM_FADE_MS: 2500,
  // (e) 404 wave: two quick swaps to the wave frame and back.
  WAVE_DELAY_MS: 350,
  WAVE_HOLD_MS: 150,
  WAVE_SWAPS: 2,
  // (f) Cover screen: one gentle squeeze when a cover lands, ≤300ms
  // total, then the navigation away proceeds.
  COVER_SQUEEZE_SCALE: 0.98,
  COVER_SQUEEZE_IN_MS: 130,
  COVER_SQUEEZE_OUT_MS: 150,
} as const;

// --- 4c. FL1 (21 July) — the glow-beat flame FLICKERS, not wobbles.
// Cat's on-device review of M2's (g): "flame just kind of wobbles rather
// than flickers." The decaying rotation wobble is replaced by a real
// flicker vocabulary: one brief FLARE timed exactly where the old wobble
// triggered (the count-up settle, so the choreography's beat survives),
// then irregular hand-authored keyframes layering quick scale-Y
// stretches (the flame reaching), small rotation jitter, and an opacity
// shimmer — uneven intervals, never a metronome, fully deterministic
// (no Math.random at render). The whole thing decays to complete
// stillness in ≈2.5s: still a ONE-shot per glow-beat, the 10s-stillness
// law holds, and the ember breathe stays the app's only idle loop.
// Reduced motion renders the flame fully static (glow-beat's guard).
export const FLAME_FLICKER = {
  // The flare: a single larger bloom, ~250ms total.
  FLARE_SCALE: 1.15,
  FLARE_UP_MS: 110,
  FLARE_DOWN_MS: 140,
  // Amplitude caps the step table's 0–1 fractions scale against.
  STRETCH_MAX: 0.07, // scaleY 1.00–1.07
  TILT_MAX_DEG: 3, // rotation jitter ≤ ±3°
  OPACITY_MIN: 0.92, // shimmer floor
  // The irregular keyframes, hand-authored: [durationMs, stretch, tilt,
  // dim] — stretch/dim are 0–1 fractions of the caps, tilt is a SIGNED
  // fraction of TILT_MAX_DEG. Uneven 80–200ms intervals are the point.
  // A linear decay envelope (1 → 0 across the table) multiplies every
  // amplitude, so the last frames are already near-still; the sequence
  // then lands on exact identity. Durations sum to ~2200ms; with the
  // 250ms flare the whole flicker is ≈2.5s.
  STEPS: [
    [90, 0.9, -0.6, 0.7],
    [160, 0.35, 0.8, 0.2],
    [80, 1.0, -0.3, 0.9],
    [200, 0.25, 0.5, 0.3],
    [120, 0.8, -0.9, 0.6],
    [90, 0.5, 0.2, 1.0],
    [180, 0.7, -0.5, 0.4],
    [110, 0.3, 0.7, 0.8],
    [150, 0.55, -0.8, 0.3],
    [100, 0.35, 0.4, 0.6],
    [170, 0.5, -0.2, 0.5],
    [140, 0.25, 0.35, 0.4],
    [190, 0.4, -0.45, 0.3],
    [130, 0.2, 0.25, 0.5],
    [140, 0.3, -0.3, 0.2],
    [150, 0.15, 0.15, 0.3],
  ],
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

// --- 7. Breathing pacer (components/BreathingPacer.tsx, BR1 16 July) ---
// Cat's timer-screen breathing circle (Apple-Breathe family): swells on
// the in-breath, settles on the longer out-breath, continuously, for the
// whole sit. Cadence v1 is 4s in / 6s out with no holds (longer exhale =
// the calming pattern) — BREATH_IN_MS/BREATH_OUT_MS exist precisely so
// Cat can retune after feeling it. Calm, not celebration: gentle scale,
// soft gold, eased both ways (lib/breathing.ts's easeInOutSine — the
// same curve as BREATHE_EASE above), no bounce.
export const BREATHING_PACER = {
  BREATH_IN_MS: 4000,
  BREATH_OUT_MS: 6000,
  // The halo sits behind the 186px timer ring: flush with it when
  // settled, swelling past it to ~316px at a full breath. BR2 (20 July,
  // Cat's live feel of a real timed sit): amplitude doubled, 0.35 →
  // 0.70 — "100% more exaggerated... expand wider in that time" — on
  // the SAME 4s/6s clock.
  CIRCLE_SIZE: 186,
  SCALE_MIN: 1.0,
  SCALE_MAX: 1.7,
  // Fill is colors.gold; these opacities keep it in goldSoft territory
  // (goldSoft itself is gold at 0.15) so the countdown stays the most
  // readable thing on screen at every point of the cycle.
  CIRCLE_OPACITY_MIN: 0.08,
  CIRCLE_OPACITY_MAX: 0.18,
  // prefers-reduced-motion: the whole pacer goes fully static (P1's
  // convention — even the ember's opacity breathing stops) — one soft
  // ring at the cycle's midpoint opacity, no scale, no phase labels
  // (a frozen "breathe in/out" would be misleading guidance).
  CIRCLE_OPACITY_STATIC: 0.13,
  // The "breathe in"/"breathe out" label handover, starting exactly at
  // each phase boundary — derived from the same clock as the scale so
  // the two can never drift (lib/breathing.ts).
  LABEL_FADE_MS: 500,
} as const;

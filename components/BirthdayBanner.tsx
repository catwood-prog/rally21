import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { MASCOT } from '@/assets/mascot';
import { ConfettiBurst } from '@/components/ConfettiBurst';
import { MascotPatch } from '@/components/MascotPatch';
import { FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors, CONFETTI_GREENS } from '@/constants/theme';
import { getLocalDateString } from '@/lib/date';
import { BIRTHDAY_CANDLE_PATCH } from '@/lib/mascotFx';
import { MASCOT_FX, MASCOT_GESTURE, WARM_EASE_IN_OUT, WARM_EASE_OUT } from '@/lib/motion';
import { hasPlayedTodayOneShot, markTodayOneShotPlayed } from '@/lib/todayOneShot';

// A once-a-year moment earns a bigger burst than the daily check-in beat
// — same weight as day-21's own ceremony, reusing its exact palette.
const CONFETTI_COUNT = 34;
// M2: always green (CONFETTI_GREENS is the one source of truth).
const CONFETTI_COLORS = [...CONFETTI_GREENS];

/** BD2 (8 July) — the user's own birthday moment on Today, upgraded from
 * BD1's plain standard-entrance penguin to a once-a-year celebration
 * built entirely from existing motion vocabulary: a slower fade-up
 * (day-21's own ~600ms feel), one confetti burst (extracted from
 * journey-gate.tsx into components/ConfettiBurst.tsx so this reuses it
 * rather than a second implementation), then a happy hop + wiggle as the
 * entrance settles (mirroring the day-21 bow's own "starts once the
 * entrance lands" pattern) — then holds still, per the mascot brief's
 * motion law. Still a legitimate mascot placement per the brief (an
 * emotional peak, once a year); only mounted on the birthday itself, so
 * the penguin still appears at most once on a normal day.
 *
 * ONCE PER LOCAL DATE: the full sequence (entrance + confetti + gesture)
 * plays only the first time this component mounts on a given local date
 * — reusing lib/todayOneShot.ts's existing in-memory tracker (P1's own
 * "once per visit-day" mechanism, not a parallel one) keyed under the
 * 'birthday' kind so it can never collide with the glow one-shot on the
 * same day. A later Today visit the same day still renders the banner,
 * just without replaying the sequence. */
export function BirthdayBanner({ name }: { name: string | null }) {
  const reduceMotion = useReducedMotion();
  const today = getLocalDateString();
  const [playFullSequence] = useState(() => !hasPlayedTodayOneShot('birthday', today));

  useEffect(() => {
    if (playFullSequence) markTodayOneShotPlayed('birthday', today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const playMotion = playFullSequence && !reduceMotion;

  const opacity = useSharedValue(playMotion ? 0 : 1);
  const rise = useSharedValue(playMotion ? MASCOT_GESTURE.BIRTHDAY_ENTRANCE_RISE_PX : 0);
  const hopY = useSharedValue(0);
  const wiggle = useSharedValue(0);
  // M2 (c) — the candle flicker: ONLY the cropped flame patch crossfades
  // between the two frames (the sanctioned patch exception — the body
  // never moves), for ~2s once the entrance lands, then holds base.
  const flickerOpacity = useSharedValue(0);

  useEffect(() => {
    if (!playMotion) return;
    opacity.value = withTiming(1, { duration: MASCOT_GESTURE.BIRTHDAY_ENTRANCE_MS, easing: WARM_EASE_OUT });
    rise.value = withTiming(0, { duration: MASCOT_GESTURE.BIRTHDAY_ENTRANCE_MS, easing: WARM_EASE_OUT });

    hopY.value = withDelay(
      MASCOT_GESTURE.BIRTHDAY_HOP_DELAY_MS,
      withSequence(
        withTiming(-MASCOT_GESTURE.BIRTHDAY_HOP_HEIGHT_PX, {
          duration: MASCOT_GESTURE.BIRTHDAY_HOP_UP_MS,
          easing: WARM_EASE_OUT,
        }),
        withTiming(0, { duration: MASCOT_GESTURE.BIRTHDAY_HOP_DOWN_MS, easing: WARM_EASE_IN_OUT })
      )
    );
    wiggle.value = withDelay(
      MASCOT_GESTURE.BIRTHDAY_HOP_DELAY_MS,
      withSequence(
        withTiming(MASCOT_GESTURE.BIRTHDAY_WIGGLE_ROTATE_DEG, {
          duration: MASCOT_GESTURE.BIRTHDAY_WIGGLE_STEP_MS,
          easing: WARM_EASE_OUT,
        }),
        withTiming(-MASCOT_GESTURE.BIRTHDAY_WIGGLE_ROTATE_DEG, {
          duration: MASCOT_GESTURE.BIRTHDAY_WIGGLE_STEP_MS,
          easing: WARM_EASE_IN_OUT,
        }),
        withTiming(0, { duration: MASCOT_GESTURE.BIRTHDAY_WIGGLE_STEP_MS, easing: WARM_EASE_IN_OUT })
      )
    );

    // The candle flicker (M2): in/out patch crossfades, decidedly finite
    // — CANDLE_FLICKER_CYCLES round trips, then 0 (base frame) forever.
    const steps = [];
    for (let i = 0; i < MASCOT_FX.CANDLE_FLICKER_CYCLES; i++) {
      steps.push(withTiming(1, { duration: MASCOT_FX.CANDLE_FLICKER_STEP_MS, easing: WARM_EASE_IN_OUT }));
      steps.push(withTiming(0, { duration: MASCOT_FX.CANDLE_FLICKER_STEP_MS, easing: WARM_EASE_IN_OUT }));
    }
    flickerOpacity.value = withDelay(
      MASCOT_FX.CANDLE_FLICKER_DELAY_MS,
      withSequence(steps[0], ...steps.slice(1))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flickerStyle = useAnimatedStyle(() => ({ opacity: flickerOpacity.value }));

  const mascotStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: rise.value }, { translateY: hopY.value }, { rotate: `${wiggle.value}deg` }],
  }));

  return (
    <View style={styles.wrap}>
      {playFullSequence && (
        <ConfettiBurst count={CONFETTI_COUNT} colors={CONFETTI_COLORS} reduceMotion={reduceMotion} />
      )}
      <Animated.View style={mascotStyle}>
        <View style={styles.mascotBox}>
          <Image source={MASCOT.birthdayPenguin} style={styles.mascot} resizeMode="contain" accessible={false} alt="" />
          <MascotPatch
            source={MASCOT.birthdayPenguinFlicker}
            sourceSize={BIRTHDAY_CANDLE_PATCH.source}
            patch={BIRTHDAY_CANDLE_PATCH.patch}
            box={{ width: 150, height: 165 }}
            animatedStyle={flickerStyle}
          />
        </View>
      </Animated.View>
      <Text style={styles.line}>{STRINGS.birthdaySelfLine(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 14,
  },
  // 150x165 — aspect-matched to the real asset (617x680, ~0.907), inside
  // the requested 140-160px range: bigger than check-in's 130x134
  // pat-on-the-back, smaller than day-21's 180x160 hero, since a
  // birthday is a real but smaller-scale celebration than finishing all
  // 21 days.
  mascotBox: {
    width: 150,
    height: 165,
  },
  mascot: {
    width: 150,
    height: 165,
  },
  line: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 22,
    color: colors.ink,
    marginTop: 4,
    textAlign: 'center',
  },
});

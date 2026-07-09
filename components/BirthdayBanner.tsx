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
import { FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { getLocalDateString } from '@/lib/date';
import { MASCOT_GESTURE, WARM_EASE_IN_OUT, WARM_EASE_OUT } from '@/lib/motion';
import { hasPlayedTodayOneShot, markTodayOneShotPlayed } from '@/lib/todayOneShot';

// A once-a-year moment earns a bigger burst than the daily check-in beat
// — same weight as day-21's own ceremony, reusing its exact palette.
const CONFETTI_COUNT = 34;
const CONFETTI_COLORS = [colors.gold, colors.green, colors.ink];

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <Image source={MASCOT.birthdayPenguin} style={styles.mascot} resizeMode="contain" accessible={false} alt="" />
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

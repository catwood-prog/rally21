import { ReactNode, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { breathProgressAt, inLabelOpacityAt } from '@/lib/breathing';
import { BREATHING_PACER } from '@/lib/motion';

/**
 * BR1 (16 July) — the breathing pacer. Wraps the timer ring: a soft gold
 * circle behind it swells on the in-breath and settles on the out-breath
 * while a quiet label crossfades between the phases. One shared value —
 * a linear clock over the breath cycle — drives circle scale, circle
 * opacity, and both labels through lib/breathing.ts's pure phase
 * functions, so nothing can drift out of sync with anything else.
 *
 * prefers-reduced-motion: fully static, matching how every P1 surface
 * treats the setting (even the ember's opacity breathing stops) — one
 * soft ring at the cycle's midpoint opacity, no scale, and no phase
 * labels, since Reanimated's global reduce-motion handling would freeze
 * the clock and leave a permanently wrong "breathe in/out" on screen.
 * The clock is simply never started.
 */

const { BREATH_IN_MS, BREATH_OUT_MS, LABEL_FADE_MS } = BREATHING_PACER;
const CYCLE_MS = BREATH_IN_MS + BREATH_OUT_MS;

export function BreathingPacer({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  // Milliseconds into the breath cycle — the one clock everything below
  // derives from.
  const clock = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    clock.value = 0;
    clock.value = withRepeat(
      withTiming(CYCLE_MS, { duration: CYCLE_MS, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(clock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const haloStyle = useAnimatedStyle(() => {
    const p = breathProgressAt(clock.value, BREATH_IN_MS, BREATH_OUT_MS);
    return {
      opacity:
        BREATHING_PACER.CIRCLE_OPACITY_MIN +
        (BREATHING_PACER.CIRCLE_OPACITY_MAX - BREATHING_PACER.CIRCLE_OPACITY_MIN) * p,
      transform: reduceMotion
        ? []
        : [{ scale: BREATHING_PACER.SCALE_MIN + (BREATHING_PACER.SCALE_MAX - BREATHING_PACER.SCALE_MIN) * p }],
    };
  });

  const inLabelStyle = useAnimatedStyle(() => ({
    opacity: inLabelOpacityAt(clock.value, BREATH_IN_MS, BREATH_OUT_MS, LABEL_FADE_MS),
  }));
  const outLabelStyle = useAnimatedStyle(() => ({
    opacity: 1 - inLabelOpacityAt(clock.value, BREATH_IN_MS, BREATH_OUT_MS, LABEL_FADE_MS),
  }));

  if (reduceMotion) {
    return (
      <View style={styles.wrap}>
        <View style={styles.stack}>
          <View
            pointerEvents="none"
            style={[styles.halo, { opacity: BREATHING_PACER.CIRCLE_OPACITY_STATIC }]}
          />
          {children}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.stack}>
        <Animated.View pointerEvents="none" style={[styles.halo, haloStyle]} />
        {children}
      </View>
      <View
        style={styles.labelWrap}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Animated.Text style={[styles.label, inLabelStyle]}>{STRINGS.pacerBreatheIn}</Animated.Text>
        <Animated.Text style={[styles.label, styles.labelOverlay, outLabelStyle]}>
          {STRINGS.pacerBreatheOut}
        </Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  stack: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: BREATHING_PACER.CIRCLE_SIZE,
    height: BREATHING_PACER.CIRCLE_SIZE,
    borderRadius: BREATHING_PACER.CIRCLE_SIZE / 2,
    backgroundColor: colors.gold,
  },
  labelWrap: {
    marginTop: 12,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 15,
    color: 'rgba(255,255,255,0.65)',
  },
  labelOverlay: {
    position: 'absolute',
  },
});

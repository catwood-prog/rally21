import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { GlowDetailSheet } from '@/components/GlowDetailSheet';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { Glow } from '@/lib/glow';
import { BREATHE_EASE, EMBER_BREATHE, TODAY_ONE_SHOT } from '@/lib/motion';

/** The Today header's small flame (Rally21-Glow-Spec.md §1-2) — quiet
 * pride, not a billboard. Renders nothing for a cold streak or a
 * zero-day glow (no pressure on day one); tapping opens the 3-sentence
 * explainer. `coveredByName` is only passed when today's own slot was
 * held by a cover — shown as a small heart here, with the full note in
 * the detail sheet.
 *
 * P1 (8 July): the embers flame breathes — Cat's one deliberate
 * exception to "no idle motion after arrival" (see
 * Rally21-Mascot-Brief.md's amended motion rules) — and `flickerOnce`
 * plays a single one-shot flicker the first time Today renders with the
 * day already earned (wired from today.tsx's own in-memory tracker, see
 * lib/todayOneShot.ts, so it never replays on a later visit). */
export function GlowBadge({
  glow,
  coveredByName,
  flickerOnce,
}: {
  glow: Glow | null;
  coveredByName?: string | null;
  flickerOnce?: boolean;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const reduceMotion = useReducedMotion();

  const isEmbers = !!glow && glow.state === 'embers';

  const breatheScale = useSharedValue(1);
  const breatheOpacity = useSharedValue(1);
  const flicker = useSharedValue(1);

  useEffect(() => {
    if (!isEmbers || reduceMotion) {
      breatheScale.value = 1;
      breatheOpacity.value = 1;
      return;
    }
    const half = EMBER_BREATHE.CYCLE_MS / 2;
    breatheScale.value = withRepeat(
      withSequence(
        withTiming(EMBER_BREATHE.SCALE_PEAK, { duration: half, easing: BREATHE_EASE }),
        withTiming(1, { duration: half, easing: BREATHE_EASE })
      ),
      -1,
      false
    );
    breatheOpacity.value = withRepeat(
      withSequence(
        withTiming(EMBER_BREATHE.OPACITY_PEAK_MULTIPLIER, { duration: half, easing: BREATHE_EASE }),
        withTiming(1, { duration: half, easing: BREATHE_EASE })
      ),
      -1,
      false
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmbers, reduceMotion]);

  useEffect(() => {
    if (!flickerOnce || reduceMotion) return;
    flicker.value = withSequence(
      withTiming(TODAY_ONE_SHOT.FLAME_FLICKER_DIM_OPACITY, {
        duration: TODAY_ONE_SHOT.FLAME_FLICKER_DIM_MS,
        easing: Easing.out(Easing.ease),
      }),
      withTiming(1, { duration: TODAY_ONE_SHOT.FLAME_FLICKER_RECOVER_MS, easing: Easing.inOut(Easing.ease) })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flickerOnce, reduceMotion]);

  const flameAnimatedStyle = useAnimatedStyle(() => ({
    opacity: breatheOpacity.value * flicker.value * (isEmbers ? 0.6 : 1),
    transform: [{ scale: breatheScale.value }],
  }));

  if (!glow || glow.state === 'cold' || (glow.state === 'glowing' && glow.glow === 0)) {
    return null;
  }

  return (
    <>
      <TouchableOpacity style={styles.row} onPress={() => setShowDetail(true)} hitSlop={6}>
        <Animated.Text style={[styles.flame, flameAnimatedStyle]}>🔥</Animated.Text>
        <Text style={[styles.label, isEmbers && styles.labelEmbers]}>
          {isEmbers ? STRINGS.glowEmbersLabel : STRINGS.glowGlowingLabel(glow.glow)}
        </Text>
        {!isEmbers && glow.heldToday && <Text style={styles.heart}>💛</Text>}
      </TouchableOpacity>
      <GlowDetailSheet
        visible={showDetail}
        onDismiss={() => setShowDetail(false)}
        heldTodayMessage={
          !isEmbers && glow.heldToday && coveredByName ? STRINGS.glowHeldTodayNote(coveredByName) : null
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
    marginBottom: 6,
  },
  flame: {
    fontSize: 13,
  },
  label: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.gold,
  },
  labelEmbers: {
    color: colors.goldMuted,
    fontWeight: '600',
  },
  heart: {
    fontSize: 12,
  },
});

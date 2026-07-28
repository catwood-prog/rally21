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

  // PA3 job 4 — THREE STATES, NOT TWO (memo §5.3). A sheltered day is
  // HELD, never embers: embers means at risk, and a pebble has already
  // resolved it, so breathing an ember flame over a held day would be a
  // warning about a situation that no longer exists. The pebble is the
  // marker — it sits where the practice would have been.
  //
  // Multi-day ember decay is gone from this badge as a CONSEQUENCE rather
  // than a special case: a gap is now pebble-held server-side, so the run
  // does not break and `state` never leaves 'glowing' across it. What is
  // left of embers is the grace for an empty nest, which is rare.
  const isEmbers = !!glow && glow.state === 'embers';
  const isPebbleHeld = !!glow && glow.heldToday && glow.heldByToday === 'pebble';
  const isCoverHeld = !!glow && glow.heldToday && glow.heldByToday === 'cover';

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

  // PA3 (memo §5.1) — when a run ends, the flame goes out and the LONGEST
  // RALLY appears in its place. "You return to a live number of 1 and a
  // permanent record of 40": nothing is taken and nothing is falsely
  // claimed, so the loss is structural rather than emotional. No flame
  // glyph here — 🔥 is the live run's mark and never sits on a number
  // that survived a broken run (CY1's no-flame law).
  if (glow && glow.state === 'cold' && glow.longestRally > 0) {
    return (
      <>
        <TouchableOpacity style={styles.row} onPress={() => setShowDetail(true)} hitSlop={6}>
          <Text style={styles.labelEmbers}>{STRINGS.glowLongestRallyKept(glow.longestRally)}</Text>
        </TouchableOpacity>
        <GlowDetailSheet
          visible={showDetail}
          onDismiss={() => setShowDetail(false)}
          heldTodayMessage={null}
          pebbles={glow.pebbles}
        />
      </>
    );
  }

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
        {/* The mark says WHAT held the day: a heart for a friend's cover,
            a pebble for your own nest. An away pause keeps the heart it
            shipped with — RS2 owns that state, not PA3. */}
        {!isEmbers && glow.heldToday && (
          <Text style={styles.heart}>{isPebbleHeld ? STRINGS.pebbleMark : '🧡'}</Text>
        )}
      </TouchableOpacity>
      <GlowDetailSheet
        visible={showDetail}
        onDismiss={() => setShowDetail(false)}
        pebbles={glow.pebbles}
        heldTodayMessage={
          isEmbers || !glow.heldToday
            ? null
            : isPebbleHeld
              ? STRINGS.glowHeldTodayPebbleNote
              : isCoverHeld && coveredByName
                ? STRINGS.glowHeldTodayNote(coveredByName)
                : null
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
  // OD1 job 10b — the glow's count and its embers state are INFORMATION,
  // and both were unreadable: gold on card is 1.59:1 and goldMuted worse
  // still. Gold-ness here was decoration — the 🔥 beside the label already
  // carries it, and the flame is untouched — so the words take ink, and
  // embers stays quieter than glowing via mutedStrong (5.29:1) rather
  // than via a colour nobody can read. Never red; the flame just quiets.
  label: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.ink,
  },
  labelEmbers: {
    color: colors.mutedStrong,
    fontWeight: '600',
  },
  heart: {
    fontSize: 12,
  },
});

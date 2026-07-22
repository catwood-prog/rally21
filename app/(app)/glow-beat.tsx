import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Brandmark } from '@/components/Brandmark';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { playGlowBeatBowl } from '@/lib/chime';
import * as haptics from '@/lib/haptics';
import { didRekindleToday, getMyGlow, getMyWeek, WeekDay } from '@/lib/glow';
import {
  FLAME_FLICKER,
  GLOW_BEAT,
  GLOW_BEAT_COPY_START_MS,
  GLOW_BEAT_NUMBER_LANDS_MS,
  GLOW_BEAT_WEEK_ROW_START_MS,
  WARM_EASE_IN_OUT,
  WARM_EASE_OUT,
} from '@/lib/motion';
import { getMyProfile } from '@/lib/profile';

function WeekSlot({
  day,
  index,
  isToday,
  reduceMotion,
  sequenceStartAt,
}: {
  day: WeekDay;
  index: number;
  isToday: boolean;
  reduceMotion: boolean;
  sequenceStartAt: number;
}) {
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const scale = useSharedValue(reduceMotion ? 1 : 0.6);
  const markOpacity = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) return;
    // Elapsed-aware: the week row's own start is anchored to the beat's
    // sequence clock (after the number lands), not to whenever this data
    // happened to arrive — so a slightly slow fetch never breaks the
    // intended order, and a fast one never fires before the number is done.
    const elapsed = Date.now() - sequenceStartAt;
    const plannedDelay = GLOW_BEAT_WEEK_ROW_START_MS + index * GLOW_BEAT.WEEK_ROW_STAGGER_MS;
    const delay = Math.max(0, plannedDelay - elapsed);
    const landingScale = isToday ? GLOW_BEAT.TODAY_DOT_SCALE : 1;

    opacity.value = withDelay(delay, withTiming(1, { duration: GLOW_BEAT.WEEK_ROW_DOT_POP_MS }));
    scale.value = withDelay(
      delay,
      withTiming(landingScale, { duration: GLOW_BEAT.WEEK_ROW_DOT_POP_MS, easing: Easing.out(Easing.back(1.5)) })
    );
    // Today's own mark (check/heart) draws in just after its pill pops,
    // rather than appearing instantly with it.
    markOpacity.value = withDelay(
      delay + GLOW_BEAT.TODAY_DOT_FILL_DELAY_MS,
      withTiming(1, { duration: GLOW_BEAT.TODAY_DOT_FILL_DURATION_MS })
    );

    const tickTimer = setTimeout(() => haptics.tick({ reduceMotion }), delay);
    return () => clearTimeout(tickTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  const markStyle = useAnimatedStyle(() => ({ opacity: markOpacity.value }));

  const [y, m, d] = day.date.split('-').map(Number);
  const weekdayInitial = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'narrow' });
  const pillStyle =
    day.state === 'earned' ? styles.slotPillEarned : day.state === 'held' ? styles.slotPillHeld : styles.slotPillNone;

  return (
    <View style={styles.slot}>
      <Text style={styles.slotWeekday}>{weekdayInitial}</Text>
      <Animated.View style={[styles.slotPill, pillStyle, style]}>
        {day.state === 'earned' && <Animated.Text style={[styles.slotEarnedMark, markStyle]}>✓</Animated.Text>}
        {day.state === 'held' && <Animated.Text style={[styles.slotHeldMark, markStyle]}>🧡</Animated.Text>}
        {day.state === 'none' && <View style={styles.slotNoneDot} />}
      </Animated.View>
    </View>
  );
}

/** G5 — the glow moment (Rally21-Glow-Spec.md §1): a Duolingo-style beat
 * shown only on the check-in that earns the day (see
 * lib/glow.ts's shouldShowGlowBeat, checked by checkin-complete.tsx
 * before ever routing here). Never blocks — a load failure still leaves
 * the continue button reachable, landing on Today same as always.
 *
 * P1 (8 July): the flame bloom, number count-up/settle, week-row
 * stagger, and trailing copy are one composed sequence (timings named in
 * lib/motion.ts's GLOW_BEAT), not three things appearing independently.
 * The number's settle plays a deeper single bowl strike (playGlowBeatBowl)
 * that REPLACES checkin-pop for this check-in — checkin-complete.tsx
 * suppresses its own chime whenever it knows it's routing here, so this
 * is the only sound this check-in makes. Milestone glow beats never
 * happen at all (shouldShowGlowBeat is false whenever hasMilestone is
 * true), so there's no sound to compose with the G3 milestone here. */
export default function GlowBeat() {
  const router = useRouter();
  // NAV1 job 0 — celebration screens are AppHeader-exempt, never safe-area-exempt.
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const reduceMotion = useReducedMotion();
  // Anchors the whole choreography's timing regardless of how fast/slow
  // getMyGlow/getMyWeek resolve — see WeekSlot's own elapsed-aware delay.
  const sequenceStartAt = useRef(Date.now()).current;

  const [glowNumber, setGlowNumber] = useState<number | null>(null);
  const [week, setWeek] = useState<WeekDay[] | null>(null);
  const [displayCount, setDisplayCount] = useState(0);
  const soundsEnabledRef = useRef(true);

  useEffect(() => {
    Promise.all([getMyGlow(), getMyWeek()])
      .then(([glow, weekRows]) => {
        setGlowNumber(glow.glow);
        setWeek(weekRows);
      })
      .catch(() => {
        // the beat never blocks — worst case it shows a bare "keep it
        // glowing" button with no number/week row, still lands on Today
      });
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    getMyProfile(session.user.id)
      .then((profile) => {
        soundsEnabledRef.current = profile?.sounds_enabled ?? true;
      })
      .catch(() => {
        // default (sound on) already set — low-stakes either way
      });
  }, [session?.user?.id]);

  const numberScale = useSharedValue(1);
  const landedRef = useRef(false);

  useEffect(() => {
    if (glowNumber === null) return;
    if (reduceMotion) {
      setDisplayCount(glowNumber);
      if (!landedRef.current) {
        landedRef.current = true;
        if (soundsEnabledRef.current) playGlowBeatBowl();
        haptics.thump({ reduceMotion });
      }
      return;
    }

    let raf: ReturnType<typeof requestAnimationFrame>;
    const startTimer = setTimeout(() => {
      const start = Date.now();
      const tick = () => {
        const progress = Math.min(1, (Date.now() - start) / GLOW_BEAT.NUMBER_COUNT_UP_MS);
        setDisplayCount(Math.round(progress * glowNumber));
        if (progress < 1) {
          raf = requestAnimationFrame(tick);
          return;
        }
        if (landedRef.current) return;
        landedRef.current = true;
        numberScale.value = withSequence(
          withTiming(GLOW_BEAT.NUMBER_OVERSHOOT_SCALE, {
            duration: GLOW_BEAT.NUMBER_SETTLE_MS / 2,
            easing: WARM_EASE_OUT,
          }),
          withTiming(1, { duration: GLOW_BEAT.NUMBER_SETTLE_MS / 2, easing: WARM_EASE_IN_OUT })
        );
        if (soundsEnabledRef.current) playGlowBeatBowl();
        haptics.thump({ reduceMotion });
      };
      raf = requestAnimationFrame(tick);
    }, GLOW_BEAT.NUMBER_START_DELAY_MS);

    return () => {
      clearTimeout(startTimer);
      // raf is only assigned once the delayed start actually fires — an
      // unmount during the delay itself must not pass an unassigned
      // value to cancelAnimationFrame.
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glowNumber, reduceMotion]);

  const flameOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const flameY = useSharedValue(reduceMotion ? 0 : GLOW_BEAT.FLAME_BLOOM_RISE_PX);
  const flameScale = useSharedValue(reduceMotion ? 1 : 0.9);
  useEffect(() => {
    if (reduceMotion) {
      flameScale.value = withTiming(1, { duration: 300 });
      return;
    }
    // Flame blooms up first: fade + rise, then its own gentle overshoot
    // settle — split across the same named bloom duration so the whole
    // arrival reads as one motion.
    const bloomUpMs = Math.round(GLOW_BEAT.FLAME_BLOOM_DURATION_MS * 0.55);
    const bloomDownMs = GLOW_BEAT.FLAME_BLOOM_DURATION_MS - bloomUpMs;
    flameOpacity.value = withTiming(1, { duration: GLOW_BEAT.FLAME_BLOOM_DURATION_MS, easing: WARM_EASE_OUT });
    flameY.value = withTiming(0, { duration: GLOW_BEAT.FLAME_BLOOM_DURATION_MS, easing: WARM_EASE_OUT });
    flameScale.value = withSequence(
      withTiming(1.08, { duration: bloomUpMs, easing: WARM_EASE_OUT }),
      withTiming(1.0, { duration: bloomDownMs, easing: WARM_EASE_IN_OUT })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // FL1 (21 July, supersedes M2's (g) wobble) — a real FLICKER: one
  // brief flare timed exactly where the old wobble triggered (the
  // count-up settle, so the choreography's beat survives), then
  // irregular deterministic keyframes layering quick scale-Y stretches
  // (the flame reaching), small rotation jitter, and an opacity
  // shimmer, all decaying to complete stillness in ≈2.5s. One-shot;
  // the 10s-stillness law holds; GlowBadge's ember breathe stays the
  // app's only idle loop. Table + caps in lib/motion.ts FLAME_FLICKER.
  const flareScale = useSharedValue(1);
  const flickerStretch = useSharedValue(1);
  const flickerTilt = useSharedValue(0);
  const flickerOpacity = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    const steps = FLAME_FLICKER.STEPS;
    const stretchSeq = [];
    const tiltSeq = [];
    const dimSeq = [];
    for (let i = 0; i < steps.length; i++) {
      const [durationMs, stretch, tilt, dim] = steps[i];
      // Linear decay envelope: full amplitude at the table's start,
      // near-zero by its end — the flame burns down to stillness.
      const envelope = 1 - i / steps.length;
      const timing = { duration: durationMs, easing: WARM_EASE_IN_OUT };
      stretchSeq.push(withTiming(1 + stretch * FLAME_FLICKER.STRETCH_MAX * envelope, timing));
      tiltSeq.push(withTiming(tilt * FLAME_FLICKER.TILT_MAX_DEG * envelope, timing));
      dimSeq.push(withTiming(1 - dim * (1 - FLAME_FLICKER.OPACITY_MIN) * envelope, timing));
    }
    // Land on exact identity — perfectly still from here on.
    const settle = { duration: 120, easing: WARM_EASE_IN_OUT };
    stretchSeq.push(withTiming(1, settle));
    tiltSeq.push(withTiming(0, settle));
    dimSeq.push(withTiming(1, settle));

    const elapsed = Date.now() - sequenceStartAt;
    const delay = Math.max(0, GLOW_BEAT_NUMBER_LANDS_MS - elapsed);
    // The flare rides the same beat the old wobble did; the irregular
    // steps run concurrently underneath it, so the flare reads as the
    // first, biggest reach of a living flame rather than a separate move.
    flareScale.value = withDelay(
      delay,
      withSequence(
        withTiming(FLAME_FLICKER.FLARE_SCALE, { duration: FLAME_FLICKER.FLARE_UP_MS, easing: WARM_EASE_OUT }),
        withTiming(1, { duration: FLAME_FLICKER.FLARE_DOWN_MS, easing: WARM_EASE_IN_OUT })
      )
    );
    flickerStretch.value = withDelay(delay, withSequence(stretchSeq[0], ...stretchSeq.slice(1)));
    flickerTilt.value = withDelay(delay, withSequence(tiltSeq[0], ...tiltSeq.slice(1)));
    flickerOpacity.value = withDelay(delay, withSequence(dimSeq[0], ...dimSeq.slice(1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flameStyle = useAnimatedStyle(() => ({
    opacity: flameOpacity.value * flickerOpacity.value,
    transform: [
      { translateY: flameY.value },
      { scale: flameScale.value },
      { scale: flareScale.value },
      { scaleY: flickerStretch.value },
      { rotate: `${flickerTilt.value}deg` },
    ],
  }));
  const numberStyle = useAnimatedStyle(() => ({ transform: [{ scale: numberScale.value }] }));

  const rekindled = week ? didRekindleToday(week) : false;

  const copyOpacity = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (!rekindled || reduceMotion) return;
    const elapsed = Date.now() - sequenceStartAt;
    const delay = Math.max(0, GLOW_BEAT_COPY_START_MS - elapsed);
    copyOpacity.value = withDelay(delay, withTiming(1, { duration: GLOW_BEAT.COPY_FADE_MS }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rekindled, reduceMotion]);
  const copyStyle = useAnimatedStyle(() => ({ opacity: copyOpacity.value }));

  return (
    <View style={styles.container}>
      <Brandmark style={[styles.brandmark, { top: 20 + insets.top }]} />

      <View style={styles.body}>
        <Animated.Text style={[styles.flame, flameStyle]}>🔥</Animated.Text>
        <Animated.Text style={[styles.header, numberStyle]}>{STRINGS.glowGlowingLabel(displayCount)}</Animated.Text>

        {week && (
          <View style={styles.weekRow}>
            {week.map((day, i) => (
              <WeekSlot
                key={day.date}
                day={day}
                index={i}
                isToday={i === week.length - 1}
                reduceMotion={reduceMotion}
                sequenceStartAt={sequenceStartAt}
              />
            ))}
          </View>
        )}

        {rekindled && (
          <Animated.Text style={[styles.rekindledLine, copyStyle]}>{STRINGS.glowBeatRekindledLine}</Animated.Text>
        )}
      </View>

      <TouchableOpacity style={styles.button} onPress={() => router.replace('/today')}>
        <Text style={styles.buttonText}>{STRINGS.glowBeatContinueCta}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brandmark: {
    position: 'absolute',
    top: 20,
    left: 24,
  },
  body: {
    alignItems: 'center',
  },
  flame: {
    fontSize: 76,
    marginBottom: 8,
  },
  header: {
    fontFamily: FONT_HEADER,
    fontSize: 24,
    color: colors.ink,
    marginBottom: 28,
  },
  weekRow: {
    flexDirection: 'row',
    gap: 10,
  },
  slot: {
    alignItems: 'center',
    gap: 6,
  },
  slotWeekday: {
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.muted,
  },
  slotPill: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotPillEarned: {
    backgroundColor: colors.goldSoft,
    borderWidth: 1.5,
    borderColor: colors.gold,
  },
  slotPillHeld: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  slotPillNone: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  slotEarnedMark: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.gold,
  },
  slotHeldMark: {
    fontSize: 12,
  },
  // "missed day = quiet neutral dot — NEVER red, never an accusatory gap"
  slotNoneDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.muted,
  },
  rekindledLine: {
    fontSize: 12.5,
    color: colors.muted,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 24,
  },
  button: {
    width: '100%',
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 20,
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 15,
    color: colors.ink,
  },
});

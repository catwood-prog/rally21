import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
import { GLOW_BEAT, GLOW_BEAT_COPY_START_MS, GLOW_BEAT_WEEK_ROW_START_MS, WARM_EASE_OUT } from '@/lib/motion';
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
        {day.state === 'held' && <Animated.Text style={[styles.slotHeldMark, markStyle]}>💛</Animated.Text>}
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
            easing: Easing.out(Easing.ease),
          }),
          withTiming(1, { duration: GLOW_BEAT.NUMBER_SETTLE_MS / 2, easing: Easing.inOut(Easing.ease) })
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
      withTiming(1.08, { duration: bloomUpMs, easing: Easing.out(Easing.ease) }),
      withTiming(1.0, { duration: bloomDownMs, easing: Easing.inOut(Easing.ease) })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const flameStyle = useAnimatedStyle(() => ({
    opacity: flameOpacity.value,
    transform: [{ translateY: flameY.value }, { scale: flameScale.value }],
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
      <Brandmark style={styles.brandmark} />

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
    marginBottom: 20,
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 15,
    color: colors.ink,
  },
});

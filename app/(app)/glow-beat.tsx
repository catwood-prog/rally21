import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { didRekindleToday, getMyGlow, getMyWeek, WeekDay } from '@/lib/glow';

const COUNT_UP_DURATION_MS = 700;

function WeekSlot({ day, index, reduceMotion }: { day: WeekDay; index: number; reduceMotion: boolean }) {
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const scale = useSharedValue(reduceMotion ? 1 : 0.6);

  useEffect(() => {
    if (reduceMotion) return;
    const delay = index * 40;
    opacity.value = withDelay(delay, withTiming(1, { duration: 220 }));
    scale.value = withDelay(delay, withTiming(1, { duration: 220, easing: Easing.out(Easing.back(1.5)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const [y, m, d] = day.date.split('-').map(Number);
  const weekdayInitial = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'narrow' });
  const pillStyle =
    day.state === 'earned' ? styles.slotPillEarned : day.state === 'held' ? styles.slotPillHeld : styles.slotPillNone;

  return (
    <View style={styles.slot}>
      <Text style={styles.slotWeekday}>{weekdayInitial}</Text>
      <Animated.View style={[styles.slotPill, pillStyle, style]}>
        {day.state === 'earned' && <Text style={styles.slotEarnedMark}>✓</Text>}
        {day.state === 'held' && <Text style={styles.slotHeldMark}>💛</Text>}
        {day.state === 'none' && <View style={styles.slotNoneDot} />}
      </Animated.View>
    </View>
  );
}

/** G5 — the glow moment (Rally21-Glow-Spec.md §1): a Duolingo-style beat
 * shown only on the check-in that earns the day (see
 * lib/glow.ts's shouldShowGlowBeat, checked by checkin-complete.tsx
 * before ever routing here). Never blocks — a load failure still leaves
 * the continue button reachable, landing on Today same as always. */
export default function GlowBeat() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [glowNumber, setGlowNumber] = useState<number | null>(null);
  const [week, setWeek] = useState<WeekDay[] | null>(null);
  const [displayCount, setDisplayCount] = useState(0);

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
    if (glowNumber === null) return;
    if (reduceMotion) {
      setDisplayCount(glowNumber);
      return;
    }
    const start = Date.now();
    let raf: ReturnType<typeof requestAnimationFrame>;
    const tick = () => {
      const progress = Math.min(1, (Date.now() - start) / COUNT_UP_DURATION_MS);
      setDisplayCount(Math.round(progress * glowNumber));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [glowNumber, reduceMotion]);

  const flameScale = useSharedValue(reduceMotion ? 1 : 0.9);
  useEffect(() => {
    if (reduceMotion) {
      flameScale.value = withTiming(1, { duration: 300 });
    } else {
      flameScale.value = withSequence(
        withTiming(1.08, { duration: 260, easing: Easing.out(Easing.ease) }),
        withTiming(1.0, { duration: 200, easing: Easing.inOut(Easing.ease) })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const flameStyle = useAnimatedStyle(() => ({ transform: [{ scale: flameScale.value }] }));

  const rekindled = week ? didRekindleToday(week) : false;

  return (
    <View style={styles.container}>
      <Brandmark style={styles.brandmark} />

      <View style={styles.body}>
        <Animated.Text style={[styles.flame, flameStyle]}>🔥</Animated.Text>
        <Text style={styles.header}>{STRINGS.glowGlowingLabel(displayCount)}</Text>

        {week && (
          <View style={styles.weekRow}>
            {week.map((day, i) => (
              <WeekSlot key={day.date} day={day} index={i} reduceMotion={reduceMotion} />
            ))}
          </View>
        )}

        {rekindled && <Text style={styles.rekindledLine}>{STRINGS.glowBeatRekindledLine}</Text>}
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

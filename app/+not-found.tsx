import { Link, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { MASCOT } from '@/assets/mascot';
import { MascotEntrance } from '@/components/MascotEntrance';
import { colors } from '@/constants/theme';
import { frameSwapSchedule } from '@/lib/mascotFx';
import { MASCOT_FX } from '@/lib/motion';

export default function NotFoundScreen() {
  const reduceMotion = useReducedMotion();
  // M2 (e) — one apologetic wave after the standard entrance: two quick
  // swaps to the wave frame and back (never a crossfade — the frame pair
  // carries generation jitter), then still. Static under reduced motion.
  const [showWave, setShowWave] = useState(false);

  useEffect(() => {
    if (reduceMotion) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const step of frameSwapSchedule(MASCOT_FX.WAVE_DELAY_MS, MASCOT_FX.WAVE_HOLD_MS, MASCOT_FX.WAVE_SWAPS)) {
      timers.push(setTimeout(() => setShowWave(true), step.showAltAtMs));
      timers.push(setTimeout(() => setShowWave(false), step.showBaseAtMs));
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View style={styles.container}>
        <View style={styles.mascotBox}>
          <MascotEntrance source={MASCOT.apologeticSlip} style={styles.mascot} />
          <Image
            source={MASCOT.apologeticSlipWave}
            style={[styles.mascot, styles.waveFrame, { opacity: showWave ? 1 : 0 }]}
            resizeMode="contain"
            accessible={false}
            alt=""
          />
        </View>
        <Text style={styles.title}>This screen doesn&apos;t exist.</Text>
        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Go back home</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: colors.bg,
  },
  mascotBox: {
    marginBottom: 18,
  },
  mascot: {
    width: 150,
    height: 88,
  },
  // The wave frame sits exactly over the base; visibility-toggled for
  // the quick swap (both mounted, so no decode flash). The base's own
  // entrance fades in first; the wave only fires after it settles, so
  // the static overlay alignment is never visible mid-entrance.
  waveFrame: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink,
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    color: colors.green,
    fontWeight: '600',
  },
});

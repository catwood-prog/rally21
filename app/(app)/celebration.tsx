import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { MASCOT } from '@/assets/mascot';
import { Brandmark } from '@/components/Brandmark';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { getCircleById, MyCircle } from '@/lib/circle';
import { markCelebrationSeen, rallyNumber } from '@/lib/journey';

// Rally markers are quiet — the standard entrance, a small burst, no
// sound, no question. Major stops (50/100/365) get a bigger version of
// the same moment: more confetti, the day-21 ceremony's hero asset —
// still no sound, still no question (Rally21-Glow-Spec.md §8).
const RALLY_MARKER_CONFETTI_COUNT = 14;
const MAJOR_STOP_CONFETTI_COUNT = 30;
const CONFETTI_COLORS = [colors.gold, colors.green, colors.ink];
const CONFETTI_LIFETIME_MS = 3400;
const CONFETTI_FADE_MS = 700;

type ConfettiSpec = {
  left: `${number}%`;
  size: number;
  color: string;
  fallDuration: number;
  fallDelay: number;
  swayAmplitude: number;
  swayDuration: number;
  rotateDuration: number;
};

function makeConfettiSpecs(count: number): ConfettiSpec[] {
  return Array.from({ length: count }, () => ({
    left: `${Math.random() * 100}%`,
    size: 4 + Math.random() * 5,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    fallDuration: 2600 + Math.random() * 1800,
    fallDelay: Math.random() * 1200,
    swayAmplitude: 8 + Math.random() * 14,
    swayDuration: 900 + Math.random() * 700,
    rotateDuration: 1600 + Math.random() * 1600,
  }));
}

function ConfettiPiece({ spec, fallDistance }: { spec: ConfettiSpec; fallDistance: number }) {
  const translateY = useSharedValue(-20);
  const translateX = useSharedValue(0);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    translateY.value = withDelay(
      spec.fallDelay,
      withRepeat(withTiming(fallDistance, { duration: spec.fallDuration, easing: Easing.linear }), -1, false)
    );
    translateX.value = withRepeat(
      withSequence(
        withTiming(spec.swayAmplitude, { duration: spec.swayDuration, easing: Easing.inOut(Easing.ease) }),
        withTiming(-spec.swayAmplitude, { duration: spec.swayDuration, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
    rotate.value = withRepeat(
      withTiming(360, { duration: spec.rotateDuration, easing: Easing.linear }),
      -1,
      false
    );

    const fadeTimer = setTimeout(() => {
      opacity.value = withTiming(0, { duration: CONFETTI_FADE_MS }, (finished) => {
        if (finished) {
          cancelAnimation(translateY);
          cancelAnimation(translateX);
          cancelAnimation(rotate);
        }
      });
    }, CONFETTI_LIFETIME_MS);

    return () => {
      clearTimeout(fadeTimer);
      cancelAnimation(translateY);
      cancelAnimation(translateX);
      cancelAnimation(rotate);
      cancelAnimation(opacity);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    top: 0,
    left: spec.left,
    width: spec.size,
    height: spec.size * 0.65,
    borderRadius: 2,
    backgroundColor: spec.color,
    opacity: opacity.value,
    transform: [
      { translateY: translateY.value },
      { translateX: translateX.value },
      { rotate: `${rotate.value}deg` },
    ],
  }));

  return <Animated.View style={style} />;
}

export default function Celebration() {
  const router = useRouter();
  // NAV1 job 0 — celebration screens are AppHeader-exempt, never safe-area-exempt.
  const insets = useSafeAreaInsets();
  const { circleId, day, isMajorStop } = useLocalSearchParams<{
    circleId: string;
    day: string;
    isMajorStop: string;
  }>();
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const dayNumber = Number(day);
  const majorStop = isMajorStop === 'true';

  const [circle, setCircle] = useState<MyCircle | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!circleId || !dayNumber) return;
    getCircleById(circleId)
      .then((c) => {
        if (!c) return;
        setCircle(c);
        const title = majorStop
          ? STRINGS.journeyMajorStopTitle(dayNumber)
          : STRINGS.journeyRallyMarkerTitle(rallyNumber(dayNumber));
        const body = majorStop
          ? STRINGS.journeyMajorStopBody(c.name)
          : STRINGS.journeyRallyMarkerBody(c.name, dayNumber);
        markCelebrationSeen(circleId, dayNumber, {
          kind: majorStop ? 'major_stop' : 'rally_marker',
          body: `${title} · ${body}`,
        }).catch(() => {});
      })
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleId, dayNumber, majorStop]);

  const [confettiSpecs] = useState<ConfettiSpec[]>(() =>
    reduceMotion ? [] : makeConfettiSpecs(majorStop ? MAJOR_STOP_CONFETTI_COUNT : RALLY_MARKER_CONFETTI_COUNT)
  );

  const heroOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const heroY = useSharedValue(reduceMotion ? 0 : 8);
  const headingOpacity = useSharedValue(0);
  const headingY = useSharedValue(8);
  const bodyOpacity = useSharedValue(0);
  const bodyY = useSharedValue(8);
  const buttonOpacity = useSharedValue(0);
  const buttonY = useSharedValue(8);

  useEffect(() => {
    if (reduceMotion) {
      headingOpacity.value = 1;
      bodyOpacity.value = 1;
      buttonOpacity.value = 1;
      return;
    }
    const heroDuration = majorStop ? 600 : 350;
    heroOpacity.value = withTiming(1, { duration: heroDuration, easing: Easing.out(Easing.cubic) });
    heroY.value = withTiming(0, { duration: heroDuration, easing: Easing.out(Easing.cubic) });
    headingOpacity.value = withDelay(heroDuration - 50, withTiming(1, { duration: 400 }));
    headingY.value = withDelay(heroDuration - 50, withTiming(0, { duration: 400 }));
    bodyOpacity.value = withDelay(heroDuration + 150, withTiming(1, { duration: 400 }));
    bodyY.value = withDelay(heroDuration + 150, withTiming(0, { duration: 400 }));
    buttonOpacity.value = withDelay(heroDuration + 350, withTiming(1, { duration: 400 }));
    buttonY.value = withDelay(heroDuration + 350, withTiming(0, { duration: 400 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const heroStyle = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
    transform: [{ translateY: heroY.value }],
  }));
  const headingStyle = useAnimatedStyle(() => ({
    opacity: headingOpacity.value,
    transform: [{ translateY: headingY.value }],
  }));
  const bodyStyle = useAnimatedStyle(() => ({
    opacity: bodyOpacity.value,
    transform: [{ translateY: bodyY.value }],
  }));
  const buttonStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ translateY: buttonY.value }],
  }));

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  if (!circle) {
    return (
      <View style={styles.loading}>
        <Text style={styles.subtitle}>{STRINGS.circleNotFound}</Text>
      </View>
    );
  }

  const title = majorStop
    ? STRINGS.journeyMajorStopTitle(dayNumber)
    : STRINGS.journeyRallyMarkerTitle(rallyNumber(dayNumber));
  const body = majorStop
    ? STRINGS.journeyMajorStopBody(circle.name)
    : STRINGS.journeyRallyMarkerBody(circle.name, dayNumber);

  const handleContinue = () => {
    router.replace({ pathname: '/circle', params: { circleId: circle.id } });
  };

  return (
    <View style={styles.container}>
      <Brandmark style={[styles.brandmark, { top: 20 + insets.top }]} />

      {confettiSpecs.length > 0 && (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          {confettiSpecs.map((spec, i) => (
            <ConfettiPiece key={i} spec={spec} fallDistance={windowHeight} />
          ))}
        </View>
      )}

      <Animated.View style={heroStyle}>
        <Image
          source={majorStop ? MASCOT.day21CelebrationHuddle : MASCOT.proudAfterShowingUp}
          style={majorStop ? styles.heroLarge : styles.heroSmall}
          resizeMode="contain"
          accessible={false}
          alt=""
        />
      </Animated.View>

      <Animated.Text style={[styles.title, headingStyle]}>{title}</Animated.Text>
      <Animated.Text style={[styles.body, bodyStyle]}>{body}</Animated.Text>

      <Animated.View style={[styles.buttonWrap, buttonStyle]}>
        <TouchableOpacity style={styles.button} onPress={handleContinue}>
          <Text style={styles.buttonText}>Nice</Text>
        </TouchableOpacity>
      </Animated.View>
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
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cream,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
  },
  brandmark: {
    position: 'absolute',
    top: 20,
    left: 24,
  },
  heroSmall: {
    width: 112,
    height: 120,
    marginBottom: 20,
  },
  heroLarge: {
    width: 180,
    height: 160,
    marginBottom: 20,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 24,
    color: colors.ink,
    marginBottom: 8,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 32,
  },
  buttonWrap: {
    width: '100%',
  },
  button: {
    width: '100%',
    backgroundColor: colors.green,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 15,
    color: '#fff',
  },
});

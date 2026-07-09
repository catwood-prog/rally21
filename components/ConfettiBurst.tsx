import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

/**
 * BD2 (8 July) — extracted verbatim from journey-gate.tsx's day-21
 * ceremony (the only confetti burst this app had a named "reuse, don't
 * rebuild" mandate for), so the birthday moment reuses the exact same
 * fall/sway/rotate/fade mechanism rather than a second implementation.
 * journey-gate.tsx's own rendering is unchanged behavior — same specs,
 * same constants, same lifetime — just relocated here.
 *
 * A one-time burst, never looping: each piece's fall/sway/rotate use
 * `withRepeat` only to keep covering its own bounded lifetime (a fall
 * shorter than the lifetime would otherwise freeze early), not to loop
 * the burst itself — once `lifetimeMs` elapses every piece fades out and
 * its animations are cancelled for good.
 */

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

function makeConfettiSpecs(count: number, colors: string[]): ConfettiSpec[] {
  return Array.from({ length: count }, () => ({
    left: `${Math.random() * 100}%`,
    size: 4 + Math.random() * 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    fallDuration: 2600 + Math.random() * 1800,
    fallDelay: Math.random() * 1200,
    swayAmplitude: 8 + Math.random() * 14,
    swayDuration: 900 + Math.random() * 700,
    rotateDuration: 1600 + Math.random() * 1600,
  }));
}

function ConfettiPiece({
  spec,
  fallDistance,
  lifetimeMs,
  fadeMs,
}: {
  spec: ConfettiSpec;
  fallDistance: number;
  lifetimeMs: number;
  fadeMs: number;
}) {
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
      opacity.value = withTiming(0, { duration: fadeMs }, (finished) => {
        if (finished) {
          cancelAnimation(translateY);
          cancelAnimation(translateX);
          cancelAnimation(rotate);
        }
      });
    }, lifetimeMs);

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

export function ConfettiBurst({
  count,
  colors,
  reduceMotion,
  lifetimeMs = 4200,
  fadeMs = 800,
}: {
  count: number;
  colors: string[];
  reduceMotion: boolean;
  lifetimeMs?: number;
  fadeMs?: number;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const [specs] = useState<ConfettiSpec[]>(() => (reduceMotion ? [] : makeConfettiSpecs(count, colors)));

  if (specs.length === 0) return null;

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {specs.map((spec, i) => (
        <ConfettiPiece key={i} spec={spec} fallDistance={windowHeight} lifetimeMs={lifetimeMs} fadeMs={fadeMs} />
      ))}
    </View>
  );
}

import { useEffect } from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/**
 * The mascot brief's one standard entrance: fade in + rise 8px + settle,
 * ~350ms ease-out, plays once per surface visit — no idle loop after it
 * settles. Renders static under prefers-reduced-motion. Every mascot
 * placement uses this except check-in success, which gets its own
 * bouncier scale entrance (see checkin-complete.tsx).
 */
export function MascotEntrance({
  source,
  style,
}: {
  source: number;
  style?: StyleProp<ImageStyle>;
}) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const translateY = useSharedValue(reduceMotion ? 0 : 8);

  useEffect(() => {
    if (reduceMotion) return;
    opacity.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) });
    translateY.value = withTiming(0, { duration: 350, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Image source={source} style={style} resizeMode="contain" accessible={false} alt="" />
    </Animated.View>
  );
}

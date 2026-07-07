import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
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
import { useAuth } from '@/lib/auth-context';
import { playDay21Flourish } from '@/lib/chime';
import { getCircleById, MyCircle } from '@/lib/circle';
import { daysBetween, getLocalDateString } from '@/lib/date';
import {
  completeCircle,
  GATE_DAY,
  markCelebrationSeen,
  rallyOnCircle,
} from '@/lib/journey';
import { getMyProfile } from '@/lib/profile';

// The one big moment in the app (mascot brief) — a bigger, slower burst
// than check-in success's small daily beat.
const CONFETTI_COUNT = 34;
const CONFETTI_COLORS = [colors.gold, colors.green, colors.ink];
const CONFETTI_LIFETIME_MS = 4200;
const CONFETTI_FADE_MS = 800;

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

function makeConfettiSpecs(): ConfettiSpec[] {
  return Array.from({ length: CONFETTI_COUNT }, () => ({
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

type Decision = 'pending' | 'rallied' | 'completed';

export default function JourneyGate() {
  const router = useRouter();
  const { session } = useAuth();
  const { circleId } = useLocalSearchParams<{ circleId: string }>();
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  const [circle, setCircle] = useState<MyCircle | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [decision, setDecision] = useState<Decision>('pending');
  const [isRallying, setIsRallying] = useState(false);
  const [isConfirmingComplete, setIsConfirmingComplete] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  useEffect(() => {
    if (!circleId) return;
    getCircleById(circleId)
      .then((c) => {
        if (!c) return;
        setCircle(c);
        if (c.completedAt) {
          // Reached directly with nothing left to decide — the archive
          // view (task R1.4) is the right home for this, not the gate.
          router.replace({ pathname: '/circle', params: { circleId: c.id } });
          return;
        }
        if (c.ralliedOnAt) setDecision('rallied');
        // First relevant open disarms the full-screen gate for good,
        // regardless of what (if anything) gets decided here — later
        // visits fall through to the quiet persistent card instead.
        markCelebrationSeen(c.id, GATE_DAY).catch(() => {});
      })
      .finally(() => setIsLoading(false));
  }, [circleId, router]);

  const [confettiSpecs] = useState<ConfettiSpec[]>(() => (reduceMotion ? [] : makeConfettiSpecs()));

  const heroOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const heroY = useSharedValue(reduceMotion ? 0 : 12);
  const headingOpacity = useSharedValue(0);
  const headingY = useSharedValue(8);
  const bodyOpacity = useSharedValue(0);
  const bodyY = useSharedValue(8);
  const actionsOpacity = useSharedValue(0);
  const actionsY = useSharedValue(8);

  useEffect(() => {
    if (reduceMotion) {
      headingOpacity.value = 1;
      bodyOpacity.value = 1;
      actionsOpacity.value = 1;
      return;
    }
    heroOpacity.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
    heroY.value = withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) });
    headingOpacity.value = withDelay(500, withTiming(1, { duration: 400 }));
    headingY.value = withDelay(500, withTiming(0, { duration: 400 }));
    bodyOpacity.value = withDelay(700, withTiming(1, { duration: 400 }));
    bodyY.value = withDelay(700, withTiming(0, { duration: 400 }));
    actionsOpacity.value = withDelay(950, withTiming(1, { duration: 400 }));
    actionsY.value = withDelay(950, withTiming(0, { duration: 400 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    getMyProfile(session.user.id)
      .then((profile) => {
        if (profile?.sounds_enabled ?? true) playDay21Flourish();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

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
  const actionsStyle = useAnimatedStyle(() => ({
    opacity: actionsOpacity.value,
    transform: [{ translateY: actionsY.value }],
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

  const isCreator = circle.createdBy === session?.user?.id;

  const handleContinue = () => {
    router.replace({ pathname: '/circle', params: { circleId: circle.id } });
  };

  const handleRallyOn = async () => {
    setIsRallying(true);
    try {
      await rallyOnCircle(circle.id);
      setDecision('rallied');
    } catch {
      // low-stakes — the persistent card on the circle screen offers
      // another chance if this attempt was lost to a network blip
    } finally {
      setIsRallying(false);
    }
  };

  const handleComplete = async () => {
    setIsCompleting(true);
    try {
      await completeCircle(circle.id);
      setDecision('completed');
    } catch {
      setIsConfirmingComplete(false);
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Brandmark style={styles.brandmark} />

      {confettiSpecs.length > 0 && (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          {confettiSpecs.map((spec, i) => (
            <ConfettiPiece key={i} spec={spec} fallDistance={windowHeight} />
          ))}
        </View>
      )}

      <Animated.View style={heroStyle}>
        <Image
          source={MASCOT.day21CelebrationHuddle}
          style={styles.hero}
          resizeMode="contain"
          accessible={false}
          alt=""
        />
      </Animated.View>

      {decision === 'completed' ? (
        <>
          <Animated.Text style={[styles.title, headingStyle]}>
            {STRINGS.journeyCompletedTitle(circle.name)}
          </Animated.Text>
          <Animated.Text style={[styles.body, bodyStyle]}>{STRINGS.journeyCompletedBody}</Animated.Text>
          <Animated.View style={[styles.actionsWrap, actionsStyle]}>
            <TouchableOpacity style={styles.primaryButton} onPress={handleContinue}>
              <Text style={styles.primaryButtonText}>{STRINGS.journeyCompletedCta}</Text>
            </TouchableOpacity>
          </Animated.View>
        </>
      ) : decision === 'rallied' ? (
        <>
          <Animated.Text style={[styles.title, headingStyle]}>{STRINGS.journeyGateTitle}</Animated.Text>
          <Animated.Text style={[styles.body, bodyStyle]}>
            {STRINGS.journeyRalliedOnCard(circle.name)}
          </Animated.Text>
          <Animated.View style={[styles.actionsWrap, actionsStyle]}>
            <TouchableOpacity style={styles.primaryButton} onPress={handleContinue}>
              <Text style={styles.primaryButtonText}>{STRINGS.journeyCompletedCta}</Text>
            </TouchableOpacity>
          </Animated.View>
        </>
      ) : (
        <>
          <Animated.Text style={[styles.title, headingStyle]}>{STRINGS.journeyGateTitle}</Animated.Text>
          <Animated.Text style={[styles.body, bodyStyle]}>{STRINGS.journeyGateBody}</Animated.Text>

          <Animated.View style={[styles.actionsWrap, actionsStyle]}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleRallyOn}
              disabled={isRallying}
            >
              {isRallying ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>{STRINGS.journeyGateRallyOnCta}</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.helperText}>{STRINGS.journeyGateRallyOnHelper}</Text>

            {isCreator ? (
              isConfirmingComplete ? (
                <View style={styles.completeConfirmCard}>
                  <Text style={styles.completeConfirmTitle}>
                    {STRINGS.journeyCompleteConfirmTitle(circle.name)}
                  </Text>
                  <Text style={styles.completeConfirmBody}>{STRINGS.journeyCompleteConfirmBody}</Text>
                  <View style={styles.completeConfirmRow}>
                    <TouchableOpacity
                      onPress={() => setIsConfirmingComplete(false)}
                      disabled={isCompleting}
                    >
                      <Text style={styles.completeCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={handleComplete} disabled={isCompleting}>
                      <Text style={styles.completeConfirmActionText}>
                        {isCompleting ? '…' : STRINGS.journeyGateCompleteCta}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => setIsConfirmingComplete(true)}
                >
                  <Text style={styles.secondaryButtonText}>{STRINGS.journeyGateCompleteCta}</Text>
                </TouchableOpacity>
              )
            ) : (
              <Text style={styles.helperTextMuted}>{STRINGS.journeyGateWaitingOnHost}</Text>
            )}
            {isCreator && !isConfirmingComplete && (
              <Text style={styles.helperText}>{STRINGS.journeyGateCompleteHelper}</Text>
            )}
          </Animated.View>
        </>
      )}
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
  hero: {
    width: 180,
    height: 160,
    marginBottom: 20,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 28,
    color: colors.ink,
    marginBottom: 8,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 28,
    paddingHorizontal: 8,
  },
  actionsWrap: {
    width: '100%',
    alignItems: 'center',
  },
  primaryButton: {
    width: '100%',
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontWeight: '700',
    fontSize: 15,
    color: colors.ink,
  },
  secondaryButton: {
    marginTop: 18,
    paddingVertical: 8,
  },
  secondaryButtonText: {
    fontWeight: '600',
    fontSize: 13,
    color: colors.muted,
    textDecorationLine: 'underline',
  },
  helperText: {
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 8,
  },
  helperTextMuted: {
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 18,
    fontStyle: 'italic',
  },
  completeConfirmCard: {
    marginTop: 18,
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
  },
  completeConfirmTitle: {
    fontFamily: FONT_HEADER,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 6,
    textAlign: 'center',
  },
  completeConfirmBody: {
    fontSize: 12.5,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 14,
  },
  completeConfirmRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
  },
  completeCancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  completeConfirmActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
});

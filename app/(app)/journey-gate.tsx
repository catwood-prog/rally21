import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

import { MASCOT } from '@/assets/mascot';
import { Brandmark } from '@/components/Brandmark';
import { ConfettiBurst } from '@/components/ConfettiBurst';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors, CONFETTI_GREENS } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { playDay21Flourish } from '@/lib/chime';
import { getCircleById, MyCircle } from '@/lib/circle';
import { daysBetween, getLocalDateString } from '@/lib/date';
import {
  completeCircle,
  GATE_DAY,
  getMyLastWrappedOfferDay,
  markCelebrationSeen,
  markWrappedOffered,
  rallyOnCircle,
} from '@/lib/journey';
import { MASCOT_GESTURE, WARM_EASE_IN_OUT, WARM_EASE_OUT } from '@/lib/motion';
import { getMyProfile } from '@/lib/profile';

// The one big moment in the app (mascot brief) — a bigger, slower burst
// than check-in success's small daily beat. The burst mechanism itself
// lives in components/ConfettiBurst.tsx (BD2, 8 July) so the birthday
// moment can reuse it rather than a second implementation — these
// numbers are unchanged from before that extraction.
const CONFETTI_COUNT = 34;
// M2: always green (CONFETTI_GREENS is the one source of truth).
const CONFETTI_COLORS = [...CONFETTI_GREENS];

type Decision = 'pending' | 'rallied' | 'completed';

export default function JourneyGate() {
  const router = useRouter();
  // NAV1 job 0 — ceremony screens are AppHeader-exempt, never safe-area-exempt.
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { circleId } = useLocalSearchParams<{ circleId: string }>();
  const reduceMotion = useReducedMotion();

  const [circle, setCircle] = useState<MyCircle | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [decision, setDecision] = useState<Decision>('pending');
  const [isRallying, setIsRallying] = useState(false);
  const [isConfirmingComplete, setIsConfirmingComplete] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  // SC3 — the mini-Wrapped's quiet offer, after the decision. Allowed
  // only when this milestone's offer hasn't been shown before (the
  // monotonic per-membership marker); shown once, marked at show time,
  // so declining (just continuing) never re-offers.
  const [wrappedOfferable, setWrappedOfferable] = useState(false);
  const wrappedMarkedRef = useRef(false);

  useEffect(() => {
    if (!circleId || !session?.user) return;
    getMyLastWrappedOfferDay(circleId, session.user.id)
      .then((day) => setWrappedOfferable(day < GATE_DAY))
      .catch(() => {});
  }, [circleId, session?.user?.id]);

  useEffect(() => {
    if (decision === 'pending' || !wrappedOfferable || wrappedMarkedRef.current || !circleId) return;
    wrappedMarkedRef.current = true;
    markWrappedOffered(circleId, GATE_DAY).catch(() => {
      // Low-stakes: worst case the offer shows once more next visit.
    });
  }, [decision, wrappedOfferable, circleId]);

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

  const heroOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const heroY = useSharedValue(reduceMotion ? 0 : 12);
  // P1 — a slow single bow after the hero's own entrance lands: a small
  // forward rotate + dip, once, then holds still.
  const bowRotate = useSharedValue(0);
  const bowDip = useSharedValue(0);
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

    const bowHalf = MASCOT_GESTURE.DAY21_BOW_DURATION_MS / 2;
    bowRotate.value = withDelay(
      MASCOT_GESTURE.DAY21_BOW_DELAY_MS,
      withSequence(
        withTiming(MASCOT_GESTURE.DAY21_BOW_ROTATE_DEG, { duration: bowHalf, easing: WARM_EASE_OUT }),
        withTiming(0, { duration: bowHalf, easing: WARM_EASE_IN_OUT })
      )
    );
    bowDip.value = withDelay(
      MASCOT_GESTURE.DAY21_BOW_DELAY_MS,
      withSequence(
        withTiming(MASCOT_GESTURE.DAY21_BOW_DIP_PX, { duration: bowHalf, easing: WARM_EASE_OUT }),
        withTiming(0, { duration: bowHalf, easing: WARM_EASE_IN_OUT })
      )
    );
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
    transform: [
      { translateY: heroY.value },
      { translateY: bowDip.value },
      { rotate: `${bowRotate.value}deg` },
    ],
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
      <Brandmark style={[styles.brandmark, { top: 20 + insets.top }]} />

      <ConfettiBurst count={CONFETTI_COUNT} colors={CONFETTI_COLORS} reduceMotion={reduceMotion} />

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
            {/* SC3 — the keepsake offer, a quiet addition after the
                decision; continuing past it IS declining, and the marker
                (bumped at show) means it never reappears. */}
            {wrappedOfferable && (
              <View style={styles.wrappedOfferCard}>
                <Text style={styles.wrappedOfferTitle}>{STRINGS.wrappedOfferTitle}</Text>
                <Text style={styles.wrappedOfferBody}>{STRINGS.wrappedOfferBody}</Text>
                <TouchableOpacity
                  style={styles.wrappedOfferButton}
                  onPress={() =>
                    router.replace({
                      pathname: '/wrapped',
                      params: { circleId: circle.id, milestone: String(GATE_DAY) },
                    })
                  }
                >
                  <Text style={styles.wrappedOfferButtonText}>{STRINGS.wrappedOfferCta}</Text>
                </TouchableOpacity>
              </View>
            )}
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
            {wrappedOfferable && (
              <View style={styles.wrappedOfferCard}>
                <Text style={styles.wrappedOfferTitle}>{STRINGS.wrappedOfferTitle}</Text>
                <Text style={styles.wrappedOfferBody}>{STRINGS.wrappedOfferBody}</Text>
                <TouchableOpacity
                  style={styles.wrappedOfferButton}
                  onPress={() =>
                    router.replace({
                      pathname: '/wrapped',
                      params: { circleId: circle.id, milestone: String(GATE_DAY) },
                    })
                  }
                >
                  <Text style={styles.wrappedOfferButtonText}>{STRINGS.wrappedOfferCta}</Text>
                </TouchableOpacity>
              </View>
            )}
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

            {/* NAV1: the undecided state had no exit at all — a member
                who isn't ready to choose (or isn't the host) needs a
                quiet way out. The circle screen keeps offering the same
                choice as a card, so nothing is lost by leaving. */}
            <TouchableOpacity style={styles.notNowButton} onPress={() => router.replace('/today')}>
              <Text style={styles.notNowText}>{STRINGS.journeyGateNotNow}</Text>
            </TouchableOpacity>
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
  // SC3 — the quiet keepsake offer card, sized like the confirm card
  // vocabulary; gold accents (journey color), never a gate on the
  // decision buttons around it.
  wrappedOfferCard: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: colors.goldSoft,
  },
  wrappedOfferTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'center',
  },
  wrappedOfferBody: {
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 3,
    marginBottom: 10,
  },
  wrappedOfferButton: {
    backgroundColor: colors.goldSoft,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  wrappedOfferButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  notNowButton: {
    marginTop: 14,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  notNowText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
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

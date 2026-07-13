import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
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

import { Brandmark } from '@/components/Brandmark';
import { MASCOT } from '@/assets/mascot';
import { STRINGS } from '@/constants/strings';
import { FONT_HEADER } from '@/constants/fonts';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { playCheckinPop } from '@/lib/chime';
import { getCircleById } from '@/lib/circle';
import { daysBetween, getLocalDateString } from '@/lib/date';
import { checkGlowMilestone, didRekindleToday, getMyWeek, shouldShowGlowBeat } from '@/lib/glow';
import { MASCOT_GESTURE, WARM_EASE_IN_OUT, WARM_EASE_OUT } from '@/lib/motion';
import { getMyProfile } from '@/lib/profile';
import { getShareCardForToday, shouldOfferShareCard, type ShareCard } from '@/lib/shareCards';

const CONFETTI_COUNT = 25;
const CONFETTI_COLORS = [colors.gold, colors.green, '#7FBF7F'];
const CONFETTI_LIFETIME_MS = 4000;
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

    // Confetti is a one-shot celebration, not ambient decor — fade it out
    // and stop driving the falling/sway/rotate loops rather than let them
    // run invisibly forever.
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

export default function CheckInComplete() {
  const router = useRouter();
  const { session } = useAuth();
  const { circleId, earnedToday } = useLocalSearchParams<{ circleId: string; earnedToday?: string }>();
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  // Assumption: day count comes from this circle's own start date (the
  // same calc SignalMeter/Today use elsewhere), capped at its 21-day
  // duration. Falls back to day 1 if the circle fetch fails or circleId is
  // somehow missing, rather than showing broken text.
  const [dayNumber, setDayNumber] = useState<number | null>(null);
  // SC1: the day-21 (or later) ceremony always wins over a share card —
  // today.tsx's own gate redirects to /journey-gate the moment this
  // screen's dismissal lands back on Today, so offering a card on this
  // exact day would just flash briefly before that redirect. Derived from
  // the same raw (uncapped) day count as dayNumber, before it gets capped
  // at durationDays for display.
  const [isCeremonyDay, setIsCeremonyDay] = useState(false);
  const [glowMilestone, setGlowMilestone] = useState<number | null>(null);
  // P1: the sound-suppression check below needs to know whether a
  // milestone exists before it can decide whether this is a glow-beat
  // check-in — this flag distinguishes "not fetched yet" from "fetched,
  // no milestone" (both read as glowMilestone === null otherwise).
  const [milestoneChecked, setMilestoneChecked] = useState(false);
  const [shareCard, setShareCard] = useState<ShareCard | null>(null);

  useEffect(() => {
    if (!circleId) return;
    getCircleById(circleId)
      .then((circle) => {
        if (!circle) return;
        const raw = Math.max(1, daysBetween(circle.startDate, getLocalDateString()) + 1);
        setDayNumber(Math.min(raw, circle.durationDays));
        setIsCeremonyDay(raw >= circle.durationDays);
      })
      .catch(() => {});
  }, [circleId]);

  // SC1 — the card slot (Rally21-Share-Cards-Spec.md §3): only fetch once
  // the composition rule's other inputs are known, and only offer when
  // nothing bigger fired. Fetching here (rather than lazily on dismiss) so
  // the eventual tap feels instant, mirroring how glowMilestone is
  // pre-fetched the same way.
  useEffect(() => {
    if (!session?.user || !milestoneChecked || dayNumber === null) return;
    const earned = earnedToday === 'true';
    if (!shouldOfferShareCard({
      isCeremonyDay,
      hasMilestone: !!glowMilestone,
      showsGlowBeat: shouldShowGlowBeat({ earnedToday: earned, hasMilestone: !!glowMilestone }),
    })) {
      return;
    }
    getMyWeek()
      .then((week) => getShareCardForToday({ localDate: getLocalDateString(), isRekindle: didRekindleToday(week) }))
      .then(setShareCard)
      .catch(() => setShareCard(null));
  }, [session?.user, milestoneChecked, dayNumber, isCeremonyDay, glowMilestone, earnedToday]);

  // Glow milestones (Rally21-Glow-Spec.md §4) — detected once per this
  // screen's mount, right at check-in time; a monotonic server-side
  // tracker means this never refires for an already-celebrated milestone.
  useEffect(() => {
    checkGlowMilestone()
      .then(setGlowMilestone)
      .catch(() => {})
      .finally(() => setMilestoneChecked(true));
  }, []);

  const [confettiSpecs] = useState<ConfettiSpec[]>(() => (reduceMotion ? [] : makeConfettiSpecs()));

  // Mascot brief: check-in success gets a slightly bouncier entrance (scale
  // 0.9 -> 1.05 -> 1.0) so the daily beat feels like a small pat on the
  // back — then holds still. No idle loop.
  const scale = useSharedValue(reduceMotion ? 1 : 0.9);
  // P1 — a small proud puff/hop layered on top of the entrance above,
  // once it settles: a tiny scale puff plus a quick hop up and back.
  const puffScale = useSharedValue(1);
  const hopY = useSharedValue(0);
  const headingOpacity = useSharedValue(0);
  const headingY = useSharedValue(8);
  const bodyOpacity = useSharedValue(0);
  const bodyY = useSharedValue(8);
  const buttonOpacity = useSharedValue(0);
  const buttonY = useSharedValue(8);

  useEffect(() => {
    if (reduceMotion) {
      scale.value = withTiming(1, { duration: 300 });
    } else {
      scale.value = withSequence(
        withTiming(1.05, { duration: 220, easing: Easing.out(Easing.ease) }),
        withTiming(1.0, { duration: 160, easing: Easing.inOut(Easing.ease) })
      );
    }

    headingOpacity.value = withDelay(450, withTiming(1, { duration: 400 }));
    headingY.value = withDelay(450, withTiming(0, { duration: 400 }));
    bodyOpacity.value = withDelay(650, withTiming(1, { duration: 400 }));
    bodyY.value = withDelay(650, withTiming(0, { duration: 400 }));
    buttonOpacity.value = withDelay(850, withTiming(1, { duration: 400 }));
    buttonY.value = withDelay(850, withTiming(0, { duration: 400 }));

    // P1 mascot gesture — a small proud puff/hop once the existing bouncy
    // entrance settles, then holds still (never a loop).
    if (!reduceMotion) {
      puffScale.value = withDelay(
        MASCOT_GESTURE.CHECKIN_PUFF_DELAY_MS,
        withSequence(
          withTiming(MASCOT_GESTURE.CHECKIN_PUFF_SCALE, {
            duration: MASCOT_GESTURE.CHECKIN_PUFF_UP_MS,
            easing: WARM_EASE_OUT,
          }),
          withTiming(1, { duration: MASCOT_GESTURE.CHECKIN_PUFF_DOWN_MS, easing: WARM_EASE_IN_OUT })
        )
      );
      hopY.value = withDelay(
        MASCOT_GESTURE.CHECKIN_PUFF_DELAY_MS,
        withSequence(
          withTiming(-MASCOT_GESTURE.CHECKIN_PUFF_HOP_PX, {
            duration: MASCOT_GESTURE.CHECKIN_PUFF_UP_MS,
            easing: WARM_EASE_OUT,
          }),
          withTiming(0, { duration: MASCOT_GESTURE.CHECKIN_PUFF_DOWN_MS, easing: WARM_EASE_IN_OUT })
        )
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // P1: on the check-in that earns the day (and isn't a milestone), the
  // glow beat's own bowl sound REPLACES checkin-pop — never both. Every
  // OTHER check-in (non-earning, or a milestone one, which never routes
  // to the glow beat at all) keeps checkin-pop exactly as before. Waiting
  // on milestoneChecked only matters when earned is true, since
  // shouldShowGlowBeat is false regardless of milestone when it isn't —
  // this keeps the common non-earning case sounding exactly as
  // responsive as it always has.
  const soundDecidedRef = useRef(false);
  useEffect(() => {
    if (!session?.user || soundDecidedRef.current) return;
    const earned = earnedToday === 'true';
    if (earned && !milestoneChecked) return;
    soundDecidedRef.current = true;
    if (shouldShowGlowBeat({ earnedToday: earned, hasMilestone: !!glowMilestone })) return;
    getMyProfile(session.user.id)
      .then((profile) => {
        if (profile?.sounds_enabled ?? true) playCheckinPop();
      })
      .catch(() => {
        // low-stakes — the celebration screen itself is the real signal
      });
  }, [session?.user?.id, earnedToday, milestoneChecked, glowMilestone]);

  const penguinStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { scale: puffScale.value }, { translateY: hopY.value }],
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

  const handleDismiss = () => {
    // G5 (Rally21-Glow-Spec.md §1): the glow moment only replaces this
    // screen's normal dismissal on the check-in that actually earned the
    // day, and never alongside a milestone (they compose, never both).
    if (shouldShowGlowBeat({ earnedToday: earnedToday === 'true', hasMilestone: !!glowMilestone })) {
      router.replace('/glow-beat');
      return;
    }
    // SC1 — the card slot: only the least important rung of the
    // composition ladder, so it only ever replaces the plain dismissal
    // below, never anything above it.
    if (shareCard) {
      router.replace({
        pathname: '/share-card',
        params: {
          cardKey: shareCard.cardKey,
          body: shareCard.body,
          attribution: shareCard.attribution ?? '',
          gloss: shareCard.gloss ?? '',
        },
      });
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/today');
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

      <Animated.View style={penguinStyle}>
        <Image
          source={MASCOT.penguinConfetti}
          style={styles.penguin}
          resizeMode="contain"
          accessible={false}
          alt=""
        />
      </Animated.View>

      <Animated.Text style={[styles.title, headingStyle]}>
        {glowMilestone ? STRINGS.glowMilestoneTitle(glowMilestone) : STRINGS.checkinSuccessTitle(dayNumber ?? 1)}
      </Animated.Text>
      <Animated.Text style={[styles.subtitle, bodyStyle]}>
        {glowMilestone ? STRINGS.glowMilestoneBody : STRINGS.checkinSuccessBody}
      </Animated.Text>

      <Animated.View style={[styles.buttonWrap, buttonStyle]}>
        <TouchableOpacity style={styles.button} onPress={handleDismiss}>
          <Text style={styles.buttonText}>{STRINGS.checkinSuccessCta}</Text>
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
  brandmark: {
    position: 'absolute',
    top: 20,
    left: 24,
  },
  penguin: {
    // Restored to the pre-M1 size along with the original transparent
    // penguin-confetti asset (7 July, Cat's call — the sheet crop's opaque
    // cream background read as a box on the warm-grey page).
    width: 130,
    height: 134,
    marginBottom: 20,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 26,
    color: colors.ink,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
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

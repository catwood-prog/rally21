import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
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

import { Brandmark } from '@/components/Brandmark';
import { ConfettiBurst } from '@/components/ConfettiBurst';
import { MASCOT } from '@/assets/mascot';
import { STRINGS } from '@/constants/strings';
import { FONT_HEADER } from '@/constants/fonts';
import { colors, CONFETTI_GREENS } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { countMyCircleCompletions } from '@/lib/checkin';
import { playCheckinPop } from '@/lib/chime';
import { getCircleById } from '@/lib/circle';
import { daysBetween, getLocalDateString } from '@/lib/date';
import { checkGlowMilestone, didRekindleToday, getMyWeek, shouldShowGlowBeat } from '@/lib/glow';
import { frameSwapSchedule } from '@/lib/mascotFx';
import { MASCOT_FX, MASCOT_GESTURE, WARM_EASE_IN_OUT, WARM_EASE_OUT } from '@/lib/motion';
import { getMyProfile, markPushPromptSeen } from '@/lib/profile';
import { getPushPermissionStatus, registerForPushNotificationsAsync } from '@/lib/pushNotifications';
import { getShareCardForToday, shouldOfferShareCard } from '@/lib/shareCards';
import { buildShareCardNavParams } from '@/lib/shareCardTemplates';

// M2: always green (CONFETTI_GREENS is the one source of truth).
const CONFETTI_COLORS = [...CONFETTI_GREENS];
const CONFETTI_LIFETIME_MS = 4000;
const CONFETTI_FADE_MS = 700;

// P2 (15 July, Cat's TestFlight review): the single flat confetti layer
// becomes three depth layers — small/slow/dim far pieces behind, the
// original layer in the middle (mid IS the pre-P2 behavior, untouched
// ranges), and a few large/fast pieces drifting in FRONT of the penguin.
// 12 + 15 + 8 = 35 pieces total (~3 animation values each).
type ConfettiLayerRanges = {
  count: number;
  size: readonly [number, number];
  fallDuration: readonly [number, number];
  swayAmplitude: readonly [number, number];
  maxOpacity: number;
};

const CONFETTI_LAYERS: Record<'back' | 'mid' | 'front', ConfettiLayerRanges> = {
  back: { count: 12, size: [3, 5], fallDuration: [4000, 6000], swayAmplitude: [8, 22], maxOpacity: 0.5 },
  mid: { count: 15, size: [4, 9], fallDuration: [2600, 4400], swayAmplitude: [8, 22], maxOpacity: 1 },
  front: { count: 8, size: [9, 13], fallDuration: [1500, 2400], swayAmplitude: [12, 28], maxOpacity: 1 },
};

type ConfettiSpec = {
  left: `${number}%`;
  size: number;
  color: string;
  fallDuration: number;
  fallDelay: number;
  swayAmplitude: number;
  swayDuration: number;
  rotateDuration: number;
  maxOpacity: number;
};

function randBetween([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}

function makeLayerSpecs(layer: ConfettiLayerRanges): ConfettiSpec[] {
  return Array.from({ length: layer.count }, () => ({
    left: `${Math.random() * 100}%`,
    size: randBetween(layer.size),
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    fallDuration: randBetween(layer.fallDuration),
    fallDelay: Math.random() * 1200,
    swayAmplitude: randBetween(layer.swayAmplitude),
    swayDuration: 900 + Math.random() * 700,
    rotateDuration: 1600 + Math.random() * 1600,
    maxOpacity: layer.maxOpacity,
  }));
}

function makeConfettiSpecs(): { behind: ConfettiSpec[]; front: ConfettiSpec[] } {
  return {
    behind: [...makeLayerSpecs(CONFETTI_LAYERS.back), ...makeLayerSpecs(CONFETTI_LAYERS.mid)],
    front: makeLayerSpecs(CONFETTI_LAYERS.front),
  };
}

function ConfettiPiece({ spec, fallDistance }: { spec: ConfettiSpec; fallDistance: number }) {
  const translateY = useSharedValue(-20);
  const translateX = useSharedValue(0);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(spec.maxOpacity);

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
  // NAV1 job 0 — celebration screens are AppHeader-exempt, never safe-area-exempt.
  const insets = useSafeAreaInsets();
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
  // SC2 — the journey card's {practiceNoun} slot and the dot strip's
  // named line both need this circle's practice name; fetched in the
  // same getCircleById call that derives dayNumber.
  const [practiceName, setPracticeName] = useState<string | null>(null);
  // P1: the sound-suppression check below needs to know whether a
  // milestone exists before it can decide whether this is a glow-beat
  // check-in — this flag distinguishes "not fetched yet" from "fetched,
  // no milestone" (both read as glowMilestone === null otherwise).
  const [milestoneChecked, setMilestoneChecked] = useState(false);
  // SC2 — the fully resolved /share-card route params (flavor picked by
  // the server, journey slots already filled, dot-strip week baked in),
  // ready for handleDismiss to push. Replaces SC1's raw ShareCard state:
  // the two new flavors need circle facts resolved at fetch time, not
  // at dismiss time.
  const [cardNavParams, setCardNavParams] = useState<Record<string, string> | null>(null);
  // PN1 — the earned-moment pre-permission ask: only worth showing when
  // the OS hasn't been asked yet (native only) AND our own card hasn't
  // already been shown once, ever.
  const [showPushAsk, setShowPushAsk] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web' || !session?.user) return;
    const userId = session.user.id;
    Promise.all([getPushPermissionStatus(), getMyProfile(userId)])
      .then(([status, profile]) => {
        if (status === 'undetermined' && !profile?.has_seen_push_prompt) {
          setShowPushAsk(true);
          // PN1B: "not now" is gone, so showing the card IS the one shot —
          // mark it seen immediately, not on interaction. Whatever the
          // person does next (Turn on, Nice, navigate away, kill the app),
          // the primer never comes back. Before this, only the two buttons
          // marked it seen, so simply continuing let it reappear forever.
          markPushPromptSeen(userId).catch(() => {});
        }
      })
      .catch(() => {});
  }, [session?.user]);

  const handleTurnOnPush = () => {
    if (!session?.user) return;
    // seen is already marked at show time — this only needs to hide the card
    registerForPushNotificationsAsync(session.user.id).finally(() => setShowPushAsk(false));
  };

  useEffect(() => {
    if (!circleId) return;
    getCircleById(circleId)
      .then((circle) => {
        if (!circle) return;
        const raw = Math.max(1, daysBetween(circle.startDate, getLocalDateString()) + 1);
        setDayNumber(Math.min(raw, circle.durationDays));
        setIsCeremonyDay(raw >= circle.durationDays);
        setPracticeName(circle.practiceName);
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
    const userId = session.user.id;
    const day = dayNumber;
    const earned = earnedToday === 'true';
    if (!shouldOfferShareCard({
      isCeremonyDay,
      hasMilestone: !!glowMilestone,
      showsGlowBeat: shouldShowGlowBeat({ earnedToday: earned, hasMilestone: !!glowMilestone }),
    })) {
      return;
    }
    // SC2: the week (rekindle + covered + the dot strip's own content)
    // and this circle's own-check-in count (journey count slots) ride
    // the same fetch; a failed count degrades to null (count-slot
    // templates just don't serve) rather than costing the day's card.
    Promise.all([
      getMyWeek(),
      circleId ? countMyCircleCompletions({ userId, circleId }).catch(() => null) : Promise.resolve(null),
    ])
      .then(async ([week, timesShown]) => {
        // A held 'today' in the week row means a friend covered this day
        // (a self check-in after a cover upserts into the same
        // completions key and is ignored) — spec §4.2's covered moment.
        const isCovered = week.length > 0 && week[week.length - 1].state === 'held';
        const card = await getShareCardForToday({
          localDate: getLocalDateString(),
          isRekindle: didRekindleToday(week),
          isCovered,
          journeyDay: day,
          timesShown,
        });
        if (!card) return null;
        return buildShareCardNavParams(card, { week, dayNumber: day, timesShown, practiceName });
      })
      .then((navParams) => setCardNavParams(navParams))
      .catch(() => setCardNavParams(null));
  }, [session?.user, milestoneChecked, dayNumber, isCeremonyDay, glowMilestone, earnedToday, circleId, practiceName]);

  // Glow milestones (Rally21-Glow-Spec.md §4) — detected once per this
  // screen's mount, right at check-in time; a monotonic server-side
  // tracker means this never refires for an already-celebrated milestone.
  useEffect(() => {
    checkGlowMilestone()
      .then(setGlowMilestone)
      .catch(() => {})
      .finally(() => setMilestoneChecked(true));
  }, []);

  const [confetti] = useState<{ behind: ConfettiSpec[]; front: ConfettiSpec[] }>(() =>
    reduceMotion ? { behind: [], front: [] } : makeConfettiSpecs()
  );

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

  // M2 (a) — one quick wink once the entrance + puff/hop have settled:
  // base → wink frame → base, quick swaps (never a crossfade — the frame
  // pair carries generation jitter). Both frames stay mounted; the wink
  // sits on top and toggles visibility, so there's no decode flash.
  const [showWink, setShowWink] = useState(false);
  useEffect(() => {
    if (reduceMotion) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const step of frameSwapSchedule(MASCOT_FX.WINK_DELAY_MS, MASCOT_FX.WINK_HOLD_MS, MASCOT_FX.WINK_SWAPS)) {
      timers.push(setTimeout(() => setShowWink(true), step.showAltAtMs));
      timers.push(setTimeout(() => setShowWink(false), step.showBaseAtMs));
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (cardNavParams) {
      router.replace({ pathname: '/share-card', params: cardNavParams });
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
      <Brandmark style={[styles.brandmark, { top: 20 + insets.top }]} />

      {confetti.behind.length > 0 && (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          {confetti.behind.map((spec, i) => (
            <ConfettiPiece key={i} spec={spec} fallDistance={windowHeight} />
          ))}
        </View>
      )}

      <Animated.View style={penguinStyle}>
        {/* M2: confetti-free restyled art; the celebration sparkle now
            comes from code — the P2 depth layers behind/in front, plus
            this small banner-scoped green burst standing in for the
            confetti that used to be baked into the old asset. */}
        <View style={styles.penguinWrap}>
          <View style={styles.bannerBurst} pointerEvents="none">
            <ConfettiBurst
              count={MASCOT_FX.CHECKIN_BANNER_CONFETTI_COUNT}
              colors={CONFETTI_COLORS}
              reduceMotion={reduceMotion}
              lifetimeMs={2600}
              fadeMs={600}
            />
          </View>
          <Image
            source={MASCOT.proudAfterShowingUp}
            style={styles.penguin}
            resizeMode="contain"
            accessible={false}
            alt=""
          />
          <Image
            source={MASCOT.proudAfterShowingUpWink}
            style={[styles.penguin, styles.winkFrame, { opacity: showWink ? 1 : 0 }]}
            resizeMode="contain"
            accessible={false}
            alt=""
          />
        </View>
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

      {showPushAsk && (
        <View style={styles.pushAskWrap}>
          <Text style={styles.pushAskLine}>{STRINGS.pushAskLine}</Text>
          <TouchableOpacity onPress={handleTurnOnPush}>
            <Text style={styles.pushAskCta}>{STRINGS.pushAskCta}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* P2 front depth layer — rendered after the penguin/text/button so
          the big fast pieces drift in front of everything; pointerEvents
          none keeps the CTA tappable underneath. */}
      {confetti.front.length > 0 && (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          {confetti.front.map((spec, i) => (
            <ConfettiPiece key={i} spec={spec} fallDistance={windowHeight} />
          ))}
        </View>
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
    // P3: confetti pieces swaying past the screen edge used to extend
    // the web page's scroll area a few px sideways — clip at the
    // container so the celebration never scrolls (beyond-viewport
    // pieces were never visible anyway).
    overflow: 'hidden',
  },
  brandmark: {
    position: 'absolute',
    top: 20,
    left: 24,
  },
  penguinWrap: {
    marginBottom: 20,
  },
  // M2: the wink frame sits exactly over the base; visibility-toggled
  // for the quick swap (both mounted, so no decode flash).
  winkFrame: {
    position: 'absolute',
    top: 0,
    left: 0,
    marginBottom: 0,
  },
  // M2: the banner-scoped burst's clip box — a little wider than the
  // penguin so pieces drift past its shoulders, but never the whole
  // screen (that's the P2 layers' job).
  bannerBurst: {
    position: 'absolute',
    top: -20,
    left: -30,
    right: -30,
    bottom: 0,
    overflow: 'hidden',
  },
  penguin: {
    // Restored to the pre-M1 size along with the original transparent
    // penguin-confetti asset (7 July, Cat's call — the sheet crop's opaque
    // cream background read as a box on the warm-grey page).
    // P2 (15 July, Cat's TestFlight review): that size grown 50%, same
    // aspect — the celebration's hero should read like one.
    // M2 (17 July): same box, restyled confetti-free art.
    // P3 (21 July, Cat's on-device review): grown again, +60% from P2's
    // 195×201 — the largest size that provably keeps the whole layout,
    // push-ask variant included, inside 390×667 with no scroll
    // (browser-measured at ship time).
    width: 312,
    height: 322,
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
  pushAskWrap: {
    marginTop: 18,
    alignItems: 'center',
  },
  pushAskLine: {
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 6,
  },
  pushAskCta: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.green,
  },
});

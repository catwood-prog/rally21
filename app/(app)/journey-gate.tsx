import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
import { MilestoneStrip } from '@/components/CircleFormFields';
import { ConfettiBurst } from '@/components/ConfettiBurst';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors, CONFETTI_GREENS } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { playDay21Flourish } from '@/lib/chime';
import { getCircleById, MyCircle } from '@/lib/circle';
import { daysBetween, getLocalDateString } from '@/lib/date';
import { finishMyRally, GATE_DAY, getMyRallyCount, markCelebrationSeen } from '@/lib/journey';
import { markJourneyGateShown } from '@/lib/journeyGateGuard';
import { MASCOT_GESTURE, WARM_EASE_IN_OUT, WARM_EASE_OUT } from '@/lib/motion';
import { getMyProfile } from '@/lib/profile';
import { captureError } from '@/lib/sentry';

// The one big moment in the app (mascot brief) — a bigger, slower burst
// than check-in success's small daily beat. The burst mechanism itself
// lives in components/ConfettiBurst.tsx (BD2, 8 July) so the birthday
// moment can reuse it rather than a second implementation — these
// numbers are unchanged from before that extraction.
const CONFETTI_COUNT = 34;
// M2: always green (CONFETTI_GREENS is the one source of truth).
const CONFETTI_COLORS = [...CONFETTI_GREENS];

// 3j — the "let's go" fall: ~1.2s of confetti, then Today. The navigate
// timer sits just past the fall so the beat completes, and is a TIMER
// rather than an animation callback so nothing can strand the person.
const LETS_GO_FALL_MS = 1200;
const LETS_GO_NAVIGATE_MS = 1250;

/**
 * PA2 — THE CEREMONY IS PERSONAL. It fires on this member's own 21st
 * PRACTICE (PA1's count), it celebrates what THEY did, and nothing
 * tapped here decides anything for anybody else.
 *
 * 'pending'  — the celebration, not yet answered.
 * 'ralliedOn'— they chose to keep going (RF1 3j's outcome screen A).
 * 'finished' — they finished THEIR OWN rally here (3k, translated from
 *              circle-archive to personal-finish). The circle carries on.
 *
 * The old 'rallied' fait-accompli branch is GONE with the circle-level
 * decision it announced: there is no longer anything a first-mover could
 * have already spent on this person's behalf.
 */
type Decision = 'pending' | 'ralliedOn' | 'finished';

/** CB1 job 1a — where the ceremony's exit actually goes, in the same
 * place as the label it renders. The trap Cat hit on 25 July was exactly
 * this pair drifting apart: the button said "Back to today" and called
 * router.replace('/circle'), and the circle screen pushed straight back
 * here on the same gate check. Today is where a returning person
 * belongs, so the DESTINATION was the defect, never the label.
 *
 * PA2 — this is now the FINISHED branch's exit (and the not-found
 * state's). The rallied-on branch has its own gold "let's go" button
 * because 3j gives it a confetti beat first, but it lands in exactly the
 * same place: after either answer the circle screen has nothing left to
 * ask, so there is no reason to send anyone there instead.
 * journey-gate.test.tsx pins label-to-destination so the two cannot
 * drift apart again. */
export const JOURNEY_GATE_EXIT_HREF = '/today' as const;

export function JourneyGateExitButton() {
  const router = useRouter();
  return (
    <TouchableOpacity
      style={styles.primaryButton}
      onPress={() => router.replace(JOURNEY_GATE_EXIT_HREF)}
    >
      <Text style={styles.primaryButtonText}>{STRINGS.journeyCompletedCta}</Text>
    </TouchableOpacity>
  );
}

export default function JourneyGate() {
  const router = useRouter();
  // NAV1 job 0 — ceremony screens are AppHeader-exempt, never safe-area-exempt.
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { circleId } = useLocalSearchParams<{ circleId: string }>();
  const reduceMotion = useReducedMotion();

  const [circle, setCircle] = useState<MyCircle | null>(null);
  // PA2 — the member's own practice count in this circle. It is what the
  // ceremony is ABOUT, so it is fetched rather than assumed to be 21:
  // the gate fires at "21 or more, not yet answered", so someone who was
  // away when they crossed it can arrive here on their 23rd.
  const [rallyCount, setRallyCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [decision, setDecision] = useState<Decision>('pending');
  const [isAnswering, setIsAnswering] = useState(false);
  const [isConfirmingFinish, setIsConfirmingFinish] = useState(false);
  // 3j — bumped to remount ConfettiBurst for the "let's go" fall.
  const [letsGoBurst, setLetsGoBurst] = useState(0);

  useEffect(() => {
    // CB1 job 1b — reached without a circleId (a stale link, a direct
    // nav), this used to leave isLoading true forever: a spinner on a
    // tab-bar-exempt screen with no exit, which is the same stranding as
    // the loop. Fall through to the not-found state, which now has one.
    if (!circleId) {
      setIsLoading(false);
      return;
    }
    // CB1 job 1b — the guard goes down HERE: on the way in, before any
    // network call, so no failure downstream (this fetch, the marker
    // write) can leave a screen re-routing to a ceremony the person has
    // already been shown. See lib/journeyGateGuard.ts.
    markJourneyGateShown(circleId);
    Promise.all([
      getCircleById(circleId),
      session?.user ? getMyRallyCount(circleId, session.user.id) : Promise.resolve(0),
    ])
      .then(([c, count]) => {
        if (!c) return;
        setCircle(c);
        setRallyCount(count);
        if (c.completedAt) {
          // Reached directly with nothing left to decide — the archive
          // view (task R1.4) is the right home for this, not the gate.
          router.replace({ pathname: '/circle', params: { circleId: c.id } });
        }
        // PA2 — THE MOUNT WRITE IS GONE, and this is the whole point of
        // JOB 2. `markCelebrationSeen(c.id, GATE_DAY)` used to fire right
        // here, which meant the ceremony was SPENT BY BEING LOOKED AT
        // (memo §2, §7): a glance, a mis-tap, a back-swipe, or an app
        // killed mid-render burned someone's first-rally moment for good,
        // with no way to get it back. The personal ceremony must not
        // inherit that.
        //
        // It is now written only from `answer()` below — when the person
        // actually chooses. The consequence, stated rather than hidden:
        // "decide later" leaves it UNANSWERED, so the celebration is
        // offered again on a later app launch. CB1's session guard
        // (markJourneyGateShown, set above on the way IN) means that is
        // at most once per app session, never a loop — and being offered
        // your own milestone again is not a nag, whereas silently eating
        // it is a loss.
      })
      .catch((error) => {
        // The fetch's own failure lands on the not-found state (which has
        // an exit). Worth reporting: it is one of the ways someone
        // reaches this screen with nothing on it.
        captureError(error, { screen: 'journey-gate', op: 'load' });
      })
      .finally(() => setIsLoading(false));
  }, [circleId, router, session?.user?.id]);

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
        {/* CB1 job 1b — this state had no exit at all, on a screen with
            no tab bar: a network blip on the fetch above (or a link that
            lost its circleId) stranded someone on a single grey line.
            Same button, same destination as every other exit here. */}
        <View style={styles.notFoundExitWrap}>
          <JourneyGateExitButton />
        </View>
      </View>
    );
  }

  /**
   * PA2 — the ONE place the ceremony is marked answered, replacing the
   * mount write. Both answers go through it so neither can forget.
   *
   * The marker is AWAITED here, unlike the mount version: this is a
   * deliberate reversal. On mount, awaiting would have blocked the
   * screen's own render on a network call; from a button press there is
   * already a spinner, and it means a person who taps "rally on" and
   * sees the next screen has genuinely had their answer recorded. A
   * failure keeps them on the celebration with the choice still in front
   * of them, which is the honest outcome — better than advancing them
   * past a moment the server never heard about.
   */
  const answer = async (next: 'ralliedOn' | 'finished', write?: () => Promise<void>) => {
    setIsAnswering(true);
    try {
      if (write) await write();
      await markCelebrationSeen(circle.id, GATE_DAY);
      setDecision(next);
    } catch (error) {
      captureError(error, { screen: 'journey-gate', op: `answer:${next}` });
      setIsConfirmingFinish(false);
    } finally {
      setIsAnswering(false);
    }
  };

  // Continuing is now the DEFAULT rather than a decision — PA1's ladder
  // already fires 42/50/100/365 off this member's own count with nothing
  // to opt into. So this writes no circle state at all: it acknowledges
  // the milestone and moves to 3j's outcome screen.
  const handleRallyOn = () => answer('ralliedOn');

  // "finish here" is PERSONAL now (memberships.finished_at): it ends
  // THIS member's rally, never the circle. The creator's separate
  // circle-ending control lives in host controls on the circle screen.
  const handleFinishHere = () => answer('finished', () => finishMyRally(circle.id));

  /**
   * 3j's confetti interaction, exactly as Cat felt and approved it in the
   * clickable mockup: the ambient pieces sit STILL on the outcome screen,
   * and tapping "let's go" fires a short green fall BEFORE navigating.
   *
   * The fall is produced by remounting ConfettiBurst under a new key —
   * its specs are generated once per mount, so a new key is a new burst
   * without touching the shared component.
   *
   * NAVIGATION RUNS ON A TIMER, never gated on the animation finishing.
   * That is deliberate and load-bearing: if it awaited the animation,
   * anything that stopped the animation (reduced motion mid-flight, a
   * backgrounded app, a dropped frame budget) would strand the person on
   * a screen whose only button they had already pressed. Reduced motion
   * skips the fall and goes immediately.
   */
  const handleLetsGo = () => {
    if (reduceMotion) {
      router.replace('/today');
      return;
    }
    setLetsGoBurst((n) => n + 1);
    setTimeout(() => router.replace('/today'), LETS_GO_NAVIGATE_MS);
  };

  return (
    <View style={styles.container}>
      <Brandmark style={[styles.brandmark, { top: 20 + insets.top }]} />

      <ConfettiBurst count={CONFETTI_COUNT} colors={CONFETTI_COLORS} reduceMotion={reduceMotion} />
      {letsGoBurst > 0 && (
        <ConfettiBurst
          key={`lets-go-${letsGoBurst}`}
          count={CONFETTI_COUNT}
          colors={CONFETTI_COLORS}
          reduceMotion={reduceMotion}
          lifetimeMs={LETS_GO_FALL_MS}
          fadeMs={300}
        />
      )}

      {/* OD1 job 17b — this screen has no scroll fallback when Dynamic
          Type grows the title/body/confirm-card content past the
          viewport: content becomes literally unreachable (no way to
          reach the rally-on/complete buttons), worst mid-decision with
          the complete-confirm card open. 17a's shape (flexGrow:1 content
          container, still centers when it fits) applied here only —
          Brandmark/ConfettiBurst stay outside as fixed viewport overlays,
          same as AppHeader sits outside the ScrollView elsewhere. */}
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View style={heroStyle}>
          <Image
            source={MASCOT.day21CelebrationHuddle}
            style={styles.hero}
            resizeMode="contain"
            accessible={false}
            alt=""
          />
        </Animated.View>

        {decision === 'finished' ? (
          /* PA2 — RF1 3k's outcome, translated from circle-archive to
             personal-finish. Cat's ruled 3k body said "what you built
             together is archived, not lost", which was true when
             finishing meant the CREATOR archiving the circle. It is false
             here: the circle is untouched and everyone else carries on.
             Finishing is honoured with the same confetti ambience the
             continue path gets (3f's warmth law — choosing to finish is
             not a miss, and the product must not put its thumb on the
             scale for its own retention). */
          <>
            <Animated.Text style={[styles.title, headingStyle]}>
              {STRINGS.journeyFinishedTitle}
            </Animated.Text>
            <Animated.Text style={[styles.subline, bodyStyle]}>
              {STRINGS.journeyFinishedSubline(circle.name, rallyCount ?? GATE_DAY)}
            </Animated.Text>
            <Animated.Text style={[styles.body, bodyStyle]}>
              {STRINGS.journeyFinishedBody}
            </Animated.Text>
            <Animated.View style={[styles.actionsWrap, actionsStyle]}>
              <JourneyGateExitButton />
            </Animated.View>
          </>
        ) : decision === 'ralliedOn' ? (
          /* PA2 — RF1 3j's outcome screen A, LOCKED by Cat. The strip is
             the SHIPPED FirstRallyStrip's own component via its new
             variant, never a fork: 21 carries a green tick, 50 is the
             larger next stop. */
          <>
            <Animated.Text style={[styles.title, headingStyle]}>
              {STRINGS.journeyNextStopTitle}
            </Animated.Text>
            <Animated.View style={[styles.stripWrap, bodyStyle]}>
              <MilestoneStrip reached={[GATE_DAY]} next={50} />
            </Animated.View>
            <Animated.Text style={[styles.body, bodyStyle]}>
              {STRINGS.journeyNextStopBody}
            </Animated.Text>
            <Animated.View style={[styles.actionsWrap, actionsStyle]}>
              <TouchableOpacity style={styles.primaryButton} onPress={handleLetsGo}>
                <Text style={styles.primaryButtonText}>{STRINGS.journeyNextStopCta}</Text>
              </TouchableOpacity>
            </Animated.View>
          </>
        ) : (
          <>
            <Animated.Text style={[styles.title, headingStyle]}>{STRINGS.journeyGateTitle}</Animated.Text>
            {/* 3a's personal row: the circle this rally happened in.
                Rendered as stored — never re-cased (CLAUDE.md). */}
            <Animated.Text style={[styles.subline, bodyStyle]}>{circle.name}</Animated.Text>
            <Animated.Text style={[styles.body, bodyStyle]}>{STRINGS.journeyGateBody}</Animated.Text>

            <Animated.View style={[styles.actionsWrap, actionsStyle]}>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleRallyOn}
                disabled={isAnswering}
              >
                {isAnswering && !isConfirmingFinish ? (
                  <ActivityIndicator size="small" color={colors.ink} />
                ) : (
                  <Text style={styles.primaryButtonText}>{STRINGS.journeyGateRallyOnCta}</Text>
                )}
              </TouchableOpacity>
              <Text style={styles.helperText}>{STRINGS.journeyGateRallyOnHelper}</Text>

              {/* 3e/3f — "finish here" keeps its secondaryButton
                  prominence and is NOT demoted to a quiet text link
                  (Cat re-affirmed this against a proposal to demote it).
                  PA2 changes only WHAT it does: it finishes YOUR rally,
                  so it is no longer host-gated — every member can reach
                  it, which is what the personal model requires. The
                  explanation lives in the revealed confirm card, not the
                  standing stack. */}
              {isConfirmingFinish ? (
                <View style={styles.finishConfirmCard}>
                  <Text style={styles.finishConfirmTitle}>{STRINGS.journeyFinishConfirmTitle}</Text>
                  <Text style={styles.finishConfirmBody}>{STRINGS.journeyFinishConfirmBody}</Text>
                  <View style={styles.finishConfirmRow}>
                    <TouchableOpacity
                      onPress={() => setIsConfirmingFinish(false)}
                      disabled={isAnswering}
                    >
                      <Text style={styles.finishCancelText}>{STRINGS.cancelCta}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={handleFinishHere} disabled={isAnswering}>
                      <Text style={styles.finishConfirmActionText}>
                        {isAnswering ? '…' : STRINGS.journeyFinishConfirmCta}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => setIsConfirmingFinish(true)}
                >
                  <Text style={styles.secondaryButtonText}>{STRINGS.journeyGateCompleteOpener}</Text>
                </TouchableOpacity>
              )}

              {/* 3d — deciding later is always allowed. PA2: this
                  deliberately does NOT mark the ceremony answered, so
                  the moment is still there next launch. */}
              <TouchableOpacity style={styles.notNowButton} onPress={() => router.replace('/today')}>
                <Text style={styles.notNowText}>{STRINGS.journeyGateNotNow}</Text>
              </TouchableOpacity>
            </Animated.View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  // OD1 job 17b — was the plain container's own alignItems/justifyContent/
  // paddingHorizontal; moved onto the ScrollView's content container so it
  // still centers when content fits, but scrolls (rather than clipping)
  // when Dynamic Type or the confirm-card state makes it taller than the
  // screen. flexGrow:1 (not flex:1) is what lets a ScrollView's content
  // container both fill and center short content.
  content: {
    flexGrow: 1,
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
  // CB1 job 1b — the not-found state's exit sits in the same 24px gutter
  // the ceremony's own content uses, so the button matches width for
  // width; alignSelf stretch because the loading container centers.
  notFoundExitWrap: {
    alignSelf: 'stretch',
    marginTop: 20,
    paddingHorizontal: 24,
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
  // 3a — the personal row under the title (the circle this rally
  // happened in), and 3k's "{circle} · N practices" line. One style: both
  // are the same quiet identifying line directly beneath a title.
  subline: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.mutedStrong,
    textAlign: 'center',
    marginBottom: 10,
  },
  // 3j — the ladder strip sits between the title and the body, centred.
  stripWrap: {
    alignItems: 'center',
    marginBottom: 16,
  },
  // 3e — the archive/finish explanation lives in the revealed confirm
  // card, not the standing stack, so the pre-decision screen keeps ONE
  // explanatory layer (3i's declutter).
  finishConfirmCard: {
    marginTop: 18,
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
  },
  finishConfirmTitle: {
    fontFamily: FONT_HEADER,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 6,
    textAlign: 'center',
  },
  finishConfirmBody: {
    fontSize: 12.5,
    color: colors.mutedStrong,
    textAlign: 'center',
    marginBottom: 14,
  },
  finishConfirmRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
  },
  finishCancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.mutedStrong,
  },
  finishConfirmActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
});

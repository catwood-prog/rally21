import { BackLink } from '@/components/BackLink';
import { withErrorBoundary } from '@/components/ErrorBoundary';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { ParamListBase } from '@react-navigation/native';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { MASCOT } from '@/assets/mascot';
import { Avatar } from '@/components/Avatar';
import { AppHeader } from '@/components/AppHeader';
import { ErrorSlip } from '@/components/ErrorSlip';
import { MicTextInput } from '@/components/MicTextInput';
import { CheckedInBadge } from '@/components/CheckedInBadge';
import { LinkCard } from '@/components/LinkCard';
import { MascotEntrance } from '@/components/MascotEntrance';
import { MessageDialog } from '@/components/MessageDialog';
import { PairStreakLine } from '@/components/PairStreakLine';
import { SignalMeter } from '@/components/SignalMeter';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, chipTextShape, colors } from '@/constants/theme';
import { useCheckinLaunch } from '@/hooks/use-checkin-launch';
import { useRevealIntoView } from '@/hooks/use-reveal-into-view';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useAuth } from '@/lib/auth-context';
import { deriveWantPhrase, getWantActivationForCircle } from '@/lib/blueprint';
import {
  attachRestingStatus,
  CircleMember,
  CirclePresenceRow,
  getCircleMembers,
  getCirclePresence,
  getCoverableMembers,
  isSoloCircle,
  leaveCircle,
  listMyCircles,
  MyCircle,
  removeMemberFromCircle,
  myStateInCircle,
  resolveCircleSelection,
  setCircleClosedToJoins,
  setCircleResourceUrl,
  subscribeToCirclePresence,
} from '@/lib/circle';
import { isBirthdayToday } from '@/lib/birthday';
import { daysBetween, getLocalDateString, localDateStringInTimeZone, shiftDate } from '@/lib/date';
import { getGlowForCircleMates, getPairStreaks, PairStreak } from '@/lib/glow';
import { headcountLine } from '@/lib/headcount';
import {
  completeCircle,
  GATE_DAY,
  countRallyDays,
  getMyLastCelebratedDay,
  getNextMilestone,
} from '@/lib/journey';
import { shouldRouteToJourneyGate } from '@/lib/journeyGateGuard';
import { blockUser, getMyBlocks, reportContent, unblockUser } from '@/lib/moderation';
import { getMyProfile, markCoverHintSeen } from '@/lib/profile';
import { extractYouTubeId, isHttpUrl } from '@/lib/resourceLink';
import { captureError } from '@/lib/sentry';
import { computeSignal, PresenceRow } from '@/lib/signal';
import {
  FriendGestureKind,
  getWallPreview,
  isFriendNudgeEnabled,
  sendFriendNudge,
  subscribeToWall,
  WallPreviewItem,
} from '@/lib/wall';

const MAX_AVATARS_SHOWN = 8;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** RS1/RS2 — resting AND away members fade to the edge of the huddle;
 * active members stay in the warm center. Away is an explicit, live
 * state (not derived from quiet days like isResting), so it pushes to
 * the edge immediately regardless of the 5-day threshold. A stable sort
 * (guaranteed since ES2019) preserves each group's own relative order
 * otherwise. */
function isAtHuddleEdge(m: { isResting: boolean; awaySince: string | null }): boolean {
  return m.isResting || !!m.awaySince;
}
function sortToHuddleEdge<T extends { isResting: boolean; awaySince: string | null }>(members: T[]): T[] {
  return [...members].sort((a, b) => Number(isAtHuddleEdge(a)) - Number(isAtHuddleEdge(b)));
}

type ListCircleData = { members: CircleMember[]; presence: CirclePresenceRow[] };

function YourCircle() {
  const router = useRouter();
  const { session } = useAuth();
  // TB3 — inset-aware pill clearance; applied to both states' scrolls.
  const tabBarClearance = useTabBarClearance();
  // OD1 job 4a — every inline expander on this screen reveals content
  // below the current scroll position; this brings it up above the pill.
  const { scrollRef, onScroll, captureReveal, revealIntoView } =
    useRevealIntoView(tabBarClearance);
  const { circleId } = useLocalSearchParams<{ circleId?: string }>();
  // Typed as a bottom-tab navigation so the OD1 Job 6 'tabPress' listener
  // below type-checks (expo-router's default useNavigation type has no tab
  // events — this screen IS a tab, so the cast is accurate, not a fudge).
  const navigation = useNavigation<BottomTabNavigationProp<ParamListBase>>();
  const [circle, setCircle] = useState<MyCircle | null>(null);
  const [members, setMembers] = useState<CircleMember[]>([]);
  // PA1 — typed as the FULL row (kind required), not signal.ts's
  // optional-kind PresenceRow: `countRallyDays` refuses a row whose kind
  // might be missing, because a kind-less covered row counting as a
  // practice is exactly the trap the memo's §4 correction exists to stop.
  const [presence, setPresence] = useState<CirclePresenceRow[]>([]);
  // Distinguishes "no completions yet" from "not fetched yet" — the
  // ceremony effect must not decide on an empty array it was handed
  // before the rows arrived.
  const [presenceLoaded, setPresenceLoaded] = useState(false);
  // GS1 — the Who's Here glow ride-along (7+ days only; server-floored).
  const [glowByUserId, setGlowByUserId] = useState<Map<string, number>>(new Map());
  // CV1 — memberId → their missed local day (yesterday), for members who
  // are coverable RIGHT NOW (at embers, this circle's yesterday still open).
  // The server owns the ember + timezone logic; the client only renders the
  // pill and passes the date straight through to the cover write.
  const [coverableByUserId, setCoverableByUserId] = useState<Map<string, string>>(new Map());
  const [wallPreview, setWallPreview] = useState<WallPreviewItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Non-empty only when there's no circleId param AND the user is in more
  // than one circle — the tab's own root: a card per circle, tap through.
  const [listCircles, setListCircles] = useState<MyCircle[]>([]);
  // OD1 Job 6 — whether the user is in more than one circle, computed from
  // the real membership count (NOT the fromTab flag, which is exactly what
  // failed here). Drives the detail view's "← your circles" affordance so a
  // multi-circle user who arrived from Today can still reach the others.
  // FF2 — three states, not two: null is "we don't know yet / the read
  // failed", and the back link renders a claim-free 'back' for it rather
  // than asserting this is your only circle.
  const [hasOtherCircles, setHasOtherCircles] = useState<boolean | null>(null);
  const [listData, setListData] = useState<Record<string, ListCircleData>>({});
  const [isConfirmingLeave, setIsConfirmingLeave] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isEditingLink, setIsEditingLink] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const [isSavingLink, setIsSavingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isManagingMembers, setIsManagingMembers] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [isRemovingMember, setIsRemovingMember] = useState(false);
  const [isTogglingClosed, setIsTogglingClosed] = useState(false);
  // Defaults to true so the discovery hint never flashes before the real
  // value loads — it only ever matters once it resolves to false.
  const [hasSeenCoverHint, setHasSeenCoverHint] = useState(true);
  // WB1 job 3 — the two profile flags the check-in flow branches on. Both
  // ride the profile read this screen ALREADY does in `load`; neither adds
  // a query. The defaults are Today's, and for Today's reasons: consent
  // defaults SEEN so the one-shot intro never flashes before the real
  // value lands, and opt-out defaults FALSE so nobody's reflection screen
  // is skipped on a guess.
  const [hasSeenCheckinConsent, setHasSeenCheckinConsent] = useState(true);
  const [reflectionsOptOut, setReflectionsOptOut] = useState(false);
  const [checkinError, setCheckinError] = useState<string | null>(null);
  // CB1 job 1b — null means "not loaded yet", and that distinction is
  // load-bearing, not tidiness. `load` calls setCircle BEFORE awaiting the
  // batch that fetches this value, so `circle` commits a render earlier
  // than the day it must be judged against. While this defaulted to 0,
  // that gap re-fired the day-21 ceremony on EVERY fresh mount of this
  // screen at day 21+ — including for a member already marked at 21 —
  // which is the other half of the cycle Cat was caught in (found by the
  // CB1 walk: exiting the ceremony to Today worked, then opening the
  // circle screen sent her straight back to it). The ceremony effect
  // below now waits for the real value.
  const [myLastCelebratedDay, setMyLastCelebratedDay] = useState<number | null>(null);
  const [pairStreaks, setPairStreaks] = useState<PairStreak[]>([]);
  const [isConfirmingComplete, setIsConfirmingComplete] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [wantStatementForCircle, setWantStatementForCircle] = useState<string | null>(null);
  // MOD1: which member's report/block panel is open, if any — one at a
  // time, reachable by tapping their avatar in "who's here".
  const [memberActionsFor, setMemberActionsFor] = useState<string | null>(null);
  const [memberActionMode, setMemberActionMode] = useState<'report' | 'block' | null>(null);
  const [memberReportReason, setMemberReportReason] = useState('');
  const [isSubmittingMemberAction, setIsSubmittingMemberAction] = useState(false);
  const [showMemberReportedNotice, setShowMemberReportedNotice] = useState(false);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  // HW1: the two friend gestures on who's-here. Members who've opted out
  // of nudges get NO gesture pills (the affordance is silently absent,
  // never explained — Notifications spec §4b), so we track the disabled
  // set; absent-from-set (including while loading) means reachable,
  // matching cover.tsx's optimistic default.
  const [nudgeDisabledIds, setNudgeDisabledIds] = useState<Set<string>>(new Set());
  // Which gestures were sent this mount, per member — the pill quiets
  // down once its gesture has landed. Keyed by userId.
  const [sentGestures, setSentGestures] = useState<
    Record<string, Partial<Record<FriendGestureKind, boolean>>>
  >({});
  const [sendingGestureKey, setSendingGestureKey] = useState<string | null>(null);
  // Warm designed outcomes (already-sent, cap, blocked) — a small
  // dialog, NEVER the screen-replacing `error` state.
  const [gestureNotice, setGestureNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);
    setListCircles([]);
    setHasOtherCircles(false);
    // CB1 job 1b — back to "not loaded" for the duration of this load, so
    // a switch between circles can never judge the new circle's ceremony
    // against the previous circle's marker.
    setMyLastCelebratedDay(null);
    try {
      const selection = await resolveCircleSelection(circleId, session.user.id);
      if (selection.kind === 'picker') {
        const entries = await Promise.all(
          selection.circles.map(async (c): Promise<[string, ListCircleData]> => {
            const [circleMembers, circlePresence] = await Promise.all([
              getCircleMembers(c.id),
              getCirclePresence(c.id),
            ]);
            return [c.id, { members: circleMembers, presence: circlePresence }];
          })
        );
        setListCircles(selection.circles);
        setListData(Object.fromEntries(entries));
        setCircle(null);
        return;
      }
      const myCircle = selection.circle;
      setCircle(myCircle);
      if (myCircle) {
        const [circleMembers, circlePresence, preview, profile, lastCelebratedDay, myPairStreaks, myBlocks, mateGlows, myCirclesList, coverable] =
          await Promise.all([
            getCircleMembers(myCircle.id),
            getCirclePresence(myCircle.id),
            getWallPreview(myCircle.id),
            getMyProfile(session.user.id),
            getMyLastCelebratedDay(myCircle.id, session.user.id),
            // FF1 rule 1 — silence is right: pair streaks are a
            // flourish on the member row, and [] renders NOTHING rather
            // than a wrong number, so a failed read understates a
            // friendship for one load instead of misstating it. Never
            // let this substitute a count.
            getPairStreaks(myCircle.id).catch(() => []),
            // FF2 — the blocks read FAILS CLOSED, deliberately not soft:
            // an empty list on a failed read renders a blocked person as
            // an ordinary member of the huddle, which is the one outcome
            // a block exists to prevent. It throws into the outer catch
            // below, so the screen shows ER1's line instead of a lie.
            getMyBlocks(),
            // GS1: one batch call for the whole huddle, riding the same
            // load — never a per-member fetch. Ambient pride only, so a
            // failed fetch just means no flames this visit.
            getGlowForCircleMates(myCircle.id).catch(() => new Map<string, number>()),
            // OD1 Job 6: the real "is there more than one circle?" answer,
            // riding the same load — drives the way-back-to-the-others
            // affordance instead of the fromTab flag. FF2: a failed read
            // degrades to UNKNOWN (null), never to "you have only this
            // one" — the old empty-array fallback hid the picker from
            // multi-circle people, which is exactly the bug Job 6 fixed.
            listMyCircles(session.user.id).catch((e) => {
              captureError(e, { screen: 'circle', op: 'listMyCircles' });
              return null;
            }),
            // CV1: who can be covered for yesterday right now (server owns
            // the ember + timezone rule). A failed fetch just means no cover
            // pills this visit, never an error.
            getCoverableMembers(myCircle.id).catch(() => new Map<string, string>()),
          ]);
        setHasOtherCircles(myCirclesList === null ? null : myCirclesList.length > 1);
        setMembers(circleMembers);
        setPresence(circlePresence);
        setPresenceLoaded(true);
        setGlowByUserId(mateGlows);
        setCoverableByUserId(coverable);
        setWallPreview(preview);
        setHasSeenCoverHint(!!profile?.has_seen_cover_hint);
        // WB1 job 3 — same profile row, no extra round trip.
        setHasSeenCheckinConsent(profile?.has_seen_checkin_consent ?? false);
        setReflectionsOptOut(profile?.reflections_opt_out ?? false);
        setMyLastCelebratedDay(lastCelebratedDay);
        setPairStreaks(myPairStreaks);
        setBlockedIds(new Set(myBlocks.map((b) => b.blockedId)));
        // HW1: one small parallel round for the gesture pills' opt-out
        // check (the RPC is per-user; who's-here shows at most 8).
        //
        // FF2 — CAT'S RULING, 28 July: this default is CONSERVATIVE. A
        // failed read reveals nothing; the pill appears only on a
        // successful read that says yes. The old permissive default
        // offered a gesture the recipient may have opted out of, which
        // lies about consent between friends — warmth-law grounds. The
        // cost of the safe direction is one missing pill until the next
        // load; the cost of the other is a promise we cannot keep.
        const nudgeStates = await Promise.all(
          circleMembers
            .filter((m) => m.userId !== session.user.id)
            .map(
              async (m) =>
                [
                  m.userId,
                  await isFriendNudgeEnabled(m.userId).catch((e) => {
                    captureError(e, { screen: 'circle', op: 'isFriendNudgeEnabled' });
                    return false;
                  }),
                ] as const
            )
        );
        setNudgeDisabledIds(
          new Set(nudgeStates.filter(([, enabled]) => !enabled).map(([id]) => id))
        );
        if (myCircle.completedAt) {
          // FF1 rule 1 — silence is right: this only supplies the want
          // STATEMENT printed on a completed circle's card. Null omits
          // the line; the card, and the completion it celebrates, stand
          // without it.
          const activation = await getWantActivationForCircle(myCircle.id).catch(() => null);
          setWantStatementForCircle(activation?.wantStatement ?? null);
        } else {
          setWantStatementForCircle(null);
        }
      }
    } catch {
      // ER1: the warm line, never the raw message (warmth law).
      setError(STRINGS.loadFailedLine('your circle'));
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id, circleId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // OD1 Job 6 — tapping the Circle TAB is a request for "my circles", never
  // "resume the last one". A circleId param left behind by an earlier
  // navigation (Today's card push, an invite CTA) otherwise STICKS on the
  // tab route, so a re-tap re-enters the same single circle and the picker
  // becomes unreachable — a whole circle vanishes for multi-circle users.
  // Clearing the stale param on tab press lets load resolve to the picker
  // (>1 circle) or the sole circle (1). tabPress fires ONLY on an actual
  // tab-bar tap, so a deliberate push into a specific circle is untouched
  // (OD1 Job 15b: honour deep navigation, reset only on tab focus). Reuses
  // the back-link's proven clean-route reset — never setParams({ circleId:
  // undefined }), which serialises to the literal "undefined" (a known trap
  // resolveCircleSelection treats as an explicit, not-found id).
  useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress', () => {
      if (circleId) router.replace('/circle');
    });
    return unsubscribe;
  }, [navigation, circleId, router]);

  useEffect(() => {
    if (!circle) return;
    const unsubscribe = subscribeToCirclePresence(circle.id, () => {
      getCirclePresence(circle.id).then(setPresence);
    });
    return unsubscribe;
  }, [circle?.id]);

  useEffect(() => {
    if (!circle) return;
    const unsubscribe = subscribeToWall(circle.id, () => {
      getWallPreview(circle.id).then(setWallPreview);
    });
    return unsubscribe;
  }, [circle?.id]);

  // Day-21 gate: the first qualifying open of this circle's detail
  // screen sends the user to the full-screen ceremony instead — same
  // idempotent check as Today's, in case this screen is reached first
  // (e.g. a direct link) without ever passing through Today.
  useEffect(() => {
    // CB1 job 1b — myLastCelebratedDay === null is "this member's marker
    // hasn't loaded yet", and routing to a CEREMONY on a value that isn't
    // in yet is how a seen ceremony re-fires. Wait for the real one; the
    // effect re-runs the moment it lands (it's a dependency).
    if (!circle || myLastCelebratedDay === null || !presenceLoaded || !session?.user) return;
    // PA1 — the ceremony threshold is this member's own rally count
    // (practices in THIS circle), not the circle's age. Gated on
    // presenceLoaded for the same reason CB1 gates on the marker: an
    // empty array is "not in yet", not "zero practices", and a ceremony
    // must never be decided on a value that hasn't arrived. Here the
    // untruth would fail SAFE (no ceremony), but the guard makes the
    // intent explicit rather than relying on which way the bug points.
    const rallyCount = countRallyDays(presence, session.user.id);
    // PA2 — my own finished_at for THIS circle. It rides the members
    // fetch (getCircleMembers now selects it) rather than a second
    // query, and it is read from `members` rather than the circle row
    // because this screen resolves its circle by id, which carries no
    // membership columns. A finished member is never routed into the
    // ceremony that starts a rally, nor its later milestone beats.
    const myFinishedAt = members.find((m) => m.userId === session.user.id)?.finishedAt ?? null;
    if (myFinishedAt) return;
    // CB1 job 1b — shouldRouteToJourneyGate, never shouldShowJourneyGate.
    // This push is the half of the cycle Cat hit: the ceremony exited to
    // /circle and this line sent her straight back, forever, because the
    // marker write had silently failed. Eligibility is untouched; the
    // guard (lib/journeyGateGuard.ts) is what stops the re-entry.
    if (shouldRouteToJourneyGate(circle.id, rallyCount, circle, myLastCelebratedDay, myFinishedAt)) {
      router.push({ pathname: '/journey-gate', params: { circleId: circle.id } });
      return;
    }
    // PA2 — the `circle.ralliedOnAt &&` condition is GONE. Rally markers
    // and major stops are PERSONAL milestones off this member's own
    // practice count (PA1), so gating them on a circle-level flag that
    // nothing writes any more would have silently switched every later
    // celebration off for good.
    if (!circle.completedAt) {
      const milestone = getNextMilestone(rallyCount, myLastCelebratedDay);
      if (milestone) {
        router.push({
          pathname: '/celebration',
          params: {
            circleId: circle.id,
            day: String(milestone.day),
            isMajorStop: String(milestone.isMajorStop),
          },
        });
      }
    }
  }, [circle, members, myLastCelebratedDay, presence, presenceLoaded, session?.user?.id, router]);

  // Completing a first cover teaches the same thing the hint says —
  // dismiss it for good the moment that happens, same as the voice hint
  // dismissing itself on first dictation.
  useEffect(() => {
    if (!session?.user || hasSeenCoverHint) return;
    // CV1 — a cover lands on the covered member's yesterday.
    const coveredDay = shiftDate(getLocalDateString(), -1);
    const coveredSomeone = presence.some(
      (p) => p.localDate === coveredDay && p.kind === 'covered' && p.coveredBy === session.user.id
    );
    if (coveredSomeone) {
      setHasSeenCoverHint(true);
      markCoverHintSeen(session.user.id).catch(() => {
        // low-stakes — the hint just might show again next time
      });
    }
  }, [presence, session?.user?.id, hasSeenCoverHint]);

  const dismissCoverHint = () => {
    if (!session?.user) return;
    setHasSeenCoverHint(true);
    markCoverHintSeen(session.user.id).catch(() => {
      // low-stakes — the hint just might show again next time
    });
  };

  // WB1 job 3 — THE SAME FLOW TODAY USES, not a second one that resembles
  // it: this is the hook Today's own CTA calls, so the route decision, the
  // params, the audio unlock and the one-tap write cannot diverge between
  // the two screens. BG1's rule applies as it does on Today — a hook lives
  // above the early returns below, never beside the button it feeds.
  const { launchCheckin, oneTapCircleId } = useCheckinLaunch({
    userId: session?.user?.id,
    hasSeenCheckinConsent,
    reflectionsOptOut,
    onError: setCheckinError,
  });

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  if (listCircles.length > 0) {
    const today = getLocalDateString();
    return (
      <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}>
        <AppHeader style={styles.brandmark} />
        <Text style={styles.title}>your circles</Text>
        <Text style={styles.subtitle}>tap one to see how it&apos;s going</Text>

        {listCircles.map((c) => {
          const data = listData[c.id] ?? { members: [], presence: [] };
          const isSolo = isSoloCircle(data.members.length);
          const signal = computeSignal({
            presence: data.presence,
            memberCount: data.members.length,
            today,
            circleStartDate: c.startDate,
          });
          // RS1/RS2 — resting or away members fade to the edge, so
          // they're the ones pushed into "+N" overflow first, not an
          // active member.
          const orderedMembers = sortToHuddleEdge(attachRestingStatus(data.members, data.presence, today));
          const shown = orderedMembers.slice(0, MAX_AVATARS_SHOWN);
          const overflow = orderedMembers.length - shown.length;
          const inTodayIds = new Set(
            data.presence.filter((p) => p.localDate === today).map((p) => p.userId)
          );
          // HY1 job 8 — YOUR own state in this circle. The three rules it
          // has to get right (not-loaded is not "not yet"; covered is its
          // own state; it must agree with your avatar's badge) live in
          // lib/circle.ts with their test, because each one is a claim
          // about a person and WB1's "one line" sizing did not survive
          // re-verification.
          const myStateHere = myStateInCircle({
            userId: session?.user?.id,
            members: data.members,
            presence: data.presence,
            today,
          });

          return (
            <TouchableOpacity
              key={c.id}
              style={styles.listCard}
              onPress={() => router.setParams({ circleId: c.id })}
            >
              <View style={styles.listCardNameRow}>
                {/* OD2 job 1 (Cat's 5 Aug screenshot) — the name is the one
                    thing in this row allowed to give way. It is the only
                    item with an unbounded width (a circle name is
                    user-generated and nothing validates its length), and
                    the badge beside it is a STATE: a clipped "YOU'RE IN"
                    is a wrong answer to "where am I", where a truncated
                    name is still a recognisable name. numberOfLines={1}
                    with flexShrink on the name and flexShrink: 0 on the
                    badges is the whole fix — nothing about the row's
                    shape, spacing or wording changes. */}
                <Text style={styles.listCardName} numberOfLines={1} ellipsizeMode="tail">
                  {c.name}
                </Text>
                {c.completedAt && (
                  <Text style={styles.completedBadgeSmall}>{STRINGS.journeyCompletedBadge}</Text>
                )}
                {/* HY1 job 8 (Cat's ruling, 4 Aug) — WHERE YOU ARE, on
                    every row, from data already in hand. The avatar strip
                    below has always carried your CheckedInBadge, but
                    `shown` is capped at MAX_AVATARS_SHOWN and RS1 orders
                    the huddle's edge first, so on a full circle your own
                    badge can sit inside the "+N" — the one member the
                    person is actually looking for is the one the row
                    could lose. A completed circle is not asking anything
                    of you, so it keeps its own badge alone. */}
                {!c.completedAt && myStateHere && (
                  <Text
                    style={[
                      styles.youBadgeSmall,
                      myStateHere === 'done' && styles.youBadgeSmallDone,
                      myStateHere === 'covered' && styles.youBadgeSmallCovered,
                    ]}
                  >
                    {myStateHere === 'done'
                      ? STRINGS.circlePickerYouDoneBadge
                      : myStateHere === 'covered'
                        ? STRINGS.circlePickerYouCoveredBadge
                        : STRINGS.circlePickerYouPendingBadge}
                  </Text>
                )}
              </View>
              <SignalMeter
                state={signal.state}
                dailyRates={signal.dailyRates}
                dayNumber={signal.dayNumber}
                rallyCount={countRallyDays(data.presence, session?.user?.id ?? '')}
                isSolo={isSolo}
              />
              <View style={[styles.avatarRow, styles.listCardAvatarRow]}>
                {shown.map((member) => {
                  const checkedIn = inTodayIds.has(member.userId);
                  const isCovered = data.presence.some(
                    (p) => p.localDate === today && p.userId === member.userId && p.kind === 'covered'
                  );
                  const state = isCovered ? 'covered' : checkedIn ? 'done' : 'pending';
                  return (
                    <View key={member.userId} style={styles.avatarRowItem}>
                      <Avatar name={member.name} userId={member.userId} avatarUrl={member.avatarUrl} size={34} ring={state} />
                      <CheckedInBadge state={state} />
                    </View>
                  );
                })}
                {overflow > 0 && (
                  <View style={[styles.avatarOverflow, styles.avatarOverflowSmall]}>
                    <Text style={styles.avatarOverflowText}>+{overflow}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  }

  if (!circle || error) {
    return (
      <View style={styles.loading}>
        {/* ER1: only a real failure gets the slip — the no-circle case
            is a neutral empty state, not an apology. */}
        {error ? (
          <ErrorSlip message={error} />
        ) : (
          <Text style={styles.subtitle}>you&apos;re not in a circle yet</Text>
        )}
      </View>
    );
  }

  const today = getLocalDateString();
  const inTodayUserIds = new Set(
    presence.filter((p) => p.localDate === today).map((p) => p.userId)
  );
  // WB1 job 3 — the two facts the check-in CTA turns on. Both are derived
  // from data this screen already holds: today's presence rows, and the
  // membership's own finished_at (read from `members` for the reason the
  // ceremony effect above states — this screen resolves its circle by id,
  // and a circle row carries no membership columns).
  const iAmCheckedInToday = !!session?.user && inTodayUserIds.has(session.user.id);
  const myFinishedAt = members.find((m) => m.userId === session?.user?.id)?.finishedAt ?? null;
  const isSolo = isSoloCircle(members.length);
  const signal = computeSignal({
    presence,
    memberCount: members.length,
    today,
    circleStartDate: circle.startDate,
  });

  const memberName = (userId: string) => {
    if (userId === session?.user.id) return 'You';
    return members.find((m) => m.userId === userId)?.name ?? 'circle-mate';
  };
  const myName = members.find((m) => m.userId === session?.user?.id)?.name ?? 'someone in your circle';

  // CV1 — covers now land on the MISSED day (the covered member's local
  // yesterday), so the "you were covered / you covered someone" celebration
  // reads yesterday's covered rows, not today's. It surfaces the day the
  // rescue happens (which is that day, for yesterday) and clears the next.
  const coveredDay = shiftDate(today, -1);
  // At most one of these shows at a time — a quiet, celebratory note,
  // never a score (see CLAUDE.md's cover-a-friend rule).
  const iWasCoveredToday = presence.find(
    (p) => p.localDate === coveredDay && p.userId === session?.user?.id && p.kind === 'covered'
  );
  const iCoveredSomeoneToday = presence.find(
    (p) => p.localDate === coveredDay && p.kind === 'covered' && p.coveredBy === session?.user?.id
  );

  // RS1 — a circle-mate quiet for 5+ days fades to the edge of the
  // huddle (never dropped, never told) rather than the circle ever
  // reading as dead. RS2 — a self-serve away pause takes the same edge
  // slot, immediately (no 5-day wait), with a distinct sleeping-penguin
  // treatment instead of the plain opacity fade. Purely derived from
  // data already fetched above; every "N of M" headcount line counts
  // only non-resting, non-away members in M (they're still real
  // members, just softly at the edge for now), and heart/wave/cover
  // stay fully reachable for them — they're exactly who those are for.
  const orderedMembers = sortToHuddleEdge(attachRestingStatus(members, presence, today));
  // PA2 — a member who has FINISHED their rally leaves the ACTIVE
  // roster (memo §8), joining resting and away members in being real
  // members who are not part of today's "N of M checked in". They stay
  // fully VISIBLE in the huddle below — only the headcount changes.
  const activeMembers = orderedMembers.filter(
    (m) => !m.isResting && !m.awaySince && !m.finishedAt
  );
  const activeMemberCount = activeMembers.length;
  // AU1 job 2 — the numerator takes the same roster rule as M (see
  // lib/headcount.ts): counting every completion row for today let an
  // away or finished member's check-in push this past M.
  const activeInTodayCount = activeMembers.filter((m) => inTodayUserIds.has(m.userId)).length;
  const shownMembers = orderedMembers.slice(0, MAX_AVATARS_SHOWN);
  // HW1: in a fuller huddle the gesture pills shrink to their glyphs so
  // the row never crowds at 390px — a gesture is never dropped, the
  // words just move to the accessibility labels.
  const useCompactGesturePills = shownMembers.length > 3;
  const overflowCount = orderedMembers.length - shownMembers.length;
  // CV1 — a member is coverable only when the server says so (at embers,
  // this circle's yesterday still open), not merely "not checked in today".
  const hasCoverableMember = shownMembers.some(
    (member) => member.userId !== session?.user?.id && coverableByUserId.has(member.userId)
  );
  const isCreator = circle.createdBy === session?.user?.id;
  const youtubeId = circle.resourceUrl ? extractYouTubeId(circle.resourceUrl) : null;

  // EC1 — everything about the circle (name, time, link, the practice
  // itself) is edited on the dedicated edit screen; the old inline
  // rename lived here until 16 July.
  const openEditCircle = () =>
    router.push({ pathname: '/edit-circle', params: { circleId: circle.id } });

  const startEditingLink = () => {
    setLinkDraft(circle.resourceUrl ?? '');
    setLinkError(null);
    setIsEditingLink(true);
  };

  const saveLink = async () => {
    const trimmed = linkDraft.trim();
    if (trimmed && !isHttpUrl(trimmed)) {
      setLinkError('that link needs to start with http:// or https://');
      return;
    }
    setIsSavingLink(true);
    setLinkError(null);
    try {
      await setCircleResourceUrl(circle.id, trimmed || null);
      setCircle({ ...circle, resourceUrl: trimmed || null });
      setIsEditingLink(false);
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : 'could not save — try again');
    } finally {
      setIsSavingLink(false);
    }
  };

  const removeLink = async () => {
    setIsSavingLink(true);
    setLinkError(null);
    try {
      await setCircleResourceUrl(circle.id, null);
      setCircle({ ...circle, resourceUrl: null });
      setLinkDraft('');
      setIsEditingLink(false);
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : 'could not remove — try again');
    } finally {
      setIsSavingLink(false);
    }
  };

  const handleLeave = async () => {
    if (!session?.user) return;
    setIsLeaving(true);
    try {
      await leaveCircle(circle.id);
      const remaining = await listMyCircles(session.user.id);
      router.replace(remaining.length === 0 ? '/onboarding/circle-setup' : '/today');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not leave — try again');
      setIsLeaving(false);
    }
  };

  const handleToggleClosedToJoins = async () => {
    setIsTogglingClosed(true);
    try {
      const next = !circle.closedToJoins;
      await setCircleClosedToJoins(circle.id, next);
      setCircle({ ...circle, closedToJoins: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not update — try again');
    } finally {
      setIsTogglingClosed(false);
    }
  };

  const handleCompleteCircle = async () => {
    setIsCompleting(true);
    try {
      await completeCircle(circle.id);
      setCircle({ ...circle, completedAt: new Date().toISOString() });
      setIsConfirmingComplete(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not complete this circle — try again');
    } finally {
      setIsCompleting(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    setIsRemovingMember(true);
    try {
      await removeMemberFromCircle(circle.id, memberId);
      setMembers(members.filter((m) => m.userId !== memberId));
      setRemovingMemberId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not remove — try again');
    } finally {
      setIsRemovingMember(false);
    }
  };

  // HW1: send a heart or a wave straight from the who's-here row — one
  // tap, no intermediate screen (the heart is the lightest gesture in
  // the app; the wave matches it). Both ride send_friend_nudge; every
  // designed rejection maps to warm copy (W1's patterns), never an
  // error state — a gesture never fails socially.
  const handleGesture = async (member: CircleMember, kind: FriendGestureKind) => {
    if (!session?.user) return;
    const name = member.name ?? 'your circle-mate';
    setSendingGestureKey(`${member.userId}:${kind}`);
    try {
      const result = await sendFriendNudge({
        circleId: circle.id,
        recipientId: member.userId,
        localDate: getLocalDateString(),
        kind,
      });
      if (result === 'sent') {
        setSentGestures((prev) => ({
          ...prev,
          [member.userId]: { ...prev[member.userId], [kind]: true },
        }));
      } else if (result === 'already_nudged') {
        setGestureNotice(
          kind === 'heart' ? STRINGS.alreadyHeartedError(name) : STRINGS.alreadyNudgedError(name)
        );
      } else if (result === 'wave_cap_reached') {
        // the cap is shared across kinds — the copy just matches the
        // gesture that bumped into it
        setGestureNotice(
          kind === 'heart' ? STRINGS.heartCapReachedError : STRINGS.waveCapReachedError
        );
      } else if (result === 'blocked') {
        setGestureNotice(
          kind === 'heart' ? STRINGS.heartNotDeliveredError : STRINGS.waveNotDeliveredError
        );
      }
    } catch (e) {
      // "nudges disabled" can only reach here via a race (opted out
      // between load and tap) since the pills are hidden whenever we
      // already know it's off — same warm mapping as cover.tsx.
      const message = e instanceof Error ? e.message : '';
      if (message.includes('nudges disabled')) {
        setGestureNotice(
          kind === 'heart' ? STRINGS.heartOptedOutError(name) : STRINGS.waveOptedOutError(name)
        );
      } else {
        setGestureNotice('something went wrong — try again');
      }
    } finally {
      setSendingGestureKey(null);
    }
  };

  const closeMemberActions = () => {
    setMemberActionsFor(null);
    setMemberActionMode(null);
    setMemberReportReason('');
  };

  const handleReportMember = async (memberId: string) => {
    setIsSubmittingMemberAction(true);
    try {
      await reportContent({
        targetKind: 'member',
        targetId: memberId,
        reason: memberReportReason.trim() || undefined,
        contextCircleId: circle?.id,
      });
      closeMemberActions();
      setShowMemberReportedNotice(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not send that report — try again');
    } finally {
      setIsSubmittingMemberAction(false);
    }
  };

  const handleBlockMember = async (memberId: string) => {
    setIsSubmittingMemberAction(true);
    try {
      await blockUser(memberId);
      setBlockedIds((prev) => new Set(prev).add(memberId));
      closeMemberActions();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not block — try again');
    } finally {
      setIsSubmittingMemberAction(false);
    }
  };

  const handleUnblockMember = async (memberId: string) => {
    setIsSubmittingMemberAction(true);
    try {
      await unblockUser(memberId);
      setBlockedIds((prev) => {
        const next = new Set(prev);
        next.delete(memberId);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not unblock — try again');
    } finally {
      setIsSubmittingMemberAction(false);
    }
  };

  return (
    <ScrollView
      ref={scrollRef}
      onScroll={onScroll}
      scrollEventThrottle={16}
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      keyboardShouldPersistTaps="handled"
    >
      <AppHeader style={styles.brandmark} />
      {/* OD1 Job 6b — the way back is the LOGICAL parent, decided by the
          real membership count, not the fromTab flag (the flag that failed
          here): a multi-circle user always gets back to "your circles"
          however they arrived; a single-circle user goes to Today.
          FF2: when the membership read failed we do not know which of
          those two this person is, so the link makes no claim — it says
          'back' and goes back, the same idiom the onboarding screens use. */}
      {hasOtherCircles === null ? (
        <BackLink
          label="back"
          onPress={() => (router.canGoBack() ? router.back() : router.push('/today'))}
          style={styles.back}
        />
      ) : (
        <BackLink
          label={hasOtherCircles ? 'your circles' : 'today'}
          onPress={() => (hasOtherCircles ? router.replace('/circle') : router.push('/today'))}
          style={styles.back}
        />
      )}

      {circle.completedAt && (
        <View style={styles.journeyCompletedBanner}>
          <Text style={styles.journeyCompletedBadge}>{STRINGS.journeyCompletedBadge}</Text>
          <Text style={styles.journeyCompletedBannerTitle}>
            {wantStatementForCircle
              ? STRINGS.journeyCompletedWantTitle(deriveWantPhrase(wantStatementForCircle))
              : STRINGS.journeyCompletedTitle(circle.name)}
          </Text>
          <Text style={styles.journeyCompletedBannerBody}>{STRINGS.journeyCompletedBody}</Text>
        </View>
      )}

      {/* PA2 — THE PERSISTENT RALLY-ON CARD IS GONE. It was the circle
          screen's half of the first-mover race: any member could tap it
          and set the whole circle's course, and everyone else read "your
          host can complete the circle whenever they're ready". There is
          no circle-wide decision left to offer, so there is no card.
          Continuing is the default; a member who wants to finish THEIR
          rally does it from their own ceremony, and the creator's
          circle-ending control lives in host controls below. */}

      <View style={styles.nameRow}>
        <Text style={styles.title}>{circle.name}</Text>
        {isCreator && !circle.completedAt && (
          <TouchableOpacity
            onPress={openEditCircle}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={STRINGS.manageCircleA11yLabel}
          >
            <Text style={styles.editPencil}>{STRINGS.manageCircleAffordance}</Text>
          </TouchableOpacity>
        )}
      </View>
      {/* AU1 jobs 2 + 4 — this line used to lead with the circle's age
          ("day 30 · 1 of 2 checked in") while the SignalMeter pill below
          carried the SAME age a second time. Cat's 3 Aug ruling gives the
          age exactly ONE labelled home on this screen, and the pill is
          the one nearer the huddle, so the day leaves here and the line
          becomes what it always mostly was: the headcount. That also
          retires the third private copy of the headcount decision —
          lib/headcount.ts is now the only place it is made. */}
      <Text style={styles.headerStatus}>
        {headcountLine(activeInTodayCount, activeMemberCount)}
      </Text>

      {isEditingLink ? (
        // OD1 job 4b — the one expander HIGH on this screen (just under
        // the header), so the pill has never covered it. Wired anyway:
        // the treatment is the class's, not this card's, and it costs
        // nothing when the card already fits — and with autoFocus the
        // keyboard can shrink the viewport under it.
        <View
          ref={captureReveal('link-edit')}
          onLayout={() => revealIntoView('link-edit')}
          style={styles.linkEditCard}
        >
          <TextInput
            style={styles.linkInput}
            value={linkDraft}
            onChangeText={setLinkDraft}
            placeholder="https://…"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!isSavingLink}
            autoFocus
          />
          {linkError && <Text style={styles.linkErrorText}>{linkError}</Text>}
          <View style={styles.linkEditRow}>
            {circle.resourceUrl && (
              <TouchableOpacity onPress={removeLink} disabled={isSavingLink}>
                <Text style={styles.linkRemoveText}>{STRINGS.removeCta}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setIsEditingLink(false)} disabled={isSavingLink}>
              <Text style={styles.nameEditActionMuted}>{STRINGS.cancelCta}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={saveLink} disabled={isSavingLink}>
              <Text style={styles.nameEditAction}>{isSavingLink ? '…' : STRINGS.saveCta}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : circle.resourceUrl ? (
        <View style={styles.linkSection}>
          {youtubeId ? (
            <YouTubeEmbed videoId={youtubeId} style={styles.linkEmbed} />
          ) : (
            <LinkCard url={circle.resourceUrl} style={styles.linkEmbed} />
          )}
          {isCreator && !circle.completedAt && (
            <TouchableOpacity onPress={startEditingLink} hitSlop={8}>
              <Text style={styles.linkEditLink}>{STRINGS.circleEditLinkLink}</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : isCreator && !circle.completedAt ? (
        <TouchableOpacity style={styles.linkEmptyPrompt} onPress={startEditingLink}>
          <Text style={styles.linkEmptyPromptText}>{STRINGS.circleAddLinkPrompt}</Text>
        </TouchableOpacity>
      ) : null}

      {/* PI1 — the whole circle sees the routine behind this quiet link,
          shown only when the host has written instructions (no stub
          otherwise). Opens a read-only page. */}
      {circle.instructions && (
        <TouchableOpacity
          style={styles.instructionsLink}
          onPress={() =>
            router.push({
              pathname: '/practice-instructions-view',
              params: { circleId: circle.id },
            })
          }
        >
          <Text style={styles.instructionsLinkText}>{STRINGS.practiceInstructionsLink}</Text>
        </TouchableOpacity>
      )}

      <View style={styles.signalCard}>
        <SignalMeter
          state={signal.state}
          dailyRates={signal.dailyRates}
          dayNumber={signal.dayNumber}
          rallyCount={countRallyDays(presence, session?.user?.id ?? '')}
          isSolo={isSolo}
          size="large"
        />
        {/* WB1 job 3 (Cat's fresh-account walk, 3 Aug) — THE WAY TO ACT.
            This card stated the viewer's own status three ways ("your
            practice is resting", "your rally: 0 of 21", and the headcount
            line above it) and offered nothing to do about any of it; the
            only check-in in the app was on Today. The CTA joins the card
            that makes the claim.

            AN INVITATION, NEVER A NAG (warmth law): it appears only when
            there is something to invite — not once the day is done, not
            on a warmly-archived circle, and not to a member who has
            FINISHED their rally here, who is never asked to check in
            (PA2, memo §8). Once checked in the card reverts to plain
            status: no "edit check-in" door, because that door belongs to
            Today's own CTA slot and a second one here would be a second
            place to reason about.

            WANTS-TIMER IS TRUE, deliberately. Today shows two buttons for
            a timed circle; this card shows one, so the one has to be the
            practice's own front door rather than the shortcut past it —
            and nothing is lost by that, because the timer screen carries
            its own "mark as done". For a circle with a resource link the
            argument changes nothing (Today always routes those to the
            activity screen), and for a plain circle it changes nothing
            either (there is no duration to trigger it). */}
        {!iAmCheckedInToday && !circle.completedAt && !myFinishedAt && (
          <TouchableOpacity
            style={styles.signalCardCta}
            onPress={() => launchCheckin(circle, true, signal.dayNumber)}
            disabled={oneTapCircleId === circle.id}
            accessibilityRole="button"
          >
            <Text style={styles.signalCardCtaText}>{STRINGS.checkInCta}</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.wallPreviewCard}>
        <Text style={styles.sectionLabel}>circle wall</Text>
        {wallPreview.length === 0 ? (
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/wall', params: { circleId: circle.id } })}
          >
            <Text style={styles.wallEmptyText}>the wall is quiet — say hi 👋</Text>
          </TouchableOpacity>
        ) : (
          <>
            {wallPreview.map((item) => (
              <Text key={item.id} style={styles.wallPreviewLine} numberOfLines={1}>
                {`${memberName(item.userId)}: ${truncate(item.body, 50)}`}
              </Text>
            ))}
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/wall', params: { circleId: circle.id } })}
            >
              <Text style={styles.wallPreviewFooter}>{STRINGS.circleOpenWallLink}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {members.length <= 1 ? (
        <View style={styles.emptyGroupCard}>
          <MascotEntrance source={MASCOT.cozyAndContent} style={styles.emptyGroupImage} />
          <Text style={styles.emptyGroupTitle}>{STRINGS.emptyGroupTitle}</Text>
          <Text style={styles.emptyGroupBody}>{STRINGS.emptyGroupBody}</Text>
          <TouchableOpacity
            style={styles.emptyGroupButton}
            onPress={() =>
              router.push({
                pathname: '/onboarding/invite',
                params: { circleId: circle.id, inviteCode: circle.inviteCode },
              })
            }
          >
            <Text style={styles.emptyGroupButtonText}>{STRINGS.emptyGroupCta}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <Text style={styles.sectionLabel}>who&apos;s here</Text>
          {members
            .filter(
              (m) =>
                m.userId !== session?.user?.id &&
                m.celebrateBirthday &&
                isBirthdayToday(m.birthMonth, m.birthDay, localDateStringInTimeZone(m.timezone))
            )
            .map((m) => (
              <Text key={`bday-${m.userId}`} style={styles.birthdayLine}>
                {STRINGS.birthdayMemberLine(m.name ?? 'someone in your circle')}
              </Text>
            ))}
          <View style={styles.avatarRow}>
            {shownMembers.map((member) => {
              const checkedIn = inTodayUserIds.has(member.userId);
              const isCovered = presence.some(
                (p) => p.localDate === today && p.userId === member.userId && p.kind === 'covered'
              );
              const state = isCovered ? 'covered' : checkedIn ? 'done' : 'pending';
              const isMe = member.userId === session?.user?.id;
              const isAway = !!member.awaySince;
              // W1/HW1: every circle-mate offers both gestures — a heart
              // and a wave — checked in or not, resting or away included;
              // only self stays ungreetable. Covering still only makes
              // sense for someone who hasn't shown up yet.
              const isReachable = !isMe;
              const memberDisplayName = member.name ?? 'your circle-mate';
              const sent = sentGestures[member.userId] ?? {};
              return (
                <View key={member.userId} style={styles.whoHereItem}>
                  <View
                    style={[
                      styles.avatarWrap,
                      // PA2 — a finished member wears the same softened
                      // treatment resting and away members already wear.
                      // They are OFF the active roster, not out of the
                      // huddle: memo §10 Q1 — "someone quietly
                      // disappearing from a huddle is the feeling Rally
                      // exists to prevent".
                      (member.isResting || isAway || !!member.finishedAt) && styles.avatarWrapResting,
                    ]}
                  >
                    {/* AV1 — tapping YOUR OWN placeholder penguin opens
                        the photo upload in settings; the Who's Here
                        avatar itself had no tap before (the gesture
                        pills and ⋯ live beside it), so nothing is
                        stolen. Never on someone else's, never a photo. */}
                    {isMe && !member.avatarUrl ? (
                      <TouchableOpacity
                        onPress={() => router.push('/settings')}
                        accessibilityLabel={STRINGS.ownPenguinTapA11yLabel}
                      >
                        <Avatar name={member.name} userId={member.userId} avatarUrl={member.avatarUrl} size={40} ring={state} />
                      </TouchableOpacity>
                    ) : (
                      <Avatar name={member.name} userId={member.userId} avatarUrl={member.avatarUrl} size={40} ring={state} />
                    )}
                    {isAway ? (
                      <View style={styles.awayBadge}>
                        <Text style={styles.awayBadgeText}>😴</Text>
                      </View>
                    ) : (
                      <CheckedInBadge state={state} />
                    )}
                  </View>
                  {/* CB1 job 2 — Who's Here has never rendered a member's
                      name: it lived only in the a11y label and the cover
                      params. That was survivable while a photo-less
                      member showed their initials, but AV1 (21 July)
                      replaced the initials disc with a deterministic
                      penguin on Cat's "no initial badge" ruling, and
                      photo-less members lost their last identifying
                      mark. The name is what Cat expected to be here; the
                      no-initials ruling stands untouched. One line only,
                      truncated — a long name must never wrap the grid. */}
                  {member.name ? (
                    <Text style={styles.whoHereName} numberOfLines={1}>
                      {member.name}
                    </Text>
                  ) : null}
                  {/* PA2 — the settled state: a finished member is
                      marked as having COMPLETED something, never as
                      having gone quiet. Deliberately a word, not a
                      count: a standing per-member number in the huddle
                      is a leaderboard, which memo §5 forbids outright. */}
                  {!!member.finishedAt && (
                    <Text style={styles.finishedBadgeText}>{STRINGS.journeyFinishedMemberBadge}</Text>
                  )}
                  {/* GS1 — ambient pride from 7 days: flame + count, or
                      NOTHING at all (absence must read as "doesn't
                      apply", never a gap — the server already floors and
                      excludes away members; !isAway is belt only). */}
                  {!isAway && glowByUserId.has(member.userId) && (
                    <Text
                      style={styles.glowFlameLine}
                      accessibilityLabel={STRINGS.glowFlameA11yLabel(memberDisplayName, glowByUserId.get(member.userId)!)}
                    >
                      🔥 {glowByUserId.get(member.userId)}
                    </Text>
                  )}
                  {isReachable && coverableByUserId.has(member.userId) && (
                    <TouchableOpacity
                      style={styles.coverPill}
                      onPress={() =>
                        router.push({
                          pathname: '/cover',
                          params: {
                            circleId: circle.id,
                            memberId: member.userId,
                            memberName: memberDisplayName,
                            memberAvatarUrl: member.avatarUrl ?? '',
                            myName,
                            // CV1 — the covered member's missed day (their
                            // local yesterday); the cover write lands here.
                            missedDate: coverableByUserId.get(member.userId)!,
                          },
                        })
                      }
                      hitSlop={8}
                    >
                      <Text style={styles.coverPillText}>{STRINGS.coverAffordance}</Text>
                    </TouchableOpacity>
                  )}
                  {isReachable && !nudgeDisabledIds.has(member.userId) && (
                    <View style={styles.gestureRow}>
                      <TouchableOpacity
                        style={[
                          styles.gesturePill,
                          styles.heartPill,
                          sent.heart && styles.gesturePillSent,
                        ]}
                        onPress={() => handleGesture(member, 'heart')}
                        disabled={!!sent.heart || sendingGestureKey === `${member.userId}:heart`}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={STRINGS.heartPillA11yLabel(memberDisplayName)}
                      >
                        <Text style={[styles.gesturePillText, styles.heartPillText]}>
                          {sendingGestureKey === `${member.userId}:heart`
                            ? '…'
                            : useCompactGesturePills
                              ? STRINGS.heartAffordanceCompact
                              : STRINGS.heartAffordance}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.gesturePill,
                          styles.wavePill,
                          sent.wave && styles.gesturePillSent,
                        ]}
                        onPress={() => handleGesture(member, 'wave')}
                        disabled={!!sent.wave || sendingGestureKey === `${member.userId}:wave`}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={STRINGS.wavePillA11yLabel(memberDisplayName)}
                      >
                        <Text style={[styles.gesturePillText, styles.wavePillText]}>
                          {sendingGestureKey === `${member.userId}:wave`
                            ? '…'
                            : useCompactGesturePills
                              ? STRINGS.waveAffordanceCompact
                              : STRINGS.waveAffordance}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {isReachable && (
                    <TouchableOpacity
                      onPress={() => setMemberActionsFor(memberActionsFor === member.userId ? null : member.userId)}
                      hitSlop={8}
                    >
                      <Text style={styles.memberMoreLink}>⋯</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
            {overflowCount > 0 && (
              <View style={styles.avatarOverflow}>
                <Text style={styles.avatarOverflowText}>+{overflowCount}</Text>
              </View>
            )}
          </View>

          {memberActionsFor &&
            (() => {
              const target = members.find((m) => m.userId === memberActionsFor);
              if (!target) return null;
              const isBlocked = blockedIds.has(target.userId);
              return (
                // OD1 job 4b — the same class: this panel opens under the
                // ⋯ in Who's Here and grows again when report or block
                // swaps its contents, so onLayout (not a one-shot) is
                // what keeps the grown card in view.
                <View
                  ref={captureReveal('member-actions')}
                  onLayout={() => revealIntoView('member-actions')}
                  style={styles.memberActionsPanel}
                >
                  {memberActionMode === null && (
                    <View style={styles.memberActionsRow}>
                      <Text style={styles.memberActionsName}>{target.name ?? 'this member'}</Text>
                      <TouchableOpacity onPress={() => setMemberActionMode('report')}>
                        <Text style={styles.memberActionLink}>{STRINGS.reportLink}</Text>
                      </TouchableOpacity>
                      {isBlocked ? (
                        <TouchableOpacity onPress={() => handleUnblockMember(target.userId)} disabled={isSubmittingMemberAction}>
                          <Text style={styles.memberActionLink}>{STRINGS.unblockCta}</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity onPress={() => setMemberActionMode('block')}>
                          <Text style={styles.memberActionLinkDestructive}>{STRINGS.blockLink}</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity onPress={closeMemberActions}>
                        <Text style={styles.memberActionCancelText}>{STRINGS.reportCancelCta}</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {memberActionMode === 'report' && (
                    <>
                      <MicTextInput
                        style={styles.memberReportInput}
                        placeholder={STRINGS.reportReasonPlaceholder}
                        placeholderTextColor={colors.muted}
                        value={memberReportReason}
                        onChangeText={setMemberReportReason}
                        multiline
                      />
                      <View style={styles.memberActionsRow}>
                        <TouchableOpacity onPress={closeMemberActions} disabled={isSubmittingMemberAction}>
                          <Text style={styles.memberActionCancelText}>{STRINGS.reportCancelCta}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleReportMember(target.userId)} disabled={isSubmittingMemberAction}>
                          <Text style={styles.memberActionLink}>
                            {isSubmittingMemberAction ? '…' : STRINGS.reportSubmitCta}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}

                  {memberActionMode === 'block' && (
                    <>
                      <Text style={styles.memberActionConfirmText}>
                        {STRINGS.blockConfirmTitle(target.name ?? 'this member')}
                      </Text>
                      <Text style={styles.memberActionConfirmBody}>{STRINGS.blockConfirmBody}</Text>
                      <View style={styles.memberActionsRow}>
                        <TouchableOpacity onPress={closeMemberActions} disabled={isSubmittingMemberAction}>
                          <Text style={styles.memberActionCancelText}>{STRINGS.blockCancelCta}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleBlockMember(target.userId)} disabled={isSubmittingMemberAction}>
                          <Text style={styles.memberActionLinkDestructive}>
                            {isSubmittingMemberAction ? '…' : STRINGS.blockConfirmCta}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </View>
              );
            })()}

          {/* PA4 (memo §5.1) — the friendship's headline is the CUMULATIVE
              number, with the live run beside it as a small flourish that
              may break without taking the friendship's worth with it. The
              whole render decision lives in components/PairStreakLine.tsx
              and returns ONE pair by construction: a sort + slice written
              here would be one edit away from the leaderboard Glow-Spec
              §5 forbids, and would not look like a product decision. */}
          <PairStreakLine pairs={pairStreaks} />

          {hasCoverableMember && !hasSeenCoverHint && (
            <TouchableOpacity onPress={dismissCoverHint} style={styles.coverHintCard}>
              <Text style={styles.coverHintText}>{STRINGS.coverHintDiscovery}</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {/* OD1 job 22a (Cat, 23 July): on a solo circle the empty-huddle
          card's gold CTA is the ONE invite ask — this standalone button
          only renders once the circle is populated. */}
      {members.length > 1 && !circle.completedAt && (
        <TouchableOpacity
          style={styles.inviteButton}
          onPress={() =>
            router.push({
              pathname: '/onboarding/invite',
              params: { circleId: circle.id, inviteCode: circle.inviteCode },
            })
          }
        >
          <Text style={styles.inviteButtonText}>{STRINGS.circleInviteSomeoneCta}</Text>
        </TouchableOpacity>
      )}

      {isCreator && !circle.completedAt && (
        <View style={styles.hostControlsCard}>
          <Text style={styles.sectionLabel}>host controls</Text>

          {/* EC1 — every host can edit what they created; the toggle and
              member management below stay public-circle-only. */}
          <TouchableOpacity style={styles.hostEditRow} onPress={openEditCircle}>
            <Text style={styles.hostToggleLabel}>{STRINGS.hostEditCircleLabel}</Text>
            <Text style={styles.hostToggleHelper}>{STRINGS.hostEditCircleHelper}</Text>
          </TouchableOpacity>

          {circle.isPublic && (
            <>
              <TouchableOpacity
                style={styles.hostToggleRow}
                onPress={handleToggleClosedToJoins}
                disabled={isTogglingClosed}
              >
                <View style={styles.hostToggleTextWrap}>
                  <Text style={styles.hostToggleLabel}>{STRINGS.hostCloseToJoinsLabel}</Text>
                  <Text style={styles.hostToggleHelper}>
                    {circle.closedToJoins
                      ? STRINGS.hostCloseToJoinsHelperClosed
                      : STRINGS.hostCloseToJoinsHelperOpen}
                  </Text>
                </View>
                {isTogglingClosed ? (
                  <ActivityIndicator size="small" color={colors.green} />
                ) : (
                  <View style={[styles.toggleTrack, circle.closedToJoins && styles.toggleTrackOn]}>
                    <View style={[styles.toggleThumb, circle.closedToJoins && styles.toggleThumbOn]} />
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={() => setIsManagingMembers(!isManagingMembers)}>
                <Text style={styles.hostManageMembersLink}>
                  {isManagingMembers ? STRINGS.circleHideMembersLink : STRINGS.circleManageMembersLink}
                </Text>
              </TouchableOpacity>

              {isManagingMembers &&
                members
                  .filter((m) => m.userId !== session?.user?.id)
                  .map((member) => (
                    <View key={member.userId} style={styles.hostMemberRow}>
                      <Avatar name={member.name} userId={member.userId} avatarUrl={member.avatarUrl} size={26} />
                      <Text style={styles.hostMemberName}>{member.name ?? STRINGS.circleMemberFallbackName}</Text>
                      {removingMemberId !== member.userId && (
                        <TouchableOpacity onPress={() => setRemovingMemberId(member.userId)} hitSlop={6}>
                          <Text style={styles.hostMemberRemoveLink}>{STRINGS.removeCta}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
              {isManagingMembers &&
                removingMemberId &&
                members.some((m) => m.userId === removingMemberId) && (
                  // OD1 job 4b/4c — remove-a-member: destructive, and it
                  // opens at the bottom of the host-controls member list.
                  <View
                    ref={captureReveal('remove-member-confirm')}
                    onLayout={() => revealIntoView('remove-member-confirm')}
                    style={styles.hostMemberConfirmCard}
                  >
                    <Text style={styles.hostMemberConfirmTitle}>
                      {STRINGS.hostRemoveMemberConfirm(
                        members.find((m) => m.userId === removingMemberId)?.name ?? 'this member'
                      )}
                    </Text>
                    <Text style={styles.hostMemberConfirmBody}>{STRINGS.hostRemoveMemberBody}</Text>
                    <View style={styles.hostMemberConfirmRow}>
                      <TouchableOpacity
                        onPress={() => setRemovingMemberId(null)}
                        disabled={isRemovingMember}
                      >
                        <Text style={styles.hostMemberCancelText}>{STRINGS.cancelCta}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleRemoveMember(removingMemberId)}
                        disabled={isRemovingMember}
                      >
                        <Text style={styles.hostDeleteConfirmText}>
                          {isRemovingMember ? '…' : STRINGS.hostRemoveMemberCta}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
            </>
          )}

          {/* The host's wind-down control — ends the whole circle for
              everyone, and stays creator-only (memo §7 removes the
              circle-level RALLY decision, not the creator's ability to
              close a circle).
              PA2 — THE `ralliedOnAt` GATE IS REMOVED, and it had to be:
              with nothing writing that column any more, gating on it
              would have left every circle created from here on with NO
              way for its creator to ever end it. That would have been a
              silent, permanent loss of a shipped control — the kind of
              thing deleting a decision quietly takes with it. The
              confirm card carries the explanation, as before. */}
          {!circle.completedAt &&
            (isConfirmingComplete ? (
              // OD1 job 4b/4c — a destructive-ish confirm inside the
              // host-controls card, low on the screen.
              <View
                ref={captureReveal('complete-confirm')}
                onLayout={() => revealIntoView('complete-confirm')}
                style={styles.journeyCompleteHostConfirmCard}
              >
                <Text style={styles.journeyCompleteHostConfirmTitle}>
                  {STRINGS.journeyCompleteConfirmTitle(circle.name)}
                </Text>
                <Text style={styles.journeyCompleteHostConfirmBody}>
                  {STRINGS.journeyCompleteConfirmBody}
                </Text>
                <View style={styles.journeyGateConfirmRow}>
                  <TouchableOpacity
                    onPress={() => setIsConfirmingComplete(false)}
                    disabled={isCompleting}
                  >
                    <Text style={styles.leaveCancelText}>{STRINGS.cancelCta}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleCompleteCircle} disabled={isCompleting}>
                    <Text style={styles.journeyGateCompleteConfirmText}>
                      {isCompleting ? '…' : STRINGS.journeyGateCompleteCta}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={styles.hostEditRow} onPress={() => setIsConfirmingComplete(true)}>
                <Text style={styles.hostToggleLabel}>{STRINGS.journeyCompleteHostControlLabel}</Text>
                <Text style={styles.hostToggleHelper}>{STRINGS.journeyCompleteHostControlHelper}</Text>
              </TouchableOpacity>
            ))}
        </View>
      )}

      {iCoveredSomeoneToday ? (
        <View style={styles.coveredInfoCard}>
          <Text style={styles.coveredInfoTitle}>
            {STRINGS.circleYouCoveredCard(memberName(iCoveredSomeoneToday.userId))}
          </Text>
          <Text style={styles.coveredInfoBody}>{STRINGS.circleYouCoveredCardBody}</Text>
        </View>
      ) : iWasCoveredToday ? (
        <View style={styles.coveredInfoCard}>
          <Text style={styles.coveredInfoTitle}>
            {STRINGS.circleCoveredYouCard(memberName(iWasCoveredToday.coveredBy ?? ''))}
          </Text>
          <Text style={styles.coveredInfoBody}>{STRINGS.circleCoveredYouCardBody}</Text>
        </View>
      ) : null}

      {isConfirmingLeave ? (
        // OD1 job 4a/4c — the card Cat reported. It is the last thing on
        // a long screen, so it is the one most often revealed straight
        // under the pill; both its Cancel and its destructive action have
        // to be fully visible the moment it appears.
        <View
          ref={captureReveal('leave-confirm')}
          onLayout={() => revealIntoView('leave-confirm')}
          style={styles.leaveConfirmCard}
        >
          <Text style={styles.leaveConfirmText}>{STRINGS.circleLeaveConfirmBody(circle.name)}</Text>
          <View style={styles.leaveConfirmRow}>
            <TouchableOpacity
              style={styles.leaveCancelButton}
              onPress={() => setIsConfirmingLeave(false)}
              disabled={isLeaving}
            >
              <Text style={styles.leaveCancelText}>{STRINGS.cancelCta}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.leaveConfirmButton}
              onPress={handleLeave}
              disabled={isLeaving}
            >
              {isLeaving ? (
                <ActivityIndicator size="small" color={colors.ink} />
              ) : (
                <Text style={styles.leaveConfirmButtonText}>{STRINGS.circleLeaveConfirmCta}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.leaveLink} onPress={() => setIsConfirmingLeave(true)}>
          <Text style={styles.leaveLinkText}>{STRINGS.circleLeaveLink}</Text>
        </TouchableOpacity>
      )}

      <MessageDialog
        visible={showMemberReportedNotice}
        title={STRINGS.reportedConfirmationTitle}
        message={STRINGS.reportedConfirmationBody}
        onDismiss={() => setShowMemberReportedNotice(false)}
      />
      <MessageDialog
        visible={!!gestureNotice}
        title="hmm"
        message={gestureNotice ?? ''}
        onDismiss={() => setGestureNotice(null)}
      />
      <MessageDialog visible={!!error} title="hmm" message={error ?? ''} onDismiss={() => setError(null)} />
      {/* WB1 job 3 — the one-tap check-in has no screen of its own to fail
          on, so its failure is said out loud here, exactly as Today says
          it. Same dialog treatment as this screen's other three. */}
      <MessageDialog
        visible={!!checkinError}
        title="hmm"
        message={checkinError ?? ''}
        onDismiss={() => setCheckinError(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: 24,
  },
  listCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    ...cardShadow,
  },
  listCardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  listCardName: {
    fontFamily: FONT_HEADER,
    fontSize: 15,
    color: colors.ink,
    // OD2 job 1 — yoga defaults flexShrink to 0, so without this the name
    // is laid out at its full single-line width and pushes the badge past
    // the card's right edge instead of yielding to it. minWidth 0 is the
    // web half of the same rule: react-native-web renders these as flex
    // items whose min-width is auto by default, which floors a shrinking
    // item at its content width and would leave the overflow on web only.
    flexShrink: 1,
    minWidth: 0,
  },
  completedBadgeSmall: {
    ...chipTextShape,
    // Never the thing that gives way: a clipped state badge is a wrong
    // answer, a truncated name is still a name.
    flexShrink: 0,
    backgroundColor: colors.greenSoft,
    color: colors.greenText,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    fontSize: 9.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    overflow: 'hidden',
  },
  // HY1 job 8 — the same pill geometry the completed badge already uses,
  // so the row gains no new shape. Pending is the QUIET one (a bare
  // outline on the card): "not yet" is information, not a scold, and the
  // warmth law means the state you are in most mornings must not be the
  // loudest thing on the screen. Done fills greenSoft — the same
  // greenSoft/greenText pair as the completed badge. Covered takes
  // goldSoft rather than green, because a cover is a gift and not a
  // tick. MEASURED on the card, 5 Aug, all three past 4.5:1 at this
  // 9.5px bold: pending 5.66, done 4.63, covered 4.72 (goldSoft is an
  // alpha token and resolves to #fdf7e4 over the card).
  youBadgeSmall: {
    ...chipTextShape,
    // OD2 job 1 — same rule as completedBadgeSmall above.
    flexShrink: 0,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.mutedStrong,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    fontSize: 9.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    overflow: 'hidden',
  },
  youBadgeSmallDone: {
    backgroundColor: colors.greenSoft,
    borderColor: colors.greenSoft,
    color: colors.greenText,
  },
  youBadgeSmallCovered: {
    backgroundColor: colors.goldSoft,
    borderColor: colors.goldSoft,
    color: colors.greenDeep,
  },
  content: {
    padding: 20,
    // TB3: the pill clearance is inset-aware, applied inline at each
    // ScrollView via useTabBarClearance().
  },
  brandmark: {
    marginBottom: 14,
  },
  back: {
    marginBottom: 16,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 24,
    color: colors.ink,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  // EC1 — the ✎ manage entry beside the title, host-only; opens the
  // edit-circle screen (this was the inline-rename pencil before).
  editPencil: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.mutedStrong,
  },
  nameEditAction: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.greenText,
  },
  nameEditActionMuted: {
    fontWeight: '600',
    fontSize: 13,
    color: colors.mutedStrong,
  },
  subtitle: {
    fontSize: 13,
    color: colors.mutedStrong,
    marginTop: 4,
    marginBottom: 18,
  },
  headerStatus: {
    fontSize: 13,
    color: colors.mutedStrong,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 18,
  },
  signalCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 18,
    marginBottom: 24,
    ...cardShadow,
  },
  // WB1 job 3 — Today's own CTA shape and colour (gold = action, the
  // colour-roles convention), so the two check-in buttons in the app read
  // as one control in two places rather than as two different offers. It
  // sits inside the card, under the caption, with the card's own padding
  // holding it in.
  signalCardCta: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  signalCardCtaText: {
    fontWeight: '700',
    fontSize: 14,
    // Ink on a gold FILL is 9.52:1 (OD1 job 10) — the one place gold and
    // text belong together.
    color: colors.ink,
  },
  linkSection: {
    marginBottom: 24,
    alignItems: 'center',
    gap: 8,
  },
  linkEmbed: {
    width: '100%',
  },
  linkEditLink: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.mutedStrong,
  },
  linkEmptyPrompt: {
    alignItems: 'center',
    marginBottom: 24,
  },
  linkEmptyPromptText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.greenText,
  },
  // PI1 — a quiet ink link (not a CTA), sitting just under the link area.
  instructionsLink: {
    alignSelf: 'center',
    marginBottom: 24,
  },
  instructionsLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
  },
  linkEditCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 24,
    ...cardShadow,
  },
  linkInput: {
    fontSize: 14,
    color: colors.ink,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.green,
    paddingVertical: 4,
    marginBottom: 8,
  },
  linkErrorText: {
    fontSize: 11.5,
    color: colors.errorRed,
    marginBottom: 8,
  },
  linkEditRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 16,
  },
  linkRemoveText: {
    fontWeight: '600',
    fontSize: 13,
    color: colors.errorRed,
    marginRight: 'auto',
  },
  inviteHint: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.greenText,
    textAlign: 'center',
    marginBottom: 10,
  },
  inviteButton: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.green,
    borderRadius: 16,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 10,
  },
  inviteButtonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.greenText,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.greenText,
    marginBottom: 10,
  },
  birthdayLine: {
    fontSize: 13,
    color: colors.ink,
    marginBottom: 10,
  },
  wallPreviewCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    ...cardShadow,
  },
  wallEmptyText: {
    fontSize: 13,
    color: colors.mutedStrong,
  },
  wallPreviewLine: {
    fontSize: 12.5,
    color: colors.ink,
    marginBottom: 6,
  },
  wallPreviewFooter: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.greenText,
    marginTop: 4,
  },
  avatarRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  listCardAvatarRow: {
    marginTop: 10,
    marginBottom: 0,
  },
  avatarRowItem: {
    width: 40,
    height: 40,
    position: 'relative',
  },
  // Who's Here (single-circle view) needs real height below the avatar for
  // the cover pill, unlike the plain avatarRowItem above (multi-circle
  // list, no pill) — this wraps a fixed-size avatarWrap (so the badge's
  // absolute positioning still anchors to the avatar, not the taller item)
  // plus the pill below it in normal flow, so nothing overlaps at any
  // avatar count.
  whoHereItem: {
    alignItems: 'center',
  },
  avatarWrap: {
    width: 40,
    height: 40,
    position: 'relative',
  },
  // RS1 — soft fade to the edge of the huddle, opacity only (never a
  // grey filter, never a label — the resting member themselves must
  // never know, and nobody else sees why, just a quieter presence).
  // RS2 reuses this same fade for an away member too, on top of the
  // sleeping badge below.
  avatarWrapResting: {
    opacity: 0.5,
  },
  // RS2 — the sleeping-penguin treatment: a small calm badge instead of
  // the usual done/covered checkmark, no duration ever shown.
  // PA2 — greenText (never colors.green, which is 2.58:1 as text): this
  // is a completed thing, so it takes the progress colour, not the muted
  // one that resting and away wear.
  finishedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.greenText,
    marginTop: 2,
    textAlign: 'center',
  },
  awayBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.bg,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  awayBadgeText: {
    fontSize: 10,
    lineHeight: 12,
  },
  // CB1 job 2 — the name under a Who's Here avatar. maxWidth (not a fixed
  // width) so short names keep the huddle tight and a long one truncates
  // instead of widening its column; numberOfLines={1} at the call site is
  // the other half of that. Quiet weight — this identifies a person, it
  // isn't a heading, and it must not out-shout the avatar it labels.
  whoHereName: {
    fontSize: 11,
    color: colors.mutedStrong,
    marginTop: 4,
    maxWidth: 64,
    textAlign: 'center',
  },
  // GS1 — the ambient flame line under a glowing member's avatar.
  // Quiet by design: small, muted, no ranking treatment, and simply
  // absent below 7 days.
  glowFlameLine: {
    fontSize: 9,
    color: colors.mutedStrong,
    marginTop: 2,
  },
  coverPill: {
    marginTop: 6,
    minHeight: 28,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 99,
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  coverPillText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.ink,
  },
  // HW1 — the two gesture pills, heart then wave, under every reachable
  // circle-mate. The heart wears AC1's colors.heart (warmth between
  // friends); the wave keeps the gold the wave affordance always had.
  gestureRow: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
  },
  gesturePill: {
    minHeight: 28,
    minWidth: 28,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 7,
    borderRadius: 99,
    borderWidth: 1,
  },
  heartPill: {
    backgroundColor: colors.heartSoft,
    borderColor: colors.heart,
  },
  wavePill: {
    backgroundColor: colors.goldSoft,
    borderColor: colors.gold,
  },
  // Sent this visit — the pill quiets down rather than disappearing
  // (nothing here may read as a failure or an empty slot).
  gesturePillSent: {
    opacity: 0.45,
  },
  gesturePillText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  heartPillText: {
    color: colors.heart,
  },
  wavePillText: {
    color: colors.ink,
  },
  memberMoreLink: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.mutedStrong,
    marginTop: 2,
  },
  memberActionsPanel: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    marginTop: 4,
    ...cardShadow,
  },
  memberActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  memberActionsName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  memberActionLink: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
  },
  memberActionLinkDestructive: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.errorRed,
  },
  memberActionCancelText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.mutedStrong,
  },
  memberActionConfirmText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  memberActionConfirmBody: {
    fontSize: 12,
    color: colors.mutedStrong,
    lineHeight: 17,
  },
  memberReportInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 10,
    fontSize: 12.5,
    color: colors.ink,
    minHeight: 44,
  },
  coverHintCard: {
    backgroundColor: colors.goldSoft,
    borderRadius: 12,
    padding: 10,
    marginTop: 2,
    marginBottom: 16,
  },
  coverHintText: {
    fontSize: 11.5,
    color: colors.ink,
    lineHeight: 16,
  },
  hostControlsCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    ...cardShadow,
  },
  hostToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    marginBottom: 6,
  },
  // EC1 — plain label+helper rows in host controls (edit circle, and the
  // rallied wind-down control that shares this card now).
  hostEditRow: {
    paddingVertical: 8,
    marginBottom: 6,
  },
  hostToggleTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  hostToggleLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  hostToggleHelper: {
    fontSize: 11,
    color: colors.mutedStrong,
    marginTop: 2,
  },
  toggleTrack: {
    width: 42,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.line,
    padding: 2,
    justifyContent: 'center',
  },
  toggleTrackOn: {
    backgroundColor: colors.green,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.card,
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
  },
  hostManageMembersLink: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.greenText,
    marginTop: 4,
  },
  hostMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 8,
  },
  hostMemberName: {
    flex: 1,
    fontSize: 12.5,
    color: colors.ink,
  },
  hostMemberRemoveLink: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.mutedStrong,
  },
  hostMemberConfirmCard: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  hostMemberConfirmTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 4,
  },
  hostMemberConfirmBody: {
    fontSize: 11.5,
    color: colors.mutedStrong,
    lineHeight: 16,
    marginBottom: 10,
  },
  hostMemberConfirmRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
  },
  hostMemberCancelText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.mutedStrong,
  },
  hostDeleteConfirmText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.errorRed,
  },
  coveredInfoCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 13,
    marginBottom: 24,
    ...cardShadow,
  },
  coveredInfoTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 4,
  },
  coveredInfoBody: {
    fontSize: 11,
    color: colors.mutedStrong,
    lineHeight: 15,
  },
  avatarOverflow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOverflowSmall: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  avatarOverflowText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.mutedStrong,
  },
  emptyGroupCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 24,
    marginBottom: 24,
    ...cardShadow,
  },
  emptyGroupImage: {
    width: 110,
    height: 129,
    marginBottom: 14,
  },
  emptyGroupTitle: {
    fontFamily: FONT_HEADER,
    fontSize: 17,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 6,
  },
  emptyGroupBody: {
    fontSize: 13,
    color: colors.mutedStrong,
    textAlign: 'center',
    marginBottom: 18,
  },
  emptyGroupButton: {
    width: '100%',
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  emptyGroupButtonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
  leaveLink: {
    marginTop: 32,
    alignItems: 'center',
  },
  leaveLinkText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.mutedStrong,
  },
  leaveConfirmCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginTop: 32,
    ...cardShadow,
  },
  leaveConfirmText: {
    fontSize: 12.5,
    color: colors.ink,
    lineHeight: 18,
    marginBottom: 14,
  },
  leaveConfirmRow: {
    flexDirection: 'row',
    gap: 8,
  },
  leaveCancelButton: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
  },
  leaveCancelText: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.ink,
  },
  leaveConfirmButton: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: colors.gold,
    alignItems: 'center',
  },
  leaveConfirmButtonText: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.ink,
  },
  journeyGateCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    ...cardShadow,
  },
  journeyGateCardTitle: {
    fontFamily: FONT_HEADER,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 4,
  },
  journeyGateCardBody: {
    fontSize: 12.5,
    color: colors.mutedStrong,
    lineHeight: 18,
    marginBottom: 12,
  },
  journeyGateCardButton: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    marginBottom: 8,
  },
  journeyGateCardButtonText: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.ink,
  },
  journeyGateCardLink: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.mutedStrong,
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
  journeyGateCardWaiting: {
    fontSize: 11.5,
    color: colors.mutedStrong,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  journeyGateConfirmRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginTop: 4,
  },
  journeyGateCompleteConfirmText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  journeyCompletedBanner: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
    alignItems: 'center',
    ...cardShadow,
  },
  journeyCompletedBadge: {
    ...chipTextShape,
    backgroundColor: colors.greenSoft,
    color: colors.greenText,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    fontSize: 10.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 10,
    overflow: 'hidden',
  },
  journeyCompletedBannerTitle: {
    fontFamily: FONT_HEADER,
    fontSize: 18,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 6,
  },
  journeyCompletedBannerBody: {
    fontSize: 12.5,
    color: colors.mutedStrong,
    textAlign: 'center',
    lineHeight: 18,
  },
  journeyCompleteHostConfirmCard: {
    marginTop: 4,
  },
  journeyCompleteHostConfirmTitle: {
    fontFamily: FONT_HEADER,
    fontSize: 14,
    color: colors.ink,
    marginBottom: 4,
  },
  journeyCompleteHostConfirmBody: {
    fontSize: 12,
    color: colors.mutedStrong,
    lineHeight: 17,
    marginBottom: 10,
  },
});

// NR1 Job 1c — this tab renders behind its own error boundary so a
// crash here can't take the floating tab bar (and the other tabs) down.
export default withErrorBoundary(YourCircle, 'tab:circle');

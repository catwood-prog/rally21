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
import { SignalMeter } from '@/components/SignalMeter';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, chipTextShape, colors } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useAuth } from '@/lib/auth-context';
import { deriveWantPhrase, getWantActivationForCircle } from '@/lib/blueprint';
import {
  attachRestingStatus,
  CircleMember,
  getCircleMembers,
  getCirclePresence,
  isSoloCircle,
  leaveCircle,
  listMyCircles,
  MyCircle,
  removeMemberFromCircle,
  resolveCircleSelection,
  setCircleClosedToJoins,
  setCircleResourceUrl,
  subscribeToCirclePresence,
} from '@/lib/circle';
import { isBirthdayToday } from '@/lib/birthday';
import { daysBetween, getLocalDateString, localDateStringInTimeZone } from '@/lib/date';
import { getGlowForCircleMates, getPairStreaks, PairStreak } from '@/lib/glow';
import {
  completeCircle,
  GATE_DAY,
  getMyLastCelebratedDay,
  getNextMilestone,
  rallyOnCircle,
  shouldShowJourneyGate,
} from '@/lib/journey';
import { blockUser, getMyBlocks, reportContent, unblockUser } from '@/lib/moderation';
import { getMyProfile, markCoverHintSeen } from '@/lib/profile';
import { extractYouTubeId, isHttpUrl } from '@/lib/resourceLink';
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

type ListCircleData = { members: CircleMember[]; presence: PresenceRow[] };

function YourCircle() {
  const router = useRouter();
  const { session } = useAuth();
  // TB3 — inset-aware pill clearance; applied to both states' scrolls.
  const tabBarClearance = useTabBarClearance();
  const { circleId } = useLocalSearchParams<{ circleId?: string }>();
  // Typed as a bottom-tab navigation so the OD1 Job 6 'tabPress' listener
  // below type-checks (expo-router's default useNavigation type has no tab
  // events — this screen IS a tab, so the cast is accurate, not a fudge).
  const navigation = useNavigation<BottomTabNavigationProp<ParamListBase>>();
  const [circle, setCircle] = useState<MyCircle | null>(null);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [presence, setPresence] = useState<PresenceRow[]>([]);
  // GS1 — the Who's Here glow ride-along (7+ days only; server-floored).
  const [glowByUserId, setGlowByUserId] = useState<Map<string, number>>(new Map());
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
  const [hasOtherCircles, setHasOtherCircles] = useState(false);
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
  const [myLastCelebratedDay, setMyLastCelebratedDay] = useState(0);
  const [pairStreaks, setPairStreaks] = useState<PairStreak[]>([]);
  const [isRallying, setIsRallying] = useState(false);
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
        const [circleMembers, circlePresence, preview, profile, lastCelebratedDay, myPairStreaks, myBlocks, mateGlows, myCirclesList] =
          await Promise.all([
            getCircleMembers(myCircle.id),
            getCirclePresence(myCircle.id),
            getWallPreview(myCircle.id),
            getMyProfile(session.user.id),
            getMyLastCelebratedDay(myCircle.id, session.user.id),
            getPairStreaks(myCircle.id).catch(() => []),
            getMyBlocks().catch(() => []),
            // GS1: one batch call for the whole huddle, riding the same
            // load — never a per-member fetch. Ambient pride only, so a
            // failed fetch just means no flames this visit.
            getGlowForCircleMates(myCircle.id).catch(() => new Map<string, number>()),
            // OD1 Job 6: the real "is there more than one circle?" answer,
            // riding the same load — drives the way-back-to-the-others
            // affordance instead of the fromTab flag.
            listMyCircles(session.user.id).catch(() => [] as MyCircle[]),
          ]);
        setHasOtherCircles(myCirclesList.length > 1);
        setMembers(circleMembers);
        setPresence(circlePresence);
        setGlowByUserId(mateGlows);
        setWallPreview(preview);
        setHasSeenCoverHint(!!profile?.has_seen_cover_hint);
        setMyLastCelebratedDay(lastCelebratedDay);
        setPairStreaks(myPairStreaks);
        setBlockedIds(new Set(myBlocks.map((b) => b.blockedId)));
        // HW1: one small parallel round for the gesture pills' opt-out
        // check (the RPC is per-user; who's-here shows at most 8).
        // Errors default to reachable, same as cover.tsx.
        const nudgeStates = await Promise.all(
          circleMembers
            .filter((m) => m.userId !== session.user.id)
            .map(
              async (m) =>
                [m.userId, await isFriendNudgeEnabled(m.userId).catch(() => true)] as const
            )
        );
        setNudgeDisabledIds(
          new Set(nudgeStates.filter(([, enabled]) => !enabled).map(([id]) => id))
        );
        if (myCircle.completedAt) {
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
    if (!circle) return;
    const dayNumber = Math.max(1, daysBetween(circle.startDate, getLocalDateString()) + 1);
    if (shouldShowJourneyGate(dayNumber, circle, myLastCelebratedDay)) {
      router.push({ pathname: '/journey-gate', params: { circleId: circle.id } });
      return;
    }
    if (circle.ralliedOnAt && !circle.completedAt) {
      const milestone = getNextMilestone(dayNumber, myLastCelebratedDay);
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
  }, [circle, myLastCelebratedDay, router]);

  // Completing a first cover teaches the same thing the hint says —
  // dismiss it for good the moment that happens, same as the voice hint
  // dismissing itself on first dictation.
  useEffect(() => {
    if (!session?.user || hasSeenCoverHint) return;
    const today = getLocalDateString();
    const coveredSomeone = presence.some(
      (p) => p.localDate === today && p.kind === 'covered' && p.coveredBy === session.user.id
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

          return (
            <TouchableOpacity
              key={c.id}
              style={styles.listCard}
              onPress={() => router.setParams({ circleId: c.id })}
            >
              <View style={styles.listCardNameRow}>
                <Text style={styles.listCardName}>{c.name}</Text>
                {c.completedAt && (
                  <Text style={styles.completedBadgeSmall}>{STRINGS.journeyCompletedBadge}</Text>
                )}
              </View>
              <SignalMeter
                state={signal.state}
                dailyRates={signal.dailyRates}
                dayNumber={signal.dayNumber}
                durationDays={c.durationDays}
                isSolo={isSolo}
                isRallied={!!c.ralliedOnAt && !c.completedAt}
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

  // At most one of these shows at a time — a quiet, celebratory note,
  // never a score (see CLAUDE.md's cover-a-friend rule).
  const iWasCoveredToday = presence.find(
    (p) => p.localDate === today && p.userId === session?.user?.id && p.kind === 'covered'
  );
  const iCoveredSomeoneToday = presence.find(
    (p) => p.localDate === today && p.kind === 'covered' && p.coveredBy === session?.user?.id
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
  const activeMemberCount = orderedMembers.filter((m) => !m.isResting && !m.awaySince).length;
  const shownMembers = orderedMembers.slice(0, MAX_AVATARS_SHOWN);
  // HW1: in a fuller huddle the gesture pills shrink to their glyphs so
  // the row never crowds at 390px — a gesture is never dropped, the
  // words just move to the accessibility labels.
  const useCompactGesturePills = shownMembers.length > 3;
  const overflowCount = orderedMembers.length - shownMembers.length;
  const hasCoverableMember = shownMembers.some(
    (member) => member.userId !== session?.user?.id && !inTodayUserIds.has(member.userId)
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

  const handleRallyOn = async () => {
    setIsRallying(true);
    try {
      await rallyOnCircle(circle.id);
      setCircle({ ...circle, ralliedOnAt: new Date().toISOString() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not rally on — try again');
    } finally {
      setIsRallying(false);
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
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      keyboardShouldPersistTaps="handled"
    >
      <AppHeader style={styles.brandmark} />
      {/* OD1 Job 6b — the way back is the LOGICAL parent, decided by the
          real membership count, not the fromTab flag (the flag that failed
          here): a multi-circle user always gets back to "your circles"
          however they arrived; a single-circle user goes to Today. */}
      <TouchableOpacity
        onPress={() => (hasOtherCircles ? router.replace('/circle') : router.push('/today'))}
      >
        <Text style={styles.back}>{hasOtherCircles ? '← your circles' : '← today'}</Text>
      </TouchableOpacity>

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

      {!circle.completedAt &&
        !circle.ralliedOnAt &&
        myLastCelebratedDay >= GATE_DAY && (
          <View style={styles.journeyGateCard}>
            <Text style={styles.journeyGateCardTitle}>{STRINGS.journeyGateCardTitle(circle.name)}</Text>
            <Text style={styles.journeyGateCardBody}>{STRINGS.journeyGateCardBody}</Text>
            <TouchableOpacity
              style={styles.journeyGateCardButton}
              onPress={handleRallyOn}
              disabled={isRallying}
            >
              <Text style={styles.journeyGateCardButtonText}>
                {isRallying ? '…' : STRINGS.journeyGateRallyOnCta}
              </Text>
            </TouchableOpacity>
            {isCreator ? (
              isConfirmingComplete ? (
                <View style={styles.journeyGateConfirmRow}>
                  <TouchableOpacity onPress={() => setIsConfirmingComplete(false)} disabled={isCompleting}>
                    <Text style={styles.leaveCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleCompleteCircle} disabled={isCompleting}>
                    <Text style={styles.journeyGateCompleteConfirmText}>
                      {isCompleting ? '…' : STRINGS.journeyGateCompleteCta}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity onPress={() => setIsConfirmingComplete(true)}>
                  <Text style={styles.journeyGateCardLink}>{STRINGS.journeyGateCompleteCta}</Text>
                </TouchableOpacity>
              )
            ) : (
              <Text style={styles.journeyGateCardWaiting}>{STRINGS.journeyGateWaitingOnHost}</Text>
            )}
          </View>
        )}

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
      <Text style={styles.headerStatus}>
        {inTodayUserIds.size === activeMemberCount && activeMemberCount > 1
          ? STRINGS.groupAllInCelebration(activeMemberCount, circle.name)
          : STRINGS.groupHeaderStatus(signal.dayNumber, inTodayUserIds.size, activeMemberCount)}
      </Text>

      {isEditingLink ? (
        <View style={styles.linkEditCard}>
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
                <Text style={styles.linkRemoveText}>Remove</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setIsEditingLink(false)} disabled={isSavingLink}>
              <Text style={styles.nameEditActionMuted}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={saveLink} disabled={isSavingLink}>
              <Text style={styles.nameEditAction}>{isSavingLink ? '…' : 'Save'}</Text>
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
              <Text style={styles.linkEditLink}>edit link</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : isCreator && !circle.completedAt ? (
        <TouchableOpacity style={styles.linkEmptyPrompt} onPress={startEditingLink}>
          <Text style={styles.linkEmptyPromptText}>+ add a link your circle follows</Text>
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
          durationDays={circle.durationDays}
          isSolo={isSolo}
          size="large"
          isRallied={!!circle.ralliedOnAt && !circle.completedAt}
        />
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
              <Text style={styles.wallPreviewFooter}>open the circle wall →</Text>
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
                  <View style={[styles.avatarWrap, (member.isResting || isAway) && styles.avatarWrapResting]}>
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
                  {isReachable && !checkedIn && (
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
                <View style={styles.memberActionsPanel}>
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

          {(() => {
            const best = pairStreaks
              .filter((p) => p.streak >= 3)
              .sort((a, b) => b.streak - a.streak)[0];
            return best ? (
              <Text style={styles.pairStreakText}>
                {STRINGS.pairStreakLabel(best.otherName, best.streak)}
              </Text>
            ) : null;
          })()}

          {hasCoverableMember && !hasSeenCoverHint && (
            <TouchableOpacity onPress={dismissCoverHint} style={styles.coverHintCard}>
              <Text style={styles.coverHintText}>{STRINGS.coverHintDiscovery}</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {!circle.completedAt && (
        <TouchableOpacity
          style={styles.inviteButton}
          onPress={() =>
            router.push({
              pathname: '/onboarding/invite',
              params: { circleId: circle.id, inviteCode: circle.inviteCode },
            })
          }
        >
          <Text style={styles.inviteButtonText}>✨ Invite someone</Text>
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
                  {isManagingMembers ? 'hide members' : 'manage members'}
                </Text>
              </TouchableOpacity>

              {isManagingMembers &&
                members
                  .filter((m) => m.userId !== session?.user?.id)
                  .map((member) => (
                    <View key={member.userId} style={styles.hostMemberRow}>
                      <Avatar name={member.name} userId={member.userId} avatarUrl={member.avatarUrl} size={26} />
                      <Text style={styles.hostMemberName}>{member.name ?? 'circle-mate'}</Text>
                      {removingMemberId !== member.userId && (
                        <TouchableOpacity onPress={() => setRemovingMemberId(member.userId)} hitSlop={6}>
                          <Text style={styles.hostMemberRemoveLink}>remove</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
              {isManagingMembers &&
                removingMemberId &&
                members.some((m) => m.userId === removingMemberId) && (
                  <View style={styles.hostMemberConfirmCard}>
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
                        <Text style={styles.hostMemberCancelText}>Cancel</Text>
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

          {/* Rallied-on circles add the wind-down control (previously its
              own second "host controls" card — one card now). */}
          {!!circle.ralliedOnAt &&
            (isConfirmingComplete ? (
              <View style={styles.journeyCompleteHostConfirmCard}>
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
                    <Text style={styles.leaveCancelText}>Cancel</Text>
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
        <View style={styles.leaveConfirmCard}>
          <Text style={styles.leaveConfirmText}>
            Leave {circle.name}? Your check-ins stay yours, and you can always come back with an
            invite.
          </Text>
          <View style={styles.leaveConfirmRow}>
            <TouchableOpacity
              style={styles.leaveCancelButton}
              onPress={() => setIsConfirmingLeave(false)}
              disabled={isLeaving}
            >
              <Text style={styles.leaveCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.leaveConfirmButton}
              onPress={handleLeave}
              disabled={isLeaving}
            >
              {isLeaving ? (
                <ActivityIndicator size="small" color={colors.ink} />
              ) : (
                <Text style={styles.leaveConfirmButtonText}>Leave circle</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.leaveLink} onPress={() => setIsConfirmingLeave(true)}>
          <Text style={styles.leaveLinkText}>Leave this circle</Text>
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
  },
  completedBadgeSmall: {
    ...chipTextShape,
    backgroundColor: colors.greenSoft,
    color: colors.green,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    fontSize: 9.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    overflow: 'hidden',
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
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
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
    color: colors.muted,
  },
  nameEditAction: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.green,
  },
  nameEditActionMuted: {
    fontWeight: '600',
    fontSize: 13,
    color: colors.muted,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
    marginBottom: 18,
  },
  headerStatus: {
    fontSize: 13,
    color: colors.muted,
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
    color: colors.muted,
  },
  linkEmptyPrompt: {
    alignItems: 'center',
    marginBottom: 24,
  },
  linkEmptyPromptText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.green,
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
    color: colors.green,
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
    color: colors.green,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.green,
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
    color: colors.muted,
  },
  wallPreviewLine: {
    fontSize: 12.5,
    color: colors.ink,
    marginBottom: 6,
  },
  wallPreviewFooter: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.green,
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
  // GS1 — the ambient flame line under a glowing member's avatar.
  // Quiet by design: small, muted, no ranking treatment, and simply
  // absent below 7 days.
  glowFlameLine: {
    fontSize: 9,
    color: colors.muted,
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
    color: colors.gold,
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
    color: colors.gold,
  },
  memberMoreLink: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.muted,
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
    color: colors.muted,
  },
  memberActionConfirmText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  memberActionConfirmBody: {
    fontSize: 12,
    color: colors.muted,
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
  pairStreakText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.gold,
    marginTop: -4,
    marginBottom: 10,
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
    color: colors.muted,
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
    color: colors.green,
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
    color: colors.muted,
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
    color: colors.muted,
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
    color: colors.muted,
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
    color: colors.muted,
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
    color: colors.muted,
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
    color: colors.muted,
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
    color: colors.muted,
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
    color: colors.muted,
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
    color: colors.muted,
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
  journeyGateCardWaiting: {
    fontSize: 11.5,
    color: colors.muted,
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
    color: colors.green,
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
    color: colors.muted,
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
    color: colors.muted,
    lineHeight: 17,
    marginBottom: 10,
  },
});

// NR1 Job 1c — this tab renders behind its own error boundary so a
// crash here can't take the floating tab bar (and the other tabs) down.
export default withErrorBoundary(YourCircle, 'tab:circle');

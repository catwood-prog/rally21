import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { MASCOT } from '@/assets/mascot';
import { Avatar } from '@/components/Avatar';
import { Brandmark } from '@/components/Brandmark';
import { CheckedInBadge } from '@/components/CheckedInBadge';
import { LinkCard } from '@/components/LinkCard';
import { MascotEntrance } from '@/components/MascotEntrance';
import { SignalMeter } from '@/components/SignalMeter';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, chipTextShape, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  CircleMember,
  getCircleMembers,
  getCirclePresence,
  isSoloCircle,
  leaveCircle,
  listMyCircles,
  MyCircle,
  removeMemberFromCircle,
  renameCircle,
  resolveCircleSelection,
  setCircleClosedToJoins,
  setCircleResourceUrl,
  subscribeToCirclePresence,
} from '@/lib/circle';
import { daysBetween, getLocalDateString } from '@/lib/date';
import { getPairStreaks, PairStreak } from '@/lib/glow';
import {
  completeCircle,
  GATE_DAY,
  getMyLastCelebratedDay,
  getNextMilestone,
  rallyOnCircle,
  shouldShowJourneyGate,
} from '@/lib/journey';
import { getMyProfile, markCoverHintSeen } from '@/lib/profile';
import { extractYouTubeId, isHttpUrl } from '@/lib/resourceLink';
import { computeSignal, PresenceRow } from '@/lib/signal';
import { getWallPreview, subscribeToWall, WallPreviewItem } from '@/lib/wall';

const MAX_CIRCLE_NAME_LENGTH = 40;

const MAX_AVATARS_SHOWN = 8;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

type ListCircleData = { members: CircleMember[]; presence: PresenceRow[] };

export default function YourCircle() {
  const router = useRouter();
  const { session } = useAuth();
  const { circleId, fromTab } = useLocalSearchParams<{ circleId?: string; fromTab?: string }>();
  const [circle, setCircle] = useState<MyCircle | null>(null);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [presence, setPresence] = useState<PresenceRow[]>([]);
  const [wallPreview, setWallPreview] = useState<WallPreviewItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Non-empty only when there's no circleId param AND the user is in more
  // than one circle — the tab's own root: a card per circle, tap through.
  const [listCircles, setListCircles] = useState<MyCircle[]>([]);
  const [listData, setListData] = useState<Record<string, ListCircleData>>({});
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
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

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);
    setListCircles([]);
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
        const [circleMembers, circlePresence, preview, profile, lastCelebratedDay, myPairStreaks] =
          await Promise.all([
            getCircleMembers(myCircle.id),
            getCirclePresence(myCircle.id),
            getWallPreview(myCircle.id),
            getMyProfile(session.user.id),
            getMyLastCelebratedDay(myCircle.id, session.user.id),
            getPairStreaks(myCircle.id).catch(() => []),
          ]);
        setMembers(circleMembers);
        setPresence(circlePresence);
        setWallPreview(preview);
        setHasSeenCoverHint(!!profile?.has_seen_cover_hint);
        setMyLastCelebratedDay(lastCelebratedDay);
        setPairStreaks(myPairStreaks);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load your circle');
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id, circleId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Brandmark style={styles.brandmark} />
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
          const shown = data.members.slice(0, MAX_AVATARS_SHOWN);
          const overflow = data.members.length - shown.length;
          const inTodayIds = new Set(
            data.presence.filter((p) => p.localDate === today).map((p) => p.userId)
          );

          return (
            <TouchableOpacity
              key={c.id}
              style={styles.listCard}
              onPress={() => router.setParams({ circleId: c.id, fromTab: 'true' })}
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
                      <Avatar name={member.name} avatarUrl={member.avatarUrl} size={34} ring={state} />
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
        <Text style={styles.subtitle}>{error ?? "you're not in a circle yet"}</Text>
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

  const shownMembers = members.slice(0, MAX_AVATARS_SHOWN);
  const overflowCount = members.length - shownMembers.length;
  const hasCoverableMember = shownMembers.some(
    (member) => member.userId !== session?.user?.id && !inTodayUserIds.has(member.userId)
  );
  const isCreator = circle.createdBy === session?.user?.id;
  const youtubeId = circle.resourceUrl ? extractYouTubeId(circle.resourceUrl) : null;

  const startEditingName = () => {
    setNameDraft(circle.name);
    setIsEditingName(true);
  };

  const saveName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === circle.name) {
      setIsEditingName(false);
      return;
    }
    setIsSavingName(true);
    try {
      await renameCircle(circle.id, trimmed);
      setCircle({ ...circle, name: trimmed });
      setIsEditingName(false);
    } catch {
      // leave editing open so they can retry
    } finally {
      setIsSavingName(false);
    }
  };

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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity
        onPress={() =>
          fromTab === 'true'
            ? router.replace('/circle')
            : router.push('/today')
        }
      >
        <Text style={styles.back}>{fromTab === 'true' ? '← Your Circles' : '← Today'}</Text>
      </TouchableOpacity>

      {circle.completedAt && (
        <View style={styles.journeyCompletedBanner}>
          <Text style={styles.journeyCompletedBadge}>{STRINGS.journeyCompletedBadge}</Text>
          <Text style={styles.journeyCompletedBannerTitle}>
            {STRINGS.journeyCompletedTitle(circle.name)}
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

      {isEditingName ? (
        <View style={styles.nameEditRow}>
          <TextInput
            style={styles.nameInput}
            value={nameDraft}
            onChangeText={setNameDraft}
            maxLength={MAX_CIRCLE_NAME_LENGTH}
            autoFocus
            editable={!isSavingName}
          />
          <TouchableOpacity onPress={saveName} disabled={isSavingName}>
            <Text style={styles.nameEditAction}>{isSavingName ? '…' : 'Save'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsEditingName(false)} disabled={isSavingName}>
            <Text style={styles.nameEditActionMuted}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.nameRow}>
          <Text style={styles.title}>{circle.name}</Text>
          {isCreator && !circle.completedAt && (
            <TouchableOpacity onPress={startEditingName} hitSlop={10}>
              <Text style={styles.editPencil}>✎</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      <Text style={styles.headerStatus}>
        {inTodayUserIds.size === members.length && members.length > 1
          ? STRINGS.groupAllInCelebration(members.length, circle.name)
          : STRINGS.groupHeaderStatus(signal.dayNumber, inTodayUserIds.size, members.length)}
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
                {item.kind === 'message'
                  ? `${memberName(item.userId)}: ${truncate(item.body, 50)}`
                  : `${memberName(item.fromUserId)} reacted ${item.emoji} to ${
                      item.targetUserId === session?.user.id
                        ? 'your'
                        : `${memberName(item.targetUserId)}'s`
                    } check-in`}
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
          <View style={styles.avatarRow}>
            {shownMembers.map((member) => {
              const checkedIn = inTodayUserIds.has(member.userId);
              const isCovered = presence.some(
                (p) => p.localDate === today && p.userId === member.userId && p.kind === 'covered'
              );
              const state = isCovered ? 'covered' : checkedIn ? 'done' : 'pending';
              const isMe = member.userId === session?.user?.id;
              const isCoverable = !checkedIn && !isMe;
              return (
                <View key={member.userId} style={styles.whoHereItem}>
                  <View style={styles.avatarWrap}>
                    <Avatar name={member.name} avatarUrl={member.avatarUrl} size={40} ring={state} />
                    <CheckedInBadge state={state} />
                  </View>
                  {isCoverable && (
                    <TouchableOpacity
                      style={styles.coverPill}
                      onPress={() =>
                        router.push({
                          pathname: '/cover',
                          params: {
                            circleId: circle.id,
                            memberId: member.userId,
                            memberName: member.name ?? 'your circle-mate',
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
                </View>
              );
            })}
            {overflowCount > 0 && (
              <View style={styles.avatarOverflow}>
                <Text style={styles.avatarOverflowText}>+{overflowCount}</Text>
              </View>
            )}
          </View>

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

      {isCreator && circle.isPublic && !circle.completedAt && (
        <View style={styles.hostControlsCard}>
          <Text style={styles.sectionLabel}>host controls</Text>

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
                  <Avatar name={member.name} avatarUrl={member.avatarUrl} size={26} />
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
        </View>
      )}

      {isCreator && circle.ralliedOnAt && !circle.completedAt && (
        <View style={styles.hostControlsCard}>
          <Text style={styles.sectionLabel}>host controls</Text>
          {isConfirmingComplete ? (
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
            <TouchableOpacity onPress={() => setIsConfirmingComplete(true)}>
              <Text style={styles.hostToggleLabel}>{STRINGS.journeyCompleteHostControlLabel}</Text>
              <Text style={styles.hostToggleHelper}>{STRINGS.journeyCompleteHostControlHelper}</Text>
            </TouchableOpacity>
          )}
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
    paddingBottom: 64,
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
  editPencil: {
    fontSize: 15,
    color: colors.muted,
  },
  nameEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  nameInput: {
    flex: 1,
    fontFamily: FONT_HEADER,
    fontSize: 20,
    color: colors.ink,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.green,
    paddingVertical: 4,
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
    backgroundColor: '#fff',
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

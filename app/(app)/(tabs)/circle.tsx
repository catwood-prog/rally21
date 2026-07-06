import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { SignalMeter } from '@/components/SignalMeter';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  CircleMember,
  getCircleMembers,
  getCirclePresence,
  isSoloCircle,
  leaveCircle,
  listMyCircles,
  MyCircle,
  renameCircle,
  resolveCircleSelection,
  setCircleResourceUrl,
  subscribeToCirclePresence,
} from '@/lib/circle';
import { getLocalDateString } from '@/lib/date';
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
        const [circleMembers, circlePresence, preview] = await Promise.all([
          getCircleMembers(myCircle.id),
          getCirclePresence(myCircle.id),
          getWallPreview(myCircle.id),
        ]);
        setMembers(circleMembers);
        setPresence(circlePresence);
        setWallPreview(preview);
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
              <Text style={styles.listCardName}>{c.name}</Text>
              <SignalMeter
                state={signal.state}
                dailyRates={signal.dailyRates}
                dayNumber={signal.dayNumber}
                durationDays={c.durationDays}
                isSolo={isSolo}
              />
              <View style={[styles.avatarRow, styles.listCardAvatarRow]}>
                {shown.map((member) => {
                  const checkedIn = inTodayIds.has(member.userId);
                  return (
                    <View key={member.userId} style={styles.avatarRowItem}>
                      <Avatar
                        name={member.name}
                        avatarUrl={member.avatarUrl}
                        size={34}
                        ring={checkedIn ? 'done' : 'pending'}
                      />
                      <CheckedInBadge visible={checkedIn} />
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

  const shownMembers = members.slice(0, MAX_AVATARS_SHOWN);
  const overflowCount = members.length - shownMembers.length;
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

      <Image
        source={MASCOT.huddle}
        style={styles.headerImage}
        resizeMode="contain"
        accessible={false}
        alt=""
      />

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
          {isCreator && (
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
          {isCreator && (
            <TouchableOpacity onPress={startEditingLink} hitSlop={8}>
              <Text style={styles.linkEditLink}>edit link</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : isCreator ? (
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
        />
      </View>

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
          <Image
            source={MASCOT.waving}
            style={styles.emptyGroupImage}
            resizeMode="contain"
            accessible={false}
            alt=""
          />
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
              return (
                <View key={member.userId} style={styles.avatarRowItem}>
                  <Avatar
                    name={member.name}
                    avatarUrl={member.avatarUrl}
                    size={40}
                    ring={checkedIn ? 'done' : 'pending'}
                  />
                  <CheckedInBadge visible={checkedIn} />
                </View>
              );
            })}
            {overflowCount > 0 && (
              <View style={styles.avatarOverflow}>
                <Text style={styles.avatarOverflowText}>+{overflowCount}</Text>
              </View>
            )}
          </View>
        </>
      )}

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
  listCardName: {
    fontFamily: FONT_HEADER,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 8,
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
  headerImage: {
    width: 160,
    height: 134,
    alignSelf: 'center',
    marginBottom: 10,
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
});

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Avatar } from '@/components/Avatar';
import { AppHeader } from '@/components/AppHeader';
import { MessageDialog } from '@/components/MessageDialog';
import { VoiceMicButton } from '@/components/VoiceMicButton';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { reportContent } from '@/lib/moderation';
import {
  CircleMember,
  getCircleMembers,
  hasSeenVoiceUnlockedHint,
  markVoiceUnlockedHintSeen,
  MyCircle,
  resolveCircleSelection,
} from '@/lib/circle';
import {
  deleteWallMessage,
  getMyCircleCompletionCount,
  getWallMessages,
  postWallMessage,
  setWallMessageReaction,
  subscribeToWall,
  WallMessage,
} from '@/lib/wall';
import { markWallSeen } from '@/lib/warmth';

const QUICK_REACTIONS = ['🎉', '👏', '🧡', '🔥'];
// Open circles restrict reactions (and free-text posting) to this curated
// set — see the "Open circles" section of the multi-circle spec.
const OPEN_CIRCLE_REACTIONS = ['🧡', '👏', '🔥', '👋'];
const VOICE_UNLOCK_COMPLETIONS = 7;

function appendTranscript(existing: string, transcript: string): string {
  if (!existing || /\s$/.test(existing)) return existing + transcript;
  return `${existing} ${transcript}`;
}

export default function CircleWall() {
  const router = useRouter();
  const { session } = useAuth();
  const { circleId } = useLocalSearchParams<{ circleId?: string }>();
  const [circle, setCircle] = useState<MyCircle | null>(null);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [messages, setMessages] = useState<WallMessage[]>([]);
  // OC1's earned-voice gate mirror (browse joiners in public circles) —
  // formerly derived from the wall's check-in feed, which WL1 removed.
  const [myCompletionCount, setMyCompletionCount] = useState(0);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Non-null only when there's no circleId param AND the user is in more
  // than one circle, so we can't tell which wall they meant.
  const [pickerCircles, setPickerCircles] = useState<MyCircle[] | null>(null);
  // Defaults to true so the celebration banner never flashes before the
  // real value loads — it only ever matters once it resolves to false.
  const [hasSeenUnlockHint, setHasSeenUnlockHint] = useState(true);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [reportingMessageId, setReportingMessageId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [isReporting, setIsReporting] = useState(false);
  const [reportMicDenied, setReportMicDenied] = useState(false);
  const [showReportedNotice, setShowReportedNotice] = useState(false);

  const loadFeed = useCallback(async (circleId: string) => {
    const wallMessages = await getWallMessages(circleId);
    setMessages(wallMessages);
  }, []);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);
    setPickerCircles(null);
    try {
      const selection = await resolveCircleSelection(circleId, session.user.id);
      if (selection.kind === 'picker') {
        setPickerCircles(selection.circles);
        setCircle(null);
        return;
      }
      const myCircle = selection.circle;
      setCircle(myCircle);
      if (myCircle) {
        // WL2 — every wall open stamps memberships.wall_seen_at, so
        // Today's teaser goes quiet until something newer lands.
        // Fire-and-forget: a failed stamp just means the teaser shows
        // once more.
        markWallSeen(myCircle.id).catch(() => {});
        await Promise.all([
          getCircleMembers(myCircle.id).then(setMembers),
          loadFeed(myCircle.id),
          // The completion count only gates voice for browse joiners in
          // public circles — everyone else skips the query entirely.
          myCircle.isPublic && myCircle.myJoinSource === 'browse'
            ? getMyCircleCompletionCount(myCircle.id, session.user.id).then(setMyCompletionCount)
            : Promise.resolve(setMyCompletionCount(0)),
          myCircle.isPublic && myCircle.createdBy !== session.user.id
            ? hasSeenVoiceUnlockedHint(myCircle.id, session.user.id).then(setHasSeenUnlockHint)
            : Promise.resolve(setHasSeenUnlockHint(true)),
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load your circle');
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id, circleId, loadFeed]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (!circle) return;
    const unsubscribe = subscribeToWall(circle.id, () => loadFeed(circle.id));
    return unsubscribe;
  }, [circle?.id, loadFeed]);

  const isCreator = circle?.createdBy === session?.user?.id;
  // OC1 (13 July): the earned-voice gate now scopes to browse joiners
  // only — a creator or someone who joined by invite posts free text
  // from day one, matching the RLS policy exactly (private OR creator OR
  // join_source <> 'browse' OR 7+ completions).
  const isBrowseJoiner = circle?.myJoinSource === 'browse';
  const isVoiceUnlocked =
    !circle?.isPublic || isCreator || !isBrowseJoiner || myCompletionCount >= VOICE_UNLOCK_COMPLETIONS;
  const showUnlockCelebration = !!circle?.isPublic && isBrowseJoiner && isVoiceUnlocked && !hasSeenUnlockHint;
  const reactionSet = circle?.isPublic ? OPEN_CIRCLE_REACTIONS : QUICK_REACTIONS;

  useEffect(() => {
    if (!circle || !showUnlockCelebration) return;
    setHasSeenUnlockHint(true);
    markVoiceUnlockedHintSeen(circle.id).catch(() => {});
  }, [showUnlockCelebration, circle?.id]);

  const memberName = (userId: string) => {
    if (userId === session?.user.id) return 'You';
    return members.find((m) => m.userId === userId)?.name ?? 'circle-mate';
  };

  const memberAvatar = (userId: string) => members.find((m) => m.userId === userId)?.avatarUrl ?? null;

  const handleSend = async () => {
    if (!circle || !session?.user || !draft.trim()) return;
    setIsSending(true);
    try {
      await postWallMessage(circle.id, session.user.id, draft);
      setDraft('');
      await loadFeed(circle.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not send that — try again');
    } finally {
      setIsSending(false);
    }
  };

  const handleReactToMessage = async (messageId: string, emoji: string) => {
    if (!circle || !session?.user) return;
    try {
      await setWallMessageReaction({ messageId, fromUserId: session.user.id, emoji });
      await loadFeed(circle.id);
    } catch {
      // reactions are low-stakes — fail silently rather than interrupt
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!circle) return;
    setIsDeleting(true);
    try {
      await deleteWallMessage(messageId);
      setConfirmingDeleteId(null);
      await loadFeed(circle.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not remove that — try again');
    } finally {
      setIsDeleting(false);
    }
  };

  // MOD1: reporter safety is instant and unconditional — the message
  // disappears from THIS reporter's own view right away (optimistic
  // local removal), permanently, regardless of what happens to it
  // globally. A second independent report hides it for everyone,
  // pending review; that's server-side (report_content's own circuit
  // breaker), not something this screen needs to know about.
  const handleReportMessage = async (messageId: string) => {
    setIsReporting(true);
    try {
      await reportContent({ targetKind: 'wall_message', targetId: messageId, reason: reportReason.trim() || undefined });
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      setReportingMessageId(null);
      setReportReason('');
      setShowReportedNotice(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not send that report — try again');
    } finally {
      setIsReporting(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  if (pickerCircles) {
    return (
      <View style={styles.loading}>
        <Text style={styles.pickerTitle}>which circle&apos;s wall?</Text>
        {pickerCircles.map((c) => (
          <TouchableOpacity
            key={c.id}
            style={styles.pickerRow}
            onPress={() => router.replace({ pathname: '/wall', params: { circleId: c.id } })}
          >
            <Text style={styles.pickerRowText}>{c.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  if (!circle || error) {
    return (
      <View style={styles.loading}>
        <Text style={styles.subtitle}>{error ?? "you're not in a circle yet"}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.backWrap}>
        <AppHeader style={styles.brandmark} />
        <TouchableOpacity
          onPress={() => router.push({ pathname: '/circle', params: { circleId: circle.id } })}
        >
          <Text style={styles.back}>← your circle</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{STRINGS.wallHeaderTitle(circle.name)}</Text>
        <Text style={styles.headerSubtitle}>
          {members.length} {members.length === 1 ? 'member' : 'members'}
        </Text>
      </View>

      {showUnlockCelebration && (
        <View style={styles.unlockBanner}>
          <Text style={styles.unlockBannerText}>{STRINGS.openCircleVoiceUnlockedTitle}</Text>
        </View>
      )}

      <ScrollView
        style={styles.feed}
        contentContainerStyle={styles.feedContent}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 && (
          <Text style={styles.emptyState}>nothing here yet — say hi to your circle</Text>
        )}

        {messages.map((item) => {
          const isMe = item.userId === session?.user.id;
          const messageReactionCounts = item.reactions.reduce<Record<string, number>>((acc, r) => {
            acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
            return acc;
          }, {});
          const myMessageReaction = item.reactions.find((r) => r.fromUserId === session?.user.id)?.emoji;
          const isConfirmingThisDelete = confirmingDeleteId === item.id;
          return (
            <View
              key={item.id}
              style={[styles.messageRow, isMe && styles.messageRowMe]}
            >
              {!isMe && (
                <View style={styles.senderRow}>
                  <Avatar name={memberName(item.userId)} userId={item.userId} avatarUrl={memberAvatar(item.userId)} size={16} />
                  <Text style={styles.senderName}>{memberName(item.userId)}</Text>
                </View>
              )}
              <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
                <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.body}</Text>
              </View>
              <View style={[styles.reactionRow, isMe && styles.reactionRowMe]}>
                {reactionSet.map((emoji) => (
                  <TouchableOpacity
                    key={emoji}
                    style={[styles.reactionChip, myMessageReaction === emoji && styles.reactionChipMine]}
                    onPress={() => handleReactToMessage(item.id, emoji)}
                  >
                    <Text style={styles.reactionEmoji}>{emoji}</Text>
                    {!!messageReactionCounts[emoji] && (
                      <Text style={styles.reactionCount}>{messageReactionCounts[emoji]}</Text>
                    )}
                  </TouchableOpacity>
                ))}
                {isCreator &&
                  (isConfirmingThisDelete ? (
                    <>
                      <TouchableOpacity onPress={() => handleDeleteMessage(item.id)} disabled={isDeleting}>
                        <Text style={styles.hostDeleteConfirmText}>
                          {isDeleting ? '…' : STRINGS.hostRemoveMemberCta}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setConfirmingDeleteId(null)} disabled={isDeleting}>
                        <Text style={styles.hostDeleteCancelText}>{STRINGS.hostDeleteWallMessageCancel}</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity onPress={() => setConfirmingDeleteId(item.id)} hitSlop={6}>
                      <Text style={styles.hostDeleteLink}>{STRINGS.hostDeleteWallMessageLink}</Text>
                    </TouchableOpacity>
                  ))}
                {!isMe && reportingMessageId !== item.id && (
                  <TouchableOpacity onPress={() => setReportingMessageId(item.id)} hitSlop={6}>
                    <Text style={styles.hostDeleteLink}>{STRINGS.reportLink}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {reportingMessageId === item.id && (
                <View style={styles.reportPanel}>
                  <View style={styles.reportInputRow}>
                    <TextInput
                      style={styles.reportInput}
                      placeholder={STRINGS.reportReasonPlaceholder}
                      placeholderTextColor={colors.muted}
                      value={reportReason}
                      onChangeText={setReportReason}
                      multiline
                    />
                    {!reportMicDenied && (
                      <VoiceMicButton
                        style={styles.reportMicButton}
                        onTranscript={(text) => setReportReason((prev) => appendTranscript(prev, text))}
                        onPermissionDenied={() => setReportMicDenied(true)}
                      />
                    )}
                  </View>
                  <View style={styles.reportActionsRow}>
                    <TouchableOpacity
                      onPress={() => {
                        setReportingMessageId(null);
                        setReportReason('');
                      }}
                      disabled={isReporting}
                    >
                      <Text style={styles.hostDeleteCancelText}>{STRINGS.reportCancelCta}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleReportMessage(item.id)} disabled={isReporting}>
                      <Text style={styles.hostDeleteConfirmText}>
                        {isReporting ? '…' : STRINGS.reportSubmitCta}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {!isVoiceUnlocked && (
        <Text style={styles.reactOnlyHint}>{STRINGS.openCircleReactOnlyHint}</Text>
      )}

      {isVoiceUnlocked && (
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder={STRINGS.wallComposerPlaceholder}
            placeholderTextColor={colors.muted}
            value={draft}
            onChangeText={setDraft}
            multiline
          />
          {!micDenied && (
            <VoiceMicButton
              style={styles.micButton}
              onTranscript={(text) => setDraft((prev) => appendTranscript(prev, text))}
              onPermissionDenied={() => setMicDenied(true)}
            />
          )}
          <TouchableOpacity
            style={[styles.sendButton, !draft.trim() && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!draft.trim() || isSending}
          >
            {isSending ? (
              <ActivityIndicator size="small" color={colors.ink} />
            ) : (
              <Text style={styles.sendIcon}>➤</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <MessageDialog
        visible={showReportedNotice}
        title={STRINGS.reportedConfirmationTitle}
        message={STRINGS.reportedConfirmationBody}
        onDismiss={() => setShowReportedNotice(false)}
      />
      <MessageDialog visible={!!error} title="hmm" variant="error" message={error ?? ''} onDismiss={() => setError(null)} />
    </KeyboardAvoidingView>
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
  subtitle: {
    fontSize: 13,
    color: colors.muted,
  },
  pickerTitle: {
    fontFamily: FONT_HEADER,
    fontSize: 18,
    color: colors.ink,
    marginBottom: 16,
  },
  pickerRow: {
    width: '100%',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
    ...cardShadow,
  },
  pickerRowText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
  backWrap: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  brandmark: {
    marginBottom: 10,
  },
  back: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  headerTitle: {
    fontFamily: FONT_HEADER,
    fontSize: 15,
    color: colors.ink,
  },
  headerSubtitle: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 2,
  },
  unlockBanner: {
    backgroundColor: colors.goldSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  unlockBannerText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.ink,
    textAlign: 'center',
  },
  reactOnlyHint: {
    textAlign: 'center',
    fontSize: 11.5,
    color: colors.muted,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  feed: {
    flex: 1,
  },
  feedContent: {
    padding: 16,
    paddingBottom: 24,
  },
  emptyState: {
    textAlign: 'center',
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 40,
  },
  messageRow: {
    marginBottom: 12,
    maxWidth: '78%',
  },
  messageRowMe: {
    alignSelf: 'flex-end',
  },
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
    marginLeft: 4,
  },
  senderName: {
    fontSize: 9,
    color: colors.muted,
  },
  bubble: {
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  bubbleOther: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 4,
  },
  bubbleMe: {
    backgroundColor: colors.green,
    borderTopRightRadius: 4,
  },
  bubbleText: {
    fontSize: 12.5,
    color: colors.ink,
    lineHeight: 17,
  },
  bubbleTextMe: {
    color: '#fff',
  },
  reactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  reactionRowMe: {
    justifyContent: 'flex-end',
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 99,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  reactionChipMine: {
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
  },
  reactionEmoji: {
    fontSize: 13,
  },
  reactionCount: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.ink,
  },
  hostDeleteLink: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.muted,
  },
  hostDeleteConfirmText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.errorRed,
  },
  hostDeleteCancelText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.muted,
  },
  reportPanel: {
    marginTop: 6,
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 10,
    gap: 8,
    maxWidth: '85%',
  },
  reportInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  reportInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 8,
    fontSize: 11.5,
    color: colors.ink,
    minHeight: 36,
  },
  reportMicButton: {
    paddingBottom: 6,
  },
  reportActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 14,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 15,
    fontSize: 13,
    color: colors.ink,
    maxHeight: 100,
  },
  micButton: {
    paddingBottom: 8,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendIcon: {
    fontSize: 15,
    color: colors.ink,
  },
});

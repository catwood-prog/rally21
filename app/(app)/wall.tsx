import { useFocusEffect, useRouter } from 'expo-router';
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
import { FONT_HEADER } from '@/constants/fonts';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { CircleMember, getCircleMembers, getMyPrimaryCircle, MyCircle } from '@/lib/circle';
import {
  CheckinFeedEntry,
  getCheckinFeed,
  getWallMessages,
  postWallMessage,
  setCheckinReaction,
  subscribeToWall,
  WallMessage,
} from '@/lib/wall';

const QUICK_REACTIONS = ['🎉', '👏', '💛', '🔥'];

type FeedItem =
  | { kind: 'message'; id: string; userId: string; body: string; createdAt: string }
  | {
      kind: 'checkin';
      key: string;
      userId: string;
      localDate: string;
      createdAt: string;
      reactions: CheckinFeedEntry['reactions'];
    };

export default function CircleWall() {
  const router = useRouter();
  const { session } = useAuth();
  const [circle, setCircle] = useState<MyCircle | null>(null);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [messages, setMessages] = useState<WallMessage[]>([]);
  const [checkins, setCheckins] = useState<CheckinFeedEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFeed = useCallback(async (circleId: string) => {
    const [wallMessages, checkinFeed] = await Promise.all([
      getWallMessages(circleId),
      getCheckinFeed(circleId),
    ]);
    setMessages(wallMessages);
    setCheckins(checkinFeed);
  }, []);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);
    try {
      const myCircle = await getMyPrimaryCircle(session.user.id);
      setCircle(myCircle);
      if (myCircle) {
        await Promise.all([getCircleMembers(myCircle.id).then(setMembers), loadFeed(myCircle.id)]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load your circle');
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id, loadFeed]);

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

  const handleReact = async (entry: FeedItem & { kind: 'checkin' }, emoji: string) => {
    if (!circle || !session?.user) return;
    try {
      await setCheckinReaction({
        circleId: circle.id,
        targetUserId: entry.userId,
        targetLocalDate: entry.localDate,
        fromUserId: session.user.id,
        emoji,
      });
      await loadFeed(circle.id);
    } catch {
      // reactions are low-stakes — fail silently rather than interrupt
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
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

  const feed: FeedItem[] = [
    ...messages.map((m): FeedItem => ({
      kind: 'message',
      id: m.id,
      userId: m.userId,
      body: m.body,
      createdAt: m.createdAt,
    })),
    ...checkins.map(
      (c): FeedItem => ({
        kind: 'checkin',
        key: `${c.userId}-${c.localDate}`,
        userId: c.userId,
        localDate: c.localDate,
        createdAt: c.createdAt,
        reactions: c.reactions,
      })
    ),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TouchableOpacity onPress={() => router.push('/circle')} style={styles.backWrap}>
        <Text style={styles.back}>← Your Circle</Text>
      </TouchableOpacity>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{circle.name}</Text>
        <Text style={styles.headerSubtitle}>
          {members.length} {members.length === 1 ? 'member' : 'members'}
        </Text>
      </View>

      <ScrollView style={styles.feed} contentContainerStyle={styles.feedContent}>
        {feed.length === 0 && (
          <Text style={styles.emptyState}>nothing here yet — say hi to your circle</Text>
        )}

        {feed.map((item) => {
          if (item.kind === 'message') {
            const isMe = item.userId === session?.user.id;
            return (
              <View
                key={item.id}
                style={[styles.messageRow, isMe && styles.messageRowMe]}
              >
                {!isMe && (
                  <View style={styles.senderRow}>
                    <Avatar name={memberName(item.userId)} avatarUrl={memberAvatar(item.userId)} size={16} />
                    <Text style={styles.senderName}>{memberName(item.userId)}</Text>
                  </View>
                )}
                <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
                  <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.body}</Text>
                </View>
              </View>
            );
          }

          const reactionCounts = item.reactions.reduce<Record<string, number>>((acc, r) => {
            acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
            return acc;
          }, {});
          const myReaction = item.reactions.find((r) => r.fromUserId === session?.user.id)?.emoji;

          return (
            <View key={item.key} style={styles.checkinRow}>
              <View style={styles.checkinHeader}>
                <Avatar name={memberName(item.userId)} avatarUrl={memberAvatar(item.userId)} size={22} />
                <Text style={styles.checkinText}>
                  <Text style={styles.checkinName}>{memberName(item.userId)}</Text> checked in
                </Text>
              </View>
              <View style={styles.reactionRow}>
                {QUICK_REACTIONS.map((emoji) => (
                  <TouchableOpacity
                    key={emoji}
                    style={[styles.reactionChip, myReaction === emoji && styles.reactionChipMine]}
                    onPress={() => handleReact(item, emoji)}
                  >
                    <Text style={styles.reactionEmoji}>{emoji}</Text>
                    {!!reactionCounts[emoji] && (
                      <Text style={styles.reactionCount}>{reactionCounts[emoji]}</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Message your circle…"
          placeholderTextColor={colors.muted}
          value={draft}
          onChangeText={setDraft}
          multiline
        />
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
  backWrap: {
    paddingHorizontal: 20,
    paddingTop: 16,
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
  checkinRow: {
    alignItems: 'center',
    marginVertical: 10,
  },
  checkinHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  checkinText: {
    fontSize: 11,
    color: colors.muted,
  },
  checkinName: {
    fontWeight: '700',
    color: colors.ink,
  },
  reactionRow: {
    flexDirection: 'row',
    gap: 6,
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
    backgroundColor: 'rgba(244, 200, 75, 0.15)',
  },
  reactionEmoji: {
    fontSize: 13,
  },
  reactionCount: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.ink,
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

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
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

import { MASCOT } from '@/assets/mascot';
import { Brandmark } from '@/components/Brandmark';
import { MascotEntrance } from '@/components/MascotEntrance';
import { VoiceMicButton } from '@/components/VoiceMicButton';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { AskRallyMessage, deleteConversation, getActiveConversation, streamAskRally } from '@/lib/askRally';

function appendTranscript(existing: string, transcript: string): string {
  if (!existing || /\s$/.test(existing)) return existing + transcript;
  return `${existing} ${transcript}`;
}

// Ask Rally, part 1 — the real thing (Rally21-Ask-Rally-Spec.md). Every
// authenticated user (A0's founder allowlist is gone). Conversations
// persist server-side for continuity: 'start fresh' closes the current
// thread (server-side, on the next message) and opens a new one;
// 'delete' is a separate, one-tap, real hard delete.
//
// A2 (7 July): this is now the ONE Ask Rally component, shared by the
// standalone /ask-rally route (deep-linked from blueprint cards and the
// journal, with an optional prefill context) and the Rally tab (the
// front door — no context, no back link since it's already a tab).
export function AskRallyScreen({
  contextParam,
  showBackLink = false,
}: {
  contextParam?: string;
  showBackLink?: boolean;
}) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AskRallyMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const [micDenied, setMicDenied] = useState(false);
  const pendingStartFresh = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const prefilledFromContext = useRef(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const active = await getActiveConversation();
      setConversationId(active?.id ?? null);
      setMessages(active?.messages ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load your conversation');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Entry from a blueprint card ("ask Rally about this") prefills the
  // composer with that pattern as a starting point — never auto-sent on
  // the user's behalf, they still choose what to actually ask.
  if (contextParam && !prefilledFromContext.current && !isLoading) {
    prefilledFromContext.current = true;
    setDraft(`About this: "${contextParam}" — `);
  }

  const handleStartFresh = () => {
    pendingStartFresh.current = true;
    setMessages([]);
    setConversationId(null);
    setError(null);
    setLimitMessage(null);
    setDraft('');
  };

  const handleDelete = async () => {
    if (!conversationId) return;
    try {
      await deleteConversation(conversationId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not delete that — try again');
      return;
    }
    setConversationId(null);
    setMessages([]);
    setLimitMessage(null);
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || isSending) return;

    setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    setDraft('');
    setError(null);
    setLimitMessage(null);
    setIsSending(true);
    const startFresh = pendingStartFresh.current;
    pendingStartFresh.current = false;

    try {
      let assistantText = '';
      let limited = false;
      await streamAskRally(
        text,
        (chunk) => {
          assistantText += chunk;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: assistantText };
            return updated;
          });
        },
        {
          startFresh,
          onHeaders: (headers) => {
            limited = headers.get('X-Ask-Rally-Limited') === 'true';
          },
        }
      );
      if (limited) setLimitMessage(assistantText);
      // Refresh from the server so the conversation id (first message
      // ever) and full history stay authoritative — never trust local
      // optimistic state as the source of truth for something persisted.
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not reach Ask Rally');
      setMessages((prev) => prev.slice(0, -2));
    } finally {
      setIsSending(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Brandmark style={styles.brandmark} />
        <View style={styles.headerRow}>
          {showBackLink ? (
            <TouchableOpacity onPress={() => router.push('/today')}>
              <Text style={styles.back}>← Today</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.title}>Ask Rally</Text>
          )}
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={handleStartFresh} hitSlop={8}>
              <Text style={styles.startFresh}>start fresh</Text>
            </TouchableOpacity>
            {conversationId && (
              <TouchableOpacity onPress={handleDelete} hitSlop={8}>
                <Text style={styles.deleteText}>delete</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        {showBackLink && <Text style={styles.title}>Ask Rally</Text>}
        <Text style={styles.subtitle}>private to you — nothing here shapes your blueprint or circle</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 && (
          <View style={styles.emptyState}>
            <MascotEntrance source={MASCOT.theListener} style={styles.emptyMascot} />
            <Text style={styles.emptyIntro}>{STRINGS.chatIntroMessage}</Text>
            <Text style={styles.emptyHook}>{STRINGS.askRallyEmptyHook}</Text>
          </View>
        )}
        {messages.map((m, i) => (
          <View
            key={i}
            style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}
          >
            <Text style={styles.bubbleText}>
              {m.content || (isSending && i === messages.length - 1 ? '…' : '')}
            </Text>
          </View>
        ))}
        {limitMessage && <Text style={styles.limitText}>{limitMessage}</Text>}
        {error && <Text style={styles.errorText}>{error}</Text>}
      </ScrollView>

      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          placeholder="ask Rally anything…"
          placeholderTextColor={colors.muted}
          value={draft}
          onChangeText={setDraft}
          multiline
          editable={!isSending}
        />
        {!micDenied && (
          <VoiceMicButton
            style={styles.micButton}
            onTranscript={(text) => setDraft((prev) => appendTranscript(prev, text))}
            onPermissionDenied={() => setMicDenied(true)}
          />
        )}
        <TouchableOpacity
          style={[styles.sendButton, (!draft.trim() || isSending) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!draft.trim() || isSending}
        >
          {isSending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.sendButtonText}>Send</Text>}
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
  },
  header: {
    padding: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  brandmark: {
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  back: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  startFresh: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.plum,
  },
  deleteText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.errorRed,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 22,
    color: colors.ink,
  },
  subtitle: {
    fontSize: 11.5,
    color: colors.muted,
    marginTop: 2,
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    padding: 20,
    paddingBottom: 12,
    gap: 12,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 12,
  },
  emptyMascot: {
    width: 90,
    height: 106,
    marginBottom: 16,
  },
  emptyIntro: {
    fontSize: 13.5,
    color: colors.ink,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  emptyHook: {
    fontSize: 12.5,
    color: colors.muted,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 16,
    padding: 12,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: colors.card,
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: colors.plumSoft,
  },
  bubbleText: {
    fontSize: 14,
    color: colors.ink,
    lineHeight: 20,
  },
  limitText: {
    fontSize: 12.5,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
  errorText: {
    fontSize: 12.5,
    color: colors.errorRed,
    textAlign: 'center',
    marginTop: 8,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 12,
    fontSize: 14,
    color: colors.ink,
    minHeight: 44,
    maxHeight: 120,
  },
  micButton: {
    paddingBottom: 10,
  },
  sendButton: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.ink,
  },
});

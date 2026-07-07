import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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

import { Brandmark } from '@/components/Brandmark';
import { VoiceMicButton } from '@/components/VoiceMicButton';
import { FONT_HEADER } from '@/constants/fonts';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { AskRallyMessage, ASK_RALLY_FOUNDER_IDS, streamAskRally } from '@/lib/askRally';

function appendTranscript(existing: string, transcript: string): string {
  if (!existing || /\s$/.test(existing)) return existing + transcript;
  return `${existing} ${transcript}`;
}

// A0 — the tone playground (Rally21-Ask-Rally-Spec.md). Founder-only,
// nothing persists: history lives in this screen's own state and is gone
// the moment it unmounts or "start fresh" is tapped.
export default function AskRally() {
  const router = useRouter();
  const { session, isLoading: isAuthLoading } = useAuth();
  const [messages, setMessages] = useState<AskRallyMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micDenied, setMicDenied] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const isFounder = !!session?.user && ASK_RALLY_FOUNDER_IDS.has(session.user.id);

  useEffect(() => {
    // Client-side redirect only — a UX nicety. The edge function's own
    // 403 is the real enforcement (never rely on this alone).
    if (!isAuthLoading && !isFounder) {
      router.replace('/today');
    }
  }, [isAuthLoading, isFounder, router]);

  if (isAuthLoading || !isFounder) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  const handleStartFresh = () => {
    setMessages([]);
    setError(null);
    setDraft('');
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || isSending) return;

    const nextMessages: AskRallyMessage[] = [...messages, { role: 'user', content: text }];
    setMessages([...nextMessages, { role: 'assistant', content: '' }]);
    setDraft('');
    setError(null);
    setIsSending(true);

    try {
      let assistantText = '';
      await streamAskRally(nextMessages, (chunk) => {
        assistantText += chunk;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: assistantText };
          return updated;
        });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not reach Ask Rally');
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Brandmark style={styles.brandmark} />
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.push('/today')}>
            <Text style={styles.back}>← Today</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleStartFresh} hitSlop={8}>
            <Text style={styles.startFresh}>start fresh</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.title}>Ask Rally</Text>
        <Text style={styles.subtitle}>founder-only playground — nothing here is saved</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 && (
          <Text style={styles.emptyText}>say anything — this is just for testing the tone.</Text>
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
  emptyText: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 24,
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

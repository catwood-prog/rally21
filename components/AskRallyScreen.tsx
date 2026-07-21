import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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

import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { MASCOT } from '@/assets/mascot';
import { AppHeader } from '@/components/AppHeader';
import { MascotEntrance } from '@/components/MascotEntrance';
import { MascotPatch } from '@/components/MascotPatch';
import { VoiceMicButton } from '@/components/VoiceMicButton';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { AskRallyMessage, deleteConversation, getActiveConversation, streamAskRally } from '@/lib/askRally';
import { LISTENER_STEAM_PATCH } from '@/lib/mascotFx';
import { MASCOT_FX } from '@/lib/motion';

/** M2 (d) — the listener with its one-shot mug steam: standard entrance,
 * then the steam patch (the frames differ only in a ~70×60px region
 * above the mug) crossfades in once over ~2.5s and holds on the steam
 * frame. Static under reduced motion (no steam at all). */
const LISTENER_BOX = { width: 90, height: 106 };

function ListenerMascot() {
  const reduceMotion = useReducedMotion();
  const steamOpacity = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    steamOpacity.value = withDelay(
      MASCOT_FX.STEAM_DELAY_MS,
      withTiming(1, { duration: MASCOT_FX.STEAM_FADE_MS })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const steamStyle = useAnimatedStyle(() => ({ opacity: steamOpacity.value }));

  return (
    <View style={styles.emptyMascotBox}>
      <MascotEntrance source={MASCOT.theListener} style={styles.emptyMascot} />
      <MascotPatch
        source={MASCOT.theListenerSteam}
        sourceSize={LISTENER_STEAM_PATCH.source}
        patch={LISTENER_STEAM_PATCH.patch}
        box={LISTENER_BOX}
        animatedStyle={steamStyle}
      />
    </View>
  );
}

function appendTranscript(existing: string, transcript: string): string {
  if (!existing || /\s$/.test(existing)) return existing + transcript;
  return `${existing} ${transcript}`;
}

/** What the composer opens with. A pattern-card entry (`context`) is a
 * pattern the user is reacting to, so it gets the About-this wrapper; a
 * map starter chip (`prefill`, PM1) is the user's own question, so it
 * lands verbatim. Context wins if both ever arrive. Null = no prefill. */
export function buildPrefillDraft(contextParam?: string, prefillParam?: string): string | null {
  if (contextParam) return `About this: "${contextParam}" — `;
  if (prefillParam) return prefillParam;
  return null;
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
// front door — no context). NAV1 (13 July): the old showBackLink
// "← Today" is gone — AppHeader's house icon is the way back on both
// entries, so the two variants now render identically.
export function AskRallyScreen({
  contextParam,
  prefillParam,
}: {
  contextParam?: string;
  prefillParam?: string;
}) {
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
    } catch {
      setError(STRINGS.askRallyLoadFailed);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Entry from a blueprint card ("ask Rally about this") or a map
  // starter chip (PM1) prefills the composer as a starting point —
  // never auto-sent on the user's behalf, they still choose what to
  // actually ask (or edit first).
  const prefillDraft = buildPrefillDraft(contextParam, prefillParam);
  if (prefillDraft !== null && !prefilledFromContext.current && !isLoading) {
    prefilledFromContext.current = true;
    setDraft(prefillDraft);
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
    } catch {
      setError(STRINGS.askRallyDeleteFailed);
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

    let assistantText = '';
    try {
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
    } catch {
      if (assistantText) {
        // AR1: the reply (or part of it) already arrived — showing it
        // beats an error line for an answer that exists. Reconcile with
        // the persisted server copy; if even that fails, the optimistic
        // render stands.
        try {
          await load();
        } catch {
          /* keep the optimistic render */
        }
      } else {
        setError(STRINGS.askRallyUnavailable);
        setMessages((prev) => prev.slice(0, -2));
      }
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
        <AppHeader style={styles.brandmark} />
        <View style={styles.headerRow}>
          <Text style={styles.title}>{STRINGS.askRallyLinkLabel}</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={handleStartFresh} hitSlop={8}>
              <Text style={styles.startFresh}>{STRINGS.askRallyStartFresh}</Text>
            </TouchableOpacity>
            {conversationId && (
              <TouchableOpacity onPress={handleDelete} hitSlop={8}>
                <Text style={styles.deleteText}>{STRINGS.askRallyDelete}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        <Text style={styles.subtitle}>{STRINGS.askRallySubtitle}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 && error ? (
          // AR1, per the placement map (6 July, re-confirmed 21 July): a
          // screen-level failure — an error with no conversation on
          // screen — shows the apologetic slip above the warm line. A
          // failure under a live conversation stays text-only below (one
          // mascot per screen, never crowding a conversation), and the
          // slip replaces the listener here for the same law.
          <View style={styles.emptyState}>
            <MascotEntrance source={MASCOT.apologeticSlip} style={styles.errorMascot} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <>
            {messages.length === 0 && (
              <View style={styles.emptyState}>
                <ListenerMascot />
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
          </>
        )}
      </ScrollView>

      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          placeholder={STRINGS.askRallyComposerPlaceholder}
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
          {isSending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.sendButtonText}>{STRINGS.askRallySendCta}</Text>}
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
  emptyMascotBox: {
    width: 90,
    height: 106,
    marginBottom: 16,
  },
  emptyMascot: {
    width: 90,
    height: 106,
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
  // The slip at the 404 page's medium size (150×88) — the two
  // screen-level error surfaces stay visually consistent.
  errorMascot: {
    width: 150,
    height: 88,
    marginBottom: 6,
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

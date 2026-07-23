import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { MASCOT } from '@/assets/mascot';
import { AppHeader } from '@/components/AppHeader';
import { AskRallyLearnMoreSheet } from '@/components/AskRallyLearnMoreSheet';
import { MascotEntrance } from '@/components/MascotEntrance';
import { MascotPatch } from '@/components/MascotPatch';
import { MessageDialog } from '@/components/MessageDialog';
import { appendTranscript, VoiceMicButton } from '@/components/VoiceMicButton';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { AskRallyMessage, deleteConversation, getActiveConversation, streamAskRally } from '@/lib/askRally';
import { useAuth } from '@/lib/auth-context';
import { getMyBlueprint } from '@/lib/blueprint';
import { getLocalDateString } from '@/lib/date';
import { formatChatTranscript } from '@/lib/exportChat';
import { getMyWeek } from '@/lib/glow';
import { LISTENER_STEAM_PATCH } from '@/lib/mascotFx';
import { MASCOT_FX } from '@/lib/motion';
import { getMySubstantiveReflectionCount } from '@/lib/reflections';
import { buildStarterChips, derivePersonalChip, missedYesterday, StarterChip } from '@/lib/starterChips';

/** M2 (d) — the listener with its one-shot mug steam: standard entrance,
 * then the steam patch (the frames differ only in a ~70×60px region
 * above the mug) crossfades in once over ~2.5s and holds on the steam
 * frame. Static under reduced motion (no steam at all). PM1B sizes it
 * ~120px wide beside the greeting bubble (Cat's ruling: the dynamic
 * pair, with its steam, as Rally's opening presence). */
const LISTENER_BOX = { width: 120, height: 141 };

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
    <View style={styles.greetingMascotBox}>
      <MascotEntrance source={MASCOT.theListener} style={styles.greetingMascot} />
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
//
// PM1B (21 July, REV 4 — Cat's final layout): the screen carries its own
// starter chips (once day 14 populates the private map, the map's card
// sinks below the fold), Rally speaks the greeting as a message-style
// bubble with the listener beside it, the context line under the title
// links privacy (green) and the private map (plum), the composer doubles
// in height with the mic first-class inside it, and the safety line +
// learn-more sheet sit under the composer. Chips render only while the
// visible thread is empty and POPULATE the composer, never send.
export function AskRallyScreen({
  contextParam,
  prefillParam,
}: {
  contextParam?: string;
  prefillParam?: string;
}) {
  const router = useRouter();
  const { session } = useAuth();
  const { fontScale } = useWindowDimensions();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AskRallyMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const [micDenied, setMicDenied] = useState(false);
  const [chips, setChips] = useState<StarterChip[]>(() =>
    buildStarterChips({ hasMissedYesterday: false })
  );
  const [reflectionCount, setReflectionCount] = useState(0);
  const [showLearnMore, setShowLearnMore] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const pendingStartFresh = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const prefilledFromContext = useRef(false);

  const userId = session?.user?.id;

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      // The chip gates and the reflections count are ambient garnish —
      // each fails soft (standard four chips / lock-link alone), never
      // taking down the conversation itself.
      const [active, week, count, patterns] = await Promise.all([
        getActiveConversation(),
        getMyWeek().catch(() => []),
        userId ? getMySubstantiveReflectionCount(userId).catch(() => 0) : Promise.resolve(0),
        getMyBlueprint().catch(() => []),
      ]);
      setConversationId(active?.id ?? null);
      setMessages(active?.messages ?? []);
      setChips(
        buildStarterChips({
          hasMissedYesterday: missedYesterday(week),
          personalQuestion: derivePersonalChip(patterns, userId ?? '', getLocalDateString()),
        })
      );
      setReflectionCount(count);
    } catch {
      setError(STRINGS.askRallyLoadFailed);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

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

  // EX1 — shares exactly the conversation already on screen (the
  // `messages` state array), never a re-fetch and never any id: this
  // can't leak anyone else's conversation because it never asks the
  // server for one. React Native's Share.share covers both platforms —
  // on web (react-native-web) it forwards straight to navigator.share
  // where the browser has it, and REJECTS where it doesn't (verified
  // against react-native-web's own source, not assumed), so the catch
  // below is the one and only place a web build without Web Share falls
  // back to copy-to-clipboard. On iOS, cancelling the sheet RESOLVES
  // (never throws) — the catch there only fires on a genuine failure to
  // present it. Either way, nothing here is ever a silent no-op, and
  // nothing here is ever logged (no captureError call at all, ask
  // Rally content included).
  const handleExportChat = async () => {
    const transcript = formatChatTranscript(messages);
    try {
      await Share.share({ message: transcript });
    } catch (err) {
      if (Platform.OS === 'web' && (err as Error | null)?.name === 'AbortError') return;
      await Clipboard.setStringAsync(transcript);
      setExportNotice(STRINGS.askRallyExportCopiedNotice);
    }
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

  const isEmptyThread = messages.length === 0;
  // At larger accessibility text sizes the chip grid collapses to one
  // column — never squeeze wrapped copy into narrow cards.
  const singleColumnChips = fontScale >= 1.2;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <AppHeader style={styles.brandmark} />
        <View style={styles.headerRow}>
          <Text style={styles.title}>{STRINGS.askRallyScreenTitle}</Text>
          {/* start fresh / delete only once a conversation exists —
              hidden on the empty state (REV 4 ruling 6). */}
          {!isEmptyThread && (
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={handleStartFresh} hitSlop={8}>
                <Text style={styles.startFresh}>{STRINGS.askRallyStartFresh}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleExportChat} hitSlop={8}>
                <Text style={styles.exportChat}>{STRINGS.askRallyExportChat}</Text>
              </TouchableOpacity>
              {conversationId && (
                <TouchableOpacity onPress={handleDelete} hitSlop={8}>
                  <Text style={styles.deleteText}>{STRINGS.askRallyDelete}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
        {/* Two tap targets in one line; the right-hand slot of this row
            stays EMPTY in v1 — reserved for a future plan indicator at
            the monetization pass. */}
        <View style={styles.contextRow}>
          <View style={styles.contextLeft}>
            <TouchableOpacity onPress={() => router.push('/privacy')} hitSlop={8}>
              <Text style={styles.privateLink}>{STRINGS.askRallyPrivateLink}</Text>
            </TouchableOpacity>
            {reflectionCount >= 3 && (
              <>
                <Text style={styles.contextDot}>·</Text>
                <TouchableOpacity onPress={() => router.push('/private-map')} hitSlop={8}>
                  <Text style={styles.reflectionsLink}>
                    {STRINGS.askRallyReflectionsLink(reflectionCount)}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {isEmptyThread && error ? (
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
            {isEmptyThread && (
              // Rally speaks the greeting: a message-style bubble with
              // the listener sitting beside/below it — on this screen
              // the penguin IS Rally's avatar (placement amendment #2),
              // and Ask Rally owns the words. Once a real conversation
              // exists this scrolls away like any message.
              <View style={styles.greetingWrap}>
                <View style={styles.greetingBubble}>
                  <Text style={styles.greetingText}>{STRINGS.askRallyGreetingP1}</Text>
                  <Text style={[styles.greetingText, styles.greetingTextSecond]}>
                    {STRINGS.askRallyGreetingP2}
                  </Text>
                </View>
                <ListenerMascot />
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

      <View style={styles.bottomSection}>
        {isEmptyThread && !error && (
          // The 2×2 starter grid, only while the thread is empty — never
          // clutter an active conversation. A tap POPULATES the composer,
          // never sends (PM1's law — it matters more when messages are
          // capped).
          <View style={styles.chipGrid}>
            {chips.map((chip) => (
              <TouchableOpacity
                key={chip.text}
                style={[
                  styles.chip,
                  singleColumnChips ? styles.chipFull : styles.chipHalf,
                  chip.personal && styles.chipFeatured,
                ]}
                onPress={() => setDraft(chip.text)}
              >
                {chip.personal && (
                  <Text style={styles.chipFeaturedLabel}>{STRINGS.personalChipLabel}</Text>
                )}
                <Text style={styles.chipText}>{chip.text}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.composerBox}>
          <View style={styles.composerTopRow}>
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
          </View>
          <View style={styles.composerBottomRow}>
            <TouchableOpacity
              style={[styles.sendButton, (!draft.trim() || isSending) && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!draft.trim() || isSending}
              hitSlop={8}
            >
              {isSending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.sendButtonText}>{STRINGS.askRallySendCta}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.safetyText}>
          {STRINGS.askRallySafetyLine}{' '}
          <Text style={styles.safetyLink} onPress={() => setShowLearnMore(true)}>
            {STRINGS.askRallySafetyLearnMore}
          </Text>
        </Text>
      </View>

      <AskRallyLearnMoreSheet visible={showLearnMore} onDismiss={() => setShowLearnMore(false)} />

      <MessageDialog
        visible={!!exportNotice}
        title="done"
        message={exportNotice ?? ''}
        onDismiss={() => setExportNotice(null)}
      />
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
    paddingBottom: 0,
  },
  brandmark: {
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  // Quiet utility action, neither a CTA nor destructive — stays
  // ink/muted per the color law (colors.gold/green/plum/orange are all
  // scarce, meaning-carrying colors this action doesn't belong to).
  exportChat: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.mutedStrong,
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
  contextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  contextLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  privateLink: {
    fontSize: 13.5,
    fontWeight: '600',
    color: colors.green,
  },
  contextDot: {
    fontSize: 13.5,
    color: colors.muted,
  },
  reflectionsLink: {
    fontSize: 13.5,
    fontWeight: '600',
    color: colors.plum,
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
  greetingWrap: {
    alignItems: 'flex-start',
    paddingTop: 4,
  },
  greetingBubble: {
    backgroundColor: colors.plumSoft,
    borderRadius: 20,
    padding: 16,
    maxWidth: '90%',
  },
  greetingText: {
    fontSize: 15,
    color: colors.ink,
    lineHeight: 22,
  },
  greetingTextSecond: {
    marginTop: 10,
  },
  // Tucked below the bubble's right corner, per the approved comp.
  greetingMascotBox: {
    width: 120,
    height: 141,
    alignSelf: 'flex-end',
    marginTop: -6,
    marginRight: 26,
  },
  greetingMascot: {
    width: 120,
    height: 141,
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
  // Chips + composer + safety line share one container (and one left
  // edge), lifting together with the keyboard so the safety line stays
  // visible while typing.
  bottomSection: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
    backgroundColor: colors.bg,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  chipHalf: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  chipFull: {
    flexBasis: '100%',
  },
  chip: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.plum,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 15.5,
    color: colors.plum,
    lineHeight: 21,
    textAlign: 'left',
  },
  // PM1C — the personal chip's featured treatment (the approved comp's
  // .feat): soft plum-tinted fill instead of white, plus the green
  // transparency label above the question.
  chipFeatured: {
    backgroundColor: colors.plumSoft,
  },
  chipFeaturedLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.green,
    marginBottom: 3,
  },
  // The doubled composer: plum outline, mic first-class inside right,
  // small gold Send inside bottom-right (all ≥44px targets via hitSlop).
  composerBox: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.plum,
    borderRadius: 22,
    minHeight: 84,
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 16,
    justifyContent: 'space-between',
  },
  composerTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
    padding: 0,
    maxHeight: 120,
  },
  micButton: {
    marginTop: -2,
  },
  composerBottomRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  sendButton: {
    backgroundColor: colors.gold,
    borderRadius: 13,
    paddingVertical: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
  safetyText: {
    fontSize: 12,
    color: colors.mutedStrong,
    textAlign: 'center',
    paddingTop: 8,
  },
  safetyLink: {
    textDecorationLine: 'underline',
    color: colors.mutedStrong,
    fontWeight: '600',
  },
});

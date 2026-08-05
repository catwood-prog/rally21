import { withErrorBoundary } from '@/components/ErrorBoundary';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { MASCOT } from '@/assets/mascot';
import { AppHeader } from '@/components/AppHeader';
import { ErrorSlip } from '@/components/ErrorSlip';
import { GhostCard } from '@/components/GhostCard';
import { MascotEntrance } from '@/components/MascotEntrance';
import { ReflectionsToggleRow } from '@/components/ReflectionsToggleRow';
import { appendTranscript, VoiceMicButton } from '@/components/VoiceMicButton';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors, scaledLineHeight } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useAuth } from '@/lib/auth-context';
import {
  BlueprintDocument,
  BlueprintPattern,
  BlueprintResponse,
  ContrastCard,
  deriveWantPracticeName,
  describeBlueprintPattern,
  describeConfidence,
  describeContrastEvidence,
  getMyBlueprint,
  getMyBlueprintDocument,
  getMyBlueprintResponses,
  getWantActivation,
  markBlueprintPatternSurfaced,
  respondToBlueprintPattern,
  WantActivation,
} from '@/lib/blueprint';
import { getCircleById, listMyCircles } from '@/lib/circle';
import { getLocalDateString } from '@/lib/date';
import { isRequestTimeout } from '@/lib/fetch-timeout';
import { getMyWeek } from '@/lib/glow';
import { getMyProfile, setReflectionsOptOut } from '@/lib/profile';
import { captureError } from '@/lib/sentry';
import { LikedCard, getMyLikedCards, hasAttributionLine, unlikeCard } from '@/lib/shareCards';
import {
  buildStarterChips,
  derivePersonalChip,
  hasBlueprintEvidence,
  missedYesterday,
  StarterChip,
} from '@/lib/starterChips';

/** PM2: the "quotes you love" list shows this many rows before the
 * "see all N" expander takes over. */
const LIKED_QUOTES_COLLAPSED_COUNT = 3;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const EMPTY_DOCUMENT: BlueprintDocument = { traits: [], evolution: [], want: null };


/** A1 entry point: "ask Rally about this" on any pattern card, prefilling
 * the composer with that pattern as a starting point (never auto-sent —
 * the user still chooses what to actually ask). */
function patternContextText(copy: { headline: string; accent: string }): string {
  return copy.accent ? `${copy.headline} ${copy.accent}` : copy.headline;
}

/** MN3 — dates read as words, the same long form the manual and journal
 * use, so a date means the same thing on every inner-life surface. */
function formatContrastDate(localDate: string): string {
  const [y, m, d] = localDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

/** MN3's card body: two labelled blocks and an expander, and deliberately
 * nothing else. There is no framing line above the blocks and no sentence
 * anywhere that tells the person what the two halves add up to — Cat's
 * ruling, 31 July: a line like "you said one thing, and we saw another"
 * makes a claim where the card is only supposed to show two facts.
 *
 * The lane labels are MN2's own strings. The quote is byte-copied from what
 * the person answered. The evidence line is composed on this device from
 * stored numbers, never from model text (hallucination law clause 4). The
 * ONE model-written string on this card is `observedLine`, and it was
 * validated against those same numbers before it was ever stored. */
function ContrastCardBody({ card }: { card: ContrastCard }) {
  const [showEvidence, setShowEvidence] = useState(false);

  return (
    <>
      <Text style={styles.patternLabel}>{STRINGS.contrastCardLabel}</Text>

      <Text style={styles.contrastLaneLabel}>{STRINGS.manualLaneDeclared}</Text>
      <Text style={styles.contrastQuote}>“{card.declaredQuote}”</Text>
      <Text style={styles.contrastDate}>{formatContrastDate(card.declaredDate)}</Text>

      <Text style={[styles.contrastLaneLabel, styles.contrastLaneLabelSecond]}>
        {STRINGS.manualLaneObserved}
      </Text>
      <Text style={styles.contrastObserved}>{card.observedLine}</Text>

      <TouchableOpacity
        style={styles.contrastEvidenceToggle}
        onPress={() => setShowEvidence((v) => !v)}
      >
        <Text style={styles.contrastEvidenceToggleText}>
          {showEvidence ? STRINGS.contrastEvidenceCollapse : STRINGS.contrastEvidenceExpander}
        </Text>
      </TouchableOpacity>
      {showEvidence && (
        <View style={styles.contrastEvidence}>
          <Text style={styles.patternMeta}>{describeContrastEvidence(card, formatContrastDate)}</Text>
          <Text style={styles.patternMeta}>{STRINGS.contrastEvidenceSource}</Text>
        </View>
      )}
    </>
  );
}

/** PM1: the map's invitation into Ask Rally — a warm lead plus starter
 * questions, each opening the composer with that question sitting there
 * as plain text (the `prefill` param, not the About-this `context`
 * wrapper — a chip is a question the user is asking, not a pattern
 * they're reacting to). Never auto-sent. One shared card for both the
 * populated map and the empty state; only the lead line adapts. PM1B:
 * the chip set arrives from lib/starterChips (rev-2 wording, with the
 * missed-day recovery swap), so this card and the Ask Rally screen's own
 * grid always agree. */
function AskRallyInviteCard({ lead, chips }: { lead: string; chips: StarterChip[] }) {
  const router = useRouter();
  return (
    <View style={styles.patternCard}>
      <Text style={styles.patternLabel}>{STRINGS.blueprintAskLabel}</Text>
      <Text style={styles.askLead}>{lead}</Text>
      {chips.map((chip) => (
        <TouchableOpacity
          key={chip.text}
          style={[styles.askChip, chip.personal && styles.askChipFeatured]}
          onPress={() => router.push({ pathname: '/ask-rally', params: { prefill: chip.text } })}
        >
          {chip.personal && <Text style={styles.askChipFeaturedLabel}>{STRINGS.personalChipLabel}</Text>}
          <Text style={styles.askChipText}>{chip.text}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function Blueprint() {
  const router = useRouter();
  const { session } = useAuth();
  // TB3 — inset-aware pill clearance.
  const tabBarClearance = useTabBarClearance();
  const [patterns, setPatterns] = useState<BlueprintPattern[]>([]);
  const [responses, setResponses] = useState<BlueprintResponse[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // FF2 — what this session actually surfaced, held locally so a failed
  // markBlueprintPatternSurfaced write cannot let a refocus rotate the
  // person onto a different observation. A ref, not state: `load` reads it
  // and nothing renders from it, so it must not re-run the load.
  const surfacedThisSession = useRef<{ key: string; at: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // ER1 — load failures (whole-moment, gets the slip) are kept separate
  // from `error` (save/act failures rendered as an inline text line
  // under live content — those stay text-only per the placement map).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [isWritingNote, setIsWritingNote] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [document, setDocument] = useState<BlueprintDocument>(EMPTY_DOCUMENT);
  const [wantActivation, setWantActivation] = useState<WantActivation | null>(null);
  const [isWantLive, setIsWantLive] = useState(false);
  const [activatedCircleName, setActivatedCircleName] = useState<string | null>(null);
  const [isActingOnWant, setIsActingOnWant] = useState(false);
  const [likedCards, setLikedCards] = useState<LikedCard[]>([]);
  const [showAllQuotes, setShowAllQuotes] = useState(false);
  // AR5 — cold set until the evidence is measured (see the Ask Rally
  // screen's note): the map's card is most often seen by exactly the
  // people below the floors.
  const [askChips, setAskChips] = useState<StarterChip[]>(() =>
    buildStarterChips({ hasMissedYesterday: false, hasEvidence: false })
  );
  // SK1 job 4 — the dormant state and its way back in.
  const [reflectionsOff, setReflectionsOff] = useState(false);
  const [isTogglingReflections, setIsTogglingReflections] = useState(false);
  // Latched at load time, not from the live value — see the journal's
  // note: unmounting the row you just tapped reads as a dead tap.
  const [showReflectionsToggle, setShowReflectionsToggle] = useState(false);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);
    setLoadError(null);
    setIsActingOnWant(false);
    try {
      const [myPatterns, myResponses, profile, myDocument, myLikedCards, myWeek] = await Promise.all([
        getMyBlueprint(),
        getMyBlueprintResponses(session.user.id),
        getMyProfile(session.user.id),
        getMyBlueprintDocument(),
        // PM2 — additive: a hiccup here must never take down the map.
        getMyLikedCards().catch(() => [] as LikedCard[]),
        // PM1B — the recovery-chip gate fails soft to the standard four.
        getMyWeek().catch(() => []),
      ]);
      setPatterns(myPatterns);
      setResponses(myResponses);
      setDocument(myDocument);
      setLikedCards(myLikedCards);
      setReflectionsOff(profile?.reflections_opt_out ?? false);
      setShowReflectionsToggle(profile?.reflections_opt_out ?? false);
      setAskChips(
        buildStarterChips({
          hasMissedYesterday: missedYesterday(myWeek),
          // AR5 — the one gate, from the same already-loaded rows.
          hasEvidence: hasBlueprintEvidence(myPatterns),
          // PM1C — same deterministic derivation as the Ask Rally screen,
          // from the same already-loaded pattern rows.
          personalQuestion: derivePersonalChip(myPatterns, session.user.id, getLocalDateString()),
          obstacle: profile?.keep_going_obstacle ?? null,
        })
      );

      if (myDocument.want && myDocument.want.status === 'confirmed') {
        const activation = await getWantActivation(myDocument.want.key);
        setWantActivation(activation);
        if (activation) {
          const [circles, circle] = await Promise.all([
            listMyCircles(session.user.id),
            // FF1 rule 1 — silence is right: this is the activated
            // circle's NAME for one line of copy. Null drops the name,
            // and `stillMember` (the fact that actually decides whether
            // the want reads live) comes from listMyCircles beside it,
            // so a failed name read can never mislabel the state.
            getCircleById(activation.circleId).catch(() => null),
          ]);
          const stillMember = circles.some((c) => c.id === activation.circleId && !c.completedAt);
          setIsWantLive(stillMember);
          setActivatedCircleName(circle?.name ?? null);
        }
      } else {
        setWantActivation(null);
        setIsWantLive(false);
        setActivatedCircleName(null);
      }

      const respondedKeys = new Set(myResponses.map((r) => r.patternKey));
      const unresponded = myPatterns.filter((p) => !respondedKeys.has(p.patternKey));

      if (unresponded.length === 0) {
        setActiveKey(null);
      } else {
        // FF2 — the surfaced-key write below is fire-and-forget, so when it
        // fails the profile still names the PREVIOUS pattern and the very
        // next focus re-derives from stale inputs. Holding what this
        // session actually surfaced keeps the observation steady for the
        // visit instead of rotating under the person mid-read.
        const surfacedKey =
          surfacedThisSession.current?.key ?? profile?.blueprint_surfaced_pattern_key ?? null;
        const surfacedAt =
          surfacedThisSession.current?.at ?? profile?.blueprint_surfaced_at ?? null;
        const stillCandidate = surfacedKey && unresponded.some((p) => p.patternKey === surfacedKey);
        const withinCooldown = !!surfacedAt && Date.now() - new Date(surfacedAt).getTime() < SEVEN_DAYS_MS;

        const next = stillCandidate && withinCooldown ? surfacedKey! : unresponded[0].patternKey;
        setActiveKey(next);
        if (next !== surfacedKey) {
          surfacedThisSession.current = { key: next, at: new Date().toISOString() };
          markBlueprintPatternSurfaced(next).catch((e) =>
            captureError(e, { screen: 'private-map', op: 'markBlueprintPatternSurfaced' })
          );
        }
      }
    } catch (e) {
      // HY1 job 7 — THE TIMEOUT GETS ITS OWN SENTENCE AND A WAY BACK.
      //
      // SUP1's 15s deadline (lib/fetch-timeout.ts) has always fired here
      // correctly; what it did not have was a state. Every failure took
      // the same "your map couldn't load just now — give it a moment and
      // try again" line, on a screen with nothing to tap: this load runs
      // from useFocusEffect, so "try again" meant navigating away and
      // back, and a person on bad signal had no way to know that. The
      // deadline is also the failure most likely to come good on a second
      // attempt, which is what makes a retry honest here rather than a
      // button that walks into the same wall.
      //
      // ER1 still holds either way: a warm line, never the raw message.
      const timedOut = isRequestTimeout(e);
      setLoadError(
        timedOut ? STRINGS.loadTimedOutLine('your map') : STRINGS.loadFailedLine('your map')
      );
      // FF1 rule 3 — reported, never swallowed. `handled: 'yes'` is the
      // point of the tag: Sentry c726f818 (4 Aug) was this deadline
      // arriving as an UNHANDLED rejection with no screen state behind
      // it, and the tag is how a future triage tells "the screen caught
      // this and said so" apart from "nobody caught it".
      captureError(e, {
        screen: 'private-map',
        op: 'load',
        handled: 'yes',
        ...(timedOut ? { timeout: 'yes' } : {}),
      });
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // SK1 job 4 — the same inline toggle the journal carries; Cat's ruling
  // is that the way back in lives on the page you walked into.
  const handleToggleReflections = async () => {
    if (!session?.user || isTogglingReflections) return;
    const next = !reflectionsOff;
    setIsTogglingReflections(true);
    setReflectionsOff(next);
    try {
      await setReflectionsOptOut(session.user.id, next);
    } catch {
      setReflectionsOff(!next);
      setError(STRINGS.reflectionsToggleFailed);
    } finally {
      setIsTogglingReflections(false);
    }
  };

  const handleRespond = async (patternKey: string, response: 'confirmed' | 'not_quite', note?: string) => {
    if (!session?.user) return;
    setIsSaving(true);
    try {
      await respondToBlueprintPattern({ userId: session.user.id, patternKey, response, note });
      setResponses((prev) => [...prev, { patternKey, response, note: note ?? null }]);
      setIsWritingNote(false);
      setNoteDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save that — try again');
    } finally {
      setIsSaving(false);
    }
  };

  /** PM2 — un-like from the map: a real deletion of the user's own liked
   * rows (RPC, owner-scoped), list updated optimistically; on failure the
   * row comes back with the screen's usual error line. */
  const handleUnlike = async (cardKey: string) => {
    const previous = likedCards;
    setLikedCards((prev) => prev.filter((c) => c.cardKey !== cardKey));
    try {
      await unlikeCard(cardKey);
    } catch (e) {
      setLikedCards(previous);
      setError(e instanceof Error ? e.message : 'could not remove that — try again');
    }
  };

  const handleActOnWant = () => {
    if (!document.want || isActingOnWant) return;
    setIsActingOnWant(true);
    router.push({
      pathname: '/onboarding/circle-setup',
      params: {
        wantKey: document.want.key,
        wantStatement: document.want.statement,
        suggestedName: deriveWantPracticeName(document.want.statement),
      },
    });
  };

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  const respondedByKey = new Map(responses.map((r) => [r.patternKey, r]));
  // Confirmed wants get their own dedicated card below (act flow / live /
  // retired states) — never the generic "you said this sounds right" card.
  const confirmedPatterns = patterns.filter(
    (p) => respondedByKey.get(p.patternKey)?.response === 'confirmed' && p.patternType !== 'synthesis_want'
  );
  const activePattern = patterns.find((p) => p.patternKey === activeKey) ?? null;
  const visibleTraits = document.traits
    .map((t) => ({ trait: t, word: describeConfidence(t.confidence) }))
    .filter((t): t is { trait: typeof document.traits[number]; word: NonNullable<ReturnType<typeof describeConfidence>> } => !!t.word);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      keyboardShouldPersistTaps="handled"
    >
      <AppHeader style={styles.header} />

      <Text style={styles.title}>{STRINGS.blueprintTitle}</Text>
      {/* OD1 job 21c — the one privacy mark, same family as the journal's. */}
      <View style={styles.lock}>
        <Text style={styles.lockText}>{STRINGS.privateBadge}</Text>
      </View>
      <Text style={styles.subtitle}>{STRINGS.blueprintSubline}</Text>

      {/* ER1: a failed map load is a whole-moment failure (slip); save
          failures below stay inline text under live content. */}
      {/* HY1 job 7 — the retry re-runs the same `load` the focus effect
          runs, so a timed-out map recovers in place instead of asking the
          person to navigate away and back to discover it works now. */}
      {loadError && <ErrorSlip message={loadError} onRetry={load} />}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {visibleTraits.length > 0 && (
        <View style={styles.traitsSection}>
          <Text style={styles.sectionLabel}>{STRINGS.blueprintTraitsLabel}</Text>
          {visibleTraits.map(({ trait, word }) => (
            <View key={trait.key} style={styles.traitRow}>
              <Text style={styles.traitLabel}>{trait.label}</Text>
              <Text style={styles.traitWord}>{word}</Text>
            </View>
          ))}
        </View>
      )}

      {/* SK1 job 4 — the reflections-off state (mockup frame B). Same
          rule as the journal: it replaces the ordinary empty state, never
          real patterns found before the switch went off. The line is the
          honest one — the map genuinely CAN see when you show up, because
          check-ins still flow; what it can't see is why. Ask Rally stays
          offered, since it doesn't need reflections to be useful. */}
      {!error && !loadError && patterns.length === 0 && reflectionsOff && (
        <>
          <View style={styles.dormantState}>
            <GhostCard widths={[44, 90, 70]} />
            <GhostCard widths={[34, 82, 58]} />
            <Text style={styles.dormantLine}>{STRINGS.blueprintReflectionsOffLine}</Text>
          </View>
          <AskRallyInviteCard lead={STRINGS.blueprintAskLeadEmpty} chips={askChips} />
        </>
      )}

      {/* one mascot per screen: the slip above replaces the journal
          companion whenever the load itself failed (ER1). */}
      {!error && !loadError && patterns.length === 0 && !reflectionsOff && (
        <>
          <View style={styles.emptyState}>
            <MascotEntrance source={MASCOT.journalCompanion} style={styles.emptyStateImage} />
            <Text style={styles.emptyStateText}>{STRINGS.blueprintEmptyText}</Text>
          </View>
          <AskRallyInviteCard lead={STRINGS.blueprintAskLeadEmpty} chips={askChips} />
        </>
      )}

      {activePattern &&
        (() => {
          const copy = describeBlueprintPattern(activePattern);
          const isSynthesis = activePattern.patternType === 'synthesis_pattern' || activePattern.patternType === 'synthesis_want';
          // MN3 — a contrast card replaces the headline block with its two
          // labelled lanes. The confirm / not-quite row below is shared and
          // unchanged, which is the whole reason a contrast is a pattern as
          // far as the rest of the system is concerned: a not-quite pins the
          // pair through the machinery that already existed.
          const contrastCard = activePattern.patternType === 'contrast' ? activePattern.contrast : null;
          return (
            <View style={styles.patternCard}>
              {contrastCard ? (
                <ContrastCardBody card={contrastCard} />
              ) : (
                <>
                  <Text style={styles.patternLabel}>{STRINGS.blueprintPatternLabel}</Text>
                  {isSynthesis ? (
                    <Text style={styles.patternHeadline}>{copy.headline}</Text>
                  ) : (
                    <Text style={styles.patternHeadline}>
                      {copy.headline} <Text style={styles.patternAccent}>{copy.accent}</Text>.
                    </Text>
                  )}
                  {!!copy.evidence && <Text style={styles.patternMeta}>{copy.evidence}</Text>}
                </>
              )}

              {isWritingNote ? (
                <View style={styles.noteWrap}>
                  <View style={styles.noteInputWrap}>
                    <TextInput
                      style={styles.noteInput}
                      placeholder={STRINGS.blueprintNotePlaceholder}
                      placeholderTextColor={colors.muted}
                      value={noteDraft}
                      onChangeText={setNoteDraft}
                      multiline
                    />
                    {!micDenied && (
                      <VoiceMicButton
                        style={styles.noteMicButton}
                        onTranscript={(text) => setNoteDraft((prev) => appendTranscript(prev, text))}
                        onPermissionDenied={() => setMicDenied(true)}
                      />
                    )}
                  </View>
                  <View style={styles.noteActionsRow}>
                    <TouchableOpacity
                      onPress={() => {
                        setIsWritingNote(false);
                        setNoteDraft('');
                      }}
                      disabled={isSaving}
                    >
                      <Text style={styles.noteSkipText}>{STRINGS.blueprintNoteSkip}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.noteSaveButton}
                      onPress={() => handleRespond(activePattern.patternKey, 'not_quite', noteDraft.trim() || undefined)}
                      disabled={isSaving}
                    >
                      <Text style={styles.noteSaveText}>{isSaving ? '…' : STRINGS.blueprintNoteSubmit}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.responseRow}>
                  <TouchableOpacity
                    style={styles.soundsRight}
                    onPress={() => handleRespond(activePattern.patternKey, 'confirmed')}
                    disabled={isSaving}
                  >
                    <Text style={styles.soundsRightText}>{STRINGS.blueprintSoundsRight}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.notQuite}
                    onPress={() => setIsWritingNote(true)}
                    disabled={isSaving}
                  >
                    <Text style={styles.notQuiteText}>{STRINGS.blueprintNotQuite}</Text>
                  </TouchableOpacity>
                </View>
              )}
              {!isWritingNote && (
                <TouchableOpacity
                  onPress={() =>
                    router.push({ pathname: '/ask-rally', params: { context: patternContextText(copy) } })
                  }
                >
                  <Text style={styles.askRallyAboutLink}>{STRINGS.askRallyAboutThis} →</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })()}

      {confirmedPatterns.map((p) => {
        const copy = describeBlueprintPattern(p);
        const isSynthesis = p.patternType === 'synthesis_pattern' || p.patternType === 'synthesis_want';
        const contrastCard = p.patternType === 'contrast' ? p.contrast : null;
        return (
          <View key={p.patternKey} style={[styles.patternCard, styles.patternCardConfirmed]}>
            {contrastCard ? (
              <ContrastCardBody card={contrastCard} />
            ) : (
              <>
                <Text style={styles.patternLabel}>{STRINGS.blueprintPatternLabel}</Text>
                {isSynthesis ? (
                  <Text style={styles.patternHeadline}>{copy.headline}</Text>
                ) : (
                  <Text style={styles.patternHeadline}>
                    {copy.headline} <Text style={styles.patternAccent}>{copy.accent}</Text>.
                  </Text>
                )}
                {!!copy.evidence && <Text style={styles.patternMeta}>{copy.evidence}</Text>}
              </>
            )}
            <Text style={styles.respondedText}>{STRINGS.blueprintConfirmedText}</Text>
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/ask-rally', params: { context: patternContextText(copy) } })}
            >
              <Text style={styles.askRallyAboutLink}>{STRINGS.askRallyAboutThis} →</Text>
            </TouchableOpacity>
          </View>
        );
      })}

      {document.want && document.want.status === 'confirmed' && (
        <View style={[styles.patternCard, styles.wantCard]}>
          <Text style={styles.patternLabel}>{STRINGS.blueprintWantLabel}</Text>
          <Text style={styles.patternHeadline}>{document.want.statement}</Text>
          {wantActivation ? (
            <Text style={styles.respondedText}>
              {isWantLive ? STRINGS.blueprintWantNowPractice : STRINGS.blueprintWantBecame(activatedCircleName ?? '')}
            </Text>
          ) : (
            <TouchableOpacity style={styles.actButton} onPress={handleActOnWant} disabled={isActingOnWant}>
              <Text style={styles.actButtonText}>
                {isActingOnWant ? '…' : STRINGS.blueprintWantActCta}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {document.evolution.length > 0 && (
        <View style={styles.evolutionSection}>
          <Text style={styles.sectionLabel}>{STRINGS.blueprintEvolutionLabel}</Text>
          {document.evolution.map((entry) => (
            <View key={entry.key} style={styles.evolutionRow}>
              <Text style={styles.evolutionStatement} numberOfLines={2}>
                {entry.statement}
              </Text>
              <Text style={[styles.evolutionTag, entry.status === 'rejected' && styles.evolutionTagRetired]}>
                {entry.status === 'confirmed' ? 'confirmed' : 'retired'}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* PM2 — "quotes you love": after evolution, before PM1's invite
          card, footer last (Cat's placement ruling). Quiet by design —
          serif italic like the card face but muted, the pattern cards
          keep visual primacy; absent entirely with no likes. */}
      {likedCards.length > 0 && (
        <View style={styles.quotesSection}>
          <Text style={styles.sectionLabel}>{STRINGS.blueprintQuotesLabel}</Text>
          {(showAllQuotes ? likedCards : likedCards.slice(0, LIKED_QUOTES_COLLAPSED_COUNT)).map((card) => (
            <View key={card.cardKey} style={styles.quoteRow}>
              <View style={styles.quoteTextWrap}>
                <Text style={styles.quoteBody}>“{card.body}”</Text>
                {hasAttributionLine(card.attribution) && (
                  <Text style={styles.quoteAuthor}>— {card.attribution}</Text>
                )}
              </View>
              <TouchableOpacity
                style={styles.quoteRemove}
                onPress={() => handleUnlike(card.cardKey)}
                accessibilityLabel={`${STRINGS.blueprintQuotesRemove} “${card.body}”`}
              >
                <Text style={styles.quoteRemoveText}>{STRINGS.blueprintQuotesRemove}</Text>
              </TouchableOpacity>
            </View>
          ))}
          {!showAllQuotes && likedCards.length > LIKED_QUOTES_COLLAPSED_COUNT && (
            <TouchableOpacity style={styles.quotesSeeAll} onPress={() => setShowAllQuotes(true)}>
              <Text style={styles.quotesSeeAllText}>{STRINGS.blueprintQuotesSeeAll(likedCards.length)}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* MN2 — the way into "how you work". Always present, including on
          the empty map: the manual explains itself when empty, and hiding
          the door until there is content would mean nobody finds it in the
          weeks it is quietly filling up. Quiet ink link, the same family as
          the map's other navigation. */}
      <TouchableOpacity
        style={styles.manualLink}
        onPress={() => router.push('/how-you-work')}
      >
        <Text style={styles.manualLinkText}>{STRINGS.manualLinkLabel} →</Text>
      </TouchableOpacity>

      {patterns.length > 0 && <AskRallyInviteCard lead={STRINGS.blueprintAskLead} chips={askChips} />}

      {patterns.length > 0 && <Text style={styles.footer}>{STRINGS.blueprintFooter}</Text>}

      {/* SK1 job 4 — the way back in, on the page itself. */}
      {showReflectionsToggle && (
        <ReflectionsToggleRow
          value={!reflectionsOff}
          onToggle={handleToggleReflections}
          disabled={isTogglingReflections}
        />
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
  },
  content: {
    padding: 20,
    // TB3: the pill clearance is inset-aware, applied inline at the
    // ScrollView via useTabBarClearance().
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 24,
    color: colors.ink,
    marginBottom: 4,
  },
  lock: {
    alignSelf: 'flex-start',
    backgroundColor: colors.greenSoft,
    borderRadius: 99,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  lockText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.greenText,
  },
  subtitle: {
    fontSize: 12.5,
    color: colors.mutedStrong,
    marginBottom: 18,
  },
  traitsSection: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    ...cardShadow,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.mutedStrong,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 10,
  },
  traitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  traitLabel: {
    fontSize: 13,
    color: colors.ink,
    flex: 1,
    marginRight: 8,
  },
  traitWord: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.plum,
    fontStyle: 'italic',
  },
  wantCard: {
    borderColor: colors.plum,
  },
  actButton: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  actButtonText: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 13,
  },
  evolutionSection: {
    marginBottom: 16,
  },
  evolutionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    gap: 10,
  },
  evolutionStatement: {
    fontSize: 12,
    color: colors.mutedStrong,
    flex: 1,
  },
  evolutionTag: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.plum,
    textTransform: 'uppercase',
  },
  evolutionTagRetired: {
    color: colors.mutedStrong,
  },
  errorText: {
    fontSize: 13,
    color: colors.errorRed,
    marginBottom: 12,
  },
  // PM2 — quotes you love: mirrors the evolution section's quiet list
  // treatment (no card surface) so the plum pattern cards keep primacy.
  quotesSection: {
    marginBottom: 16,
  },
  quoteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    gap: 10,
  },
  quoteTextWrap: {
    flex: 1,
  },
  quoteBody: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 13,
    lineHeight: 18,
    color: colors.mutedStrong,
  },
  quoteAuthor: {
    fontSize: 10.5,
    color: colors.mutedStrong,
    marginTop: 2,
  },
  quoteRemove: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  quoteRemoveText: {
    fontSize: 10.5,
    fontWeight: '600',
    color: colors.mutedStrong,
  },
  quotesSeeAll: {
    minHeight: 44,
    justifyContent: 'center',
  },
  quotesSeeAllText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.plum,
  },
  // MN2 — the door into the manual. Plum, because it leads to inner-life
  // content, and quiet enough not to compete with the map's one decision
  // moment (the Sounds right / Not quite row).
  manualLink: {
    minHeight: 44,
    justifyContent: 'center',
    marginBottom: 8,
  },
  manualLinkText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.plum,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 24,
    marginBottom: 24,
  },
  // SK1 — the reflections-off state: ghost cards, then ONE true line.
  dormantState: {
    paddingTop: 4,
    marginBottom: 24,
  },
  dormantLine: {
    fontSize: 13.5,
    lineHeight: scaledLineHeight(21),
    color: colors.mutedStrong,
    textAlign: 'center',
    marginTop: 20,
    paddingHorizontal: 8,
  },
  emptyStateImage: {
    width: 100,
    height: 145,
    marginBottom: 14,
  },
  emptyStateText: {
    fontSize: 13,
    color: colors.mutedStrong,
    textAlign: 'center',
  },
  patternCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.plum,
    padding: 18,
    marginBottom: 16,
    ...cardShadow,
  },
  patternCardConfirmed: {
    opacity: 0.75,
  },
  patternLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.plum,
    marginBottom: 8,
  },
  patternHeadline: {
    fontFamily: FONT_HEADER,
    fontSize: 18,
    color: colors.ink,
    lineHeight: 24,
  },
  patternAccent: {
    fontFamily: FONT_SERIF_ITALIC,
    color: colors.plum,
    fontSize: 21,
  },
  patternMeta: {
    fontSize: 11,
    color: colors.mutedStrong,
    marginTop: 10,
    lineHeight: 16,
  },
  // MN3 — the contrast card's two lanes. Deliberately quiet: the same
  // small-caps lane label the manual uses, muted rather than plum, so
  // neither half is styled as the important one. The card's plum border
  // (patternCard, shared) is what marks it as inner-life content.
  contrastLaneLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.mutedStrong,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  contrastLaneLabelSecond: {
    marginTop: 18,
  },
  // The person's own words get the serif, the same treatment the map gives
  // a quote elsewhere: it is the one thing on this card nobody wrote but them.
  contrastQuote: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 18,
    lineHeight: scaledLineHeight(24),
    color: colors.ink,
  },
  contrastDate: {
    fontSize: 10.5,
    color: colors.mutedStrong,
    marginTop: 3,
  },
  contrastObserved: {
    fontSize: 14.5,
    lineHeight: scaledLineHeight(20),
    color: colors.ink,
  },
  contrastEvidenceToggle: {
    minHeight: 44,
    justifyContent: 'center',
  },
  contrastEvidenceToggleText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.plum,
  },
  contrastEvidence: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 4,
  },
  responseRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  soundsRight: {
    flex: 1,
    backgroundColor: colors.plumSoft,
    borderWidth: 1.5,
    borderColor: colors.plum,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  soundsRightText: {
    color: colors.plum,
    fontWeight: '700',
    fontSize: 12.5,
  },
  notQuite: {
    flex: 1,
    backgroundColor: colors.plumSoft,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  notQuiteText: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 12.5,
  },
  respondedText: {
    fontSize: 12,
    color: colors.mutedStrong,
    marginTop: 16,
    fontWeight: '600',
  },
  askRallyAboutLink: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.plum,
    marginTop: 12,
  },
  // PM1 — the invite card's own pieces. Chips are deliberately quieter
  // than the active pattern card's Sounds right / Not quite row (no plum
  // border, lighter weight): the map's one decision moment keeps primacy.
  askLead: {
    fontFamily: FONT_HEADER,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 4,
  },
  askChip: {
    backgroundColor: colors.plumSoft,
    borderRadius: 12,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginTop: 8,
  },
  askChipText: {
    color: colors.plum,
    fontWeight: '600',
    fontSize: 13,
  },
  // PM1C — the personal chip's featured treatment on the map card: the
  // base chips are already plum-tinted here, so featured = a quiet plum
  // outline plus the green transparency label.
  askChipFeatured: {
    borderWidth: 1.5,
    borderColor: colors.plum,
  },
  askChipFeaturedLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.greenText,
    marginBottom: 2,
  },
  noteWrap: {
    marginTop: 16,
  },
  noteInputWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
  },
  noteInput: {
    flex: 1,
    padding: 12,
    fontSize: 13.5,
    color: colors.ink,
    minHeight: 44,
  },
  noteMicButton: {
    paddingRight: 10,
    paddingBottom: 10,
  },
  noteActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 18,
    marginTop: 10,
  },
  noteSkipText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.mutedStrong,
  },
  noteSaveButton: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 18,
  },
  noteSaveText: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 12.5,
  },
  footer: {
    fontSize: 10.5,
    color: colors.mutedStrong,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 8,
  },
});

// NR1 Job 1c — this tab renders behind its own error boundary so a
// crash here can't take the floating tab bar (and the other tabs) down.
export default withErrorBoundary(Blueprint, 'tab:private-map');

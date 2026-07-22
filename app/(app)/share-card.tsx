import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { AppHeader } from '@/components/AppHeader';
import { MessageDialog } from '@/components/MessageDialog';
import { ShareCardView } from '@/components/ShareCardView';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { SHARE_CARD_FX } from '@/lib/motion';
import { WeekDay } from '@/lib/glow';
import { captureShareCard, saveCardImage, shareCardImage } from '@/lib/shareCardExport';
import { isShareCardFlavor, recordCardEvent, ShareCardFlavor } from '@/lib/shareCards';
import { dotStripLine } from '@/lib/shareCardTemplates';

/**
 * SC1 (13 July) — the card slot's full-screen view (spec §3). Reached
 * only from checkin-complete.tsx's own composition check — never a
 * standalone route a user navigates to directly. Screen chrome (the
 * Like/Share row, the dismiss affordances, SC2's name toggle) is never
 * part of the captured PNG; only <ShareCardView> itself gets captured.
 *
 * Event taxonomy note: 'shown' fires on mount here; 'opened' is a
 * defined-but-unused enum value in this v1 build, reserved for a future
 * surface with a collapsed preview state (this flavor goes straight to
 * full-screen, so there's no separate "opened" transition to record).
 * The small "×" (top-right) is the neutral one-tap skip from the
 * original slot spec — records 'dismissed', no rotation-weight effect.
 * "Not for me" is the 13 July card-level resonance signal — records
 * 'passed', which DOES nudge this card's future weight down slightly
 * (spec §3 Rotation) — a different, slightly stronger signal than the
 * neutral skip, even though both simply leave the screen.
 *
 * SC1B/SC1C (15 July, Cat's rulings): the action row is Like · Share,
 * one row directly under the white card at the SC1C (×0.7-from-SC1B)
 * sizing, "Not for me" quiet beneath it; the 9:16 capture field renders
 * once more off-screen and is what Share/Save snapshot. Save lost
 * nothing: Share's own web path falls back to the image download.
 *
 * SC2 (18 July) — the two new flavors ride the same screen. A `flavor`
 * param picks the rendering and stamps every card_event; warm_journey
 * arrives with its body already slot-filled by checkin-complete plus a
 * dayNumber for the big header; dot_strip arrives as data (the week
 * JSON + weekNumber + practiceName) and composes its line HERE because
 * of the name toggle — Cat's 17 July ruling on spec §9 Q3: the practice
 * name is on the card by default, with a one-tap toggle to the generic
 * "daily practice" right in the share preview, so consent happens in
 * the moment, before anything leaves the app. The toggle drives both
 * the on-screen card and the capture variant (same props), so the
 * exported PNG always matches the preview.
 */
export default function ShareCard() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    flavor?: string;
    cardKey: string;
    body: string;
    attribution?: string;
    gloss?: string;
    dayNumber?: string;
    week?: string;
    weekNumber?: string;
    practiceName?: string;
  }>();
  const cardRef = useRef<View>(null);

  const flavor: ShareCardFlavor = isShareCardFlavor(params.flavor) ? params.flavor : 'curated_quote';
  const { cardKey } = params;

  const [liked, setLiked] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // OD1 Job 8d/8e — the card has been engaged (liked, shared, or saved).
  // Right now the heart fills and nothing else moves, which is why the tap
  // read as a no-op; once engaged, the forward close carries a little more
  // weight so the moment lands somewhere.
  const [resolved, setResolved] = useState(false);
  const reduceMotion = useReducedMotion();
  const heartScale = useSharedValue(1);
  const closeScale = useSharedValue(1);
  // SC2 — the dot-strip name consent (default ON per Cat's ruling); only
  // meaningful when a practice name exists at all.
  const [showPracticeName, setShowPracticeName] = useState(true);

  const attributionValue = params.attribution || null;
  const glossValue = params.gloss || null;
  const dayNumberValue = params.dayNumber ? Number(params.dayNumber) : null;
  const practiceName = params.practiceName || null;

  const week = useMemo<WeekDay[] | null>(() => {
    if (flavor !== 'dot_strip' || !params.week) return null;
    try {
      const parsed = JSON.parse(params.week) as WeekDay[];
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
    } catch {
      return null;
    }
  }, [flavor, params.week]);
  const weekNumberValue = params.weekNumber ? Number(params.weekNumber) : null;

  // The card body: quotes and journey lines arrive final; the dot strip
  // composes under the toggle.
  const body =
    flavor === 'dot_strip' && weekNumberValue
      ? dotStripLine(weekNumberValue, showPracticeName ? practiceName : null)
      : params.body;

  useEffect(() => {
    if (!cardKey) return;
    recordCardEvent(flavor, cardKey, 'shown').catch(() => {
      // Best-effort — a missed 'shown' event only affects future tuning
      // data, never the card itself, which is already on screen.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey]);

  const goToToday = () => router.replace('/today');

  // OD1 Job 8a/8b — the ONE neutral way off this screen: it records
  // 'dismissed' (never 'passed', so it never quietly degrades this card's
  // future weight) and returns to Today. Shared by the ✕ (Job 8b, kept)
  // and the big "see you tomorrow" close (Job 8a).
  const dismissToToday = () => {
    if (cardKey) recordCardEvent(flavor, cardKey, 'dismissed').catch(() => {});
    goToToday();
  };

  const handleNotForMe = () => {
    if (cardKey) recordCardEvent(flavor, cardKey, 'passed').catch(() => {});
    goToToday();
  };

  const handleLike = () => {
    if (liked || !cardKey) return;
    setLiked(true);
    setResolved(true);
    // OD1 Job 8d — a quiet confirmation the tap landed (P1/FL1 register:
    // one small pop, no confetti). Reduced motion just gets the fill.
    if (!reduceMotion) {
      heartScale.value = withSequence(
        withTiming(SHARE_CARD_FX.HEART_POP_SCALE, { duration: SHARE_CARD_FX.HEART_POP_UP_MS }),
        withTiming(1, { duration: SHARE_CARD_FX.HEART_POP_DOWN_MS })
      );
    }
    recordCardEvent(flavor, cardKey, 'liked').catch(() => {});
  };

  const handleShare = async () => {
    if (!cardKey) return;
    setIsSharing(true);
    try {
      const uri = await captureShareCard(cardRef);
      const shared = await shareCardImage(uri);
      if (shared) {
        recordCardEvent(flavor, cardKey, 'shared').catch(() => {});
      } else {
        await saveCardImage(uri);
        recordCardEvent(flavor, cardKey, 'saved').catch(() => {});
      }
      // OD1 Job 8e — a successful share (or save fallback) lands: the
      // forward close gains its weight, so a person who's just shared is
      // pointed home instead of left on the card.
      setResolved(true);
    } catch {
      setError(STRINGS.shareCardShareError);
    } finally {
      setIsSharing(false);
    }
  };

  // OD1 Job 8d/8e — once the card has been engaged, the close gets one
  // gentle pop so the eye lands on the way home. One shot, reduced-motion
  // exempt; the pop fires the first time `resolved` flips true.
  useEffect(() => {
    if (!resolved || reduceMotion) return;
    closeScale.value = withSequence(
      withTiming(SHARE_CARD_FX.CLOSE_POP_SCALE, { duration: SHARE_CARD_FX.CLOSE_POP_UP_MS }),
      withTiming(1, { duration: SHARE_CARD_FX.CLOSE_POP_DOWN_MS })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heartScale.value }] }));
  const closeStyle = useAnimatedStyle(() => ({ transform: [{ scale: closeScale.value }] }));

  const paramsValid =
    flavor === 'dot_strip' ? !!cardKey && !!week && !!weekNumberValue : !!cardKey && !!body;
  if (!paramsValid) {
    // Reached without valid params somehow (stale link, direct nav) —
    // NAV1: go home quietly instead of stranding a cold-loaded URL on
    // an eternal spinner.
    return <Redirect href="/today" />;
  }

  const cardProps = {
    body,
    attribution: attributionValue,
    gloss: glossValue,
    flavor,
    dayNumber: dayNumberValue,
    week,
  };

  return (
    <View style={styles.container}>
      {/* NAV1: standard-screen chrome. The house is the plain way home;
          the ✕ below keeps its distinct meaning (skip this card —
          records 'dismissed'), moved in-flow so it doesn't collide with
          the header icons. */}
      <AppHeader style={styles.header} />

      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.skipButton} onPress={dismissToToday} hitSlop={8}>
          <Text style={styles.skipButtonText}>✕</Text>
        </TouchableOpacity>

        <ShareCardView {...cardProps} />

        {flavor === 'dot_strip' && practiceName && (
          <TouchableOpacity style={styles.nameToggle} onPress={() => setShowPracticeName((v) => !v)}>
            <Text style={styles.nameToggleText}>
              {showPracticeName ? STRINGS.shareCardHidePracticeName : STRINGS.shareCardShowPracticeName}
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.reactionRow}>
          <TouchableOpacity style={styles.reactionButton} onPress={handleLike} disabled={liked}>
            <Animated.Text style={[styles.heartIcon, liked && styles.heartIconLiked, heartStyle]}>
              {liked ? '♥' : '♡'}
            </Animated.Text>
            <Text style={[styles.reactionText, liked && styles.reactionTextLiked]}>{STRINGS.shareCardLikeCta}</Text>
          </TouchableOpacity>
          <View style={styles.dividerDot} />
          <TouchableOpacity style={styles.reactionButton} onPress={handleShare} disabled={isSharing}>
            <Text style={styles.reactionText}>{isSharing ? '…' : STRINGS.shareCardShareCta}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.notForMeButton} onPress={handleNotForMe}>
          <Text style={styles.notForMeText}>{STRINGS.shareCardNotForMeCta}</Text>
        </TouchableOpacity>

        {/* OD1 Job 8a — the closing ritual: a big, warm, obvious exit in
            the empty lower half. It records 'dismissed' (the neutral
            event) and returns to Today, actively closing out the practice
            instead of leaving the person hunting for the ✕. Job 9 gates
            the card so the day is genuinely done before this appears,
            which is what makes "see you tomorrow" true. */}
        <Animated.View style={[styles.closeButtonWrap, closeStyle]}>
          <TouchableOpacity style={styles.closeButton} onPress={dismissToToday}>
            <Text style={styles.closeButtonText}>{STRINGS.shareCardCloseCta}</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>

      <View
        style={styles.captureClip}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={styles.captureSizer}>
          <ShareCardView ref={cardRef} capture {...cardProps} />
        </View>
      </View>

      <MessageDialog visible={!!error} title="hmm" variant="error" message={error ?? ''} onDismiss={() => setError(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: 24,
  },
  content: {
    padding: 24,
    paddingTop: 0,
    paddingBottom: 24,
    alignItems: 'center',
    // OD1 Job 8a — fill the viewport so the closing button can sit in the
    // lower half (marginTop:auto on it) rather than floating just under
    // the card. On a short screen this collapses and the screen scrolls.
    flexGrow: 1,
  },
  skipButton: {
    alignSelf: 'flex-end',
    padding: 8,
    marginBottom: 4,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // SC2 — the dot strip's name toggle: quiet text chrome directly under
  // the card, same subordinate register as "Not for me", never captured.
  nameToggle: {
    marginTop: 8,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    minHeight: 44,
  },
  nameToggleText: {
    fontSize: 11.5,
    color: colors.muted,
    textDecorationLine: 'underline',
  },
  skipButtonText: {
    fontSize: 18,
    color: colors.muted,
  },
  // SC1C: Like · Share shrink 30% from the SC1B size — text, icon and
  // padding all ×0.7 (text 18.75→13.125, heart 25.5→17.85, padding
  // 9/6→6.3/4.2). Net vs the SC1 original is ~+5%. minHeight keeps the
  // tap targets ≥44px even though the type shrank.
  reactionRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  reactionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6.3,
    paddingVertical: 6.3,
    paddingHorizontal: 4.2,
    minHeight: 44,
  },
  heartIcon: {
    fontSize: 17.85,
    color: colors.muted,
  },
  heartIconLiked: {
    color: colors.heart,
  },
  reactionText: {
    fontSize: 13.125,
    color: colors.muted,
  },
  reactionTextLiked: {
    color: colors.ink,
    fontWeight: '600',
  },
  dividerDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.line,
  },
  // SC1C (c): "Not for me" is now a quiet text link UNDER the row, small
  // and muted so it never reads as a third button. Padding + minHeight
  // carry the ≥44px tap target while the type stays subordinate.
  notForMeButton: {
    marginTop: 4,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    minHeight: 44,
  },
  notForMeText: {
    fontSize: 11.5,
    color: colors.muted,
  },
  // OD1 Job 8a — the closing button's wrapper: marginTop:auto drops it to
  // the lower half of the (flexGrow:1) content; paddingTop guarantees real
  // separation from "Not for me" even on a short screen where auto
  // collapses. Full width so it reads as the clear primary way home.
  closeButtonWrap: {
    width: '100%',
    marginTop: 'auto',
    paddingTop: 40,
  },
  closeButton: {
    width: '100%',
    backgroundColor: colors.gold,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  closeButtonText: {
    fontWeight: '700',
    fontSize: 15,
    color: colors.ink,
  },
  // The 9:16 story-format capture source (what Share/Save snapshot),
  // hidden inside a 0×0 clip at normal page coordinates. It must NOT be
  // parked off-screen (left: -10000): html2canvas — view-shot's web
  // backend — crops from the element's page position, so negative
  // coordinates break the web capture, while a clipped ancestor doesn't
  // (both html2canvas and native snapshotting render the target view
  // itself, ignoring ancestor clipping). Fixed 360×640 keeps the PNG
  // layout deterministic across devices and upscales cleanly to
  // 1080×1920.
  captureClip: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    overflow: 'hidden',
  },
  captureSizer: {
    width: 360,
  },
});

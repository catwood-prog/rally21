import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { MessageDialog } from '@/components/MessageDialog';
import { ShareCardView } from '@/components/ShareCardView';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { captureShareCard, saveCardImage, shareCardImage } from '@/lib/shareCardExport';
import { recordCardEvent } from '@/lib/shareCards';

/**
 * SC1 (13 July) — the card slot's full-screen view (spec §3). Reached
 * only from checkin-complete.tsx's own composition check — never a
 * standalone route a user navigates to directly. Screen chrome (the
 * Like/Share row, Save, mute, the two dismiss affordances) is never
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
 * SC1B (15 July, Cat's ruling from the live screenshot): the feedback
 * row is Like · Share · Not for me, ONE row, directly under the white
 * card, every control 50% larger than the SC1 sizing. The visible card
 * is ShareCardView's screen rendering (card only); the 9:16 capture
 * field renders once more off-screen and is what Share/Save snapshot —
 * so the PNG keeps its story format while the screen hugs the card.
 *
 * SC1C (15 July, Cat's ruling from seeing SC1B rendered): rev 2 of the
 * action row. (a) Like and Share shrink 30% from the SC1B size (×0.7 on
 * text/icon/padding — net ~+5% vs the SC1 original). (b) The main row is
 * Like · Share ONLY. (c) "Not for me" drops beneath it as small, quiet,
 * centered text — same 'passed' behavior (card-level resonance, weight
 * nudge — spec §3), just no longer a peer button. (d) The old secondary
 * "Save · Not my kind of thing" row is GONE. Save lost nothing: Share's
 * own web path already falls back to the image download when no share
 * sheet exists, and native Share offers Save Image — so there was no
 * export capability only Save provided. The flavor-mute pref infra and
 * its settings re-enable list stay; only this on-card mute entry point
 * is removed (see the SC1C commit note: it was the sole mute-ON path).
 */
export default function ShareCard() {
  const router = useRouter();
  const { cardKey, body, attribution, gloss } = useLocalSearchParams<{
    cardKey: string;
    body: string;
    attribution?: string;
    gloss?: string;
  }>();
  const cardRef = useRef<View>(null);

  const [liked, setLiked] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attributionValue = attribution || null;
  const glossValue = gloss || null;

  useEffect(() => {
    if (!cardKey) return;
    recordCardEvent('curated_quote', cardKey, 'shown').catch(() => {
      // Best-effort — a missed 'shown' event only affects future tuning
      // data, never the card itself, which is already on screen.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey]);

  const goToToday = () => router.replace('/today');

  const handleSkip = () => {
    if (cardKey) recordCardEvent('curated_quote', cardKey, 'dismissed').catch(() => {});
    goToToday();
  };

  const handleNotForMe = () => {
    if (cardKey) recordCardEvent('curated_quote', cardKey, 'passed').catch(() => {});
    goToToday();
  };

  const handleLike = () => {
    if (liked || !cardKey) return;
    setLiked(true);
    recordCardEvent('curated_quote', cardKey, 'liked').catch(() => {});
  };

  const handleShare = async () => {
    if (!cardKey) return;
    setIsSharing(true);
    try {
      const uri = await captureShareCard(cardRef);
      const shared = await shareCardImage(uri);
      if (shared) {
        recordCardEvent('curated_quote', cardKey, 'shared').catch(() => {});
      } else {
        await saveCardImage(uri);
        recordCardEvent('curated_quote', cardKey, 'saved').catch(() => {});
      }
    } catch {
      setError(STRINGS.shareCardShareError);
    } finally {
      setIsSharing(false);
    }
  };

  if (!cardKey || !body) {
    // Reached without valid params somehow (stale link, direct nav) —
    // fail quiet, not broken.
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.skipButton} onPress={handleSkip} hitSlop={8}>
        <Text style={styles.skipButtonText}>✕</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.content}>
        <ShareCardView body={body} attribution={attributionValue} gloss={glossValue} />

        <View style={styles.reactionRow}>
          <TouchableOpacity style={styles.reactionButton} onPress={handleLike} disabled={liked}>
            <Text style={[styles.heartIcon, liked && styles.heartIconLiked]}>{liked ? '♥' : '♡'}</Text>
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
      </ScrollView>

      <View
        style={styles.captureClip}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={styles.captureSizer}>
          <ShareCardView ref={cardRef} capture body={body} attribution={attributionValue} gloss={glossValue} />
        </View>
      </View>

      <MessageDialog visible={!!error} title="hmm" message={error ?? ''} onDismiss={() => setError(null)} />
    </View>
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
    padding: 24,
    paddingTop: 56,
    paddingBottom: 24,
    alignItems: 'center',
  },
  skipButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 1,
    padding: 8,
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

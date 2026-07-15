import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { MessageDialog } from '@/components/MessageDialog';
import { ShareCardView } from '@/components/ShareCardView';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { captureShareCard, saveCardImage, shareCardImage } from '@/lib/shareCardExport';
import { recordCardEvent, setCardFlavorMuted } from '@/lib/shareCards';

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
 * "Not for me" at the bottom is the 13 July card-level resonance signal
 * — records 'passed', which DOES nudge this card's future weight down
 * slightly (spec §3 Rotation) — a different, slightly stronger signal
 * than the neutral skip, even though both simply leave the screen.
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
  const [isSaving, setIsSaving] = useState(false);
  const [showMuteConfirm, setShowMuteConfirm] = useState(false);
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

  const handleSave = async () => {
    if (!cardKey) return;
    setIsSaving(true);
    try {
      const uri = await captureShareCard(cardRef);
      await saveCardImage(uri);
      recordCardEvent('curated_quote', cardKey, 'saved').catch(() => {});
    } catch {
      setError(STRINGS.shareCardShareError);
    } finally {
      setIsSaving(false);
    }
  };

  const handleMute = async () => {
    if (cardKey) recordCardEvent('curated_quote', cardKey, 'muted').catch(() => {});
    try {
      await setCardFlavorMuted('curated_quote', true);
    } catch {
      // The mute pref failing to save silently isn't worth blocking the
      // dismiss over — this is a low-stakes, easily-retried preference.
    }
    setShowMuteConfirm(true);
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
        <ShareCardView ref={cardRef} body={body} attribution={attributionValue} gloss={glossValue} />

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

        <View style={styles.secondaryRow}>
          <TouchableOpacity onPress={handleSave} disabled={isSaving}>
            <Text style={styles.secondaryText}>{isSaving ? '…' : STRINGS.shareCardSaveCta}</Text>
          </TouchableOpacity>
          <Text style={styles.secondaryDot}>·</Text>
          <TouchableOpacity onPress={handleMute}>
            <Text style={styles.secondaryText}>{STRINGS.shareCardMuteCta}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <TouchableOpacity style={styles.notForMe} onPress={handleNotForMe}>
        <Text style={styles.notForMeText}>{STRINGS.shareCardNotForMeCta}</Text>
      </TouchableOpacity>

      <MessageDialog
        visible={showMuteConfirm}
        title={STRINGS.shareCardMuteConfirmTitle}
        message={STRINGS.shareCardMuteConfirmBody}
        onDismiss={goToToday}
      />
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
    paddingBottom: 8,
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
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  heartIcon: {
    fontSize: 17,
    color: colors.muted,
  },
  heartIconLiked: {
    color: colors.heart,
  },
  reactionText: {
    fontSize: 12.5,
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
  secondaryRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  secondaryText: {
    fontSize: 11.5,
    color: colors.muted,
  },
  secondaryDot: {
    fontSize: 11.5,
    color: colors.muted,
  },
  notForMe: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  notForMeText: {
    fontSize: 11.5,
    color: colors.muted,
  },
});

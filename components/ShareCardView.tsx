import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Brandmark } from '@/components/Brandmark';
import { hasAttributionLine } from '@/lib/shareCards';
import { FONT_SERIF_ITALIC } from '@/constants/fonts';
import { cardShadow, colors } from '@/constants/theme';

/**
 * The one recognizable card shape (spec §5) — wordmark → quote (hero,
 * serif italic) → author (small caps, muted, only when traceable) →
 * plum accent rule → gloss (only when the bank entry has one). No
 * screen chrome (Like/Share/"Not for me") may ever live inside this
 * component; those render around it in app/(app)/share-card.tsx.
 *
 * Two renderings of the same card (SC1B, 15 July):
 * - default (screen): just the white card, hugging its content, so the
 *   feedback row can sit directly beneath it on /share-card.
 * - `capture`: the card centered in the full 9:16 story-format field —
 *   exactly what gets rendered to the shared/saved PNG. The field used
 *   to be the on-screen rendering too, but its empty lower half (field
 *   bg = screen bg) pushed the feedback row to the viewport bottom.
 *
 * Reuses the existing `Brandmark` component as the card's brand mark
 * rather than building a separate `CardBrandFooter` — the spec's 13 July
 * revision (no penguin icon, wordmark only) made the two functionally
 * identical, and Brandmark is already this project's one canonical,
 * tokenized place to change the name (CLAUDE.md convention).
 */
export const ShareCardView = forwardRef<
  View,
  { body: string; attribution: string | null; gloss: string | null; capture?: boolean }
>(function ShareCardView({ body, attribution, gloss, capture = false }, ref) {
  const card = (
    <View style={[styles.card, cardShadow]}>
      <Brandmark size={18} style={styles.brandmark} />
      <Text style={styles.hero}>&ldquo;{body}&rdquo;</Text>
      {hasAttributionLine(attribution) && <Text style={styles.attribution}>{attribution}</Text>}
      <View style={styles.accentRule} />
      {gloss && <Text style={styles.gloss}>{gloss}</Text>}
    </View>
  );

  return (
    <View ref={ref} style={capture ? styles.field : styles.screen} collapsable={false}>
      {card}
    </View>
  );
});

const styles = StyleSheet.create({
  field: {
    width: '100%',
    aspectRatio: 1080 / 1920,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6%',
  },
  screen: {
    width: '100%',
    alignItems: 'center',
  },
  card: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingVertical: 28,
    paddingHorizontal: 22,
    alignItems: 'center',
    gap: 14,
  },
  brandmark: {
    marginBottom: 2,
  },
  hero: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 19,
    lineHeight: 27,
    color: colors.ink,
    textAlign: 'center',
  },
  attribution: {
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
    textAlign: 'center',
  },
  accentRule: {
    width: 28,
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.plum,
  },
  gloss: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    textAlign: 'center',
  },
});

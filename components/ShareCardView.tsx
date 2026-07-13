import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Brandmark } from '@/components/Brandmark';
import { hasAttributionLine } from '@/lib/shareCards';
import { FONT_SERIF_ITALIC } from '@/constants/fonts';
import { cardShadow, colors } from '@/constants/theme';

/**
 * The one recognizable card shape (spec §5) — wordmark → quote (hero,
 * serif italic) → author (small caps, muted, only when traceable) →
 * plum accent rule → gloss (only when the bank entry has one). This is
 * exactly what gets captured to PNG — no screen chrome (Like/Share/"Not
 * for me") may ever live inside this component; those render around it
 * in app/(app)/share-card.tsx.
 *
 * Reuses the existing `Brandmark` component as the card's brand mark
 * rather than building a separate `CardBrandFooter` — the spec's 13 July
 * revision (no penguin icon, wordmark only) made the two functionally
 * identical, and Brandmark is already this project's one canonical,
 * tokenized place to change the name (CLAUDE.md convention).
 */
export const ShareCardView = forwardRef<View, { body: string; attribution: string | null; gloss: string | null }>(
  function ShareCardView({ body, attribution, gloss }, ref) {
    return (
      <View ref={ref} style={styles.field} collapsable={false}>
        <View style={[styles.card, cardShadow]}>
          <Brandmark size={18} style={styles.brandmark} />
          <Text style={styles.hero}>&ldquo;{body}&rdquo;</Text>
          {hasAttributionLine(attribution) && <Text style={styles.attribution}>{attribution}</Text>}
          <View style={styles.accentRule} />
          {gloss && <Text style={styles.gloss}>{gloss}</Text>}
        </View>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  field: {
    width: '100%',
    aspectRatio: 1080 / 1920,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6%',
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

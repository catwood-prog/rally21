import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Brandmark } from '@/components/Brandmark';
import { hasAttributionLine, ShareCardFlavor } from '@/lib/shareCards';
import { WeekDay } from '@/lib/glow';
import { STRINGS } from '@/constants/strings';
import { FONT_SERIF_ITALIC } from '@/constants/fonts';
import { cardShadow, colors } from '@/constants/theme';

/**
 * The one recognizable card shape (spec §5), now three flavors (SC2):
 * - curated_quote (SC1): wordmark → quote (hero, serif italic) → author
 *   (small caps, muted, only when traceable) → PLUM accent rule → gloss.
 * - warm_journey (§4.2): wordmark → big day number + DAYS kicker → the
 *   filled template line (hero, no quotation marks — it's Rally's own
 *   voice, not a quotation) → GOLD accent rule.
 * - dot_strip (§4.3): wordmark → THIS WEEK kicker → the 7-day strip →
 *   the week line → GOLD accent rule. The strip mirrors the in-app week
 *   row (glow-beat's, post-AC1) exactly: earned = gold ✓ on goldSoft,
 *   held = 🧡, missed = the quiet neutral dot — never red, and never
 *   green (spec §5: green stays in-app; gold is the journey/dot-strip
 *   accent). Its geometry never varies — it's the recognizable-shape
 *   carrier.
 * No screen chrome (Like/Share/"Not for me"/the SC2 name toggle) may
 * ever live inside this component; those render around it in
 * app/(app)/share-card.tsx.
 *
 * Two renderings of the same card (SC1B, 15 July):
 * - default (screen): just the white card, hugging its content, so the
 *   feedback row can sit directly beneath it on /share-card.
 * - `capture`: the card centered in the full 9:16 story-format field —
 *   exactly what gets rendered to the shared/saved PNG.
 *
 * Reuses the existing `Brandmark` component as the card's brand mark
 * rather than building a separate `CardBrandFooter` — the spec's 13 July
 * revision (no penguin icon, wordmark only) made the two functionally
 * identical, and Brandmark is already this project's one canonical,
 * tokenized place to change the name (CLAUDE.md convention).
 */
export const ShareCardView = forwardRef<
  View,
  {
    body: string;
    attribution: string | null;
    gloss: string | null;
    flavor?: ShareCardFlavor;
    /** warm_journey only — the circle's journey day for the big header. */
    dayNumber?: number | null;
    /** dot_strip only — the real week row (getMyWeek shape, today last). */
    week?: WeekDay[] | null;
    capture?: boolean;
  }
>(function ShareCardView(
  { body, attribution, gloss, flavor = 'curated_quote', dayNumber = null, week = null, capture = false },
  ref
) {
  const card =
    flavor === 'warm_journey' ? (
      <View style={[styles.card, cardShadow]}>
        <Brandmark size={18} style={styles.brandmark} />
        {dayNumber !== null && (
          <View style={styles.dayHeader}>
            <Text style={styles.dayBig}>{dayNumber}</Text>
            <Text style={styles.kicker}>{STRINGS.shareCardJourneyDayKicker(dayNumber)}</Text>
          </View>
        )}
        <Text style={styles.hero}>{body}</Text>
        <View style={[styles.accentRule, styles.accentRuleGold]} />
      </View>
    ) : flavor === 'dot_strip' ? (
      <View style={[styles.card, cardShadow]}>
        <Brandmark size={18} style={styles.brandmark} />
        <Text style={styles.kicker}>{STRINGS.shareCardDotStripKicker}</Text>
        <View style={styles.dotRow}>
          {(week ?? []).map((day) => (
            <View key={day.date} style={styles.dotCol}>
              <View
                style={[
                  styles.dotPill,
                  day.state === 'earned'
                    ? styles.dotPillEarned
                    : styles.dotPillQuiet,
                ]}
              >
                {day.state === 'earned' && <Text style={styles.dotEarnedMark}>✓</Text>}
                {day.state === 'held' && <Text style={styles.dotHeldMark}>🧡</Text>}
                {day.state === 'none' && <View style={styles.dotNone} />}
              </View>
              <Text style={styles.dotWeekday}>{weekdayInitial(day.date)}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.weekLine}>{body}</Text>
        <View style={[styles.accentRule, styles.accentRuleGold]} />
      </View>
    ) : (
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

/** Same derivation glow-beat's WeekSlot uses for the in-app strip. */
function weekdayInitial(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'narrow' });
}

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
  // Gold is the journey/dot-strip accent (spec §5) — plum stays the
  // quote flavors' inner-life color.
  accentRuleGold: {
    backgroundColor: colors.gold,
  },
  gloss: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    textAlign: 'center',
  },
  // warm_journey — the mockup's big-day header: the number huge in the
  // serif italic, the DAYS kicker right beneath it, tighter than the
  // card's own 14px gap so they read as one unit.
  dayHeader: {
    alignItems: 'center',
    gap: 2,
  },
  dayBig: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 46,
    lineHeight: 52,
    color: colors.ink,
  },
  kicker: {
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.gold,
    fontWeight: '700',
    textAlign: 'center',
  },
  // dot_strip — pill states mirror glow-beat's WeekSlot exactly.
  dotRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 9,
  },
  dotCol: {
    alignItems: 'center',
    gap: 4,
  },
  dotPill: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotPillEarned: {
    backgroundColor: colors.goldSoft,
    borderWidth: 1.5,
    borderColor: colors.gold,
  },
  dotPillQuiet: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  dotEarnedMark: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.gold,
  },
  dotHeldMark: {
    fontSize: 12,
  },
  dotNone: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.muted,
  },
  dotWeekday: {
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.muted,
  },
  weekLine: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 16,
    lineHeight: 23,
    color: colors.ink,
    textAlign: 'center',
  },
});

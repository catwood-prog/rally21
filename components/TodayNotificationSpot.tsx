import { StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { STRINGS } from '@/constants/strings';
import { colors, scaledLineHeight } from '@/constants/theme';
import { SpotContent } from '@/lib/notificationSpot';

/**
 * TN1 (24 July, mockup APPROVED — Rally21-Today-WelcomeBack-Mockup.html,
 * frames A/B/C) — Today's ONE notification surface: a warm green-tinted
 * card at the top of Today carrying the re-entry moment (frame A) and
 * everyday warmth (frame C). Frame B is the default: `content` is null
 * and this renders nothing at all, so Today is exactly its live layout.
 *
 * Deliberately NOT a badge shape and never a count: warmth or absence
 * (Rally21-Glow-Spec.md §0 — shame costs nothing). Nothing here is red.
 * The whole render decision lives in lib/notificationSpot.ts; this file
 * is only the mockup's visual target.
 *
 * AU1 job 3b (Cat's ruling, 3 Aug — OPTION B, the greenSoft card
 * refined). Four changes, and nothing else moves:
 *
 *  1. The soft green identity stays exactly as it was — same greenSoft
 *     fill, same green outline, same radius. This is a refinement of the
 *     shipped card, not a new one.
 *  2. The headline sits LEFT with the kicker moved to its TOP-RIGHT, so
 *     the first thing read is "your place is still here" rather than a
 *     label above it.
 *  3. Each SENDER gets their own WHITE inner card (radius 12) with their
 *     avatar — their photo, or their penguin, through the one shared
 *     Avatar component (AV1: there is no initials fallback anywhere, and
 *     a photo replaces the penguin everywhere at once). One card per
 *     person is what job 3c's merging exists to guarantee; a line
 *     grouped across senders would leave this slot ownerless.
 *  4. The no-guilt footnote sits below them in mutedStrong.
 *
 * Contrast is measured, not assumed: mutedStrong is 5.65:1 on white and
 * 5.32:1 on greenSoft, both clear of AA; greenDeep carries the kicker
 * because colors.green lands ~2.4:1 on greenSoft (OD1 job 10's rule —
 * green is a FILL colour, never a text colour).
 */
export function TodayNotificationSpot({ content }: { content: SpotContent | null }) {
  if (!content) return null;

  return (
    <View style={styles.card}>
      {/* Headline left, kicker top-right. On an everyday moment there is
          no headline, so the spacer keeps the kicker where it has always
          been — the layout degrades to the shipped one rather than
          leaving a hole where a headline would be. */}
      <View style={styles.topRow}>
        {content.headline ? (
          <Text style={styles.headline}>{content.headline}</Text>
        ) : (
          <View style={styles.headlineSpacer} />
        )}
        <Text style={styles.kicker}>{content.kicker}</Text>
      </View>

      {content.cards.map((card) => (
        <View key={card.key} style={styles.senderCard}>
          {/* userId drives Avatar's deterministic penguin pick. A sender
              the server could not resolve (WL2 deliberately keeps a
              departed member's warmth readable) has no id — the empty
              string still hashes to a stable variant, so they get a
              consistent penguin rather than a blank or an initial. */}
          {/* 34, Cat's refinement on the live render (3 Aug): at 28 the
              face read as a bullet beside a two-line sentence. Still
              below Who's Here's 40 and Today's strip at 42 — this is a
              moment, not the huddle — and the extra 6px is inside the
              row's existing height at 1.35x, so it costs the fold
              nothing (AR3). */}
          <Avatar
            name={card.person.name}
            userId={card.person.id ?? ''}
            avatarUrl={card.person.avatarUrl}
            size={34}
          />
          <Text style={styles.senderText}>{card.text}</Text>
        </View>
      ))}

      {content.overflowCount > 0 ? (
        <Text style={styles.overflowLine}>{STRINGS.todaySpotOverflow(content.overflowCount)}</Text>
      ) : null}
      {content.footnote ? <Text style={styles.footnote}>{content.footnote}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Green: this surface is togetherness/aliveness, never an alert. The
  // 1.5px outline is what lifts it off `bg` without a shadow competing
  // with the practice card below it.
  card: {
    backgroundColor: colors.greenSoft,
    borderWidth: 1.5,
    borderColor: colors.green,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 18,
    gap: 8,
  },
  // Baseline-aligned so the small kicker sits with the headline's first
  // line rather than its centre, and WRAPS rather than squeezing: at
  // 1.35x the headline needs the full width, and wrap-reverse drops the
  // kicker ABOVE it rather than below, which keeps the reading order
  // (label, then headline) the shipped card already had.
  topRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap-reverse',
    columnGap: 10,
    rowGap: 2,
  },
  headline: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '800',
    color: colors.ink,
    lineHeight: scaledLineHeight(20),
  },
  // Holds the kicker to the right on an everyday moment, where there is
  // no headline to push it there.
  headlineSpacer: {
    flexGrow: 1,
  },
  kicker: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    // colors.green fails AA on greenSoft at this size — the palette's
    // deeper green is the readable member of the family.
    color: colors.greenDeep,
  },
  // One per sender. White on greenSoft is what makes each person read as
  // their own moment instead of a bullet in a list.
  senderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  senderText: {
    // Takes the remaining width so a long merged sentence wraps under
    // itself instead of pushing the avatar out of the card.
    flex: 1,
    fontSize: 13,
    color: colors.mutedStrong,
    lineHeight: scaledLineHeight(18),
  },
  // Stays OUTSIDE the white cards: it is not a person, and giving it a
  // card would imply a face it does not have.
  overflowLine: {
    fontSize: 13,
    color: colors.mutedStrong,
    lineHeight: scaledLineHeight(18),
  },
  footnote: {
    fontSize: 11.5,
    color: colors.mutedStrong,
    lineHeight: scaledLineHeight(16),
    marginTop: 2,
  },
});

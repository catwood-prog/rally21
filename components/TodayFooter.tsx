import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { WeekDay } from '@/lib/glow';

/**
 * D6 (7 July) — Today's footer, replacing four bare text links (which
 * read as a footer sitemap) with: a glanceable 7-day dot strip in place
 * of "This week" (reusing G5's get_my_week() data — the same
 * earned/held/none shape already needed there, so no new query), a
 * private-map mini-card (the one remaining door without its own tab),
 * and "something we noticed" shown only when a pattern is actually
 * awaiting a response. "Your journal" is gone — the Journal tab below
 * already owns that door. Used by both today.tsx render paths (single
 * and multi-circle) so the row is never hand-duplicated.
 */
export function TodayFooter({
  week,
  hasSurfacedPattern,
}: {
  week: WeekDay[] | null;
  hasSurfacedPattern: boolean;
}) {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.weekStrip} onPress={() => router.push('/weekly')}>
        {(week ?? []).map((day) => (
          <View
            key={day.date}
            style={[styles.dot, day.state === 'earned' && styles.dotEarned, day.state === 'held' && styles.dotHeld]}
          >
            {day.state === 'earned' && <Text style={styles.dotEarnedMark}>✓</Text>}
            {day.state === 'held' && <Text style={styles.dotHeldMark}>💛</Text>}
          </View>
        ))}
      </TouchableOpacity>

      {hasSurfacedPattern && (
        <TouchableOpacity onPress={() => router.push('/reflection')}>
          <Text style={styles.noticedLink}>{STRINGS.somethingWeNoticedLinkLabel}</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.mapCard} onPress={() => router.push('/private-map')}>
        <Text style={styles.mapCardLabel}>{STRINGS.blueprintLinkLabel}</Text>
        <Text style={styles.mapCardChevron}>›</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
    gap: 12,
    alignItems: 'center',
  },
  weekStrip: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotEarned: {
    backgroundColor: colors.greenSoft,
    borderColor: colors.green,
  },
  dotEarnedMark: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.green,
  },
  // Matches CheckedInBadge's own covered treatment exactly (gold, never
  // a substitute green checkmark — a covered day is a distinct,
  // celebrated state, per CLAUDE.md's cover-a-friend rule).
  dotHeld: {
    backgroundColor: colors.goldSoft,
    borderColor: colors.gold,
  },
  dotHeldMark: {
    fontSize: 10,
  },
  noticedLink: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 14,
    color: colors.plum,
  },
  mapCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    ...cardShadow,
  },
  mapCardLabel: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 14,
    color: colors.plum,
  },
  mapCardChevron: {
    fontSize: 14,
    color: colors.plum,
  },
});

import { withErrorBoundary } from '@/components/ErrorBoundary';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { MASCOT } from '@/assets/mascot';
import { AppHeader } from '@/components/AppHeader';
import { ErrorSlip } from '@/components/ErrorSlip';
import { MascotEntrance } from '@/components/MascotEntrance';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { MOOD_EMOJI } from '@/constants/mood';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useAuth } from '@/lib/auth-context';
import { getLocalDateString } from '@/lib/date';
import { goalsSetLabelForKey } from '@/lib/goalsSet';
import { getMyJournalFacts, JournalFact } from '@/lib/journey';
import { getMyReflections, Reflection } from '@/lib/reflections';

type TimelineEntry =
  | { kind: 'reflection'; localDate: string; reflection: Reflection }
  | { kind: 'fact'; localDate: string; fact: JournalFact };

function dateHeader(localDate: string, today: string): string {
  if (localDate === today) return 'TODAY';
  const yesterday = getLocalDateString(new Date(new Date(today).getTime() - 86400000));
  if (localDate === yesterday) return 'YESTERDAY';
  const [y, m, d] = localDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function Journal() {
  const router = useRouter();
  const { session } = useAuth();
  // TB3 — inset-aware pill clearance.
  const tabBarClearance = useTabBarClearance();
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [facts, setFacts] = useState<JournalFact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);
    try {
      const [myReflections, myFacts] = await Promise.all([
        getMyReflections(session.user.id),
        getMyJournalFacts(session.user.id),
      ]);
      setReflections(myReflections);
      setFacts(myFacts);
    } catch {
      // ER1: the warm line, never the raw message (warmth law).
      setError(STRINGS.loadFailedLine('your journal'));
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  const today = getLocalDateString();

  // System journal facts (day-21 completion, rally markers, major stops)
  // interleave with user reflections in one date-grouped timeline — both
  // already come back sorted newest-first, so a stable sort by date
  // preserves that within each source and merges the two.
  const timeline: TimelineEntry[] = [
    ...reflections.map((r): TimelineEntry => ({ kind: 'reflection', localDate: r.localDate, reflection: r })),
    ...facts.map((f): TimelineEntry => ({ kind: 'fact', localDate: f.localDate, fact: f })),
  ].sort((a, b) => b.localDate.localeCompare(a.localDate));

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}>
      <AppHeader style={styles.header} />

      <Text style={styles.title}>your journal</Text>
      <View style={styles.lock}>
        <Text style={styles.lockText}>{STRINGS.privateBadge}</Text>
      </View>

      <TouchableOpacity onPress={() => router.push('/ask-rally')}>
        <Text style={styles.askRallyLink}>{STRINGS.askRallyLinkLabel} →</Text>
      </TouchableOpacity>

      {/* ER1: the whole-moment load failure gets the slip; the empty
          state below (journal companion) is mutually exclusive, so the
          one-mascot-per-screen law holds by construction. */}
      {error && <ErrorSlip message={error} />}

      {!error && timeline.length === 0 && (
        <View style={styles.emptyState}>
          <MascotEntrance source={MASCOT.journalCompanion} style={styles.emptyStateImage} />
          <Text style={styles.subtitle}>your reflections will show up here as you check in</Text>
        </View>
      )}

      {timeline.map((entry, i) => {
        const showHeader = i === 0 || timeline[i - 1].localDate !== entry.localDate;
        const key = entry.kind === 'reflection' ? entry.reflection.id : entry.fact.id;
        return (
          <View key={key}>
            {showHeader && <Text style={styles.dateHeader}>{dateHeader(entry.localDate, today)}</Text>}
            {entry.kind === 'fact' ? (
              <View style={styles.factCard}>
                <Text style={styles.factText}>{entry.fact.body}</Text>
              </View>
            ) : (
              <View style={styles.card}>
                {entry.reflection.mood !== null && (
                  <Text style={styles.moodBadge}>{MOOD_EMOJI[entry.reflection.mood]}</Text>
                )}
                {!!entry.reflection.line1 && (
                  <Text style={styles.line}>
                    <Text style={styles.lineLabel}>grateful</Text> · {entry.reflection.line1}
                  </Text>
                )}
                {/* GQ1: line2 is labelled by its day's goals-set key — a
                    month reads goal · step · win · honest, which is the
                    feature's whole point. Null-key (pre-GQ1) rows keep
                    "learned". */}
                {!!entry.reflection.line2 && (
                  <Text style={styles.line}>
                    <Text style={styles.lineLabel}>
                      {goalsSetLabelForKey(entry.reflection.line2PromptKey)}
                    </Text>{' '}
                    · {entry.reflection.line2}
                  </Text>
                )}
                {!!entry.reflection.questionAnswer && !!entry.reflection.questionPrompt && (
                  <Text style={styles.line}>
                    <Text style={styles.lineLabel}>{entry.reflection.questionPrompt}</Text> ·{' '}
                    {entry.reflection.questionAnswer}
                  </Text>
                )}
              </View>
            )}
          </View>
        );
      })}
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
    marginBottom: 10,
  },
  lock: {
    alignSelf: 'flex-start',
    backgroundColor: colors.greenSoft,
    borderRadius: 99,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginBottom: 18,
  },
  lockText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.green,
  },
  askRallyLink: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.plum,
    marginBottom: 18,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 24,
  },
  emptyStateImage: {
    width: 100,
    height: 145,
    marginBottom: 14,
  },
  dateHeader: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.plum,
    marginBottom: 8,
    marginTop: 6,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    ...cardShadow,
  },
  moodBadge: {
    fontSize: 18,
    marginBottom: 6,
  },
  line: {
    fontSize: 12.5,
    color: colors.ink,
    lineHeight: 19,
    marginBottom: 4,
  },
  lineLabel: {
    fontFamily: FONT_SERIF_ITALIC,
    color: colors.plum,
  },
  factCard: {
    backgroundColor: colors.plumSoft,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderLeftWidth: 3,
    borderLeftColor: colors.plum,
  },
  factText: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 13,
    color: colors.plum,
    lineHeight: 19,
  },
});

// NR1 Job 1c — this tab renders behind its own error boundary so a
// crash here can't take the floating tab bar (and the other tabs) down.
export default withErrorBoundary(Journal, 'tab:journal');

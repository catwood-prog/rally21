import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { MASCOT } from '@/assets/mascot';
import { Brandmark } from '@/components/Brandmark';
import { MascotEntrance } from '@/components/MascotEntrance';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { cardShadow, colors } from '@/constants/theme';
import { MOOD_EMOJI } from '@/constants/mood';
import { useAuth } from '@/lib/auth-context';
import { getLocalDateString } from '@/lib/date';
import { getMyReflections, Reflection } from '@/lib/reflections';

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

export default function Journal() {
  const router = useRouter();
  const { session } = useAuth();
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);
    try {
      setReflections(await getMyReflections(session.user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load your journal');
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity onPress={() => router.push('/today')}>
        <Text style={styles.back}>← Today</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Your journal</Text>
      <View style={styles.lock}>
        <Text style={styles.lockText}>🔒 Only you see these</Text>
      </View>

      {error && <Text style={styles.subtitle}>{error}</Text>}

      {!error && reflections.length === 0 && (
        <View style={styles.emptyState}>
          <MascotEntrance source={MASCOT.journalCompanion} style={styles.emptyStateImage} />
          <Text style={styles.subtitle}>your reflections will show up here as you check in</Text>
        </View>
      )}

      {reflections.map((r, i) => {
        const showHeader = i === 0 || reflections[i - 1].localDate !== r.localDate;
        return (
          <View key={r.id}>
            {showHeader && <Text style={styles.dateHeader}>{dateHeader(r.localDate, today)}</Text>}
            <View style={styles.card}>
              {r.mood !== null && <Text style={styles.moodBadge}>{MOOD_EMOJI[r.mood]}</Text>}
              {!!r.line1 && (
                <Text style={styles.line}>
                  <Text style={styles.lineLabel}>grateful</Text> · {r.line1}
                </Text>
              )}
              {!!r.line2 && (
                <Text style={styles.line}>
                  <Text style={styles.lineLabel}>learned</Text> · {r.line2}
                </Text>
              )}
              {!!r.questionAnswer && !!r.questionPrompt && (
                <Text style={styles.line}>
                  <Text style={styles.lineLabel}>{r.questionPrompt}</Text> · {r.questionAnswer}
                </Text>
              )}
            </View>
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
    paddingBottom: 64,
  },
  brandmark: {
    marginBottom: 14,
  },
  back: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
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
});

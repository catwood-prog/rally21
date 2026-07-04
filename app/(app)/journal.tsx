import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors } from '@/constants/theme';
import { MOOD_EMOJI } from '@/constants/mood';
import { useAuth } from '@/lib/auth-context';
import { getLocalDateString } from '@/lib/date';
import { Checkin, getMyCheckins } from '@/lib/reflections';

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
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);
    try {
      setCheckins(await getMyCheckins(session.user.id));
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
      <TouchableOpacity onPress={() => router.push('/(app)/today')}>
        <Text style={styles.back}>← Today</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Your journal</Text>
      <View style={styles.lock}>
        <Text style={styles.lockText}>🔒 Only you see these</Text>
      </View>

      {error && <Text style={styles.subtitle}>{error}</Text>}

      {!error && checkins.length === 0 && (
        <Text style={styles.subtitle}>your reflections will show up here as you check in</Text>
      )}

      {checkins.map((c, i) => {
        const showHeader = i === 0 || checkins[i - 1].localDate !== c.localDate;
        return (
          <View key={c.id}>
            {showHeader && <Text style={styles.dateHeader}>{dateHeader(c.localDate, today)}</Text>}
            <View style={styles.card}>
              {c.mood !== null && <Text style={styles.moodBadge}>{MOOD_EMOJI[c.mood]}</Text>}
              {!!c.line && (
                <Text style={styles.line}>
                  <Text style={styles.lineLabel}>grateful</Text> · {c.line}
                </Text>
              )}
              {!!c.line2 && (
                <Text style={styles.line}>
                  <Text style={styles.lineLabel}>learned</Text> · {c.line2}
                </Text>
              )}
              {!!c.questionAnswer && !!c.questionPrompt && (
                <Text style={styles.line}>
                  <Text style={styles.lineLabel}>{c.questionPrompt}</Text> · {c.questionAnswer}
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
    paddingBottom: 48,
  },
  back: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 10,
  },
  lock: {
    alignSelf: 'flex-start',
    backgroundColor: '#EAF3EA',
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
  dateHeader: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.green,
    marginBottom: 8,
    marginTop: 6,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
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
    color: colors.green,
    fontStyle: 'italic',
  },
});

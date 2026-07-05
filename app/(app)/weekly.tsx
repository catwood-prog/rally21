import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Brandmark } from '@/components/Brandmark';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { cardShadow, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getMyCompletions, listMyCircles } from '@/lib/circle';
import { getLocalDateString } from '@/lib/date';
import {
  CircleShowUp,
  computeByCircleShowUp,
  computeWeeklyLookback,
  getMyReflections,
  WeeklyLookback,
} from '@/lib/reflections';

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function WeeklyLookBack() {
  const router = useRouter();
  const { session } = useAuth();
  const [lookback, setLookback] = useState<WeeklyLookback | null>(null);
  const [byCircle, setByCircle] = useState<CircleShowUp[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);
    try {
      const today = getLocalDateString();
      const [reflections, circles] = await Promise.all([
        getMyReflections(session.user.id),
        listMyCircles(session.user.id),
      ]);
      // The reflection week's denominator is capped at days since the
      // user's FIRST circle started — the earliest start date across
      // every circle they're in, not any single "primary" one.
      const earliestStartDate = circles.reduce(
        (min: string | null, c) => (min === null || c.startDate < min ? c.startDate : min),
        null as string | null
      );
      setLookback(computeWeeklyLookback(reflections, today, earliestStartDate ?? today));

      const completions = await getMyCompletions(
        session.user.id,
        circles.map((c) => c.id)
      );
      setByCircle(computeByCircleShowUp(circles, completions, today));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load your week');
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

  if (!lookback || error) {
    return (
      <View style={styles.loading}>
        <Text style={styles.subtitle}>{error ?? 'nothing to show yet'}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity onPress={() => router.push('/today')}>
        <Text style={styles.back}>← Today</Text>
      </TouchableOpacity>

      {lookback.totalDays === 1 ? (
        <Text style={styles.title}>
          {lookback.daysShowedUp === 1 ? (
            <>
              you showed up <Text style={styles.titleAccent}>on day one</Text>
            </>
          ) : (
            <>
              your circle just started <Text style={styles.titleAccent}>— plenty of time</Text>
            </>
          )}
        </Text>
      ) : (
        <Text style={styles.title}>
          you showed up{' '}
          <Text style={styles.titleAccent}>
            {lookback.daysShowedUp} of {lookback.totalDays}
          </Text>{' '}
          days
        </Text>
      )}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Daily check-ins</Text>
        <View style={styles.bars}>
          {lookback.dailyMoods.map((mood, i) => {
            const [, , d] = lookback.dates[i].split('-');
            const weekday = new Date(`${lookback.dates[i]}T00:00:00`).getDay();
            return (
              <View key={lookback.dates[i]} style={styles.barColumn}>
                <View style={styles.barTrack}>
                  {mood !== null && (
                    <View style={[styles.barFill, { height: `${(mood / 5) * 100}%` }]} />
                  )}
                </View>
                <Text style={styles.barLabel}>{WEEKDAY_LETTERS[weekday]}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {byCircle.length > 1 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>By circle</Text>
          {byCircle.map((c) => (
            <View key={c.circleId} style={styles.circleRow}>
              <Text style={styles.circleRowName}>{c.name}</Text>
              <Text style={styles.circleRowCount}>
                {c.daysShowedUp} of {c.totalDays}
                {c.isHot ? ' 🔥' : ''}
              </Text>
            </View>
          ))}
        </View>
      )}

      {lookback.standout && (
        <>
          <Text style={styles.sectionLabel}>A line that stood out</Text>
          <View style={styles.standoutCard}>
            <Text style={styles.standoutText}>&quot;{lookback.standout.text}&quot;</Text>
            <Text style={styles.standoutMeta}>
              {new Date(`${lookback.standout.date}T00:00:00`).toLocaleDateString(undefined, {
                weekday: 'long',
              })}{' '}
              · {lookback.standout.label}
            </Text>
          </View>
        </>
      )}

      <TouchableOpacity style={styles.button} onPress={() => router.push('/journal')}>
        <Text style={styles.buttonText}>See full journal</Text>
      </TouchableOpacity>
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
    padding: 24,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
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
  subtitle: {
    fontSize: 13,
    color: colors.muted,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 21,
    color: colors.ink,
    lineHeight: 27,
    marginBottom: 18,
  },
  titleAccent: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 24,
    color: colors.green,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 22,
    ...cardShadow,
  },
  cardLabel: {
    fontSize: 11,
    color: colors.muted,
    marginBottom: 10,
  },
  circleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  circleRowName: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
  },
  circleRowCount: {
    fontSize: 11,
    color: colors.muted,
  },
  bars: {
    flexDirection: 'row',
    gap: 6,
    height: 66,
    alignItems: 'flex-end',
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
  },
  barTrack: {
    width: '100%',
    height: 50,
    justifyContent: 'flex-end',
    backgroundColor: '#EAF3EA',
    borderRadius: 5,
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    backgroundColor: colors.green,
    borderRadius: 5,
  },
  barLabel: {
    fontSize: 9,
    color: colors.muted,
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 11,
    color: colors.muted,
    marginBottom: 8,
  },
  standoutCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    marginBottom: 26,
    ...cardShadow,
  },
  standoutText: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 17,
    color: colors.ink,
    lineHeight: 21,
  },
  standoutMeta: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 6,
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
});

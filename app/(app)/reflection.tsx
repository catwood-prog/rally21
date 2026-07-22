import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { ErrorSlip } from '@/components/ErrorSlip';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getMyBlueprint } from '@/lib/blueprint';
import {
  computeDayObservation,
  DayObservation,
  getMyObservationResponse,
  getMyReflections,
  ObservationDirection,
  saveObservationResponse,
} from '@/lib/reflections';

const DIRECTION_TEXT: Record<ObservationDirection, { lead: string; accent: string }> = {
  before_noon_higher: { lead: 'Your mood runs highest on days you check in', accent: 'before noon' },
  after_noon_higher: { lead: 'Your mood runs highest on days you check in', accent: 'after noon' },
  weekday_higher: { lead: 'Your mood runs highest on', accent: 'weekdays' },
  weekend_higher: { lead: 'Your mood runs highest on', accent: 'weekends' },
};

export default function Reflection() {
  const router = useRouter();
  const { session } = useAuth();
  const [observation, setObservation] = useState<DayObservation | null>(null);
  const [response, setResponse] = useState<'confirmed' | 'rejected' | null>(null);
  const [hasBlueprintPattern, setHasBlueprintPattern] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);
    try {
      const [reflections, myBlueprint] = await Promise.all([
        getMyReflections(session.user.id),
        getMyBlueprint().catch(() => []),
      ]);
      const result = computeDayObservation(reflections);
      setObservation(result);
      setHasBlueprintPattern(myBlueprint.length > 0);
      if (result.available) {
        setResponse(await getMyObservationResponse(session.user.id, result.type, result.direction));
      }
    } catch {
      // ER1: the warm line, never the raw message (warmth law).
      setError(STRINGS.loadFailedLine('this'));
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleRespond = async (value: 'confirmed' | 'rejected') => {
    if (!session?.user || !observation?.available) return;
    setIsSaving(true);
    try {
      await saveObservationResponse({
        userId: session.user.id,
        type: observation.type,
        direction: observation.direction,
        agreementCount: observation.agreementCount,
        totalCount: observation.totalCount,
        response: value,
      });
      setResponse(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save that — try again');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <AppHeader style={styles.appHeader} />

      <View style={styles.header}>
        <Text style={styles.title}>something we noticed</Text>
        <View style={styles.lock}>
          <Text style={styles.lockText}>🔒 private</Text>
        </View>
      </View>

      {/* ER1: a failed observation load is a whole-moment failure. */}
      {error && <ErrorSlip message={error} />}

      {!error && observation?.available && (
        <>
          <Text style={styles.subtitle}>Based on your check-ins so far ✨</Text>
          <View style={styles.patternCard}>
            <Text style={styles.patternLabel}>A GENTLE PATTERN</Text>
            <Text style={styles.patternHeadline}>
              {DIRECTION_TEXT[observation.direction].lead}{' '}
              <Text style={styles.patternAccent}>{DIRECTION_TEXT[observation.direction].accent}</Text>.
            </Text>
            <Text style={styles.patternMeta}>
              Based on {observation.agreementCount} of your last {observation.totalCount} check-ins.
            </Text>

            {response === null ? (
              <View style={styles.responseRow}>
                <TouchableOpacity
                  style={styles.soundsRight}
                  onPress={() => handleRespond('confirmed')}
                  disabled={isSaving}
                >
                  <Text style={styles.soundsRightText}>Sounds right</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.notQuite}
                  onPress={() => handleRespond('rejected')}
                  disabled={isSaving}
                >
                  <Text style={styles.notQuiteText}>Not quite</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.respondedText}>
                {response === 'confirmed' ? '✓ you said this sounds right' : 'noted — thanks for the correction'}
              </Text>
            )}
          </View>
          <Text style={styles.footer}>
            Built only from your check-ins.{'\n'}You can correct or delete anything.
          </Text>
          {hasBlueprintPattern && (
            <TouchableOpacity onPress={() => router.push('/private-map')} style={styles.blueprintLinkWrap}>
              <Text style={styles.blueprintLink}>{STRINGS.blueprintSeeYourBlueprint}</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {!error && observation && !observation.available && (
        <View style={styles.growCard}>
          <Text style={styles.growEmoji}>🌱</Text>
          <Text style={styles.growText}>
            This grows as you go. In a month, your picture gets a lot richer.
          </Text>
        </View>
      )}
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
  appHeader: {
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 19,
    color: colors.ink,
  },
  lock: {
    backgroundColor: colors.greenSoft,
    borderRadius: 99,
    paddingVertical: 4,
    paddingHorizontal: 9,
  },
  lockText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: colors.green,
  },
  subtitle: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 14,
  },
  patternCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.plum,
    padding: 18,
    marginBottom: 16,
    ...cardShadow,
  },
  patternLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.plum,
    marginBottom: 8,
  },
  patternHeadline: {
    fontFamily: FONT_HEADER,
    fontSize: 18,
    color: colors.ink,
    lineHeight: 24,
  },
  patternAccent: {
    fontFamily: FONT_SERIF_ITALIC,
    color: colors.plum,
    fontSize: 21,
  },
  patternMeta: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 10,
    lineHeight: 16,
  },
  responseRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  soundsRight: {
    flex: 1,
    backgroundColor: colors.plumSoft,
    borderWidth: 1.5,
    borderColor: colors.plum,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  soundsRightText: {
    color: colors.plum,
    fontWeight: '700',
    fontSize: 12.5,
  },
  notQuite: {
    flex: 1,
    backgroundColor: colors.plumSoft,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  notQuiteText: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 12.5,
  },
  respondedText: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 16,
    fontWeight: '600',
  },
  footer: {
    fontSize: 10.5,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 8,
  },
  blueprintLinkWrap: {
    marginTop: 14,
    alignItems: 'center',
  },
  blueprintLink: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.plum,
  },
  growCard: {
    backgroundColor: '#FDF4DC',
    borderWidth: 1,
    borderColor: '#EAD79B',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  growEmoji: {
    fontSize: 18,
  },
  growText: {
    flex: 1,
    fontSize: 11.5,
    color: '#7A5E1A',
    lineHeight: 16,
  },
});

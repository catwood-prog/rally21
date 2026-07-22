import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brandmark } from '@/components/Brandmark';
import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { joinPublicCircle, listPublicCircles, PublicCircle } from '@/lib/circle-setup';

export default function PracticeCircles() {
  const router = useRouter();
  // NAV1 job 0 — no AppHeader on pre-signed-in-chrome screens, but the
  // safe-area inset still applies.
  const insets = useSafeAreaInsets();
  const { practiceId, practiceKey, practiceName, fromToday } = useLocalSearchParams<{
    practiceId: string;
    practiceKey: string;
    practiceName: string;
    fromToday?: string;
  }>();
  const isFromToday = fromToday === 'true';

  const [circles, setCircles] = useState<PublicCircle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [joiningCircleId, setJoiningCircleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!practiceId) return;
    listPublicCircles(practiceId)
      .then(setCircles)
      .catch((e) => setError(e instanceof Error ? e.message : 'could not load open circles'))
      .finally(() => setIsLoading(false));
  }, [practiceId]);

  const handleJoin = async (circle: PublicCircle) => {
    setJoiningCircleId(circle.circleId);
    try {
      await joinPublicCircle(circle.circleId);
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not join that circle — try again');
      setJoiningCircleId(null);
    }
  };

  const handleStartOwn = () => {
    router.push({
      pathname: '/onboarding/commitment',
      params: { practiceKey, practiceName, ...(isFromToday ? { fromToday: 'true' } : {}) },
    });
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: 20 + insets.top }]}
    >
      <Brandmark style={styles.brandmark} />
      {/* NAV1: back() preserves the browse screen's state when there's
          history, but a cold-loaded URL still needs a real parent. */}
      <TouchableOpacity
        onPress={() =>
          isFromToday
            ? router.push('/today')
            : router.canGoBack()
              ? router.back()
              : router.push('/onboarding/create-circle')
        }
      >
        <Text style={styles.back}>{isFromToday ? '← Today' : '← Find a practice'}</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{practiceName}</Text>

      {isLoading ? (
        <ActivityIndicator color={colors.green} style={styles.loadingSpinner} />
      ) : circles.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>{STRINGS.openCirclesNoneYetStartFirst}</Text>
        </View>
      ) : (
        <>
          <Text style={styles.disclosure}>
            Circle-mates see that you checked in — never your mood or notes.
          </Text>
          {circles.map((circle) => (
            <View key={circle.circleId} style={styles.circleCard}>
              <View style={styles.circleCardInfo}>
                <Text style={styles.circleCardName}>{circle.name}</Text>
                <Text style={styles.circleCardMeta}>
                  day {Math.min(circle.dayNumber, circle.durationDays)} of {circle.durationDays} ·{' '}
                  {circle.memberCount} {circle.memberCount === 1 ? 'member' : 'members'} ·{' '}
                  {circle.spotsLeft} {circle.spotsLeft === 1 ? 'spot' : 'spots'} left
                </Text>
              </View>
              <TouchableOpacity
                style={styles.joinChip}
                onPress={() => handleJoin(circle)}
                disabled={joiningCircleId === circle.circleId || circle.spotsLeft === 0}
              >
                {joiningCircleId === circle.circleId ? (
                  <ActivityIndicator size="small" color={colors.green} />
                ) : (
                  <Text style={styles.joinChipText}>{circle.spotsLeft === 0 ? 'Full' : 'Join'}</Text>
                )}
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}

      <TouchableOpacity style={styles.startOwnButton} onPress={handleStartOwn}>
        <Text style={styles.startOwnButtonText}>start your own {practiceName?.toLowerCase()} circle</Text>
      </TouchableOpacity>

      <MessageDialog
        visible={!!error}
        title="hmm"
        variant="error"
        message={error ?? ''}
        onDismiss={() => setError(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
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
    fontSize: 22,
    color: colors.ink,
    marginBottom: 16,
  },
  loadingSpinner: {
    marginTop: 20,
  },
  emptyState: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
    ...cardShadow,
  },
  emptyStateText: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
  },
  disclosure: {
    fontSize: 11,
    color: colors.muted,
    marginBottom: 12,
    lineHeight: 15,
  },
  circleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 10,
    ...cardShadow,
  },
  circleCardInfo: {
    flex: 1,
  },
  circleCardName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
  },
  circleCardMeta: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  joinChip: {
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.green,
    borderRadius: 99,
    paddingVertical: 8,
    paddingHorizontal: 18,
    minWidth: 58,
    alignItems: 'center',
  },
  joinChipText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.green,
  },
  startOwnButton: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  startOwnButtonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
});

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brandmark } from '@/components/Brandmark';
import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { joinPublicCircle, listPublicCircles, PublicCircle } from '@/lib/circle-setup';
import { groupingLine } from '@/lib/practiceTaxonomy';

/**
 * CF2 screen 3 — THE PRACTICE HUB: every practice card lands here, and
 * "how do you want to practise?" is answered here. GO SOLO and START A
 * CIRCLE are equal peer cards — solo is first-class, never a fallback,
 * never hidden, never moved by whatever the public-circle list below is
 * doing. The list itself is CF1's caller-scoped source of truth (the
 * same rule that feeds browse's tile counts, so the two can never
 * disagree); joins follow OC1's existing rules — direct join, no
 * request-to-join, that concept doesn't exist. An empty list says "no
 * open circles yet" INSIDE its own section only.
 */
export default function PracticeHub() {
  const router = useRouter();
  // NAV1 job 0 — no AppHeader on pre-signed-in-chrome screens, but the
  // safe-area inset still applies.
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    practiceId: string;
    practiceKey: string;
    practiceName: string;
    practiceType: string;
    timerSuggested?: string;
    defaultDuration?: string;
    privateCustom?: string;
    fromToday?: string;
    wantKey?: string;
    wantStatement?: string;
  }>();
  const { practiceId, practiceName, practiceType, fromToday } = params;
  const isFromToday = fromToday === 'true';

  const [circles, setCircles] = useState<PublicCircle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [joiningCircleId, setJoiningCircleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Shared data (member counts move as people join elsewhere) — the
  // refetch-on-focus convention, same as every circle-data screen.
  const load = useCallback(async () => {
    if (!practiceId) return;
    try {
      setCircles(await listPublicCircles(practiceId));
    } catch {
      // the hub's own cards work fine without the list; the section
      // just shows its empty line
    } finally {
      setIsLoading(false);
    }
  }, [practiceId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const setupParams = {
    practiceId: params.practiceId,
    practiceKey: params.practiceKey,
    practiceName: params.practiceName,
    practiceType: params.practiceType,
    ...(params.timerSuggested ? { timerSuggested: params.timerSuggested } : {}),
    ...(params.defaultDuration ? { defaultDuration: params.defaultDuration } : {}),
    ...(params.privateCustom ? { privateCustom: params.privateCustom } : {}),
    ...(isFromToday ? { fromToday: 'true' } : {}),
    ...(params.wantKey ? { wantKey: params.wantKey, wantStatement: params.wantStatement ?? '' } : {}),
  };

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

  const grouping = practiceType ? groupingLine(practiceType) : null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: 20 + insets.top }]}
    >
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity
        onPress={() =>
          isFromToday
            ? router.push('/today')
            : router.canGoBack()
              ? router.back()
              : router.push('/onboarding/create-circle')
        }
      >
        <Text style={styles.back}>{isFromToday ? '← Today' : '← Back'}</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{practiceName?.toLowerCase()}</Text>
      {grouping && <Text style={styles.grouping}>{grouping}</Text>}

      <Text style={styles.howQuestion}>{STRINGS.hubHowQuestion}</Text>

      <View style={styles.peerRow}>
        <TouchableOpacity
          style={styles.peerCard}
          onPress={() => router.push({ pathname: '/onboarding/solo-setup', params: setupParams })}
        >
          <Text style={styles.peerEmoji}>🌱</Text>
          <Text style={styles.peerTitle}>{STRINGS.hubGoSoloTitle}</Text>
          <Text style={styles.peerBody}>{STRINGS.hubGoSoloBody}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.peerCard}
          onPress={() => router.push({ pathname: '/onboarding/start-circle', params: setupParams })}
        >
          <Text style={styles.peerEmoji}>✨</Text>
          <Text style={styles.peerTitle}>{STRINGS.hubStartCircleTitle}</Text>
          <Text style={styles.peerBody}>{STRINGS.hubStartCircleBody}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionLabel}>{STRINGS.hubOpenCirclesLabel}</Text>
      {isLoading ? (
        <ActivityIndicator color={colors.green} style={styles.loadingSpinner} />
      ) : circles.length === 0 ? (
        <Text style={styles.emptyLine}>{STRINGS.openCirclesCount(0)}</Text>
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
  },
  grouping: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  howQuestion: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 20,
    marginBottom: 10,
  },
  // The two equal peers: same card, same size, side by side — the layout
  // itself says neither is the fallback. Wraps to one column under
  // large accessibility text via flexWrap + minWidth.
  peerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  peerCard: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 150,
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    ...cardShadow,
  },
  peerEmoji: {
    fontSize: 22,
    marginBottom: 6,
  },
  peerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.ink,
  },
  peerBody: {
    fontSize: 11,
    color: colors.muted,
    lineHeight: 15,
    marginTop: 3,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.green,
    marginBottom: 8,
  },
  loadingSpinner: {
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  emptyLine: {
    fontSize: 12.5,
    color: colors.muted,
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
});

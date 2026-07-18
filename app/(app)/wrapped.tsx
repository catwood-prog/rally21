import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { MessageDialog } from '@/components/MessageDialog';
import { ShareCardView } from '@/components/ShareCardView';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { listMyReflectionLines } from '@/lib/checkin';
import { getCircleById, getCirclePresence } from '@/lib/circle';
import { getLocalDateString, shiftDate } from '@/lib/date';
import { captureShareCard, saveCardImage, shareCardImage } from '@/lib/shareCardExport';
import { recordCardEvent } from '@/lib/shareCards';
import { composeWrappedData, WrappedData } from '@/lib/wrapped';

/**
 * SC3 (18 July) — the day-21 mini-Wrapped (share-cards spec §4.5): the
 * ceremony's one shareable keepsake. Reached ONLY from the ceremony's
 * quiet offer (journey-gate, after the decision); the offer marker is
 * already bumped by the time this screen mounts, so leaving here never
 * re-triggers anything.
 *
 * The sensitive part is the line picker: a reflection line reaches the
 * card ONLY by the user's explicit tap in the picker below — never
 * pre-filled, never suggested, never auto-included. The picker reads
 * ONLY the ceremony-user's own rows (reflections RLS is owner-only, and
 * listMyReflectionLines adds no user filter because none is possible to
 * widen). Skipping the picker yields a card that ends at the counts and
 * reads complete. Counts are TRUE by construction: composeWrappedData
 * derives dots + counts from getCirclePresence's completions rows — the
 * same source Who's Here, the SignalMeter and the glow math already
 * trust — and the card renders only what happened (a held line never
 * renders at zero; misses are quiet dots, never a number).
 */
export default function Wrapped() {
  const router = useRouter();
  const { session } = useAuth();
  const { circleId, milestone } = useLocalSearchParams<{ circleId: string; milestone?: string }>();
  const milestoneDay = milestone ? Number(milestone) : 21;
  const cardRef = useRef<View>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<WrappedData | null>(null);
  const [circleName, setCircleName] = useState<string | null>(null);
  const [lines, setLines] = useState<{ date: string; text: string }[]>([]);
  const [pickedLine, setPickedLine] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cardKey = `wrapped-${circleId}-${milestoneDay}`;

  useEffect(() => {
    if (!circleId || !session?.user) return;
    const userId = session.user.id;
    (async () => {
      try {
        const circle = await getCircleById(circleId);
        if (!circle) return;
        setCircleName(circle.name);
        const windowEnd = shiftDate(circle.startDate, milestoneDay - 1);
        const [presence, myLines] = await Promise.all([
          getCirclePresence(circleId),
          // The journey being celebrated, capped at today for sanity.
          listMyReflectionLines(
            circle.startDate,
            windowEnd < getLocalDateString() ? windowEnd : getLocalDateString()
          ),
        ]);
        setData(
          composeWrappedData({
            userId,
            circleStartDate: circle.startDate,
            milestoneDay,
            presence,
          })
        );
        setLines(myLines);
        recordCardEvent('wrapped', `wrapped-${circleId}-${milestoneDay}`, 'shown').catch(() => {});
      } catch (e) {
        setError(e instanceof Error ? e.message : 'could not load your card');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [circleId, session?.user?.id, milestoneDay]);

  const goBackToCircle = () => router.replace({ pathname: '/circle', params: { circleId } });

  const handleShare = async () => {
    setIsSharing(true);
    try {
      const uri = await captureShareCard(cardRef);
      const shared = await shareCardImage(uri);
      if (shared) {
        recordCardEvent('wrapped', cardKey, 'shared').catch(() => {});
      } else {
        await saveCardImage(uri);
        recordCardEvent('wrapped', cardKey, 'saved').catch(() => {});
      }
    } catch {
      setError(STRINGS.shareCardShareError);
    } finally {
      setIsSharing(false);
    }
  };

  const handleDone = () => {
    recordCardEvent('wrapped', cardKey, 'dismissed').catch(() => {});
    goBackToCircle();
  };

  if (!circleId) return <Redirect href="/today" />;

  if (isLoading || !data) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
        <MessageDialog visible={!!error} title="hmm" message={error ?? ''} onDismiss={goBackToCircle} />
      </View>
    );
  }

  const cardProps = {
    body: pickedLine ?? '',
    attribution: null,
    gloss: null,
    flavor: 'wrapped' as const,
    wrappedDots: data.dots,
    wrappedShownUp: data.shownUp,
    wrappedHeld: data.held,
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.back} onPress={handleDone}>
          <Text style={styles.backText}>← {circleName ?? 'Your Circle'}</Text>
        </TouchableOpacity>

        <ShareCardView {...cardProps} />

        {lines.length > 0 && (
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>{STRINGS.wrappedPickerTitle}</Text>
            <Text style={styles.pickerHint}>{STRINGS.wrappedPickerHint}</Text>
            <TouchableOpacity
              style={[styles.pickerRow, pickedLine === null && styles.pickerRowPicked]}
              onPress={() => setPickedLine(null)}
              accessibilityRole="radio"
              accessibilityState={{ selected: pickedLine === null }}
            >
              <Text style={styles.pickerNoneText}>{STRINGS.wrappedPickerNone}</Text>
            </TouchableOpacity>
            {lines.map((line) => (
              <TouchableOpacity
                key={`${line.date}-${line.text}`}
                style={[styles.pickerRow, pickedLine === line.text && styles.pickerRowPicked]}
                onPress={() => setPickedLine(line.text)}
                accessibilityRole="radio"
                accessibilityState={{ selected: pickedLine === line.text }}
              >
                <Text style={styles.pickerLineText} numberOfLines={2}>
                  &ldquo;{line.text}&rdquo;
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TouchableOpacity style={styles.shareButton} onPress={handleShare} disabled={isSharing}>
          <Text style={styles.shareButtonText}>{isSharing ? '…' : STRINGS.wrappedShareCta}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.doneButton} onPress={handleDone}>
          <Text style={styles.doneButtonText}>{STRINGS.wrappedDone}</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* The 9:16 capture source — same hidden-clip pattern as
          /share-card (see its captureClip comment for the html2canvas
          positioning constraint). The capture card mirrors the preview
          exactly, picked line included. */}
      <View
        style={styles.captureClip}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={styles.captureSizer}>
          <ShareCardView ref={cardRef} capture {...cardProps} />
        </View>
      </View>

      <MessageDialog visible={!!error} title="hmm" message={error ?? ''} onDismiss={() => setError(null)} />
    </View>
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
    padding: 24,
    paddingTop: 16,
    paddingBottom: 40,
    alignItems: 'center',
  },
  back: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    marginBottom: 6,
  },
  backText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  pickerCard: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginTop: 18,
    ...cardShadow,
  },
  pickerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
  },
  pickerHint: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 3,
    marginBottom: 10,
  },
  pickerRow: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  pickerRowPicked: {
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
  },
  pickerNoneText: {
    fontSize: 12.5,
    color: colors.muted,
  },
  pickerLineText: {
    fontSize: 13,
    color: colors.ink,
    fontStyle: 'italic',
  },
  shareButton: {
    width: '100%',
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 15,
    alignItems: 'center',
    marginTop: 18,
  },
  shareButtonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
  doneButton: {
    marginTop: 10,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  doneButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  captureClip: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    overflow: 'hidden',
  },
  captureSizer: {
    width: 360,
  },
});

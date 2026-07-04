import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Brandmark } from '@/components/Brandmark';
import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { cardShadow, chipShape, chipTextShape, colors } from '@/constants/theme';
import { createCircle } from '@/lib/circles';

const TIME_OPTIONS = [
  { label: 'Morning', time: '08:00:00' },
  { label: 'Midday', time: '12:00:00' },
  { label: 'Evening', time: '18:00:00' },
  { label: 'Night', time: '21:00:00' },
];

export default function TheCommitment() {
  const router = useRouter();
  const { practiceKey, practiceName, solo, fromToday } = useLocalSearchParams<{
    practiceKey: string;
    practiceName: string;
    solo?: string;
    fromToday?: string;
  }>();
  const isSolo = solo === 'true';
  const isFromToday = fromToday === 'true';

  const [circleName, setCircleName] = useState(practiceName ?? '');
  const [selectedTime, setSelectedTime] = useState(TIME_OPTIONS[0].time);
  const [isPublic, setIsPublic] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSetIt = async () => {
    if (!practiceKey) return;
    setIsCreating(true);
    try {
      const { circleId, inviteCode } = await createCircle(
        practiceKey,
        selectedTime,
        circleName,
        isSolo ? false : isPublic
      );
      if (isSolo) {
        // "/" re-checks profile + membership and lands on Today
        router.replace('/');
      } else {
        router.replace({
          pathname: '/onboarding/invite',
          params: { circleId, inviteCode, ...(isFromToday ? { fromToday: 'true' } : {}) },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'something went wrong — try again');
      setIsCreating(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Brandmark style={styles.brandmark} />
      <View style={styles.topbar}>
        <TouchableOpacity onPress={() => (isFromToday ? router.push('/today') : router.back())}>
          <Text style={styles.back}>{isFromToday ? '← Today' : '← Back'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>
        {isSolo ? (
          (practiceName ?? 'your practice').toLowerCase()
        ) : (
          <>
            {(practiceName ?? 'your practice').toLowerCase()},{' '}
            <Text style={styles.titleAccent}>together</Text>
          </>
        )}
      </Text>

      <Text style={styles.label}>name your circle</Text>
      <TextInput
        style={styles.input}
        placeholder="your circle's name"
        placeholderTextColor={colors.muted}
        value={circleName}
        onChangeText={setCircleName}
        autoCorrect={false}
      />

      <Text style={[styles.label, styles.sectionSpacing]}>time of day</Text>
      <View style={styles.chipRow}>
        {TIME_OPTIONS.map((option) => {
          const selected = option.time === selectedTime;
          return (
            <TouchableOpacity
              key={option.time}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => setSelectedTime(option.time)}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.hint}>daily, for 21 days — a couple lines a day, that&apos;s it</Text>

      {!isSolo && (
        <>
          <Text style={[styles.label, styles.sectionSpacing]}>who can join</Text>

          <TouchableOpacity
            style={[styles.visibilityCard, !isPublic && styles.visibilityCardSelected]}
            onPress={() => setIsPublic(false)}
          >
            <Text style={styles.visibilityTitle}>🔒 Private</Text>
            <Text style={styles.visibilityBody}>
              Only people you invite can join — share a code to bring them in.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.visibilityCard, isPublic && styles.visibilityCardSelected]}
            onPress={() => setIsPublic(true)}
          >
            <Text style={styles.visibilityTitle}>🌍 Public</Text>
            <Text style={styles.visibilityBody}>Anyone on Rally21 can find and join this circle.</Text>
          </TouchableOpacity>
        </>
      )}

      <TouchableOpacity
        style={[styles.button, !circleName.trim() && styles.buttonDisabled]}
        onPress={handleSetIt}
        disabled={!circleName.trim() || isCreating}
      >
        {isCreating ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text style={styles.buttonText}>Set it</Text>
        )}
      </TouchableOpacity>

      <MessageDialog
        visible={!!error}
        title="hmm"
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
    padding: 24,
    paddingBottom: 40,
  },
  brandmark: {
    marginBottom: 14,
  },
  topbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  back: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 22,
    color: colors.ink,
    lineHeight: 28,
    marginBottom: 22,
  },
  titleAccent: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 25,
    color: colors.green,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.green,
    marginBottom: 8,
  },
  sectionSpacing: {
    marginTop: 24,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    color: colors.ink,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    ...chipShape,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  chipSelected: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  chipText: {
    ...chipTextShape,
    color: colors.ink,
  },
  chipTextSelected: {
    color: '#fff',
  },
  hint: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 14,
    lineHeight: 17,
  },
  visibilityCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'transparent',
    padding: 15,
    marginBottom: 10,
    ...cardShadow,
  },
  visibilityCardSelected: {
    borderColor: colors.green,
  },
  visibilityTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 4,
  },
  visibilityBody: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 16,
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    marginTop: 22,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
});

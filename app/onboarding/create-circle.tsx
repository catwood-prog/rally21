import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER } from '@/constants/fonts';
import { colors } from '@/constants/theme';
import { createCircle, listPractices, Practice } from '@/lib/circles';

const TIME_OPTIONS = [
  { label: 'Morning', time: '08:00:00' },
  { label: 'Midday', time: '12:00:00' },
  { label: 'Evening', time: '18:00:00' },
  { label: 'Night', time: '21:00:00' },
];

export default function CreateCircle() {
  const router = useRouter();
  const [practices, setPractices] = useState<Practice[]>([]);
  const [selectedPracticeKey, setSelectedPracticeKey] = useState<string | null>(null);
  const [circleName, setCircleName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [selectedTime, setSelectedTime] = useState(TIME_OPTIONS[0].time);
  const [isLoadingPractices, setIsLoadingPractices] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPractices()
      .then((data) => setPractices(data))
      .catch((e) => setError(e instanceof Error ? e.message : 'could not load practices'))
      .finally(() => setIsLoadingPractices(false));
  }, []);

  const handleSelectPractice = (practice: Practice) => {
    setSelectedPracticeKey(practice.key);
    // pre-fill with the practice name, but never clobber a name the
    // person already typed themselves
    if (!nameEdited) setCircleName(practice.name);
  };

  const handleNameChange = (text: string) => {
    setCircleName(text);
    setNameEdited(true);
  };

  const handleContinue = async () => {
    if (!selectedPracticeKey) return;
    setIsCreating(true);
    try {
      const { circleId, inviteCode } = await createCircle(
        selectedPracticeKey,
        selectedTime,
        circleName
      );
      router.replace({
        pathname: '/onboarding/invite',
        params: { circleId, inviteCode },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'something went wrong — try again');
      setIsCreating(false);
    }
  };

  if (isLoadingPractices) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => router.push('/onboarding/circle-setup')}>
        <Text style={styles.back}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>pick a practice</Text>

      {practices.map((practice) => {
        const selected = practice.key === selectedPracticeKey;
        return (
          <TouchableOpacity
            key={practice.id}
            style={[styles.card, selected && styles.cardSelected]}
            onPress={() => handleSelectPractice(practice)}
          >
            <Text style={styles.cardTitle}>{practice.name}</Text>
            {!!practice.description && (
              <Text style={styles.cardBody}>{practice.description}</Text>
            )}
          </TouchableOpacity>
        );
      })}

      {!!selectedPracticeKey && (
        <>
          <Text style={[styles.title, styles.sectionSpacing]}>name your circle</Text>
          <TextInput
            style={styles.input}
            placeholder="your circle's name"
            placeholderTextColor={colors.muted}
            value={circleName}
            onChangeText={handleNameChange}
            autoCorrect={false}
          />
        </>
      )}

      <Text style={[styles.title, styles.sectionSpacing]}>what time of day?</Text>
      <View style={styles.chipRow}>
        {TIME_OPTIONS.map((option) => {
          const selected = option.time === selectedTime;
          return (
            <TouchableOpacity
              key={option.time}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => setSelectedTime(option.time)}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.hint}>daily, for 21 days — a couple lines a day, that&apos;s it</Text>

      <TouchableOpacity
        style={[styles.button, !selectedPracticeKey && styles.buttonDisabled]}
        onPress={handleContinue}
        disabled={!selectedPracticeKey || isCreating}
      >
        {isCreating ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text style={styles.buttonText}>Continue</Text>
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
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  content: {
    padding: 24,
    paddingBottom: 40,
  },
  back: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 16,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 20,
    color: colors.ink,
    marginBottom: 14,
  },
  sectionSpacing: {
    marginTop: 28,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'transparent',
    padding: 16,
    marginBottom: 10,
  },
  cardSelected: {
    borderColor: colors.green,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
  },
  cardBody: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 16,
    marginTop: 4,
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
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 99,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  chipSelected: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  chipTextSelected: {
    color: '#fff',
  },
  hint: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 18,
    marginBottom: 20,
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
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

import { useLocalSearchParams, useRouter } from 'expo-router';
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

import { AccentedText } from '@/components/AccentedText';
import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER } from '@/constants/fonts';
import { MOOD_EMOJI, MOOD_VALUES } from '@/constants/mood';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  DailyQuestion,
  getDailyQuestion,
  getQuestionById,
  getTodayReflection,
  saveCompletion,
  saveReflection,
} from '@/lib/checkin';
import { getCirclePresence } from '@/lib/circle';
import { getLocalDateString } from '@/lib/date';

export default function CheckIn() {
  const router = useRouter();
  const { session } = useAuth();
  const { circleId } = useLocalSearchParams<{ circleId: string }>();
  const today = getLocalDateString();

  const [isLoading, setIsLoading] = useState(true);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mood, setMood] = useState<number | null>(null);
  const [line, setLine] = useState('');
  const [line2, setLine2] = useState('');
  const [question, setQuestion] = useState<DailyQuestion | null>(null);
  const [questionAnswer, setQuestionAnswer] = useState('');
  const [questionSkipped, setQuestionSkipped] = useState(false);

  useEffect(() => {
    if (!circleId || !session?.user) return;
    (async () => {
      try {
        // reflection is per-person-per-day, not per-circle — if today's
        // already been done (from any circle), edit that same entry
        const [existing, presence] = await Promise.all([
          getTodayReflection(today),
          getCirclePresence(circleId),
        ]);
        const alreadyCompletedThisCircle = presence.some(
          (p) => p.userId === session.user.id && p.localDate === today
        );

        if (existing && !alreadyCompletedThisCircle) {
          // a different circle already triggered today's one reflection —
          // this one just needs its own completion marked, no form, ever
          setIsRedirecting(true);
          await saveCompletion({ userId: session.user.id, circleId, localDate: today });
          router.replace({
            pathname: '/checkin-complete',
            params: { circleId, reflectionSkipped: 'true' },
          });
          return;
        }

        if (existing) {
          setMood(existing.mood);
          setLine(existing.line1 ?? '');
          setLine2(existing.line2 ?? '');
          setQuestionAnswer(existing.questionAnswer ?? '');
          setQuestionSkipped(existing.questionSkipped);
          if (existing.questionId) {
            setQuestion(await getQuestionById(existing.questionId));
          }
        } else {
          setQuestion(await getDailyQuestion(today));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'could not load your check-in');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [circleId, today, session?.user?.id, router]);

  const canSave = !!session?.user && !!circleId && mood !== null && line.trim().length > 0;

  const handleSave = async () => {
    if (!canSave || !session?.user || !circleId || mood === null) return;
    setIsSaving(true);
    try {
      await saveCompletion({ userId: session.user.id, circleId, localDate: today });
      await saveReflection({
        userId: session.user.id,
        localDate: today,
        mood,
        line1: line.trim(),
        line2: line2.trim() || null,
        questionId: question?.id ?? null,
        questionAnswer: questionSkipped ? null : questionAnswer.trim() || null,
        questionSkipped,
      });
      router.replace({ pathname: '/checkin-complete', params: { circleId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'something went wrong — try again');
      setIsSaving(false);
    }
  };

  if (isLoading || isRedirecting) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => router.push('/today')}>
        <Text style={styles.back}>← Today</Text>
      </TouchableOpacity>

      <Text style={styles.title}>how&apos;d it go?</Text>

      <Text style={styles.label}>your mood</Text>
      <View style={styles.moodRow}>
        {MOOD_VALUES.map((value) => (
          <TouchableOpacity
            key={value}
            style={[styles.moodButton, mood === value && styles.moodButtonSelected]}
            onPress={() => setMood(value)}
          >
            <Text style={styles.moodEmoji}>{MOOD_EMOJI[value]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>grateful for</Text>
      <TextInput
        style={styles.input}
        placeholder="one small thing today"
        placeholderTextColor={colors.muted}
        value={line}
        onChangeText={setLine}
        multiline
      />

      <Text style={styles.label}>learned (optional)</Text>
      <TextInput
        style={styles.input}
        placeholder="anything you noticed"
        placeholderTextColor={colors.muted}
        value={line2}
        onChangeText={setLine2}
        multiline
      />

      {question && (
        <View style={styles.questionCard}>
          <View style={styles.questionHeader}>
            <Text style={styles.questionLabel}>today&apos;s question</Text>
            <TouchableOpacity onPress={() => setQuestionSkipped(!questionSkipped)}>
              <Text style={styles.skipText}>{questionSkipped ? 'answer instead' : 'skip'}</Text>
            </TouchableOpacity>
          </View>
          <AccentedText text={question.prompt} style={styles.questionPrompt} />

          {!questionSkipped && (
            <QuestionInput
              question={question}
              value={questionAnswer}
              onChange={setQuestionAnswer}
            />
          )}
        </View>
      )}

      <TouchableOpacity
        style={[styles.button, !canSave && styles.buttonDisabled]}
        onPress={handleSave}
        disabled={!canSave || isSaving}
      >
        {isSaving ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text style={styles.buttonText}>Save</Text>
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

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: DailyQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  if (question.format === 'chips' && question.options?.length) {
    return (
      <View style={styles.chipRow}>
        {question.options.map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.chip, value === option && styles.chipSelected]}
            onPress={() => onChange(option)}
          >
            <Text style={[styles.chipText, value === option && styles.chipTextSelected]}>
              {option}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  if (question.format === 'scale') {
    return (
      <View style={styles.chipRow}>
        {MOOD_VALUES.map((v) => (
          <TouchableOpacity
            key={v}
            style={[styles.chip, value === String(v) && styles.chipSelected]}
            onPress={() => onChange(String(v))}
          >
            <Text style={[styles.chipText, value === String(v) && styles.chipTextSelected]}>
              {v}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  if (question.format === 'binary') {
    return (
      <View style={styles.chipRow}>
        {['Yes', 'No'].map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.chip, value === option && styles.chipSelected]}
            onPress={() => onChange(option)}
          >
            <Text style={[styles.chipText, value === option && styles.chipTextSelected]}>
              {option}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  return (
    <TextInput
      style={styles.questionInput}
      placeholder="your answer"
      placeholderTextColor={colors.muted}
      value={value}
      onChangeText={onChange}
    />
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
    fontFamily: FONT_HEADER,
    fontSize: 22,
    color: colors.ink,
    marginBottom: 20,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.green,
    marginBottom: 8,
    marginTop: 4,
  },
  moodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  moodButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodButtonSelected: {
    borderColor: colors.green,
    backgroundColor: '#EAF3EA',
  },
  moodEmoji: {
    fontSize: 24,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
    color: colors.ink,
    marginBottom: 16,
    minHeight: 48,
  },
  questionCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.gold,
    padding: 16,
    marginBottom: 24,
  },
  questionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  questionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  skipText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
  },
  questionPrompt: {
    fontSize: 14,
    color: colors.ink,
    lineHeight: 19,
    marginBottom: 12,
  },
  questionInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    color: colors.ink,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 99,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipSelected: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
  },
  chipTextSelected: {
    color: '#fff',
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

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { AccentedText } from '@/components/AccentedText';
import { AppHeader } from '@/components/AppHeader';
import { KeyboardFriendlyScrollView } from '@/components/KeyboardFriendlyScrollView';
import { MessageDialog } from '@/components/MessageDialog';
import { VoiceMicButton } from '@/components/VoiceMicButton';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { MOOD_EMOJI, MOOD_VALUES } from '@/constants/mood';
import { STRINGS } from '@/constants/strings';
import { cardShadow, chipShape, chipTextShape, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  DailyQuestion,
  getDailyQuestion,
  getQuestionById,
  getTodayReflection,
  hasAnyCompletionToday,
  hasCompletedToday,
  isReflectionSubstantive,
  saveCompletion,
  saveReflection,
} from '@/lib/checkin';
import { getCircleById } from '@/lib/circle';
import { unlockAudioContext } from '@/lib/chime';
import { getLocalDateString } from '@/lib/date';
import { getGoalsSetQuestion } from '@/lib/goalsSet';
import * as haptics from '@/lib/haptics';
import { deriveCheckinAccent } from '@/lib/practice-accent';
import { getMyProfile, markVoiceHintSeen } from '@/lib/profile';

function appendTranscript(existing: string, transcript: string): string {
  if (!existing || /\s$/.test(existing)) return existing + transcript;
  return `${existing} ${transcript}`;
}

export default function CheckIn() {
  const router = useRouter();
  const { session } = useAuth();
  const { circleId } = useLocalSearchParams<{ circleId: string }>();
  const today = getLocalDateString();
  const reduceMotion = useReducedMotion();

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
  const [accent, setAccent] = useState('practice');
  const [micDenied, setMicDenied] = useState(false);
  const [showVoiceHint, setShowVoiceHint] = useState(false);

  const dismissVoiceHint = () => {
    if (!session?.user) return;
    setShowVoiceHint(false);
    markVoiceHintSeen(session.user.id).catch(() => {
      // low-stakes — the hint just might show again next time
    });
  };

  useEffect(() => {
    if (!circleId || !session?.user) return;
    (async () => {
      try {
        // reflection is per-person-per-day, not per-circle — if today's
        // already been done (from any circle), edit that same entry
        const [existing, alreadyCompletedThisCircle, circle, profile] = await Promise.all([
          getTodayReflection(today),
          hasCompletedToday({ userId: session.user.id, circleId, localDate: today }),
          getCircleById(circleId),
          getMyProfile(session.user.id),
        ]);
        setShowVoiceHint(!profile?.has_seen_voice_hint);
        setAccent(deriveCheckinAccent(circle?.practiceName));

        if (existing && isReflectionSubstantive(existing) && !alreadyCompletedThisCircle) {
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

  // GQ1: the second slot's question for today — deterministic from the
  // account-creation date (already on the auth session) and today's
  // local date, so a same-day re-open shows the same question with no
  // stored state. Skippable by simply leaving it blank; the key is
  // recorded either way (an empty answer IS the skip log).
  const goalsQuestion = session?.user?.created_at
    ? getGoalsSetQuestion(session.user.created_at, today)
    : null;

  const canSave = !!session?.user && !!circleId && mood !== null && line.trim().length > 0;

  const handleSave = async () => {
    if (!canSave || !session?.user || !circleId || mood === null) return;
    // Must happen synchronously inside this tap, before any await — iOS
    // Safari only unlocks an AudioContext created/resumed directly inside
    // a user gesture. Whether this save turns out to be the one that
    // earns the day (and so plays the glow beat's bowl instead of
    // checkin-pop) isn't known until after the awaits below, so every
    // save unlocks unconditionally; a redundant unlock is harmless.
    unlockAudioContext();
    setIsSaving(true);
    try {
      // G5: checked BEFORE saving so we can tell whether THIS save is the
      // one that earns the day — true only the first time any circle is
      // completed today; a second circle same day, or an edit of an
      // already-completed circle, both find this already true.
      const alreadyEarnedToday = await hasAnyCompletionToday({ userId: session.user.id, localDate: today });
      await saveCompletion({ userId: session.user.id, circleId, localDate: today });
      await saveReflection({
        userId: session.user.id,
        localDate: today,
        mood,
        line1: line.trim(),
        line2: line2.trim() || null,
        line2PromptKey: goalsQuestion?.key ?? null,
        questionId: question?.id ?? null,
        questionAnswer: questionSkipped ? null : questionAnswer.trim() || null,
        questionSkipped,
      });
      haptics.success({ reduceMotion });
      router.replace({
        pathname: '/checkin-complete',
        params: { circleId, earnedToday: alreadyEarnedToday ? undefined : 'true' },
      });
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
    // KB1: the reported screen — keyboard-friendly scroll (drag/tap to
    // dismiss, one-tap saves, focused input stays above the keyboard).
    <KeyboardFriendlyScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* D6 pattern: the house icon IS the "← Today" affordance here */}
      <AppHeader style={styles.brandmark} />

      <Text style={styles.title}>
        close your <Text style={styles.titleAccent}>{accent}</Text>
      </Text>

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
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.inputWithMic}
          placeholder="one small thing today"
          placeholderTextColor={colors.muted}
          value={line}
          onChangeText={setLine}
          multiline
        />
        {!micDenied && (
          <VoiceMicButton
            style={styles.inputMicButton}
            onTranscript={(text) => {
              setLine((prev) => appendTranscript(prev, text));
              dismissVoiceHint();
            }}
            onPermissionDenied={() => setMicDenied(true)}
          />
        )}
      </View>

      {showVoiceHint && !micDenied && (
        <TouchableOpacity onPress={dismissVoiceHint} style={styles.voiceHintCard}>
          <Text style={styles.voiceHintText}>{STRINGS.voiceMicDiscoveryHint}</Text>
        </TouchableOpacity>
      )}

      {/* GQ1: one goals-set question per day in the second slot (was
          "learned (optional)" every day). Cat's wording is verbatim and
          lowercase, so this line deliberately skips the label style's
          uppercase transform; the placeholder does the compassion work,
          and leaving it blank is the skip — never a confirmation. */}
      <Text style={styles.goalsQuestion}>
        {goalsQuestion?.question ?? 'learned (optional)'}
      </Text>
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.inputWithMic}
          placeholder={goalsQuestion?.placeholder ?? 'anything you noticed'}
          placeholderTextColor={colors.muted}
          value={line2}
          onChangeText={setLine2}
          multiline
        />
        {!micDenied && (
          <VoiceMicButton
            style={styles.inputMicButton}
            onTranscript={(text) => {
              setLine2((prev) => appendTranscript(prev, text));
              dismissVoiceHint();
            }}
            onPermissionDenied={() => setMicDenied(true)}
          />
        )}
      </View>

      {micDenied && <Text style={styles.micDeniedHint}>{STRINGS.voiceDictationDeniedHint}</Text>}

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
        variant="error"
        message={error ?? ''}
        onDismiss={() => setError(null)}
      />
    </KeyboardFriendlyScrollView>
  );
}

export function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: DailyQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  const [micDenied, setMicDenied] = useState(false);

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
    // Q3 (12 July, live cohort bug): the bank designs a real pair per
    // question (e.g. "want to" / "have to") — a hardcoded Yes/No here
    // flattened every binary question's own voice. Fall back to Yes/No
    // only when options is genuinely null or malformed (not exactly 2
    // entries), never as the normal path.
    const binaryOptions =
      question.options && question.options.length === 2
        ? question.options
        : [STRINGS.checkinBinaryFallbackYes, STRINGS.checkinBinaryFallbackNo];
    return (
      <View style={styles.chipRow}>
        {binaryOptions.map((option) => (
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
    <View style={styles.questionInputRow}>
      <TextInput
        style={[styles.questionInput, styles.questionInputFlex]}
        placeholder={STRINGS.checkinQuestionInputPlaceholder}
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChange}
      />
      {!micDenied && (
        <VoiceMicButton
          style={styles.questionInputMicButton}
          onTranscript={(text) => onChange(appendTranscript(value, text))}
          onPermissionDenied={() => setMicDenied(true)}
        />
      )}
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
    padding: 20,
    paddingBottom: 48,
  },
  brandmark: {
    marginBottom: 14,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 22,
    color: colors.ink,
    marginBottom: 20,
  },
  titleAccent: {
    fontFamily: FONT_SERIF_ITALIC,
    color: colors.green,
    fontSize: 25,
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
  // GQ1's second-slot question: the label slot's rhythm (green, bold,
  // above its input) but sentence-sized and never uppercased — the
  // cycle's wording is Cat's, verbatim and lowercase.
  goalsQuestion: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.green,
    lineHeight: 17,
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
    backgroundColor: colors.greenSoft,
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
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    marginBottom: 16,
  },
  inputWithMic: {
    flex: 1,
    padding: 14,
    fontSize: 14,
    color: colors.ink,
    minHeight: 48,
  },
  inputMicButton: {
    paddingRight: 12,
    paddingBottom: 14,
  },
  micDeniedHint: {
    fontSize: 11.5,
    color: colors.muted,
    marginTop: -8,
    marginBottom: 16,
  },
  voiceHintCard: {
    backgroundColor: colors.greenSoft,
    borderRadius: 12,
    padding: 10,
    marginTop: -8,
    marginBottom: 16,
  },
  voiceHintText: {
    fontSize: 11.5,
    color: colors.green,
    lineHeight: 16,
  },
  questionCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.gold,
    padding: 16,
    marginBottom: 24,
    ...cardShadow,
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
    color: colors.plum,
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
  questionInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  questionInputFlex: {
    flex: 1,
  },
  questionInputMicButton: {
    paddingBottom: 10,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    ...chipShape,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipSelected: {
    backgroundColor: colors.plum,
    borderColor: colors.plum,
  },
  chipText: {
    ...chipTextShape,
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

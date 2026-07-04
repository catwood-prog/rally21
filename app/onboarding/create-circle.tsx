import { useRouter } from 'expo-router';
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

import { MessageDialog } from '@/components/MessageDialog';
import { CATEGORIES } from '@/constants/practices';
import { FONT_HEADER } from '@/constants/fonts';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { createPractice, listPracticesByCategory, Practice, PracticeCategory } from '@/lib/circles';

export default function FindAPractice() {
  const router = useRouter();
  const { session } = useAuth();

  const [selectedCategory, setSelectedCategory] = useState<PracticeCategory | null>(null);
  const [practices, setPractices] = useState<Practice[]>([]);
  const [isLoadingPractices, setIsLoadingPractices] = useState(false);
  const [selectedPractice, setSelectedPractice] = useState<Practice | null>(null);

  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customDuration, setCustomDuration] = useState('');
  const [isCreatingPractice, setIsCreatingPractice] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const handleSelectCategory = async (category: PracticeCategory) => {
    setSelectedCategory(category);
    setSelectedPractice(null);
    setShowCustomForm(false);
    setIsLoadingPractices(true);
    try {
      setPractices(await listPracticesByCategory(category));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load practices');
    } finally {
      setIsLoadingPractices(false);
    }
  };

  const handleCreatePractice = async () => {
    if (!session?.user || !selectedCategory || !customName.trim()) return;
    setIsCreatingPractice(true);
    try {
      const durationMinutes = customDuration.trim() ? parseInt(customDuration.trim(), 10) : null;
      const practice = await createPractice({
        name: customName.trim(),
        category: selectedCategory,
        durationMinutes: durationMinutes && durationMinutes > 0 ? durationMinutes : null,
        createdBy: session.user.id,
      });
      setPractices((prev) => [practice, ...prev]);
      setSelectedPractice(practice);
      setShowCustomForm(false);
      setCustomName('');
      setCustomDuration('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save that — try again');
    } finally {
      setIsCreatingPractice(false);
    }
  };

  const handleContinue = () => {
    if (!selectedPractice) return;
    router.push({
      pathname: '/onboarding/commitment',
      params: { practiceKey: selectedPractice.key, practiceName: selectedPractice.name },
    });
  };

  if (!selectedCategory) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.push('/onboarding/circle-setup')}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>find a practice</Text>
        <Text style={styles.subtitle}>what kind of daily thing do you want to build?</Text>

        <View style={styles.categoryGrid}>
          {CATEGORIES.map((category) => (
            <TouchableOpacity
              key={category.key}
              style={styles.categoryTile}
              onPress={() => handleSelectCategory(category.key)}
            >
              <Text style={styles.categoryEmoji}>{category.emoji}</Text>
              <Text style={styles.categoryLabel}>{category.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <MessageDialog
          visible={!!error}
          title="hmm"
          message={error ?? ''}
          onDismiss={() => setError(null)}
        />
      </ScrollView>
    );
  }

  const category = CATEGORIES.find((c) => c.key === selectedCategory)!;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => setSelectedCategory(null)}>
        <Text style={styles.back}>← Categories</Text>
      </TouchableOpacity>

      <Text style={styles.title}>
        {category.emoji} {category.label}
      </Text>

      {isLoadingPractices ? (
        <ActivityIndicator color={colors.green} style={styles.loadingSpinner} />
      ) : (
        <>
          {practices.map((practice) => {
            const selected = practice.id === selectedPractice?.id;
            return (
              <TouchableOpacity
                key={practice.id}
                style={[styles.card, selected && styles.cardSelected]}
                onPress={() => setSelectedPractice(practice)}
              >
                <Text style={styles.cardTitle}>{practice.name}</Text>
                {!!practice.description && <Text style={styles.cardBody}>{practice.description}</Text>}
                {!practice.description && !!practice.durationMinutes && (
                  <Text style={styles.cardBody}>{practice.durationMinutes} minutes</Text>
                )}
              </TouchableOpacity>
            );
          })}

          {!showCustomForm ? (
            <TouchableOpacity style={styles.customButton} onPress={() => setShowCustomForm(true)}>
              <Text style={styles.customButtonText}>+ create your own</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.customForm}>
              <TextInput
                style={styles.input}
                placeholder="e.g. Walk 20 minutes"
                placeholderTextColor={colors.muted}
                value={customName}
                onChangeText={setCustomName}
                autoCorrect={false}
              />
              <TextInput
                style={styles.input}
                placeholder="duration in minutes (optional)"
                placeholderTextColor={colors.muted}
                value={customDuration}
                onChangeText={(text) => setCustomDuration(text.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
              />
              <TouchableOpacity
                style={[styles.addButton, !customName.trim() && styles.buttonDisabled]}
                onPress={handleCreatePractice}
                disabled={!customName.trim() || isCreatingPractice}
              >
                {isCreatingPractice ? (
                  <ActivityIndicator color={colors.ink} />
                ) : (
                  <Text style={styles.addButtonText}>Add practice</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      <TouchableOpacity
        style={[styles.button, !selectedPractice && styles.buttonDisabled]}
        onPress={handleContinue}
        disabled={!selectedPractice}
      >
        <Text style={styles.buttonText}>Continue</Text>
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
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 20,
    lineHeight: 19,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  categoryTile: {
    width: '47%',
    aspectRatio: 1.2,
    backgroundColor: colors.card,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryEmoji: {
    fontSize: 30,
    marginBottom: 8,
  },
  categoryLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
  },
  loadingSpinner: {
    marginTop: 20,
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
  customButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  customButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.green,
  },
  customForm: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginTop: 4,
    marginBottom: 10,
  },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 13,
    fontSize: 14,
    color: colors.ink,
    marginBottom: 10,
  },
  addButton: {
    backgroundColor: colors.green,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addButtonText: {
    fontWeight: '700',
    fontSize: 13,
    color: '#fff',
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    marginTop: 20,
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

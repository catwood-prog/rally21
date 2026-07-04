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
import { CATEGORIES } from '@/constants/practices';
import { FONT_HEADER } from '@/constants/fonts';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  countOpenCirclesByPractice,
  createPractice,
  listPracticesByCategory,
  Practice,
  PracticeCategory,
} from '@/lib/circles';

export default function FindAPractice() {
  const router = useRouter();
  const { session } = useAuth();

  const [selectedCategory, setSelectedCategory] = useState<PracticeCategory>('move');
  const [searchText, setSearchText] = useState('');
  const [practices, setPractices] = useState<Practice[]>([]);
  const [openCounts, setOpenCounts] = useState<Record<string, number>>({});
  const [isLoadingPractices, setIsLoadingPractices] = useState(true);
  const [selectedPractice, setSelectedPractice] = useState<Practice | null>(null);

  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customDuration, setCustomDuration] = useState('');
  const [isCreatingPractice, setIsCreatingPractice] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // open-circle counts span every practice, not just the active category
    // — fetch once and reuse as the category tabs are switched.
    countOpenCirclesByPractice().catch(() => {
      // the picker still works perfectly well without the count line
    }).then((counts) => counts && setOpenCounts(counts));
  }, []);

  useEffect(() => {
    setSelectedPractice(null);
    setShowCustomForm(false);
    setIsLoadingPractices(true);
    listPracticesByCategory(selectedCategory)
      .then(setPractices)
      .catch((e) => setError(e instanceof Error ? e.message : 'could not load practices'))
      .finally(() => setIsLoadingPractices(false));
  }, [selectedCategory]);

  const handleCreatePractice = async () => {
    if (!session?.user || !customName.trim()) return;
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

  const visiblePractices = practices.filter((p) =>
    p.name.toLowerCase().includes(searchText.trim().toLowerCase())
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => router.push('/onboarding/circle-setup')}>
        <Text style={styles.back}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Start a circle</Text>

      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Find a practice"
          placeholderTextColor={colors.muted}
          value={searchText}
          onChangeText={setSearchText}
          autoCorrect={false}
        />
      </View>

      <View style={styles.chipRow}>
        {CATEGORIES.map((category) => {
          const active = category.key === selectedCategory;
          return (
            <TouchableOpacity
              key={category.key}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setSelectedCategory(category.key)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{category.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {isLoadingPractices ? (
        <ActivityIndicator color={colors.green} style={styles.loadingSpinner} />
      ) : (
        <View style={styles.grid}>
          {visiblePractices.map((practice) => {
            const selected = practice.id === selectedPractice?.id;
            const count = openCounts[practice.id];
            const category = CATEGORIES.find((c) => c.key === practice.category);
            return (
              <TouchableOpacity
                key={practice.id}
                style={[styles.card, selected && styles.cardSelected]}
                onPress={() => setSelectedPractice(practice)}
              >
                <View style={styles.cardImage}>
                  <Text style={styles.cardImageEmoji}>{category?.emoji ?? '✨'}</Text>
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.cardName} numberOfLines={1}>
                    {practice.name}
                  </Text>
                  <Text style={styles.cardCount}>{count ? `${count} open circles` : ' '}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity style={styles.card} onPress={() => setShowCustomForm(true)}>
            <View style={[styles.cardImage, styles.customCardImage]}>
              <Text style={styles.customCardPlus}>+</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardName}>create your own</Text>
              <Text style={styles.cardCount}> </Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {showCustomForm && (
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
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.addButtonText}>Add practice</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity
        style={[styles.button, !selectedPractice && styles.buttonDisabled]}
        onPress={handleContinue}
        disabled={!selectedPractice}
      >
        <Text style={styles.buttonText}>Choose this</Text>
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
    padding: 20,
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
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 10,
    marginBottom: 14,
  },
  searchIcon: {
    fontSize: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.ink,
    padding: 0,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginBottom: 16,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 99,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.green,
  },
  chipActive: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  chipText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.green,
  },
  chipTextActive: {
    color: '#fff',
  },
  loadingSpinner: {
    marginTop: 20,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    width: '47%',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  cardSelected: {
    borderColor: colors.green,
  },
  cardImage: {
    height: 74,
    backgroundColor: '#EAF3EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardImageEmoji: {
    fontSize: 28,
  },
  customCardImage: {
    backgroundColor: colors.bg,
  },
  customCardPlus: {
    fontSize: 28,
    fontWeight: '300',
    color: colors.muted,
  },
  cardBody: {
    padding: 10,
  },
  cardName: {
    fontWeight: '700',
    fontSize: 12,
    color: colors.ink,
  },
  cardCount: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.green,
    marginTop: 3,
  },
  customForm: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginTop: 14,
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

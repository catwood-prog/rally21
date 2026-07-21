import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PRACTICE_TILES } from '@/assets/images/practices';

import { Brandmark } from '@/components/Brandmark';
import { KeyboardFriendlyScrollView } from '@/components/KeyboardFriendlyScrollView';
import { MicTextInput } from '@/components/MicTextInput';
import { MessageDialog } from '@/components/MessageDialog';
import { PracticePill } from '@/components/PracticePill';
import { PracticeTypePicker, PracticeTypeSelection } from '@/components/PracticeTypePicker';
import { CATEGORIES } from '@/constants/practices';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, chipShape, chipTextShape, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  countOpenCirclesByPractice,
  createPractice,
  listPracticesByCategory,
  Practice,
  PracticeCategory,
} from '@/lib/circle-setup';

export default function FindAPractice() {
  const router = useRouter();
  // NAV1 job 0 — no AppHeader on pre-signed-in-chrome screens, but the
  // safe-area inset still applies.
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { solo, fromToday, wantKey, wantStatement, suggestedName } = useLocalSearchParams<{
    solo?: string;
    fromToday?: string;
    wantKey?: string;
    wantStatement?: string;
    suggestedName?: string;
  }>();
  const isSolo = solo === 'true';
  const isFromToday = fromToday === 'true';
  // The wants act flow ("make this your next 21 days") lands here with a
  // suggested name already in hand — a want is inherently a personal,
  // one-off practice, so it opens straight into "create your own" rather
  // than the catalog grid, prefilled but fully editable (SCOPE: prefill
  // the existing flow as-is, don't restructure it).
  const wantParams = wantKey ? { wantKey, wantStatement: wantStatement ?? '' } : undefined;

  const [selectedCategory, setSelectedCategory] = useState<PracticeCategory>('move');
  const [searchText, setSearchText] = useState('');
  const [practices, setPractices] = useState<Practice[]>([]);
  const [openCounts, setOpenCounts] = useState<Record<string, number>>({});
  const [isLoadingPractices, setIsLoadingPractices] = useState(true);

  const [showCustomForm, setShowCustomForm] = useState(!!wantKey);
  const [customName, setCustomName] = useState(suggestedName ?? '');
  const [customDuration, setCustomDuration] = useState('');
  // PT1 guided creation: the classifier-suggested (or hand-picked)
  // domain + type. This selection is the ONLY category source for a new
  // practice — the browse chip above never leaks in again.
  const [customType, setCustomType] = useState<PracticeTypeSelection | null>(null);
  const [isCreatingPractice, setIsCreatingPractice] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isSolo) return; // solo circles never show open-circle counts to join
    countOpenCirclesByPractice().catch(() => {
      // the picker still works perfectly well without the count line
    }).then((counts) => counts && setOpenCounts(counts));
  }, [isSolo]);

  useEffect(() => {
    if (!session?.user) return;
    setShowCustomForm(false);
    setIsLoadingPractices(true);
    listPracticesByCategory(selectedCategory, session.user.id)
      .then(setPractices)
      .catch((e) => setError(e instanceof Error ? e.message : 'could not load practices'))
      .finally(() => setIsLoadingPractices(false));
  }, [selectedCategory, session?.user?.id]);

  const goToCommitment = (practice: Practice) => {
    router.push({
      pathname: '/onboarding/commitment',
      params: {
        practiceKey: practice.key,
        practiceName: practice.name,
        // Carried through so a solo "right now" check-in can route into the
        // timer/activity screen for a timed practice (see commitment.tsx).
        ...(practice.durationMinutes ? { practiceDurationMinutes: String(practice.durationMinutes) } : {}),
        ...(isSolo ? { solo: 'true' } : {}),
        ...(isFromToday ? { fromToday: 'true' } : {}),
        ...(wantParams ?? {}),
      },
    });
  };

  const handleSelectPractice = (practice: Practice) => {
    if (isSolo) {
      // solo mode never shows other people's circles to join
      goToCommitment(practice);
    } else {
      router.push({
        pathname: '/onboarding/practice-circles',
        params: {
          practiceId: practice.id,
          practiceKey: practice.key,
          practiceName: practice.name,
          ...(isFromToday ? { fromToday: 'true' } : {}),
        },
      });
    }
  };

  const handleCreatePractice = async () => {
    if (!session?.user || !customName.trim() || !customType) return;
    setIsCreatingPractice(true);
    try {
      const durationMinutes = customDuration.trim() ? parseInt(customDuration.trim(), 10) : null;
      // PT1: the type comes from the confirmed classifier selection,
      // NEVER from selectedCategory (the browse chip) — that inheritance
      // was the root cause of "Read before bed" landing in Move. CF1
      // finished the job: the client no longer sends a category at all;
      // the server derives the shelf from the type.
      const practice = await createPractice({
        name: customName.trim(),
        practiceType: customType.type,
        durationMinutes: durationMinutes && durationMinutes > 0 ? durationMinutes : null,
        createdBy: session.user.id,
      });
      // a practice that was just created can't have any open circles yet
      // — go straight to setting up the first one rather than showing an
      // empty-state screen just to click through it.
      goToCommitment(practice);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save that — try again');
      setIsCreatingPractice(false);
    }
  };

  const visiblePractices = practices.filter((p) =>
    p.name.toLowerCase().includes(searchText.trim().toLowerCase())
  );

  return (
    <KeyboardFriendlyScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: 20 + insets.top }]}
    >
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity onPress={() => router.push(isFromToday ? '/today' : '/onboarding/circle-setup')}>
        <Text style={styles.back}>{isFromToday ? '← Today' : '← Back'}</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{isSolo ? 'find your practice' : 'Start a circle'}</Text>

      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <MicTextInput
          containerStyle={styles.searchInputRow}
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
          {/* PB1 safety net: an empty shelf (a future prune, or a search
              with no match) never reads as just a bare + card. */}
          {visiblePractices.length === 0 && (
            <Text style={styles.emptyShelfLine}>{STRINGS.browseEmptyShelf}</Text>
          )}
          {visiblePractices.map((practice) => {
            const count = openCounts[practice.id];
            const category = CATEGORIES.find((c) => c.key === practice.category);
            return (
              <TouchableOpacity
                key={practice.id}
                style={styles.card}
                onPress={() => handleSelectPractice(practice)}
              >
                {/* PT2: the photographic tile, keyed by type key. A type
                    with no generated file (or any future key this bundle
                    predates) falls back to the emoji-on-mint treatment —
                    never a broken image. */}
                {PRACTICE_TILES[practice.practiceType] ? (
                  <Image
                    source={PRACTICE_TILES[practice.practiceType]}
                    style={styles.cardImage}
                    resizeMode="cover"
                    accessible={false}
                  />
                ) : (
                  <View style={[styles.cardImage, styles.cardImageFallback]}>
                    <Text style={styles.cardImageEmoji}>{category?.emoji ?? '✨'}</Text>
                  </View>
                )}
                <View style={styles.cardBody}>
                  <Text style={styles.cardName} numberOfLines={1}>
                    {practice.name}
                  </Text>
                  {!practice.isShared && practice.createdBy === session?.user?.id && (
                    <PracticePill variant="only-you" />
                  )}
                  <Text style={styles.cardCount}>
                    {!isSolo && count ? STRINGS.openCirclesCount(count) : ' '}
                  </Text>
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
          <Text style={styles.customFormTitle}>{STRINGS.practiceStepQuestion}</Text>
          <MicTextInput
            style={styles.input}
            placeholder="e.g. Walk 20 minutes"
            placeholderTextColor={colors.muted}
            value={customName}
            onChangeText={setCustomName}
            autoCorrect={false}
          />
          <PracticeTypePicker name={customName} value={customType} onChange={setCustomType} />
          <TextInput
            style={styles.input}
            placeholder="duration in minutes (optional)"
            placeholderTextColor={colors.muted}
            value={customDuration}
            onChangeText={(text) => setCustomDuration(text.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
          />
          <TouchableOpacity
            style={[styles.addButton, (!customName.trim() || !customType) && styles.buttonDisabled]}
            onPress={handleCreatePractice}
            disabled={!customName.trim() || !customType || isCreatingPractice}
          >
            {isCreatingPractice ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.addButtonText}>Add practice</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <MessageDialog
        visible={!!error}
        title="hmm"
        message={error ?? ''}
        onDismiss={() => setError(null)}
      />
    </KeyboardFriendlyScrollView>
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
  // KB1: the mic row fills the search bar's flexible slot; the input
  // keeps flex:1 inside it via MicTextInput's own row styles.
  searchInputRow: {
    flex: 1,
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
    ...chipShape,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.green,
  },
  chipActive: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  chipText: {
    ...chipTextShape,
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
  emptyShelfLine: {
    width: '100%',
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
  },
  card: {
    width: '47%',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.card,
    ...cardShadow,
  },
  // PT2: taller image area per the browse mockup (rev. of 13 July) so a
  // photo reads as a photo, not a strip; width stays the card's own.
  cardImage: {
    height: 118,
    width: '100%',
    backgroundColor: colors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardImageFallback: {
    backgroundColor: colors.greenSoft,
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
    ...cardShadow,
  },
  customFormTitle: {
    fontFamily: FONT_HEADER,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 12,
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
  buttonDisabled: {
    opacity: 0.5,
  },
});

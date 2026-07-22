import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PRACTICE_TILES } from '@/assets/images/practices';

import { Brandmark } from '@/components/Brandmark';
import { KeyboardFriendlyScrollView } from '@/components/KeyboardFriendlyScrollView';
import { MicTextInput } from '@/components/MicTextInput';
import { MessageDialog } from '@/components/MessageDialog';
import { PracticePill } from '@/components/PracticePill';
import { CATEGORIES } from '@/constants/practices';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, chipShape, chipTextShape, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  countOpenCirclesByPractice,
  listAllPractices,
  Practice,
  PracticeCategory,
} from '@/lib/circle-setup';
import { classifyPracticeName, groupingLine } from '@/lib/practiceTaxonomy';

/**
 * CF2 screen 1 — "choose a practice" (Cat's approved redesign, 21 July).
 * The governing mental model: choose the PRACTICE, then choose HOW to
 * practise it (solo / circle / join — all of that lives on the practice
 * hub, not here). Creating a practice is an explicit utility row, never
 * a browse result — the old create-your-own tile is gone. The domain
 * chips are FILTER ONLY: provably disconnected from creation (the create
 * row carries no domain, and CF1 removed the category param from the
 * save path entirely).
 *
 * Solo intent (SF1's fork card) rides through as ?solo=true: counts stay
 * hidden and tapping a practice goes straight to solo setup — the "how"
 * was already chosen, so the hub would only add a tap.
 */
export default function ChooseAPractice() {
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

  const carriedParams = {
    ...(isSolo ? { solo: 'true' } : {}),
    ...(isFromToday ? { fromToday: 'true' } : {}),
  };

  // The wants act flow ("make this your next 21 days") — a want is
  // inherently a personal, one-off practice, so it opens straight into
  // the dedicated create screen, prefilled but fully editable.
  useEffect(() => {
    if (!wantKey) return;
    router.replace({
      pathname: '/onboarding/create-practice',
      params: {
        ...carriedParams,
        wantKey,
        wantStatement: wantStatement ?? '',
        ...(suggestedName ? { suggestedName } : {}),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantKey]);

  const [selectedCategory, setSelectedCategory] = useState<PracticeCategory>('move');
  const [searchText, setSearchText] = useState('');
  const [practices, setPractices] = useState<Practice[]>([]);
  const [openCounts, setOpenCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isSolo) return; // solo never shows other people's circles to join
    countOpenCirclesByPractice()
      .catch(() => {
        // the picker still works perfectly well without the count line
      })
      .then((counts) => counts && setOpenCounts(counts));
  }, [isSolo]);

  useEffect(() => {
    if (!session?.user) return;
    listAllPractices(session.user.id)
      .then(setPractices)
      .catch((e) => setError(e instanceof Error ? e.message : 'could not load practices'))
      .finally(() => setIsLoading(false));
  }, [session?.user?.id]);

  const practiceNavParams = (practice: Practice) => ({
    practiceId: practice.id,
    practiceKey: practice.key,
    practiceName: practice.name,
    practiceType: practice.practiceType,
    ...(practice.timerSuggested ? { timerSuggested: 'true' } : {}),
    ...(practice.durationMinutes ? { defaultDuration: String(practice.durationMinutes) } : {}),
    ...(!practice.isShared && practice.createdBy === session?.user?.id
      ? { privateCustom: 'true' }
      : {}),
    ...carriedParams,
  });

  const handleSelectPractice = (practice: Practice) => {
    router.push({
      pathname: isSolo ? '/onboarding/solo-setup' : '/onboarding/practice-hub',
      params: practiceNavParams(practice),
    });
  };

  // Search matches across EVERY domain — by name, or by the classifier's
  // own keyword tables ("yoga" finds Stretch & Yoga even from the Move
  // chip; one synonym system, never a second). While a search is live
  // the chips step back; clearing it returns to the chip's shelf.
  const search = searchText.trim().toLowerCase();
  const synonymType = search ? classifyPracticeName(search)?.type : undefined;
  const visiblePractices = search
    ? practices.filter(
        (p) => p.name.toLowerCase().includes(search) || (synonymType && p.practiceType === synonymType)
      )
    : practices.filter((p) => p.category === selectedCategory);

  return (
    <KeyboardFriendlyScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: 20 + insets.top }]}
    >
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity onPress={() => router.push(isFromToday ? '/today' : '/onboarding/circle-setup')}>
        <Text style={styles.back}>{isFromToday ? '← today' : '← back'}</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{STRINGS.choosePracticeTitle}</Text>

      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <MicTextInput
          containerStyle={styles.searchInputRow}
          style={styles.searchInput}
          placeholder={STRINGS.findPracticePlaceholder}
          placeholderTextColor={colors.muted}
          value={searchText}
          onChangeText={setSearchText}
          autoCorrect={false}
        />
      </View>

      {/* The two explicit utility rows — creating an object and using a
          code are ACTIONS, not browse results. The invite-code row reuses
          the existing code-entry flow: one implementation, ever. */}
      <TouchableOpacity
        style={[styles.utilityRow, styles.utilityRowCreate]}
        onPress={() => router.push({ pathname: '/onboarding/create-practice', params: carriedParams })}
      >
        <Text style={styles.utilityRowCreateText}>{STRINGS.createPracticeRow}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.utilityRow}
        onPress={() =>
          router.push({
            pathname: '/onboarding/join-circle',
            params: isFromToday ? { fromToday: 'true' } : {},
          })
        }
      >
        <Text style={styles.utilityRowText}>{STRINGS.inviteCodeRow}</Text>
      </TouchableOpacity>

      <View style={styles.chipRow}>
        {CATEGORIES.map((category) => {
          const active = !search && category.key === selectedCategory;
          return (
            <TouchableOpacity
              key={category.key}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => {
                setSearchText('');
                setSelectedCategory(category.key);
              }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{category.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.green} style={styles.loadingSpinner} />
      ) : (
        <View style={styles.grid}>
          {visiblePractices.length === 0 && (
            <Text style={styles.emptyShelfLine}>{STRINGS.browseEmptyShelf}</Text>
          )}
          {visiblePractices.map((practice) => {
            const count = openCounts[practice.id];
            const category = CATEGORIES.find((c) => c.key === practice.category);
            const grouping = groupingLine(practice.practiceType);
            return (
              <TouchableOpacity
                key={practice.id}
                style={styles.card}
                onPress={() => handleSelectPractice(practice)}
              >
                {/* PT2: the photographic tile, keyed by type key; emoji
                    fallback, never a broken image. */}
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
                  {grouping && <Text style={styles.cardGrouping}>{grouping}</Text>}
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
        </View>
      )}

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
    marginBottom: 10,
  },
  searchIcon: {
    fontSize: 12,
  },
  searchInputRow: {
    flex: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.ink,
    padding: 0,
  },
  utilityRow: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  // Gold = action (colour roles): creating a practice is the flow's
  // primary constructive act.
  utilityRowCreate: {
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
  },
  utilityRowCreateText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.ink,
  },
  utilityRowText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: colors.ink,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 8,
    marginBottom: 16,
  },
  chip: {
    ...chipShape,
    backgroundColor: colors.card,
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
  cardBody: {
    padding: 10,
  },
  cardName: {
    fontWeight: '700',
    fontSize: 12,
    color: colors.ink,
  },
  cardGrouping: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 2,
    marginBottom: 2,
  },
  cardCount: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.green,
    marginTop: 3,
  },
});

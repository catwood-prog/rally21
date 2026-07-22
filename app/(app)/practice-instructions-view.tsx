import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { LinkCard } from '@/components/LinkCard';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { getCircleById, MyCircle } from '@/lib/circle';

/**
 * PI1 — the read-only practice-instructions page: the whole circle sees it,
 * reached from the quiet "practice instructions →" link that only appears
 * on the circle screen when instructions exist. Shows the routine text and
 * the link if one is set; nothing is editable here (the host edits from
 * edit-circle). Refetches on focus like every shared-data screen — the
 * host may have just changed the routine (CLAUDE.md's refetch-on-focus
 * rule). Reachable only with instructions present by construction, but it
 * still degrades gracefully (missing circle or an instructions-cleared
 * race → back to the circle).
 */
export default function PracticeInstructionsView() {
  const router = useRouter();
  const { circleId } = useLocalSearchParams<{ circleId?: string }>();
  const [circle, setCircle] = useState<MyCircle | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!circleId) {
      router.replace('/circle');
      return;
    }
    try {
      const c = await getCircleById(circleId);
      setCircle(c);
    } catch {
      setCircle(null);
    } finally {
      setIsLoading(false);
    }
  }, [circleId, router]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const goBack = () =>
    router.push(
      circleId ? { pathname: '/circle', params: { circleId } } : '/circle'
    );

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  const instructions = circle?.instructions?.trim() ?? '';
  const link = circle?.resourceUrl ?? null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <AppHeader style={styles.brandmark} />
      <TouchableOpacity onPress={goBack}>
        <Text style={styles.back}>{STRINGS.practiceInstructionsViewBack}</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{STRINGS.practiceInstructionsTitle}</Text>

      {/* Reached only when instructions exist; the empty case is a
          cleared-out-from-under-you race — the ← link above is the way
          back, so no empty shell renders here. */}
      {!!instructions && <Text style={styles.body}>{instructions}</Text>}

      {link && (
        <View style={styles.linkSection}>
          <Text style={styles.linkLabel}>{STRINGS.practiceInstructionsViewLinkLabel}</Text>
          <LinkCard url={link} />
        </View>
      )}
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
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
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
    marginBottom: 16,
  },
  body: {
    fontSize: 15,
    color: colors.ink,
    lineHeight: 23,
  },
  linkSection: {
    marginTop: 28,
  },
  linkLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.green,
    marginBottom: 8,
  },
});

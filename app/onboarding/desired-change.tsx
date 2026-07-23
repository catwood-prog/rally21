import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brandmark } from '@/components/Brandmark';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  DESIRED_CHANGE_KEYS,
  DesiredChange,
  domainForDesiredChange,
  setOnboardingDesiredChange,
} from '@/lib/onboardingIntake';

/**
 * ON1 (23 July) — Q1 of the Day-0 intake: "what would you most like these
 * 21 days to change?" Shown ONLY in the creator + solo Day-0 flow, right
 * after the solo/circle fork and BEFORE the practice browse. Its answer is
 * stored on the user and pre-selects the browse's domain chip so the first
 * recommendation feels like service, not a blank browse. 'connection' is
 * answered by the circle itself, not a practice domain, so it opens the
 * browse unfiltered with the invite step emphasized. Both skippable — a
 * warm skip stores nothing and just moves on.
 */
export default function DesiredChange() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { solo, fromToday } = useLocalSearchParams<{ solo?: string; fromToday?: string }>();
  const [saving, setSaving] = useState(false);

  const carried = {
    ...(solo === 'true' ? { solo: 'true' } : {}),
    ...(fromToday === 'true' ? { fromToday: 'true' } : {}),
  };

  const goToBrowse = (extra: Record<string, string>) =>
    router.replace({ pathname: '/onboarding/create-circle', params: { ...carried, ...extra } });

  const choose = async (key: DesiredChange) => {
    if (saving) return;
    setSaving(true);
    // Best-effort: a failed save never blocks onboarding — the browse
    // still opens (unfiltered), it just won't be pre-filtered this time.
    if (session?.user) {
      await setOnboardingDesiredChange(session.user.id, key).catch(() => {});
    }
    const domain = domainForDesiredChange(key);
    goToBrowse(domain ? { domain } : { intent: 'connection' });
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: 24 + insets.top }]}
    >
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity style={styles.back} onPress={() => (router.canGoBack() ? router.back() : goToBrowse({}))}>
        <Text style={styles.backText}>← back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{STRINGS.onboardingQ1Title}</Text>
      <Text style={styles.subtitle}>{STRINGS.onboardingQ1Subtitle}</Text>

      {DESIRED_CHANGE_KEYS.map((key) => (
        <TouchableOpacity key={key} style={styles.card} onPress={() => choose(key)} disabled={saving}>
          <Text style={styles.cardText}>{STRINGS.onboardingDesiredChangeLabels[key]}</Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={styles.skip} onPress={() => goToBrowse({})} disabled={saving}>
        <Text style={styles.skipText}>{STRINGS.onboardingSkip}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 24, paddingBottom: 40 },
  brandmark: { marginBottom: 18 },
  back: { marginBottom: 18 },
  backText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  title: { fontFamily: FONT_HEADER, fontSize: 25, lineHeight: 30, color: colors.ink },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 8, marginBottom: 22 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    ...cardShadow,
  },
  cardText: { fontSize: 15, color: colors.ink, fontWeight: '600' },
  skip: { marginTop: 6, alignItems: 'center', paddingVertical: 12, minHeight: 44, justifyContent: 'center' },
  skipText: { fontSize: 13, color: colors.muted },
});

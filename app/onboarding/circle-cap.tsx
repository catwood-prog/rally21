import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brandmark } from '@/components/Brandmark';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { colors, scaledLineHeight } from '@/constants/theme';
import { MAX_CIRCLES } from '@/lib/caps';

const CAP_WORD: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three' };

export default function CircleCap() {
  const router = useRouter();
  // NAV1 job 0 — no AppHeader on pre-signed-in-chrome screens, but the
  // safe-area inset still applies.
  const insets = useSafeAreaInsets();
  const { cap: capParam } = useLocalSearchParams<{ cap?: string }>();
  const cap = Number(capParam) || MAX_CIRCLES;
  const capWord = CAP_WORD[cap] ?? String(cap);

  return (
    // OD1 job 17a — the brandmark is absolutely positioned against the
    // screen, so it stays OUTSIDE the scroll (scrolling it would peel it
    // off the top edge); everything else moves inside, where at large
    // Dynamic Type the body copy and both buttons used to run off-screen
    // with no way to reach them.
    <View style={styles.container}>
      <Brandmark style={[styles.brandmark, { top: 20 + insets.top }]} />
      <ScrollView
        style={styles.scroll}
        // Only the real insets are added, never extra padding: both
        // resolve to 0 on web, so web centring stays pixel-identical
        // (job 17d) while iOS keeps clear of the notch and home indicator.
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <Text style={styles.emoji}>🌱</Text>
        <Text style={styles.title}>
          {capWord} circles is <Text style={styles.titleAccent}>a full life</Text>
        </Text>
        <Text style={styles.body}>
          You&apos;re showing up in {capWord} places already — that&apos;s the whole point. To join
          another, finish a 21-day arc, or leave one from its circle screen — your check-ins stay
          yours either way.
        </Text>

        <TouchableOpacity style={styles.button} onPress={() => router.replace('/today')}>
          <Text style={styles.buttonText}>Back to Today</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryLink} onPress={() => router.replace('/circle')}>
          <Text style={styles.secondaryLinkText}>Manage my circles</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 26,
  },
  brandmark: {
    position: 'absolute',
    top: 20,
    left: 24,
  },
  emoji: {
    fontSize: 32,
    marginBottom: 12,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 21,
    color: colors.ink,
    textAlign: 'center',
    // OD1 job 17c — YD1's fix: a fixed lineHeight on wrapping copy clips
    // its tail under iOS Dynamic Type. Unchanged on web and Android.
    lineHeight: scaledLineHeight(27),
    marginBottom: 14,
  },
  titleAccent: {
    fontFamily: FONT_SERIF_ITALIC,
    color: colors.green,
    fontSize: 24,
  },
  body: {
    fontSize: 13.5,
    color: colors.muted,
    textAlign: 'center',
    // OD1 job 17c — the longest copy on the screen, so the worst clipper.
    lineHeight: scaledLineHeight(20),
    marginBottom: 28,
  },
  button: {
    width: '100%',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
  secondaryLink: {
    marginTop: 14,
  },
  secondaryLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
});

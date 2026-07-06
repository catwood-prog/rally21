import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, TouchableWithoutFeedback, View } from 'react-native';

import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';

const AUTO_ADVANCE_MS = 1600;

/** Screen 1 of the pre-sign-in intro (rev-7 mockup) — signed-in users
 * never see this, see app/index.tsx. Brief by design: auto-advances, or
 * a single tap skips straight to the welcome screen. */
export default function Splash() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => router.replace('/welcome'), AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <TouchableWithoutFeedback onPress={() => router.replace('/welcome')}>
      <View style={styles.container}>
        <View style={styles.center}>
          <View style={styles.mark}>
            <Text style={styles.markLetter}>R</Text>
          </View>
          {/* Not the shared <Brandmark /> — the mockup renders "21" in ink,
              not the usual gold, since gold-on-gold is invisible here. */}
          <Text style={styles.brand}>
            Rally<Text style={styles.brandAccent}>21</Text>
          </Text>
          <Text style={styles.tagline}>{STRINGS.introSplashTagline}</Text>
        </View>
        <Text style={styles.subtitle}>{STRINGS.introSplashSubtitle}</Text>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
  },
  mark: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  markLetter: {
    fontFamily: FONT_HEADER,
    fontSize: 34,
    color: colors.gold,
  },
  brand: {
    fontFamily: FONT_HEADER,
    fontSize: 36,
    letterSpacing: -0.6,
    color: colors.ink,
  },
  brandAccent: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 42,
    color: colors.ink,
  },
  tagline: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(38, 38, 38, 0.65)',
    marginTop: 4,
  },
  subtitle: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    color: 'rgba(38, 38, 38, 0.5)',
  },
});

import { useRouter } from 'expo-router';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { MASCOT } from '@/assets/mascot';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';

/** Screen 2 of the pre-sign-in intro (rev-7 mockup) — signed-in users
 * never see this, see app/index.tsx. */
export default function Welcome() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Image
        source={MASCOT.huddle}
        style={styles.image}
        resizeMode="contain"
        accessible={false}
        alt=""
      />

      <View style={styles.body}>
        <Text style={styles.title}>
          {STRINGS.introWelcomeTitleLead}
          <Text style={styles.titleAccent}>{STRINGS.introWelcomeTitleAccent}</Text>
        </Text>
        <Text style={styles.subtitle}>{STRINGS.introWelcomeBody}</Text>
        <View style={styles.dots}>
          <View style={[styles.dot, styles.dotActive]} />
          <View style={styles.dot} />
          <View style={styles.dot} />
        </View>
      </View>

      <TouchableOpacity style={styles.button} onPress={() => router.replace('/privacy-promise')}>
        <Text style={styles.buttonText}>{STRINGS.introWelcomeNext}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.replace('/sign-in')}>
        <Text style={styles.signInLink}>{STRINGS.introWelcomeSignInLink}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  image: {
    width: '100%',
    height: 260,
    marginTop: 20,
  },
  body: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 8,
    alignItems: 'center',
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.4,
    color: colors.ink,
    textAlign: 'center',
  },
  titleAccent: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 32,
    color: colors.green,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 12,
  },
  dots: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 20,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 9,
    backgroundColor: colors.line,
  },
  dotActive: {
    width: 22,
    backgroundColor: colors.green,
  },
  button: {
    marginHorizontal: 16,
    backgroundColor: colors.gold,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
  signInLink: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
    paddingBottom: 20,
  },
});

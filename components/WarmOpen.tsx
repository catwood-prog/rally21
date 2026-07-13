import { useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { MASCOT } from '@/assets/mascot';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';

const AUTO_ADVANCE_MS = 1800;

/** The brief "don't do it alone. do it together." moment shown once per
 * signed-in cold open (WO1) — see app/index.tsx, the only mount site. */
export function WarmOpen({ onDone }: { onDone: () => void }) {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const timer = setTimeout(onDone, AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <Pressable style={styles.container} onPress={onDone}>
      <Image
        source={MASCOT.invitationHuddle}
        style={styles.image}
        resizeMode="contain"
        accessible={false}
        alt=""
        fadeDuration={reduceMotion ? 0 : undefined}
      />
      <Text style={styles.title}>
        {STRINGS.introWelcomeTitleLead}
        <Text style={styles.titleAccent}>{STRINGS.introWelcomeTitleAccent}</Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  image: {
    width: '100%',
    height: 260,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.4,
    color: colors.ink,
    textAlign: 'center',
    marginTop: 24,
  },
  titleAccent: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 32,
    color: colors.green,
  },
});

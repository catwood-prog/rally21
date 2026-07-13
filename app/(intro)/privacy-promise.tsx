import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';

/** Screen 3 of the pre-sign-in intro (rev-7 mockup) — signed-in users
 * never see this, see app/index.tsx. */
export default function PrivacyPromise() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <Svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke={colors.green} strokeWidth={2}>
            <Path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" />
            <Path d="M9 12l2 2 4-4" />
          </Svg>
        </View>

        <Text style={styles.title}>
          {STRINGS.introPrivacyTitleLead}
          {'\n'}
          <Text style={styles.titleAccent}>{STRINGS.introPrivacyTitleAccent}</Text>
        </Text>

        <View style={styles.bulletList}>
          {STRINGS.introPrivacyBullets.map((bullet) => (
            <View key={bullet} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>●</Text>
              <Text style={styles.bulletText}>{bullet}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity onPress={() => router.push('/privacy')} hitSlop={8}>
          <Text style={styles.fullPolicyLink}>{STRINGS.introPrivacyReadFullLink}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.button} onPress={() => router.replace('/sign-in')}>
        <Text style={styles.buttonText}>{STRINGS.introPrivacyCta}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  body: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 23,
    lineHeight: 27,
    color: colors.ink,
    textAlign: 'center',
  },
  titleAccent: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 28,
    color: colors.green,
  },
  bulletList: {
    width: '100%',
    marginTop: 22,
    gap: 14,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  bulletDot: {
    fontSize: 15,
    color: colors.green,
    lineHeight: 19,
  },
  bulletText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.ink,
  },
  fullPolicyLink: {
    marginTop: 20,
    fontSize: 12,
    color: colors.muted,
    textDecorationLine: 'underline',
  },
  button: {
    marginHorizontal: 16,
    backgroundColor: colors.green,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 20,
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
    color: '#fff',
  },
});

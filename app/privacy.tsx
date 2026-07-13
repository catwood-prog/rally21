import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Brandmark } from '@/components/Brandmark';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';

/** Public, signed-out-accessible privacy policy — the "privacy policy
 * URL" TestFlight/App Store Connect asks for. Deliberately a top-level
 * route (not under (app) or (intro)), since those groups gate on auth
 * state or a specific onboarding sequence; this must load for anyone,
 * signed in or not, with no redirect. */
export default function Privacy() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Brandmark style={styles.brandmark} />
      <Text style={styles.title}>{STRINGS.privacyPolicyTitle}</Text>
      <Text style={styles.effectiveDate}>{STRINGS.privacyPolicyEffectiveDate}</Text>
      <Text style={styles.intro}>{STRINGS.privacyPolicyIntro}</Text>

      {STRINGS.privacyPolicySections.map((section) => (
        <View key={section.heading} style={styles.section}>
          <Text style={styles.heading}>{section.heading}</Text>
          <Text style={styles.body}>{section.body}</Text>
        </View>
      ))}
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
    paddingBottom: 64,
  },
  brandmark: {
    marginBottom: 20,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 24,
    color: colors.ink,
    marginBottom: 4,
  },
  effectiveDate: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 18,
  },
  intro: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.ink,
    marginBottom: 28,
  },
  section: {
    marginBottom: 22,
  },
  heading: {
    fontFamily: FONT_HEADER,
    fontSize: 15.5,
    color: colors.ink,
    marginBottom: 6,
  },
  body: {
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.ink,
  },
});

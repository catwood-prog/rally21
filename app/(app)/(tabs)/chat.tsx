import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MASCOT } from '@/assets/mascot';
import { Brandmark } from '@/components/Brandmark';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';

export default function Chat() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Brandmark style={styles.brandmark} />
        <Text style={styles.title}>{STRINGS.chatTabLabel}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Image
          source={MASCOT.waving}
          style={styles.mascotImage}
          resizeMode="contain"
          accessible={false}
          alt=""
        />
        <Text style={styles.introText}>{STRINGS.chatIntroMessage}</Text>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{STRINGS.chatComingSoonPill}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  brandmark: {
    marginBottom: 10,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 20,
    color: colors.ink,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    padding: 24,
    paddingTop: 32,
    paddingBottom: 40,
  },
  mascotImage: {
    width: 80,
    height: 94,
    marginBottom: 20,
  },
  introText: {
    fontSize: 13.5,
    color: colors.ink,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  pill: {
    backgroundColor: colors.gold,
    borderRadius: 99,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.ink,
  },
});

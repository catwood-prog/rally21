import { Linking, Platform, StyleProp, StyleSheet, Text, TouchableOpacity, ViewStyle } from 'react-native';

import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { getUrlDomain } from '@/lib/resourceLink';

export function LinkCard({
  url,
  style,
  light = false,
}: {
  url: string;
  style?: StyleProp<ViewStyle>;
  /** For dark screens like the check-in activity screen. */
  light?: boolean;
}) {
  const handleOpen = () => {
    if (Platform.OS === 'web') {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      Linking.openURL(url);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.card, light && styles.cardLight, style]}
      onPress={handleOpen}
      accessibilityRole="link"
    >
      <Text style={[styles.domain, light && styles.textLight]} numberOfLines={1}>
        {getUrlDomain(url)}
      </Text>
      <Text style={[styles.cta, light && styles.ctaLight]}>{STRINGS.linkCardOpenCta}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 16,
  },
  cardLight: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.2)',
  },
  domain: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 6,
  },
  textLight: {
    color: colors.onFill,
  },
  cta: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.greenText,
  },
  ctaLight: {
    color: colors.gold,
  },
});

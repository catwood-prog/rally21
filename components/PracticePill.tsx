import { StyleSheet, Text } from 'react-native';

import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';

/** Marks whether a custom practice is visible to others or just its
 * creator — never shown on seeded practices, since every seeded one is
 * always shared by definition (see CLAUDE.md's practice-privacy rule). */
export function PracticePill({ variant }: { variant: 'shared' | 'only-you' }) {
  const isShared = variant === 'shared';
  return (
    <Text style={[styles.pill, isShared ? styles.pillShared : styles.pillOnlyYou]}>
      {isShared ? STRINGS.practicePillShared : STRINGS.practicePillOnlyYou}
    </Text>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: 99,
    overflow: 'hidden',
  },
  pillShared: {
    color: colors.green,
    backgroundColor: colors.greenSoft,
  },
  pillOnlyYou: {
    color: colors.muted,
    backgroundColor: colors.line,
  },
});

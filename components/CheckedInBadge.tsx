import { StyleSheet, Text } from 'react-native';

import { colors } from '@/constants/theme';

/** The small badge overlaid on an Avatar's corner — always paired with
 * `<Avatar ring={state === 'pending' ? 'pending' : state} />`. A covered
 * day gets its own orange 🧡 rather than the green ✓, so it never reads as
 * an ordinary checkmark (see CLAUDE.md's cover-a-friend rule — covered
 * is a distinct, celebrated state, not a quiet substitute for done). */
export function CheckedInBadge({ state }: { state: 'done' | 'covered' | 'pending' }) {
  if (state === 'pending') return null;
  return (
    <Text style={[styles.badge, state === 'covered' && styles.badgeCovered]}>
      {state === 'covered' ? '🧡' : '✓'}
    </Text>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.bg,
    backgroundColor: colors.green,
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 12,
    overflow: 'hidden',
  },
  badgeCovered: {
    backgroundColor: colors.gold,
    fontSize: 8,
  },
});

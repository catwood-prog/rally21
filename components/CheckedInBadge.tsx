import { StyleSheet, Text } from 'react-native';

import { colors } from '@/constants/theme';

/** The small green checkmark badge overlaid on an Avatar's corner —
 * always paired with `<Avatar ring={visible ? 'done' : 'pending'} />`. */
export function CheckedInBadge({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return <Text style={styles.badge}>✓</Text>;
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
});

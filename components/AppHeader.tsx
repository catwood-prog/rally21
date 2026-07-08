import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleProp, StyleSheet, TouchableOpacity, View, ViewStyle } from 'react-native';

import { Brandmark } from '@/components/Brandmark';
import { colors } from '@/constants/theme';

/**
 * D6 (7 July) — the shared top-bar chrome: brandmark top-left, a house
 * icon (→ /today) and a gear icon (→ /settings) top-right, replacing
 * the written "Settings" link and each screen's own hand-copied
 * "← Today" text link. Each icon hides itself on the screen it would
 * navigate to — the house on Today (it IS home), the gear on Settings
 * — rather than linking a screen to itself.
 */
export function AppHeader({
  hideHouse = false,
  hideGear = false,
  style,
}: {
  hideHouse?: boolean;
  hideGear?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const router = useRouter();

  return (
    <View style={[styles.row, style]}>
      <Brandmark />
      <View style={styles.icons}>
        {!hideHouse && (
          <TouchableOpacity style={styles.tapTarget} onPress={() => router.push('/today')} hitSlop={4}>
            <Ionicons name="home-outline" size={20} color={colors.muted} />
          </TouchableOpacity>
        )}
        {!hideGear && (
          <TouchableOpacity style={styles.tapTarget} onPress={() => router.push('/settings')} hitSlop={4}>
            <Ionicons name="settings-outline" size={20} color={colors.muted} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  icons: {
    flexDirection: 'row',
  },
  tapTarget: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

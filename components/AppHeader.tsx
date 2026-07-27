import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleProp, StyleSheet, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brandmark } from '@/components/Brandmark';
import { colors } from '@/constants/theme';

/**
 * D6 (7 July) — the shared top-bar chrome: brandmark top-left, a house
 * icon (→ /today) and a gear icon (→ /settings) top-right, replacing
 * the written "Settings" link and each screen's own hand-copied
 * "← Today" text link. Each icon hides itself on the screen it would
 * navigate to — the house on Today (it IS home), the gear on Settings
 * — rather than linking a screen to itself.
 *
 * NAV1 (13 July) — the header also owns the top safe-area inset (status
 * bar / Dynamic Island), so every screen that renders it is clear of
 * the iOS clock with no per-screen work; a future screen picking up
 * AppHeader can't forget the inset. Web resolves the inset to 0, so
 * web is visually unchanged. Screens WITHOUT the header (the deliberate
 * full-screen moments, intro/onboarding) apply the same
 * useSafeAreaInsets() value themselves.
 *
 * OD1 job 3 (26 July) — the inset now lives on an OUTER wrapper that no
 * caller style can reach, because it used to sit in the same style array
 * as `style` and the caller's object came LAST: invite.tsx passed a
 * `paddingTop: 12` and silently replaced the whole safe-area inset, so
 * the wordmark rendered under the iOS clock. NAV1's promise that
 * "AppHeader owns the safe-area inset" is now structural rather than a
 * convention a screen can break by accident. A screen that genuinely
 * wants extra room below the notch sets padding on `style` as usual and
 * it ADDS to the inset instead of replacing it. NOTE the row's other
 * properties (flexDirection / justifyContent / alignItems) are still
 * caller-overridable by design — the row's layout is the screen's
 * business; the safe area is not.
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
  const insets = useSafeAreaInsets();

  return (
    <View style={{ paddingTop: insets.top }}>
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

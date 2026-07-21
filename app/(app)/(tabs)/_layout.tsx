import { Ionicons } from '@expo/vector-icons';
import { Tabs, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { STRINGS } from '@/constants/strings';
import { colors, FLOATING_TAB_BAR } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { hasUnrespondedDayObservation } from '@/lib/reflections';

/**
 * TB1 (18 July, Cat's Instagram-reference ask) — the floating pill tab
 * bar: five icon-only tabs (Today · Circle · Journal · Private Map ·
 * Rally), inset from the edges, fully rounded, a clear gap above the
 * home indicator (safe-area aware, per NAV1's job 0).
 *
 * TB2 (20 July, Cat's on-device rulings) — two fixes on TB1:
 * Geometry: the pill's insets are margins, not left/right offsets.
 * React Navigation's own bar style pins `start: 0` / `end: 0`, and on
 * native Yoga gives start/end precedence over left/right even when the
 * user style comes later — so TB1's left/right rendered edge-to-edge
 * on real iOS while web (where start resolves to left and the later
 * style wins) looked correct. Margins have no competing internal
 * value, so they hold on both platforms.
 * Active state: variant C of the Cowork orange mockup — a heartSoft
 * wash in the icon pill, icon tinted heart orange, on every tab. This
 * is a conscious colour-role amendment (orange = hearts + you-are-here;
 * see CLAUDE.md's colour-roles convention): the previous green/plum
 * active tints and the neutral grey blob are gone. Plum on this bar
 * now lives only in the Map tab's notification dot.
 *
 * Translucency: web gets backdrop-filter blur; native ships the
 * translucent-solid + hairline treatment (NO expo-blur — that's a new
 * native module and would move this to the build lane; the sanctioned
 * upgrade path is recorded in the queue note). iOS "reduce
 * transparency" falls back to a fully solid pill.
 *
 * The Map tab's small plum dot mirrors D6's "something we noticed"
 * gate (hasUnrespondedDayObservation) — refreshed on every route
 * change, so answering the observation on /reflection clears it the
 * moment the user lands back on a tab.
 */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const pathname = usePathname();

  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceTransparencyEnabled?.().then(setReduceTransparency).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.(
      'reduceTransparencyChanged',
      setReduceTransparency
    );
    return () => sub?.remove?.();
  }, []);

  const [mapDot, setMapDot] = useState(false);
  useEffect(() => {
    if (!session?.user) return;
    hasUnrespondedDayObservation(session.user.id)
      .then(setMapDot)
      .catch(() => {});
  }, [session?.user?.id, pathname]);

  const translucent = !reduceTransparency;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.heart,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          position: 'absolute',
          marginHorizontal: FLOATING_TAB_BAR.SIDE_MARGIN,
          marginBottom: insets.bottom + FLOATING_TAB_BAR.BOTTOM_GAP,
          height: FLOATING_TAB_BAR.HEIGHT,
          borderRadius: FLOATING_TAB_BAR.HEIGHT / 2,
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: colors.line,
          paddingBottom: 0,
          paddingTop: 0,
          // The library pads the bar by the horizontal safe-area insets;
          // the pill already clears them via its margins, and any stray
          // padding would skew the five slots off-centre.
          paddingHorizontal: 0,
          backgroundColor: translucent
            ? Platform.OS === 'web'
              ? 'rgba(255, 255, 255, 0.55)'
              : 'rgba(255, 255, 255, 0.92)'
            : colors.card,
          ...(translucent && Platform.OS === 'web' ? { backdropFilter: 'blur(20px)' } : null),
          shadowColor: '#000',
          shadowOpacity: 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        },
        tabBarItemStyle: {
          height: FLOATING_TAB_BAR.HEIGHT,
          justifyContent: 'center',
        },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          tabBarAccessibilityLabel: STRINGS.tabTodayLabel,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="home-outline" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="circle"
        options={{
          tabBarAccessibilityLabel: STRINGS.tabCircleLabel,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="people-outline" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="journal"
        options={{
          tabBarAccessibilityLabel: STRINGS.tabJournalLabel,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="book-outline" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="private-map"
        options={{
          // Icon: map-outline (picked over compass — a map reads calm and
          // matches the screen's own name; a compass reads wayfinding/
          // urgency). The inner-life plum lives in the notification dot;
          // the active tint is the shared you-are-here orange (TB2).
          tabBarAccessibilityLabel: STRINGS.tabPrivateMapLabel,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="map-outline" color={color} focused={focused} dot={mapDot} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          tabBarAccessibilityLabel: STRINGS.chatTabLabel,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="chatbubble-outline" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

/** One tab icon inside its heartSoft you-are-here active pill (TB2,
 * variant C), with the optional plum notification dot. The wrapper is
 * the ≥44px tap surface. */
function TabIcon({
  name,
  color,
  focused,
  dot = false,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  focused: boolean;
  dot?: boolean;
}) {
  return (
    <View style={[styles.iconPill, focused && styles.iconPillActive]}>
      <Ionicons name={name} size={22} color={color} />
      {dot && <View style={styles.dot} />}
    </View>
  );
}

const styles = StyleSheet.create({
  iconPill: {
    width: 48,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // You-are-here orange (Cat's TB2 ruling, 20 July): the colour-roles
  // convention consciously grew orange from "hearts only" to hearts +
  // the nav active state — see CLAUDE.md. TB1's soft-neutral blob is
  // superseded.
  iconPillActive: {
    backgroundColor: colors.heartSoft,
  },
  // D6's "something we noticed", relocated: plum because it points at
  // the inner-life layer; clears via the layout's route-change refetch.
  dot: {
    position: 'absolute',
    top: 7,
    right: 9,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.plum,
  },
});

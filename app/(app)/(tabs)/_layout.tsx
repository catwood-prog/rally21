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
 * home indicator (safe-area aware, per NAV1's job 0). Active tab gets
 * a soft NEUTRAL pill highlight behind the icon — never a role colour;
 * the icons themselves keep the colour roles (green everywhere except
 * the inner-life plum on Journal and the new Private Map tab, which IS
 * the inner-life door, elevated out of the Today footer for good).
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
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          position: 'absolute',
          left: FLOATING_TAB_BAR.SIDE_MARGIN,
          right: FLOATING_TAB_BAR.SIDE_MARGIN,
          bottom: insets.bottom + FLOATING_TAB_BAR.BOTTOM_GAP,
          height: FLOATING_TAB_BAR.HEIGHT,
          borderRadius: FLOATING_TAB_BAR.HEIGHT / 2,
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: colors.line,
          paddingBottom: 0,
          paddingTop: 0,
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
          // The inner-life plum, scarce by design (colour-roles rule).
          tabBarActiveTintColor: colors.plum,
          tabBarAccessibilityLabel: STRINGS.tabJournalLabel,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="book-outline" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="private-map"
        options={{
          // Plum too — this tab IS the inner-life door. Icon: map-outline
          // (picked over compass — a map reads calm and matches the
          // screen's own name; a compass reads wayfinding/urgency).
          tabBarActiveTintColor: colors.plum,
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

/** One tab icon inside its (soft neutral, never role-coloured) active
 * highlight pill, with the optional plum notification dot. The wrapper
 * is the ≥44px tap surface. */
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
  // Soft neutral — deliberately not a role colour (hard rule).
  iconPillActive: {
    backgroundColor: 'rgba(38, 38, 38, 0.07)',
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

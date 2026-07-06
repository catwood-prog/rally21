import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatQuestionIcon } from '@/components/ChatQuestionIcon';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';

export default function TabsLayout() {
  // On iOS Safari (and standalone/home-screen mode) this resolves the CSS
  // env(safe-area-inset-bottom) value, so the bar clears the home
  // indicator / Safari's bottom chrome instead of sitting under it.
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          // Web can render the glassy translucent bar from the mockup;
          // native platforms don't support backdrop blur, so they get a
          // solid bar instead of a see-through one with nothing behind it.
          backgroundColor: Platform.OS === 'web' ? 'rgba(255, 255, 255, 0.55)' : colors.card,
          ...(Platform.OS === 'web' ? { backdropFilter: 'blur(20px)' } : null),
          borderTopColor: colors.line,
          borderTopWidth: 1,
          height: 52 + insets.bottom,
          paddingTop: 8,
          paddingBottom: 10 + insets.bottom,
        },
        tabBarLabelStyle: {
          fontSize: 10.5,
          fontWeight: '700',
        },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: 'Today',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="circle"
        options={{
          title: 'Circle',
          tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="journal"
        options={{
          title: 'Journal',
          // The only tab that breaks from green — the inner-life layer's
          // plum accent, scarce by design (see CLAUDE.md's color-roles
          // convention).
          tabBarActiveTintColor: colors.plum,
          tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: STRINGS.chatTabLabel,
          tabBarAccessibilityLabel: STRINGS.chatTabLabel,
          tabBarIcon: ({ color, size }) => <ChatQuestionIcon size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

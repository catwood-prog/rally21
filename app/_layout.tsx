import {
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque';
import { InstrumentSerif_400Regular_Italic } from '@expo-google-fonts/instrument-serif';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Text, TextInput } from 'react-native';

import { FONT_BODY } from '@/constants/fonts';
import { colors } from '@/constants/theme';
import { AuthProvider } from '@/lib/auth-context';

// Applies the body font everywhere by default so individual screens don't
// each need a fontFamily on every Text — headlines/accents still opt into
// Bricolage Grotesque / Instrument Serif locally where the mockup calls
// for them.
const RNText = Text as unknown as { defaultProps?: { style?: unknown } };
RNText.defaultProps = RNText.defaultProps || {};
RNText.defaultProps.style = [{ fontFamily: FONT_BODY }, RNText.defaultProps.style];

const RNTextInput = TextInput as unknown as { defaultProps?: { style?: unknown } };
RNTextInput.defaultProps = RNTextInput.defaultProps || {};
RNTextInput.defaultProps.style = [{ fontFamily: FONT_BODY }, RNTextInput.defaultProps.style];

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    BricolageGrotesque_800ExtraBold,
    BricolageGrotesque_700Bold,
    InstrumentSerif_400Regular_Italic,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  return (
    <AuthProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="auth/callback" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(app)" />
        <Stack.Screen name="+not-found" options={{ headerShown: true, title: 'Oops!' }} />
      </Stack>
      <StatusBar style="dark" />
    </AuthProvider>
  );
}

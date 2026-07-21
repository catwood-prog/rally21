import { ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  ScrollViewProps,
  StyleSheet,
} from 'react-native';

/**
 * KB1 (22 July) — the ONE keyboard recipe for scrolling form screens,
 * from Cat's on-device check-in report ("scroll down doesn't work when
 * the keyboard is up, it's tricky to figure out how to click off"):
 *
 * - keyboardDismissMode: drag down to dismiss (iOS 'interactive';
 *   Android gets 'on-drag' — 'interactive' is iOS-only and silently
 *   means 'none' there).
 * - keyboardShouldPersistTaps="handled": a tap on another input or the
 *   save button lands in ONE tap — the default swallows the first tap
 *   just to dismiss the keyboard.
 * - a native-only Pressable wrapper dismisses the keyboard on any tap
 *   outside an input ('handled' alone stops blank-space taps from
 *   dismissing at all).
 * - KeyboardAvoidingView (iOS 'padding', platform-gated) keeps the
 *   focused input above the keyboard and the whole form — save CTA
 *   included — reachable by scroll while the keyboard is open.
 *
 * Web renders the same tree minus the Pressable (KAV degrades to a
 * plain View; both scroll props are web no-ops), so web behavior is
 * unchanged by construction. None of the target screens use `gap` in
 * their content styles, so the single-child Pressable wrapper can't
 * change spacing — check that before adopting this on a new screen.
 */
export function KeyboardFriendlyScrollView({
  children,
  ...scrollProps
}: ScrollViewProps & { children: ReactNode }) {
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        {...scrollProps}
      >
        {Platform.OS === 'web' ? (
          children
        ) : (
          <Pressable onPress={Keyboard.dismiss} accessible={false}>
            {children}
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});

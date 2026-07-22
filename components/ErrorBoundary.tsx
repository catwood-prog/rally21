import { useRouter } from 'expo-router';
import { Component, ComponentType, ReactNode } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MASCOT } from '@/assets/mascot';
import { Brandmark } from '@/components/Brandmark';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { captureError } from '@/lib/sentry';

/**
 * NR1 Job 1 — the app's last line of defence. Before this, ANY render
 * error white-screened the whole app with no report (grep-proven: no
 * ErrorBoundary existed). Now a render error below this boundary is
 * caught here: the person sees a warm, apologetic recovery screen (ER1's
 * apologetic-slip register + MASCOT.apologeticSlip — reused, not a new
 * failure voice) with one obvious way back, and the error is routed to
 * the ONE reporting path (lib/sentry.ts captureError) as a structured tag
 * only — never the error's message as a user-facing string or payload.
 * On web that path already sends; NR1 Job 2 makes captureError live on
 * native too, at which point boundary catches report with no change here.
 *
 * The recovery UI deliberately uses a plain <Image>, not MascotEntrance:
 * a last-line-of-defence surface must not depend on the animation layer,
 * since that layer could be the very thing that just crashed. Warmth-law
 * surface (Rally21-Glow-Spec.md §0): it apologises without alarm, never
 * shows a stack / technical message / error code, and never scolds.
 */

type Props = { children: ReactNode; label: string };
type State = { hasError: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // The single reporting path. A structured tag only (the boundary that
    // caught it) — the error object carries its own stack for Sentry; we
    // never lift its message into a payload field. captureError no-ops on
    // native until Job 2, and when the DSN is absent, by design.
    captureError(error, { boundary: this.props.label });
  }

  reset = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) {
      return <ErrorRecoveryScreen onReset={this.reset} />;
    }
    return this.props.children;
  }
}

/** NR1 Job 1c — wrap a tab screen in its OWN boundary so a crash in one
 * tab's content shows the recovery screen INSIDE that tab's scene while
 * the floating tab bar (rendered by the navigator, a sibling of the
 * scene) stays alive — the person can just tap another tab. expo-router's
 * <Tabs> exposes no per-scene wrapper, so each of the five tab screens
 * opts in at its own default export. Each boundary carries a distinct
 * `tab:<name>` label so a report says which tab fell over. */
export function withErrorBoundary<P extends object>(
  Screen: ComponentType<P>,
  label: string
): ComponentType<P> {
  function Boundaried(props: P) {
    return (
      <ErrorBoundary label={label}>
        <Screen {...props} />
      </ErrorBoundary>
    );
  }
  Boundaried.displayName = `withErrorBoundary(${label})`;
  return Boundaried;
}

/** Rendered by the class boundary once it has caught. A function so it can
 * reach the router + safe-area insets (both provided ABOVE this boundary,
 * so they stay available even while the crashed subtree is unmounted). */
function ErrorRecoveryScreen({ onReset }: { onReset: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const goBack = () => {
    // Change the route FIRST — the navigation store lives above this
    // boundary, so it updates even while the crashed subtree is unmounted
    // — then clear hasError so the subtree re-renders onto the fresh route
    // ("/" re-runs the index redirect: Today when onboarded, else sign-in).
    router.replace('/');
    onReset();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <Brandmark />
      <View style={styles.center}>
        <Image source={MASCOT.apologeticSlip} style={styles.mascot} resizeMode="contain" />
        <Text style={styles.title}>{STRINGS.errorBoundaryTitle}</Text>
        <Text style={styles.body}>{STRINGS.errorBoundaryBody}</Text>
        <TouchableOpacity style={styles.button} onPress={goBack} accessibilityRole="button">
          <Text style={styles.buttonText}>{STRINGS.errorBoundaryCta}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 24,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mascot: {
    width: 150,
    height: 88,
    marginBottom: 20,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 20,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 10,
  },
  body: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 28,
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
});

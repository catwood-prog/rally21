import { withErrorBoundary } from '@/components/ErrorBoundary';
import { StyleSheet, View } from 'react-native';

import { AskRallyScreen } from '@/components/AskRallyScreen';
import { colors, FLOATING_TAB_BAR } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';

// The Rally tab — the front door into Ask Rally (A2, 7 July). Same
// shared component as the standalone /ask-rally route; no prefill
// context here. TB1: the wrapper lifts the composer clear of the
// floating pill (the standalone route has no bar, so the clearance
// lives here, not inside the shared component). TB3: the clearance is
// inset-aware — the fixed constant alone left the composer partly
// behind the pill on device.
function Chat() {
  const composerClearance = useTabBarClearance(FLOATING_TAB_BAR.COMPOSER_CLEARANCE);
  return (
    <View style={[styles.wrap, { paddingBottom: composerClearance }]}>
      <AskRallyScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});

// NR1 Job 1c — this tab renders behind its own error boundary so a
// crash here can't take the floating tab bar (and the other tabs) down.
export default withErrorBoundary(Chat, 'tab:chat');

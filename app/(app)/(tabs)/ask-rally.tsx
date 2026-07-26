import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AskRallyScreen } from '@/components/AskRallyScreen';
import { colors, FLOATING_TAB_BAR } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';

// Deep-linked entry point (blueprint pattern cards, the journal screen,
// the private map's starter chips) with an optional prefill — `context`
// wraps a pattern as an About-this starting point, `prefill` (PM1) is
// the user's own question landing verbatim. The Rally tab is the other,
// un-parameterized entry into the same shared component (A2, 7 July).
// NAV1: the way back is AppHeader's house icon, inside the component.
//
// OD1 job 7b (Cat's ruling, 22 July: always show the nav bar — it is the
// same screen, and losing the chrome is disorienting). This file used to
// live at app/(app)/ask-rally.tsx, OUTSIDE the tabs group, so it rendered
// as a chrome-less twin of the Rally tab. It now sits INSIDE (tabs) with
// a hidden route entry (href: null in (tabs)/_layout.tsx), which is what
// puts it inside the real Tabs navigator and gives it the genuine
// floating pill — rather than a second, hand-rolled pill that could
// drift from the real one. The URL is unchanged: (tabs) is a route
// group, so the path is still '/ask-rally' and every caller keeps
// navigating to that same plain string.
//
// The clearance wrapper is chat.tsx's, deliberately identical rather
// than merely similar: TB1 found the composer sitting behind the
// floating pill, and TB3 made the clearance inset-aware after the fixed
// constant failed on device. A route that gains the real pill without
// this wrapper inherits exactly the bug TB3 fixed, so both routes read
// the one shared hook and a third could not silently drift either.
export default function AskRally() {
  const { context, prefill } = useLocalSearchParams<{ context?: string; prefill?: string }>();
  const composerClearance = useTabBarClearance(FLOATING_TAB_BAR.COMPOSER_CLEARANCE);
  return (
    <View style={[styles.wrap, { paddingBottom: composerClearance }]}>
      <AskRallyScreen contextParam={context} prefillParam={prefill} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});

import { StyleSheet, View } from 'react-native';

import { AskRallyScreen } from '@/components/AskRallyScreen';
import { colors, FLOATING_TAB_BAR } from '@/constants/theme';

// The Rally tab — the front door into Ask Rally (A2, 7 July). Same
// shared component as the standalone /ask-rally route; no prefill
// context here. TB1: the wrapper lifts the composer clear of the
// floating pill (the standalone route has no bar, so the clearance
// lives here, not inside the shared component).
export default function Chat() {
  return (
    <View style={styles.wrap}>
      <AskRallyScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingBottom: FLOATING_TAB_BAR.COMPOSER_CLEARANCE,
  },
});

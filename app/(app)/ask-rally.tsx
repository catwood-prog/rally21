import { useLocalSearchParams } from 'expo-router';

import { AskRallyScreen } from '@/components/AskRallyScreen';

// Deep-linked entry point (blueprint pattern cards, the journal screen,
// the private map's starter chips) with an optional prefill — `context`
// wraps a pattern as an About-this starting point, `prefill` (PM1) is
// the user's own question landing verbatim. The Rally tab is the other,
// un-parameterized entry into the same shared component (A2, 7 July).
// NAV1: the way back is AppHeader's house icon, inside the component.
export default function AskRally() {
  const { context, prefill } = useLocalSearchParams<{ context?: string; prefill?: string }>();
  return <AskRallyScreen contextParam={context} prefillParam={prefill} />;
}

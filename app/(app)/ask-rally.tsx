import { useLocalSearchParams } from 'expo-router';

import { AskRallyScreen } from '@/components/AskRallyScreen';

// Deep-linked entry point (blueprint pattern cards, the journal screen)
// with an optional prefill context — the Rally tab is the other, un-
// parameterized entry into the same shared component (A2, 7 July).
export default function AskRally() {
  const { context } = useLocalSearchParams<{ context?: string }>();
  return <AskRallyScreen contextParam={context} showBackLink />;
}

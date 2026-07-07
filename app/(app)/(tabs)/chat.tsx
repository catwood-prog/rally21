import { AskRallyScreen } from '@/components/AskRallyScreen';

// The Rally tab — the front door into Ask Rally (A2, 7 July). Same
// shared component as the standalone /ask-rally route; no prefill
// context here, and no back link since this is already a tab.
export default function Chat() {
  return <AskRallyScreen />;
}

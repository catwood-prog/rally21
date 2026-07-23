import { STRINGS } from '@/constants/strings';

import { AskRallyMessage } from './askRally';

/** EX1 — plain, readable text a person would want to keep from an Ask
 * Rally conversation: each turn labelled ("you:" / "Rally:"), a blank
 * line between turns, closed with a quiet footer. No markdown, no JSON,
 * no timestamps (Cat's ruling, 22 July). A still-streaming assistant
 * bubble (empty content) is dropped rather than exported as a bare
 * label with nothing after it. */
export function formatChatTranscript(messages: AskRallyMessage[]): string {
  const label = (role: AskRallyMessage['role']) =>
    role === 'user' ? STRINGS.askRallyExportYouLabel : STRINGS.askRallyExportRallyLabel;

  const turns = messages
    .filter((m) => m.content.trim().length > 0)
    .map((m) => `${label(m.role)}: ${m.content.trim()}`);

  return [...turns, STRINGS.askRallyExportFooter].join('\n\n');
}

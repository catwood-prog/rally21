import { STRINGS } from '@/constants/strings';

import { formatChatTranscript } from './exportChat';

describe('formatChatTranscript', () => {
  test('labels each turn, blank line between, footer last', () => {
    const transcript = formatChatTranscript([
      { role: 'user', content: 'what are you noticing about me?' },
      { role: 'assistant', content: "you've checked in every morning this week." },
    ]);

    expect(transcript).toBe(
      [
        "you: what are you noticing about me?",
        "Rally: you've checked in every morning this week.",
        STRINGS.askRallyExportFooter,
      ].join('\n\n')
    );
  });

  test('Rally keeps its capital, you stays lowercase (LC1 exception)', () => {
    const transcript = formatChatTranscript([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    expect(transcript).toContain('you: hi');
    expect(transcript).toContain('Rally: hello');
    expect(transcript).not.toContain('rally: hello');
  });

  test('drops a still-streaming empty assistant turn rather than a bare label', () => {
    const transcript = formatChatTranscript([
      { role: 'user', content: 'hello?' },
      { role: 'assistant', content: '' },
    ]);
    expect(transcript).toBe(['you: hello?', STRINGS.askRallyExportFooter].join('\n\n'));
  });

  test('trims whitespace-only content the same way as truly empty', () => {
    const transcript = formatChatTranscript([{ role: 'assistant', content: '   \n  ' }]);
    expect(transcript).toBe(STRINGS.askRallyExportFooter);
  });

  test('an empty conversation is just the footer, never a dangling separator', () => {
    expect(formatChatTranscript([])).toBe(STRINGS.askRallyExportFooter);
  });

  test('no markdown, JSON, or timestamps sneak in — plain "label: text" lines only', () => {
    const transcript = formatChatTranscript([{ role: 'user', content: 'a question' }]);
    expect(transcript).not.toMatch(/[{}[\]]/);
    expect(transcript).not.toMatch(/\*\*|##|`/);
    expect(transcript).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

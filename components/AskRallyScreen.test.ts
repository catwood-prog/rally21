import { STRINGS } from '@/constants/strings';

import { buildPrefillDraft } from './AskRallyScreen';

/**
 * PM1 (15 July): two kinds of composer prefill exist and must never
 * blur together — a pattern card's `context` is something the user is
 * reacting to (About-this wrapper), a map starter chip's `prefill` is
 * the user's own question (verbatim, no wrapper, never auto-sent).
 */
describe('buildPrefillDraft — context wraps, prefill lands verbatim', () => {
  it('wraps a pattern context in the About-this frame', () => {
    expect(buildPrefillDraft('you show up more on tired days', undefined)).toBe(
      'About this: "you show up more on tired days" — '
    );
  });

  it('passes a starter-chip question through byte-identical, no wrapper', () => {
    expect(buildPrefillDraft(undefined, 'help me with my motivation')).toBe(
      'help me with my motivation'
    );
  });

  it('passes every shipped starter chip through unchanged', () => {
    for (const chip of STRINGS.blueprintAskChips) {
      expect(buildPrefillDraft(undefined, chip)).toBe(chip);
    }
  });

  it('lets context win if both ever arrive together', () => {
    expect(buildPrefillDraft('a pattern', 'a question')).toBe('About this: "a pattern" — ');
  });

  it('returns null when neither param is present (the Rally tab entry)', () => {
    expect(buildPrefillDraft(undefined, undefined)).toBeNull();
    expect(buildPrefillDraft('', '')).toBeNull();
  });
});

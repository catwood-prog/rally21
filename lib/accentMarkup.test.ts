import { stripAccentMarkers } from './accentMarkup';
import { resolveQuestionPrompt } from './reflections';

describe('stripAccentMarkers', () => {
  it('keeps the words and drops the markers', () => {
    expect(stripAccentMarkers("How's your *energy* right now?")).toBe(
      "How's your energy right now?"
    );
  });

  it('handles several spans in one string', () => {
    expect(
      stripAccentMarkers('On weekends, is it easier to *protect* the practice or *let it slip*?')
    ).toBe('On weekends, is it easier to protect the practice or let it slip?');
  });

  it('leaves text without markers untouched', () => {
    expect(stripAccentMarkers('Where did you do today’s practice?')).toBe(
      'Where did you do today’s practice?'
    );
  });

  it('leaves a lone asterisk alone rather than eating the rest of the line', () => {
    expect(stripAccentMarkers('a * b')).toBe('a * b');
  });
});

describe('resolveQuestionPrompt', () => {
  it('prefers the snapshot, which is what the person was actually asked', () => {
    expect(
      resolveQuestionPrompt({
        question_prompt_snapshot: 'What reliably *restores* you in under 20 minutes?',
        questions: { prompt: 'What reliably helps you *recharge* in 20 minutes or less?' },
      })
    ).toBe('What reliably restores you in under 20 minutes?');
  });

  it('falls back to the live wording for rows stored before snapshots existed', () => {
    expect(
      resolveQuestionPrompt({
        question_prompt_snapshot: null,
        questions: { prompt: 'Pick today’s *color*.' },
      })
    ).toBe('Pick today’s color.');
  });

  it('is null when there is no question at all', () => {
    expect(resolveQuestionPrompt({ question_prompt_snapshot: null, questions: null })).toBeNull();
  });
});

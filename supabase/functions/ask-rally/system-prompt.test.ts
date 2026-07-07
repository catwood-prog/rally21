import {
  crisisResponse,
  isCrisisMessage,
  resolveCrisisResources,
  truncateHistory,
} from './system-prompt';

describe('isCrisisMessage', () => {
  test('flags unambiguous self-harm/suicide phrases', () => {
    expect(isCrisisMessage('I want to kill myself')).toBe(true);
    expect(isCrisisMessage("sometimes I think I'd be better off dead")).toBe(true);
    expect(isCrisisMessage('I have been thinking about suicide')).toBe(true);
  });

  test('does not flag ambiguous/unrelated phrases — the high-precision bar', () => {
    expect(isCrisisMessage('I could murder a coffee right now')).toBe(false);
    expect(isCrisisMessage('this deadline is killing me honestly')).toBe(false);
    expect(isCrisisMessage('just a normal message about my day')).toBe(false);
  });

  test('is case-insensitive', () => {
    expect(isCrisisMessage('I WANT TO END MY LIFE')).toBe(true);
  });
});

describe('crisisResponse', () => {
  test('embeds the resources and asks the one safety question, nothing else', () => {
    const resources = resolveCrisisResources();
    const response = crisisResponse(resources);
    expect(response).toContain(resources);
    expect(response).toContain('Are you safe right now?');
  });
});

describe('resolveCrisisResources', () => {
  test('includes both UK and US minimum regions', () => {
    const resources = resolveCrisisResources();
    expect(resources).toContain('116 123');
    expect(resources).toContain('988');
  });
});

describe('truncateHistory', () => {
  const makeMessages = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as const,
      content: `turn ${i}`,
    }));

  test('leaves a short history untouched', () => {
    const messages = makeMessages(5);
    expect(truncateHistory(messages, 20)).toEqual(messages);
  });

  test('the 21st turn drops the oldest turn, keeps the most recent 20', () => {
    const messages = makeMessages(21);
    const result = truncateHistory(messages, 20);
    expect(result).toHaveLength(20);
    expect(result[0].content).toBe('turn 1'); // turn 0 (oldest) dropped
    expect(result[19].content).toBe('turn 20'); // newest kept
  });
});

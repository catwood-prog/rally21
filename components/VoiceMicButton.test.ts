import { appendTranscript } from './VoiceMicButton';

/**
 * KB1: appendTranscript became the shared copy behind MicTextInput —
 * the convention's append-never-replace rule, pinned at its seams.
 */
describe('appendTranscript — dictation appends, never replaces', () => {
  it('starts empty text with the bare transcript', () => {
    expect(appendTranscript('', 'hello there')).toBe('hello there');
  });

  it('joins with a single space after existing words', () => {
    expect(appendTranscript('grateful for', 'my morning walk')).toBe('grateful for my morning walk');
  });

  it('does not double a space the user already typed', () => {
    expect(appendTranscript('grateful for ', 'coffee')).toBe('grateful for coffee');
  });

  it('respects a trailing newline as the seam', () => {
    expect(appendTranscript('line one\n', 'line two')).toBe('line one\nline two');
  });
});

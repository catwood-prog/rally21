import { displayReactionEmoji } from './wall';

describe('displayReactionEmoji', () => {
  it('maps a historic gold-heart reaction to the new orange heart', () => {
    expect(displayReactionEmoji('💛')).toBe('🧡');
  });

  it('leaves every other stored emoji untouched', () => {
    expect(displayReactionEmoji('🎉')).toBe('🎉');
    expect(displayReactionEmoji('👏')).toBe('👏');
    expect(displayReactionEmoji('🔥')).toBe('🔥');
    expect(displayReactionEmoji('👋')).toBe('👋');
    expect(displayReactionEmoji('🧡')).toBe('🧡');
  });
});

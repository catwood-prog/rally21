import { hasAttributionLine, shouldOfferShareCard } from './shareCards';

describe('shouldOfferShareCard', () => {
  it('offers a card when nothing else fired', () => {
    expect(shouldOfferShareCard({ isCeremonyDay: false, hasMilestone: false, showsGlowBeat: false })).toBe(true);
  });

  it('never offers a card on a ceremony day', () => {
    expect(shouldOfferShareCard({ isCeremonyDay: true, hasMilestone: false, showsGlowBeat: false })).toBe(false);
    expect(shouldOfferShareCard({ isCeremonyDay: true, hasMilestone: true, showsGlowBeat: true })).toBe(false);
  });

  it('never offers a card alongside a milestone', () => {
    expect(shouldOfferShareCard({ isCeremonyDay: false, hasMilestone: true, showsGlowBeat: false })).toBe(false);
  });

  it('never offers a card alongside the glow beat', () => {
    expect(shouldOfferShareCard({ isCeremonyDay: false, hasMilestone: false, showsGlowBeat: true })).toBe(false);
  });
});

describe('hasAttributionLine', () => {
  it('renders an author line for a real name', () => {
    expect(hasAttributionLine('Marcus Aurelius')).toBe(true);
  });

  it('renders no author line for null (facts sub-flavor)', () => {
    expect(hasAttributionLine(null)).toBe(false);
  });

  it('renders no author line for the literal "Unknown" marker', () => {
    expect(hasAttributionLine('Unknown')).toBe(false);
  });
});

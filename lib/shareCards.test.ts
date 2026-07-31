import { hasAttributionLine, shouldOfferShareCard } from './shareCards';

describe('shouldOfferShareCard', () => {
  it('offers a card when nothing bigger fired', () => {
    expect(shouldOfferShareCard({ isCeremonyDay: false, hasMilestone: false })).toBe(true);
  });

  it('never offers a card on a ceremony day', () => {
    expect(shouldOfferShareCard({ isCeremonyDay: true, hasMilestone: false })).toBe(false);
    expect(shouldOfferShareCard({ isCeremonyDay: true, hasMilestone: true })).toBe(false);
  });

  it('never offers a card alongside a milestone', () => {
    expect(shouldOfferShareCard({ isCeremonyDay: false, hasMilestone: true })).toBe(false);
  });

  // SC4 — the inversion of the old rule, and the whole point of the
  // section. `showsGlowBeat` is `earnedToday`, i.e. the FIRST check-in of
  // the day, which for a single-circle person is every check-in: while it
  // sat in this ladder the card was structurally unreachable for them and
  // SC1's cadence rule was never once consulted. The glow beat no longer
  // participates in eligibility at all — it is a SEQUENCING question,
  // answered in checkin-complete's handleDismiss.
  it('is not a function of the glow beat any more (the SC4 inversion)', () => {
    // A stale bundle still passing the old third key gets a card rather
    // than the old suppression — the flag is inert, not merely unread.
    // (`eas update` applies on the NEXT open, so live testers do run
    // yesterday's JS against today's rules; an ignored key is the safe
    // shape here because the eligibility answer it changes is the one
    // SC4 exists to correct.)
    const stale = { isCeremonyDay: false, hasMilestone: false, showsGlowBeat: true } as Parameters<
      typeof shouldOfferShareCard
    >[0];
    expect(shouldOfferShareCard(stale)).toBe(true);
    // And the two gates that DO still suppress are unaffected by it.
    expect(shouldOfferShareCard({ ...stale, hasMilestone: true })).toBe(false);
    expect(shouldOfferShareCard({ ...stale, isCeremonyDay: true })).toBe(false);
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

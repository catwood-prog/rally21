import { serverRefusal, serverRefusalOr } from './serverRefusal';

const FALLBACK = 'could not join that circle — try again';

describe('serverRefusal — only a hand-written raise reaches a person', () => {
  it('takes the message from a P0001, which is the whole point', () => {
    // The shape postgrest-js actually hands back: a PLAIN OBJECT, not an
    // Error. This is the exact payload IL3 measured through the real REST
    // surface on 10 Aug from join_circle_by_code.
    expect(serverRefusal({ code: 'P0001', message: 'This circle is already full' })).toBe(
      'This circle is already full'
    );
  });

  it('refuses every OTHER postgres code, so raw internals never reach a screen', () => {
    // 42501 is RLS, 23505/23514 are constraints, 57014 is a statement
    // timeout. None of them is a sentence anybody wrote for a person.
    expect(serverRefusal({ code: '42501', message: 'new row violates row-level security policy' })).toBeNull();
    expect(serverRefusal({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBeNull();
    expect(serverRefusal({ code: '23514', message: 'violates check constraint "practices_name_check"' })).toBeNull();
    expect(serverRefusal({ code: '57014', message: 'canceling statement due to statement timeout' })).toBeNull();
  });

  it('refuses a P0001 with nothing to say', () => {
    expect(serverRefusal({ code: 'P0001', message: '' })).toBeNull();
    expect(serverRefusal({ code: 'P0001' })).toBeNull();
    expect(serverRefusal({ code: 'P0001', message: 42 })).toBeNull();
  });

  it('refuses a real Error, because a real Error is a different contract', () => {
    // Not a hypothetical: `reportContent` (lib/moderation.ts) throws
    // `new Error(responseBody.error)` carrying the edge function's own
    // copy, and `auth-context` surfaces genuine Google/Apple SDK errors.
    // Those sites read `.message` off the Error directly and are correct
    // as they stand — this helper must not quietly claim them.
    expect(serverRefusal(new Error('could not send that report — try again in a moment'))).toBeNull();
  });

  it('refuses the timeout shape, which is a plain object too', () => {
    // SUP1's deadline surfaces through postgrest as `{ message:
    // 'AbortError: …' }` with no code at all — see isRequestTimeout in
    // lib/fetch-timeout.ts. A person gets the screen's own line for that,
    // never this.
    expect(
      serverRefusal({ message: 'AbortError: Supabase request timed out after 15000ms' })
    ).toBeNull();
  });

  it('refuses anything that is not an object', () => {
    expect(serverRefusal(null)).toBeNull();
    expect(serverRefusal(undefined)).toBeNull();
    expect(serverRefusal('P0001')).toBeNull();
    expect(serverRefusal(0)).toBeNull();
  });
});

describe('serverRefusalOr — the display shape', () => {
  it('prefers the server sentence when there is one', () => {
    expect(
      serverRefusalOr({ code: 'P0001', message: "This circle isn't taking new members right now" }, FALLBACK)
    ).toBe("This circle isn't taking new members right now");
  });

  it("keeps the caller's existing line for everything else", () => {
    expect(serverRefusalOr({ code: '42501', message: 'row-level security' }, FALLBACK)).toBe(FALLBACK);
    expect(serverRefusalOr(new Error('boom'), FALLBACK)).toBe(FALLBACK);
    expect(serverRefusalOr(null, FALLBACK)).toBe(FALLBACK);
  });
});

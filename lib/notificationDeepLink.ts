// EM1 job 2 (9 Aug) — where a tapped notification lands.
//
// Until now nothing in the app read a push payload back: every
// notification simply opened Today, because that is where a cold launch
// goes. The ember ask needs more than that — "want to cover {name}?"
// promises a specific screen about a specific person and a specific day,
// and an ask that dumps you on Today has asked you to go and find it.
//
// The DECISION lives here, pure, so the rule is pinned by tests rather
// than eyeballed on a phone; hooks/use-notification-deep-link.ts only
// feeds it what the OS handed back. Nothing here trusts the payload as
// AUTHORISATION: it is navigation only, and the cover write it leads to
// is governed entirely by CV1's RLS policy (which re-derives the missed
// member's own local yesterday server-side and rejects any other date).
// A tampered payload can therefore only ever land someone on a screen
// whose action the database then refuses.

/** Clean paths only — never file-system group syntax (CLAUDE.md). The
 * union is closed on purpose: a notification may only ever open a screen
 * this module names, so a new kind has to be added here (and tested)
 * rather than arriving as a free-form string from the server. */
export type NotificationRoute = {
  pathname: '/cover' | '/today';
  params: Record<string, string>;
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The route a tapped notification should open, or null when the payload
 * carries nothing we can act on.
 *
 * NULL IS THE DEFAULT, and deliberately so: an ember ask missing any one
 * of its four values would open the cover flow with a hole in it (no
 * member, or no missed date — the date the cover is actually written
 * against), so a partial payload navigates nowhere and the person lands
 * on Today exactly as they did before this existed. Degrading to the old
 * behaviour beats opening a screen that cannot do the thing it offers.
 */
export function routeForNotificationData(data: unknown): NotificationRoute | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as Record<string, unknown>;

  switch (payload.type) {
    case 'ember_ask': {
      const circleId = str(payload.circleId);
      const memberId = str(payload.memberId);
      const missedDate = str(payload.missedDate);
      if (!circleId || !memberId || !missedDate) return null;
      return {
        pathname: '/cover',
        params: {
          circleId,
          memberId,
          // Both names are presentation only — the cover screen already
          // has its own "your circle-mate" / "someone in your circle"
          // fallbacks, so a missing one is not worth refusing the whole
          // navigation over. `myName` feeds the screen's preview of the
          // note the covered member will receive, which is why the ask
          // carries the TAPPER's own name as well as the missed
          // member's.
          memberName: str(payload.memberName) ?? '',
          myName: str(payload.myName) ?? '',
          missedDate,
        },
      };
    }
    // The covered notice has no destination of its own: the in-app
    // record of a cover is Today's notification spot (TN1), which is
    // where a cold launch already goes. Naming it explicitly means a tap
    // from a cold start lands there rather than wherever the router last
    // was.
    case 'covered_notice':
      return { pathname: '/today', params: {} };
    default:
      return null;
  }
}

// Single source of truth for the two membership caps — the actual
// enforcement lives server-side in the `app_caps()` SQL function used by
// create_circle, join_circle_by_code, join_public_circle, and
// count_open_circles_by_practice. These mirror those same values for
// client-side display only (e.g. "2 of 3 circles", spots-left counts).
export const MAX_CIRCLES = 3;
export const CIRCLE_MEMBER_CAP = 12;

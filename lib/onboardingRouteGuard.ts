/**
 * DA1 — WHICH `(app)` ROUTES A SIGNED-IN ACCOUNT WITH NO CIRCLE MAY STILL
 * REACH.
 *
 * THE DEFECT THIS EXISTS TO CLOSE, measured not theorised: `(app)/_layout`
 * redirected EVERY route in the group to `/onboarding/circle-setup` the
 * moment `useOnboardingStatus` returned 'needs-circle'. Settings and
 * `your-data` live in that group, and `your-data` is where the whole
 * delete-account flow lives (typed DELETE → `deleteMyAccount` → the
 * `delete-account` edge function). So the flow was finished, correct, and
 * structurally unreachable for exactly the person it exists for: someone
 * who left their last circle, a signup abandoned mid-funnel, a Hide My
 * Email duplicate. It is LV2's dead-MessageDialog class at ROUTE level —
 * an upstream guard that always wins — and Apple 5.1.1(v) requires the
 * deletion to be findable from inside the app.
 *
 * THE SHAPE OF THE FIX: the redirect is NARROWED, never opened. Two routes
 * are named here and nothing else changes — a circle-less account still
 * cannot reach Today, the circle screen, check-in, the wall or anything
 * else that presumes a circle, which is what the guard was always for.
 * Both named routes are ACCOUNT-scoped rather than circle-scoped: they
 * render a person's own name, photo, notification prefs and data, none of
 * which needs a membership row to exist.
 *
 * WHY GROUP SEGMENTS ARE FILTERED OUT rather than matched: `useSegments()`
 * returns the route's full segment list including expo-router's `(…)`
 * groups (`['(app)', '(tabs)', 'today']`, `['(app)', 'your-data']`), and
 * the group names are a folder-layout detail that has already moved once
 * in this app (today.tsx into `(tabs)`). Dropping them and requiring the
 * remaining path to be EXACTLY one segment keeps the allowlist a statement
 * about routes rather than about folders — and keeps it strict, so a
 * hypothetical `settings/anything` nested route would not inherit the
 * exemption by prefix.
 */
export const NEEDS_CIRCLE_ALLOWED_ROUTES = ['settings', 'your-data'] as const;

export function isNeedsCircleAllowedRoute(segments: readonly string[]): boolean {
  const path = segments.filter((s) => !s.startsWith('('));
  return path.length === 1 && (NEEDS_CIRCLE_ALLOWED_ROUTES as readonly string[]).includes(path[0]);
}

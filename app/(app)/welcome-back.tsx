import { Redirect } from 'expo-router';

/**
 * CL1 (28 July) — REDIRECT STUB, per Cat's ruling of 27 July and the
 * DORMANCY LAW that ruling set: a file may hold the dormant state ONLY
 * with a NAMED REVIVAL TRIGGER in its header comment. welcome-back has
 * none. TN1 (24 July) compressed this screen's content into Today's
 * notification spot (components/TodayNotificationSpot.tsx +
 * lib/notificationSpot.ts) and removed today.tsx's redirect here, so
 * nothing has routed to it since; the full screen — signal meters, the
 * "while you were away" digest, its title and CTAs — is in git history,
 * which is the archive. wrapped.tsx is the file that PASSES the law (its
 * trigger is named: the deferred ~100-day milestone celebration) and
 * stays whole.
 *
 * The route file itself STAYS so an old link or bookmark to
 * /welcome-back lands warmly on Today rather than 404ing — which is
 * already what this screen did.
 *
 * OD1 job 14's truth-telling glow copy is NOT lost with it: it migrated
 * INTO the spot with TN1, so welcomeBackSubtitleHeld / …Reset live on in
 * constants/strings.ts, read by lib/notificationSpot.ts. Only the
 * strings nothing else read went with the screen.
 */
export default function WelcomeBack() {
  return <Redirect href="/today" />;
}

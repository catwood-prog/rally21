import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { routeForNotificationData } from '@/lib/notificationDeepLink';
import { captureError } from '@/lib/sentry';

/**
 * EM1 job 2 — a tapped notification opens the screen it promised.
 *
 * Mounted in `app/(app)/_layout.tsx`, which is BELOW the session guard,
 * so a tap can never navigate a signed-out phone into the app shell —
 * the layout redirects to sign-in first and this hook's routes only ever
 * run for a real session.
 *
 * TWO ENTRY POINTS, because a tap arrives two different ways and only
 * one of them is an event: a WARM tap (app already running) fires the
 * response listener, while a COLD tap (app launched BY the notification)
 * has already happened before any listener could exist and is read back
 * from `getLastNotificationResponseAsync`. Handling only the listener is
 * the classic version of this bug — it works in every test where you tap
 * with the app open and silently does nothing in the one case that
 * matters most.
 *
 * `useLastNotificationResponse` would cover both, but it is a hook and
 * therefore cannot be platform-guarded at the call site; its emitter
 * reaches for a native module web does not have. Everything here instead
 * lives inside an effect that returns immediately on web, which is the
 * convention lib/alarmReminder.ts and lib/pushNotifications.ts already
 * follow (import at module scope, guard the calls).
 */
export function useNotificationDeepLink(enabled: boolean) {
  const router = useRouter();
  // Identifiers already acted on. A response can be re-delivered (the
  // cold read and the listener can both surface the same tap), and
  // navigating twice would stack two cover screens.
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (Platform.OS === 'web') return;
    // `enabled` is the caller's "this person is signed in and past
    // onboarding" — a tap must never fight a redirect. Nothing is lost by
    // waiting: the response the OS is holding is still there on the next
    // render, so the cold read simply runs a moment later.
    if (!enabled) return;

    const act = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      // Only a plain tap opens anything. A dismissal (or a future custom
      // action) is not a request to go somewhere.
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;

      const id = response.notification.request.identifier;
      if (handled.current.has(id)) return;

      const route = routeForNotificationData(response.notification.request.content.data);
      if (!route) return;

      handled.current.add(id);
      router.push({ pathname: route.pathname, params: route.params });
    };

    let cancelled = false;
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!cancelled) act(response);
        // CONSUMED, not just read. The stored launch response is not an
        // event — it sits there until something clears it, so a later
        // ordinary launch would read the same tap again and yank someone
        // into a cover screen they closed days ago. The in-memory
        // `handled` set cannot prevent that: a cold launch is a fresh
        // process and a fresh set. Clearing is what makes the read
        // one-shot, and it runs whether or not the payload routed
        // anywhere, so nothing is left behind for the next launch.
        if (response) return Notifications.clearLastNotificationResponseAsync();
      })
      .catch((e) => {
        // FF1 rule 3 — a failure here means a cold tap silently went
        // nowhere, which is invisible to us and confusing to the person
        // who tapped, so it is REPORTED rather than swallowed. Silence
        // for them is still right: they are looking at Today, which is a
        // perfectly good place to be.
        captureError(e, { hook: 'useNotificationDeepLink', op: 'getLastNotificationResponse' });
      });

    const subscription = Notifications.addNotificationResponseReceivedListener(act);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [router, enabled]);
}

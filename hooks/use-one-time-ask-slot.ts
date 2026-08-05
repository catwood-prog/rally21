import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

/** One candidate for the one-time-ask slot. `eligible` is the screen's own
 * "should this person see this ask at all" answer — this hook never
 * decides that, it only decides WHEN. */
export type OneTimeAsk = { id: string; eligible: boolean };

/**
 * WB1 job 1b (4 Aug, from Cat's fresh-account walk) — THE ONE-MOUNT
 * COOLDOWN BETWEEN ONE-TIME ASKS.
 *
 * THE BUG THIS EXISTS TO PREVENT. Today's one-time asks were each gated
 * on their own flag, and the photo ask's gate included "has already seen
 * the reminders ask". So answering the reminders card flipped that flag,
 * the reminders card disappeared, and the photo card mounted into the
 * same slot on the same render — which reads as a segue: you said yes to
 * one thing and were immediately pitched another. Cat walked straight
 * into it on a fresh account the night the cohort invites went out.
 *
 * THE RULE, stated generally rather than as a fix for that one pair:
 * answering an ask never reveals the next one on the same render. The
 * slot LATCHES to the first eligible ask it sees and holds that choice
 * for the whole mount, so a flag flipping mid-visit cannot promote the
 * ask behind it. The next ask waits for the next visit — which on a tab
 * screen means the next time this screen mounts.
 *
 * WHY LATCHING AND NOT A "one answered already" BOOLEAN: the latch also
 * keeps the answered card MOUNTED, which is what lets WB1 job 1a's
 * acknowledgment beat render at all. A card that vanishes the instant its
 * flag flips has nowhere to put its own confirm.
 *
 * `dismissActive` is for an ask that is genuinely finished with the slot
 * ("maybe later", "keep my penguin") and has nothing to confirm. It
 * empties the slot AND keeps it empty: the cooldown is the point, so a
 * dismissal must not promote the next ask either.
 *
 * WHAT "THE NEXT VISIT" MEANS, and why this is not literally per-mount:
 * Today is a TAB screen, so it stays mounted across navigations — that is
 * the whole reason this codebase has the refetch-on-focus convention. A
 * latch released only on unmount would therefore hold until the app
 * restarted, and the ask behind it would effectively never be offered.
 * The release is on FOCUS, which is the same event `load()` already
 * treats as a fresh visit on every screen in this app.
 *
 * Order matters — `asks` is a priority list, first eligible wins.
 */
export function useOneTimeAskSlot(asks: OneTimeAsk[]): {
  activeAskId: string | null;
  dismissActive: () => void;
} {
  // THE VISIT IS THE UNIT, and it is a counter rather than a "clear the
  // latch on focus" effect, because clearing it that way does not survive
  // its own first run: on mount the latch effect and the focus effect both
  // fire, the focus effect's reset lands second, and the latch effect's
  // dependencies come back UNCHANGED on the render after — so it never
  // re-runs and the slot silently never latches at all. Stamping each
  // latch with the visit it belongs to puts the visit in those
  // dependencies, which is what makes the re-latch happen. (Caught by
  // this hook's own test, not by reading.)
  const [visitId, setVisitId] = useState(0);
  const [latched, setLatched] = useState<{ visit: number; askId: string } | null>(null);
  const [dismissedVisit, setDismissedVisit] = useState<number | null>(null);

  const firstEligibleId = asks.find((ask) => ask.eligible)?.id ?? null;
  const latchedId = latched?.visit === visitId ? latched.askId : null;
  const dismissed = dismissedVisit === visitId;
  const activeAskId = dismissed ? null : (latchedId ?? firstEligibleId);

  // Deliberately NOT latched at mount: on a data-fetching screen every
  // flag is still loading on the first render, so latching "nothing is
  // eligible" then would close the slot for the whole visit. The latch
  // waits for the first render of this visit that has a real answer.
  useEffect(() => {
    if (latchedId === null && firstEligibleId !== null) {
      setLatched({ visit: visitId, askId: firstEligibleId });
    }
  }, [latchedId, firstEligibleId, visitId]);

  useFocusEffect(
    useCallback(() => {
      setVisitId((v) => v + 1);
    }, [])
  );

  return { activeAskId, dismissActive: () => setDismissedVisit(visitId) };
}

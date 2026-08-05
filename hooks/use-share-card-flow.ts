import { useState } from 'react';
import { View } from 'react-native';

import { STRINGS } from '@/constants/strings';
import { captureShareCard, saveCardImage, shareCardImage } from '@/lib/shareCardExport';
import { recordCardEvent, ShareCardFlavor } from '@/lib/shareCards';

/**
 * HY1 job 4 (R5, 5 Aug) — WHAT A "Share" TAP ON A CARD DOES, for every
 * screen that offers one.
 *
 * /share-card and /wrapped had each typed out the same seven lines:
 * capture the hidden 9:16 view, try the share sheet, fall back to a save,
 * record `'shared'` or `'saved'`, warm-line on failure, and flip the
 * in-flight flag back either way. Same shape as WB1 job 3's
 * `useCheckinLaunch`: the DECISION was already shared (lib/shareCardExport
 * owns the platform branches) — what was not was the COMPOSITION around
 * it, which is the part that drifts. Two copies is how one screen ends up
 * recording `'shared'` for a save, or losing the fallback entirely.
 *
 * THE FALLBACK IS THE POINT, and it is why this is worth a hook rather
 * than a comment: `shareCardImage` returning false does not mean failure,
 * it means no share sheet was presented (no `navigator.share`, or the
 * browser refused the file) — and share-cards spec §6 says that path ends
 * in a download, not an apology. A screen that re-implements this and
 * treats false as an error silently removes the only way a web user can
 * keep their card.
 *
 * The hook owns only per-screen state (is a capture in flight). Failures
 * are handed BACK via `onError` rather than rendered here — both screens
 * already have their own MessageDialog, and this must not invent a third.
 * `onResolved` is likewise the caller's: /share-card uses it to earn OD1
 * job 8e's closing pop, /wrapped has no such beat and simply omits it.
 */
export function useShareCardFlow(params: {
  flavor: ShareCardFlavor;
  /** The card's identity in `card_events`. Falsy means "not ready yet" —
   * the tap becomes a no-op rather than writing an event with no subject. */
  cardKey: string | undefined;
  /** The hidden 9:16 capture view, never the on-screen preview. */
  cardRef: React.RefObject<View | null>;
  /** ER1's warm line, never a raw message (warmth law). */
  onError: (message: string) => void;
  /** Called once a share or save has genuinely landed. */
  onResolved?: () => void;
}): {
  share: () => Promise<void>;
  /** True while the capture/share is running, for disabling the control. */
  isSharing: boolean;
} {
  const [isSharing, setIsSharing] = useState(false);

  const share = async () => {
    if (!params.cardKey || isSharing) return;
    const cardKey = params.cardKey;
    setIsSharing(true);
    try {
      const uri = await captureShareCard(params.cardRef);
      const shared = await shareCardImage(uri);
      if (shared) {
        // Best-effort: a missed event only costs future rotation tuning,
        // and the card has already left the app either way.
        recordCardEvent(params.flavor, cardKey, 'shared').catch(() => {});
      } else {
        // NOT a failure — see the note above. No share sheet exists here,
        // so the card is downloaded instead and recorded as what it was.
        await saveCardImage(uri);
        recordCardEvent(params.flavor, cardKey, 'saved').catch(() => {});
      }
      params.onResolved?.();
    } catch {
      params.onError(STRINGS.shareCardShareError);
    } finally {
      setIsSharing(false);
    }
  };

  return { share, isSharing };
}

import { Platform, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

import { APP_LINK, SHARE_TAGLINE } from '@/constants/sharing';

// SC1 (13 July) — spec §6. The card itself (ShareCardView) never carries
// screen chrome or a link; this module renders it to a PNG and carries
// the tagline + APP_LINK alongside the image in the share payload, never
// baked into the PNG itself. iOS Safari is the primary target — it's the
// real audience (spec's own words).

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1920;

export async function captureShareCard(viewRef: React.RefObject<View | null>): Promise<string> {
  return captureRef(viewRef, {
    format: 'png',
    quality: 1,
    result: Platform.OS === 'web' ? 'data-uri' : 'tmpfile',
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  });
}

async function dataUriToFile(dataUri: string, filename: string): Promise<File> {
  const res = await fetch(dataUri);
  const blob = await res.blob();
  return new File([blob], filename, { type: 'image/png' });
}

/** Returns whether a real share sheet was actually presented — false
 * means the caller should fall back to the save-image path (spec §6:
 * "fallback = download + a one-line 'save it, post it anywhere'"). */
export async function shareCardImage(uri: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean };
    if (!nav.share) return false;
    const file = await dataUriToFile(uri, 'rally21-card.png');
    const shareData: ShareData = { text: `${SHARE_TAGLINE} ${APP_LINK}`, files: [file] };
    if (nav.canShare && !nav.canShare(shareData)) return false;
    try {
      await nav.share(shareData);
      return true;
    } catch {
      // AbortError (user cancelled) is still "a share sheet was shown" —
      // only a genuinely unsupported call should fall back to save.
      return true;
    }
  }

  const available = await Sharing.isAvailableAsync();
  if (!available) return false;
  await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: SHARE_TAGLINE });
  return true;
}

/** Save-image fallback, always available (spec §6). On web this is a
 * plain download; on native, the share sheet itself offers "Save Image"
 * (no separate expo-media-library dependency/permission needed for v1). */
export async function saveCardImage(uri: string): Promise<void> {
  if (Platform.OS === 'web') {
    const a = document.createElement('a');
    a.href = uri;
    a.download = 'rally21-card.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }
  const available = await Sharing.isAvailableAsync();
  if (available) {
    await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Save your card' });
  }
}

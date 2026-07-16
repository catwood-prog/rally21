import { Linking, Platform } from 'react-native';

// IN1 (15 July) — "Share invite" becomes a channel chooser. This module
// owns HOW an invite message travels; the message itself has exactly one
// source of truth (STRINGS.inviteShareMessage) and arrives here as a
// parameter — nothing in this file composes or amends invite text, so the
// text handed to every channel is byte-identical to what "copy" produces.

export type InviteChannel = 'mail' | 'whatsapp' | 'sms';

export function buildMailtoUrl(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function buildWhatsAppUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export type SmsPlatform = 'ios' | 'android';

// iOS parses `sms:&body=`, Android wants `sms:?body=` — same URL scheme,
// different separator, both long-documented quirks of the scheme.
export function buildSmsUrl(message: string, platform: SmsPlatform): string {
  const separator = platform === 'ios' ? '&' : '?';
  return `sms:${separator}body=${encodeURIComponent(message)}`;
}

// Pure so it's unit-testable; callers pass the real navigator.userAgent.
export function smsPlatformFromUserAgent(userAgent: string): SmsPlatform | null {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return null;
}

/** Where can sms: actually open something? Native iOS/Android always; on
 * web only a mobile browser (desktop has no Messages handler). null means
 * "hide the option" — a dead control is worse than a missing one. */
export function currentSmsPlatform(): SmsPlatform | null {
  if (Platform.OS === 'ios' || Platform.OS === 'android') return Platform.OS;
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    return smsPlatformFromUserAgent(navigator.userAgent ?? '');
  }
  return null;
}

/** The direct channels the in-app chooser should offer right now, in
 * display order. Mail and WhatsApp work everywhere (wa.me opens WhatsApp
 * Web on desktop); sms only where a handler exists. */
export function availableInviteChannels(): InviteChannel[] {
  const channels: InviteChannel[] = ['mail', 'whatsapp'];
  if (currentSmsPlatform() !== null) channels.push('sms');
  return channels;
}

/** Open a channel's compose surface with the message pre-populated.
 * Returns false when the channel couldn't open, so the caller can fall
 * back to copy — never a dead tap or an error dialog. */
export async function openInviteChannel(
  channel: InviteChannel,
  message: string,
  mailSubject: string
): Promise<boolean> {
  let url: string;
  if (channel === 'mail') {
    url = buildMailtoUrl(mailSubject, message);
  } else if (channel === 'whatsapp') {
    url = buildWhatsAppUrl(message);
  } else {
    const smsPlatform = currentSmsPlatform();
    if (!smsPlatform) return false;
    url = buildSmsUrl(message, smsPlatform);
  }

  if (Platform.OS === 'web') {
    if (channel === 'whatsapp') {
      // https URL — a new tab keeps the invite screen alive underneath.
      window.open(url, '_blank', 'noopener');
      return true;
    }
    // mailto:/sms: hand off to the OS without leaving the page; a new
    // tab here would just flash a blank window in most browsers.
    window.location.href = url;
    return true;
  }

  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

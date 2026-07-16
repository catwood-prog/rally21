import { STRINGS } from '@/constants/strings';

import {
  buildMailtoUrl,
  buildSmsUrl,
  buildWhatsAppUrl,
  smsPlatformFromUserAgent,
} from './sharing';

// IN1 (15 July) — the hard rule under test: every channel carries the
// exact message the copy flow produces. The builders only ever encode;
// decoding a channel URL must round-trip byte-identically, including for
// circle names with spaces, an emoji, and an ampersand (the character
// most likely to silently truncate a naive query string).
const AWKWARD_CIRCLE_NAME = "Tom & Jerry's 🐧 crew";
const MESSAGE = STRINGS.inviteShareMessage(AWKWARD_CIRCLE_NAME, 'ABC123');
const SUBJECT = STRINGS.inviteMailSubject(AWKWARD_CIRCLE_NAME);

/** Parse a query-ish string the way a receiving app does: split on '&',
 * take the named param. If encoding leaked a raw '&' or '=', the value
 * comes back truncated and the identity assertions below fail. */
function queryParam(url: string, name: string): string | null {
  const queryStart = url.search(/[?&]/);
  if (queryStart === -1) return null;
  for (const pair of url.slice(queryStart + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (eq !== -1 && pair.slice(0, eq) === name) {
      return decodeURIComponent(pair.slice(eq + 1));
    }
  }
  return null;
}

describe('invite channel URLs carry the copy message byte-identically', () => {
  it('mailto body round-trips, and the subject survives alongside it', () => {
    const url = buildMailtoUrl(SUBJECT, MESSAGE);
    expect(url.startsWith('mailto:?')).toBe(true);
    expect(queryParam(url, 'body')).toBe(MESSAGE);
    expect(queryParam(url, 'subject')).toBe(SUBJECT);
  });

  it('wa.me text round-trips', () => {
    const url = buildWhatsAppUrl(MESSAGE);
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(queryParam(url, 'text')).toBe(MESSAGE);
  });

  it('sms body round-trips on both platforms', () => {
    expect(queryParam(buildSmsUrl(MESSAGE, 'ios'), 'body')).toBe(MESSAGE);
    expect(queryParam(buildSmsUrl(MESSAGE, 'android'), 'body')).toBe(MESSAGE);
  });

  it('the encoded portion never leaks a raw ampersand, hash, or space', () => {
    for (const encoded of [
      buildWhatsAppUrl(MESSAGE).slice('https://wa.me/?text='.length),
      buildSmsUrl(MESSAGE, 'ios').slice('sms:&body='.length),
    ]) {
      expect(encoded).not.toMatch(/[&# ]/);
    }
  });
});

describe('the sms platform quirk (iOS "&body=" vs Android "?body=")', () => {
  it('iOS gets sms:&body=', () => {
    expect(buildSmsUrl('hi', 'ios').startsWith('sms:&body=')).toBe(true);
  });

  it('Android gets sms:?body=', () => {
    expect(buildSmsUrl('hi', 'android').startsWith('sms:?body=')).toBe(true);
  });
});

describe('smsPlatformFromUserAgent — sms hides where it cannot work', () => {
  it('iPhone Safari reads as ios', () => {
    expect(
      smsPlatformFromUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
      )
    ).toBe('ios');
  });

  it('Android Chrome reads as android', () => {
    expect(
      smsPlatformFromUserAgent(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
      )
    ).toBe('android');
  });

  it('desktop macOS reads as null (option hidden, never a dead tap)', () => {
    expect(
      smsPlatformFromUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      )
    ).toBe(null);
  });
});

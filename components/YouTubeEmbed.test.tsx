/**
 * YT1 job 2 — the native embed is framed from an origin, so YouTube gets a
 * referer.
 *
 * Found on Cat's phone 23 Aug, root-caused the same sitting and MEASURED in
 * WKWebView on 27 Aug: loaded directly as the WebView's `uri`, both live
 * circle links come back "Error 153 / Video player configuration error" with
 * no Referer on the wire at all (`Sec-Fetch-Site: none`); given a referer,
 * both load their real player. The controls in that sitting are what make
 * the referer the variable rather than a guess — the same ids 153 on
 * `youtube.com` as on `youtube-nocookie.com`, under the macOS user agent as
 * under the iOS one, and a wrapper document whose baseUrl is left at
 * react-native-webview's `about:blank` default still 153s.
 *
 * A bundle grep cannot settle this: the embed URL is in both bundles either
 * way, and the thing that changed is the SHAPE of the `source` prop. So this
 * renders the real component on both platforms and looks at what each branch
 * actually hands down — which is also the only way to hold the other half of
 * YT1's fence, that the web branch did not move.
 *
 * Platform.OS is flipped per-case rather than mocked at module scope,
 * following RemindersAskCard.test.tsx: both branches of ONE component are
 * under test, so they have to share an environment.
 */
import React from 'react';
import { Platform } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { WebView } from 'react-native-webview';

import { YouTubeEmbed } from './YouTubeEmbed';

// The real module pulls its native component in at require time, which
// nothing in this environment can provide. Kept as a function component
// (not `null` inline) so `findByType` can still read the props it was given.
jest.mock('react-native-webview', () => ({ WebView: () => null }));

const REAL_OS = Platform.OS;
const ID = 'ncbkhqwpYCI'; // Daily Meditation's live link — one of the two that 153'd.

function setPlatform(os: string) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

afterEach(() => setPlatform(REAL_OS));

function render(os: string, videoId = ID) {
  setPlatform(os);
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<YouTubeEmbed videoId={videoId} />);
  });
  return tree;
}

function nativeSource(videoId = ID): { html?: string; baseUrl?: string; uri?: string } {
  return render('ios', videoId).root.findByType(WebView as any).props.source;
}

describe('the native branch frames the player instead of loading it directly', () => {
  it('hands the WebView a document, never a bare uri — the 153 shape', () => {
    const source = nativeSource();
    expect(source.uri).toBeUndefined();
    expect(typeof source.html).toBe('string');
  });

  it('gives that document rally21.com as its origin', () => {
    // The measured control: react-native-webview falls back to `about:blank`
    // when `baseUrl` is absent, and an about:blank wrapper still 153s — so
    // the baseUrl is the load-bearing half, not the wrapper.
    expect(nativeSource().baseUrl).toBe('https://rally21.com');
  });

  it('frames the embed with an explicit cross-origin referrer policy', () => {
    const html = nativeSource().html ?? '';
    expect(html).toContain('referrerpolicy="strict-origin-when-cross-origin"');
    expect(html).toContain(`src="https://www.youtube-nocookie.com/embed/${ID}"`);
  });

  it('keeps the playback behaviours the direct load had', () => {
    const props = render('ios').root.findByType(WebView as any).props;
    expect(props.allowsFullscreenVideo).toBe(true);
    expect(props.allowsInlineMediaPlayback).toBe(true);
    expect(props.mediaPlaybackRequiresUserAction).toBe(false);
    // The `allow` list and fullscreen move from the WebView's props into the
    // framed iframe, so the wrapper has to carry them.
    const html = props.source.html as string;
    expect(html).toContain(
      'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"'
    );
    expect(html).toContain('allowfullscreen');
  });

  it('encodes the id, because it now lands in an HTML attribute', () => {
    // Both call sites pass `extractYouTubeId` output, which is always
    // [A-Za-z0-9_-]{11} — so this is a no-op today and a closed door if a
    // third caller ever passes a raw string.
    const html = nativeSource('a" onload="x') .html ?? '';
    expect(html).not.toContain('onload="x');
    expect(html).toContain('a%22%20onload%3D%22x');
  });
});

describe('the web branch does not move', () => {
  it('still renders a plain iframe at the unchanged embed url', () => {
    const iframe = render('web').root.findByType('iframe' as any);
    expect(iframe.props.src).toBe(`https://www.youtube-nocookie.com/embed/${ID}`);
    expect(iframe.props.allowFullScreen).toBe(true);
    expect(iframe.props.loading).toBe('lazy');
    expect(iframe.props.allow).toBe(
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
    );
  });

  it('renders no WebView on web', () => {
    expect(render('web').root.findAllByType(WebView as any)).toHaveLength(0);
  });
});

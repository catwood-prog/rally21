import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

// react-native's JSX.IntrinsicElements has no 'iframe' — react-native-web
// renders it fine at runtime, this just sidesteps the missing type.
const Iframe: any = 'iframe';

/**
 * YT1 (27 Aug) — the origin the native player is framed FROM.
 *
 * Deliberately not `APP_LINK` from `constants/sharing.ts`, which happens to
 * hold the same string today: that one is "the link we hand a person", and
 * its own comment forecasts it becoming a TestFlight or App Store URL. This
 * one is a referer YouTube has to accept, so the two must be free to move
 * apart. It does not have to resolve to anything — nothing is fetched from
 * it — it only has to be the web origin the app really is.
 */
const NATIVE_EMBED_ORIGIN = 'https://rally21.com';

/**
 * YT1 (27 Aug) — the wrapper document that gives the native player a referer.
 *
 * Found on Cat's phone 23 Aug: YouTube embeds died with error 153, "Video
 * player configuration error". It is YouTube's own 2025-26 enforcement of a
 * valid HTTP Referer on embedded playback, not a bad link. Measured in
 * WKWebView on 27 Aug against both live circle links: loaded DIRECTLY as the
 * WebView's uri — which is what this component used to do — the request
 * carries no Referer at all (`Sec-Fetch-Site: none`) and both videos 153.
 * Given a referer, both load their real player. The controls say the referer
 * is the whole variable: the same ids 153 on `youtube.com` as on
 * `youtube-nocookie.com`, and under the macOS user agent as under the iOS
 * one, and a wrapper whose baseUrl is left to react-native-webview's default
 * `about:blank` still 153s. The web branch below never had the bug because a
 * page at rally21.com framing an iframe sends a referer for free; this makes
 * native the same shape rather than a native-only special case.
 *
 * Not the alternative — a Referer header on `source` — because a header
 * decorates the FIRST request only, measured: a document loaded with an
 * injected `Referer: https://rally21.com/` issues its own subsequent
 * requests carrying its own URL instead. Here the referer is a consequence
 * of the document's origin, so every load and reload of the framed player
 * inherits it with nothing to keep in sync.
 *
 * `referrerpolicy` pins the policy WebKit already defaulted to when this was
 * measured, so the origin we send is a stated choice rather than a default
 * that can move. The id is url-encoded because it lands in an HTML attribute
 * here: every id `extractYouTubeId` returns is already `[A-Za-z0-9_-]{11}`,
 * so it is a no-op for real input and a closed door for anything else. That
 * encoding is also why the embed URL is spelled out again here instead of
 * sharing the web branch's `embedUrl` — the web branch is outside YT1's
 * fence and stays exactly as it shipped.
 */
function nativeEmbedDocument(videoId: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;height:100%;background:#000}iframe{display:block;width:100%;height:100%;border:0}</style>
</head>
<body>
<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  referrerpolicy="strict-origin-when-cross-origin"
  allowfullscreen></iframe>
</body>
</html>`;
}

export function YouTubeEmbed({
  videoId,
  style,
}: {
  videoId: string;
  style?: StyleProp<ViewStyle>;
}) {
  const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;

  return (
    <View style={[styles.container, style]}>
      {Platform.OS === 'web' ? (
        <Iframe
          src={embedUrl}
          style={{ width: '100%', height: '100%', border: 0 }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
          frameBorder="0"
        />
      ) : (
        <WebView
          source={{ html: nativeEmbedDocument(videoId), baseUrl: NATIVE_EMBED_ORIGIN }}
          style={styles.native}
          allowsFullscreenVideo
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  native: {
    flex: 1,
    backgroundColor: '#000',
  },
});

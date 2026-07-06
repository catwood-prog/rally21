import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

// react-native's JSX.IntrinsicElements has no 'iframe' — react-native-web
// renders it fine at runtime, this just sidesteps the missing type.
const Iframe: any = 'iframe';

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
          source={{ uri: embedUrl }}
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

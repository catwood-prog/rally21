import { Image, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { containedPatch, Rect, Size } from '@/lib/mascotFx';

/**
 * M2 — the cropped-patch overlay for the two sanctioned patch
 * crossfades (birthday candle flame, listener mug steam). Renders the
 * ALTERNATE frame clipped to just the patch region, positioned so it
 * lines up pixel-for-pixel with the base image underneath (both drawn
 * with resizeMode="contain" into the same box — geometry in
 * lib/mascotFx.ts). The parent owns the animated opacity style, so the
 * flicker (oscillating) and the steam (fade-in-and-hold) reuse one
 * mechanism. pointerEvents="none": purely decorative.
 *
 * Must be rendered as a sibling ON TOP of the base image, inside a
 * relatively-positioned wrapper exactly the size of the mascot box.
 */
export function MascotPatch({
  source,
  sourceSize,
  patch,
  box,
  animatedStyle,
}: {
  source: number;
  sourceSize: Size;
  patch: Rect;
  box: Size;
  animatedStyle: React.ComponentProps<typeof Animated.View>['style'];
}) {
  const { clip, image } = containedPatch(sourceSize, box, patch);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.clip,
        {
          left: clip.x,
          top: clip.y,
          width: clip.width,
          height: clip.height,
        },
        animatedStyle,
      ]}
    >
      <Image
        source={source}
        style={{
          position: 'absolute',
          left: image.x,
          top: image.y,
          width: image.width,
          height: image.height,
        }}
        resizeMode="stretch"
        accessible={false}
        alt=""
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: {
    position: 'absolute',
    overflow: 'hidden',
  },
});

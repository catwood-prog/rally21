/**
 * M2 — pure geometry/sequencing helpers for the mascot gesture layer.
 * No react/reanimated imports: everything here is unit-testable maths.
 * Timing constants live in lib/motion.ts (MASCOT_FX); components own
 * their own animation wiring, per the P1 convention.
 */

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** How resizeMode="contain" draws a source image inside a box: the
 * drawn size (uniform scale, no crop) and its centering offsets. */
export function containFit(source: Size, box: Size): {
  scale: number;
  drawWidth: number;
  drawHeight: number;
  offsetX: number;
  offsetY: number;
} {
  const scale = Math.min(box.width / source.width, box.height / source.height);
  const drawWidth = source.width * scale;
  const drawHeight = source.height * scale;
  return {
    scale,
    drawWidth,
    drawHeight,
    offsetX: (box.width - drawWidth) / 2,
    offsetY: (box.height - drawHeight) / 2,
  };
}

/**
 * The cropped-patch overlay maths (candle flame, mug steam): given a
 * patch rect in SOURCE-image pixels and the on-screen box the base
 * image renders into with resizeMode="contain", returns
 * - `clip`: where the overlay's clipping window sits inside the box, and
 * - `image`: where the full-size overlay frame must be positioned
 *   INSIDE that clipping window so only the patch shows, drawn at the
 *   exact same scale/position as the base underneath (so the two frames
 *   line up pixel-for-pixel and only the patch ever changes).
 */
export function containedPatch(source: Size, box: Size, patch: Rect): {
  clip: Rect;
  image: Rect;
} {
  const fit = containFit(source, box);
  return {
    clip: {
      x: fit.offsetX + patch.x * fit.scale,
      y: fit.offsetY + patch.y * fit.scale,
      width: patch.width * fit.scale,
      height: patch.height * fit.scale,
    },
    image: {
      x: -patch.x * fit.scale,
      y: -patch.y * fit.scale,
      width: fit.drawWidth,
      height: fit.drawHeight,
    },
  };
}

/**
 * A quick-swap frame schedule (wink, wave): at which elapsed times the
 * ALTERNATE frame is shown. `swaps` is the number of times the alternate
 * frame appears; each showing lasts `holdMs`, separated by `holdMs` on
 * the base frame. Always ends back on the base frame.
 * e.g. (0, 150, 2) → alt at 0–150 and 300–450, base in between/after.
 */
export function frameSwapSchedule(
  startMs: number,
  holdMs: number,
  swaps: number
): { showAltAtMs: number; showBaseAtMs: number }[] {
  return Array.from({ length: swaps }, (_, i) => ({
    showAltAtMs: startMs + i * 2 * holdMs,
    showBaseAtMs: startMs + i * 2 * holdMs + holdMs,
  }));
}

/**
 * The M2 patch rects, measured from the shipped frame pairs by pixel
 * diff (bbox of differing pixels + a small margin — the analysis script
 * lives in the M2 commit message). Source-pixel coordinates.
 */
export const BIRTHDAY_CANDLE_PATCH: { source: Size; patch: Rect } = {
  source: { width: 941, height: 1672 },
  patch: { x: 375, y: 670, width: 100, height: 125 },
};

export const LISTENER_STEAM_PATCH: { source: Size; patch: Rect } = {
  source: { width: 562, height: 700 },
  // The two listener frames differ ONLY in this region above the mug
  // (measured 71×64 at (190,298), held with margin — matches the brief's
  // "~70×60px above the mug").
  patch: { x: 178, y: 282, width: 95, height: 92 },
};

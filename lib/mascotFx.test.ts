/**
 * M2 — pins the patch-crop maths and frame-swap sequencing behind the
 * mascot gesture layer.
 */
import {
  BIRTHDAY_CANDLE_PATCH,
  containedPatch,
  containFit,
  frameSwapSchedule,
  LISTENER_STEAM_PATCH,
} from './mascotFx';

describe('containFit', () => {
  it('letterboxes a tall source in a wider box (the birthday mascot case)', () => {
    // 941×1672 into 150×165: height-limited, drawn 92.85×165, centered.
    const fit = containFit({ width: 941, height: 1672 }, { width: 150, height: 165 });
    expect(fit.scale).toBeCloseTo(165 / 1672, 6);
    expect(fit.drawHeight).toBeCloseTo(165);
    expect(fit.drawWidth).toBeCloseTo(941 * (165 / 1672));
    expect(fit.offsetY).toBeCloseTo(0);
    expect(fit.offsetX).toBeCloseTo((150 - 941 * (165 / 1672)) / 2);
  });

  it('is exact when aspect ratios match', () => {
    const fit = containFit({ width: 1000, height: 500 }, { width: 200, height: 100 });
    expect(fit).toEqual({ scale: 0.2, drawWidth: 200, drawHeight: 100, offsetX: 0, offsetY: 0 });
  });
});

describe('containedPatch', () => {
  it('positions the clip window over the patch and the image so frames align', () => {
    const { clip, image } = containedPatch(
      { width: 100, height: 200 },
      { width: 50, height: 100 }, // same aspect → scale 0.5, no offsets
      { x: 20, y: 40, width: 10, height: 20 }
    );
    expect(clip).toEqual({ x: 10, y: 20, width: 5, height: 10 });
    // Inside the clip, the full frame is pulled back by the scaled patch
    // origin so source pixel (20,40) lands exactly at the clip's corner.
    expect(image).toEqual({ x: -10, y: -20, width: 50, height: 100 });
  });

  it('the shipped patches sit inside their frames', () => {
    for (const { source, patch } of [BIRTHDAY_CANDLE_PATCH, LISTENER_STEAM_PATCH]) {
      expect(patch.x).toBeGreaterThanOrEqual(0);
      expect(patch.y).toBeGreaterThanOrEqual(0);
      expect(patch.x + patch.width).toBeLessThanOrEqual(source.width);
      expect(patch.y + patch.height).toBeLessThanOrEqual(source.height);
    }
  });

  it('overlay clip + image compose to the same on-screen scale as the base', () => {
    const source = BIRTHDAY_CANDLE_PATCH.source;
    const box = { width: 150, height: 165 };
    const { clip, image } = containedPatch(source, box, BIRTHDAY_CANDLE_PATCH.patch);
    const fit = containFit(source, box);
    // The overlay image is drawn at the base's own drawn size…
    expect(image.width).toBeCloseTo(fit.drawWidth);
    expect(image.height).toBeCloseTo(fit.drawHeight);
    // …and clip position + image offset reconstruct the base's own origin,
    // so the two frames line up pixel-for-pixel.
    expect(clip.x + image.x).toBeCloseTo(fit.offsetX);
    expect(clip.y + image.y).toBeCloseTo(fit.offsetY);
  });
});

describe('frameSwapSchedule', () => {
  it('builds the 404 wave: two showings of the wave frame, ending on base', () => {
    expect(frameSwapSchedule(350, 150, 2)).toEqual([
      { showAltAtMs: 350, showBaseAtMs: 500 },
      { showAltAtMs: 650, showBaseAtMs: 800 },
    ]);
  });

  it('builds the check-in wink: one showing', () => {
    expect(frameSwapSchedule(760, 120, 1)).toEqual([{ showAltAtMs: 760, showBaseAtMs: 880 }]);
  });
});

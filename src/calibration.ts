import { type RGB, hexToRgb, linearToSrgb, rgbToLab, srgbToLinear } from './color';

/**
 * A baseline taken by scanning an unused (unreacted) strip.
 *
 * We know what colour the unused strip *should* be (`reference`, usually white),
 * and we measured what the camera *actually* sees (`measured`). The difference is
 * the camera's colour cast and exposure under the current lighting, which we undo
 * on every later scan with a per-channel gain in linear light (von Kries-style
 * white balance, the same idea as a camera's "custom white balance").
 */
export interface Baseline {
  measured: RGB;
  reference: string;
  /** Unix ms when it was captured, so we can nudge people to redo it. */
  at: number;
}

export type Gains = [number, number, number];

// Keep corrections sane if the baseline was captured badly (e.g. in the dark).
const MIN_GAIN = 0.25;
const MAX_GAIN = 4;

export function computeGains(b: Baseline): Gains {
  const ref = hexToRgb(b.reference);
  return [0, 1, 2].map((i) => {
    const m = srgbToLinear(b.measured[i]);
    const r = srgbToLinear(ref[i]);
    if (m <= 1e-4) return MAX_GAIN;
    return Math.min(MAX_GAIN, Math.max(MIN_GAIN, r / m));
  }) as Gains;
}

export function applyGains(rgb: RGB, gains: Gains): RGB {
  return rgb.map((c, i) => linearToSrgb(srgbToLinear(c) * gains[i])) as RGB;
}

export function invertGains(gains: Gains): Gains {
  return gains.map((g) => 1 / g) as Gains;
}

/** Problems with a baseline capture that are worth telling the user about. */
export function baselineWarnings(b: Baseline): string[] {
  const warnings: string[] = [];
  const [l] = rgbToLab(b.measured);
  if (l < 35) warnings.push('The strip looked quite dark. Add more light and recapture for a reliable baseline.');
  if (Math.max(...b.measured) >= 254) {
    warnings.push('Part of the strip was overexposed (pure white). Reduce glare or move out of direct light and recapture.');
  }
  const gains = computeGains(b);
  if (gains.some((g) => g === MIN_GAIN || g === MAX_GAIN)) {
    warnings.push('The correction needed is very large. Check that the square was on the unused strip.');
  }
  return warnings;
}

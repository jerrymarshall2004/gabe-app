import { type Lab, type RGB, deltaE, hexToRgb, rgbToLab } from './color';

/** One reference colour on the scale, e.g. "this pink means 50". */
export interface Stop {
  hex: string;
  value: number;
}

export interface Reading {
  /** Interpolated value on the user's scale (e.g. 62.5). */
  value: number;
  /** 0–1 position along the gradient from its lowest to highest value. */
  position: number;
  /** ΔE between the sample and the closest point on the gradient. Big = poor match. */
  distance: number;
}

/**
 * Map a colour onto a gradient defined by colour stops.
 *
 * The stops form a path through CIELAB space (white → pink → red is a curve
 * through colour space). We project the sample onto the nearest point on
 * that path and interpolate the value linearly within the matching segment.
 * This works for any number of stops and tolerates samples that are a bit
 * off the ideal gradient (e.g. slightly different lighting).
 */
export function readGradient(sample: RGB, stops: Stop[]): Reading {
  if (stops.length === 0) throw new Error('Gradient needs at least one stop');
  const sorted = [...stops].sort((a, b) => a.value - b.value);
  const labs = sorted.map((s) => rgbToLab(hexToRgb(s.hex)));
  const p = rgbToLab(sample);
  const min = sorted[0].value;
  const max = sorted[sorted.length - 1].value;
  const toPosition = (v: number) => (max === min ? 0 : (v - min) / (max - min));

  if (sorted.length === 1) {
    return { value: min, position: 0, distance: deltaE(p, labs[0]) };
  }

  let best: Reading | null = null;
  for (let i = 0; i < sorted.length - 1; i++) {
    const t = projectOntoSegment(p, labs[i], labs[i + 1]);
    const point = lerpLab(labs[i], labs[i + 1], t);
    const distance = deltaE(p, point);
    if (!best || distance < best.distance) {
      const value = sorted[i].value + t * (sorted[i + 1].value - sorted[i].value);
      best = { value, position: toPosition(value), distance };
    }
  }
  return best!;
}

/** Fraction (clamped 0–1) along segment a→b of the point closest to p. */
function projectOntoSegment(p: Lab, a: Lab, b: Lab): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  if (len2 === 0) return 0;
  const t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2;
  return Math.min(1, Math.max(0, t));
}

function lerpLab(a: Lab, b: Lab, t: number): Lab {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export type ThresholdMode = 'range' | 'relative';

/**
 * How far a value is past the threshold, in percent.
 * - "range": as a share of the whole scale (10 = 10% of the gradient past the threshold).
 * - "relative": relative to the threshold itself (10 = 1.1 × threshold).
 */
export function percentOverThreshold(
  value: number,
  threshold: number,
  stops: Stop[],
  mode: ThresholdMode,
): number {
  if (mode === 'relative') {
    return threshold === 0 ? NaN : ((value - threshold) / Math.abs(threshold)) * 100;
  }
  const values = stops.map((s) => s.value);
  const span = Math.max(...values) - Math.min(...values);
  return span === 0 ? NaN : ((value - threshold) / span) * 100;
}

/** CSS linear-gradient for previewing the scale, with stops placed by value. */
export function gradientCss(stops: Stop[]): string {
  const sorted = [...stops].sort((a, b) => a.value - b.value);
  if (sorted.length === 1) return sorted[0].hex;
  const min = sorted[0].value;
  const span = sorted[sorted.length - 1].value - min || 1;
  const parts = sorted.map((s) => `${s.hex} ${(((s.value - min) / span) * 100).toFixed(2)}%`);
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

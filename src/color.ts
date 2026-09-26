/** Colour-space helpers. All RGB values are 0–255 sRGB unless noted. */

export type RGB = [number, number, number];
export type Lab = [number, number, number];

/** sRGB channel (0–255) → linear light (0–1). */
export function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Linear light (0–1) → sRGB channel (0–255, unrounded). */
export function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, c * 255));
}

// D65 reference white.
const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;

function labF(t: number): number {
  const d = 6 / 29;
  return t > d ** 3 ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29;
}

/**
 * sRGB → CIELAB (D65). Lab is roughly perceptually uniform, so straight-line
 * distances in it track how different two colours look to a person.
 */
export function rgbToLab([r, g, b]: RGB): Lab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175;
  const z = lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041;
  const fx = labF(x / XN);
  const fy = labF(y / YN);
  const fz = labF(z / ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference. ~2.3 is a "just noticeable" difference. */
export function deltaE(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export interface PixelStats {
  /** Mean colour, averaged in linear light then converted back to sRGB. */
  mean: RGB;
  /** Mean per-pixel ΔE from the mean colour: a rough "how uniform is the patch" score. */
  spread: number;
  count: number;
}

/**
 * Average RGBA pixel data (as returned by getImageData). Averaging is done in
 * linear light, which is physically correct for mixing light from many pixels.
 */
export function averagePixels(data: Uint8ClampedArray | number[]): PixelStats {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    r += srgbToLinear(data[i]);
    g += srgbToLinear(data[i + 1]);
    b += srgbToLinear(data[i + 2]);
    n++;
  }
  if (n === 0) return { mean: [0, 0, 0], spread: 0, count: 0 };

  const mean: RGB = [linearToSrgb(r / n), linearToSrgb(g / n), linearToSrgb(b / n)];
  const meanLab = rgbToLab(mean);

  // Sub-sample for the spread estimate; it only needs to be approximate.
  const step = Math.max(1, Math.floor(n / 400)) * 4;
  let spreadSum = 0;
  let spreadN = 0;
  for (let i = 0; i + 3 < data.length; i += step) {
    spreadSum += deltaE(rgbToLab([data[i], data[i + 1], data[i + 2]]), meanLab);
    spreadN++;
  }
  return { mean, spread: spreadSum / spreadN, count: n };
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid hex colour: ${hex}`);
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

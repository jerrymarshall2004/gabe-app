import { describe, expect, it } from 'vitest';
import { applyGains, baselineWarnings, computeGains } from './calibration';
import { type RGB, hexToRgb, linearToSrgb, srgbToLinear } from './color';
import { readGradient } from './gradient';

/** Simulate a camera colour cast: scale each channel in linear light. */
function tint(rgb: RGB, cast: [number, number, number]): RGB {
  return rgb.map((c, i) => linearToSrgb(srgbToLinear(c) * cast[i])) as RGB;
}

const warmDim: [number, number, number] = [0.8, 0.65, 0.45]; // yellowish, underexposed light

describe('baseline calibration', () => {
  it('is a no-op when the camera already sees the reference colour', () => {
    const gains = computeGains({ measured: [255, 255, 255], reference: '#ffffff', at: 0 });
    gains.forEach((g) => expect(g).toBeCloseTo(1, 6));
  });

  it('undoes a colour cast measured from an unused strip', () => {
    const measuredWhite = tint([255, 255, 255], warmDim);
    const gains = computeGains({ measured: measuredWhite, reference: '#ffffff', at: 0 });

    const truePink = hexToRgb('#f4a6c0');
    const corrected = applyGains(tint(truePink, warmDim), gains);
    corrected.forEach((c, i) => expect(c).toBeCloseTo(truePink[i], 0));
  });

  it('makes readings under a colour cast match readings under neutral light', () => {
    const stops = [
      { hex: '#ffffff', value: 0 },
      { hex: '#f4a6c0', value: 50 },
      { hex: '#c8102e', value: 100 },
    ];
    const patch = hexToRgb('#e05a78');
    const truth = readGradient(patch, stops).value;

    const seen = tint(patch, warmDim);
    const uncorrected = readGradient(seen, stops).value;
    const gains = computeGains({ measured: tint([255, 255, 255], warmDim), reference: '#ffffff', at: 0 });
    const corrected = readGradient(applyGains(seen, gains), stops).value;

    expect(Math.abs(corrected - truth)).toBeLessThan(0.5);
    expect(Math.abs(uncorrected - truth)).toBeGreaterThan(Math.abs(corrected - truth));
  });

  it('clamps extreme corrections and warns about them', () => {
    const b = { measured: [5, 5, 5] as RGB, reference: '#ffffff', at: 0 };
    computeGains(b).forEach((g) => expect(g).toBe(4));
    expect(baselineWarnings(b).length).toBeGreaterThan(0);
  });

  it('does not warn for a reasonable capture', () => {
    expect(baselineWarnings({ measured: [225, 215, 200], reference: '#ffffff', at: 0 })).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { averagePixels, hexToRgb, rgbToHex, rgbToLab } from './color';
import { type Stop, percentOverThreshold, readGradient } from './gradient';

const stops: Stop[] = [
  { hex: '#ffffff', value: 0 },
  { hex: '#f4a6c0', value: 50 },
  { hex: '#c8102e', value: 100 },
];

describe('color', () => {
  it('converts white and black to Lab', () => {
    const [l, a, b] = rgbToLab([255, 255, 255]);
    expect(l).toBeCloseTo(100, 1);
    expect(Math.abs(a)).toBeLessThan(0.1);
    expect(Math.abs(b)).toBeLessThan(0.1);
    expect(rgbToLab([0, 0, 0])[0]).toBeCloseTo(0, 5);
  });

  it('round-trips hex', () => {
    expect(rgbToHex(hexToRgb('#c8102e'))).toBe('#c8102e');
  });

  it('averages pixels in linear light', () => {
    // Half black, half white averages to ~188 in sRGB, not 128.
    const px = [0, 0, 0, 255, 255, 255, 255, 255];
    const { mean, count } = averagePixels(px);
    expect(count).toBe(2);
    expect(Math.round(mean[0])).toBe(188);
  });
});

describe('readGradient', () => {
  it('returns exact values at the stops', () => {
    for (const s of stops) {
      const r = readGradient(hexToRgb(s.hex), stops);
      expect(r.value).toBeCloseTo(s.value, 5);
      expect(r.distance).toBeLessThan(1e-6);
    }
  });

  it('interpolates between stops', () => {
    // Midway (in Lab, roughly) between pink and red.
    const r = readGradient(hexToRgb('#e05a78'), stops);
    expect(r.value).toBeGreaterThan(55);
    expect(r.value).toBeLessThan(95);
    expect(r.position).toBeCloseTo(r.value / 100, 5);
  });

  it('clamps colours beyond the ends of the scale', () => {
    expect(readGradient([150, 0, 20], stops).value).toBeGreaterThan(99);
  });

  it('flags off-scale colours with a large distance', () => {
    expect(readGradient([0, 160, 255], stops).distance).toBeGreaterThan(40);
  });

  it('works regardless of stop order', () => {
    const r1 = readGradient(hexToRgb('#f4a6c0'), stops);
    const r2 = readGradient(hexToRgb('#f4a6c0'), [...stops].reverse());
    expect(r1.value).toBeCloseTo(r2.value, 8);
  });
});

describe('percentOverThreshold', () => {
  it('reports as a share of the scale', () => {
    expect(percentOverThreshold(60, 50, stops, 'range')).toBeCloseTo(10);
    expect(percentOverThreshold(40, 50, stops, 'range')).toBeCloseTo(-10);
  });

  it('reports relative to the threshold', () => {
    expect(percentOverThreshold(55, 50, stops, 'relative')).toBeCloseTo(10);
  });
});

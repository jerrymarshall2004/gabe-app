import type { Baseline } from './calibration';
import type { Stop, ThresholdMode } from './gradient';

export interface Settings {
  stops: Stop[];
  threshold: number;
  thresholdMode: ThresholdMode;
  unit: string;
  /** Sample square size as a fraction of the frame's shorter side. */
  sampleSize: number;
  /** Camera baseline from an unused strip, or null if not captured yet. */
  baseline: Baseline | null;
  useBaseline: boolean;
  /** What an unused pad should look like; the baseline corrects towards this. */
  stripReference: string;
}

export const DEFAULT_SETTINGS: Settings = {
  stops: [
    { hex: '#ffffff', value: 0 },
    { hex: '#f4a6c0', value: 50 },
    { hex: '#c8102e', value: 100 },
  ],
  threshold: 50,
  thresholdMode: 'range',
  unit: '',
  sampleSize: 0.2,
  baseline: null,
  useBaseline: true,
  stripReference: '#ffffff',
};

const KEY = 'patch-scanner-settings-v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...structuredClone(DEFAULT_SETTINGS), ...parsed };
    if (!Array.isArray(merged.stops) || merged.stops.length < 2) {
      merged.stops = structuredClone(DEFAULT_SETTINGS.stops);
    }
    return merged;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode / storage disabled: settings just won't persist.
  }
}

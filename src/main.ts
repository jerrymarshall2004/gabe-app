import './style.css';
import { type Baseline, applyGains, baselineWarnings, computeGains } from './calibration';
import { type PixelStats, type RGB, averagePixels, linearToSrgb, rgbToHex, srgbToLinear } from './color';
import { type Reading, type ThresholdMode, gradientCss, percentOverThreshold, readGradient } from './gradient';
import { DEFAULT_SETTINGS, type Settings, loadSettings, saveSettings } from './settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const stage = $<HTMLElement>('stage');
const video = $<HTMLVideoElement>('video');
const photo = $<HTMLImageElement>('photo');
const target = $<HTMLDivElement>('target');
const stageMsg = $<HTMLParagraphElement>('stage-msg');
const cameraBtn = $<HTMLButtonElement>('camera-btn');
const holdBtn = $<HTMLButtonElement>('hold-btn');
const fileInput = $<HTMLInputElement>('file-input');
const resultCard = $<HTMLElement>('result');
const modeBadge = $<HTMLSpanElement>('mode-badge');
const swatch = $<HTMLDivElement>('swatch');
const valueText = $<HTMLParagraphElement>('value-text');
const statusText = $<HTMLParagraphElement>('status-text');
const bar = $<HTMLDivElement>('bar');
const thresholdMarker = $<HTMLDivElement>('threshold-marker');
const readingMarker = $<HTMLDivElement>('reading-marker');
const barMin = $<HTMLSpanElement>('bar-min');
const barMax = $<HTMLSpanElement>('bar-max');
const notes = $<HTMLUListElement>('notes');
const announcer = $<HTMLParagraphElement>('announcer');
const stopsList = $<HTMLOListElement>('stops');
const thresholdInput = $<HTMLInputElement>('threshold');
const unitInput = $<HTMLInputElement>('unit');
const sizeInput = $<HTMLInputElement>('sample-size');
const sizeOut = $<HTMLOutputElement>('size-out');
const tagline = $<HTMLParagraphElement>('tagline');
const baselineChip = $<HTMLParagraphElement>('baseline-chip');
const stripRefInput = $<HTMLInputElement>('strip-ref');
const captureBaselineBtn = $<HTMLButtonElement>('capture-baseline');
const baselineResult = $<HTMLDivElement>('baseline-result');
const baselineMeasured = $<HTMLDivElement>('baseline-measured');
const baselineReference = $<HTMLDivElement>('baseline-reference');
const baselineSummary = $<HTMLParagraphElement>('baseline-summary');
const baselineWarningsList = $<HTMLUListElement>('baseline-warnings');
const useBaselineInput = $<HTMLInputElement>('use-baseline');

let settings: Settings = loadSettings();
let stream: MediaStream | null = null;
let source: HTMLVideoElement | HTMLImageElement | null = null;
let held = false;
let lastSample: PixelStats | null = null;
let lastTick = 0;
let capturing = false;

const sampleCanvas = document.createElement('canvas');
const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true })!;

// ---------- Sampling ----------

function sourceSize(src: HTMLVideoElement | HTMLImageElement): [number, number] {
  return src instanceof HTMLVideoElement
    ? [src.videoWidth, src.videoHeight]
    : [src.naturalWidth, src.naturalHeight];
}

/** Average the pixels inside the centred sample square of the current frame. */
function sample(): PixelStats | null {
  if (!source) return null;
  const [w, h] = sourceSize(source);
  if (!w || !h) return null;
  const side = Math.max(2, Math.round(Math.min(w, h) * settings.sampleSize));
  const sx = Math.round((w - side) / 2);
  const sy = Math.round((h - side) / 2);
  // Cap the working size; plenty of pixels for a stable average and keeps it fast.
  const out = Math.min(side, 160);
  sampleCanvas.width = out;
  sampleCanvas.height = out;
  sampleCtx.drawImage(source, sx, sy, side, side, 0, 0, out, out);
  return averagePixels(sampleCtx.getImageData(0, 0, out, out).data);
}

/** The colour used for matching: the raw sample, corrected by the baseline if enabled. */
function effectiveColour(stats: PixelStats): RGB {
  if (settings.baseline && settings.useBaseline) {
    return applyGains(stats.mean, computeGains(settings.baseline));
  }
  return stats.mean;
}

/**
 * Average several frames for a steadier reading (live camera), or one sample
 * for a still photo. Averaged in linear light like the pixels themselves.
 */
async function captureSteady(frames = 12): Promise<PixelStats | null> {
  if (source !== video || held) return sample();
  const samples: PixelStats[] = [];
  for (let i = 0; i < frames; i++) {
    const s = sample();
    if (s) samples.push(s);
    await new Promise((r) => setTimeout(r, 60));
  }
  if (samples.length === 0) return null;
  const mean = [0, 1, 2].map((c) =>
    linearToSrgb(samples.reduce((sum, s) => sum + srgbToLinear(s.mean[c]), 0) / samples.length),
  ) as RGB;
  const spread = samples.reduce((sum, s) => sum + s.spread, 0) / samples.length;
  return { mean, spread, count: samples.reduce((n, s) => n + s.count, 0) };
}

/** Size the on-screen target square to match the sampled region (media is object-fit: cover). */
function layoutTarget(): void {
  if (!source) {
    target.hidden = true;
    return;
  }
  const [w, h] = sourceSize(source);
  if (!w || !h) return;
  const rect = stage.getBoundingClientRect();
  const scale = Math.max(rect.width / w, rect.height / h);
  const px = Math.min(w, h) * settings.sampleSize * scale;
  target.style.width = `${px}px`;
  target.style.height = `${px}px`;
  target.hidden = false;
}

// ---------- Rendering ----------

function fmt(n: number): string {
  return Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : '—';
}

function withUnit(n: number): string {
  return settings.unit ? `${fmt(n)} ${settings.unit}` : fmt(n);
}

interface Summary {
  reading: Reading;
  pct: number;
  sentence: string;
}

function summarise(stats: PixelStats): Summary {
  const reading = readGradient(effectiveColour(stats), settings.stops);
  const pct = percentOverThreshold(reading.value, settings.threshold, settings.stops, settings.thresholdMode);
  let sentence: string;
  if (!Number.isFinite(pct)) sentence = 'Threshold comparison unavailable.';
  else if (Math.abs(pct) < 0.5) sentence = 'At the threshold.';
  else sentence = `${fmt(Math.abs(pct))}% ${pct > 0 ? 'above' : 'below'} the threshold.`;
  return { reading, pct, sentence };
}

function render(stats: PixelStats | null): void {
  renderScale();
  renderBaselineChip();
  if (!stats) {
    valueText.textContent = '—';
    statusText.textContent = '';
    statusText.className = 'status';
    readingMarker.hidden = true;
    swatch.style.background = '';
    notes.replaceChildren();
    return;
  }
  const { reading, pct, sentence } = summarise(stats);
  swatch.style.background = rgbToHex(effectiveColour(stats));
  valueText.textContent = withUnit(reading.value);
  statusText.textContent = `${pct > 0.5 ? '▲' : pct < -0.5 ? '▼' : '●'} ${sentence}`;
  statusText.className = `status ${pct > 0.5 ? 'over' : pct < -0.5 ? 'under' : 'at'}`;
  readingMarker.hidden = false;
  readingMarker.style.left = `${reading.position * 100}%`;

  const items: string[] = [`${fmt(reading.position * 100)}% of the way along the scale.`];
  if (reading.distance > 15) {
    items.push('Poor colour match: this shade isn’t close to the scale. Check the lighting or recalibrate.');
  } else if (reading.distance > 6) {
    items.push('Fair colour match. Calibrating stops under this light will improve accuracy.');
  }
  if (stats.spread > 10) items.push('The patch looks uneven. Hold steady, or shrink the sample square.');
  notes.replaceChildren(
    ...items.map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    }),
  );
}

function renderScale(): void {
  const values = settings.stops.map((s) => s.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  bar.style.background = gradientCss(settings.stops);
  const pos = max === min ? 0 : (settings.threshold - min) / (max - min);
  thresholdMarker.style.left = `${Math.min(1, Math.max(0, pos)) * 100}%`;
  barMin.textContent = withUnit(min);
  barMax.textContent = withUnit(max);
}

function timeAgo(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function renderBaselineChip(): void {
  baselineChip.replaceChildren();
  const link = document.createElement('a');
  link.href = '#calibrate';
  if (!settings.baseline) {
    baselineChip.append('No baseline yet, so readings are uncorrected. ');
    link.textContent = 'Scan an unused strip';
  } else if (!settings.useBaseline) {
    baselineChip.append('Baseline correction is off. ');
    link.textContent = 'Turn it on';
  } else {
    const stale = Date.now() - settings.baseline.at > 6 * 3600_000;
    baselineChip.append(
      `Corrected with baseline from ${timeAgo(settings.baseline.at)}${stale ? ', which may be out of date' : ''}. `,
    );
    link.textContent = 'Recalibrate';
  }
  baselineChip.append(link);
}

function renderBaseline(): void {
  stripRefInput.value = settings.stripReference;
  const b = settings.baseline;
  baselineResult.hidden = !b;
  captureBaselineBtn.textContent = b ? 'Recapture baseline' : 'Capture baseline';
  if (!b) return;
  baselineMeasured.style.background = rgbToHex(b.measured);
  baselineReference.style.background = b.reference;
  const gains = computeGains(b);
  const pct = (g: number) => `${g >= 1 ? '+' : ''}${Math.round((g - 1) * 100)}%`;
  baselineSummary.textContent =
    `Captured ${timeAgo(b.at)}. Correction: red ${pct(gains[0])}, green ${pct(gains[1])}, blue ${pct(gains[2])}.`;
  baselineWarningsList.replaceChildren(
    ...baselineWarnings(b).map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    }),
  );
  useBaselineInput.checked = settings.useBaseline;
}

async function captureBaseline(): Promise<void> {
  if (!source || capturing) return;
  capturing = true;
  refreshStopButtons();
  captureBaselineBtn.textContent = 'Capturing… hold steady';
  const stats = await captureSteady();
  capturing = false;
  if (stats) {
    const baseline: Baseline = { measured: stats.mean, reference: settings.stripReference, at: Date.now() };
    settings.baseline = baseline;
    settings.useBaseline = true;
    persist();
    const warnings = baselineWarnings(baseline);
    announcer.textContent = warnings.length
      ? `Baseline captured, with a warning: ${warnings[0]}`
      : 'Baseline captured. Scans will now be corrected for this camera and lighting.';
  }
  renderBaseline();
  refreshStopButtons();
}

function announce(stats: PixelStats | null): void {
  if (!stats) return;
  const { reading, sentence } = summarise(stats);
  // Clear first so repeating the same text is still announced.
  announcer.textContent = '';
  requestAnimationFrame(() => {
    announcer.textContent = `Reading ${withUnit(reading.value)}. ${sentence}`;
  });
}

function setBadge(text: string, kind: 'live' | 'held' | 'idle'): void {
  modeBadge.textContent = text;
  modeBadge.dataset.kind = kind;
}

// ---------- Live loop ----------

function tick(now: number): void {
  if (source === video && stream && !held) {
    // ~8 updates a second is smooth enough and easy on the battery.
    if (now - lastTick > 120) {
      lastTick = now;
      lastSample = sample();
      render(lastSample);
      refreshStopButtons();
    }
    requestAnimationFrame(tick);
  }
}

// ---------- Camera / photo ----------

async function startCamera(): Promise<void> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    stageMsg.textContent =
      'Camera access needs a secure (https) page. Use “Upload photo” instead, or open the app over https.';
    stageMsg.hidden = false;
    return;
  }
  cameraBtn.disabled = true;
  stageMsg.textContent = 'Starting camera…';
  stageMsg.hidden = false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    photo.hidden = true;
    video.hidden = false;
    source = video;
    held = false;
    stageMsg.hidden = true;
    cameraBtn.textContent = 'Stop camera';
    holdBtn.disabled = false;
    updateHoldButton();
    setBadge('Live', 'live');
    layoutTarget();
    refreshStopButtons();
    requestAnimationFrame(tick);
  } catch (err) {
    stopCamera();
    const name = err instanceof DOMException ? err.name : '';
    stageMsg.textContent =
      name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access in your browser settings, or upload a photo.'
        : 'Couldn’t start the camera. You can upload a photo instead.';
    stageMsg.hidden = false;
  } finally {
    cameraBtn.disabled = false;
  }
}

function stopCamera(): void {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  if (source === video) {
    source = null;
    target.hidden = true;
    stageMsg.textContent = 'Camera stopped.';
    stageMsg.hidden = false;
    setBadge('No reading', 'idle');
  }
  cameraBtn.textContent = 'Start camera';
  holdBtn.disabled = true;
  held = false;
  updateHoldButton();
  refreshStopButtons();
}

function toggleHold(): void {
  if (source !== video || !stream) return;
  held = !held;
  updateHoldButton();
  if (held) {
    video.pause();
    lastSample = sample();
    render(lastSample);
    setBadge('Held', 'held');
    announce(lastSample);
  } else {
    void video.play();
    setBadge('Live', 'live');
    requestAnimationFrame(tick);
  }
}

function updateHoldButton(): void {
  holdBtn.textContent = held ? 'Resume live' : 'Hold reading';
  holdBtn.setAttribute('aria-pressed', String(held));
}

function loadPhoto(file: File): void {
  stopCamera();
  const url = URL.createObjectURL(file);
  photo.onload = () => {
    source = photo;
    video.hidden = true;
    photo.hidden = false;
    stageMsg.hidden = true;
    layoutTarget();
    lastSample = sample();
    render(lastSample);
    refreshStopButtons();
    setBadge('Photo', 'held');
    announce(lastSample);
    resultCard.focus();
  };
  photo.onerror = () => {
    stageMsg.textContent = 'That file couldn’t be opened as an image.';
    stageMsg.hidden = false;
  };
  if (photo.src.startsWith('blob:')) URL.revokeObjectURL(photo.src);
  photo.src = url;
}

// ---------- Settings UI ----------

function persist(): void {
  saveSettings(settings);
  render(lastSample);
}

function renderStops(): void {
  stopsList.replaceChildren(
    ...settings.stops.map((stop, i) => {
      const li = document.createElement('li');
      li.className = 'stop';

      const colour = document.createElement('input');
      colour.type = 'color';
      colour.value = stop.hex;
      colour.setAttribute('aria-label', `Colour of stop ${i + 1}`);
      colour.addEventListener('input', () => {
        stop.hex = colour.value;
        persist();
      });

      const valueLabel = document.createElement('label');
      valueLabel.className = 'stop-value';
      valueLabel.textContent = 'Value ';
      const value = document.createElement('input');
      value.type = 'number';
      value.step = 'any';
      value.inputMode = 'decimal';
      value.value = String(stop.value);
      value.setAttribute('aria-label', `Value of stop ${i + 1}`);
      value.addEventListener('change', () => {
        const v = parseFloat(value.value);
        if (Number.isFinite(v)) {
          stop.value = v;
          persist();
        } else {
          value.value = String(stop.value);
        }
      });
      valueLabel.append(value);

      const scan = document.createElement('button');
      scan.type = 'button';
      scan.className = 'btn small scan-btn';
      scan.textContent = 'Use current colour';
      scan.setAttribute('aria-label', `Set stop ${i + 1} to the current camera colour`);
      scan.addEventListener('click', () => {
        if (!lastSample) return;
        stop.hex = rgbToHex(effectiveColour(lastSample));
        colour.value = stop.hex;
        persist();
        announcer.textContent = `Stop ${i + 1} set to the current colour.`;
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn small ghost';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove stop ${i + 1}`);
      remove.disabled = settings.stops.length <= 2;
      remove.addEventListener('click', () => {
        settings.stops.splice(i, 1);
        renderStops();
        persist();
      });

      li.append(colour, valueLabel, scan, remove);
      return li;
    }),
  );
  refreshStopButtons();
}

function refreshStopButtons(): void {
  stopsList.querySelectorAll<HTMLButtonElement>('.scan-btn').forEach((b) => (b.disabled = !lastSample));
  captureBaselineBtn.disabled = !source || capturing;
}

function renderSettings(): void {
  renderStops();
  renderBaseline();
  thresholdInput.value = String(settings.threshold);
  unitInput.value = settings.unit;
  sizeInput.value = String(settings.sampleSize);
  sizeOut.textContent = `${Math.round(settings.sampleSize * 100)}%`;
  document
    .querySelectorAll<HTMLInputElement>('input[name="threshold-mode"]')
    .forEach((r) => (r.checked = r.value === settings.thresholdMode));
}

// ---------- Wiring ----------

cameraBtn.addEventListener('click', () => (stream ? stopCamera() : void startCamera()));
holdBtn.addEventListener('click', toggleHold);
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadPhoto(file);
  fileInput.value = '';
});

$<HTMLButtonElement>('add-stop').addEventListener('click', () => {
  const max = Math.max(...settings.stops.map((s) => s.value));
  settings.stops.push({ hex: lastSample ? rgbToHex(effectiveColour(lastSample)) : '#800000', value: max + 10 });
  renderStops();
  persist();
});

$<HTMLButtonElement>('reset').addEventListener('click', () => {
  settings.stops = structuredClone(DEFAULT_SETTINGS.stops);
  renderStops();
  persist();
});

captureBaselineBtn.addEventListener('click', () => void captureBaseline());
stripRefInput.addEventListener('input', () => {
  settings.stripReference = stripRefInput.value;
  if (settings.baseline) settings.baseline.reference = stripRefInput.value;
  renderBaseline();
  persist();
});
useBaselineInput.addEventListener('change', () => {
  settings.useBaseline = useBaselineInput.checked;
  persist();
});
$<HTMLButtonElement>('clear-baseline').addEventListener('click', () => {
  settings.baseline = null;
  renderBaseline();
  persist();
  announcer.textContent = 'Baseline cleared.';
  captureBaselineBtn.focus();
});

// ---------- Views (hash routing: #scan / #calibrate) ----------

const views = {
  scan: { el: $<HTMLDivElement>('view-scan'), tab: $<HTMLAnchorElement>('tab-scan'), heading: $('scan-heading'),
    tagline: 'Aim the square at the test strip pad to read it against your colour scale.' },
  calibrate: { el: $<HTMLDivElement>('view-calibrate'), tab: $<HTMLAnchorElement>('tab-calibrate'),
    heading: $('calibrate-heading'), tagline: 'Set up a baseline and colour scale for your strips and lighting.' },
};
type ViewName = keyof typeof views;

function showView(name: ViewName, moveFocus: boolean): void {
  for (const [key, v] of Object.entries(views)) {
    const active = key === name;
    v.el.hidden = !active;
    if (active) v.tab.setAttribute('aria-current', 'page');
    else v.tab.removeAttribute('aria-current');
  }
  tagline.textContent = views[name].tagline;
  if (name === 'calibrate') renderBaseline();
  if (moveFocus) views[name].heading.focus();
}

function route(moveFocus: boolean): void {
  const name = location.hash.slice(1);
  if (name === 'scan' || name === 'calibrate') showView(name, moveFocus);
}

window.addEventListener('hashchange', () => route(true));

thresholdInput.addEventListener('change', () => {
  const v = parseFloat(thresholdInput.value);
  if (Number.isFinite(v)) settings.threshold = v;
  thresholdInput.value = String(settings.threshold);
  persist();
});

unitInput.addEventListener('input', () => {
  settings.unit = unitInput.value.trim();
  persist();
});

sizeInput.addEventListener('input', () => {
  settings.sampleSize = parseFloat(sizeInput.value);
  sizeOut.textContent = `${Math.round(settings.sampleSize * 100)}%`;
  layoutTarget();
  if (source === photo || held) lastSample = sample();
  persist();
});

document.querySelectorAll<HTMLInputElement>('input[name="threshold-mode"]').forEach((r) =>
  r.addEventListener('change', () => {
    if (r.checked) {
      settings.thresholdMode = r.value as ThresholdMode;
      persist();
    }
  }),
);

new ResizeObserver(layoutTarget).observe(stage);
video.addEventListener('loadedmetadata', layoutTarget);
document.addEventListener('visibilitychange', () => {
  // Release the camera when the tab is hidden; it's a shared, battery-hungry resource.
  if (document.hidden && stream) stopCamera();
});

renderSettings();
setBadge('No reading', 'idle');
render(null);
showView('scan', false);
route(false);

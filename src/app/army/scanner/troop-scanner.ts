import { readTroopCount } from './count-ocr';
import {
  extractFeatures,
  scoreFeatures,
  type IconFeatures,
} from './icon-match';
import {
  cropRgba,
  imageToRgba,
  loadImageElement,
  resizeRgba,
  rgbaToDataUrl,
  type RgbaImage,
} from './image-utils';
import { buildScannerRefs } from './scanner-refs';
import type { ScanHit, ScanRef, ScanResult } from './scanner.types';

const FEAT_SIZE = 64;
/** Accept a tile once it is the best remaining claim for that icon. */
const MIN_SCORE = 0.64;
/** Keep a few near-misses so a similar archer can take the next tile. */
const PEAK_FLOOR = 0.6;
const PEAKS_PER_ICON = 4;

interface PreparedRef {
  ref: ScanRef;
  features: IconFeatures;
}

interface Peak {
  ref: ScanRef;
  x: number;
  y: number;
  size: number;
  score: number;
}

/**
 * Reference files include a thick ribbon frame that is not on the in-game card.
 * Drop the outer ornament so matching compares the portrait, not the frame.
 */
function innerPortrait(img: RgbaImage): RgbaImage {
  const { data, width: w, height: h } = img;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (data[p + 3] < 40) continue;
      const L = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      if (L < 18) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return img;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const insetX = Math.round(bw * 0.16);
  const insetY = Math.round(bh * 0.14);
  const x = minX + insetX;
  const y = minY + insetY;
  const cw = bw - insetX * 2;
  const ch = bh - insetY * 2;
  if (cw < 32 || ch < 32) return img;
  return cropRgba(img, x, y, cw, ch);
}

async function prepareRefs(refs: ScanRef[]): Promise<PreparedRef[]> {
  const out: PreparedRef[] = [];
  for (const ref of refs) {
    const img = await loadImageElement(ref.path);
    const rgba = innerPortrait(imageToRgba(img));
    out.push({
      ref,
      features: extractFeatures(resizeRgba(rgba, FEAT_SIZE, FEAT_SIZE)),
    });
  }
  return out;
}

function tileSizes(width: number): number[] {
  const min = Math.max(44, Math.round(width / 7.4));
  const max = Math.max(min + 4, Math.min(Math.round(width / 3.5), Math.floor(width * 0.46)));
  const sizes: number[] = [];
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const size = Math.round(min + ((max - min) * i) / (steps - 1));
    if (!sizes.includes(size)) sizes.push(size);
  }
  return sizes;
}

function meanColor(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  size: number,
): [number, number, number] {
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;
  const x0 = x + Math.floor(size * 0.2);
  const x1 = x + Math.floor(size * 0.8);
  const y0 = y + Math.floor(size * 0.18);
  const y1 = y + Math.floor(size * 0.7);
  for (let yy = y0; yy < y1; yy += 2) {
    if (yy < 0 || yy >= h) continue;
    for (let xx = x0; xx < x1; xx += 2) {
      if (xx < 0 || xx >= w) continue;
      const p = (yy * w + xx) * 4;
      sr += data[p];
      sg += data[p + 1];
      sb += data[p + 2];
      n++;
    }
  }
  return n ? [sr / n, sg / n, sb / n] : [0, 0, 0];
}

function colorDist(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function overlaps(
  a: { x: number; y: number; size: number },
  b: { x: number; y: number; size: number },
): boolean {
  const lim = Math.min(a.size, b.size) * 0.45;
  return Math.abs(a.x - b.x) < lim && Math.abs(a.y - b.y) < lim;
}

function findRefPeaks(shot: RgbaImage, prepared: PreparedRef): Peak[] {
  const { data, width: w, height: h } = shot;
  const refMean = prepared.features.mean;
  const yStart = Math.floor(h * 0.12);
  const candidates: Array<{ x: number; y: number; size: number }> = [];

  for (const size of tileSizes(w)) {
    const step = Math.max(4, Math.floor(size / 5));
    for (let y = yStart; y <= h - size; y += step) {
      for (let x = 2; x <= w - size - 1; x += step) {
        if (colorDist(meanColor(data, w, h, x, y, size), refMean) > 96) {
          continue;
        }
        candidates.push({ x, y, size });
      }
    }
  }

  if (!candidates.length) return [];

  const scored: Peak[] = [];
  for (const c of candidates) {
    const patch = cropRgba(shot, c.x, c.y, c.size, c.size);
    const feat = extractFeatures(resizeRgba(patch, FEAT_SIZE, FEAT_SIZE));
    const score = scoreFeatures(feat, prepared.features);
    if (score < PEAK_FLOOR) continue;
    scored.push({ ref: prepared.ref, ...c, score });
  }
  scored.sort((a, b) => b.score - a.score);

  const peaks: Peak[] = [];
  for (const hit of scored) {
    if (peaks.length >= PEAKS_PER_ICON) break;
    if (peaks.some((p) => overlaps(p, hit))) continue;
    const refined = refinePeak(shot, prepared, hit);
    if (refined.score < PEAK_FLOOR) continue;
    if (peaks.some((p) => overlaps(p, refined))) continue;
    peaks.push(refined);
  }
  return peaks;
}

function refinePeak(shot: RgbaImage, prepared: PreparedRef, peak: Peak): Peak {
  let refined = peak;
  const radius = Math.max(4, Math.floor(peak.size / 10));
  const step = 2;
  for (let dy = -radius; dy <= radius; dy += step) {
    for (let dx = -radius; dx <= radius; dx += step) {
      const nx = peak.x + dx;
      const ny = peak.y + dy;
      if (nx < 0 || ny < 0 || nx + peak.size > shot.width || ny + peak.size > shot.height) {
        continue;
      }
      const patch = cropRgba(shot, nx, ny, peak.size, peak.size);
      const feat = extractFeatures(resizeRgba(patch, FEAT_SIZE, FEAT_SIZE));
      const score = scoreFeatures(feat, prepared.features);
      if (score > refined.score) {
        refined = { ...peak, x: nx, y: ny, score };
      }
    }
  }
  return refined;
}

/**
 * Scan a Total Battle city-troops screenshot and fill only calculator units.
 */
export async function scanTroopScreenshot(
  file: Blob,
  options?: {
    guardsMaxTier?: number;
    guardsMinTier?: number;
    monstersMaxTier?: number;
    monstersMinTier?: number;
    onProgress?: (message: string) => void;
    /** Fired as soon as one unit tile is matched + OCR'd (before the full scan ends). */
    onHit?: (hit: ScanHit) => void;
  },
): Promise<ScanResult> {
  const t0 = performance.now();
  const progress = options?.onProgress ?? (() => undefined);
  const onHit = options?.onHit;

  progress('Wczytywanie screenshota…');
  const shotEl = await loadImageElement(file);
  const full = imageToRgba(shotEl);
  const maxW = 900;
  const scale = full.width > maxW ? maxW / full.width : 1;
  const workW = Math.round(full.width * scale);
  const workH = Math.round(full.height * scale);
  const shot = scale === 1 ? full : imageToRgba(shotEl, workW, workH);

  progress('Przygotowanie ikon z kalkulatora…');
  const refs = buildScannerRefs(
    options?.guardsMaxTier,
    options?.monstersMaxTier,
    options?.guardsMinTier,
    options?.monstersMinTier,
  );
  const prepared = await prepareRefs(refs);

  const peaks: Peak[] = [];
  let unmatchedTiles = 0;

  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    progress(`Szukam: ${p.ref.label} (${i + 1}/${prepared.length})…`);
    const found = findRefPeaks(shot, p);
    if (!found.length) unmatchedTiles++;
    else peaks.push(...found);
    await yieldToUi();
  }

  // Similar archers often claim the same card. Give each card and each icon once,
  // highest score first, so the next peak can take the tile that was left.
  peaks.sort((a, b) => b.score - a.score);
  const claimed: Peak[] = [];
  const used = new Set<ScanRef>();
  for (const peak of peaks) {
    if (peak.score < MIN_SCORE) continue;
    if (used.has(peak.ref)) continue;
    if (claimed.some((k) => overlaps(k, peak))) continue;
    used.add(peak.ref);
    claimed.push(peak);
  }

  const hits: ScanHit[] = [];
  for (const loc of claimed) {
    const fx = Math.round(loc.x / scale);
    const fy = Math.round(loc.y / scale);
    const fs = Math.max(8, Math.round(loc.size / scale));
    const x = Math.max(0, Math.min(fx, full.width - 1));
    const y = Math.max(0, Math.min(fy, full.height - 1));
    const size = Math.max(8, Math.min(fs, full.width - x, full.height - y));
    const patch = cropRgba(full, x, y, size, size);
    const ocr = await readTroopCount(patch);
    const hit: ScanHit = {
      ref: loc.ref,
      count: ocr.count,
      score: loc.score,
      ocrText: ocr.text,
      previewUrl: rgbaToDataUrl(patch),
      x,
      y,
      size,
    };
    hits.push(hit);
    onHit?.(hit);
    await yieldToUi();
  }

  progress('Gotowe.');
  return {
    hits,
    unmatchedTiles,
    durationMs: Math.round(performance.now() - t0),
  };
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

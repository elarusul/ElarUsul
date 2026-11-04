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
const MIN_SCORE = 0.68;

interface PreparedRef {
  ref: ScanRef;
  features: IconFeatures;
  /** Full-res reference for resizing to search sizes. */
  rgba: RgbaImage;
}

async function prepareRefs(refs: ScanRef[]): Promise<PreparedRef[]> {
  const out: PreparedRef[] = [];
  for (const ref of refs) {
    const img = await loadImageElement(ref.path);
    const rgba = imageToRgba(img);
    out.push({
      ref,
      rgba,
      features: extractFeatures(resizeRgba(rgba, FEAT_SIZE, FEAT_SIZE)),
    });
  }
  return out;
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

function findRefOnShot(
  shot: RgbaImage,
  prepared: PreparedRef,
): { x: number; y: number; size: number; score: number } | null {
  const { data, width: w, height: h } = shot;
  const base = Math.round(w / 5);
  const sizes = [
    Math.max(48, base - 8),
    base,
    Math.min(Math.floor(w / 4), base + 10),
  ];
  const refMean = prepared.features.mean;
  const yStart = Math.floor(h * 0.2);
  const candidates: Array<{ x: number; y: number; size: number }> = [];

  for (const size of sizes) {
    const step = Math.max(5, Math.floor(size / 4));
    for (let y = yStart; y <= h - size; y += step) {
      for (let x = 2; x <= w - size - 1; x += step) {
        if (colorDist(meanColor(data, w, h, x, y, size), refMean) > 70) {
          continue;
        }
        candidates.push({ x, y, size });
      }
    }
  }

  if (!candidates.length) return null;

  type Loc = { x: number; y: number; size: number; score: number };
  let best: Loc | null = null;
  for (const c of candidates) {
    const patch = cropRgba(shot, c.x, c.y, c.size, c.size);
    const feat = extractFeatures(resizeRgba(patch, FEAT_SIZE, FEAT_SIZE));
    const s = scoreFeatures(feat, prepared.features);
    if (!best || s > best.score) best = { ...c, score: s };
  }

  if (!best) return null;

  // Local refine around best
  let refined: Loc = best;
  const refineStep = 2;
  const radius = Math.max(6, Math.floor(refined.size / 8));
  for (let dy = -radius; dy <= radius; dy += refineStep) {
    for (let dx = -radius; dx <= radius; dx += refineStep) {
      const nx: number = refined.x + dx;
      const ny: number = refined.y + dy;
      if (nx < 0 || ny < 0 || nx + refined.size > w || ny + refined.size > h) {
        continue;
      }
      const patch = cropRgba(shot, nx, ny, refined.size, refined.size);
      const feat = extractFeatures(resizeRgba(patch, FEAT_SIZE, FEAT_SIZE));
      const s = scoreFeatures(feat, prepared.features);
      if (s > refined.score) {
        refined = { x: nx, y: ny, size: refined.size, score: s };
      }
    }
  }

  return refined.score >= MIN_SCORE ? refined : null;
}

/**
 * Scan a Total Battle city-troops screenshot and fill only calculator units.
 */
export async function scanTroopScreenshot(
  file: Blob,
  options?: {
    guardsMaxTier?: number;
    monstersMaxTier?: number;
    onProgress?: (message: string) => void;
  },
): Promise<ScanResult> {
  const t0 = performance.now();
  const progress = options?.onProgress ?? (() => undefined);

  progress('Wczytywanie screenshota…');
  const shotEl = await loadImageElement(file);
  const maxW = 900;
  const scale = shotEl.naturalWidth > maxW ? maxW / shotEl.naturalWidth : 1;
  const workW = Math.round(shotEl.naturalWidth * scale);
  const workH = Math.round(shotEl.naturalHeight * scale);
  const shot = imageToRgba(shotEl, workW, workH);

  progress('Przygotowanie ikon z kalkulatora…');
  const refs = buildScannerRefs(
    options?.guardsMaxTier,
    options?.monstersMaxTier,
  );
  const prepared = await prepareRefs(refs);

  const hits: ScanHit[] = [];
  let unmatchedTiles = 0;

  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    progress(`Szukam: ${p.ref.label} (${i + 1}/${prepared.length})…`);
    const loc = findRefOnShot(shot, p);
    if (!loc) {
      unmatchedTiles++;
      continue;
    }
    const patch = cropRgba(shot, loc.x, loc.y, loc.size, loc.size);
    const ocr = await readTroopCount(patch);
    hits.push({
      ref: p.ref,
      count: ocr.count,
      score: loc.score,
      ocrText: ocr.text,
      previewUrl: rgbaToDataUrl(patch),
      x: loc.x,
      y: loc.y,
      size: loc.size,
    });
  }

  // Same on-screen tile can match neighbouring tiers — keep highest score
  hits.sort((a, b) => b.score - a.score);
  const kept: ScanHit[] = [];
  for (const hit of hits) {
    const clash = kept.some((k) => {
      const dx = Math.abs(k.x - hit.x);
      const dy = Math.abs(k.y - hit.y);
      const lim = Math.min(k.size, hit.size) * 0.45;
      return dx < lim && dy < lim;
    });
    if (!clash) kept.push(hit);
  }

  progress('Gotowe.');
  return {
    hits: kept,
    unmatchedTiles,
    durationMs: Math.round(performance.now() - t0),
  };
}

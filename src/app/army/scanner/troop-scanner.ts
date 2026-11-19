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
import { guardsTierIcon } from '../troop-icons';
import type { ScanHit, ScanRef, ScanResult } from './scanner.types';

const FEAT_SIZE = 64;
/** Portrait must clearly be this guardsman, not a mercenary or captain. */
const MIN_SCORE = 0.7;
/** Best portrait has to win by a visible margin. */
const SCORE_MARGIN = 0.045;

type GuardKey = 'melee' | 'ranged' | 'mounted' | 'flying';

const GUARD_PORTRAITS: { key: GuardKey; label: string; iconTier: number; onlyTier?: number }[] = [
  { key: 'melee', label: 'Włócznicy', iconTier: 1 },
  { key: 'ranged', label: 'Łucznicy', iconTier: 1 },
  { key: 'mounted', label: 'Jeźdźcy', iconTier: 1 },
  { key: 'flying', label: 'Gryfy', iconTier: 5, onlyTier: 5 },
];

interface Portrait {
  key: GuardKey;
  label: string;
  iconTier: number;
  /** Gryfy exist only on the orange G5 backdrop. */
  onlyTier?: number;
  features: IconFeatures;
}

interface FoundTile {
  ref: ScanRef;
  x: number;
  y: number;
  size: number;
  score: number;
}

/**
 * Wiki icons wear a ribbon frame that is not on the in-game card.
 * Keep the inner portrait.
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

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

/**
 * Tier is the card backdrop, not the face.
 * 1 gray-white, 2 green, 3 blue, 4 purple, 5 orange.
 * Anything else is not a guardsman tier.
 */
function tierFromRgb(r: number, g: number, b: number): number | null {
  const [h, s, l] = rgbToHsl(r, g, b);
  if (s < 0.22 && l > 0.45) return 1;
  if (s < 0.2) return null;
  if (h >= 55 && h <= 155) return 2;
  if (h >= 165 && h <= 235) return 3;
  if (h >= 250 && h <= 325) return 4;
  if ((h <= 48 || h >= 350) && l >= 0.28) return 5;
  return null;
}

function pixel(img: RgbaImage, fx: number, fy: number): [number, number, number] {
  const x = Math.min(img.width - 1, Math.max(0, Math.floor(img.width * fx)));
  const y = Math.min(img.height - 1, Math.max(0, Math.floor(img.height * fy)));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue;
      const p = (yy * img.width + xx) * 4;
      r += img.data[p];
      g += img.data[p + 1];
      b += img.data[p + 2];
      n++;
    }
  }
  return [r / n, g / n, b / n];
}

/** Backdrop beside the head. Null when the color is not a guardsman tier. */
function sampleBackdrop(
  img: RgbaImage,
): { tier: number; rgb: [number, number, number] } | null {
  const spots: Array<[number, number]> = [
    [0.18, 0.16],
    [0.28, 0.2],
    [0.72, 0.16],
    [0.82, 0.22],
    [0.5, 0.12],
  ];
  const votes = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const [fx, fy] of spots) {
    const [r, g, b] = pixel(img, fx, fy);
    const tier = tierFromRgb(r, g, b);
    if (tier == null) continue;
    const prev = votes.get(tier) ?? { n: 0, r: 0, g: 0, b: 0 };
    prev.n += 1;
    prev.r += r;
    prev.g += g;
    prev.b += b;
    votes.set(tier, prev);
  }
  let bestTier = 0;
  let best = { n: 0, r: 0, g: 0, b: 0 };
  let second = 0;
  for (const [tier, vote] of votes) {
    if (vote.n > best.n) {
      second = best.n;
      best = vote;
      bestTier = tier;
    } else if (vote.n > second) {
      second = vote.n;
    }
  }
  if (best.n < 3 || best.n <= second) return null;
  return {
    tier: bestTier,
    rgb: [best.r / best.n, best.g / best.n, best.b / best.n],
  };
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

/** G1 art sits on a pale backdrop. Remove it so only the person is compared. */
function knockOutPaleBackdrop(img: RgbaImage): RgbaImage {
  const data = new Uint8ClampedArray(img.data.length) as Uint8ClampedArray<ArrayBuffer>;
  data.set(img.data);
  for (let i = 0; i < img.width * img.height; i++) {
    const p = i * 4;
    const [, s, l] = rgbToHsl(data[p], data[p + 1], data[p + 2]);
    if (s < 0.24 && l > 0.48) data[p + 3] = 0;
  }
  return { data, width: img.width, height: img.height };
}

/** Griffin art is painted on an orange sky. Remove that sky from the template. */
function knockOutOrangeBackdrop(img: RgbaImage): RgbaImage {
  const data = new Uint8ClampedArray(img.data.length) as Uint8ClampedArray<ArrayBuffer>;
  data.set(img.data);
  for (let i = 0; i < img.width * img.height; i++) {
    const p = i * 4;
    if (tierFromRgb(data[p], data[p + 1], data[p + 2]) === 5) data[p + 3] = 0;
  }
  return { data, width: img.width, height: img.height };
}

/** Drop the flat backdrop so the same portrait matches on every tier color. */
function knockOutBackdrop(img: RgbaImage, bg: [number, number, number]): RgbaImage {
  const [, s] = rgbToHsl(bg[0], bg[1], bg[2]);
  const tol = s < 0.25 ? 46 : 70;
  const data = new Uint8ClampedArray(img.data.length) as Uint8ClampedArray<ArrayBuffer>;
  data.set(img.data);
  for (let i = 0; i < img.width * img.height; i++) {
    const p = i * 4;
    const dist = colorDist([data[p], data[p + 1], data[p + 2]], bg);
    if (dist < tol) data[p + 3] = 0;
  }
  return { data, width: img.width, height: img.height };
}

async function preparePortraits(): Promise<Portrait[]> {
  const out: Portrait[] = [];
  for (const portrait of GUARD_PORTRAITS) {
    const img = await loadImageElement(guardsTierIcon(portrait.key, portrait.iconTier));
    const inner = innerPortrait(imageToRgba(img));
    const cut = portrait.onlyTier === 5 ? knockOutOrangeBackdrop(inner) : knockOutPaleBackdrop(inner);
    out.push({
      key: portrait.key,
      label: portrait.label,
      iconTier: portrait.iconTier,
      onlyTier: portrait.onlyTier,
      features: extractFeatures(resizeRgba(cut, FEAT_SIZE, FEAT_SIZE)),
    });
  }
  return out;
}

function tileSizes(width: number): number[] {
  const min = Math.max(44, Math.round(width / 7.4));
  const max = Math.max(min + 4, Math.min(Math.round(width / 3.5), Math.floor(width * 0.46)));
  const sizes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const size = Math.round(min + ((max - min) * i) / 4);
    if (!sizes.includes(size)) sizes.push(size);
  }
  return sizes;
}

function overlaps(
  a: { x: number; y: number; size: number },
  b: { x: number; y: number; size: number },
): boolean {
  const lim = Math.min(a.size, b.size) * 0.45;
  return Math.abs(a.x - b.x) < lim && Math.abs(a.y - b.y) < lim;
}

function findGuardTiles(
  shot: RgbaImage,
  portraits: Portrait[],
  minTier: number,
  maxTier: number,
): FoundTile[] {
  const { width: w, height: h } = shot;
  const yStart = Math.floor(h * 0.12);
  const found: FoundTile[] = [];

  for (const size of tileSizes(w)) {
    const step = Math.max(4, Math.floor(size / 5));
    const inset = Math.round(size * 0.1);
    const innerSize = size - inset * 2;
    if (innerSize < 28) continue;
    for (let y = yStart; y <= h - size; y += step) {
      for (let x = 2; x <= w - size - 1; x += step) {
        const card = cropRgba(shot, x + inset, y + inset, innerSize, innerSize);
        const backdrop = sampleBackdrop(card);
        if (!backdrop) continue;
        if (backdrop.tier < minTier || backdrop.tier > maxTier) continue;
        const cut = knockOutBackdrop(card, backdrop.rgb);
        const feat = extractFeatures(resizeRgba(cut, FEAT_SIZE, FEAT_SIZE));
        let best: Portrait | null = null;
        let bestScore = -1;
        let second = -1;
        for (const portrait of portraits) {
          if (portrait.onlyTier != null && backdrop.tier !== portrait.onlyTier) continue;
          const score = scoreFeatures(feat, portrait.features);
          if (score > bestScore) {
            second = bestScore;
            bestScore = score;
            best = portrait;
          } else if (score > second) {
            second = score;
          }
        }
        if (!best || bestScore < MIN_SCORE) continue;
        if (bestScore - second < SCORE_MARGIN) continue;
        found.push({
          ref: {
            kind: 'guards',
            tier: backdrop.tier,
            key: best.key,
            path: guardsTierIcon(best.key, best.iconTier),
            label: `G${backdrop.tier} ${best.label}`,
          },
          x,
          y,
          size,
          score: bestScore,
        });
      }
    }
  }

  found.sort((a, b) => b.score - a.score);
  const kept: FoundTile[] = [];
  for (const tile of found) {
    if (kept.some((k) => overlaps(k, tile))) continue;
    kept.push(tile);
  }
  return kept;
}

/**
 * Scan a city-troops screenshot for guardsmen only.
 * Four portraits: spearman, archer, rider, and the G5 griffin.
 * Tier comes from the backdrop: gray-white, green, blue, purple, orange.
 * Gryfy are accepted only on the orange G5 backdrop. Other cards are ignored.
 */
export async function scanTroopScreenshot(
  file: Blob,
  options?: {
    guardsMaxTier?: number;
    guardsMinTier?: number;
    monstersMaxTier?: number;
    monstersMinTier?: number;
    onProgress?: (message: string) => void;
    onHit?: (hit: ScanHit) => void;
  },
): Promise<ScanResult> {
  const t0 = performance.now();
  const progress = options?.onProgress ?? (() => undefined);
  const onHit = options?.onHit;
  const minTier = Math.max(1, Math.min(5, options?.guardsMinTier ?? 1));
  const maxTier = Math.max(minTier, Math.min(5, options?.guardsMaxTier ?? 5));

  progress('Wczytywanie screenshota…');
  const shotEl = await loadImageElement(file);
  const full = imageToRgba(shotEl);
  const maxW = 900;
  const scale = full.width > maxW ? maxW / full.width : 1;
  const workW = Math.round(full.width * scale);
  const workH = Math.round(full.height * scale);
  const shot = scale === 1 ? full : imageToRgba(shotEl, workW, workH);

  progress('Przygotowanie portretów gwardii…');
  const portraits = await preparePortraits();
  progress('Szukam włóczników, łuczników, jeźdźców i gryfów…');
  const tiles = findGuardTiles(shot, portraits, minTier, maxTier);
  const foundKeys = new Set(tiles.map((tile) => tile.ref.key));

  const hits: ScanHit[] = [];
  for (const loc of tiles) {
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
    unmatchedTiles: GUARD_PORTRAITS.length - foundKeys.size,
    durationMs: Math.round(performance.now() - t0),
  };
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

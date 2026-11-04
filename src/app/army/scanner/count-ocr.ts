import { createWorker, PSM, type Worker } from 'tesseract.js';
import {
  cropRgba,
  type RgbaImage,
  rgbaToPngBlob,
  resizeRgba,
} from './image-utils';

let sharedWorker: Worker | null = null;
let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (sharedWorker) return sharedWorker;
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng');
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789.,',
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
      });
      sharedWorker = worker;
      return worker;
    })();
  }
  return workerPromise;
}

export async function terminateOcrWorker(): Promise<void> {
  if (sharedWorker) {
    await sharedWorker.terminate();
    sharedWorker = null;
    workerPromise = null;
  }
}

interface ParsedCandidate {
  value: number;
  raw: string;
  quality: number;
}

function qualityFor(raw: string, value: number): number {
  const compact = raw.replace(/\s/g, '');
  let q = 0;
  if (/^[12]([.,]\d{3})+$/.test(compact)) q += 110;
  else if (/^[3-9][.,]\d{3}$/.test(compact)) q += 35;
  else if (/^\d{1,3}([.,]\d{3})+$/.test(compact)) q += 100;
  else if (/^\d{1,4}$/.test(compact) && value < 10000) q += 70;
  else if (String(value).length >= 5) q -= 40;
  else q += 20;

  if (value > 200_000) q -= 50;
  if (value >= 10 && value <= 50_000) q += 10;
  if (/^\d{3}$/.test(compact)) q += 15;
  // Round hundreds like 100 often come from misread 967 / 1080
  if (/^[1-9]00$/.test(compact)) q -= 25;
  return q;
}

/**
 * Expand OCR text into plausible troop counts (handles phantom frame digits).
 */
export function parseTroopCountCandidates(text: string): ParsedCandidate[] {
  const found = new Map<number, ParsedCandidate>();
  const push = (raw: string, value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const quality = qualityFor(raw, value);
    const prev = found.get(value);
    if (!prev || quality > prev.quality) {
      found.set(value, { value, raw, quality });
    }
  };

  const addFromToken = (token: string) => {
    let cleaned = token.replace(/[^\d.,]/g, '');
    cleaned = cleaned.replace(/^\.+|\.+$/g, '');
    if (!cleaned) return;

    if (/^\d{1,3}([.,]\d{3})+$/.test(cleaned)) {
      push(cleaned, Number(cleaned.replace(/[.,]/g, '')));
    } else if (/^\d{1,7}$/.test(cleaned)) {
      push(cleaned, Number(cleaned));
    } else {
      const n = Number(cleaned.replace(/[.,]/g, ''));
      if (Number.isFinite(n) && n > 0) push(cleaned, n);
    }

    const digits = cleaned.replace(/[.,]/g, '');
    for (let strip = 1; strip <= 2 && strip < digits.length; strip++) {
      const restDigits = digits.slice(strip);
      if (!restDigits || /^0+$/.test(restDigits)) continue;

      if (restDigits.length === 4) {
        push(`${restDigits[0]}.${restDigits.slice(1)}`, Number(restDigits));
      } else if (restDigits.length <= 4) {
        push(restDigits, Number(restDigits));
      } else if (restDigits.length === 5 || restDigits.length === 6) {
        const head = restDigits.length - 3;
        push(
          `${restDigits.slice(0, head)}.${restDigits.slice(head)}`,
          Number(restDigits),
        );
      }

      const sepMatch = cleaned.match(/^(\d{1,2})[.,](.+)$/);
      if (!sepMatch) continue;
      const after = sepMatch[2].replace(/[.,]/g, '');
      if (/^\d{3}$/.test(after)) push(after, Number(after));
      if (sepMatch[1].length === 2) {
        const rest = `${sepMatch[1][1]}.${sepMatch[2]}`;
        if (/^\d[.,]\d{3}$/.test(rest)) {
          push(rest, Number(rest.replace(/[.,]/g, '')));
        }
      }
    }
  };

  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      for (const part of parts) addFromToken(part);
    } else {
      addFromToken(trimmed);
    }
  }

  return [...found.values()];
}

export function parseTroopCount(text: string): number | null {
  const cands = parseTroopCountCandidates(text);
  if (!cands.length) return null;
  cands.sort((a, b) => b.quality - a.quality);
  return cands[0].value;
}

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bottom-right count areas (fractions of the tile). */
const REGIONS: Region[] = [
  { x: 0.3, y: 0.68, w: 0.62, h: 0.26 },
  { x: 0.34, y: 0.72, w: 0.58, h: 0.22 },
  { x: 0.38, y: 0.52, w: 0.55, h: 0.28 },
];

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function chroma(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/**
 * Isolate white digit fill with black outline on a darker count bar.
 * Returns binary mask (1 = digit ink).
 */
function digitStrokeMask(img: RgbaImage): Uint8Array {
  const { data, width: w, height: h } = img;
  const L = new Float32Array(w * h);
  const S = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    L[i] = luma(data[p], data[p + 1], data[p + 2]);
    S[i] = chroma(data[p], data[p + 1], data[p + 2]);
  }

  const local = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          sum += L[yy * w + xx];
          n++;
        }
      }
      local[y * w + x] = sum / n;
    }
  }

  const seed = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const bright = L[i] >= 170 && S[i] <= 50;
      const midBright = L[i] >= 150 && S[i] <= 40 && L[i] > local[i] + 35;
      if (!bright && !midBright) continue;

      let darkN = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const j = (y + dy) * w + (x + dx);
          if (L[j] < 85) darkN++;
        }
      }
      if (local[i] < 140 || darkN >= 1) seed[i] = 1;
    }
  }

  // Light dilate — close gaps in 8 / 0 / 6 without eating armor highlights
  const mask = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!seed[i]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = (y + dy) * w + (x + dx);
          if (L[j] >= 130 && S[j] <= 65) mask[j] = 1;
        }
      }
    }
  }
  return mask;
}

/** Black digits on white canvas — Tesseract-friendly. */
function maskToOcrBlob(mask: Uint8Array, w: number, h: number): Promise<Blob | null> {
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (count < 8 || maxX < minX) return Promise.resolve(null);

  // Extra left pad — leading digit is often clipped
  const padX = Math.max(3, Math.floor((maxX - minX + 1) * 0.1));
  const padY = 2;
  minX = Math.max(0, minX - padX);
  minY = Math.max(0, minY - padY);
  maxX = Math.min(w - 1, maxX + padY);
  maxY = Math.min(h - 1, maxY + padY);

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const border = 12;
  const bw = cw + border * 2;
  const bh = ch + border * 2;
  const canvas = new Uint8ClampedArray(
    bw * bh * 4,
  ) as Uint8ClampedArray<ArrayBuffer>;
  for (let i = 0; i < bw * bh; i++) {
    const p = i * 4;
    canvas[p] = 255;
    canvas[p + 1] = 255;
    canvas[p + 2] = 255;
    canvas[p + 3] = 255;
  }
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const on = mask[(minY + y) * w + (minX + x)];
      const di = ((y + border) * bw + (x + border)) * 4;
      const v = on ? 0 : 255;
      canvas[di] = v;
      canvas[di + 1] = v;
      canvas[di + 2] = v;
    }
  }

  const scale = 14;
  const up = resizeRgba(
    { data: canvas, width: bw, height: bh },
    bw * scale,
    bh * scale,
  );
  return rgbaToPngBlob(up);
}

function grayscaleNormalizePng(img: RgbaImage): Promise<Blob> {
  const { data, width, height } = img;
  let min = 255;
  let max = 0;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const L = luma(data[p], data[p + 1], data[p + 2]);
    gray[i] = L;
    if (L < min) min = L;
    if (L > max) max = L;
  }
  const range = Math.max(1, max - min);
  const rgba = new Uint8ClampedArray(
    width * height * 4,
  ) as Uint8ClampedArray<ArrayBuffer>;
  for (let i = 0; i < gray.length; i++) {
    const v = Math.round(((gray[i] - min) / range) * 255);
    const p = i * 4;
    rgba[p] = v;
    rgba[p + 1] = v;
    rgba[p + 2] = v;
    rgba[p + 3] = 255;
  }
  const up = resizeRgba({ data: rgba, width, height }, width * 10, height * 10);
  return rgbaToPngBlob(up);
}

export interface OcrOutcome {
  count: number | null;
  text: string;
}

/**
 * Read troop count: white digits + black outline on dark bar (bottom-right).
 */
export async function readTroopCount(tile: RgbaImage): Promise<OcrOutcome> {
  const worker = await getWorker();
  const votes = new Map<
    number,
    { quality: number; hits: number; raw: string }
  >();
  let anyRaw = '';

  const consider = (raw: string) => {
    if (raw) anyRaw = anyRaw || raw;
    for (const c of parseTroopCountCandidates(raw)) {
      const prev = votes.get(c.value);
      if (!prev) {
        votes.set(c.value, { quality: c.quality, hits: 1, raw: c.raw });
      } else {
        prev.hits += 1;
        if (c.quality > prev.quality) {
          prev.quality = c.quality;
          prev.raw = c.raw;
        }
      }
    }
  };

  for (const region of REGIONS) {
    const left = Math.floor(tile.width * region.x);
    const top = Math.floor(tile.height * region.y);
    const width = Math.max(8, Math.floor(tile.width * region.w));
    const height = Math.max(8, Math.floor(tile.height * region.h));
    if (left + width > tile.width || top + height > tile.height) continue;

    const strip = cropRgba(tile, left, top, width, height);

    // Primary: stroke-aware white fill + black outline → black-on-white
    const mask = digitStrokeMask(strip);
    const strokeBlob = await maskToOcrBlob(mask, strip.width, strip.height);
    if (strokeBlob) {
      const {
        data: { text },
      } = await worker.recognize(strokeBlob);
      consider(text.trim());
    }

    // Fallback: normalized grayscale of the same strip
    const grayBlob = await grayscaleNormalizePng(strip);
    const {
      data: { text: grayText },
    } = await worker.recognize(grayBlob);
    consider(grayText.trim());
  }

  if (!votes.size) return { count: null, text: anyRaw };

  // Quality dominates; light consensus bonus (don't let "100" outvote "967")
  const ranked = [...votes.entries()]
    .map(([value, meta]) => ({
      value,
      raw: meta.raw,
      score: meta.quality * 3 + meta.hits,
    }))
    .sort((a, b) => b.score - a.score);

  let best = ranked[0];
  // Prefer a non-round reading over "100"/"200" noise when both appeared
  if (/^[1-9]00$/.test(String(best.value))) {
    const alt = ranked.find(
      (r) => r.value !== best.value && r.value >= 10 && r.value <= 9999,
    );
    if (alt && alt.score >= best.score - 40) best = alt;
  }

  return { count: best.value, text: best.raw || anyRaw };
}

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

/** Game counts use European thousands: 1.234 / 12.345 / 111.111 */
const THOUSANDS_RE = /^\d{1,3}([.,]\d{3})+$/;

function qualityFor(raw: string, value: number): number {
  const compact = raw.replace(/\s/g, '');
  let q = 0;

  if (THOUSANDS_RE.test(compact)) q += 120;
  else if (/^\d{1,4}$/.test(compact) && value < 10000) q += 80;
  else if (/^\d{5,6}$/.test(compact)) q += 55;
  else q += 15;

  if (value > 500_000) q -= 80;
  else if (value > 250_000) q -= 40;
  if (value >= 1 && value <= 200_000) q += 8;
  // Round hundreds often OCR noise for 0/8 confusion
  if (/^[1-9]00$/.test(compact)) q -= 40;
  return q;
}

/**
 * Parse OCR text as-is. No phantom digits, no inventing longer numbers.
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
    cleaned = cleaned.replace(/^[.,]+|[.,]+$/g, '');
    if (!cleaned) return;

    if (THOUSANDS_RE.test(cleaned)) {
      push(cleaned, Number(cleaned.replace(/[.,]/g, '')));
      return;
    }

    // Allow a single thousands group glued without separator only when length is exact
    const digits = cleaned.replace(/[.,]/g, '');
    if (!digits || /^0+$/.test(digits)) return;
    if (!/^\d{1,6}$/.test(digits)) return;
    push(digits, Number(digits));
  };

  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Prefer the longest digit-bearing token on the line (usually the count)
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      let best = parts[0];
      for (const part of parts) {
        const d = part.replace(/[^\d]/g, '');
        if (d.length > best.replace(/[^\d]/g, '').length) best = part;
      }
      addFromToken(best);
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

/** Bottom-right count bar — keep left edge wide enough for leading digits. */
const REGIONS: Region[] = [
  { x: 0.24, y: 0.7, w: 0.7, h: 0.24 },
  { x: 0.28, y: 0.74, w: 0.66, h: 0.2 },
];

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function chroma(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/**
 * White digit fill on darker count bar (black outline nearby).
 * No heavy dilate — that closes the hole in "0" and turns it into "8".
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
        for (let dx = -4; dx <= 4; dx++) {
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
      // Strict white / near-white fill only
      const bright = L[i] >= 185 && S[i] <= 45;
      const midBright = L[i] >= 165 && S[i] <= 35 && L[i] > local[i] + 45;
      if (!bright && !midBright) continue;

      let darkN = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const j = (y + dy) * w + (x + dx);
          if (L[j] < 80) darkN++;
        }
      }
      // Must sit on dark bar or touch black outline
      if (local[i] < 125 || darkN >= 1) seed[i] = 1;
    }
  }

  // Tiny 4-connected close — reconnect thin strokes without filling 0-holes
  const mask = new Uint8Array(seed);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (seed[i]) continue;
      if (L[i] < 160 || S[i] > 50) continue;
      const n =
        seed[i - 1] +
        seed[i + 1] +
        seed[i - w] +
        seed[i + w];
      if (n >= 2 && (local[i] < 130 || L[i] > local[i] + 40)) mask[i] = 1;
    }
  }

  return cropToDigitBand(mask, w, h);
}

/** Keep the densest horizontal band (digit row); drop armor noise above. */
function cropToDigitBand(mask: Uint8Array, w: number, h: number): Uint8Array {
  const rowCounts = new Int32Array(h);
  let total = 0;
  for (let y = 0; y < h; y++) {
    let c = 0;
    for (let x = 0; x < w; x++) if (mask[y * w + x]) c++;
    rowCounts[y] = c;
    total += c;
  }
  if (total < 8) return mask;

  let bestY = 0;
  let bestSum = -1;
  const win = Math.max(3, Math.floor(h * 0.35));
  for (let y = 0; y + win <= h; y++) {
    let s = 0;
    for (let k = 0; k < win; k++) s += rowCounts[y + k];
    if (s > bestSum) {
      bestSum = s;
      bestY = y;
    }
  }

  const out = new Uint8Array(w * h);
  const y0 = Math.max(0, bestY - 1);
  const y1 = Math.min(h, bestY + win + 1);
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i]) out[i] = 1;
    }
  }
  return out;
}

/** Count digit-like blobs (excludes the thousands '.'). */
function estimateDigitBlobs(mask: Uint8Array, w: number, h: number): number {
  const seen = new Uint8Array(w * h);
  let blobs = 0;
  const qx: number[] = [];
  const qy: number[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (!mask[start] || seen[start]) continue;
      qx.length = 0;
      qy.length = 0;
      qx.push(x);
      qy.push(y);
      seen[start] = 1;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;
      while (qx.length) {
        const cx = qx.pop()!;
        const cy = qy.pop()!;
        area++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (!mask[ni] || seen[ni]) continue;
            seen[ni] = 1;
            qx.push(nx);
            qy.push(ny);
          }
        }
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      // Skip dust and the thousands separator (small square)
      if (area < 6) continue;
      if (bh < Math.max(4, Math.floor(h * 0.25)) && bw <= bh) continue;
      if (bh >= 3 && bw >= 1) blobs++;
    }
  }
  return blobs;
}

/**
 * Black digits on white canvas. Interior holes stay white so "0" ≠ "8".
 */
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

  const padX = Math.max(4, Math.floor((maxX - minX + 1) * 0.12));
  const padY = 2;
  minX = Math.max(0, minX - padX);
  minY = Math.max(0, minY - padY);
  maxX = Math.min(w - 1, maxX + padX);
  maxY = Math.min(h - 1, maxY + padY);

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const border = 10;
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

  // Nearest-neighbor upscale — bilinear fills the hole in "0" → misread as "8"
  const scale = 12;
  const up = resizeRgba(
    { data: canvas, width: bw, height: bh },
    bw * scale,
    bh * scale,
    false,
  );
  return rgbaToPngBlob(up);
}

/** High-contrast white-on-dark → black-on-white without filling holes. */
function whiteOnDarkToOcrBlob(img: RgbaImage): Promise<Blob> {
  const { data, width, height } = img;
  const rgba = new Uint8ClampedArray(
    width * height * 4,
  ) as Uint8ClampedArray<ArrayBuffer>;

  // Threshold: bright low-chroma → ink (black), else paper (white)
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const L = luma(r, g, b);
    const S = chroma(r, g, b);
    const ink = L >= 175 && S <= 55 ? 0 : 255;
    rgba[p] = ink;
    rgba[p + 1] = ink;
    rgba[p + 2] = ink;
    rgba[p + 3] = 255;
  }

  const up = resizeRgba(
    { data: rgba, width, height },
    width * 10,
    height * 10,
    false,
  );
  return rgbaToPngBlob(up);
}

export interface OcrOutcome {
  count: number | null;
  text: string;
}

interface Vote {
  quality: number;
  hits: number;
  raw: string;
  fromStroke: number;
  digitLen: number;
}

/**
 * Read troop count: white digits + black outline on dark bar (bottom-right).
 */
export async function readTroopCount(tile: RgbaImage): Promise<OcrOutcome> {
  const worker = await getWorker();
  const votes = new Map<number, Vote>();
  let anyRaw = '';
  let blobHint = 0;

  const consider = (raw: string, fromStroke: boolean, blobCount: number) => {
    if (raw) anyRaw = anyRaw || raw;
    for (const c of parseTroopCountCandidates(raw)) {
      const digitLen = String(c.value).length;
      // Reject readings that invent many more digits than ink blobs suggest
      if (blobCount >= 2 && digitLen > blobCount + 1) continue;
      if (blobCount >= 3 && digitLen >= blobCount + 2) continue;

      let q = c.quality;
      if (fromStroke) q += 25;
      // Soft preference when digit length matches blob estimate
      if (blobCount >= 2 && Math.abs(digitLen - blobCount) <= 1) q += 20;
      if (blobCount >= 2 && digitLen === blobCount) q += 15;

      const prev = votes.get(c.value);
      if (!prev) {
        votes.set(c.value, {
          quality: q,
          hits: 1,
          raw: c.raw,
          fromStroke: fromStroke ? 1 : 0,
          digitLen,
        });
      } else {
        prev.hits += 1;
        prev.fromStroke += fromStroke ? 1 : 0;
        if (q > prev.quality) {
          prev.quality = q;
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
    const mask = digitStrokeMask(strip);
    const blobs = estimateDigitBlobs(mask, strip.width, strip.height);
    if (blobs > blobHint) blobHint = blobs;

    const strokeBlob = await maskToOcrBlob(mask, strip.width, strip.height);
    if (strokeBlob) {
      const {
        data: { text },
      } = await worker.recognize(strokeBlob);
      consider(text.trim(), true, blobs);
    }

    // Secondary: direct white-on-dark threshold (no morphology) — only if stroke weak
    const directBlob = await whiteOnDarkToOcrBlob(strip);
    const {
      data: { text: directText },
    } = await worker.recognize(directBlob);
    consider(directText.trim(), false, blobs);
  }

  if (!votes.size) return { count: null, text: anyRaw };

  const ranked = [...votes.entries()]
    .map(([value, meta]) => ({
      value,
      raw: meta.raw,
      score:
        meta.quality * 3 +
        meta.hits * 2 +
        meta.fromStroke * 8 -
        // Mild penalty for very long readings when blobs say otherwise
        (blobHint >= 2 && meta.digitLen > blobHint + 1 ? 50 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  let best = ranked[0];
  if (/^[1-9]00$/.test(String(best.value))) {
    const alt = ranked.find(
      (r) => r.value !== best.value && r.value >= 10 && r.value <= 99999,
    );
    if (alt && alt.score >= best.score - 30) best = alt;
  }

  return { count: best.value, text: best.raw || anyRaw };
}

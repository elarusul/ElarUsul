import { createWorker, PSM, type Worker } from 'tesseract.js';
import { cropRgba, type RgbaImage, rgbaToPngBlob, resizeRgba } from './image-utils';

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
  /** Higher = more trustworthy. */
  quality: number;
}

function qualityFor(raw: string, value: number): number {
  const compact = raw.replace(/\s/g, '');
  let q = 0;
  // Best: 1.xxx / 2.xxx thousands (common in city screenshots)
  if (/^[12]([.,]\d{3})+$/.test(compact)) q += 110;
  // 3-9.xxx is often a gold-frame phantom digit + real 3-digit count
  else if (/^[3-9][.,]\d{3}$/.test(compact)) q += 35;
  else if (/^\d{1,3}([.,]\d{3})+$/.test(compact)) q += 100;
  // Small plain counts (15, 63, 84, 189, 216, 254, 967)
  else if (/^\d{1,4}$/.test(compact) && value < 10000) q += 70;
  // 5+ digits without separator are usually phantom-prefix garbage
  else if (String(value).length >= 5) q -= 40;
  else q += 20;

  // Penalize very large army stacks (screenshot noise)
  if (value > 200_000) q -= 50;
  // Prefer values that look like in-game stacks
  if (value >= 10 && value <= 50_000) q += 10;
  // Boost clean 3-digit leftovers from "4.216" → 216
  if (/^\d{3}$/.test(compact)) q += 15;
  return q;
}

/**
 * Expand one OCR string into plausible troop counts.
 * Handles phantom leading digits from gold frame / ribbon (e.g. "4.216" → 216, "92.156" → 2156).
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

    // Strip 1–2 leading digits: frame noise often prefixes "4" / "9" / "92"
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
      // "4.216" → 216 (phantom tier/frame digit)
      if (/^\d{3}$/.test(after)) push(after, Number(after));
      // "92.156" → "2.156"
      if (sepMatch[1].length === 2) {
        const rest = `${sepMatch[1][1]}.${sepMatch[2]}`;
        if (/^\d[.,]\d{3}$/.test(rest)) {
          push(rest, Number(rest.replace(/[.,]/g, '')));
        }
      }
    }
  };

  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // "4 63" — do NOT glue across spaces (that creates phantom 463)
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      for (const part of parts) addFromToken(part);
    } else {
      addFromToken(trimmed);
    }
  }

  return [...found.values()];
}

/** Back-compat single parse — picks best candidate. */
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

/**
 * Count sits bottom-right inside the gold frame.
 * Keep ROI right-biased to avoid left frame / roman-numeral noise.
 */
const REGIONS: Region[] = [
  { x: 0.38, y: 0.72, w: 0.52, h: 0.2 },
  { x: 0.42, y: 0.74, w: 0.48, h: 0.18 },
  { x: 0.45, y: 0.55, w: 0.45, h: 0.22 }, // monsters: digits sit a bit higher
  { x: 0.4, y: 0.58, w: 0.5, h: 0.22 },
];

function grayscaleNormalizePng(img: RgbaImage): Promise<Blob> {
  const { data, width, height } = img;
  let min = 255;
  let max = 0;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const L = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
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

function binaryWhitePng(img: RgbaImage, thr: number): Promise<Blob> {
  const { data, width, height } = img;
  const rgba = new Uint8ClampedArray(
    width * height * 4,
  ) as Uint8ClampedArray<ArrayBuffer>;
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    // Strict low-sat white → digits; colored ribbon/glow stays black
    const on = L >= thr && sat <= 45 ? 255 : 0;
    rgba[p] = on;
    rgba[p + 1] = on;
    rgba[p + 2] = on;
    rgba[p + 3] = 255;
  }
  const pad = 8;
  const bw = width + pad * 2;
  const bh = height + pad * 2;
  const padded = new Uint8ClampedArray(
    bw * bh * 4,
  ) as Uint8ClampedArray<ArrayBuffer>;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = ((y + pad) * bw + (x + pad)) * 4;
      padded[di] = rgba[si];
      padded[di + 1] = rgba[si + 1];
      padded[di + 2] = rgba[si + 2];
      padded[di + 3] = 255;
    }
  }
  const up = resizeRgba(
    { data: padded, width: bw, height: bh },
    bw * 10,
    bh * 10,
  );
  return rgbaToPngBlob(up);
}

export interface OcrOutcome {
  count: number | null;
  text: string;
}

/**
 * Read troop count from bottom-right of a tile.
 * Collects votes across ROIs/preprocessings and picks the most trustworthy parse.
 */
export async function readTroopCount(tile: RgbaImage): Promise<OcrOutcome> {
  const worker = await getWorker();
  const votes = new Map<number, { quality: number; hits: number; raw: string }>();
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
    const blobs: Blob[] = [
      await grayscaleNormalizePng(strip),
      await binaryWhitePng(strip, 155),
      await binaryWhitePng(strip, 175),
      await binaryWhitePng(strip, 195),
    ];

    for (const blob of blobs) {
      const {
        data: { text },
      } = await worker.recognize(blob);
      consider(text.trim());
    }
  }

  if (!votes.size) return { count: null, text: anyRaw };

  // Score = base quality + consensus bonus
  let bestValue: number | null = null;
  let bestScore = -Infinity;
  let bestRaw = anyRaw;
  for (const [value, meta] of votes) {
    const score = meta.quality + meta.hits * 15;
    if (score > bestScore) {
      bestScore = score;
      bestValue = value;
      bestRaw = meta.raw;
    }
  }

  return { count: bestValue, text: bestRaw || anyRaw };
}

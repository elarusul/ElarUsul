import { createWorker, PSM, type Worker } from 'tesseract.js';
import {
  DIGIT_TEMPLATES,
  DIGIT_TH,
  DIGIT_TW,
} from './digit-templates';
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

function qualityFor(raw: string, value: number, exactForm: boolean): number {
  const compact = raw.replace(/\s/g, '');
  const digits = String(value);
  let q = 0;

  if (exactForm && /^\d{1,3}([.,]\d{3})+$/.test(compact)) q += 220;
  else if (exactForm && /^[1-9]\d{2,3}$/.test(compact)) q += 170;
  else if (exactForm && /^[1-9]\d$/.test(compact)) q += 100;
  else if (exactForm && /^[1-9]$/.test(compact)) q += 20;
  else if (/^[12]([.,]\d{3})+$/.test(compact)) q += 90;
  else if (/^\d{1,3}([.,]\d{3})+$/.test(compact)) q += 80;
  else if (/^\d{1,4}$/.test(compact) && value < 10000) q += 50;
  else if (digits.length >= 5) q -= 40;
  else q += 15;

  if (value > 200_000) q -= 50;
  if (value >= 10 && value <= 50_000) q += 10;
  if (/^[1-9]00$/.test(compact)) q -= 30;
  if (digits.length >= 3) q += 15;
  if (digits.length === 1) q -= 40;
  return q;
}

/**
 * Parse troop counts. Well-formed OCR (e.g. "2.107", "967") wins over
 * stripped "phantom leading digit" alternatives.
 */
export function parseTroopCountCandidates(text: string): ParsedCandidate[] {
  const found = new Map<number, ParsedCandidate>();
  const push = (raw: string, value: number, exactForm: boolean) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const quality = qualityFor(raw, value, exactForm);
    const prev = found.get(value);
    if (!prev || quality > prev.quality) {
      found.set(value, { value, raw, quality });
    }
  };

  const addFromToken = (token: string) => {
    let cleaned = token.replace(/[^\d.,]/g, '');
    cleaned = cleaned.replace(/^\.+|\.+$/g, '');
    if (!cleaned) return;

    const wellFormedThou = /^\d{1,3}([.,]\d{3})+$/.test(cleaned);
    const wellFormedPlain = /^[1-9]\d{0,3}$/.test(cleaned);

    if (wellFormedThou) {
      push(cleaned, Number(cleaned.replace(/[.,]/g, '')), true);
      return;
    }
    const near = cleaned.match(/^(\d{1,3})[.,](\d{4})$/);
    if (near) {
      const head = near[1];
      const four = near[2];
      for (let drop = 0; drop < 4; drop++) {
        const three = four.slice(0, drop) + four.slice(drop + 1);
        push(`${head}.${three}`, Number(head + three), false);
      }
    }
    if (wellFormedPlain) {
      push(cleaned, Number(cleaned), true);
      if (cleaned.length <= 4) return;
    }

    if (/^\d{1,7}$/.test(cleaned)) {
      push(cleaned, Number(cleaned), false);
    } else {
      const n = Number(cleaned.replace(/[.,]/g, ''));
      if (Number.isFinite(n) && n > 0) push(cleaned, n, false);
    }

    const digits = cleaned.replace(/[.,]/g, '');
    for (let strip = 1; strip <= 2 && strip < digits.length; strip++) {
      const restDigits = digits.slice(strip);
      if (!restDigits || /^0+$/.test(restDigits)) continue;
      if (restDigits.length === 4) {
        push(`${restDigits[0]}.${restDigits.slice(1)}`, Number(restDigits), false);
      } else if (restDigits.length <= 4) {
        push(restDigits, Number(restDigits), false);
      }
    }
  };

  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    addFromToken(trimmed.replace(/\s+/g, ''));
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      for (const part of parts) addFromToken(part);
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

const REGIONS: Region[] = [
  { x: 0.24, y: 0.48, w: 0.62, h: 0.44 },
  { x: 0.32, y: 0.68, w: 0.54, h: 0.26 },
  // Monster counts sit a bit higher on the dark bar
  { x: 0.28, y: 0.52, w: 0.55, h: 0.28 },
];

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function chroma(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

interface Glyph {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  area: number;
}

function componentsIn(
  mask: Uint8Array,
  w: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): Glyph[] {
  const seen = new Uint8Array(mask.length);
  const comps: Glyph[] = [];
  const stack: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const s = y * w + x;
      if (!mask[s] || seen[s]) continue;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;
      stack.push(s);
      seen[s] = 1;
      while (stack.length) {
        const cur = stack.pop()!;
        area++;
        const cx = cur % w;
        const cy = (cur / w) | 0;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < x0 || ny < y0 || nx >= x1 || ny >= y1) continue;
          const ni = ny * w + nx;
          if (!mask[ni] || seen[ni]) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      comps.push({ minX, maxX, minY, maxY, area });
    }
  }
  return comps;
}

interface DigitExtraction {
  mask: Uint8Array;
  glyphs: Glyph[];
  medH: number;
  width: number;
  height: number;
}

/**
 * White fill + black outline → densest digit row → connected glyphs.
 */
function extractDigits(img: RgbaImage): DigitExtraction {
  const { data, width: w, height: h } = img;
  const L = new Float32Array(w * h);
  const S = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    L[i] = luma(data[p], data[p + 1], data[p + 2]);
    S[i] = chroma(data[p], data[p + 1], data[p + 2]);
  }

  const x0 = Math.max(0, Math.floor(w * 0.02));
  const x1 = Math.min(w, Math.floor(w * 0.98));
  const seed = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x++) {
      const i = y * w + x;
      if (L[i] < 148 || S[i] > 60) continue;
      let darkN = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (L[(y + dy) * w + (x + dx)] < 100) darkN++;
        }
      }
      if (darkN >= 1 || L[i] >= 210) seed[i] = 1;
    }
  }

  const full = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!seed[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = (y + dy) * w + (x + dx);
          if (L[j] >= 135 && S[j] <= 65) full[j] = 1;
        }
      }
    }
  }

  let bestY0 = Math.floor(h * 0.55);
  let bestY1 = Math.min(h, bestY0 + 12);
  let bestScore = -Infinity;
  let bestMedH = 8;

  for (let bandH = 9; bandH <= Math.min(16, h); bandH++) {
    for (let y = 0; y + bandH <= h; y++) {
      const comps = componentsIn(full, w, x0, x1, y, y + bandH);
      const digits = comps.filter((c) => {
        const gw = c.maxX - c.minX + 1;
        const gh = c.maxY - c.minY + 1;
        return c.area >= 6 && gh >= 5 && gh <= 14 && gw >= 2 && gw <= 12;
      });
      if (digits.length < 2) continue;
      const heights = digits
        .map((d) => d.maxY - d.minY + 1)
        .sort((a, b) => a - b);
      const medH = heights[Math.floor(heights.length / 2)];
      const consistent = digits.filter(
        (d) => Math.abs(d.maxY - d.minY + 1 - medH) <= 3,
      );
      if (consistent.length < 2) continue;

      let bg = 0;
      let bn = 0;
      for (const d of consistent) {
        for (let yy = d.minY; yy <= d.maxY; yy++) {
          for (let xx = d.minX - 2; xx <= d.maxX + 2; xx++) {
            if (xx < 0 || xx >= w) continue;
            if (full[yy * w + xx]) continue;
            bg += L[yy * w + xx];
            bn++;
          }
        }
      }
      const meanBg = bn ? bg / bn : 255;
      const midX = (x0 + x1) / 2;
      const rightish = consistent.filter(
        (d) => (d.minX + d.maxX) / 2 >= midX - w * 0.08,
      ).length;

      let score = consistent.length * 25;
      if (consistent.length <= 5) score += 40;
      score += rightish * 8 + (y / Math.max(1, h)) * 5;
      if (meanBg < 120) score += 30;
      if (meanBg > 160) score -= 40;
      if (comps.some((c) => c.maxX - c.minX + 1 > 18 || c.area > 120)) {
        score -= 50;
      }
      if (score > bestScore) {
        bestScore = score;
        bestY0 = y;
        bestY1 = y + bandH;
        bestMedH = medH;
      }
    }
  }

  const mask = new Uint8Array(w * h);
  if (bestScore > 0) {
    const yA = Math.max(0, bestY0 - 2);
    const yB = Math.min(h, bestY1 + 2);
    for (let y = yA; y < yB; y++) {
      for (let x = x0; x < x1; x++) mask[y * w + x] = full[y * w + x];
    }
  } else {
    mask.set(full);
  }

  const yA = Math.max(0, bestY0 - 2);
  const yB = Math.min(h, bestY1 + 2);
  const comps = componentsIn(mask, w, x0, x1, yA, yB);
  const mh = bestMedH;
  let glyphs = comps
    .filter((c) => {
      const gw = c.maxX - c.minX + 1;
      const gh = c.maxY - c.minY + 1;
      if (c.area < 3) return false;
      if (gh >= mh * 0.55 && gh <= mh * 1.45 && gw <= mh * 1.5) return true;
      if (gh <= mh * 0.4 && gw <= mh * 0.55) return true;
      return false;
    })
    .sort((a, b) => a.minX - b.minX);

  const digitish = glyphs.filter((g) => g.maxY - g.minY + 1 >= mh * 0.55);
  if (digitish.length) {
    const left = digitish[0].minX;
    const right = digitish[digitish.length - 1].maxX;
    glyphs = glyphs.filter((g) => g.minX >= left - 2 && g.maxX <= right + 2);
  }

  return { mask, glyphs, medH: mh, width: w, height: h };
}

function toBitmap(mask: Uint8Array, w: number, g: Glyph): Uint8Array {
  const gw = g.maxX - g.minX + 1;
  const gh = g.maxY - g.minY + 1;
  const out = new Uint8Array(DIGIT_TW * DIGIT_TH);
  const scale = Math.min((DIGIT_TW - 2) / gw, (DIGIT_TH - 2) / gh);
  const rw = Math.max(1, Math.round(gw * scale));
  const rh = Math.max(1, Math.round(gh * scale));
  const ox = 1 + (((DIGIT_TW - 2 - rw) / 2) | 0);
  const oy = 1 + (((DIGIT_TH - 2 - rh) / 2) | 0);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const sx = g.minX + Math.min(gw - 1, ((x * gw) / rw) | 0);
      const sy = g.minY + Math.min(gh - 1, ((y * gh) / rh) | 0);
      out[(y + oy) * DIGIT_TW + (x + ox)] = mask[sy * w + sx] ? 1 : 0;
    }
  }
  return out;
}

function ncc(a: Uint8Array | number[], b: number[]): number {
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const av = a[i];
    const bv = b[i];
    sumA += av;
    sumB += bv;
    sumAA += av * av;
    sumBB += bv * bv;
    sumAB += av * bv;
  }
  const den = Math.sqrt(
    (n * sumAA - sumA * sumA) * (n * sumBB - sumB * sumB),
  );
  return den < 1e-6 ? -1 : (n * sumAB - sumA * sumB) / den;
}

function holeCount(mask: Uint8Array, w: number, g: Glyph): number {
  const gw = g.maxX - g.minX + 3;
  const gh = g.maxY - g.minY + 3;
  const grid = new Uint8Array(gw * gh);
  for (let y = g.minY; y <= g.maxY; y++) {
    for (let x = g.minX; x <= g.maxX; x++) {
      if (mask[y * w + x]) {
        grid[(y - g.minY + 1) * gw + (x - g.minX + 1)] = 1;
      }
    }
  }
  const seen = new Uint8Array(gw * gh);
  const q = [0];
  seen[0] = 1;
  while (q.length) {
    const cur = q.pop()!;
    const cx = cur % gw;
    const cy = (cur / gw) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      const ni = ny * gw + nx;
      if (seen[ni] || grid[ni]) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }
  let holes = 0;
  for (let i = 0; i < gw * gh; i++) {
    if (seen[i] || grid[i]) continue;
    holes++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      const cx = cur % gw;
      const cy = (cur / gw) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const ni = ny * gw + nx;
        if (seen[ni] || grid[ni]) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
  }
  return holes;
}

function classifyGlyph(
  mask: Uint8Array,
  w: number,
  g: Glyph,
  medH: number,
): { ch: string; score: number } {
  const gw = g.maxX - g.minX + 1;
  const gh = g.maxY - g.minY + 1;
  if (gh <= medH * 0.4 && gw <= medH * 0.55) {
    return { ch: '.', score: 0.98 };
  }

  const bmp = toBitmap(mask, w, g);
  let best = '?';
  let bestS = -1;
  for (const [ch, samples] of Object.entries(DIGIT_TEMPLATES)) {
    for (const tpl of samples) {
      const s = ncc(bmp, tpl);
      if (s > bestS) {
        bestS = s;
        best = ch;
      }
    }
  }

  const holes = holeCount(mask, w, g);
  const aspect = gw / gh;
  if (aspect < 0.42) return { ch: '1', score: Math.max(bestS, 0.85) };
  if (holes >= 2) return { ch: '8', score: Math.max(bestS, 0.85) };

  // Geometry only breaks ties — strong NCC wins for this game font
  if (holes === 1 && bestS < 0.7) {
    let top = 0;
    let bot = 0;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (!mask[(g.minY + y) * w + (g.minX + x)]) continue;
        if (y < gh * 0.4) top++;
        if (y > gh * 0.6) bot++;
      }
    }
    if (bot > top * 1.35) return { ch: '6', score: Math.max(bestS, 0.72) };
    if (top > bot * 1.35) return { ch: '9', score: Math.max(bestS, 0.72) };
    if (bestS < 0.45) return { ch: '0', score: Math.max(bestS, 0.6) };
  }

  if (bestS >= 0.28) return { ch: best, score: bestS };
  return { ch: '?', score: 0 };
}

function readByTemplates(ex: DigitExtraction): {
  text: string;
  value: number | null;
  conf: number;
} {
  let text = '';
  let conf = 0;
  for (const g of ex.glyphs) {
    const r = classifyGlyph(ex.mask, ex.width, g, ex.medH);
    text += r.ch;
    conf += r.score;
  }
  conf = ex.glyphs.length ? conf / ex.glyphs.length : 0;
  const digits = text.replace(/[^0-9]/g, '');
  if (!digits || digits.includes('?')) {
    return { text, value: null, conf };
  }
  let value = Number(digits);
  if (text.includes('.') && /^\d\.\d{3}$/.test(text.replace(/[^0-9.]/g, ''))) {
    value = Number(digits);
  }
  return { text, value, conf };
}

function maskToOcrBlob(
  mask: Uint8Array,
  w: number,
  h: number,
): Promise<Blob | null> {
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

  const padX = Math.max(2, Math.floor((maxX - minX + 1) * 0.08));
  const padY = 2;
  minX = Math.max(0, minX - padX);
  minY = Math.max(0, minY - padY);
  maxX = Math.min(w - 1, maxX + padX);
  maxY = Math.min(h - 1, maxY + padY);

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const border = 14;
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

  const scale = 16;
  const up = resizeRgba(
    { data: canvas, width: bw, height: bh },
    bw * scale,
    bh * scale,
  );
  return rgbaToPngBlob(up);
}

export interface OcrOutcome {
  count: number | null;
  text: string;
}

/**
 * Read troop count: white digits + black outline on dark bar.
 * Primary: per-glyph NCC templates. Fallback: Tesseract on clean stroke mask.
 */
export async function readTroopCount(tile: RgbaImage): Promise<OcrOutcome> {
  const worker = await getWorker();
  const votes = new Map<
    number,
    { quality: number; hits: number; raw: string }
  >();
  let anyRaw = '';

  const consider = (raw: string, bonus = 0) => {
    if (raw) anyRaw = anyRaw || raw;
    for (const c of parseTroopCountCandidates(raw)) {
      const q = c.quality + bonus;
      const prev = votes.get(c.value);
      if (!prev) {
        votes.set(c.value, { quality: q, hits: 1, raw: c.raw });
      } else {
        prev.hits += 1;
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
    const ex = extractDigits(strip);

    // Tesseract on isolated white+outline row
    let tessText = '';
    const strokeBlob = await maskToOcrBlob(ex.mask, ex.width, ex.height);
    if (strokeBlob) {
      const {
        data: { text },
      } = await worker.recognize(strokeBlob);
      tessText = text.trim();
    }

    const tessCompact = tessText
      .replace(/[^\d.,]/g, '')
      .replace(/^\.+|\.+$/g, '');
    const tessThou = /^\d{1,3}([.,]\d{3})+$/.test(tessCompact);
    const tessWeak = !/\d{2}/.test(tessCompact);

    // Always feed Tesseract through the parser (keeps well-formed leading digits)
    if (tessText) consider(tessThou ? tessCompact : tessText, tessThou ? 80 : 0);

    // Template classifier only when Tesseract failed / returned a single digit
    if (tessWeak) {
      const cc = readByTemplates(ex);
      if (cc.value != null && cc.conf >= 0.55 && !cc.text.includes('?')) {
        const digits = String(cc.value);
        const formatted =
          digits.length === 4
            ? `${digits[0]}.${digits.slice(1)}`
            : cc.text.replace(/[^0-9.]/g, '') || digits;
        consider(formatted, 30 + Math.round(cc.conf * 30));
      }
    }
  }

  if (!votes.size) return { count: null, text: anyRaw };

  const ranked = [...votes.entries()]
    .map(([value, meta]) => ({
      value,
      raw: meta.raw,
      score: meta.quality * 3 + meta.hits,
    }))
    .sort((a, b) => b.score - a.score);

  let best = ranked[0];
  if (/^[1-9]00$/.test(String(best.value))) {
    const alt = ranked.find(
      (r) => r.value !== best.value && r.value >= 10 && r.value <= 9999,
    );
    if (alt && alt.score >= best.score - 40) best = alt;
  }

  return { count: best.value, text: best.raw || anyRaw };
}

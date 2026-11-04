/**
 * Skaner screenshotów listy wojsk (na razie TYLKO gwardia — bez potworów).
 *
 * Identyfikacja:
 *  - poziom (tier) = kolor tła za postacią na ikonie
 *      1 biały, 2 zielony, 3 niebieski, 4 fioletowy, 5 pomarańczowy
 *  - typ = poza postaci
 *      łucznik → patrzy w prawo-górę, naciąga łuk
 *      włócznik → na wprost
 *      jeździec → profil
 *      gryf → orzeł z otwartym dziobem
 *  - ilość = cyfra po „Masz:” przy tej pozycji
 */
import { createWorker, PSM, type Worker } from 'tesseract.js';
import {
  FLYING_MIN_TIER,
  GUARDS_MAX_TIER,
  isTypeAvailable,
  type ArmyType,
} from './army.data';
import type { MonsterRace } from './monsters.data';
import { guardsTierIcon } from './troop-icons';

export type TroopScanKind = 'guards' | 'monster';

export interface TroopScanHit {
  kind: TroopScanKind;
  type?: ArmyType;
  race?: MonsterRace;
  tier: number;
  count: number;
  label: string;
}

interface Band {
  top: number;
  height: number;
  left: number;
  width: number;
}

interface PoseTemplate {
  type: ArmyType;
  /** Znormalizowana mapa krawędzi 32×32 (0..1). */
  edges: Float32Array;
  /** Asymetria lewo/prawo i góra (cechy pozy). */
  features: Float32Array;
}

const TYPE_LABEL: Record<ArmyType, string> = {
  ranged: 'Łucznik',
  melee: 'Włócznik',
  mounted: 'Jeździec',
  flying: 'Gryf',
};

let workerPromise: Promise<Worker> | null = null;
let posePromise: Promise<PoseTemplate[]> | null = null;

function labelFor(type: ArmyType, tier: number): string {
  return `${TYPE_LABEL[type]} G${tier}`;
}

function parseCount(raw: string): number | null {
  let s = raw.trim();
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  else s = s.replace(/[^\d]/g, '');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 50_000_000) return null;
  return n;
}

function parseMasz(text: string): number | null {
  const cleaned = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l');
  const m = cleaned.match(
    /(?:masz|mazz|ma5z|mas2|nasz|hasz)\s*[:.]?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)/i,
  );
  if (m) return parseCount(m[1]);
  // W wycinku zielonego przycisku sama liczba też jest OK
  const bare = cleaned.match(/(\d{1,3}(?:[.,]\d{3})+|\d{1,7})/);
  return bare ? parseCount(bare[1]) : null;
}

async function worker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      try {
        return await createWorker('eng+pol');
      } catch {
        return await createWorker('eng');
      }
    })();
  }
  return workerPromise;
}

async function fileToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return canvas;
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max / 255;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h, s, v };
}

/** Zielone przyciski „Masz: …” — kotwice wierszy. */
function findMaszBands(canvas: HTMLCanvasElement): Band[] {
  const w = canvas.width;
  const h = canvas.height;
  const rightW = Math.round(w * 0.42);
  const left = w - rightW;
  const { data } = canvas.getContext('2d')!.getImageData(left, 0, rightW, h);

  const score = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let green = 0;
    for (let x = Math.round(rightW * 0.08); x < rightW; x++) {
      const i = (y * rightW + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (g > r + 8 && g > b + 5 && lum > 28 && lum < 175) green++;
    }
    score[y] = green / (rightW * 0.92);
  }

  const smooth = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    let n = 0;
    for (let k = -3; k <= 3; k++) {
      const yy = y + k;
      if (yy >= 0 && yy < h) {
        s += score[yy];
        n++;
      }
    }
    smooth[y] = s / n;
  }

  const thr = 0.28;
  const bands: Band[] = [];
  let y = 0;
  while (y < h) {
    while (y < h && smooth[y] < thr) y++;
    if (y >= h) break;
    const start = y;
    while (y < h && smooth[y] >= thr * 0.6) y++;
    const end = y;
    const hh = end - start;
    if (hh >= 14 && hh <= 90) {
      bands.push({ top: start, height: hh, left, width: rightW });
    } else if (hh > 90) {
      for (let t = start; t < end - 12; ) {
        let bestY = t;
        let best = -1;
        const win = Math.min(52, end - t);
        for (let yy = t; yy < t + win; yy++) {
          if (smooth[yy] > best) {
            best = smooth[yy];
            bestY = yy;
          }
        }
        if (best >= thr * 0.65) {
          const top = Math.max(start, bestY - 14);
          const bottom = Math.min(end, bestY + 16);
          bands.push({ top, height: bottom - top, left, width: rightW });
          t = bottom + 6;
        } else {
          t += 18;
        }
      }
    }
  }
  return bands.filter((b) => b.top >= h * 0.03);
}

function bandToPng(canvas: HTMLCanvasElement, band: Band, lumThr: number): Blob {
  const padY = 6;
  const left = Math.max(0, band.left + Math.round(band.width * 0.02));
  const top = Math.max(0, band.top - padY);
  const width = Math.min(canvas.width - left, Math.round(band.width * 0.96));
  const height = Math.min(canvas.height - top, band.height + padY * 2);
  const scale = 6;
  const sw = Math.max(1, Math.round(width * scale));
  const sh = Math.max(1, Math.round(height * scale));
  const crop = document.createElement('canvas');
  crop.width = sw;
  crop.height = sh;
  crop.getContext('2d')!.drawImage(canvas, left, top, width, height, 0, 0, sw, sh);
  const { data } = crop.getContext('2d')!.getImageData(0, 0, sw, sh);

  const margin = 28;
  const out = document.createElement('canvas');
  out.width = sw + margin * 2;
  out.height = sh + margin * 2;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  const img = ctx.createImageData(sw, sh);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const v = lum > lumThr ? 0 : 255;
    const j = p * 4;
    img.data[j] = img.data[j + 1] = img.data[j + 2] = v;
    img.data[j + 3] = 255;
  }
  ctx.putImageData(img, margin, margin);

  const bin = atob(out.toDataURL('image/png').split(',')[1] ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

async function ocrMaszCount(
  w: Worker,
  canvas: HTMLCanvasElement,
  band: Band,
): Promise<number | null> {
  for (const lum of [125, 150, 170, 190, 205]) {
    const blob = bandToPng(canvas, band, lum);
    for (const psm of [PSM.SINGLE_LINE, PSM.SINGLE_WORD]) {
      await w.setParameters({
        tessedit_pageseg_mode: psm,
        tessedit_char_whitelist: 'MaszHASZm:.0123456789',
        user_defined_dpi: '300',
      });
      const text = (await w.recognize(blob)).data.text ?? '';
      const n = parseMasz(text);
      if (n != null) return n;
    }
  }
  return null;
}

/** Wycinek ikony po lewej na wysokości wiersza Masz. */
function cropIconAtRow(canvas: HTMLCanvasElement, yCenter: number, rowH: number): ImageData {
  const w = canvas.width;
  const h = canvas.height;
  const size = Math.max(40, Math.round(Math.min(w * 0.14, rowH * 1.35, h * 0.12)));
  const x = Math.round(w * 0.02);
  const y = Math.max(0, Math.round(yCenter - size / 2));
  const side = Math.min(size, w - x, h - y);

  const box = document.createElement('canvas');
  box.width = 64;
  box.height = 64;
  box
    .getContext('2d')!
    .drawImage(canvas, x, y, side, side, 0, 0, 64, 64);
  return box.getContext('2d')!.getImageData(0, 0, 64, 64);
}

/**
 * Tier z koloru tła za bohaterem (obwódka ikony).
 * 1 biały, 2 zielony, 3 niebieski, 4 fioletowy, 5 pomarańczowy.
 */
function classifyTierFromBackground(img: ImageData): number {
  const { width: w, height: h, data } = img;
  const votes = { white: 0, green: 0, blue: 0, purple: 0, orange: 0 };
  const border = Math.max(3, Math.round(w * 0.18));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const onBorder =
        x < border || y < border || x >= w - border || y >= h - border;
      if (!onBorder) continue;
      // Pomiń sam środek krawędzi dolnej (ziemia) — bierz boki i górę mocniej
      const topOrSide = y < border * 1.6 || x < border || x >= w - border;
      if (!topOrSide && y >= h - border) continue;

      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const { h: hh, s, v } = rgbToHsv(r, g, b);
      const deg = hh * 360;

      if (s < 0.18 && v > 0.55) {
        votes.white += 1.2;
        continue;
      }
      if (s < 0.12) continue;

      if (deg >= 70 && deg < 165) votes.green += 1;
      else if (deg >= 185 && deg < 255) votes.blue += 1;
      else if (deg >= 255 && deg < 325) votes.purple += 1;
      else if (deg >= 12 && deg < 55) votes.orange += 1;
      else if (deg < 12 || deg >= 345) {
        // czerwona peleryna — nie mylić z tłem; lekki bonus tylko przy wysokim V i niskim S już obsłużony
      }
    }
  }

  const ranked: [number, number][] = [
    [1, votes.white],
    [2, votes.green],
    [3, votes.blue],
    [4, votes.purple],
    [5, votes.orange],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] < 8) {
    // Słaby sygnał — spróbuj średnią saturację całej obwódki jeszcze raz przez dominantę hue
    return ranked[0][0];
  }
  return ranked[0][0];
}

function luminanceAt(data: Uint8ClampedArray, w: number, x: number, y: number): number {
  const i = (y * w + x) * 4;
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

/** Mapa krawędzi 32×32 + cechy pozy (łuk w prawo-górę, profil, skrzydła…). */
function extractPose(img: ImageData): { edges: Float32Array; features: Float32Array } {
  const size = 32;
  const box = document.createElement('canvas');
  box.width = size;
  box.height = size;
  const ctx = box.getContext('2d')!;
  // ImageData 64×64 → narysuj na temp
  const src = document.createElement('canvas');
  src.width = img.width;
  src.height = img.height;
  src.getContext('2d')!.putImageData(img, 0, 0);
  ctx.drawImage(src, 0, 0, size, size);
  const { data, width: w, height: h } = ctx.getImageData(0, 0, size, size);

  const edges = new Float32Array(size * size);
  let edgeSum = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        luminanceAt(data, w, x + 1, y) - luminanceAt(data, w, x - 1, y);
      const gy =
        luminanceAt(data, w, x, y + 1) - luminanceAt(data, w, x, y - 1);
      const mag = Math.hypot(gx, gy);
      edges[y * size + x] = mag;
      edgeSum += mag;
    }
  }
  if (edgeSum > 1e-6) {
    for (let i = 0; i < edges.length; i++) edges[i] /= edgeSum;
  }

  // Cechy pozy wg opisu użytkownika
  const features = new Float32Array(8);
  const quad = (x0: number, y0: number, x1: number, y1: number) => {
    let s = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) s += edges[y * size + x];
    }
    return s;
  };
  const mid = size / 2;
  const qTL = quad(0, 0, mid, mid);
  const qTR = quad(mid, 0, size, mid);
  const qBL = quad(0, mid, mid, size);
  const qBR = quad(mid, mid, size, size);
  features[0] = qTR; // łucznik: masa w prawo-górę
  features[1] = qTL + qTR; // góra (skrzydła gryfa / łuk)
  features[2] = Math.abs(qTL + qBL - (qTR + qBR)); // asymetria L/P (profil jeźdźca)
  features[3] = 1 - Math.abs(qTL + qTR - (qBL + qBR)); // pionowa równowaga (włócznik na wprost)
  features[4] = quad(0, 0, size, Math.round(size * 0.35)); // górny pas (skrzydła/dziób)

  // Brąz dolnej połowy (koń)
  let brown = 0;
  let brownN = 0;
  for (let y = mid; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const { h: hh, s, v } = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      brownN++;
      if (s > 0.2 && v > 0.12 && v < 0.7) {
        const deg = hh * 360;
        if (deg >= 15 && deg < 50) brown++;
      }
    }
  }
  features[5] = brownN ? brown / brownN : 0;

  // Pióra / pomarańcz-brąz u góry (gryf)
  let feather = 0;
  let featherN = 0;
  for (let y = 0; y < mid; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const { h: hh, s, v } = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      featherN++;
      if (s > 0.2 && v > 0.2) {
        const deg = hh * 360;
        if (deg >= 20 && deg < 55) feather++;
      }
    }
  }
  features[6] = featherN ? feather / featherN : 0;

  // Pionowe krawędzie po bokach (włócznia)
  let vert = 0;
  for (let y = 2; y < h - 2; y++) {
    for (const x of [2, 3, w - 4, w - 3]) {
      const gy =
        Math.abs(
          luminanceAt(data, w, x, y + 1) - luminanceAt(data, w, x, y - 1),
        );
      const gx =
        Math.abs(
          luminanceAt(data, w, x + 1, y) - luminanceAt(data, w, x - 1, y),
        );
      if (gy > gx + 8) vert++;
    }
  }
  features[7] = vert / (h * 4);

  return { edges, features };
}

function poseDistance(
  a: { edges: Float32Array; features: Float32Array },
  b: { edges: Float32Array; features: Float32Array },
): number {
  let e = 0;
  for (let i = 0; i < a.edges.length; i++) {
    const d = a.edges[i] - b.edges[i];
    e += d * d;
  }
  e = Math.sqrt(e / a.edges.length);
  let f = 0;
  for (let i = 0; i < a.features.length; i++) {
    const d = a.features[i] - b.features[i];
    f += d * d;
  }
  f = Math.sqrt(f / a.features.length);
  return 0.55 * e + 0.45 * f;
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url.startsWith('/') ? url : `/${url}`;
  });
}

/** Szablony pozy — jeden reprezentant na typ (nie mylimy tierów). */
async function loadPoseTemplates(): Promise<PoseTemplate[]> {
  if (!posePromise) {
    posePromise = (async () => {
      const jobs: { type: ArmyType; url: string }[] = [
        { type: 'melee', url: guardsTierIcon('melee', 3) },
        { type: 'ranged', url: guardsTierIcon('ranged', 3) },
        { type: 'mounted', url: guardsTierIcon('mounted', 3) },
        { type: 'flying', url: guardsTierIcon('flying', 5) },
      ];
      const out: PoseTemplate[] = [];
      const box = document.createElement('canvas');
      box.width = 64;
      box.height = 64;
      const ctx = box.getContext('2d')!;
      for (const job of jobs) {
        const img = await loadImage(job.url);
        if (!img) continue;
        ctx.clearRect(0, 0, 64, 64);
        ctx.drawImage(img, 0, 0, 64, 64);
        const pose = extractPose(ctx.getImageData(0, 0, 64, 64));
        out.push({ type: job.type, edges: pose.edges, features: pose.features });
      }
      return out;
    })();
  }
  return posePromise;
}

/**
 * Typ z pozy: łucznik / włócznik / jeździec / gryf.
 * Najpierw reguły charakterystyczne, potem dopasowanie do szablonów.
 */
function classifyType(
  img: ImageData,
  templates: PoseTemplate[],
  tier: number,
): ArmyType | null {
  const pose = extractPose(img);
  const f = pose.features;

  // Reguły z opisu użytkownika
  const ruleScores: Record<ArmyType, number> = {
    ranged: f[0] * 2.2 + f[1] * 0.6 - f[5] * 0.8, // prawo-góra, łuk
    melee: f[3] * 1.8 + f[7] * 1.5 - f[2] * 0.7 - f[0] * 0.5, // na wprost + włócznia
    mounted: f[2] * 1.6 + f[5] * 2.4 - f[0] * 0.4, // profil + koń
    flying: f[4] * 1.8 + f[6] * 2.2 + f[1] * 0.8, // skrzydła + pióra
  };

  // Gryfy dopiero od G5
  if (tier < FLYING_MIN_TIER) ruleScores.flying = -999;

  let bestRule: ArmyType = 'melee';
  let bestRuleScore = -Infinity;
  for (const t of Object.keys(ruleScores) as ArmyType[]) {
    if (ruleScores[t] > bestRuleScore) {
      bestRuleScore = ruleScores[t];
      bestRule = t;
    }
  }

  let bestTpl: ArmyType | null = null;
  let bestDist = Infinity;
  let second = Infinity;
  for (const t of templates) {
    if (t.type === 'flying' && tier < FLYING_MIN_TIER) continue;
    const d = poseDistance(pose, t);
    if (d < bestDist) {
      second = bestDist;
      bestDist = d;
      bestTpl = t.type;
    } else if (d < second) {
      second = d;
    }
  }

  if (bestTpl && bestDist < 0.12 && bestDist < second * 0.94) {
    // Szablon pewny — ewentualnie nadpisz regułę gdy blisko
    if (bestTpl === bestRule || bestDist < 0.07) return bestTpl;
  }

  // Przy słabym szablonie zaufaj regułom pozy
  if (bestRuleScore > 0.02) return bestRule;
  return bestTpl;
}

export function mergeTroopHits(groups: TroopScanHit[][]): TroopScanHit[] {
  const map = new Map<string, TroopScanHit>();
  for (const group of groups) {
    for (const hit of group) {
      if (hit.kind !== 'guards' || !hit.type) continue;
      map.set(`g:${hit.type}:${hit.tier}`, hit);
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return (a.label ?? '').localeCompare(b.label ?? '');
  });
}

/**
 * Skanuje screenshot listy wojsk (gwardia).
 * Potwory — pomijane (na razie).
 */
export async function scanTroopScreenshot(
  file: Blob,
  onProgress?: (p: number) => void,
): Promise<TroopScanHit[]> {
  onProgress?.(0.05);
  const canvas = await fileToCanvas(file);
  const w = await worker();
  const poses = await loadPoseTemplates();
  onProgress?.(0.12);

  const bands = findMaszBands(canvas);
  const hits: TroopScanHit[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    const yCenter = band.top + band.height / 2;
    const count = await ocrMaszCount(w, canvas, band);
    onProgress?.(0.12 + (0.7 * (i + 0.5)) / Math.max(bands.length, 1));

    if (count == null) {
      onProgress?.(0.12 + (0.7 * (i + 1)) / Math.max(bands.length, 1));
      continue;
    }

    const icon = cropIconAtRow(canvas, yCenter, band.height);
    const tier = classifyTierFromBackground(icon);
    if (tier < 1 || tier > GUARDS_MAX_TIER) {
      onProgress?.(0.12 + (0.7 * (i + 1)) / Math.max(bands.length, 1));
      continue;
    }

    const type = classifyType(icon, poses, tier);
    if (!type || !isTypeAvailable(type, tier)) {
      onProgress?.(0.12 + (0.7 * (i + 1)) / Math.max(bands.length, 1));
      continue;
    }

    const key = `g:${type}:${tier}`;
    if (seen.has(key)) {
      // Ten sam typ+tier — nadpisz nowszą wartością Masz (kolejne screeny i tak merge'ują)
      const prev = hits.find((h) => h.type === type && h.tier === tier);
      if (prev) prev.count = count;
    } else {
      seen.add(key);
      hits.push({
        kind: 'guards',
        type,
        tier,
        count,
        label: labelFor(type, tier),
      });
    }

    onProgress?.(0.12 + (0.7 * (i + 1)) / Math.max(bands.length, 1));
  }

  onProgress?.(1);
  return hits;
}

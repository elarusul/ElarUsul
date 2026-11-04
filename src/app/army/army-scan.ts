import { createWorker, PSM, type Worker } from 'tesseract.js';
import {
  ARMY_TYPES,
  FLYING_MIN_TIER,
  GUARDS_MAX_TIER,
  isTypeAvailable,
  type ArmyType,
} from './army.data';
import {
  MONSTER_MAX_TIER,
  MONSTER_MIN_TIER,
  MONSTER_NAMES,
  MONSTER_RACES,
  type MonsterRace,
} from './monsters.data';
import { guardsTierIcon, monsterTierIcon } from './troop-icons';

export type TroopScanKind = 'guards' | 'monster';

export interface TroopScanHit {
  kind: TroopScanKind;
  type?: ArmyType;
  race?: MonsterRace;
  tier: number;
  count: number;
  label: string;
}

interface CatalogEntry {
  kind: TroopScanKind;
  type?: ArmyType;
  race?: MonsterRace;
  /** Fixed tier when name encodes it (Punisher I, Magiczny smok, …). */
  tier?: number;
  names: string[];
}

interface IdentifiedUnit {
  kind: TroopScanKind;
  type?: ArmyType;
  race?: MonsterRace;
  tier: number;
}

/** Charakterystyczny podpis wizualny ikony (kolor + krawędzie + paleta). */
interface IconSignature {
  /** 12×12 RGB, środek ważony mocniej. */
  grid: Float32Array;
  /** 12 koszyków Hue (tylko piksele z nasyceniem). */
  hue: Float32Array;
  /** Energia krawędzi: 4 orientacje × 3×3 strefy. */
  edges: Float32Array;
  /** Udziały palety: red, orange, yellow/gold, green, cyan, blue, purple, brown, metal, skin. */
  palette: Float32Array;
}

interface IconPeak {
  y: number;
  x: number;
  size: number;
  sig: IconSignature;
  score: number;
}

interface MaszEntry {
  y: number;
  top: number;
  height: number;
  count: number | null;
}

interface RawSlot {
  y: number;
  hasMasz: boolean;
  maszCount: number | null;
  peak?: IconPeak;
  nameHints: string[];
}

interface IconTemplate {
  kind: TroopScanKind;
  type?: ArmyType;
  race?: MonsterRace;
  tier: number;
  sig: IconSignature;
}

const ROMAN: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
};

/** In-game names (PL + EN), longest first after sort. */
const CATALOG: CatalogEntry[] = [
  { kind: 'guards', type: 'melee', tier: 9, names: ['punisher ii', 'kariciel ii'] },
  { kind: 'guards', type: 'melee', tier: 8, names: ['punisher i', 'kariciel i', 'punisher'] },
  { kind: 'guards', type: 'ranged', tier: 9, names: ['purifier ii', 'oczyszcziciel ii'] },
  { kind: 'guards', type: 'ranged', tier: 8, names: ['purifier i', 'oczyszcziciel i', 'purifier'] },
  { kind: 'guards', type: 'mounted', tier: 9, names: ['smiter ii', 'pogromca ii'] },
  { kind: 'guards', type: 'mounted', tier: 8, names: ['smiter i', 'pogromca i', 'smiter'] },
  { kind: 'guards', type: 'flying', tier: 9, names: ['corax ii'] },
  { kind: 'guards', type: 'flying', tier: 8, names: ['corax i', 'corax'] },
  {
    kind: 'guards',
    type: 'melee',
    names: [
      'ciezki halabardnik',
      'halabardnik',
      'spearman',
      'wlocznicy',
      'wlocznik',
      'wl ocznik',
    ],
  },
  {
    kind: 'guards',
    type: 'ranged',
    names: [
      'ciezki kusznik',
      'arbalester',
      'kusznicy',
      'kusznik',
      'archers',
      'archer',
      'lucznicy',
      'lucznik',
    ],
  },
  {
    kind: 'guards',
    type: 'mounted',
    names: ['rycerz konny', 'riders', 'rider', 'jezdziec', 'jezdzy', 'jezdzcy'],
  },
  {
    kind: 'guards',
    type: 'flying',
    names: ['gryf bitewny', 'battle griffin', 'griffins', 'griffin', 'gryfy', 'gryf'],
  },
  { kind: 'monster', race: 'beast', tier: 3, names: ['odyniec bojowy', 'battle boar'] },
  { kind: 'monster', race: 'giant', tier: 3, names: ['kamienny gargulec', 'stone gargoyle'] },
  { kind: 'monster', race: 'elemental', tier: 3, names: ['zywiolak wody', 'water elemental'] },
  { kind: 'monster', race: 'dragon', tier: 3, names: ['szmaragdowy smok', 'emerald dragon'] },
  { kind: 'monster', race: 'beast', tier: 4, names: ['gorgona meduza', 'gorgona', 'gorgon'] },
  {
    kind: 'monster',
    race: 'giant',
    tier: 4,
    names: ['wieloreki straznik', 'wieloreki', 'many-armed giant', 'many armed giant'],
  },
  { kind: 'monster', race: 'elemental', tier: 4, names: ['lodowy feniks', 'ice phoenix'] },
  { kind: 'monster', race: 'dragon', tier: 4, names: ['magiczny smok', 'magic dragon'] },
  {
    kind: 'monster',
    race: 'beast',
    tier: 5,
    names: ['straszliwa mantykora', 'fearsome manticore', 'mantykora'],
  },
  { kind: 'monster', race: 'giant', tier: 5, names: ['ettin', 'etyn'] },
  {
    kind: 'monster',
    race: 'elemental',
    tier: 5,
    names: ['plomienny centaur', 'flaming centaur'],
  },
  {
    kind: 'monster',
    race: 'dragon',
    tier: 5,
    names: ['pustynny pogromca', 'desert vanquisher'],
  },
  {
    kind: 'monster',
    race: 'beast',
    tier: 6,
    names: ['niszczyciel dzungli', 'jungle destroyer'],
  },
  { kind: 'monster', race: 'giant', tier: 6, names: ['jezdiec na trollu', 'troll rider'] },
  { kind: 'monster', race: 'elemental', tier: 6, names: ['rubinowy golem', 'ruby golem'] },
  { kind: 'monster', race: 'dragon', tier: 6, names: ['krysztalowy smok', 'crystal dragon'] },
  { kind: 'monster', race: 'beast', tier: 7, names: ['starozytny terror', 'ancient terror'] },
  {
    kind: 'monster',
    race: 'giant',
    tier: 7,
    names: ['niszczycielski kolos', 'destructive colossus'],
  },
  { kind: 'monster', race: 'elemental', tier: 7, names: ['wladca wiatru', 'wind lord'] },
  { kind: 'monster', race: 'dragon', tier: 7, names: ['czarny smok', 'black dragon'] },
  { kind: 'monster', race: 'beast', tier: 8, names: ['trickster i', 'trickster'] },
  { kind: 'monster', race: 'giant', tier: 8, names: ['kraken i', 'kraken'] },
  {
    kind: 'monster',
    race: 'elemental',
    tier: 8,
    names: ['feniks ognia i', 'fire phoenix i'],
  },
  { kind: 'monster', race: 'dragon', tier: 8, names: ['devastator i', 'devastator'] },
  { kind: 'monster', race: 'beast', tier: 9, names: ['trickster ii'] },
  { kind: 'monster', race: 'giant', tier: 9, names: ['kraken ii'] },
  {
    kind: 'monster',
    race: 'elemental',
    tier: 9,
    names: ['feniks ognia ii', 'fire phoenix ii'],
  },
  { kind: 'monster', race: 'dragon', tier: 9, names: ['devastator ii'] },
];

for (let tier = MONSTER_MIN_TIER; tier <= MONSTER_MAX_TIER; tier++) {
  const row = MONSTER_NAMES[tier];
  if (!row) continue;
  for (const race of Object.keys(row) as MonsterRace[]) {
    CATALOG.push({
      kind: 'monster',
      race,
      tier,
      names: [norm(row[race])],
    });
  }
}

CATALOG.sort(
  (a, b) =>
    Math.max(...b.names.map((n) => n.length)) -
    Math.max(...a.names.map((n) => n.length)),
);

function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/ź|ż/g, 'z')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function unitKey(kind: TroopScanKind, type: ArmyType | undefined, race: MonsterRace | undefined, tier: number): string {
  return kind === 'guards' ? `g:${type}:${tier}` : `m:${race}:${tier}`;
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

/**
 * Tylko wartość stojąca przy „Masz:” (OCR często myli słowo — stąd warianty).
 * Bez gołych liczb — te dopuszczamy wyłącznie w kontekście zielonego przycisku.
 */
function parseMaszLabel(text: string): number | null {
  const cleaned = norm(text).replace(/[^\w.:]/g, ' ');
  const m = cleaned.match(
    /(?:masz|mazz|ma5z|mas2|nasz|hasz|rnasz|ivasz|i\s*asz)\s*[:.]?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)/,
  );
  return m ? parseCount(m[1]) : null;
}

function parseBareNumber(text: string): number | null {
  const cleaned = norm(text).replace(/[^\d.,]/g, ' ').trim();
  const m = cleaned.match(/(\d{1,3}(?:[.,]\d{3})+|\d{1,7})/);
  return m ? parseCount(m[1]) : null;
}

function parseRomanOrDigit(token: string): number | null {
  const t = token.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (ROMAN[t] != null) return ROMAN[t];
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (n >= 1 && n <= 9) return n;
  }
  if (t === '11' || t === 'll') return 2;
  return null;
}

function labelFor(hit: Omit<TroopScanHit, 'label'>): string {
  if (hit.kind === 'guards') {
    const name =
      hit.type === 'melee'
        ? 'Włócznik'
        : hit.type === 'ranged'
          ? 'Łucznik'
          : hit.type === 'mounted'
            ? 'Jeździec'
            : 'Gryf';
    return `${name} G${hit.tier}`;
  }
  const name = MONSTER_NAMES[hit.tier]?.[hit.race!] ?? hit.race ?? '?';
  return `${name} M${hit.tier}`;
}

function matchCatalogLine(
  line: string,
): { entry: CatalogEntry; tier: number } | null {
  const n = norm(line);
  if (!n || n.includes(',')) return null;
  if (
    /jednostka|piechota|gwardzista|olbrzym|odblokowane|zablokowane|wojska|gwardzisci|potwory|masz|odblokuj|ulepsz/.test(
      n,
    )
  ) {
    return null;
  }

  for (const entry of CATALOG) {
    for (const name of entry.names) {
      const needle = norm(name);
      if (needle.length < 3) continue;
      const idx = n.indexOf(needle);
      if (idx < 0) continue;

      let tier = entry.tier ?? null;
      if (tier == null) {
        const after = n.slice(idx + needle.length).trim();
        const m = after.match(/^(?:tier|poziom|g|m)?\s*([ivx]{1,4}|\d{1,2})\b/);
        if (m) tier = parseRomanOrDigit(m[1]);
        if (tier == null) {
          const any = n.match(/\b([ivx]{1,4}|[1-9])\b/);
          if (any) tier = parseRomanOrDigit(any[1]);
        }
      }
      if (tier == null) continue;

      if (entry.kind === 'guards') {
        const type = entry.type!;
        if (!isTypeAvailable(type, tier)) continue;
        if (type === 'flying' && tier < FLYING_MIN_TIER) continue;
        if (tier < 1 || tier > 9) continue;
      } else if (tier < MONSTER_MIN_TIER || tier > MONSTER_MAX_TIER) {
        continue;
      }

      return { entry, tier };
    }
  }
  return null;
}

interface Band {
  top: number;
  height: number;
  left: number;
  width: number;
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

/** Zielone przyciski „Masz: …” po prawej stronie listy. */
function findGreenBands(canvas: HTMLCanvasElement): Band[] {
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
      if (g > r + 8 && g > b + 5 && lum > 28 && lum < 170) green++;
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
    if (hh >= 14 && hh <= 80) {
      bands.push({ top: start, height: hh, left, width: rightW });
    } else if (hh > 80) {
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
  return bands.filter((b) => !(b.top < h * 0.04 && b.height > 28));
}

function bandToPng(canvas: HTMLCanvasElement, band: Band, lumThr: number): Blob {
  const padX = Math.round(band.width * 0.02);
  const padY = 6;
  const left = Math.max(0, band.left + padX);
  const top = Math.max(0, band.top - padY);
  const width = Math.min(canvas.width - left, band.width - padX * 2);
  const height = Math.min(canvas.height - top, band.height + padY * 2);
  const scale = 6;
  const sw = Math.max(1, Math.round(width * scale));
  const sh = Math.max(1, Math.round(height * scale));
  const crop = document.createElement('canvas');
  crop.width = sw;
  crop.height = sh;
  crop
    .getContext('2d')!
    .drawImage(canvas, left, top, width, height, 0, 0, sw, sh);
  const { data } = crop.getContext('2d')!.getImageData(0, 0, sw, sh);

  const margin = 32;
  const out = document.createElement('canvas');
  out.width = sw + margin * 2;
  out.height = sh + margin * 2;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  const img = ctx.createImageData(sw, sh);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // Prefer light text on green button → black on white
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

function namesRegionCanvas(canvas: HTMLCanvasElement): {
  canvas: HTMLCanvasElement;
  scale: number;
  widthSrc: number;
} {
  const widthSrc = Math.round(canvas.width * 0.62);
  const scale = 2.4;
  const out = document.createElement('canvas');
  out.width = Math.round(widthSrc * scale);
  out.height = Math.round(canvas.height * scale);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0, widthSrc, canvas.height, 0, 0, out.width, out.height);
  const { data } = ctx.getImageData(0, 0, out.width, out.height);
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const v = Math.max(0, Math.min(255, (lum - 35) * 1.4));
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  ctx.putImageData(new ImageData(data, out.width, out.height), 0, 0);
  return { canvas: out, scale, widthSrc };
}

let workerPromise: Promise<Worker> | null = null;
let templatesPromise: Promise<IconTemplate[]> | null = null;

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

const SIG_GRID = 12;
const SIG_HUE_BINS = 12;
const SIG_EDGE_ZONES = 3;
const SIG_EDGE_ORI = 4;
const SIG_PALETTE = 10;

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

function vecL2(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s / a.length);
}

function normalizeHist(h: Float32Array): void {
  let sum = 0;
  for (let i = 0; i < h.length; i++) sum += h[i];
  if (sum <= 1e-9) return;
  for (let i = 0; i < h.length; i++) h[i] /= sum;
}

/** Buduje podpis: kolory przestrzenne, hue, krawędzie, paleta charakterystyczna. */
function buildSignature(img: ImageData): IconSignature {
  const { width: w, height: h, data } = img;
  const grid = new Float32Array(SIG_GRID * SIG_GRID * 3);
  const hue = new Float32Array(SIG_HUE_BINS);
  const edges = new Float32Array(SIG_EDGE_ZONES * SIG_EDGE_ZONES * SIG_EDGE_ORI);
  const palette = new Float32Array(SIG_PALETTE);

  const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      if (a < 40) {
        lum[y * w + x] = -1;
        continue;
      }
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      lum[y * w + x] = 0.299 * r + 0.587 * g + 0.114 * b;

      const { h: hh, s, v } = rgbToHsv(r, g, b);
      if (s > 0.18 && v > 0.12 && v < 0.95) {
        hue[Math.min(SIG_HUE_BINS - 1, Math.floor(hh * SIG_HUE_BINS))] += 1;
      }

      // Paleta charakterystyczna (punkty barwne jednostek TB)
      if (s > 0.22 && v > 0.15) {
        const deg = hh * 360;
        if (deg < 15 || deg >= 345) palette[0] += 1; // red (peleryna)
        else if (deg < 40) palette[1] += 1; // orange (pióra / gryf)
        else if (deg < 65) palette[2] += 1; // gold / yellow (ramka)
        else if (deg < 150) palette[3] += 1; // green
        else if (deg < 195) palette[4] += 1; // cyan (łucznik)
        else if (deg < 255) palette[5] += 1; // blue (wstęga potworów)
        else if (deg < 310) palette[6] += 1; // purple
        else palette[0] += 0.5;
      }
      // brown (koń, futro)
      if (s > 0.2 && v > 0.12 && v < 0.65) {
        const deg = hh * 360;
        if (deg >= 15 && deg < 50) palette[7] += 1;
      }
      // metal / silver armor
      if (s < 0.18 && v > 0.45 && v < 0.92) palette[8] += 1;
      // skin
      if (s > 0.15 && s < 0.55 && v > 0.35 && v < 0.9) {
        const deg = hh * 360;
        if (deg >= 10 && deg < 45) palette[9] += 1;
      }
    }
  }
  normalizeHist(hue);
  normalizeHist(palette);

  const cellW = w / SIG_GRID;
  const cellH = h / SIG_GRID;
  const cx = (SIG_GRID - 1) / 2;
  const cy = (SIG_GRID - 1) / 2;
  for (let gy = 0; gy < SIG_GRID; gy++) {
    for (let gx = 0; gx < SIG_GRID; gx++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      const x0 = Math.floor(gx * cellW);
      const y0 = Math.floor(gy * cellH);
      const x1 = Math.floor((gx + 1) * cellW);
      const y1 = Math.floor((gy + 1) * cellH);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (lum[y * w + x] < 0) continue;
          const i = (y * w + x) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
        }
      }
      const o = (gy * SIG_GRID + gx) * 3;
      const dist = Math.hypot(gx - cx, gy - cy);
      const wgt = 1.15 - Math.min(0.55, dist / (SIG_GRID * 0.75));
      grid[o] = (n ? r / n / 255 : 0) * wgt;
      grid[o + 1] = (n ? g / n / 255 : 0) * wgt;
      grid[o + 2] = (n ? b / n / 255 : 0) * wgt;
    }
  }

  // Sobel + histogram orientacji w strefach (włócznia vs łuk vs skrzydła)
  const zoneW = w / SIG_EDGE_ZONES;
  const zoneH = h / SIG_EDGE_ZONES;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = lum[y * w + x];
      if (c < 0) continue;
      const l = lum[y * w + (x - 1)];
      const r = lum[y * w + (x + 1)];
      const u = lum[(y - 1) * w + x];
      const d = lum[(y + 1) * w + x];
      if (l < 0 || r < 0 || u < 0 || d < 0) continue;
      const gx = r - l;
      const gy = d - u;
      const mag = Math.hypot(gx, gy);
      if (mag < 18) continue;
      const ang = (Math.atan2(gy, gx) + Math.PI) / (2 * Math.PI); // 0..1
      const ori = Math.min(SIG_EDGE_ORI - 1, Math.floor(ang * SIG_EDGE_ORI));
      const zx = Math.min(SIG_EDGE_ZONES - 1, Math.floor(x / zoneW));
      const zy = Math.min(SIG_EDGE_ZONES - 1, Math.floor(y / zoneH));
      edges[(zy * SIG_EDGE_ZONES + zx) * SIG_EDGE_ORI + ori] += mag;
    }
  }
  normalizeHist(edges);

  return { grid, hue, edges, palette };
}

function signatureDistance(a: IconSignature, b: IconSignature): number {
  // Paleta i hue mocniej — peleryna / zbroja / futro / złota ramka
  return (
    0.28 * vecL2(a.grid, b.grid) +
    0.27 * vecL2(a.hue, b.hue) +
    0.2 * vecL2(a.edges, b.edges) +
    0.25 * vecL2(a.palette, b.palette)
  );
}

function imageDataFromCanvasRegion(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  size: number,
): ImageData {
  const box = document.createElement('canvas');
  box.width = 64;
  box.height = 64;
  const ctx = box.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 64);
  ctx.drawImage(canvas, x, y, size, size, 0, 0, 64, 64);
  return ctx.getImageData(0, 0, 64, 64);
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

async function loadIconTemplates(): Promise<IconTemplate[]> {
  if (!templatesPromise) {
    templatesPromise = (async () => {
      const jobs: {
        kind: TroopScanKind;
        type?: ArmyType;
        race?: MonsterRace;
        tier: number;
        url: string;
      }[] = [];
      for (let tier = 1; tier <= Math.max(GUARDS_MAX_TIER, 7); tier++) {
        for (const type of ARMY_TYPES) {
          if (!isTypeAvailable(type, tier)) continue;
          jobs.push({
            kind: 'guards',
            type,
            tier,
            url: guardsTierIcon(type, tier),
          });
        }
      }
      for (let tier = MONSTER_MIN_TIER; tier <= MONSTER_MAX_TIER; tier++) {
        for (const race of MONSTER_RACES) {
          jobs.push({
            kind: 'monster',
            race,
            tier,
            url: monsterTierIcon(race, tier),
          });
        }
      }

      const out: IconTemplate[] = [];
      const box = document.createElement('canvas');
      box.width = 64;
      box.height = 64;
      const ctx = box.getContext('2d', { willReadFrequently: true })!;
      for (const job of jobs) {
        const img = await loadImage(job.url);
        if (!img) continue;
        ctx.clearRect(0, 0, 64, 64);
        ctx.drawImage(img, 0, 0, 64, 64);
        out.push({
          kind: job.kind,
          type: job.type,
          race: job.race,
          tier: job.tier,
          sig: buildSignature(ctx.getImageData(0, 0, 64, 64)),
        });
      }
      return out;
    })();
  }
  return templatesPromise;
}

/** Portrety po lewej — wszystkie piki + podpis charakterystyczny. */
function findIconPeaks(
  canvas: HTMLCanvasElement,
  templates: IconTemplate[],
): IconPeak[] {
  const w = canvas.width;
  const h = canvas.height;
  const colW = Math.round(w * 0.26);
  const baseSize = Math.max(32, Math.round(Math.min(w, h) * 0.055));
  const sizes = [
    Math.round(baseSize * 0.8),
    baseSize,
    Math.round(baseSize * 1.15),
    Math.round(baseSize * 1.35),
  ];
  const cands: IconPeak[] = [];

  for (const iconSize of sizes) {
    const stepY = Math.max(5, Math.round(iconSize * 0.25));
    const stepX = Math.max(5, Math.round(iconSize * 0.3));
    for (let y = Math.round(h * 0.02); y < h - iconSize; y += stepY) {
      let bestLocal: IconPeak | null = null;
      for (let x = Math.round(w * 0.004); x < colW - iconSize; x += stepX) {
        const patch = imageDataFromCanvasRegion(canvas, x, y, iconSize);
        let sum = 0;
        let sum2 = 0;
        let n = 0;
        for (let i = 0; i < patch.data.length; i += 16) {
          if (patch.data[i + 3] < 40) continue;
          const lum =
            0.299 * patch.data[i] +
            0.587 * patch.data[i + 1] +
            0.114 * patch.data[i + 2];
          sum += lum;
          sum2 += lum * lum;
          n++;
        }
        if (n < 20) continue;
        const mean = sum / n;
        const variance = sum2 / n - mean * mean;
        if (variance < 160) continue;

        const sig = buildSignature(patch);
        // Preferuj obszary podobne do którejś ikony z katalogu
        let bestTpl = Infinity;
        for (const t of templates) {
          const d = signatureDistance(sig, t.sig);
          if (d < bestTpl) bestTpl = d;
        }
        const score = variance * (1.35 - Math.min(1.1, bestTpl * 3.2));
        if (!bestLocal || score > bestLocal.score) {
          bestLocal = {
            y: y + iconSize / 2,
            x,
            size: iconSize,
            sig,
            score,
          };
        }
      }
      if (bestLocal) cands.push(bestLocal);
    }
  }

  cands.sort((a, b) => a.y - b.y || b.score - a.score);
  const peaks: IconPeak[] = [];
  const minGap = Math.max(26, Math.round(baseSize * 0.5));
  for (const c of cands) {
    const last = peaks[peaks.length - 1];
    if (!last || c.y - last.y >= minGap) peaks.push(c);
    else if (c.score > last.score) peaks[peaks.length - 1] = c;
  }
  return peaks;
}

function matchIconTemplate(
  sig: IconSignature,
  templates: IconTemplate[],
): { unit: IdentifiedUnit; dist: number } | null {
  let best: IconTemplate | null = null;
  let bestDist = Infinity;
  let second = Infinity;
  for (const t of templates) {
    const d = signatureDistance(sig, t.sig);
    if (d < bestDist) {
      second = bestDist;
      bestDist = d;
      best = t;
    } else if (d < second) {
      second = d;
    }
  }
  if (!best) return null;
  // Wyraźny zwycięzca po punktach charakterystycznych (paleta/krawędzie)
  const margin = second === Infinity ? 1 : second - bestDist;
  const ok =
    bestDist <= 0.22 ||
    (bestDist <= 0.28 && margin >= 0.012) ||
    (bestDist <= 0.32 && margin >= 0.025 && bestDist < second * 0.9);
  if (!ok) return null;
  return {
    unit: {
      kind: best.kind,
      type: best.type,
      race: best.race,
      tier: best.tier,
    },
    dist: bestDist,
  };
}

async function ocrBandCount(
  w: Worker,
  canvas: HTMLCanvasElement,
  band: Band,
): Promise<number | null> {
  for (const lum of [120, 140, 160, 175, 190, 205]) {
    const blob = bandToPng(canvas, band, lum);
    for (const psm of [PSM.SINGLE_LINE, PSM.SINGLE_WORD]) {
      await w.setParameters({
        tessedit_pageseg_mode: psm,
        tessedit_char_whitelist: 'MaszHASZm:.0123456789',
        user_defined_dpi: '300',
      });
      const { data } = await w.recognize(blob);
      const text = data.text ?? '';
      const labeled = parseMaszLabel(text);
      if (labeled != null) return labeled;
      const bare = parseBareNumber(text);
      if (bare != null) return bare;
    }
  }
  return null;
}

function nameStripBlob(canvas: HTMLCanvasElement, yCenter: number, rowH: number): Blob {
  const w = canvas.width;
  const h = canvas.height;
  const stripH = Math.max(28, Math.round(rowH * 1.15));
  const top = Math.max(0, Math.round(yCenter - stripH / 2));
  const height = Math.min(h - top, stripH);
  const left = Math.round(w * 0.12);
  const width = Math.round(w * 0.5);
  const scale = 3;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(width * scale));
  out.height = Math.max(1, Math.round(height * scale));
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, left, top, width, height, 0, 0, out.width, out.height);
  const { data } = ctx.getImageData(0, 0, out.width, out.height);
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const v = lum > 145 ? 255 : lum < 90 ? 0 : Math.round((lum - 90) * 4.6);
    data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, v));
  }
  ctx.putImageData(new ImageData(data, out.width, out.height), 0, 0);
  const bin = atob(out.toDataURL('image/png').split(',')[1] ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

async function ocrNameStrip(
  w: Worker,
  canvas: HTMLCanvasElement,
  yCenter: number,
  rowH: number,
): Promise<string> {
  const blob = nameStripBlob(canvas, yCenter, rowH);
  await w.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    tessedit_char_whitelist: '',
    user_defined_dpi: '300',
  });
  const a = (await w.recognize(blob)).data.text ?? '';
  await w.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    tessedit_char_whitelist: '',
    user_defined_dpi: '300',
  });
  const b = (await w.recognize(blob)).data.text ?? '';
  return `${a}\n${b}`;
}

async function extractNameHints(
  w: Worker,
  canvas: HTMLCanvasElement,
): Promise<{ y: number; text: string; unit: IdentifiedUnit | null }[]> {
  const region = namesRegionCanvas(canvas);
  const hints: { y: number; text: string; unit: IdentifiedUnit | null }[] = [];

  for (const psm of [PSM.SPARSE_TEXT, PSM.SINGLE_BLOCK, PSM.AUTO]) {
    await w.setParameters({
      tessedit_pageseg_mode: psm,
      tessedit_char_whitelist: '',
      user_defined_dpi: '300',
    });
    const { data } = await w.recognize(region.canvas);
    const lines =
      (
        data as {
          lines?: {
            text: string;
            bbox: { x0: number; y0: number; x1: number; y1: number };
          }[];
        }
      ).lines ?? [];

    if (lines.length) {
      for (const line of lines) {
        const text = (line.text ?? '').trim();
        if (!text) continue;
        const yMid = (line.bbox.y0 + line.bbox.y1) / 2 / region.scale;
        const hit = matchCatalogLine(text);
        hints.push({
          y: yMid,
          text,
          unit: hit
            ? {
                kind: hit.entry.kind,
                type: hit.entry.type,
                race: hit.entry.race,
                tier: hit.tier,
              }
            : null,
        });
      }
    } else {
      const parts = (data.text ?? '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      parts.forEach((text, i) => {
        const hit = matchCatalogLine(text);
        hints.push({
          y: ((i + 0.5) / Math.max(parts.length, 1)) * canvas.height,
          text,
          unit: hit
            ? {
                kind: hit.entry.kind,
                type: hit.entry.type,
                race: hit.entry.race,
                tier: hit.tier,
              }
            : null,
        });
      });
    }
  }
  return hints;
}

function mergeSlotsByY(
  masz: MaszEntry[],
  peaks: IconPeak[],
  nameHints: { y: number; text: string; unit: IdentifiedUnit | null }[],
  joinDist: number,
): RawSlot[] {
  const slots: RawSlot[] = [];

  const upsert = (y: number): RawSlot => {
    let best: RawSlot | null = null;
    let bestD = Infinity;
    for (const s of slots) {
      const d = Math.abs(s.y - y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best && bestD <= joinDist) {
      best.y = (best.y + y) / 2;
      return best;
    }
    const created: RawSlot = {
      y,
      hasMasz: false,
      maszCount: null,
      nameHints: [],
    };
    slots.push(created);
    return created;
  };

  for (const m of masz) {
    const s = upsert(m.y);
    s.hasMasz = true;
    s.maszCount = m.count;
  }
  for (const p of peaks) {
    const s = upsert(p.y);
    if (!s.peak || p.score > s.peak.score) s.peak = p;
  }
  for (const h of nameHints) {
    const s = upsert(h.y);
    if (h.text) s.nameHints.push(h.text);
  }

  return slots.sort((a, b) => a.y - b.y);
}

function identifyFromTexts(texts: string[]): IdentifiedUnit | null {
  // Najpierw pełne linie, potem sklejone sąsiednie fragmenty
  for (const t of texts) {
    const hit = matchCatalogLine(t);
    if (hit) {
      return {
        kind: hit.entry.kind,
        type: hit.entry.type,
        race: hit.entry.race,
        tier: hit.tier,
      };
    }
  }
  if (texts.length >= 2) {
    const joined = texts.join(' ');
    const hit = matchCatalogLine(joined);
    if (hit) {
      return {
        kind: hit.entry.kind,
        type: hit.entry.type,
        race: hit.entry.race,
        tier: hit.tier,
      };
    }
  }
  return null;
}

function identifySlot(
  slot: RawSlot,
  templates: IconTemplate[],
  stripText: string,
): IdentifiedUnit | null {
  const fromStrip = identifyFromTexts([stripText, ...slot.nameHints]);
  const fromIcon = slot.peak ? matchIconTemplate(slot.peak.sig, templates) : null;

  if (fromStrip && fromIcon) {
    const same =
      fromStrip.kind === fromIcon.unit.kind &&
      fromStrip.tier === fromIcon.unit.tier &&
      (fromStrip.kind === 'guards'
        ? fromStrip.type === fromIcon.unit.type
        : fromStrip.race === fromIcon.unit.race);
    if (same) return fromStrip;
    // Mocne dopasowanie punktów charakterystycznych ikony wygrywa z OCR
    if (fromIcon.dist <= 0.14) return fromIcon.unit;
    // Zgodność typu/rasy — weź tier z ikony gdy OCR zgubi cyfrę rzymską
    if (
      fromStrip.kind === fromIcon.unit.kind &&
      (fromStrip.kind === 'guards'
        ? fromStrip.type === fromIcon.unit.type
        : fromStrip.race === fromIcon.unit.race)
    ) {
      return fromIcon.dist <= 0.24 ? fromIcon.unit : fromStrip;
    }
    return fromStrip;
  }
  return fromStrip ?? fromIcon?.unit ?? null;
}

/** Merge hits from several screenshots; later file wins on the same unit. */
export function mergeTroopHits(groups: TroopScanHit[][]): TroopScanHit[] {
  const map = new Map<string, TroopScanHit>();
  for (const group of groups) {
    for (const hit of group) {
      const key = unitKey(hit.kind, hit.type, hit.race, hit.tier);
      map.set(key, hit);
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'guards' ? -1 : 1;
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Czyta listę wojsk / potworów ze screenshotu Total Battle.
 * Najpierw zbiera WSZYSTKIE pozycje (Masz + ikony + nazwy), potem identyfikuje.
 * Ilość z „Masz: N”; brak przycisku przy pozycji = 0.
 */
export async function scanTroopScreenshot(
  file: Blob,
  onProgress?: (p: number) => void,
): Promise<TroopScanHit[]> {
  onProgress?.(0.03);
  const canvas = await fileToCanvas(file);
  const w = await worker();
  const templates = await loadIconTemplates();
  onProgress?.(0.1);

  const bands = findGreenBands(canvas);
  const masz: MaszEntry[] = [];
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    const count = await ocrBandCount(w, canvas, band);
    masz.push({
      y: band.top + band.height / 2,
      top: band.top,
      height: band.height,
      count,
    });
    onProgress?.(0.1 + (0.35 * (i + 1)) / Math.max(bands.length, 1));
  }

  const peaks = findIconPeaks(canvas, templates);
  onProgress?.(0.5);

  const nameHints = await extractNameHints(w, canvas);
  onProgress?.(0.62);

  const bandH = masz.length
    ? masz.reduce((s, m) => s + m.height, 0) / masz.length
    : Math.max(40, canvas.height * 0.06);
  const joinDist = Math.max(bandH * 0.85, canvas.height * 0.028);
  const slots = mergeSlotsByY(masz, peaks, nameHints, joinDist);

  const hits: TroopScanHit[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const strip = await ocrNameStrip(w, canvas, slot.y, bandH);
    const unit = identifySlot(slot, templates, strip);
    onProgress?.(0.62 + (0.35 * (i + 1)) / Math.max(slots.length, 1));
    if (!unit) continue;

    const key = unitKey(unit.kind, unit.type, unit.race, unit.tier);
    // Przy duplikacie ID zostaw wpis z Masz (albo pierwszy)
    if (seen.has(key)) {
      const prev = hits.find(
        (h) => unitKey(h.kind, h.type, h.race, h.tier) === key,
      );
      if (prev && !slot.hasMasz) continue;
      if (prev && slot.hasMasz) {
        prev.count = slot.maszCount ?? 0;
      }
      continue;
    }
    seen.add(key);

    const count = slot.hasMasz ? (slot.maszCount ?? 0) : 0;
    const base: Omit<TroopScanHit, 'label'> = {
      kind: unit.kind,
      type: unit.type,
      race: unit.race,
      tier: unit.tier,
      count,
    };
    hits.push({ ...base, label: labelFor(base) });
  }

  onProgress?.(1);
  return hits;
}

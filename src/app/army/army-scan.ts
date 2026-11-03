import { createWorker, PSM, type Worker } from 'tesseract.js';
import { type ArmyType, FLYING_MIN_TIER, isTypeAvailable } from './army.data';
import {
  MONSTER_MAX_TIER,
  MONSTER_MIN_TIER,
  MONSTER_NAMES,
  type MonsterRace,
} from './monsters.data';

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
  // Epic guards
  { kind: 'guards', type: 'melee', tier: 9, names: ['punisher ii', 'kariciel ii'] },
  { kind: 'guards', type: 'melee', tier: 8, names: ['punisher i', 'kariciel i', 'punisher'] },
  { kind: 'guards', type: 'ranged', tier: 9, names: ['purifier ii', 'oczyszcziciel ii'] },
  { kind: 'guards', type: 'ranged', tier: 8, names: ['purifier i', 'oczyszcziciel i', 'purifier'] },
  { kind: 'guards', type: 'mounted', tier: 9, names: ['smiter ii', 'pogromca ii'] },
  { kind: 'guards', type: 'mounted', tier: 8, names: ['smiter i', 'pogromca i', 'smiter'] },
  { kind: 'guards', type: 'flying', tier: 9, names: ['corax ii'] },
  { kind: 'guards', type: 'flying', tier: 8, names: ['corax i', 'corax'] },
  // Regular guards
  {
    kind: 'guards',
    type: 'melee',
    names: ['ciezki halabardnik', 'halabardnik', 'spearman', 'wlocznik'],
  },
  {
    kind: 'guards',
    type: 'ranged',
    names: ['ciezki kusznik', 'arbalester', 'kusznik', 'archer', 'lucznik'],
  },
  {
    kind: 'guards',
    type: 'mounted',
    names: ['rycerz konny', 'rider', 'jezdziec'],
  },
  {
    kind: 'guards',
    type: 'flying',
    names: ['gryf bitewny', 'battle griffin', 'griffin', 'gryf'],
  },
  // Monsters PL/EN
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

// Add English wiki names as extras
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
  const cleaned = norm(text).replace(/[^\w.:]/g, ' ');
  const m = cleaned.match(
    /(?:masz|mazz|asz|hasz|nasz)\s*[:.]?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)/,
  );
  if (m) return parseCount(m[1]);
  const bare = cleaned.match(/\b(\d{1,3}(?:[.,]\d{3})+|\d{1,7})\b/);
  return bare ? parseCount(bare[1]) : null;
}

function parseRomanOrDigit(token: string): number | null {
  const t = token.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (ROMAN[t] != null) return ROMAN[t];
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (n >= 1 && n <= 9) return n;
  }
  // OCR often reads II as 11
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
): { entry: CatalogEntry; matched: string; tier: number } | null {
  const n = norm(line);
  if (!n || n.includes(',')) return null;
  if (
    /jednostka|piechota|gwardzista|olbrzym|odblokowane|zablokowane|wojska|gwardzisci|potwory|masz/.test(
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

      return { entry, matched: name, tier };
    }
  }
  return null;
}

/** Ordered unit identities from OCR name text. */
function extractUnits(text: string): { entry: CatalogEntry; tier: number; line: string }[] {
  const seen = new Set<string>();
  const out: { entry: CatalogEntry; tier: number; line: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const hit = matchCatalogLine(trimmed);
    if (!hit) continue;
    const key =
      hit.entry.kind === 'guards'
        ? `g:${hit.entry.type}:${hit.tier}`
        : `m:${hit.entry.race}:${hit.tier}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ entry: hit.entry, tier: hit.tier, line: trimmed });
  }
  return out;
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

function findGreenBands(canvas: HTMLCanvasElement): Band[] {
  const w = canvas.width;
  const h = canvas.height;
  const rightW = Math.round(w * 0.38);
  const left = w - rightW;
  const { data } = canvas.getContext('2d')!.getImageData(left, 0, rightW, h);

  const score = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let green = 0;
    for (let x = Math.round(rightW * 0.1); x < rightW; x++) {
      const i = (y * rightW + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (g > r + 10 && g > b + 6 && lum > 30 && lum < 155) green++;
    }
    score[y] = green / (rightW * 0.9);
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

  const thr = 0.32;
  const bands: Band[] = [];
  let y = 0;
  while (y < h) {
    while (y < h && smooth[y] < thr) y++;
    if (y >= h) break;
    const start = y;
    while (y < h && smooth[y] >= thr * 0.65) y++;
    const end = y;
    const hh = end - start;
    if (hh >= 16 && hh <= 70) {
      bands.push({ top: start, height: hh, left, width: rightW });
    } else if (hh > 70) {
      for (let t = start; t < end - 12; ) {
        let bestY = t;
        let best = -1;
        const win = Math.min(48, end - t);
        for (let yy = t; yy < t + win; yy++) {
          if (smooth[yy] > best) {
            best = smooth[yy];
            bestY = yy;
          }
        }
        if (best >= thr * 0.7) {
          const top = Math.max(start, bestY - 12);
          const bottom = Math.min(end, bestY + 14);
          bands.push({ top, height: bottom - top, left, width: rightW });
          t = bottom + 8;
        } else {
          t += 20;
        }
      }
    }
  }
  // Drop coin chip near the header
  return bands.filter((b) => !(b.top < 100 && b.height > 30));
}

function bandToPng(canvas: HTMLCanvasElement, band: Band, lumThr: number): Blob {
  const pad = 8;
  const top = Math.max(0, band.top - pad);
  const height = Math.min(canvas.height - top, band.height + pad * 2);
  const scale = 5;
  const sw = band.width * scale;
  const sh = height * scale;
  const crop = document.createElement('canvas');
  crop.width = sw;
  crop.height = sh;
  crop
    .getContext('2d')!
    .drawImage(canvas, band.left, top, band.width, height, 0, 0, sw, sh);
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

function namesRegionPng(canvas: HTMLCanvasElement): Blob {
  const w = Math.round(canvas.width * 0.7);
  const scale = 2.2;
  const out = document.createElement('canvas');
  out.width = Math.round(w * scale);
  out.height = Math.round(canvas.height * scale);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0, w, canvas.height, 0, 0, out.width, out.height);
  const { data } = ctx.getImageData(0, 0, out.width, out.height);
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const v = Math.max(0, Math.min(255, (lum - 40) * 1.35));
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  ctx.putImageData(new ImageData(data, out.width, out.height), 0, 0);
  const bin = atob(out.toDataURL('image/png').split(',')[1] ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

let workerPromise: Promise<Worker> | null = null;

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

async function ocrBandCount(w: Worker, canvas: HTMLCanvasElement, band: Band): Promise<number | null> {
  for (const lum of [145, 160, 175, 190]) {
    const blob = bandToPng(canvas, band, lum);
    for (const psm of [PSM.SINGLE_LINE, PSM.SINGLE_WORD]) {
      await w.setParameters({
        tessedit_pageseg_mode: psm,
        tessedit_char_whitelist: 'Masz:.0123456789',
        user_defined_dpi: '300',
      });
      const { data } = await w.recognize(blob);
      const n = parseMasz(data.text ?? '');
      if (n != null) return n;
    }
  }
  return null;
}

function zipUnitsAndCounts(
  units: { entry: CatalogEntry; tier: number }[],
  counts: number[],
  gapBeforeLast: boolean,
): TroopScanHit[] {
  let list = units;
  if (units.length === counts.length + 1) {
    const drop = gapBeforeLast
      ? Math.max(0, counts.length - 1)
      : units.length - 1;
    list = units.filter((_, i) => i !== drop);
  }
  const hits: TroopScanHit[] = [];
  const n = Math.min(list.length, counts.length);
  for (let i = 0; i < n; i++) {
    const u = list[i];
    const base: Omit<TroopScanHit, 'label'> = {
      kind: u.entry.kind,
      type: u.entry.type,
      race: u.entry.race,
      tier: u.tier,
      count: counts[i],
    };
    hits.push({ ...base, label: labelFor(base) });
  }
  return hits;
}

/** Merge hits from several screenshots; later file wins on the same unit. */
export function mergeTroopHits(groups: TroopScanHit[][]): TroopScanHit[] {
  const map = new Map<string, TroopScanHit>();
  for (const group of groups) {
    for (const hit of group) {
      const key =
        hit.kind === 'guards'
          ? `g:${hit.type}:${hit.tier}`
          : `m:${hit.race}:${hit.tier}`;
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
 * Read troop / monster counts from a Total Battle barracks screenshot
 * (green „Masz: …” buttons + unit names on the left).
 */
export async function scanTroopScreenshot(
  file: Blob,
  onProgress?: (p: number) => void,
): Promise<TroopScanHit[]> {
  onProgress?.(0.05);
  const canvas = await fileToCanvas(file);
  const w = await worker();
  onProgress?.(0.15);

  const bands = findGreenBands(canvas);
  const counts: number[] = [];
  for (let i = 0; i < bands.length; i++) {
    const n = await ocrBandCount(w, canvas, bands[i]);
    if (n != null) counts.push(n);
    onProgress?.(0.15 + (0.55 * (i + 1)) / Math.max(bands.length, 1));
  }

  await w.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    tessedit_char_whitelist: '',
    user_defined_dpi: '300',
  });
  const namesBlob = namesRegionPng(canvas);
  const namesText = (await w.recognize(namesBlob)).data.text ?? '';
  onProgress?.(0.9);

  const units = extractUnits(namesText);
  const last = bands[bands.length - 1];
  const gapBeforeLast = !!(last && last.top + last.height > canvas.height * 0.88);
  const hits = zipUnitsAndCounts(units, counts, gapBeforeLast);
  onProgress?.(1);
  return hits;
}

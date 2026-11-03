import { createWorker, type Worker } from 'tesseract.js';
import { type ArmyType, FLYING_MIN_TIER, isTypeAvailable } from './army.data';
import {
  MONSTER_MAX_TIER,
  MONSTER_MIN_TIER,
  MONSTER_NAMES,
  type MonsterRace,
} from './monsters.data';

export type ScanHitKind = 'guards' | 'monster';

export interface ScanHit {
  kind: ScanHitKind;
  type?: ArmyType;
  race?: MonsterRace;
  tier: number;
  count: number;
  label: string;
  raw: string;
}

export interface ScanFileResult {
  id: string;
  fileName: string;
  previewUrl: string;
  status: 'pending' | 'scanning' | 'done' | 'error';
  progress: number;
  text: string;
  hits: ScanHit[];
  error?: string;
}

interface UnitAlias {
  kind: ScanHitKind;
  type?: ArmyType;
  race?: MonsterRace;
  /** Fixed tier when name encodes it (e.g. Punisher I → G8). */
  tier?: number;
  aliases: string[];
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

const GUARD_ALIASES: UnitAlias[] = [
  {
    kind: 'guards',
    type: 'melee',
    tier: 9,
    aliases: ['punisher ii', 'kariciel ii'],
  },
  {
    kind: 'guards',
    type: 'melee',
    tier: 8,
    aliases: ['punisher i', 'kariciel i', 'punisher'],
  },
  {
    kind: 'guards',
    type: 'ranged',
    tier: 9,
    aliases: ['purifier ii', 'oczyszcziciel ii'],
  },
  {
    kind: 'guards',
    type: 'ranged',
    tier: 8,
    aliases: ['purifier i', 'oczyszcziciel i', 'purifier'],
  },
  {
    kind: 'guards',
    type: 'mounted',
    tier: 9,
    aliases: ['smiter ii', 'pogromca ii'],
  },
  {
    kind: 'guards',
    type: 'mounted',
    tier: 8,
    aliases: ['smiter i', 'pogromca i', 'smiter'],
  },
  {
    kind: 'guards',
    type: 'flying',
    tier: 9,
    aliases: ['corax ii'],
  },
  {
    kind: 'guards',
    type: 'flying',
    tier: 8,
    aliases: ['corax i', 'corax'],
  },
  {
    kind: 'guards',
    type: 'melee',
    aliases: [
      'heavy halberdier',
      'ciezki halabardnik',
      'halabardnik',
      'spearman',
      'spearmen',
      'wlocznik',
      'wlocznicy',
    ],
  },
  {
    kind: 'guards',
    type: 'ranged',
    aliases: [
      'heavy arbalester',
      'ciezki kusznik',
      'arbalester',
      'kusznik',
      'archer',
      'archers',
      'lucznik',
      'lucznicy',
    ],
  },
  {
    kind: 'guards',
    type: 'mounted',
    aliases: [
      'mounted knight',
      'rycerz konny',
      'rider',
      'riders',
      'jezdziec',
      'jezdzcy',
    ],
  },
  {
    kind: 'guards',
    type: 'flying',
    aliases: [
      'battle griffin',
      'gryf bitewny',
      'griffin',
      'griffins',
      'gryfy',
      'gryf',
    ],
  },
];

function stripDiacritics(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0 || n > 50_000_000) return null;
  return n;
}

function parseTierToken(token: string): number | null {
  const t = token.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!t) return null;
  if (ROMAN[t] != null) return ROMAN[t];
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (n >= 1 && n <= 9) return n;
  }
  return null;
}

function buildMonsterAliases(): UnitAlias[] {
  const out: UnitAlias[] = [];
  for (let tier = MONSTER_MIN_TIER; tier <= MONSTER_MAX_TIER; tier++) {
    const row = MONSTER_NAMES[tier];
    if (!row) continue;
    for (const race of Object.keys(row) as MonsterRace[]) {
      out.push({
        kind: 'monster',
        race,
        tier,
        aliases: [stripDiacritics(row[race])],
      });
    }
  }
  out.push(
    { kind: 'monster', race: 'dragon', aliases: ['smok', 'dragon'] },
    { kind: 'monster', race: 'beast', aliases: ['bestia', 'beast'] },
    { kind: 'monster', race: 'giant', aliases: ['olbrzym', 'gigant', 'giant'] },
    {
      kind: 'monster',
      race: 'elemental',
      aliases: ['zywiolak', 'elemental'],
    },
  );
  return out;
}

function byAliasLength(a: UnitAlias, b: UnitAlias): number {
  return (
    Math.max(...b.aliases.map((x) => x.length)) -
    Math.max(...a.aliases.map((x) => x.length))
  );
}

const ALL_ALIASES: UnitAlias[] = [
  ...GUARD_ALIASES.sort(byAliasLength),
  ...buildMonsterAliases().sort(byAliasLength),
];

function findAliases(
  line: string,
): { alias: UnitAlias; matched: string; index: number }[] {
  const norm = stripDiacritics(line);
  const found: { alias: UnitAlias; matched: string; index: number }[] = [];
  const claimed = new Set<string>();

  for (const unit of ALL_ALIASES) {
    for (const a of unit.aliases) {
      const needle = stripDiacritics(a);
      if (needle.length < 3) continue;
      const index = norm.indexOf(needle);
      if (index < 0) continue;
      const span = `${index}:${index + needle.length}`;
      // Skip if this span overlaps a longer match already claimed
      let overlap = false;
      for (const c of claimed) {
        const [cs, ce] = c.split(':').map(Number);
        if (index < ce && index + needle.length > cs) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;
      claimed.add(span);
      found.push({ alias: unit, matched: a, index });
      break;
    }
  }
  return found;
}

function extractTier(
  line: string,
  alias: UnitAlias,
  matched: string,
): number | null {
  if (alias.tier != null) return alias.tier;

  const norm = stripDiacritics(line);
  const needle = stripDiacritics(matched);
  const idx = norm.indexOf(needle);
  const after = idx >= 0 ? norm.slice(idx + needle.length).trim() : norm;

  const afterMatch = after.match(
    /^(?:tier|poziom|lvl|level|g|m)?\s*([ivx]{1,4}|\d)\b/i,
  );
  if (afterMatch) {
    const t = parseTierToken(afterMatch[1]);
    if (t != null) return t;
  }

  const anywhere = norm.match(/\b(?:g|m)?\s*([ivx]{1,4}|[1-9])\b/i);
  if (anywhere) {
    const t = parseTierToken(anywhere[1]);
    if (t != null) return t;
  }

  return null;
}

function extractCount(line: string, matched: string): number | null {
  const norm = stripDiacritics(line);
  const needle = stripDiacritics(matched);
  const idx = needle ? norm.indexOf(needle) : -1;
  let working =
    idx >= 0 ? norm.slice(idx + needle.length) : norm;
  // Stop before another long letter word (next unit name on same line)
  working = working.replace(
    /\b[a-z]{4,}(?:\s+[a-z]{3,}){0,3}\b.*$/i,
    ' ',
  );
  working = working.replace(/\b[ivx]{1,4}\b/gi, ' ');
  working = working.replace(/\b(?:g|m)\s*[1-9]\b/gi, ' ');

  const nums = [...working.matchAll(/\b\d[\d\s.,]*\d\b|\b\d+\b/g)]
    .map((m) => parseAmount(m[0]))
    .filter((n): n is number => n != null && n > 0);

  if (!nums.length) return null;
  const big = nums.filter((n) => n >= 10);
  // Prefer the first sizable number after the unit name
  return big.length ? big[0] : nums[0];
}

function hitLabel(hit: ScanHit): string {
  if (hit.kind === 'guards') {
    const type =
      hit.type === 'melee'
        ? 'Włócznik'
        : hit.type === 'ranged'
          ? 'Łucznik'
          : hit.type === 'mounted'
            ? 'Jeździec'
            : 'Gryf';
    return `${type} G${hit.tier}`;
  }
  const name = MONSTER_NAMES[hit.tier]?.[hit.race!] ?? hit.race ?? '?';
  return `${name} M${hit.tier}`;
}

/** Parse OCR text into troop/monster quantity hits. */
export function parseTroopScanText(text: string): ScanHit[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const expanded = [...lines];
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].length < 48 && lines[i + 1].length < 48) {
      expanded.push(`${lines[i]} ${lines[i + 1]}`);
    }
  }

  const hits: ScanHit[] = [];
  const seen = new Set<string>();

  for (const line of expanded) {
    for (const { alias, matched } of findAliases(line)) {
      const tier = extractTier(line, alias, matched);
      if (tier == null) continue;
      const count = extractCount(line, matched);
      if (count == null) continue;

      if (alias.kind === 'guards') {
        const type = alias.type!;
        if (!isTypeAvailable(type, tier)) continue;
        if (type === 'flying' && tier < FLYING_MIN_TIER) continue;
        if (tier < 1 || tier > 9) continue;
        const key = `g:${type}:${tier}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const hit: ScanHit = {
          kind: 'guards',
          type,
          tier,
          count,
          label: '',
          raw: line,
        };
        hit.label = hitLabel(hit);
        hits.push(hit);
      } else {
        const race = alias.race!;
        if (tier < MONSTER_MIN_TIER || tier > MONSTER_MAX_TIER) continue;
        const key = `m:${race}:${tier}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const hit: ScanHit = {
          kind: 'monster',
          race,
          tier,
          count,
          label: '',
          raw: line,
        };
        hit.label = hitLabel(hit);
        hits.push(hit);
      }
    }
  }

  return hits;
}

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
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

export async function recognizeTroopImage(
  source: File | Blob | string,
  onProgress?: (progress: number) => void,
): Promise<{ text: string; hits: ScanHit[] }> {
  const worker = await getWorker();
  onProgress?.(0.15);
  const result = await worker.recognize(source);
  onProgress?.(1);
  const text = result.data.text ?? '';
  return { text, hits: parseTroopScanText(text) };
}

export function revokeScanPreviews(items: readonly ScanFileResult[]): void {
  for (const item of items) {
    if (item.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(item.previewUrl);
    }
  }
}

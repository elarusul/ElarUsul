/**
 * Guardsmen army planner — aligned with Total Battle Wiki / Help Center.
 * https://totalbattlewiki.com/troops/guardsmen/
 */

export type ArmyType = 'melee' | 'ranged' | 'mounted' | 'flying';

export const ARMY_TYPES: ArmyType[] = ['ranged', 'melee', 'mounted', 'flying'];

export const ARMY_TYPE_LABELS: Record<ArmyType, string> = {
  melee: 'Włócznicy',
  ranged: 'Łucznicy',
  mounted: 'Jeźdźcy',
  flying: 'Gryfy',
};

export const ARMY_TYPE_LABELS_EN: Record<ArmyType, string> = {
  melee: 'Melee',
  ranged: 'Ranged',
  mounted: 'Mounted',
  flying: 'Griffin',
};

/** Official Leadership cost per unit. */
export const OFFICIAL_LEADERSHIP: Record<ArmyType, number> = {
  melee: 1,
  ranged: 1,
  mounted: 2,
  flying: 20,
};

/** Battle Griffin (Gryfy) — Guardsmen V+. Below that the line does not exist. */
export const FLYING_MIN_TIER = 5;

/** Tymczasowy limit warstw gwardii w kalkulatorze (później rozszerzymy). */
export const GUARDS_MAX_TIER = 5;

/**
 * Official minimum silver training cost per unit
 * (totalbattlewiki.com/troops/guardsmen — Training).
 * Floor before food deficit / incomplete Training Cost research.
 * Gryfy od G5 (4410 / 5210 / 6010).
 */
export const FLOOR_SILVER: Record<number, Record<ArmyType, number>> = {
  1: { melee: 60, ranged: 60, mounted: 121, flying: 0 },
  2: { melee: 101, ranged: 101, mounted: 201, flying: 0 },
  3: { melee: 141, ranged: 141, mounted: 281, flying: 0 },
  4: { melee: 181, ranged: 181, mounted: 361, flying: 0 },
  5: { melee: 221, ranged: 221, mounted: 441, flying: 4410 },
  6: { melee: 261, ranged: 261, mounted: 521, flying: 5210 },
  7: { melee: 301, ranged: 301, mounted: 601, flying: 6010 },
};

/** Default editable rates = official wiki floor. */
export const DEFAULT_RATES: Record<number, Record<ArmyType, number>> = {
  1: { ...FLOOR_SILVER[1] },
  2: { ...FLOOR_SILVER[2] },
  3: { ...FLOOR_SILVER[3] },
  4: { ...FLOOR_SILVER[4] },
  5: { ...FLOOR_SILVER[5] },
  6: { ...FLOOR_SILVER[6] },
  7: { ...FLOOR_SILVER[7] },
};

/** Domyślny Aktualny stan — puste (pierwsze uruchomienie / brak storage). */
export const DEFAULT_CURRENT: Record<number, Record<ArmyType, number>> = {
  1: { melee: 0, ranged: 0, mounted: 0, flying: 0 },
  2: { melee: 0, ranged: 0, mounted: 0, flying: 0 },
  3: { melee: 0, ranged: 0, mounted: 0, flying: 0 },
  4: { melee: 0, ranged: 0, mounted: 0, flying: 0 },
  5: { melee: 0, ranged: 0, mounted: 0, flying: 0 },
};

export const DEFAULT_TIERS = [1, 2, 3, 4, 5] as const;

export function isTypeAvailable(type: ArmyType, tier: number): boolean {
  if (type === 'flying') return tier >= FLYING_MIN_TIER;
  return tier >= 1;
}

export function emptyRow(): Record<ArmyType, number> {
  return { melee: 0, ranged: 0, mounted: 0, flying: 0 };
}

export function emptyGrid(tiers: readonly number[]): Record<number, Record<ArmyType, number>> {
  const grid: Record<number, Record<ArmyType, number>> = {};
  for (const tier of tiers) {
    grid[tier] = emptyRow();
  }
  return grid;
}

export function cloneGrid(
  source: Record<number, Record<ArmyType, number>>,
  tiers: readonly number[],
): Record<number, Record<ArmyType, number>> {
  const grid = emptyGrid(tiers);
  for (const tier of tiers) {
    const row = source[tier];
    if (!row) continue;
    for (const type of ARMY_TYPES) {
      grid[tier][type] = isTypeAvailable(type, tier) ? (row[type] ?? 0) : 0;
    }
  }
  return grid;
}

/**
 * Monsters — official Dominance costs (totalbattlewiki.com/troops/monsters).
 * Monsters use Dominance, not Leadership. Tiers start at III.
 */

export type MonsterRace = 'beast' | 'giant' | 'elemental' | 'dragon';

export const MONSTER_RACES: MonsterRace[] = [
  'dragon',
  'beast',
  'giant',
  'elemental',
];

export const MONSTER_MIN_TIER = 3;
export const MONSTER_MAX_TIER = 9;

/** Tymczasowy limit warstw potworów w kalkulatorze (później rozszerzymy). */
export const MONSTER_PLAN_MAX_TIER = 4;

/** Official Dominance cost per unit. */
export const MONSTER_DOMINANCE: Record<number, Record<MonsterRace, number>> = {
  3: { beast: 6, giant: 8, elemental: 3, dragon: 7 },
  4: { beast: 10, giant: 11, elemental: 15, dragon: 13 },
  5: { beast: 22, giant: 23, elemental: 21, dragon: 20 },
  6: { beast: 34, giant: 30, elemental: 35, dragon: 33 },
  7: { beast: 41, giant: 43, elemental: 45, dragon: 44 },
  8: { beast: 52, giant: 55, elemental: 54, dragon: 53 },
  9: { beast: 52, giant: 55, elemental: 54, dragon: 53 },
};

/**
 * Official training floor (Silver / Dragon Coins) from Total Battle Wiki.
 * https://totalbattlewiki.com/troops/monsters/
 */
export const MONSTER_FLOOR_SILVER: Record<number, Record<MonsterRace, number>> = {
  3: { beast: 2530, giant: 3370, elemental: 1270, dragon: 2950 },
  4: { beast: 5410, giant: 5950, elemental: 8110, dragon: 7030 },
  5: { beast: 14600, giant: 15200, elemental: 13900, dragon: 13300 },
  6: { beast: 26600, giant: 23500, elemental: 27400, dragon: 25800 },
  7: { beast: 37000, giant: 38800, elemental: 40600, dragon: 39700 },
  8: { beast: 53100, giant: 56200, elemental: 55100, dragon: 54100 },
  9: { beast: 59300, giant: 62800, elemental: 61600, dragon: 60500 },
};

export const MONSTER_FLOOR_DRAGON_COINS: Record<
  number,
  Record<MonsterRace, number>
> = {
  3: { beast: 240, giant: 320, elemental: 120, dragon: 280 },
  4: { beast: 400, giant: 440, elemental: 600, dragon: 520 },
  5: { beast: 880, giant: 920, elemental: 840, dragon: 800 },
  6: { beast: 1360, giant: 1200, elemental: 1400, dragon: 1320 },
  7: { beast: 1640, giant: 1720, elemental: 1800, dragon: 1760 },
  8: { beast: 2080, giant: 2200, elemental: 2160, dragon: 2120 },
  9: { beast: 2080, giant: 2200, elemental: 2160, dragon: 2120 },
};

export const DEFAULT_MONSTER_SILVER_RATES: MonsterGrid = {
  3: { ...MONSTER_FLOOR_SILVER[3] },
  4: { ...MONSTER_FLOOR_SILVER[4] },
  5: { ...MONSTER_FLOOR_SILVER[5] },
  6: { ...MONSTER_FLOOR_SILVER[6] },
  7: { ...MONSTER_FLOOR_SILVER[7] },
  8: { ...MONSTER_FLOOR_SILVER[8] },
  9: { ...MONSTER_FLOOR_SILVER[9] },
};

export const DEFAULT_MONSTER_COIN_RATES: MonsterGrid = {
  3: { ...MONSTER_FLOOR_DRAGON_COINS[3] },
  4: { ...MONSTER_FLOOR_DRAGON_COINS[4] },
  5: { ...MONSTER_FLOOR_DRAGON_COINS[5] },
  6: { ...MONSTER_FLOOR_DRAGON_COINS[6] },
  7: { ...MONSTER_FLOOR_DRAGON_COINS[7] },
  8: { ...MONSTER_FLOOR_DRAGON_COINS[8] },
  9: { ...MONSTER_FLOOR_DRAGON_COINS[9] },
};

export const MONSTER_NAMES: Record<number, Record<MonsterRace, string>> = {
  3: {
    beast: 'Battle Boar',
    giant: 'Stone Gargoyle',
    elemental: 'Water Elemental',
    dragon: 'Emerald Dragon',
  },
  4: {
    beast: 'Gorgon',
    giant: 'Many-Armed Giant',
    elemental: 'Ice Phoenix',
    dragon: 'Magic Dragon',
  },
  5: {
    beast: 'Fearsome Manticore',
    giant: 'Ettin',
    elemental: 'Flaming Centaur',
    dragon: 'Desert Vanquisher',
  },
  6: {
    beast: 'Jungle Destroyer',
    giant: 'Troll Rider',
    elemental: 'Ruby Golem',
    dragon: 'Crystal Dragon',
  },
  7: {
    beast: 'Ancient Terror',
    giant: 'Destructive Colossus',
    elemental: 'Wind Lord',
    dragon: 'Black Dragon',
  },
  8: {
    beast: 'Trickster I',
    giant: 'Kraken I',
    elemental: 'Fire Phoenix I',
    dragon: 'Devastator I',
  },
  9: {
    beast: 'Trickster II',
    giant: 'Kraken II',
    elemental: 'Fire Phoenix II',
    dragon: 'Devastator II',
  },
};

export type MonsterGrid = Record<number, Record<MonsterRace, number>>;

export function emptyMonsterRow(): Record<MonsterRace, number> {
  return { beast: 0, giant: 0, elemental: 0, dragon: 0 };
}

export function emptyMonsterGrid(tiers: readonly number[]): MonsterGrid {
  const grid: MonsterGrid = {};
  for (const tier of tiers) {
    grid[tier] = emptyMonsterRow();
  }
  return grid;
}

export function cloneMonsterGrid(
  source: MonsterGrid,
  tiers: readonly number[],
): MonsterGrid {
  const grid = emptyMonsterGrid(tiers);
  for (const tier of tiers) {
    const row = source[tier];
    if (!row) continue;
    for (const race of MONSTER_RACES) {
      grid[tier][race] = row[race] ?? 0;
    }
  }
  return grid;
}

export function monsterTiersUpTo(maxTier: number): number[] {
  const capped = Math.max(
    MONSTER_MIN_TIER,
    Math.min(MONSTER_PLAN_MAX_TIER, Math.floor(maxTier)),
  );
  const tiers: number[] = [];
  for (let t = MONSTER_MIN_TIER; t <= capped; t++) tiers.push(t);
  return tiers;
}
